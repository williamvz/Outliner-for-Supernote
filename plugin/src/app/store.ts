import {getJSON, setJSON} from '../storage';
import type {NoteLine, SyncAction} from '../worker';

/**
 * Per-page memory, kept in the plugin's data directory: which tasks sit on a
 * Today page, and what has already been sent, so a second Sync never sends
 * the same tick or line twice. Plus the offline outbox.
 */

export interface PageRow {
  id: string;
  name: string;
  recurring: boolean;
}

export interface PageState {
  file: string;
  date: string;
  rows: PageRow[];
  /** Task ids already sent as done / not today. */
  sentDone: string[];
  sentSkip: string[];
  /** Keys of handwritten lines already sent. */
  sentLines: string[];
}

export type OutboxItem =
  | {kind: 'sync'; actions: SyncAction[]; at: string}
  | {kind: 'notes'; day: string; key: string; lines: NoteLine[]; at: string};

const pageKey = (file: string) => `page.${file.replace(/^.*\//, '').replace(/[^A-Za-z0-9_-]/g, '_')}`;

export const loadPage = (file: string) => getJSON<PageState | null>(pageKey(file), null);
export const savePage = (state: PageState) => setJSON(pageKey(state.file), state);

export const loadOutbox = () => getJSON<OutboxItem[]>('outbox', []);
export const saveOutbox = (items: OutboxItem[]) => setJSON('outbox', items);

export interface CachedTasks {
  at: string;
  today: string;
  tasks: unknown[];
}
export const loadTaskCache = () => getJSON<CachedTasks | null>('tasks', null);
export const saveTaskCache = (cache: CachedTasks) => setJSON('tasks', cache);
