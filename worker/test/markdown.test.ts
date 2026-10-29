import {describe, expect, it} from 'vitest';
import {parseNodeMarkdown} from '../src/markdown';

describe('parseNodeMarkdown', () => {
  it('reads a recurring task with fields and references', () => {
    const md = [
      '- [ ] Wash the car #recurring_task <!-- node-id: EFloR4obMX -->',
      '  - **Parent area or Project**: [House #area](tana:h0-6Ndbirv)',
      '  - **Deadline Date**: Tomorrow <!-- node-id: hhVkV6rlfdZ3 -->',
      '  - **Occurrence**: In five weeks  <!-- node-id: TOyrTm6uLm -->',
      '  - **Priority**: [P3 - Neutral](tana:TJCqLaS47z)',
      '  - **Task Status**: [Not Started](tana:BI-juwbjiQx7)',
      '',
    ].join('\n');
    const node = parseNodeMarkdown(md);
    expect(node.id).toBe('EFloR4obMX');
    expect(node.name).toBe('Wash the car');
    expect(node.checked).toBe(false);
    expect(node.tags).toEqual(['recurring task']);
    expect(node.fields['Parent area or Project']).toEqual({
      text: 'House',
      refs: [{name: 'House', id: 'h0-6Ndbirv'}],
    });
    expect(node.fields['Deadline Date'].text).toBe('Tomorrow');
    expect(node.fields['Occurrence'].text).toBe('In five weeks');
    expect(node.fields['Priority'].refs[0].name).toBe('P3 - Neutral');
  });

  it('reads a plain tagged node without a checkbox', () => {
    const node = parseNodeMarkdown(
      '- House #area <!-- node-id: h0-6Ndbirv -->\n  - **Domain**: [Home #domain](tana:71S1Ev-cmj)\n',
    );
    expect(node.checked).toBeNull();
    expect(node.name).toBe('House');
    expect(node.fields['Domain'].refs).toEqual([{name: 'Home', id: '71S1Ev-cmj'}]);
  });

  it('keeps a hash inside the name and reads checked boxes', () => {
    const node = parseNodeMarkdown('- [x] Fix issue #42 in the build #task <!-- node-id: n1 -->');
    expect(node.checked).toBe(true);
    expect(node.name).toBe('Fix issue #42 in the build');
    expect(node.tags).toEqual(['task']);
  });
});
