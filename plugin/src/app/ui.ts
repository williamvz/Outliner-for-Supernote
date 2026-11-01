import {logEvent} from '../spike/report';
import type {SyncPlan} from './sync';

/**
 * What the plugin panel shows: a headline, progress lines, and, after Sync,
 * a plan waiting for the user's OK. The flows write here as they go, so a
 * failure is always visible on the device.
 */
export interface UiState {
  title: string;
  lines: string[];
  busy: boolean;
  plan: SyncPlan | null;
}

type Listener = (state: UiState) => void;

let state: UiState = {title: 'Tana Sync', lines: [], busy: false, plan: null};
const listeners = new Set<Listener>();

export const getUi = () => state;

export function setUi(patch: Partial<UiState>): void {
  state = {...state, ...patch};
  listeners.forEach(l => l(state));
}

export function begin(title: string): void {
  setUi({title, lines: [], busy: true, plan: null});
  logEvent(`== ${title}`);
}

export function say(line: string): void {
  setUi({lines: [...state.lines, line].slice(-40)});
  logEvent(line);
}

export function end(): void {
  setUi({busy: false});
}

export function onUi(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
