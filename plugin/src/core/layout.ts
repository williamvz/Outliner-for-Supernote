import spec from './pageSpec.json';
import type {Rect} from './geometry';

/**
 * Zones of the Today page, scaled from the 1404x1872 base design (Nomad) to
 * the real page size reported by getPageSize. The same numbers drive the
 * background template image (tools/make_template.py), so rows and ruled lines
 * on paper line up with what the plugin reads.
 */
export type PageKind = 'tasks' | 'notes';

export interface PageLayout {
  kind: PageKind;
  width: number;
  height: number;
  marginLeft: number;
  marginRight: number;
  header: Rect;
  /** The SYNC box in the header: a pen tap there starts a sync. */
  syncBox: Rect;
  taskZone: Rect;
  rows: TaskRow[];
  writingZone: Rect;
  lineSpacing: number;
  lineCount: number;
  indentStep: number;
  markColumn: {left: number; right: number};
  footerBaseline: number;
}

export interface TaskRow {
  index: number;
  band: Rect;
  checkbox: Rect;
  /** The "Not today" box at the right edge of the row. */
  skip: Rect;
  text: Rect;
  meta: Rect;
}

export const BASE_WIDTH = spec.base.width;
export const BASE_HEIGHT = spec.base.height;

/**
 * The Tasks page (rows with a done box and a "Not today" box) and the Notes
 * page (ruled lines with indent guides), scaled from the 1404x1872 Nomad page.
 */
export function computeLayout(
  width: number = BASE_WIDTH,
  height: number = BASE_HEIGHT,
  kind: PageKind = 'tasks',
): PageLayout {
  const sx = width / BASE_WIDTH;
  const sy = height / BASE_HEIGHT;
  const rect = (l: number, t: number, r: number, b: number): Rect => ({
    left: l * sx,
    top: t * sy,
    right: r * sx,
    bottom: b * sy,
  });

  const {margin, header, tasks, notes, sync} = spec;
  const contentRight = BASE_WIDTH - margin.right;

  const rows: TaskRow[] = [];
  if (kind === 'tasks') {
    for (let i = 0; i < tasks.rows; i++) {
      const top = tasks.top + i * tasks.rowHeight;
      const bottom = top + tasks.rowHeight;
      const boxTop = top + (tasks.rowHeight - tasks.checkboxSize) / 2;
      rows.push({
        index: i,
        band: rect(margin.left, top, contentRight, bottom),
        checkbox: rect(
          tasks.checkboxLeft,
          boxTop,
          tasks.checkboxLeft + tasks.checkboxSize,
          boxTop + tasks.checkboxSize,
        ),
        skip: rect(
          tasks.skipLeft,
          boxTop,
          tasks.skipLeft + tasks.skipSize,
          boxTop + tasks.skipSize,
        ),
        text: rect(tasks.textLeft, top + 8, tasks.textRight, bottom - 8),
        meta: rect(tasks.metaLeft, top + 8, tasks.metaRight, bottom - 8),
      });
    }
  }

  const writingBottom = notes.top + notes.lines * notes.lineSpacing;
  const taskBottom = tasks.top + tasks.rows * tasks.rowHeight;

  return {
    kind,
    width,
    height,
    marginLeft: margin.left * sx,
    marginRight: contentRight * sx,
    header: rect(margin.left, header.top, contentRight, header.bottom),
    syncBox: rect(sync.left, sync.top, sync.right, sync.bottom),
    taskZone: kind === 'tasks' ? rect(margin.left, tasks.top, contentRight, taskBottom) : rect(0, 0, 0, 0),
    rows,
    writingZone:
      kind === 'notes' ? rect(margin.left, notes.top, notes.markRight, writingBottom) : rect(0, 0, 0, 0),
    lineSpacing: notes.lineSpacing * sy,
    lineCount: notes.lines,
    indentStep: notes.indentStep * sx,
    markColumn: {left: notes.markLeft * sx, right: notes.markRight * sx},
    footerBaseline: tasks.footerBaseline * sy,
  };
}

/** Ruled-line slot k covers the band whose bottom edge is the k-th ruled line. */
export function writingSlot(layout: PageLayout, k: number): Rect {
  const top = layout.writingZone.top + k * layout.lineSpacing;
  return {
    left: layout.writingZone.left,
    top,
    right: layout.writingZone.right,
    bottom: top + layout.lineSpacing,
  };
}
