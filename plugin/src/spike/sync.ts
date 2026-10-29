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
  pageSize,
  PERMISSIONS,
  PluginCommAPI,
  recognize,
  reloadFile,
  strokeShape,
} from '../sn';
import {sendReport} from '../worker';
import {PAGE_STATE_KEY, type SpikePage} from './today';
import {allFindings, describeError, record, timed} from './report';

/** Toolbar "Sync" (no UI): reads ticks and handwriting on the current page. */
export async function runSync(): Promise<void> {
  const started = Date.now();
  record('q5-background', 'info', 'sync started from toolbar button');
  try {
    if (!(await ensurePermission(PERMISSIONS.read, 'Read your ticks and writing'))) {
      record('permissions', 'fail', 'FILE:READ not granted');
      return;
    }
    const path = await currentFilePath();
    const page = await currentPage();
    const size = await pageSize(path, page);
    const layout = computeLayout(size.width, size.height);

    const {value: elements, ms: readMs} = await timed(() => pageElements(path, page));
    const strokes = elements.filter(e => e.type === ELEMENT_STROKE);
    const {value: shapes, ms: pointsMs} = await timed(() =>
      Promise.all(strokes.map(e => strokeShape(e))),
    );

    const state = await getJSON<SpikePage | null>(PAGE_STATE_KEY, null);
    const rows = readTaskZone(shapes, layout);
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

    const lines = readWritingZone(shapes, layout);
    const byId = new Map(strokes.map(e => [e.uuid, e]));
    const recognized: RecognizedLine[] = [];
    const {ms: recogMs} = await timed(async () => {
      for (const line of lines) {
        const els = line.strokeIds
          .map(id => byId.get(id))
          .filter((e): e is Element => e !== undefined);
        const text = els.length ? await recognize(els, size) : '';
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

    const nodes = buildOutline(recognized, `spike:${page}`);
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

    record('q5-background', 'pass', 'sync finished without UI', Date.now() - started);
  } catch (e) {
    record('q5-background', 'fail', describeError(e), Date.now() - started);
  } finally {
    PluginCommAPI.clearElementCache();
  }
  try {
    await sendReport({findings: allFindings(), sentAt: new Date().toISOString()});
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
      await modifyElements(path, page, [status]);
      await reloadFile();
    });
    record('header', 'pass', 'modified the status text box in place', ms);
  } catch (e) {
    record('header', 'fail', describeError(e));
  }
}
