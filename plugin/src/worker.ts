import {loadConfig} from './config';
import {ensurePermission, PERMISSIONS} from './sn';

export interface TaskSummary {
  id: string;
  name: string;
  priority: string | null;
  deadline: string | null;
  domain: string | null;
  recurring: boolean;
  onDayNode?: string | null;
}

export interface TasksResponse {
  generatedAt: string | null;
  today: string;
  count: number;
  refreshing: {read: number; of: number} | null;
  tasks: TaskSummary[];
}

export interface SyncAction {
  type: 'done' | 'postpone';
  id: string;
}

export interface SyncResult {
  id: string;
  type: string;
  status: 'ok' | 'skipped' | 'failed';
  detail: string;
}

export interface NoteLine {
  level: number;
  text: string;
  isTask?: boolean;
}

export class NetworkError extends Error {}

async function request(path: string, init: RequestInit = {}, timeoutMs = 10000) {
  const {workerUrl, passphrase} = await loadConfig();
  if (!workerUrl) {
    throw new Error('Worker URL not configured (Config)');
  }
  if (!(await ensurePermission(PERMISSIONS.internet, 'Talk to your Tana sync server'))) {
    throw new Error('INTERNET permission not granted');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${workerUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${passphrase}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (e) {
    throw new NetworkError(`${path}: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} → HTTP ${res.status} ${text.slice(0, 160)}`);
  }
  return res.json();
}

export const health = () => request('/health') as Promise<{ok: boolean; tana: string; workspace: string | null}>;

export const getTasks = () => request('/tasks?view=today', {}, 15000) as Promise<TasksResponse>;

export const postSync = (actions: SyncAction[]) =>
  request('/sync', {method: 'POST', body: JSON.stringify({actions})}, 30000) as Promise<{
    today: string;
    results: SyncResult[];
  }>;

export const postNotes = (day: string, key: string, lines: NoteLine[]) =>
  request('/notes', {method: 'POST', body: JSON.stringify({day, key, lines})}, 30000) as Promise<{
    day: string;
    imported: number;
  }>;

export const sendReport = (report: unknown) =>
  request('/spike/report', {method: 'POST', body: JSON.stringify(report)});
