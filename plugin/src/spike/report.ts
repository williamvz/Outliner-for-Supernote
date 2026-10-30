/**
 * The spike's findings, one entry per question in docs/DESIGN.md §10 plus a
 * few facts about the device. The report screen renders this and "Send report"
 * posts it to the Worker so it can be read without screenshots.
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

export const QUESTIONS: Array<Pick<Finding, 'id' | 'title'>> = [
  {id: 'q1-template', title: 'Q1 Custom template image for new notebook/page'},
  {id: 'q2-render', title: 'Q2 Render task text boxes (timing)'},
  {id: 'q3-recognize', title: 'Q3 Read strokes + recognize per line'},
  {id: 'q4-penup', title: 'Q4 Pen-up events while plugin UI is closed'},
  {id: 'q5-background', title: 'Q5 Toolbar button without UI runs a sync'},
  {id: 'q6-storage', title: 'Q6 AsyncStorage inside PluginHost'},
  {id: 'net', title: 'Network: Worker reachable'},
  {id: 'permissions', title: 'Permissions: FILE:READ / FILE:WRITE / INTERNET'},
  {id: 'ticks', title: 'Ticks read from the task zone'},
  {id: 'outline', title: 'Handwriting → outline nodes'},
  {id: 'header', title: 'Update header text in place'},
  {id: 'device', title: 'Device facts'},
  {id: 'touch', title: 'Finger taps seen by the motion listener'},
];

type Listener = () => void;

const findings = new Map<string, Finding>(
  QUESTIONS.map(q => [q.id, {...q, status: 'pending', detail: ''}]),
);
const listeners = new Set<Listener>();

export function record(
  id: string,
  status: Status,
  detail: string,
  ms?: number,
): void {
  const title = findings.get(id)?.title ?? id;
  findings.set(id, {id, title, status, detail, ms, at: new Date().toISOString()});
  listeners.forEach(l => l());
}

export function allFindings(): Finding[] {
  return [...findings.values()];
}

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
