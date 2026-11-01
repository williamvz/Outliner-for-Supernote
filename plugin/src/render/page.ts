import type {PageLayout} from '../core/layout';
import {computeLayout} from '../core/layout';
import spec from '../core/pageSpec.json';
import {Canvas} from './canvas';

/**
 * Draws the Today page background: header, the task rows with a "done" box
 * and a "Not today" box, and the ruled writing area. The pen-reading code
 * (src/core) uses the same layout numbers, so what is drawn here is exactly
 * where ticks and handwriting are looked for.
 */

export interface PageTask {
  name: string;
  priority: string | null;
  domain: string | null;
  recurring: boolean;
  /** Short text for the right column, e.g. "3d late" or "today". */
  due: string | null;
}

export interface PageContent {
  /** e.g. "Sun 1 Nov" */
  title: string;
  /** e.g. "33 open · +27 more" */
  subtitle: string;
  tasks: PageTask[];
}

const INK = 0;
const SOFT = 90;
const FAINT = 200;
const RULED = 175;
const GUIDE = 205;

export function drawTodayPage(content: PageContent, width = 1404, height = 1872): Canvas {
  const layout = computeLayout(width, height);
  const c = new Canvas(width, height);
  const left = layout.marginLeft;
  const right = layout.marginRight;

  header(c, layout, content);
  captions(c, layout);

  layout.rows.forEach((row, i) => {
    c.hline(left, right, row.band.bottom, 2, FAINT);
    c.strokeRect(row.checkbox.left, row.checkbox.top, row.checkbox.right, row.checkbox.bottom, 3, 70);
    skipBox(c, row.skip);

    const task = content.tasks[i];
    if (!task) {
      return;
    }
    const maxWidth = row.text.right - row.text.left;
    const lines = c.wrap('r30', task.name, maxWidth, 2);
    const lineHeight = 36;
    const blockTop = (row.band.top + row.band.bottom) / 2 - (lines.length * lineHeight) / 2;
    lines.forEach((line, n) => {
      c.text('r30', line, row.text.left, Math.round(blockTop + n * lineHeight + 27), INK);
    });

    const metaWidth = row.meta.right - row.meta.left;
    const first = [task.recurring ? '↻' : '', task.priority ?? 'P3', task.domain ?? '']
      .filter(Boolean)
      .join(' · ');
    const mid = (row.band.top + row.band.bottom) / 2;
    const place = (text: string, baseline: number, ink: number) => {
      const fitted = c.fit('r24', text, metaWidth);
      c.text('r24', fitted, row.meta.right - c.measure('r24', fitted), baseline, ink);
    };
    place(first, Math.round(task.due ? mid - 4 : mid + 8), INK);
    if (task.due) {
      place(task.due, Math.round(mid + 26), SOFT);
    }
  });

  c.hline(left, right, spec.divider.y, 4, 60);
  writingArea(c, layout);
  return c;
}

function header(c: Canvas, layout: PageLayout, content: PageContent): void {
  c.text('b44', content.title, layout.marginLeft + 12, layout.header.top + 62, INK);
  const sub = c.fit('r24', content.subtitle, layout.headerStatus.right - layout.headerStatus.left);
  c.text('r24', sub, layout.headerStatus.right - c.measure('r24', sub), layout.header.top + 62, SOFT);
  c.hline(layout.marginLeft, layout.marginRight, layout.header.bottom, 2, FAINT);
}

function captions(c: Canvas, layout: PageLayout): void {
  const top = layout.rows[0].band.top - 12;
  const row = layout.rows[0];
  const done = 'DONE';
  c.text('b20', done, (row.checkbox.left + row.checkbox.right) / 2 - c.measure('b20', done) / 2, top, SOFT);
  const skip = 'NOT TODAY';
  c.text('b20', skip, row.skip.right - c.measure('b20', skip), top, SOFT);
}

/** Empty box with a faint arrow, "push to tomorrow". */
function skipBox(c: Canvas, box: {left: number; top: number; right: number; bottom: number}): void {
  c.strokeRect(box.left, box.top, box.right, box.bottom, 3, 70);
  const midY = (box.top + box.bottom) / 2;
  const pad = 14;
  c.line(box.left + pad, midY, box.right - pad, midY, 3, FAINT);
  c.line(box.right - pad - 12, midY - 12, box.right - pad, midY, 3, FAINT);
  c.line(box.right - pad - 12, midY + 12, box.right - pad, midY, 3, FAINT);
}

function writingArea(c: Canvas, layout: PageLayout): void {
  const zone = layout.writingZone;
  const lineCount = layout.lineCount;
  for (let k = 1; k <= lineCount; k++) {
    c.hline(layout.marginLeft, layout.marginRight, zone.top + k * layout.lineSpacing, 2, RULED);
  }
  for (let n = 1; n <= 6; n++) {
    c.dottedVline(layout.marginLeft + n * layout.indentStep, zone.top + 8, zone.top + lineCount * layout.lineSpacing, GUIDE);
  }
  c.text(
    'b20',
    'NOTES     -  new item        indent  =  sub-item        [ ]  =  task',
    layout.marginLeft + 12,
    spec.divider.y - 10,
    SOFT,
  );
}
