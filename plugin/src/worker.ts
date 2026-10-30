import {loadConfig} from './config';
import {ensurePermission, PERMISSIONS} from './sn';

export interface TaskSummary {
  id: string;
  name: string;
  priority: string | null;
  deadline: string | null;
  domain: string | null;
  recurring: boolean;
}

async function request(path: string, init: RequestInit = {}, timeoutMs = 8000) {
  const {workerUrl, passphrase} = await loadConfig();
  if (!workerUrl) {
    throw new Error('Worker URL not configured');
  }
  if (!(await ensurePermission(PERMISSIONS.internet, 'Talk to your Tana sync server'))) {
    throw new Error('INTERNET permission not granted');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${workerUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${passphrase}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`${path} → HTTP ${res.status}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const health = () => request('/health') as Promise<{ok: boolean; tana: string}>;

export async function todayTasks(): Promise<TaskSummary[]> {
  const body = (await request('/tasks?view=today', {}, 15000)) as {tasks: TaskSummary[]};
  return body.tasks;
}

export const sendReport = (report: unknown) =>
  request('/spike/report', {method: 'POST', body: JSON.stringify(report)});
