import {computeLayout, type PageLayout} from '../core/layout';
import {Canvas} from './canvas';

/**
 * Draws the two pages the plugin makes: the Tasks page (rows with a "done"
 * box and a "Not today" box) and the Notes page (ruled lines with indent
 * guides). Both carry a SYNC box in the header: a pen tap there starts a
 * sync. The pen-reading code (src/core) uses the same layout numbers, so
 * what is drawn is exactly where ticks and handwriting are looked for.
 */

export interface PageTask {
  name: string;
  priority: string | null;
  domain: string | null;
  recurring: boolean;
  /** "Due Sat 7 Nov", or "No due date". */
  due: string;
}

export interface TasksPageContent {
  /** e.g. "Tasks" */
  title: string;
  /** e.g. "Sun 1 Nov · 22:15" */
  subtitle: string;
  tasks: PageTask[];
  /** Bottom line, e.g. "Page 2 of 9 · all priorities · 118 tasks". */
  footer: string;
}

export interface NotesPageContent {
  title: string;
  subtitle: string;
}

const INK = 0;
const SOFT = 90;
const FAINT = 200;
const RULED = 170;
const GUIDE = 110;

export function drawTasksPage(content: TasksPageContent, width = 1404, height = 1872): Canvas {
  const layout = computeLayout(width, height, 'tasks');
  const c = new Canvas(width, height);
  const left = layout.marginLeft;
  const right = layout.marginRight;

  header(c, layout, content.title, content.subtitle);
  const first = layout.rows[0];
  const captionY = first.band.top - 12;
  c.text('b20', 'DONE', (first.checkbox.left + first.checkbox.right) / 2 - c.measure('b20', 'DONE') / 2, captionY, SOFT);
  c.text('b20', 'NOT TODAY', first.skip.right - c.measure('b20', 'NOT TODAY'), captionY, SOFT);

  layout.rows.forEach((row, i) => {
    c.hline(left, right, row.band.bottom, 2, FAINT);
    c.strokeRect(row.checkbox.left, row.checkbox.top, row.checkbox.right, row.checkbox.bottom, 3, 70);
    skipBox(c, row.skip);

    const task = content.tasks[i];
    if (!task) {
      return;
    }
    const mid = (row.band.top + row.band.bottom) / 2;
    const lines = c.wrap('r30', task.name, row.text.right - row.text.left, 2);
    const lineHeight = 36;
    const blockTop = mid - (lines.length * lineHeight) / 2;
    lines.forEach((line, n) => {
      c.text('r30', line, row.text.left, Math.round(blockTop + n * lineHeight + 27), INK);
    });

    const metaWidth = row.meta.right - row.meta.left;
    const place = (text: string, baseline: number, ink: number) => {
      const fitted = c.fit('r24', text, metaWidth);
      c.text('r24', fitted, row.meta.right - c.measure('r24', fitted), baseline, ink);
    };
    const first = [task.priority ?? 'P3', task.domain ?? '', task.recurring ? 'repeats' : '']
      .filter(Boolean)
      .join(' · ');
    place(first, Math.round(mid - 4), INK);
    place(task.due, Math.round(mid + 26), SOFT);
  });

  c.text('r24', content.footer, left + 12, layout.footerBaseline, SOFT);
  return c;
}

export function drawNotesPage(content: NotesPageContent, width = 1404, height = 1872): Canvas {
  const layout = computeLayout(width, height, 'notes');
  const c = new Canvas(width, height);
  header(c, layout, content.title, content.subtitle);

  const zone = layout.writingZone;
  const bottom = zone.top + layout.lineCount * layout.lineSpacing;
  for (let k = 1; k <= layout.lineCount; k++) {
    c.hline(layout.marginLeft, layout.marginRight, zone.top + k * layout.lineSpacing, 2, RULED);
  }
  // indent guides: solid, so the levels are easy to see and to aim for
  for (let n = 1; n <= 6; n++) {
    const x = layout.marginLeft + n * layout.indentStep;
    c.vline(x, zone.top + 4, bottom, 2, GUIDE);
    const label = String(n);
    c.text('b20', label, x + 6, zone.top + 24, SOFT);
  }
  return c;
}

function header(c: Canvas, layout: PageLayout, title: string, subtitle: string): void {
  c.text('b44', title, layout.marginLeft + 12, layout.header.top + 54, INK);
  c.text('r24', c.fit('r24', subtitle, layout.syncBox.left - layout.marginLeft - 40), layout.marginLeft + 12, layout.header.top + 96, SOFT);

  const box = layout.syncBox;
  c.strokeRect(box.left, box.top, box.right, box.bottom, 4, 40);
  const label = 'SYNC';
  c.text('b44', label, (box.left + box.right) / 2 - c.measure('b44', label) / 2, (box.top + box.bottom) / 2 + 15, INK);
  c.hline(layout.marginLeft, layout.marginRight, layout.header.bottom, 2, FAINT);
}

/** Empty box with a faint arrow: "push to tomorrow". */
function skipBox(c: Canvas, box: {left: number; top: number; right: number; bottom: number}): void {
  c.strokeRect(box.left, box.top, box.right, box.bottom, 3, 70);
  const midY = (box.top + box.bottom) / 2;
  const pad = 14;
  c.line(box.left + pad, midY, box.right - pad, midY, 3, FAINT);
  c.line(box.right - pad - 12, midY - 12, box.right - pad, midY, 3, FAINT);
  c.line(box.right - pad - 12, midY + 12, box.right - pad, midY, 3, FAINT);
}
