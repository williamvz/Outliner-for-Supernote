import {addDays} from './dates';

/**
 * Pure rules for what a sync does in Tana. The Durable Object does the calls.
 */

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

export interface Interval {
  count: number;
  unit: 'day' | 'week' | 'month' | 'year';
}

/** "In seven days", "In four weeks", "In one month", "in 2 years". */
export function parseOccurrence(text: string | null | undefined): Interval | null {
  const m = /^\s*in\s+(\d+|[a-z]+)\s+(day|week|month|year)s?\s*$/i.exec(text ?? '');
  if (!m) {
    return null;
  }
  const count = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
  return count > 0 ? {count, unit: m[2].toLowerCase() as Interval['unit']} : null;
}

export function addInterval(iso: string, interval: Interval): string {
  const {count, unit} = interval;
  if (unit === 'day') {
    return addDays(iso, count);
  }
  if (unit === 'week') {
    return addDays(iso, 7 * count);
  }
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (unit === 'year' ? 12 * count : count));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

/**
 * A recurring task is not checked (that would end the series). Its deadline
 * moves forward by the occurrence instead, as Tana's "Complete and
 * reschedule" does, but repeated until it lies after today so a task you
 * just finished doesn't come straight back onto today's page.
 * Null when the task has no usable deadline or occurrence.
 */
export function rescheduledDeadline(
  deadline: string | null,
  occurrence: string | null,
  today: string,
): string | null {
  const interval = parseOccurrence(occurrence);
  if (!interval || !deadline) {
    return null;
  }
  let next = deadline;
  for (let i = 0; i < 500 && next <= today; i++) {
    next = addInterval(next, interval);
  }
  return next > today ? next : null;
}

/** "Not today": the day after today, unless the task is already later than that. */
export function postponedDeadline(deadline: string | null, today: string): string | null {
  const tomorrow = addDays(today, 1);
  return deadline && deadline > tomorrow ? null : tomorrow;
}

export interface NoteLine {
  level: number;
  text: string;
  isTask?: boolean;
}

/** Tana Paste for the handwritten outline. Plain text only, one line per node. */
export function tanaPaste(lines: NoteLine[], taskTag: string): string {
  const tag = taskTag.includes(' ') ? `#[[${taskTag}]]` : `#${taskTag}`;
  return lines
    .map(l => {
      const text = l.text.replace(/\s+/g, ' ').trim();
      if (!text) {
        return null;
      }
      const indent = '  '.repeat(Math.max(0, Math.min(l.level, 6)));
      return l.isTask ? `${indent}- [ ] ${text} ${tag}` : `${indent}- ${text}`;
    })
    .filter((l): l is string => l !== null)
    .join('\n');
}
