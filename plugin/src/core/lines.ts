import {
  boundingBox,
  distance,
  height,
  median,
  union,
  width,
  type Rect,
  type StrokeShape,
} from './geometry';
import {BASE_HEIGHT, type PageLayout} from './layout';
import spec from './pageSpec.json';

export type LineMarker = 'dash' | 'box' | null;

export interface WritingLine {
  /** Ruled-line slot, 0 = first line under the divider. */
  slot: number;
  /** Outline depth after normalisation (never more than previous + 1). */
  level: number;
  marker: LineMarker;
  markerStrokeIds: string[];
  /** Strokes holding the line's words, left to right, marker excluded. */
  strokeIds: string[];
  bbox: Rect;
}

export const MAX_LEVEL = spec.writing.indentGuides;

interface Measured {
  stroke: StrokeShape;
  box: Rect;
}

/**
 * Groups strokes in the writing zone into ruled lines, reads the indent level
 * from where each line starts, and spots a leading dash or box.
 */
export function readWritingZone(
  strokes: StrokeShape[],
  layout: PageLayout,
): WritingLine[] {
  const zone = layout.writingZone;
  const bySlot = new Map<number, Measured[]>();

  for (const stroke of strokes) {
    if (stroke.points.length === 0) {
      continue;
    }
    const box = boundingBox(stroke.points);
    const midY = median(stroke.points.map(p => p.y));
    if (midY < zone.top || midY >= zone.bottom) {
      continue;
    }
    if (box.left >= layout.markColumn.left) {
      continue;
    }
    const slot = Math.min(
      layout.lineCount - 1,
      Math.floor((midY - zone.top) / layout.lineSpacing),
    );
    const list = bySlot.get(slot) ?? [];
    list.push({stroke, box});
    bySlot.set(slot, list);
  }

  const lines: WritingLine[] = [];
  let previousLevel = -1;
  for (const slot of [...bySlot.keys()].sort((a, b) => a - b)) {
    const items = bySlot.get(slot)!.sort((a, b) => a.box.left - b.box.left);
    const {marker, count} = detectMarker(items, layout);
    const rawLevel = indentLevel(items[0].box.left, layout);
    const level = Math.min(rawLevel, previousLevel + 1);
    previousLevel = level;
    lines.push({
      slot,
      level,
      marker,
      markerStrokeIds: items.slice(0, count).map(m => m.stroke.id),
      strokeIds: items.slice(count).map(m => m.stroke.id),
      bbox: items.map(m => m.box).reduce(union),
    });
  }
  return lines;
}

/**
 * Indent guides sit at marginLeft + n * indentStep. Writing that starts up to
 * three quarters of a step right of guide n still counts as level n, because
 * people start writing just after a guide, not on it.
 */
export function indentLevel(x: number, layout: PageLayout): number {
  const raw = Math.floor(
    (x - layout.marginLeft + 0.25 * layout.indentStep) / layout.indentStep,
  );
  return Math.max(0, Math.min(MAX_LEVEL, raw));
}

function detectMarker(
  items: Measured[],
  layout: PageLayout,
): {marker: LineMarker; count: number} {
  if (items.length < 2) {
    return {marker: null, count: 0};
  }
  const s = layout.height / BASE_HEIGHT;
  const gapAfter = (box: Rect, next: Measured | undefined) =>
    next ? next.box.left - box.right : Infinity;

  const first = items[0];
  const w = width(first.box);
  const h = height(first.box);
  if (
    w >= 10 * s &&
    w <= 110 * s &&
    h <= Math.max(22 * s, 0.4 * w) &&
    gapAfter(first.box, items[1]) >= 8 * s
  ) {
    return {marker: 'dash', count: 1};
  }

  if (isBoxShape(first.box, s) && isClosed(first.stroke) && items.length > 1) {
    if (gapAfter(first.box, items[1]) >= 6 * s) {
      return {marker: 'box', count: 1};
    }
  }

  // A box drawn as 2-4 separate sides.
  for (let k = 2; k <= Math.min(4, items.length - 1); k++) {
    const parts = items.slice(0, k);
    const hull = parts.map(p => p.box).reduce(union);
    const allSides = parts.every(
      p =>
        width(p.box) <= width(hull) * 0.3 || height(p.box) <= height(hull) * 0.3,
    );
    if (
      isBoxShape(hull, s) &&
      allSides &&
      gapAfter(hull, items[k]) >= 6 * s
    ) {
      return {marker: 'box', count: k};
    }
  }
  return {marker: null, count: 0};
}

function isBoxShape(box: Rect, s: number): boolean {
  const w = width(box);
  const h = height(box);
  const aspect = w / Math.max(h, 1);
  return (
    w >= 22 * s && w <= 110 * s && h >= 22 * s && h <= 110 * s &&
    aspect >= 0.55 && aspect <= 1.8
  );
}

function isClosed(stroke: StrokeShape): boolean {
  const pts = stroke.points;
  const box = boundingBox(pts);
  const span = Math.max(width(box), height(box));
  return distance(pts[0], pts[pts.length - 1]) <= 0.35 * span;
}
