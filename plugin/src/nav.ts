export type Screen = 'report' | 'config';

type Listener = (screen: Screen) => void;

let current: Screen = 'report';
const listeners = new Set<Listener>();

export function show(screen: Screen): void {
  current = screen;
  listeners.forEach(l => l(screen));
}

export const currentScreen = () => current;

export function onScreen(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
