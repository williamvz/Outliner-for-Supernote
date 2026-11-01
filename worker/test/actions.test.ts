import {describe, expect, it} from 'vitest';
import {
  addInterval,
  parseOccurrence,
  postponedDeadline,
  rescheduledDeadline,
  tanaPaste,
} from '../src/actions';
import {compareTasks, todayView, urgency, type Task} from '../src/tasks';

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

describe('urgency', () => {
  it('ranks priority first, then lateness', () => {
    const p1 = task({name: 'a', priority: 'P1', deadline: TODAY});
    const p2 = task({name: 'b', priority: 'P2', deadline: TODAY});
    expect(urgency(p1, TODAY)).toBe(125);
    expect(urgency(p2, TODAY)).toBe(95);
  });

  it('lets an old low-priority task climb past a fresh higher one', () => {
    const oldP4 = task({name: 'old', priority: 'P4', deadline: '2026-10-10'});
    const freshP3 = task({name: 'fresh', priority: 'P3', deadline: TODAY});
    expect(urgency(oldP4, TODAY)).toBeGreaterThan(urgency(freshP3, TODAY));
  });

  it('stops growing after two weeks of lateness', () => {
    const a = task({name: 'a', priority: 'P3', deadline: '2026-10-01'});
    const b = task({name: 'b', priority: 'P3', deadline: '2026-06-01'});
    expect(urgency(a, TODAY)).toBe(urgency(b, TODAY));
  });

  it('puts a later deadline below due-today at equal priority', () => {
    const later = task({name: 'later', priority: 'P2', deadline: '2026-11-01', onDayNode: TODAY});
    const due = task({name: 'due', priority: 'P2', deadline: TODAY});
    expect(urgency(later, TODAY)).toBeLessThan(urgency(due, TODAY));
  });
});

describe('todayView order', () => {
  it('sorts by urgency and drops postponed and excluded tasks', () => {
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
    expect(list).toEqual(['p1 today', 'p4 late', 'p3 today']);
  });

  it('breaks ties by older deadline, then name', () => {
    const a = task({name: 'b', priority: 'P3', deadline: '2026-10-29'});
    const b = task({name: 'a', priority: 'P3', deadline: '2026-10-29'});
    expect([a, b].sort((x, y) => compareTasks(x, y, TODAY)).map(t => t.name)).toEqual(['a', 'b']);
  });
});
