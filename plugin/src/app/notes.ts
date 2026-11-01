import {drawNotesPage} from '../render/page';
import {
  createNote,
  currentFilePath,
  ensurePermission,
  FileUtils,
  insertPage,
  PERMISSIONS,
  totalPages,
} from '../sn';
import {describeError, record, stackHint, step} from '../spike/report';
import {showNotebook, writeTemplate} from './pages';
import {NOTE_DIR, TEMPLATE_FILE} from './paths';
import {saveNotebook} from './store';
import {begin, end, say} from './ui';
import {dayTitle, isoDay} from './util';

const HINT = 'dash = new item  ·  indent = sub-item  ·  [ ] = task';

/**
 * Notes: today's writing notebook. Whatever you write goes to today's node in
 * Tana when you tap SYNC. The first press makes it, the next opens it, and
 * pressing it while it is open adds a fresh page at the end.
 */
export async function runNotes(): Promise<void> {
  begin('Notes');
  try {
    const granted =
      (await ensurePermission(PERMISSIONS.read, 'Open and read your Tana notebook')) &&
      (await ensurePermission(PERMISSIONS.write, 'Create the Notes notebook'));
    if (!granted) {
      say('File access is not allowed. Allow it in Settings → Apps → Plugins → Tana Sync.');
      return;
    }
    const date = isoDay();
    const path = `${NOTE_DIR}/Notes ${date}.note`;
    const canvas = drawNotesPage({title: `Notes · ${dayTitle()}`, subtitle: HINT});

    if (await step('look for today’s notes', () => FileUtils.exists(path))) {
      const open = await currentFilePath().catch(() => '');
      if (open === path) {
        const count = await step('count pages', () => totalPages(path));
        await writeTemplate(canvas, 'notes page');
        await step('add page', () => insertPage(path, count, TEMPLATE_FILE));
        say(`Added page ${count + 1}`);
        await showNotebook(path, count);
      } else {
        say('Opening today’s notes');
        await showNotebook(path);
      }
      return;
    }

    await step('make notebook folder', () => FileUtils.makeDir(NOTE_DIR));
    await writeTemplate(canvas, 'notes page');
    await step('create notebook', () => createNote(path, TEMPLATE_FILE));
    await step('remember notebook', () =>
      saveNotebook({kind: 'notes', file: path, date, pages: [], sentDone: [], sentSkip: [], sentLines: []}),
    );
    say(`Created ${path.replace(/^.*\//, '')}`);
    record('notes', 'pass', path);
    await showNotebook(path);
  } catch (e) {
    say(`Notes failed: ${describeError(e)}`);
    record('notes', 'fail', `${describeError(e)}${stackHint(e)}`);
  } finally {
    end();
  }
}

