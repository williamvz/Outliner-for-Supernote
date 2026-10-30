import {PluginManager} from 'sn-plugin-lib';
import {logEvent, record} from './report';

const LIFE_START = 2;

let lifeState = -1;
let penUps = 0;
let penUpsWhileClosed = 0;

/**
 * Counts pen-up events and notes whether they arrive while the plugin's own
 * UI is closed (needed for auto-sync). The v0.1 global touch listener is
 * gone: SuperDashboard's notes report that always-on motion capture while
 * the page changes can freeze the device, and v0.1 already showed that
 * finger taps arrive.
 */
export function registerSpikeListeners(): void {
  PluginManager.registerPluginLifeListener({
    onMsg(msg: {state: number}) {
      lifeState = msg.state;
      logEvent(`lifecycle state ${msg.state}`);
    },
  });

  PluginManager.registerEventListener('event_pen_up', 1, {
    onMsg(msg: unknown[]) {
      penUps++;
      if (lifeState !== LIFE_START) {
        penUpsWhileClosed++;
      }
      // Saving on every stroke would add a file write per pen-up.
      if (penUps === 1 || penUps % 10 === 0) {
        record(
          'q4-penup',
          penUpsWhileClosed > 0 ? 'pass' : 'info',
          `${penUps} pen-up events, ${penUpsWhileClosed} while the plugin UI was closed; ` +
            `last event carried ${Array.isArray(msg) ? msg.length : '?'} element(s)`,
        );
      }
    },
  });
}
