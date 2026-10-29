import {buildOutline, type RecognizedLine} from '../outline';

const line = (
  slot: number,
  level: number,
  text: string,
  marker: RecognizedLine['marker'] = null,
): RecognizedLine => ({slot, level, text, marker});

describe('buildOutline', () => {
  it('nests dashed lines by indent and keeps parents', () => {
    const nodes = buildOutline(
      [
        line(0, 0, 'Q4 planning'),
        line(1, 1, 'hire a second designer', 'dash'),
        line(2, 2, 'check the budget', 'dash'),
        line(3, 1, 'office move', 'dash'),
      ],
      'p1',
    );
    expect(nodes.map(n => [n.text, n.level, n.parentKey])).toEqual([
      ['Q4 planning', 0, null],
      ['hire a second designer', 1, 'p1:0'],
      ['check the budget', 2, 'p1:1'],
      ['office move', 1, 'p1:0'],
    ]);
  });

  it('joins an unmarked line under a line at the same level', () => {
    const nodes = buildOutline(
      [line(0, 0, 'a long thought that', 'dash'), line(1, 0, 'wraps onto the next line')],
      'p',
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0].text).toBe('a long thought that wraps onto the next line');
    expect(nodes[0].slots).toEqual([0, 1]);
  });

  it('starts a new node after a blank ruled line', () => {
    const nodes = buildOutline([line(0, 0, 'first'), line(2, 0, 'second')], 'p');
    expect(nodes.map(n => n.text)).toEqual(['first', 'second']);
  });

  it('turns a box into a task and folds markers the recognizer returned as text', () => {
    const nodes = buildOutline(
      [line(0, 0, '☐ call the plumber'), line(1, 0, '- buy milk'), line(2, 0, '[ ] pay bill', 'box')],
      'p',
    );
    expect(nodes.map(n => [n.text, n.isTask])).toEqual([
      ['call the plumber', true],
      ['buy milk', false],
      ['pay bill', true],
    ]);
  });

  it('drops lines the recognizer returned empty', () => {
    expect(buildOutline([line(0, 0, '  ')], 'p')).toEqual([]);
  });
});
