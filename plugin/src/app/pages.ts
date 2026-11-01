import type {Canvas} from '../render/canvas';
import {encodeGrayPng, toBase64} from '../render/png';
import {FileUtils, openFile, PluginManager} from '../sn';
import {writeBinary} from '../storage';
import {describeError, step} from '../spike/report';
import {getTasks, NetworkError, type TaskSummary} from '../worker';
import {flushOutbox} from './outbox';
import {loadTaskCache, saveTaskCache, type Filters} from './store';
import {say} from './ui';
import {NOTE_DIR, TEMPLATE_DIR, TEMPLATE_FILE} from './paths';
import {clock} from './util';

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Encodes the canvas as a PNG and puts it where the next notebook page is made from. */
export async function writeTemplate(canvas: Canvas, label: string): Promise<number> {
  const png = await step(`draw ${label}`, () => encodeGrayPng(canvas.width, canvas.height, canvas.pixels));
  return step(`write ${label} (${png.length} bytes)`, async () => {
    await FileUtils.makeDir(TEMPLATE_DIR);
    return writeBinary(TEMPLATE_FILE, toBase64(png));
  });
}

/**
 * Opens the notebook, then closes the panel. Nobody knows yet which order
 * PluginHost prefers, so the other one is tried when the first open fails.
 */
export async function showNotebook(path: string, page = 0): Promise<void> {
  const opened = await step('open notebook', () => openFile(path, page)).then(
    () => true,
    () => false,
  );
  await step('close plugin view', () => PluginManager.closePluginView());
  if (!opened) {
    await step('open notebook (panel closed)', () => openFile(path, page));
  }
}

export async function flushQuietly(): Promise<void> {
  try {
    const sent = await flushOutbox();
    if (sent) {
      say(`Sent ${sent} queued change${sent === 1 ? '' : 's'} to Tana`);
    }
  } catch (e) {
    say(`Queued changes still waiting: ${describeError(e)}`);
  }
}

/** A notebook name nobody has used: "<base>.note", "<base> b.note", … */
export async function freshNotePath(base: string): Promise<string> {
  for (const suffix of ['', ' b', ' c', ' d', ' e', ' f', ' g', ' h', ' i', ' j']) {
    const path = `${NOTE_DIR}/${base}${suffix}.note`;
    if (!(await FileUtils.exists(path))) {
      return path;
    }
  }
  return `${NOTE_DIR}/${base} ${clock().replace(':', '')}.note`;
}

export interface Loaded {
  tasks: TaskSummary[];
  today: string;
  source: string;
}

/** The Worker's list; waits while it is still building the first snapshot; the cache when offline. */
export async function loadTasks(filters: Filters): Promise<Loaded> {
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await getTasks(filters);
      if (res.tasks.length || !res.refreshing) {
        if (!filters.priorities.length && !filters.domains.length) {
          await saveTaskCache({at: new Date().toISOString(), today: res.today, tasks: res.tasks.slice(0, 80)});
        }
        return {tasks: res.tasks, today: res.today, source: 'from Tana'};
      }
      say(`Tana is loading your tasks (${res.refreshing.read}/${res.refreshing.of})…`);
      await sleep(3000);
    }
    throw new Error('Tana is still loading your tasks; try again in a minute');
  } catch (e) {
    if (!(e instanceof NetworkError)) {
      throw e;
    }
    const cache = await loadTaskCache();
    if (!cache?.tasks.length) {
      throw new Error(`no connection and no saved tasks (${describeError(e)})`);
    }
    const tasks = (cache.tasks as TaskSummary[]).filter(
      t =>
        (!filters.priorities.length || filters.priorities.includes(t.priority ?? 'P3')) &&
        (!filters.domains.length || filters.domains.includes(t.domain ?? 'Unsorted')),
    );
    return {tasks, today: cache.today, source: `offline, saved ${cache.at.slice(11, 16)}`};
  }
}
