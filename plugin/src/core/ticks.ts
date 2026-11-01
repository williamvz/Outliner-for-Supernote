import {
  boundingBox,
  center,
  contains,
  height,
  inflate,
  width,
  type StrokeShape,
} from './geometry';
import type {PageLayout} from './layout';

export type TaskStrokeKind = 'tick' | 'strike' | 'skip' | 'writing';

export interface RowMarks {
  row: number;
  /** True when the row holds at least one tick or strike-through. */
  done: boolean;
  /** True when the "Not today" box has a mark. Done wins when both are marked. */
  skip: boolean;
  tickStrokeIds: string[];
  writingStrokeIds: string[];
}

/** Share of a stroke's points that must sit in one row for it to count. */
const ROW_SHARE = 0.6;

/**
 * Reads pen strokes in the task zone. A tick (anywhere around the checkbox) or
 * a long flat stroke across the task text means "done"; any mark in the right
 * hand box means "not today". Anything else in a row is handwriting (a new
 * task in an empty row, or an annotation).
 */
export function readTaskZone(
  strokes: StrokeShape[],
  layout: PageLayout,
): RowMarks[] {
  const marks: RowMarks[] = layout.rows.map(r => ({
    row: r.index,
    done: false,
    skip: false,
    tickStrokeIds: [],
    writingStrokeIds: [],
  }));

  for (const stroke of strokes) {
    if (stroke.points.length === 0) {
      continue;
    }
    const row = dominantRow(stroke, layout);
    if (row === null) {
      continue;
    }
    const kind = classifyStroke(stroke, layout, row);
    if (kind === 'writing') {
      marks[row].writingStrokeIds.push(stroke.id);
    } else if (kind === 'skip') {
      marks[row].skip = true;
      marks[row].tickStrokeIds.push(stroke.id);
    } else {
      marks[row].done = true;
      marks[row].tickStrokeIds.push(stroke.id);
    }
  }
  return marks;
}

function dominantRow(stroke: StrokeShape, layout: PageLayout): number | null {
  const counts = layout.rows.map(r =>
    stroke.points.reduce((n, p) => n + (contains(r.band, p) ? 1 : 0), 0),
  );
  let best = 0;
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] > counts[best]) {
      best = i;
    }
  }
  return counts[best] / stroke.points.length >= ROW_SHARE ? best : null;
}

export function classifyStroke(
  stroke: StrokeShape,
  layout: PageLayout,
  row: number,
): TaskStrokeKind {
  const r = layout.rows[row];
  const box = boundingBox(stroke.points);
  const c = center(box);
  const near = inflate(r.checkbox, width(r.checkbox) * 0.4);
  if (contains(near, c) && width(box) <= width(r.checkbox) * 2.2) {
    return 'tick';
  }
  const nearSkip = inflate(r.skip, width(r.skip) * 0.4);
  if (contains(nearSkip, c) && width(box) <= width(r.skip) * 2.2) {
    return 'skip';
  }
  const flat = height(box) <= height(r.band) * 0.5;
  const long = width(box) >= (r.text.right - r.text.left) * 0.35;
  const overText = c.x >= r.text.left && c.x <= r.meta.right;
  if (flat && long && overText) {
    return 'strike';
  }
  return 'writing';
}
