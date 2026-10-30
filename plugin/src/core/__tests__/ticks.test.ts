import {computeLayout} from '../layout';
import {readTaskZone} from '../ticks';
import {segment, tick, word} from '../__fixtures__/strokes';

const layout = computeLayout();
const row = (i: number) => layout.rows[i];
const midY = (i: number) => (row(i).band.top + row(i).band.bottom) / 2;

describe('readTaskZone', () => {
  it('treats a check mark in the box as done', () => {
    const marks = readTaskZone([tick(row(1).checkbox.left + 8, midY(1))], layout);
    expect(marks[1].done).toBe(true);
    expect(marks.filter(m => m.done)).toHaveLength(1);
  });

  it('treats a line through the task text as done', () => {
    const strike = segment(row(2).text.left + 10, midY(2) + 4, row(2).text.left + 520, midY(2) - 6);
    const marks = readTaskZone([strike], layout);
    expect(marks[2].done).toBe(true);
    expect(marks[2].tickStrokeIds).toEqual([strike.id]);
  });

  it('keeps handwriting in a row apart from ticks', () => {
    const w1 = word(row(4).text.left + 20, midY(4) + 20, 140);
    const w2 = word(row(4).text.left + 190, midY(4) + 20, 100);
    const marks = readTaskZone([w1, w2], layout);
    expect(marks[4].done).toBe(false);
    expect(marks[4].writingStrokeIds).toEqual([w1.id, w2.id]);
  });

  it('ignores a stroke that spans several rows', () => {
    const tall = segment(row(0).text.left + 50, row(0).band.top + 10, row(0).text.left + 60, row(3).band.bottom - 10);
    const marks = readTaskZone([tall], layout);
    expect(marks.every(m => !m.done && m.writingStrokeIds.length === 0)).toBe(true);
  });

  it('ignores ink outside the task zone', () => {
    const below = word(layout.marginLeft + 40, layout.writingZone.top + 60);
    expect(readTaskZone([below], layout).some(m => m.done)).toBe(false);
  });
});
