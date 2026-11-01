/* eslint-disable no-bitwise, curly */
import type {Point, StrokeShape} from '../geometry';

let counter = 0;
const nextId = () => `s${++counter}`;

export function segment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  n = 12,
): StrokeShape {
  const points: Point[] = [];
  for (let i = 0; i <= n; i++) {
    points.push({x: x1 + ((x2 - x1) * i) / n, y: y1 + ((y2 - y1) * i) / n});
  }
  return {id: nextId(), points};
}

/** A check mark whose left end starts at (x, y). */
export function tick(x: number, y: number, size = 40): StrokeShape {
  const down = segment(x, y, x + size * 0.35, y + size * 0.45, 6).points;
  const up = segment(x + size * 0.35, y + size * 0.45, x + size, y - size * 0.5, 8)
    .points;
  return {id: nextId(), points: [...down, ...up.slice(1)]};
}

/** A closed square drawn in one stroke, top-left at (x, y). */
export function square(x: number, y: number, size = 50): StrokeShape {
  const corners = [
    {x, y},
    {x: x + size, y},
    {x: x + size, y: y + size},
    {x, y: y + size},
    {x: x + 2, y: y + 2},
  ];
  const points: Point[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    points.push(
      ...segment(corners[i].x, corners[i].y, corners[i + 1].x, corners[i + 1].y, 5)
        .points,
    );
  }
  return {id: nextId(), points};
}

/** A handwritten-looking word: a zigzag of the given width around baseline y. */
export function word(x: number, baseline: number, w = 120, h = 40): StrokeShape {
  const points: Point[] = [];
  const steps = Math.max(6, Math.round(w / 10));
  for (let i = 0; i <= steps; i++) {
    points.push({x: x + (w * i) / steps, y: baseline - (i % 2 ? h : h * 0.2)});
  }
  return {id: nextId(), points};
}
