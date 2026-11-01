import {describe, expect, it} from 'vitest';
import {parseNodeMarkdown} from '../src/markdown';
import {dayFromBreadcrumb, taskFromNode, todayView, type Task} from '../src/tasks';

const TODAY = '2026-10-29';

function task(partial: Partial<Task> & {name: string}): Task {
  return {
    id: partial.name,
    priority: null,
    deadline: null,
    someday: false,
    recurring: false,
    occurrence: null,
    parentId: null,
    parentName: null,
    domain: null,
    delegated: false,
    onDayNode: null,
    ...partial,
  };
}

describe('dayFromBreadcrumb', () => {
  it.each([
    [['Home', 'Daily notes', '2026', 'Week 44', 'Today, Thu, 29 Oct'], '2026-10-29'],
    [['2026', 'Week 44', 'Tue, 27 Oct', 'Project', 'Section'], '2026-10-27'],
    [['Daily notes', '2024', 'Week 33', 'Mon, 12 Aug 2024'], '2024-08-12'],
    [['Daily notes', '2025', 'Week 01', 'Wed, 31 Dec'], '2025-12-31'],
    [['Library', 'Calendar events', 'Team sync'], null],
  ])('%j → %s', (crumbs, expected) => {
    expect(dayFromBreadcrumb(crumbs, TODAY)).toBe(expected);
  });
});

describe('taskFromNode', () => {
  it('maps fields, priority and the recurring tag', () => {
    const node = parseNodeMarkdown(
      [
        '- [ ] Wash the car #recurring_task <!-- node-id: r1 -->',
        '  - **Parent area or Project**: [House #area](tana:a1)',
        '  - **Deadline Date**: Tue, 27 Oct <!-- node-id: x -->',
        '  - **Occurrence**: In five weeks',
        '  - **Priority**: [P2 - Leverage](tana:p2)',
      ].join('\n'),
    );
    const t = taskFromNode(node, 'fallback', ['2026', 'Week 20'], TODAY, 'recurring task');
    expect(t).toMatchObject({
      id: 'r1',
      name: 'Wash the car',
      priority: 'P2',
      deadline: '2026-10-27',
      recurring: true,
      occurrence: 'In five weeks',
      parentId: 'a1',
      parentName: 'House',
      someday: false,
    });
  });
});

describe('todayView', () => {
  it('keeps due, overdue and day-node tasks, most urgent first', () => {
    const tasks = [
      task({name: 'later', priority: 'P1', deadline: '2026-11-03'}),
      task({name: 'overdue P2', priority: 'P2', deadline: '2026-10-20'}),
      task({name: 'today P2', priority: 'P2', deadline: TODAY}),
      task({name: 'today P1', priority: 'P1', deadline: TODAY}),
      task({name: 'no deadline on day node', onDayNode: TODAY}),
      task({name: 'someday', someday: true, deadline: '2026-10-01'}),
      task({name: '🤖 routine work', priority: 'P1', deadline: TODAY}),
      task({name: 'Decide: pricing', priority: 'P1', deadline: TODAY}),
    ];
    expect(todayView(tasks, TODAY).map(t => t.name)).toEqual([
      'today P1',
      'overdue P2',
      'today P2',
      'no deadline on day node',
    ]);
  });
});
