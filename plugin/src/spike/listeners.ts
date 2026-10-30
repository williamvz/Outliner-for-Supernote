import {PluginManager} from 'sn-plugin-lib';
import {logEvent, record} from './report';

let penUps = 0;

/**
 * Logs lifecycle states and counts pen-up events. The plugin view is
 * full-screen, so a pen-up on the page always comes while it is closed:
 * every event counts for auto-sync (Q4). v0.1 also tracked the lifecycle
 * state for that, but closePluginView() sends no state change, so its
 * "while closed" count stayed at 0. The v0.1 global touch listener is gone:
 * SuperDashboard's notes report that always-on motion capture while the page
 * changes can freeze the device.
 */
export function registerSpikeListeners(): void {
  PluginManager.registerPluginLifeListener({
    onMsg(msg: {state: number}) {
      logEvent(`lifecycle state ${msg?.state}`);
    },
  });

  PluginManager.registerEventListener('event_pen_up', 1, {
    onMsg(msg: unknown[]) {
      penUps++;
      // Saving on every stroke would add a file write per pen-up.
      if (penUps === 1 || penUps % 10 === 0) {
        record(
          'q4-penup',
          'pass',
          `${penUps} pen-up events while writing on the page; ` +
            `last event carried ${Array.isArray(msg) ? msg.length : '?'} element(s)`,
        );
      }
    },
  });
}
