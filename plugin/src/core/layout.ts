import spec from './layout.json';
import type {Rect} from './geometry';

/**
 * Zones of the Today page, scaled from the 1404x1872 base design (Nomad) to
 * the real page size reported by getPageSize. The same numbers drive the
 * background template image (tools/make_template.py), so rows and ruled lines
 * on paper line up with what the plugin reads.
 */
export interface PageLayout {
  width: number;
  height: number;
  marginLeft: number;
  marginRight: number;
  header: Rect;
  headerDate: Rect;
  headerStatus: Rect;
  taskZone: Rect;
  rows: TaskRow[];
  writingZone: Rect;
  lineSpacing: number;
  lineCount: number;
  indentStep: number;
  markColumn: {left: number; right: number};
}

export interface TaskRow {
  index: number;
  band: Rect;
  checkbox: Rect;
  text: Rect;
  meta: Rect;
}

export const BASE_WIDTH = spec.base.width;
export const BASE_HEIGHT = spec.base.height;

export function computeLayout(
  width: number = BASE_WIDTH,
  height: number = BASE_HEIGHT,
): PageLayout {
  const sx = width / BASE_WIDTH;
  const sy = height / BASE_HEIGHT;
  const rect = (l: number, t: number, r: number, b: number): Rect => ({
    left: l * sx,
    top: t * sy,
    right: r * sx,
    bottom: b * sy,
  });

  const {margin, header, tasks, writing} = spec;
  const contentRight = BASE_WIDTH - margin.right;

  const rows: TaskRow[] = [];
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
      text: rect(tasks.textLeft, top + 8, tasks.textRight, bottom - 8),
      meta: rect(tasks.metaLeft, top + 8, tasks.metaRight, bottom - 8),
    });
  }

  const writingBottom = writing.top + writing.lines * writing.lineSpacing;

  return {
    width,
    height,
    marginLeft: margin.left * sx,
    marginRight: contentRight * sx,
    header: rect(margin.left, header.top, contentRight, header.bottom),
    headerDate: rect(margin.left, header.top, header.split - 8, header.bottom),
    headerStatus: rect(header.split, header.top, contentRight, header.bottom),
    taskZone: rect(
      margin.left,
      tasks.top,
      contentRight,
      tasks.top + tasks.rows * tasks.rowHeight,
    ),
    rows,
    writingZone: rect(margin.left, writing.top, writing.markRight, writingBottom),
    lineSpacing: writing.lineSpacing * sy,
    lineCount: writing.lines,
    indentStep: writing.indentStep * sx,
    markColumn: {left: writing.markLeft * sx, right: writing.markRight * sx},
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
