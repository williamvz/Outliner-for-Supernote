import {getJSON, setJSON} from '../storage';
import type {NoteLine, SyncAction} from '../worker';

/**
 * Memory kept in the plugin's data directory: which tasks sit on each page of
 * a Tasks notebook, what has already been sent (so a second Sync never sends
 * the same tick or line twice), the task filters and the offline outbox.
 */

export interface PageRow {
  id: string;
  name: string;
  recurring: boolean;
}

export interface NotebookState {
  kind: 'tasks' | 'notes';
  file: string;
  date: string;
  /** Tasks notebooks: the tasks on every page, row by row. */
  pages: PageRow[][];
  /** Task ids already sent as done / not today. */
  sentDone: string[];
  sentSkip: string[];
  /** Keys of handwritten lines already sent. */
  sentLines: string[];
}

export type OutboxItem =
  | {kind: 'sync'; actions: SyncAction[]; at: string}
  | {kind: 'notes'; day: string; key: string; lines: NoteLine[]; at: string};

export interface Filters {
  priorities: string[];
  domains: string[];
}

const key = (file: string) => `nb.${file.replace(/^.*\//, '').replace(/[^A-Za-z0-9_-]/g, '_')}`;

export const loadNotebook = (file: string) => getJSON<NotebookState | null>(key(file), null);
export const saveNotebook = (state: NotebookState) => setJSON(key(state.file), state);

export const loadOutbox = () => getJSON<OutboxItem[]>('outbox', []);
export const saveOutbox = (items: OutboxItem[]) => setJSON('outbox', items);

export const loadFilters = () => getJSON<Filters>('filters', {priorities: [], domains: []});
export const saveFilters = (filters: Filters) => setJSON('filters', filters);

export interface CachedTasks {
  at: string;
  today: string;
  tasks: unknown[];
}
export const loadTaskCache = () => getJSON<CachedTasks | null>('tasks', null);
export const saveTaskCache = (cache: CachedTasks) => setJSON('tasks', cache);
