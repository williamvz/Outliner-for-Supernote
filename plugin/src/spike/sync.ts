import type {Element} from 'sn-plugin-lib';
import {computeLayout} from '../core/layout';
import {readWritingZone} from '../core/lines';
import {buildOutline, type RecognizedLine} from '../core/outline';
import {readTaskZone} from '../core/ticks';
import {getJSON} from '../storage';
import {
  currentFilePath,
  currentPage,
  ELEMENT_STROKE,
  ELEMENT_TEXT,
  ensurePermission,
  modifyElements,
  pageElements,
  pageSizeOf,
  PERMISSIONS,
  PluginCommAPI,
  recognize,
  reloadFile,
  saveCurrentNote,
  strokeShape,
} from '../sn';
import {sendReport} from '../worker';
import {PAGE_STATE_KEY, type SpikePage} from './today';
import {allFindings, describeError, eventLog, logEvent, record, stackHint, step, timed} from './report';

/**
 * Toolbar "Sync": reads ticks and handwriting on the current page. The button
 * opens the plugin view, which shows the result in the report when done.
 */
export async function runSync(): Promise<void> {
  const started = Date.now();
  logEvent('Sync: started');
  try {
    if (!(await ensurePermission(PERMISSIONS.read, 'Read your ticks and writing'))) {
      record('permissions', 'fail', 'Sync: FILE:READ not granted');
      return;
    }
    const path = await step('current file', currentFilePath);
    const page = await step('current page', currentPage);
    // Strokes written since the last save live only in the note's memory cache.
    await step('save note', saveCurrentNote);
    const size = await step('page size', () => pageSizeOf(path, page));
    logEvent(`Sync: ${path} page ${page}, ${size.width}x${size.height}`);
    const layout = await step('compute layout', () => computeLayout(size.width, size.height));

    const {value: elements, ms: readMs} = await step('read elements', () =>
      timed(() => pageElements(path, page)),
    );
    const strokes = elements.filter(e => e.type === ELEMENT_STROKE);
    const {value: shapes, ms: pointsMs} = await step(`read ${strokes.length} stroke shapes`, () =>
      timed(() => Promise.all(strokes.map(e => strokeShape(e)))),
    );

    const state = await step('load page state', () => getJSON<SpikePage | null>(PAGE_STATE_KEY, null));
    const rows = await step('read ticks', () => readTaskZone(shapes, layout));
    const done = rows.filter(r => r.done);
    record(
      'ticks',
      'info',
      done.length
        ? done
            .map(r => `row ${r.row + 1}: ${state?.rows[r.row]?.name ?? '(no task)'}`)
            .join('; ')
        : 'no ticks found',
    );

    const lines = await step('group writing lines', () => readWritingZone(shapes, layout));
    const byId = new Map(strokes.map(e => [e.uuid, e]));
    const recognized: RecognizedLine[] = [];
    const {ms: recogMs} = await timed(async () => {
      for (const line of lines) {
        const els = line.strokeIds
          .map(id => byId.get(id))
          .filter((e): e is Element => e !== undefined);
        const text = els.length
          ? await step(`recognize line ${line.slot}`, () => recognize(els, size))
          : '';
        recognized.push({slot: line.slot, level: line.level, marker: line.marker, text});
      }
    });
    record(
      'q3-recognize',
      lines.length ? 'pass' : 'info',
      `${elements.length} elements, ${strokes.length} strokes; read ${readMs} ms, points ${pointsMs} ms, ` +
        `recognize ${lines.length} lines ${recogMs} ms. Lines: ` +
        recognized
          .map(l => `[${l.slot} L${l.level} ${l.marker ?? '·'}] ${l.text}`)
          .join(' | '),
      readMs + pointsMs + recogMs,
    );

    const nodes = await step('build outline', () => buildOutline(recognized, `spike:${page}`));
    record(
      'outline',
      'info',
      nodes.length
        ? nodes
            .map(n => `${'  '.repeat(n.level)}${n.isTask ? '☐ ' : '- '}${n.text}`)
            .join(' / ')
        : 'no handwriting found',
    );

    await updateStatus(path, page, elements, state, done.length, nodes.length);
    logEvent(`Sync: done in ${Date.now() - started} ms`);
  } catch (e) {
    record(
      'q3-recognize',
      'fail',
      `Sync failed after ${Date.now() - started} ms: ${describeError(e)}${stackHint(e)}`,
    );
  } finally {
    try {
      PluginCommAPI.clearElementCache();
    } catch (e) {
      logEvent(`clearElementCache: ${describeError(e)}`);
    }
  }
  try {
    await sendReport({findings: allFindings(), log: eventLog(), sentAt: new Date().toISOString()});
  } catch {
    // Report upload is best effort; the screen still shows everything.
  }
}

async function updateStatus(
  path: string,
  page: number,
  elements: Element[],
  state: SpikePage | null,
  ticks: number,
  nodes: number,
) {
  const status = elements.find(
    e =>
      e.type === ELEMENT_TEXT &&
      (e.uuid === state?.statusUuid ||
        (e.textBox?.textContentFull ?? '').startsWith('Spike ·')),
  );
  if (!status || !status.textBox) {
    record('header', 'info', 'status text box not found on this page');
    return;
  }
  try {
    if (!(await ensurePermission(PERMISSIONS.write, 'Update the status line'))) {
      record('header', 'fail', 'FILE:WRITE not granted');
      return;
    }
    const now = new Date();
    const hhmm = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    status.textBox.textContentFull = `Spike · synced ${hhmm} · ${ticks} ticks · ${nodes} nodes`;
    const {ms} = await timed(async () => {
      await saveCurrentNote();
      await modifyElements(path, page, [status]);
      await reloadFile();
    });
    record('header', 'pass', 'modified the status text box in place', ms);
  } catch (e) {
    record('header', 'fail', describeError(e));
  }
}
