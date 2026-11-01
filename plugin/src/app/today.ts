import {computeLayout} from '../core/layout';
import {drawTodayPage, type PageTask} from '../render/page';
import {encodeGrayPng, toBase64} from '../render/png';
import {
  createNote,
  ensurePermission,
  FileUtils,
  notePageTemplate,
  openFile,
  PERMISSIONS,
  PluginManager,
} from '../sn';
import {writeBinary} from '../storage';
import {describeError, record, stackHint, step} from '../spike/report';
import {getTasks, NetworkError, type TaskSummary} from '../worker';
import {flushOutbox} from './outbox';
import {loadTaskCache, saveTaskCache, savePage} from './store';
import {begin, end, say} from './ui';
import {clock, dayTitle, dueLabel, isoDay} from './util';

export const ROOT = '/storage/emulated/0';
export const NOTE_DIR = `${ROOT}/Note/Tana`;
const TEMPLATE_DIR = `${ROOT}/MyStyle`;
export const TEMPLATE_FILE = `${TEMPLATE_DIR}/tana_today.png`;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Today: fetch the most urgent open tasks, draw them into a page background,
 * create a notebook for the day with that background and open it. Drawing the
 * page ourselves keeps the device calls to a minimum (create a note, open it)
 * and gives a crisp page the pen-reading code can rely on.
 */
export async function runToday(): Promise<void> {
  begin('Today');
  try {
    const granted =
      (await ensurePermission(PERMISSIONS.read, 'Open and read your Tana notebook')) &&
      (await ensurePermission(PERMISSIONS.write, 'Create the Today notebook'));
    if (!granted) {
      say('File access is not allowed. Allow it in Settings → Apps → Plugins → Tana Sync.');
      return;
    }

    await step('send queued changes', flushQuietly);
    const {tasks, today, total, source} = await step('load tasks', loadTasks);
    const layout = await step('page layout', () => computeLayout());
    const shown = tasks.slice(0, layout.rows.length);
    say(`${shown.length} of ${total} tasks (${source})`);
    shown.forEach((t, i) => say(`${i + 1}. ${t.priority ?? 'P3'}  ${t.name}`));

    const date = isoDay();
    const content = {
      title: dayTitle(),
      subtitle: `${total} open${total > shown.length ? ` · +${total - shown.length} more` : ''} · ${clock()}`,
      tasks: shown.map(
        (t): PageTask => ({
          name: t.name,
          priority: t.priority,
          domain: t.domain,
          recurring: t.recurring,
          due: dueLabel(t.deadline, today),
        }),
      ),
    };

    const png = await step('draw page', () => {
      const canvas = drawTodayPage(content, layout.width, layout.height);
      return encodeGrayPng(canvas.width, canvas.height, canvas.pixels);
    });
    await step(`write template (${png.length} bytes)`, async () => {
      await FileUtils.makeDir(TEMPLATE_DIR);
      return writeBinary(TEMPLATE_FILE, toBase64(png));
    });

    await step('make notebook folder', () => FileUtils.makeDir(NOTE_DIR));
    const path = await step('choose notebook name', () => freshNotePath(date));
    await step('create notebook', () => createNote(path, TEMPLATE_FILE));
    await describeTemplate(path);

    await step('remember page', () =>
      savePage({
        file: path,
        date,
        rows: shown.map(t => ({id: t.id, name: t.name, recurring: t.recurring})),
        sentDone: [],
        sentSkip: [],
        sentLines: [],
      }),
    );

    say(`Created ${path.replace(`${ROOT}/`, '')}`);
    record('today', 'pass', `${shown.length} tasks on ${path}`);
    // Open first and close the panel after: nobody knows yet which order
    // PluginHost prefers, so try the other one if the first open is refused.
    const opened = await step('open notebook', () => openFile(path, 0)).then(
      () => true,
      () => false,
    );
    await step('close plugin view', () => PluginManager.closePluginView());
    if (!opened) {
      await step('open notebook (panel closed)', () => openFile(path, 0));
    }
  } catch (e) {
    say(`Today failed: ${describeError(e)}`);
    record('today', 'fail', `${describeError(e)}${stackHint(e)}`);
  } finally {
    end();
  }
}

async function flushQuietly(): Promise<void> {
  try {
    const sent = await flushOutbox();
    if (sent) {
      say(`Sent ${sent} queued change${sent === 1 ? '' : 's'} to Tana`);
    }
  } catch (e) {
    say(`Queued changes still waiting: ${describeError(e)}`);
  }
}

/** Reads back which background the page got, to tell a custom image from a plain page. */
async function describeTemplate(path: string): Promise<void> {
  try {
    const info = await notePageTemplate(path, 0);
    const custom = !!info?.md5 && String(info.md5) !== '0';
    say(custom ? 'Background: custom page applied' : `Background: ${info?.name ?? '?'} (not custom)`);
    record('today.template', custom ? 'pass' : 'info', JSON.stringify(info));
  } catch (e) {
    record('today.template', 'info', `could not read back: ${describeError(e)}`);
  }
}

async function freshNotePath(date: string): Promise<string> {
  const suffixes = ['', ' b', ' c', ' d', ' e', ' f', ' g', ' h', ' i', ' j'];
  for (const suffix of suffixes) {
    const path = `${NOTE_DIR}/${date}${suffix}.note`;
    if (!(await FileUtils.exists(path))) {
      return path;
    }
  }
  return `${NOTE_DIR}/${date} ${clock().replace(':', '')}.note`;
}

interface Loaded {
  tasks: TaskSummary[];
  today: string;
  total: number;
  source: string;
}

/** The Worker's list; waits while it is still building the first snapshot; the cache when offline. */
async function loadTasks(): Promise<Loaded> {
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await getTasks();
      if (res.tasks.length || !res.refreshing) {
        await saveTaskCache({at: new Date().toISOString(), today: res.today, tasks: res.tasks.slice(0, 40)});
        return {tasks: res.tasks, today: res.today, total: res.count, source: 'from Tana'};
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
    return {
      tasks: cache.tasks as TaskSummary[],
      today: cache.today,
      total: cache.tasks.length,
      source: `offline, saved ${cache.at.slice(11, 16)}`,
    };
  }
}

