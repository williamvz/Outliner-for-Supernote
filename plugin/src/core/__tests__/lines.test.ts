import {computeLayout} from '../layout';
import {indentLevel, readWritingZone} from '../lines';
import {segment, square, word} from '../__fixtures__/strokes';

const layout = computeLayout();
const baseline = (slot: number) =>
  layout.writingZone.top + (slot + 1) * layout.lineSpacing - 12;
const guide = (n: number) => layout.marginLeft + n * layout.indentStep;

function dash(x: number, slot: number) {
  const y = baseline(slot) - 22;
  return segment(x, y, x + 36, y + 2, 6);
}

describe('indentLevel', () => {
  it('snaps writing that starts just right of a guide to that guide', () => {
    expect(indentLevel(guide(0) + 4, layout)).toBe(0);
    expect(indentLevel(guide(1) + 50, layout)).toBe(1);
    expect(indentLevel(guide(2) - 15, layout)).toBe(2);
  });
});

describe('readWritingZone', () => {
  it('groups strokes per ruled line with markers and levels', () => {
    const strokes = [
      // slot 0: "Q4 planning" (no marker, level 0)
      word(guide(0) + 6, baseline(0), 60),
      word(guide(0) + 90, baseline(0), 160),
      // slot 1: "– hire designer" at level 1
      dash(guide(1) + 6, 1),
      word(guide(1) + 60, baseline(1), 120),
      word(guide(1) + 200, baseline(1), 140),
      // slot 2: "– budget" at level 2
      dash(guide(2) + 6, 2),
      word(guide(2) + 60, baseline(2), 120),
      // slot 4: box task at level 0
      square(guide(0) + 6, baseline(4) - 50, 46),
      word(guide(0) + 80, baseline(4), 150),
    ];
    const lines = readWritingZone(strokes, layout);
    expect(lines.map(l => l.slot)).toEqual([0, 1, 2, 4]);
    expect(lines.map(l => l.marker)).toEqual([null, 'dash', 'dash', 'box']);
    expect(lines.map(l => l.level)).toEqual([0, 1, 2, 0]);
    expect(lines[1].markerStrokeIds).toHaveLength(1);
    expect(lines[1].strokeIds).toHaveLength(2);
  });

  it('never jumps more than one level deeper than the line above', () => {
    const lines = readWritingZone(
      [word(guide(3) + 10, baseline(0), 120), word(guide(3) + 10, baseline(1), 120)],
      layout,
    );
    expect(lines.map(l => l.level)).toEqual([0, 1]);
  });

  it('recognises a box drawn as four separate sides', () => {
    const x = guide(0) + 8;
    const top = baseline(3) - 48;
    const sides = [
      segment(x, top, x + 44, top, 4),
      segment(x + 44, top, x + 44, top + 44, 4),
      segment(x + 44, top + 44, x, top + 44, 4),
      segment(x, top + 44, x, top, 4),
    ];
    const lines = readWritingZone([...sides, word(x + 80, baseline(3), 160)], layout);
    expect(lines[0].marker).toBe('box');
    expect(lines[0].markerStrokeIds).toHaveLength(4);
  });

  it('skips ink in the sync-mark column and outside the zone', () => {
    const lines = readWritingZone(
      [word(layout.markColumn.left + 5, baseline(0), 30), word(guide(0), layout.taskZone.top + 40)],
      layout,
    );
    expect(lines).toEqual([]);
  });
});
