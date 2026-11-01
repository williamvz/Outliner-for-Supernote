import {describe, expect, it} from 'vitest';
import {
  addInterval,
  parseOccurrence,
  postponedDeadline,
  rescheduledDeadline,
  tanaPaste,
} from '../src/actions';
import {compareTasks, openTasks, todayView, type Task} from '../src/tasks';

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

describe('parseOccurrence', () => {
  it.each([
    ['In seven days', {count: 7, unit: 'day'}],
    ['In four weeks', {count: 4, unit: 'week'}],
    ['In one month', {count: 1, unit: 'month'}],
    ['in 2 years', {count: 2, unit: 'year'}],
    ['In a week', {count: 1, unit: 'week'}],
  ])('%s', (text, expected) => {
    expect(parseOccurrence(text)).toEqual(expected);
  });

  it.each(['Every week', '', null, 'In 0 days', 'soon'])('rejects %s', text => {
    expect(parseOccurrence(text as string | null)).toBeNull();
  });
});

describe('addInterval', () => {
  it('clamps to the end of a shorter month', () => {
    expect(addInterval('2026-01-31', {count: 1, unit: 'month'})).toBe('2026-02-28');
    expect(addInterval('2024-01-31', {count: 1, unit: 'month'})).toBe('2024-02-29');
  });
  it('adds years and weeks', () => {
    expect(addInterval('2026-10-29', {count: 1, unit: 'year'})).toBe('2027-10-29');
    expect(addInterval('2026-10-29', {count: 2, unit: 'week'})).toBe('2026-11-12');
  });
});

describe('rescheduledDeadline', () => {
  it('moves forward until after today', () => {
    expect(rescheduledDeadline('2026-10-29', 'In one week', TODAY)).toBe('2026-11-05');
    expect(rescheduledDeadline('2026-09-01', 'In one week', TODAY)).toBe('2026-11-03');
  });
  it('needs both a deadline and a usable occurrence', () => {
    expect(rescheduledDeadline(null, 'In one week', TODAY)).toBeNull();
    expect(rescheduledDeadline('2026-10-29', 'Every week', TODAY)).toBeNull();
  });
});

describe('postponedDeadline', () => {
  it('is tomorrow for a task due today, overdue, or without a deadline', () => {
    expect(postponedDeadline('2026-10-29', TODAY)).toBe('2026-10-30');
    expect(postponedDeadline('2026-10-01', TODAY)).toBe('2026-10-30');
    expect(postponedDeadline(null, TODAY)).toBe('2026-10-30');
  });
  it('leaves a later deadline alone', () => {
    expect(postponedDeadline('2026-11-02', TODAY)).toBeNull();
  });
  it('moves a deadline of tomorrow to tomorrow (a no-op write)', () => {
    expect(postponedDeadline('2026-10-30', TODAY)).toBe('2026-10-30');
  });
});

describe('tanaPaste', () => {
  it('indents by level, marks tasks and drops blank lines', () => {
    const out = tanaPaste(
      [
        {level: 0, text: 'Ideas'},
        {level: 1, text: '  call  Sam '},
        {level: 1, text: 'send budget', isTask: true},
        {level: 0, text: '   '},
      ],
      'task',
    );
    expect(out).toBe('- Ideas\n  - call Sam\n  - [ ] send budget #task');
  });
  it('wraps multi-word tags', () => {
    expect(tanaPaste([{level: 0, text: 'x', isTask: true}], 'my task')).toBe('- [ ] x #[[my task]]');
  });
});

describe('task order', () => {
  const names = (list: Task[]) => list.map(t => t.name);

  it('puts every P1 before every P2, and so on, whatever the dates', () => {
    const list = [
      task({name: 'p3 old', priority: 'P3', deadline: '2026-01-01'}),
      task({name: 'p1 new', priority: 'P1', deadline: '2026-12-31'}),
      task({name: 'p4 old', priority: 'P4', deadline: '2026-01-01'}),
      task({name: 'p2 old', priority: 'P2', deadline: '2026-01-01'}),
    ];
    expect(names(list.sort(compareTasks))).toEqual(['p1 new', 'p2 old', 'p3 old', 'p4 old']);
  });

  it('inside a priority, the oldest deadline is first and no deadline is last', () => {
    const list = [
      task({name: 'none', priority: 'P2'}),
      task({name: 'newer', priority: 'P2', deadline: '2026-10-20'}),
      task({name: 'older', priority: 'P2', deadline: '2026-10-01'}),
    ];
    expect(names(list.sort(compareTasks))).toEqual(['older', 'newer', 'none']);
  });

  it('counts a task without a priority as P3', () => {
    const list = [task({name: 'plain'}), task({name: 'p2', priority: 'P2'}), task({name: 'p4', priority: 'P4'})];
    expect(names(list.sort(compareTasks))).toEqual(['p2', 'plain', 'p4']);
  });

  it('breaks ties by name', () => {
    const a = task({name: 'b', priority: 'P3', deadline: '2026-10-29'});
    const b = task({name: 'a', priority: 'P3', deadline: '2026-10-29'});
    expect(names([a, b].sort(compareTasks))).toEqual(['a', 'b']);
  });
});

describe('todayView', () => {
  it('drops postponed and excluded tasks and keeps the order', () => {
    const list = todayView(
      [
        task({name: 'p3 today', priority: 'P3', deadline: TODAY}),
        task({name: 'p1 today', priority: 'P1', deadline: TODAY}),
        task({name: 'p4 late', priority: 'P4', deadline: '2026-10-12'}),
        task({name: 'postponed', priority: 'P1', deadline: '2026-10-30'}),
        task({name: '🤖 routine work', priority: 'P1', deadline: TODAY}),
      ],
      TODAY,
    ).map(t => t.name);
    expect(list).toEqual(['p1 today', 'p3 today', 'p4 late']);
  });
});

describe('openTasks', () => {
  const all = [
    task({name: 'a', priority: 'P1', domain: 'Work'}),
    task({name: 'b', priority: 'P2', domain: 'Home'}),
    task({name: 'c', priority: 'P3'}),
    task({name: '🤖 d', priority: 'P1', domain: 'Work'}),
    task({name: 'Decide: e', priority: 'P1', domain: 'Work'}),
  ];
  it('lists every open task but routine and Decide: items', () => {
    expect(openTasks(all, {priorities: [], domains: []}).map(t => t.name)).toEqual(['a', 'b', 'c']);
  });
  it('filters by priority and by domain', () => {
    expect(openTasks(all, {priorities: ['P1', 'P3'], domains: []}).map(t => t.name)).toEqual(['a', 'c']);
    expect(openTasks(all, {priorities: [], domains: ['Home']}).map(t => t.name)).toEqual(['b']);
    expect(openTasks(all, {priorities: [], domains: ['Unsorted']}).map(t => t.name)).toEqual(['c']);
  });
});
