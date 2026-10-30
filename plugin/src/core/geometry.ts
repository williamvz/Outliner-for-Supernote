export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const width = (r: Rect) => r.right - r.left;
export const height = (r: Rect) => r.bottom - r.top;

export function boundingBox(points: Point[]): Rect {
  if (points.length === 0) {
    throw new Error('boundingBox of empty point list');
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  return {left, top, right, bottom};
}

export function union(a: Rect, b: Rect): Rect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

export function inflate(r: Rect, by: number): Rect {
  return {
    left: r.left - by,
    top: r.top - by,
    right: r.right + by,
    bottom: r.bottom + by,
  };
}

export function center(r: Rect): Point {
  return {x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2};
}

export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error('median of empty list');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A pen stroke reduced to what page analysis needs. */
export interface StrokeShape {
  id: string;
  points: Point[];
}
