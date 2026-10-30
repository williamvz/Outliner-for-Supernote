import {Image} from 'react-native';
import type {Element} from 'sn-plugin-lib';
import type {Rect} from '../core/geometry';
import {computeLayout} from '../core/layout';
import {setJSON} from '../storage';
import {
  createElement,
  createNote,
  currentFilePath,
  ELEMENT_TEXT,
  ensurePermission,
  FileUtils,
  insertElements,
  insertPage,
  insertText,
  jumpToPage,
  openFile,
  pageSize,
  PERMISSIONS,
  PluginManager,
  reloadFile,
  saveCurrentNote,
  totalPages,
} from '../sn';
import {todayTasks, type TaskSummary} from '../worker';
import {describeError, logEvent, record, timed} from './report';

const ROOT = '/storage/emulated/0';
export const NOTE_DIR = `${ROOT}/Note/Tana`;
export const SPIKE_NOTE = `${NOTE_DIR}/Spike.note`;
const TEMPLATE_FILE = `${ROOT}/MyStyle/tana_today.png`;
export const PAGE_STATE_KEY = 'spike.page';

export interface SpikePage {
  notePath: string;
  page: number;
  rows: Array<{row: number; taskId: string | null; name: string}>;
  statusUuid: string | null;
}

const PLACEHOLDER_TASKS: TaskSummary[] = [
  'Send budget proposal to finance',
  'Review landing page copy',
  'Book dentist appointment',
  'Ask for the Q4 numbers',
  'Plan the team offsite',
  'Renew travel insurance',
].map((name, i) => ({
  id: `placeholder-${i}`,
  name,
  priority: ['P1', 'P2', 'P3', 'P2', 'P3', 'P4'][i],
  deadline: null,
  domain: i % 2 ? 'Home' : 'Work',
  recurring: i === 2,
}));

/**
 * Toolbar "Today": adds a templated page to the spike notebook, writes tasks
 * on it, then closes the plugin view and opens the page. The button opens the
 * plugin view (showType 1) so the user sees progress; v0.1 showed that
 * toolbar buttons without a view never reach the plugin.
 */
export async function runToday(): Promise<boolean> {
  logEvent('Today: started');
  try {
    const granted =
      (await ensurePermission(PERMISSIONS.read, 'Read the Tana notebook')) &&
      (await ensurePermission(PERMISSIONS.write, 'Write tasks onto the Today page'));
    record('permissions', granted ? 'pass' : 'fail', `Today: file read+write granted: ${granted}`);
    if (!granted) {
      return false;
    }

    const open = await currentFilePath().catch(() => '');
    if (open === SPIKE_NOTE) {
      // File-level edits of the open note need its in-memory changes saved first.
      await saveCurrentNote();
      logEvent('Today: saved the open spike note first');
    }
    const template = await installTemplate();
    const {page, created} = await addTodayPage(template);
    const size = await pageSize(SPIKE_NOTE, page);
    record('device', 'info', `page ${size.width}x${size.height}, notebook page ${page}, template ${template}`);

    const tasks = await loadTasks();
    const state = await renderPage(page, size, tasks);
    await setJSON(PAGE_STATE_KEY, state);

    await PluginManager.closePluginView();
    await show(page, created, open);
    logEvent(`Today: done, showing page ${page}`);
    return true;
  } catch (e) {
    record('q2-render', 'fail', `Today: ${describeError(e)}`);
    return false;
  }
}

/** The template ships inside the plugin; the NOTE app needs it in MyStyle. */
async function installTemplate(): Promise<string> {
  const source = Image.resolveAssetSource(require('../../assets/templates/tana_today.png'));
  const dir = (await PluginManager.getPluginDirPath()) ?? '';
  const candidates = [
    source.uri.replace(/^file:\/\//, ''),
    `${dir}/drawable-mdpi/${source.uri}.png`,
    `${dir}/drawable-mdpi/assets_templates_tana_today.png`,
  ];
  for (const candidate of candidates) {
    if (await FileUtils.exists(candidate)) {
      await FileUtils.makeDir(`${ROOT}/MyStyle`);
      const copied = await FileUtils.copyFile(candidate, TEMPLATE_FILE);
      record('q1-template', 'info', `asset ${candidate} → ${TEMPLATE_FILE} copied=${copied}`);
      return TEMPLATE_FILE;
    }
  }
  throw new Error(`template asset not found; uri=${source.uri}; tried ${candidates.join(', ')}`);
}

async function addTodayPage(template: string): Promise<{page: number; created: boolean}> {
  if (!(await FileUtils.exists(SPIKE_NOTE))) {
    await FileUtils.makeDir(NOTE_DIR);
    const {ms} = await timed(() => createNote(SPIKE_NOTE, template));
    record('q1-template', 'pass', `createNote with custom template OK (${SPIKE_NOTE})`, ms);
    return {page: 0, created: true};
  }
  const page = await totalPages(SPIKE_NOTE);
  try {
    const {ms} = await timed(() => insertPage(SPIKE_NOTE, page, template));
    record('q1-template', 'pass', `insertNotePage with custom template OK (page ${page})`, ms);
  } catch (e) {
    record('q1-template', 'fail', `insertNotePage with custom template: ${describeError(e)}`);
    throw e;
  }
  return {page, created: false};
}

async function loadTasks(): Promise<TaskSummary[]> {
  try {
    const {value, ms} = await timed(todayTasks);
    record('net', 'pass', `GET /tasks returned ${value.length} tasks`, ms);
    return value.length ? value : PLACEHOLDER_TASKS;
  } catch (e) {
    record('net', 'info', `using placeholder tasks: ${describeError(e)}`);
    return PLACEHOLDER_TASKS;
  }
}

interface Box {
  rect: Rect;
  text: string;
  fontSize: number;
  bold?: boolean;
  align?: 0 | 1 | 2;
  role: 'status' | 'other';
}

async function renderPage(
  page: number,
  size: {width: number; height: number},
  tasks: TaskSummary[],
): Promise<SpikePage> {
  const layout = computeLayout(size.width, size.height);
  const shown = tasks.slice(0, layout.rows.length);
  const boxes: Box[] = [
    {rect: layout.headerDate, text: dayLabel(new Date()), fontSize: 44, bold: true, role: 'other'},
    {rect: layout.headerStatus, text: 'Spike · not synced', fontSize: 30, align: 2, role: 'status'},
  ];
  shown.forEach((task, i) => {
    const row = layout.rows[i];
    boxes.push({rect: row.text, text: task.name, fontSize: 32, role: 'other'});
    boxes.push({rect: row.meta, text: metaLabel(task), fontSize: 24, align: 2, role: 'other'});
  });

  let statusUuid: string | null = null;
  try {
    const {value: elements, ms} = await timed(async () => {
      const made: Element[] = [];
      for (const box of boxes) {
        const element = await textElement(page, box);
        if (box.role === 'status') {
          statusUuid = element.uuid;
        }
        made.push(element);
      }
      await insertElements(SPIKE_NOTE, page, made);
      return made;
    });
    record('q2-render', 'pass', `${elements.length} text boxes via insertElements before opening`, ms);
  } catch (e) {
    // Fallback: open the page first and insert into the current page.
    // insertText always targets the page on screen, so jump there first.
    record('q2-render', 'info', `insertElements failed (${describeError(e)}); trying insertText`);
    await openFile(SPIKE_NOTE, page);
    const {ms} = await timed(async () => {
      for (const box of boxes) {
        await insertText(textBoxFields(box));
      }
    });
    record('q2-render', 'pass', `${boxes.length} text boxes via insertText after opening`, ms);
  }

  return {
    notePath: SPIKE_NOTE,
    page,
    rows: shown.map((t, i) => ({row: i, taskId: t.id, name: t.name})),
    statusUuid,
  };
}

async function show(page: number, created: boolean, open: string): Promise<void> {
  if (open === SPIKE_NOTE && !created) {
    await reloadFile();
    await jumpToPage(page);
  } else {
    await openFile(SPIKE_NOTE, page);
  }
}

async function textElement(page: number, box: Box): Promise<Element> {
  const element = await createElement(ELEMENT_TEXT);
  element.pageNum = page;
  element.layerNum = 0;
  element.textBox = textBoxFields(box) as Element['textBox'];
  return element;
}

function textBoxFields(box: Box) {
  const lineHeight = Math.round(box.fontSize * 1.5);
  const midY = (box.rect.top + box.rect.bottom) / 2;
  return {
    fontSize: box.fontSize,
    fontPath: null,
    textContentFull: box.text,
    textRect: {
      left: Math.round(box.rect.left),
      top: Math.round(midY - lineHeight / 2),
      right: Math.round(box.rect.right),
      bottom: Math.round(midY + lineHeight / 2),
    },
    textDigestData: null,
    textAlign: box.align ?? 0,
    textBold: box.bold ? 1 : 0,
    textItalics: 0,
    textFrameWidthType: 0,
    textFrameStyle: 0,
    textEditable: 1,
  };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayLabel(d: Date): string {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function metaLabel(task: TaskSummary): string {
  const parts = [task.priority ?? 'P3', task.domain ?? '—'];
  if (task.deadline) {
    const days = Math.round(
      (Date.parse(task.deadline) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000,
    );
    parts.push(days === 0 ? 'today' : days < 0 ? `${days}d` : `+${days}d`);
  }
  return `${task.recurring ? '↻ ' : ''}${parts.join(' · ')}`;
}
