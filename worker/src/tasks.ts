import {daysBetween, parseTanaDate} from './dates';
import type {ParsedNode} from './markdown';

export type Priority = 'P1' | 'P2' | 'P3' | 'P4';

export interface Task {
  id: string;
  name: string;
  priority: Priority | null;
  deadline: string | null;
  someday: boolean;
  recurring: boolean;
  occurrence: string | null;
  parentId: string | null;
  parentName: string | null;
  domain: string | null;
  delegated: boolean;
  onDayNode: string | null;
}

/** Field names as they appear in read_node output. */
export const FIELDS = {
  priority: 'Priority',
  deadline: 'Deadline Date',
  someday: 'Someday',
  parent: 'Parent area or Project',
  occurrence: 'Occurrence',
  delegated: 'Delegated to',
  domain: 'Domain',
  parentArea: 'Parent Area',
} as const;

export function taskFromNode(
  node: ParsedNode,
  fallbackId: string,
  breadcrumb: string[],
  today: string,
  recurringTag: string,
): Task {
  const f = node.fields;
  const priority = /\bP([1-4])\b/.exec(f[FIELDS.priority]?.text ?? '');
  const parent = f[FIELDS.parent]?.refs[0];
  const deadlineText = f[FIELDS.deadline]?.text ?? '';
  return {
    id: node.id ?? fallbackId,
    name: node.name,
    priority: priority ? (`P${priority[1]}` as Priority) : null,
    deadline: deadlineText ? parseTanaDate(deadlineText, today) : null,
    someday: isChecked(f[FIELDS.someday]?.text),
    recurring: node.tags.some(t => t.toLowerCase() === recurringTag.toLowerCase()),
    occurrence: f[FIELDS.occurrence]?.text || null,
    parentId: parent?.id ?? null,
    parentName: parent?.name ?? null,
    domain: null,
    delegated: (f[FIELDS.delegated]?.refs.length ?? 0) > 0,
    onDayNode: dayFromBreadcrumb(breadcrumb, today),
  };
}

function isChecked(text: string | undefined): boolean {
  return /^(\[x\]|x|yes|true|checked|✓|✅)$/i.test((text ?? '').trim());
}

/**
 * Tasks created on a day node have a breadcrumb like
 * [..., "2026", "Week 44", "Today, Thu, 29 Oct", ...]. The crumb right after
 * "Week NN" is the day; the year crumb before it fixes the year.
 */
export function dayFromBreadcrumb(breadcrumb: string[], today: string): string | null {
  const week = breadcrumb.findIndex(c => /^Week \d{1,2}$/.test(c.trim()));
  if (week < 0 || week + 1 >= breadcrumb.length) {
    return null;
  }
  const year = breadcrumb
    .slice(0, week)
    .reverse()
    .find(c => /^\d{4}$/.test(c.trim()));
  const day = breadcrumb[week + 1];
  const reference = year ? `${year.trim()}${today.slice(4)}` : today;
  const parsed = parseTanaDate(day, reference);
  if (parsed && year && !/\d{4}/.test(day)) {
    return `${year.trim()}${parsed.slice(4)}`;
  }
  return parsed;
}

const RANK: Record<string, number> = {P1: 1, P2: 2, P3: 3, P4: 4};

export function compareTasks(a: Task, b: Task): number {
  const pa = RANK[a.priority ?? 'P3'];
  const pb = RANK[b.priority ?? 'P3'];
  if (pa !== pb) {
    return pa - pb;
  }
  if (a.deadline !== b.deadline) {
    if (!a.deadline) {
      return 1;
    }
    if (!b.deadline) {
      return -1;
    }
    return a.deadline < b.deadline ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

const EXCLUDED_PREFIX = /^(🤖|Decide:)/u;

/** The Today page rule from docs/DESIGN.md §6.2. */
export function todayView(tasks: Task[], today: string): Task[] {
  return tasks
    .filter(t => !EXCLUDED_PREFIX.test(t.name.trim()))
    .filter(
      t =>
        t.onDayNode === today ||
        (!t.someday && t.deadline !== null && daysBetween(t.deadline, today) >= 0),
    )
    .sort(compareTasks);
}
