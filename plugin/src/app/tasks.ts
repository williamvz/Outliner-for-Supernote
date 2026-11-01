import {computeLayout} from '../core/layout';
import {drawTasksPage, type PageTask} from '../render/page';
import {createNote, ensurePermission, FileUtils, insertPage, PERMISSIONS} from '../sn';
import {describeError, record, stackHint, step} from '../spike/report';
import {flushQuietly, freshNotePath, loadTasks, showNotebook, writeTemplate} from './pages';
import {NOTE_DIR, TEMPLATE_FILE} from './paths';
import {loadFilters, saveNotebook, type PageRow} from './store';
import {begin, end, say} from './ui';
import {clock, dayTitle, dueText, isoDay} from './util';

/** 14 rows a page; this many pages is about 170 tasks. */
const MAX_PAGES = 12;

function filterLabel(priorities: string[], domains: string[]): string {
  const p = priorities.length ? priorities.join(' ') : 'all priorities';
  return domains.length ? `${p} · ${domains.join(' + ')}` : p;
}

/**
 * Tasks: one notebook with a page for every 14 open tasks (P1 first, the
 * oldest due date first inside a priority), for ticking off. Flip through it
 * with the normal page turn.
 */
export async function runTasks(): Promise<void> {
  begin('Tasks');
  try {
    const granted =
      (await ensurePermission(PERMISSIONS.read, 'Open and read your Tana notebook')) &&
      (await ensurePermission(PERMISSIONS.write, 'Create the Tasks notebook'));
    if (!granted) {
      say('File access is not allowed. Allow it in Settings → Apps → Plugins → Tana Sync.');
      return;
    }
    await step('send queued changes', flushQuietly);
    const filters = await loadFilters();
    const {tasks, source} = await step('load tasks', () => loadTasks(filters));
    if (!tasks.length) {
      say('No open tasks match the filters.');
      return;
    }

    const perPage = computeLayout().rows.length;
    const pageCount = Math.min(MAX_PAGES, Math.ceil(tasks.length / perPage));
    const shown = tasks.slice(0, pageCount * perPage);
    say(`${tasks.length} tasks ${source}; ${pageCount} page${pageCount === 1 ? '' : 's'}`);
    if (shown.length < tasks.length) {
      say(`Showing the first ${shown.length}. Use the filters to see the rest.`);
    }

    const date = isoDay();
    await step('make notebook folder', () => FileUtils.makeDir(NOTE_DIR));
    const path = await step('choose notebook name', () => freshNotePath(`Tasks ${date}`));
    const pages: PageRow[][] = [];
    for (let p = 0; p < pageCount; p++) {
      const slice = shown.slice(p * perPage, (p + 1) * perPage);
      const canvas = drawTasksPage({
        title: 'Tasks',
        subtitle: `${dayTitle()} · ${clock()} · ${filterLabel(filters.priorities, filters.domains)}`,
        tasks: slice.map(
          (t): PageTask => ({
            name: t.name,
            priority: t.priority,
            domain: t.domain,
            recurring: t.recurring,
            due: dueText(t.deadline),
          }),
        ),
        footer: `Page ${p + 1} of ${pageCount} · ${tasks.length} tasks`,
      });
      await writeTemplate(canvas, `page ${p + 1}/${pageCount}`);
      await step(p === 0 ? 'create notebook' : `add page ${p + 1}`, () =>
        p === 0 ? createNote(path, TEMPLATE_FILE) : insertPage(path, p, TEMPLATE_FILE),
      );
      pages.push(slice.map(t => ({id: t.id, name: t.name, recurring: t.recurring})));
      say(`Page ${p + 1} of ${pageCount} ready`);
    }

    await step('remember pages', () =>
      saveNotebook({kind: 'tasks', file: path, date, pages, sentDone: [], sentSkip: [], sentLines: []}),
    );
    say(`Created ${path.replace(/^.*\//, '')}`);
    record('tasks', 'pass', `${shown.length} tasks on ${pageCount} pages: ${path}`);
    await showNotebook(path);
  } catch (e) {
    say(`Tasks failed: ${describeError(e)}`);
    record('tasks', 'fail', `${describeError(e)}${stackHint(e)}`);
  } finally {
    end();
  }
}
