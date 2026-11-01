import {NetworkError, postNotes, postSync} from '../worker';
import {loadOutbox, saveOutbox, type OutboxItem} from './store';

/**
 * Changes that could not reach the Worker (offline) wait here and go out at
 * the next Today or Sync. Every request is safe to repeat: the Worker skips
 * done tasks and imports each notes payload once per key.
 */
export async function queue(item: OutboxItem): Promise<void> {
  await saveOutbox([...(await loadOutbox()), item]);
}

/** Sends what it can, in order. Returns how many items went out. */
export async function flushOutbox(): Promise<number> {
  const items = await loadOutbox();
  let sent = 0;
  for (const item of items) {
    try {
      if (item.kind === 'sync') {
        await postSync(item.actions);
      } else {
        await postNotes(item.day, item.key, item.lines);
      }
      sent++;
    } catch (e) {
      if (e instanceof NetworkError) {
        break;
      }
      throw e;
    }
  }
  if (sent) {
    await saveOutbox(items.slice(sent));
  }
  return sent;
}

export const outboxSize = async () => (await loadOutbox()).length;
