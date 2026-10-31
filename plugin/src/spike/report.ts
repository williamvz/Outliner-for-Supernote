import {getJSON, setJSON} from '../storage';

/**
 * The spike's findings, one entry per question in docs/DESIGN.md §10 plus a
 * few facts about the device, and a short event log. Both are saved to the
 * plugin's data directory on every change, so a result recorded by a button
 * handler survives a PluginHost restart and shows up in the panel later.
 * "Send report" posts them to the Worker.
 */

export type Status = 'pass' | 'fail' | 'info' | 'pending';

export interface Finding {
  id: string;
  title: string;
  status: Status;
  detail: string;
  ms?: number;
  at?: string;
}

export interface LogEntry {
  at: string;
  msg: string;
}

export const QUESTIONS: Array<Pick<Finding, 'id' | 'title'>> = [
  {id: 'q1-template', title: 'Q1 Custom template image for new notebook/page'},
  {id: 'q2-render', title: 'Q2 Render task text boxes (timing)'},
  {id: 'q3-recognize', title: 'Q3 Read strokes + recognize per line'},
  {id: 'q4-penup', title: 'Q4 Pen-up events while plugin UI is closed'},
  {id: 'q5-background', title: 'Q5 Toolbar button without UI (Ping) reaches the plugin'},
  {id: 'q6-storage', title: 'Q6 Persistent storage inside PluginHost'},
  {id: 'net', title: 'Network: Worker reachable'},
  {id: 'permissions', title: 'Permissions: FILE:READ / FILE:WRITE / INTERNET'},
  {id: 'ticks', title: 'Ticks read from the task zone'},
  {id: 'outline', title: 'Handwriting → outline nodes'},
  {id: 'header', title: 'Update header text in place'},
  {id: 'api', title: 'Device API methods the plugin needs'},
  {id: 'device', title: 'Device facts'},
];

const STORE_KEY = 'spike-report';
const MAX_LOG = 150;

type Listener = () => void;

const findings = new Map<string, Finding>(
  QUESTIONS.map(q => [q.id, {...q, status: 'pending', detail: ''}]),
);
let log: LogEntry[] = [];
const listeners = new Set<Listener>();
let loaded: Promise<void> | null = null;

/** Merges what earlier sessions saved; call once at startup. */
export function loadSaved(): Promise<void> {
  loaded ??= getJSON<{findings: Finding[]; log: LogEntry[]} | null>(STORE_KEY, null)
    .then(saved => {
      if (!saved) {
        return;
      }
      for (const f of saved.findings) {
        if (f.status !== 'pending' && findings.get(f.id)?.status === 'pending') {
          findings.set(f.id, f);
        }
      }
      log = [...saved.log, ...log].slice(-MAX_LOG);
      listeners.forEach(l => l());
    })
    .catch(e => logEvent(`could not load saved report: ${describeError(e)}`));
  return loaded;
}

function save(): void {
  setJSON(STORE_KEY, {findings: allFindings(), log}).catch(() => {
    // Saving is best effort; the screen still shows everything.
  });
  listeners.forEach(l => l());
}

export function record(id: string, status: Status, detail: string, ms?: number): void {
  const title = findings.get(id)?.title ?? id;
  findings.set(id, {id, title, status, detail, ms, at: new Date().toISOString()});
  logEvent(`${id}: ${status.toUpperCase()} ${detail}${ms !== undefined ? ` (${ms} ms)` : ''}`);
}

export function logEvent(msg: string): void {
  log.push({at: new Date().toISOString(), msg});
  log = log.slice(-MAX_LOG);
  save();
}

export const allFindings = (): Finding[] => [...findings.values()];
export const eventLog = (): LogEntry[] => [...log];

export function onChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function timed<T>(fn: () => Promise<T>): Promise<{value: T; ms: number}> {
  const start = Date.now();
  const value = await fn();
  return {value, ms: Date.now() - start};
}

export function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Runs one named step and logs where it fails. Release bundles give stack
 * frames with no names, so a plain "undefined is not a function" says nothing
 * about which line threw; the step name does.
 */
export async function step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  try {
    const value = await fn();
    logEvent(`step ok: ${name}`);
    return value;
  } catch (e) {
    logEvent(`step FAILED: ${name}: ${describeError(e)}`);
    throw e;
  }
}

/** The first frames of a stack trace, to find the failing call on the device. */
export function stackHint(e: unknown): string {
  const frames = e instanceof Error && e.stack ? e.stack.split('\n').slice(1, 4) : [];
  return frames.length ? ` @ ${frames.map(f => f.trim()).join(' < ')}` : '';
}
