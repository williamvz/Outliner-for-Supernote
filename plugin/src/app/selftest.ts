import {computeLayout} from '../core/layout';
import {drawTodayPage} from '../render/page';
import {encodeGrayPng, toBase64} from '../render/png';
import {
  createElement,
  createNote,
  currentFilePath,
  currentPage,
  ELEMENT_STROKE,
  ELEMENT_TEXT,
  ensurePermission,
  FileUtils,
  getElementCount,
  insertElements,
  insertPage,
  insertText,
  missingNativeMethods,
  NATIVE_METHODS,
  noteSystemTemplates,
  notePageTemplate,
  openFile,
  pageElements,
  pageSizeOf,
  PERMISSIONS,
  PluginManager,
  recognize,
  saveCurrentNote,
  strokeShape,
  totalPages,
} from '../sn';
import {getJSON, nativeModuleInventory, setJSON, storageName, writeBinary} from '../storage';
import {allFindings, describeError, eventLog, record, stackHint, timed} from '../spike/report';
import {health, sendReport} from '../worker';
import {NOTE_DIR, ROOT} from './today';
import {begin, end, say} from './ui';

const SCRATCH = `${NOTE_DIR}/_selftest.note`;
const SCRATCH_TEMPLATE = `${ROOT}/MyStyle/tana_selftest.png`;

/**
 * Tries every device call the plugin depends on, one by one, and keeps going
 * when one fails, so a single run shows exactly which calls work on this
 * firmware. Results are shown in the panel and uploaded to the Worker.
 */
export async function runSelfTest(): Promise<void> {
  begin('Self-test');
  const results: Array<{name: string; ok: boolean; detail: string}> = [];

  const probe = async (name: string, fn: () => Promise<unknown> | unknown): Promise<unknown> => {
    try {
      const {value, ms} = await timed(async () => fn());
      const detail = value === undefined || value === true ? '' : short(value);
      results.push({name, ok: true, detail});
      say(`PASS ${name}${detail ? `: ${detail}` : ''} (${ms} ms)`);
      record(`selftest.${name}`, 'pass', detail, ms);
      return value;
    } catch (e) {
      const detail = `${describeError(e)}${stackHint(e)}`;
      results.push({name, ok: false, detail});
      say(`FAIL ${name}: ${describeError(e)}`);
      record(`selftest.${name}`, 'fail', detail);
      return undefined;
    }
  };

  try {
    await probe('permissions', async () => {
      const out: string[] = [];
      for (const [label, p] of Object.entries(PERMISSIONS)) {
        const has = await PluginManager.hasPermission(p);
        const granted = has === 1 || (await ensurePermission(p, 'Tana Sync self-test'));
        out.push(`${label}=${granted ? 'yes' : 'NO'}`);
        if (!granted) {
          throw new Error(out.join(' '));
        }
      }
      return out.join(' ');
    });

    await probe('device', async () => {
      const [type, name] = await Promise.all([PluginManager.getDeviceType(), PluginManager.getPluginName()]);
      return `deviceType=${type} plugin=${name} storage=${storageName()} modules=${nativeModuleInventory().join(',')}`;
    });

    await probe('native methods', () => {
      const missing = missingNativeMethods();
      if (missing.length) {
        throw new Error(`missing: ${missing.join(', ')}`);
      }
      return `all ${NATIVE_METHODS.length} present`;
    });

    await probe('data file round trip', async () => {
      const stamp = Date.now();
      await setJSON('selftest', {stamp});
      const back = await getJSON<{stamp: number} | null>('selftest', null);
      if (back?.stamp !== stamp) {
        throw new Error('written value did not read back');
      }
    });

    await probe('Worker reachable', async () => {
      const h = await health();
      return `tana=${h.tana} workspace=${h.workspace}`;
    });

    // Reads the page you have open (before this test opens its scratch notebook).
    await probe('read open notebook', async () => {
      const path = await currentFilePath();
      const page = await currentPage();
      await saveCurrentNote();
      const size = await pageSizeOf(path, page);
      const elements = await pageElements(path, page);
      const strokes = elements.filter(e => e.type === ELEMENT_STROKE);
      let detail = `${path.replace(/^.*\//, '')} p${page + 1} ${size.width}x${size.height}: ${elements.length} elements, ${strokes.length} strokes`;
      if (strokes.length) {
        const shape = await strokeShape(strokes[0]);
        const p = shape.points[0];
        detail += `; first stroke ${shape.points.length} points from (${Math.round(p.x)},${Math.round(p.y)})`;
        try {
          const text = await recognize(strokes.slice(0, 12), size);
          detail += `; recognised "${String(text).slice(0, 60)}"`;
        } catch (e) {
          detail += `; recognition failed: ${describeError(e)}`;
        }
      } else {
        detail += ' (write something on the page first to test reading strokes)';
      }
      return detail;
    });

    const templates = (await probe('system templates', async () => {
      const list = await noteSystemTemplates();
      if (!list?.length) {
        throw new Error('none listed');
      }
      return list;
    })) as Array<{name: string}> | undefined;
    results[results.length - 1].detail = templates ? `${templates.length}: ${templates.slice(0, 3).map(t => t.name).join(', ')}` : '';

    await probe('write template image', async () => {
      await FileUtils.makeDir(`${ROOT}/MyStyle`);
      const c = drawTodayPage({
        title: 'Self-test',
        subtitle: 'scratch page',
        tasks: [{name: 'A task on the scratch page', priority: 'P2', domain: 'Work', recurring: false, due: 'today'}],
      });
      const png = encodeGrayPng(c.width, c.height, c.pixels);
      const bytes = await writeBinary(SCRATCH_TEMPLATE, toBase64(png));
      return `${bytes} bytes`;
    });

    await probe('create notebook with image background', async () => {
      await FileUtils.makeDir(NOTE_DIR);
      if (await FileUtils.exists(SCRATCH)) {
        return 'scratch notebook already exists (reused)';
      }
      await createNote(SCRATCH, SCRATCH_TEMPLATE);
    });

    await probe('background really custom', async () => {
      const info = await notePageTemplate(SCRATCH, 0);
      if (!info || !info.md5 || String(info.md5) === '0') {
        throw new Error(`page uses "${info?.name}", not the image`);
      }
      return `${info.name} md5=${info.md5}`;
    });

    const pages = (await probe('count pages', () => totalPages(SCRATCH))) as number | undefined;

    await probe('page size from file', async () => {
      const size = await pageSizeOf(SCRATCH, 0);
      const layout = computeLayout(size.width, size.height);
      return `${size.width}x${size.height}, rows ${layout.rows.length}`;
    });

    if (templates?.[0]) {
      await probe('add page with system template', () => insertPage(SCRATCH, pages ?? 1, templates[0].name));
    }
    await probe('add page with image path', async () => {
      const at = (await totalPages(SCRATCH)) ?? 1;
      await insertPage(SCRATCH, at, SCRATCH_TEMPLATE);
      const info = await notePageTemplate(SCRATCH, at);
      return `new page ${at + 1} background: ${info?.name} md5=${info?.md5}`;
    });

    await probe('text box in file (insertElements)', async () => {
      const el = await createElement(ELEMENT_TEXT);
      el.pageNum = 0;
      el.layerNum = 0;
      el.textBox = {
        fontSize: 32,
        fontPath: null,
        textContentFull: 'self-test text',
        textRect: {left: 120, top: 1200, right: 700, bottom: 1260},
        textDigestData: null,
        textAlign: 0,
        textBold: 0,
        textItalics: 0,
        textFrameWidthType: 0,
        textFrameStyle: 0,
        textEditable: 1,
      } as never;
      await insertElements(SCRATCH, 0, [el]);
      const back = await pageElements(SCRATCH, 0);
      const texts = back.filter(e => e.type === ELEMENT_TEXT).length;
      if (!texts) {
        throw new Error('inserted, but no text box found when reading the page back');
      }
      return `${texts} text box(es) read back`;
    });

    await probe('open notebook', async () => {
      await openFile(SCRATCH, 0);
      const open = await currentFilePath();
      if (open !== SCRATCH) {
        throw new Error(`opened ${open}`);
      }
    });

    await probe('text box on open page (insertText)', async () => {
      await insertText({
        fontSize: 32,
        textContentFull: 'insertText works',
        textRect: {left: 120, top: 1300, right: 700, bottom: 1360},
        textAlign: 0,
        textBold: 0,
        textItalics: 0,
        textFrameWidthType: 0,
        textFrameStyle: 0,
        textEditable: 1,
      });
    });

    await probe('element count', () => getElementCount(SCRATCH, 0));
  } finally {
    const failed = results.filter(r => !r.ok);
    say(failed.length ? `${failed.length} of ${results.length} checks FAILED` : `All ${results.length} checks passed`);
    try {
      await sendReport({findings: allFindings(), log: eventLog(), sentAt: new Date().toISOString(), selftest: results});
      say('Report sent to the Worker');
    } catch (e) {
      say(`Report not sent: ${describeError(e)}`);
    }
    end();
  }
}

function short(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').slice(0, 160);
}
