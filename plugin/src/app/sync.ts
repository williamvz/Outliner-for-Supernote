import type {Element} from 'sn-plugin-lib';
import {computeLayout, type PageLayout} from '../core/layout';
import {readWritingZone} from '../core/lines';
import {buildOutline, type RecognizedLine} from '../core/outline';
import {readTaskZone} from '../core/ticks';
import type {StrokeShape} from '../core/geometry';
import {
  currentFilePath,
  ELEMENT_STROKE,
  ensurePermission,
  pageElements,
  pageSizeOf,
  PERMISSIONS,
  PluginCommAPI,
  PluginManager,
  recognize,
  saveCurrentNote,
  strokeShape,
  totalPages,
} from '../sn';
import {describeError, record, stackHint, step} from '../spike/report';
import {NetworkError, postNotes, postSync, type SyncAction} from '../worker';
import {flushOutbox, queue} from './outbox';
import {loadNotebook, saveNotebook, type NotebookState, type PageRow} from './store';
import {NOTE_DIR} from './paths';
import {begin, end, getUi, say, setUi} from './ui';
import {hash} from './util';

export interface PlanNote {
  level: number;
  text: string;
  isTask: boolean;
  key: string;
}

/** What Sync found, waiting for the user's OK before anything goes to Tana. */
export interface SyncPlan {
  file: string;
  date: string;
  done: PageRow[];
  skip: PageRow[];
  notes: PlanNote[];
}

/**
 * Sync: read the ticks, "Not today" marks and handwriting in the open notebook
 * (every page of it) and show what would be sent. Nothing reaches Tana until
 * the user taps Send, because handwriting recognition can misread.
 * `fromTap` is true when the SYNC box on the page started it: after a
 * successful send the panel then closes by itself.
 */
export async function runSync(fromTap = false): Promise<void> {
  begin('Sync');
  setUi({closeAfterSend: fromTap});
  try {
    if (!(await ensurePermission(PERMISSIONS.read, 'Read your ticks and handwriting'))) {
      say('File access is not allowed. Allow it in Settings → Apps → Plugins → Tana Sync.');
      return;
    }
    await step('send queued changes', async () => {
      const sent = await flushOutbox().catch(() => 0);
      if (sent) {
        say(`Sent ${sent} queued change${sent === 1 ? '' : 's'} to Tana`);
      }
    });

    const file = await step('current notebook', currentFilePath);
    if (!file.startsWith(`${NOTE_DIR}/`)) {
      say('Open a Tasks or Notes notebook first (Note → Tana), then Sync.');
      return;
    }
    const state = await loadNotebook(file);
    if (!state) {
      say('This notebook was not made by the plugin, so I do not know what is in it.');
      return;
    }

    await step('save notebook', saveCurrentNote);
    const count = state.kind === 'tasks' ? state.pages.length : await step('count pages', () => totalPages(file));
    const done: PageRow[] = [];
    const skip: PageRow[] = [];
    const lines: RecognizedLine[][] = [];

    for (let page = 0; page < count; page++) {
      const size = await step(`page ${page + 1} size`, () => pageSizeOf(file, page));
      const layout = computeLayout(size.width, size.height, state.kind);
      const elements = await step(`read page ${page + 1}`, () => pageElements(file, page));
      const strokes = elements.filter(e => e.type === ELEMENT_STROKE);
      if (!strokes.length) {
        continue;
      }
      const shapes = await readShapes(strokes, page);
      if (state.kind === 'tasks') {
        collectTicks(shapes, layout, state, page, done, skip);
      } else {
        lines[page] = await readLines(shapes, strokes, layout, size, page);
      }
    }

    const notes = state.kind === 'notes' ? outline(lines, file, state) : [];
    setUi({plan: {file, date: state.date, done, skip, notes}});
    say(`${count} page${count === 1 ? '' : 's'} read`);
    record('sync', 'pass', `${done.length} done, ${skip.length} not today, ${notes.length} notes`);
    if (!done.length && !skip.length && !notes.length) {
      say(
        state.kind === 'tasks'
          ? 'Nothing new to send. Tick a box, or mark NOT TODAY, then Sync again.'
          : 'Nothing new to send. Write on the page, then Sync again.',
      );
    }
  } catch (e) {
    say(`Sync failed: ${describeError(e)}`);
    record('sync', 'fail', `${describeError(e)}${stackHint(e)}`);
  } finally {
    try {
      PluginCommAPI.clearElementCache();
    } catch {
      // not available on every firmware; the cache is released when the view closes anyway
    }
    end();
  }
}

async function readShapes(strokes: Element[], page: number): Promise<StrokeShape[]> {
  return step(`read ${strokes.length} strokes on page ${page + 1}`, async () => {
    const read = await Promise.all(strokes.map(e => strokeShape(e).catch(err => err as Error)));
    const failed = read.filter((r): r is Error => r instanceof Error);
    if (failed.length) {
      say(`${failed.length} strokes could not be read (${describeError(failed[0])})`);
    }
    return read.filter((r): r is StrokeShape => !(r instanceof Error));
  });
}

function collectTicks(
  shapes: StrokeShape[],
  layout: PageLayout,
  state: NotebookState,
  page: number,
  done: PageRow[],
  skip: PageRow[],
): void {
  readTaskZone(shapes, layout).forEach((m, i) => {
    const row = state.pages[page]?.[i];
    if (!row) {
      return;
    }
    const sent = state.sentDone.includes(row.id) || state.sentSkip.includes(row.id);
    if (sent || done.some(r => r.id === row.id) || skip.some(r => r.id === row.id)) {
      return;
    }
    if (m.done) {
      done.push(row);
    } else if (m.skip) {
      skip.push(row);
    }
  });
}

async function readLines(
  shapes: StrokeShape[],
  strokes: Element[],
  layout: PageLayout,
  size: {width: number; height: number},
  page: number,
): Promise<RecognizedLine[]> {
  const writing = readWritingZone(shapes, layout);
  const byId = new Map(strokes.map(e => [e.uuid, e]));
  const recognized: RecognizedLine[] = [];
  for (const line of writing) {
    const els = line.strokeIds.map(id => byId.get(id)).filter((e): e is Element => e !== undefined);
    let text = '';
    if (els.length) {
      try {
        text = (await recognize(els, size)).trim();
      } catch (e) {
        say(`Could not read line ${line.slot + 1} on page ${page + 1}: ${describeError(e)}`);
      }
    }
    recognized.push({slot: line.slot, level: line.level, marker: line.marker, text});
  }
  return recognized;
}

function outline(pages: RecognizedLine[][], file: string, state: NotebookState): PlanNote[] {
  const out: PlanNote[] = [];
  pages.forEach((lines, page) => {
    if (!lines?.length) {
      return;
    }
    for (const n of buildOutline(lines, `${file}:${page}`)) {
      const key = `${page}:${n.slots[0]}:${hash(n.text)}`;
      if (n.text && !state.sentLines.includes(key)) {
        out.push({level: n.level, text: n.text, isTask: n.isTask, key});
      }
    }
  });
  return out;
}

/** The user's OK: send the plan, or queue it when offline. */
export async function applyPlan(plan: SyncPlan): Promise<void> {
  const closeAfter = getUi().closeAfterSend;
  begin('Sending to Tana');
  let clean = false;
  try {
    const state = await loadNotebook(plan.file);
    if (!state) {
      throw new Error('notebook memory is gone; run Sync again');
    }
    const actions: SyncAction[] = [
      ...plan.done.map((r): SyncAction => ({type: 'done', id: r.id})),
      ...plan.skip.map((r): SyncAction => ({type: 'postpone', id: r.id})),
    ];
    const names = new Map([...plan.done, ...plan.skip].map(r => [r.id, r.name]));
    let failures = 0;

    if (actions.length) {
      try {
        const res = await postSync(actions);
        for (const r of res.results) {
          const mark = r.status === 'ok' ? '✓' : r.status === 'skipped' ? '–' : '✗';
          failures += r.status === 'failed' ? 1 : 0;
          const verb = r.type === 'done' ? 'done' : 'tomorrow';
          say(`${mark} ${verb}: ${names.get(r.id) ?? r.id} (${r.detail})`);
        }
      } catch (e) {
        if (!(e instanceof NetworkError)) {
          throw e;
        }
        await queue({kind: 'sync', actions, at: new Date().toISOString()});
        say(`Offline: ${actions.length} change${actions.length === 1 ? '' : 's'} queued; they go out at the next Sync`);
      }
      state.sentDone.push(...plan.done.map(r => r.id));
      state.sentSkip.push(...plan.skip.map(r => r.id));
    }

    if (plan.notes.length) {
      const lines = plan.notes.map(n => ({level: n.level, text: n.text, isTask: n.isTask}));
      const key = `${plan.file.replace(/^.*\//, '').replace(/\W+/g, '')}-${hash(plan.notes.map(n => n.key).join('|'))}`;
      try {
        const res = await postNotes(plan.date, key, lines);
        say(`✓ ${res.imported} note line${res.imported === 1 ? '' : 's'} added to ${res.day}`);
      } catch (e) {
        if (!(e instanceof NetworkError)) {
          throw e;
        }
        await queue({kind: 'notes', day: plan.date, key, lines, at: new Date().toISOString()});
        say('Offline: notes queued; they go out at the next Sync');
      }
      state.sentLines.push(...plan.notes.map(n => n.key));
    }

    await saveNotebook(state);
    setUi({plan: null});
    record('send', 'pass', `${actions.length} actions, ${plan.notes.length} notes`);
    clean = failures === 0;
    say(clean ? 'Done.' : 'Done, with problems (see above).');
  } catch (e) {
    say(`Sending failed: ${describeError(e)}`);
    record('send', 'fail', describeError(e));
  } finally {
    end();
  }
  if (clean && closeAfter) {
    // started from the SYNC box on the page: give the result a moment, then back to the page
    setTimeout(() => {
      PluginManager.closePluginView().catch(() => undefined);
    }, 1500);
  }
}
