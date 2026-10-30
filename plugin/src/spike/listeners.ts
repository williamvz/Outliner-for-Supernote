import {PluginManager, type MotionEvent} from 'sn-plugin-lib';
import {record} from './report';

const LIFE_START = 2;
const ACTION_DOWN = 0;
const TOOL_FINGER = 1;
const TOOL_PEN = 2;

let lifeState = -1;
let penUps = 0;
let penUpsWhileClosed = 0;
let fingerDowns = 0;
let penDowns = 0;

/**
 * Counts pen-up and touch events so the spike can tell whether they arrive
 * while the plugin's own UI is closed (needed for auto-sync and page buttons).
 */
export function registerSpikeListeners(): void {
  PluginManager.registerPluginLifeListener({
    onMsg(msg: {state: number}) {
      lifeState = msg.state;
    },
  });

  PluginManager.registerEventListener('event_pen_up', 1, {
    onMsg(msg: unknown[]) {
      penUps++;
      if (lifeState !== LIFE_START) {
        penUpsWhileClosed++;
      }
      record(
        'q4-penup',
        penUpsWhileClosed > 0 ? 'pass' : 'info',
        `${penUps} pen-up events, ${penUpsWhileClosed} while the plugin UI was closed; ` +
          `last event carried ${Array.isArray(msg) ? msg.length : '?'} element(s)`,
      );
    },
  });

  PluginManager.registerMotionListener(1, {
    onMsg(event: MotionEvent) {
      if (event.action !== ACTION_DOWN) {
        return;
      }
      if (event.toolType === TOOL_FINGER) {
        fingerDowns++;
      } else if (event.toolType === TOOL_PEN) {
        penDowns++;
      }
      record(
        'touch',
        fingerDowns > 0 ? 'pass' : 'info',
        `${fingerDowns} finger touches, ${penDowns} pen touches; last at ${Math.round(event.x)},${Math.round(event.y)}`,
      );
    },
  });
}
