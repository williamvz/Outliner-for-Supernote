import type {Element} from 'sn-plugin-lib';
import {computeLayout} from '../core/layout';
import {readWritingZone} from '../core/lines';
import {buildOutline, type RecognizedLine} from '../core/outline';
import {readTaskZone} from '../core/ticks';
import {
  currentFilePath,
  currentPage,
  ELEMENT_STROKE,
  ensurePermission,
  pageElements,
  pageSizeOf,
  PERMISSIONS,
  PluginCommAPI,
  recognize,
  saveCurrentNote,
  strokeShape,
} from '../sn';
import {describeError, record, stackHint, step} from '../spike/report';
import {NetworkError, postNotes, postSync, type SyncAction} from '../worker';
import {flushOutbox, queue} from './outbox';
import {loadPage, savePage, type PageRow, type PageState} from './store';
import {NOTE_DIR} from './today';
import {begin, end, say, setUi} from './ui';
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
 * Sync: read the ticks, "Not today" marks and handwriting on the open Today
 * page and show what would be sent. Nothing reaches Tana until the user
 * taps Send, because handwriting recognition can misread.
 */
export async function runSync(): Promise<void> {
  begin('Sync');
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
      say('Open a Today notebook first (Note → Tana), then tap Sync.');
      return;
    }
    const state = await loadPage(file);
    if (!state) {
      say('This notebook was not made by Today, so I do not know its tasks.');
      return;
    }
    const page = await step('current page', currentPage);
    if (page !== 0) {
      say('Sync reads page 1 of a Today notebook. Go to page 1 and tap Sync again.');
      return;
    }

    await step('save notebook', saveCurrentNote);
    const size = await step('page size', () => pageSizeOf(file, page));
    const layout = computeLayout(size.width, size.height);
    const elements = await step('read page', () => pageElements(file, page));
    const strokes = elements.filter(e => e.type === ELEMENT_STROKE);
    say(`${strokes.length} pen strokes on the page`);

    const shapes = await step(`read ${strokes.length} strokes`, async () => {
      const read = await Promise.all(strokes.map(e => strokeShape(e).catch(err => err as Error)));
      const failed = read.filter((r): r is Error => r instanceof Error);
      if (failed.length) {
        say(`${failed.length} strokes could not be read (${describeError(failed[0])})`);
      }
      return read.filter(r => !(r instanceof Error)) as Awaited<ReturnType<typeof strokeShape>>[];
    });

    const marks = await step('read ticks', () => readTaskZone(shapes, layout));
    const done: PageRow[] = [];
    const skip: PageRow[] = [];
    marks.forEach((m, i) => {
      const row = state.rows[i];
      if (!row) {
        return;
      }
      if (m.done && !state.sentDone.includes(row.id)) {
        done.push(row);
      } else if (m.skip && !m.done && !state.sentSkip.includes(row.id) && !state.sentDone.includes(row.id)) {
        skip.push(row);
      }
    });

    const notes = await step('read handwriting', () => readNotes(shapes, strokes, layout, size, file, state));
    const plan: SyncPlan = {file, date: state.date, done, skip, notes};
    setUi({plan});
    record('sync', 'pass', `${done.length} done, ${skip.length} not today, ${notes.length} notes`);
    if (!done.length && !skip.length && !notes.length) {
      say('Nothing new to send. Tick a box, mark NOT TODAY, or write below the line.');
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

async function readNotes(
  shapes: Awaited<ReturnType<typeof strokeShape>>[],
  strokes: Element[],
  layout: ReturnType<typeof computeLayout>,
  size: {width: number; height: number},
  file: string,
  state: PageState,
): Promise<PlanNote[]> {
  const lines = readWritingZone(shapes, layout);
  if (!lines.length) {
    return [];
  }
  const byId = new Map(strokes.map(e => [e.uuid, e]));
  const recognized: RecognizedLine[] = [];
  for (const line of lines) {
    const els = line.strokeIds.map(id => byId.get(id)).filter((e): e is Element => e !== undefined);
    let text = '';
    if (els.length) {
      try {
        text = (await recognize(els, size)).trim();
      } catch (e) {
        say(`Could not read line ${line.slot + 1}: ${describeError(e)}`);
      }
    }
    recognized.push({slot: line.slot, level: line.level, marker: line.marker, text});
  }
  const nodes = buildOutline(recognized, file);
  return nodes
    .map(n => ({
      level: n.level,
      text: n.text,
      isTask: n.isTask,
      key: `${n.slots[0]}:${hash(n.text)}`,
    }))
    .filter(n => n.text && !state.sentLines.includes(n.key));
}

/** The user's OK: send the plan, or queue it when offline. */
export async function applyPlan(plan: SyncPlan): Promise<void> {
  begin('Sending to Tana');
  try {
    const state = await loadPage(plan.file);
    if (!state) {
      throw new Error('page memory is gone; run Sync again');
    }
    const actions: SyncAction[] = [
      ...plan.done.map((r): SyncAction => ({type: 'done', id: r.id})),
      ...plan.skip.map((r): SyncAction => ({type: 'postpone', id: r.id})),
    ];
    const names = new Map([...plan.done, ...plan.skip].map(r => [r.id, r.name]));

    if (actions.length) {
      try {
        const res = await postSync(actions);
        for (const r of res.results) {
          const mark = r.status === 'ok' ? '✓' : r.status === 'skipped' ? '–' : '✗';
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

    await savePage(state);
    setUi({plan: null});
    say('Done. Tap Today for a fresh page when you want the next tasks.');
    record('send', 'pass', `${actions.length} actions, ${plan.notes.length} notes`);
  } catch (e) {
    say(`Sending failed: ${describeError(e)}`);
    record('send', 'fail', describeError(e));
  } finally {
    end();
  }
}
