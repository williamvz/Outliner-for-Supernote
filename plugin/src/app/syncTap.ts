import {PluginManager} from 'sn-plugin-lib';
import {computeLayout} from '../core/layout';
import {currentFilePath} from '../sn';
import {describeError, logEvent} from '../spike/report';
import {show} from '../nav';
import {NOTE_DIR} from './paths';
import {loadNotebook} from './store';
import {runSync} from './sync';
import {getUi} from './ui';

const BOX = computeLayout().syncBox;
const SLACK = 24;

let checking = false;

/**
 * A pen tap in the SYNC box on a Tasks or Notes page starts a sync. The note
 * app reports every finished stroke; only the first point of each is looked
 * at, which is one cheap call per stroke.
 */
export function registerSyncTap(): void {
  PluginManager.registerEventListener('event_pen_up', 1, {
    onMsg(msg: unknown[]) {
      handleTap(msg).catch(e => logEvent(`SYNC tap check failed: ${describeError(e)}`));
    },
  });
}

export async function handleTap(msg: unknown[]): Promise<void> {
  if (checking || getUi().busy || !Array.isArray(msg) || !msg.length) {
    return;
  }
  const element = msg[msg.length - 1] as {stroke?: {points?: {get(i: number): Promise<{x: number; y: number} | null>}}};
  const points = element?.stroke?.points;
  if (!points) {
    return;
  }
  checking = true;
  try {
    const p = await points.get(0);
    if (!p || p.x < BOX.left - SLACK || p.x > BOX.right + SLACK || p.y < BOX.top - SLACK || p.y > BOX.bottom + SLACK) {
      return;
    }
    const file = await currentFilePath();
    if (!file.startsWith(`${NOTE_DIR}/`) || !(await loadNotebook(file))) {
      return;
    }
    logEvent('SYNC box tapped');
    show('report');
    await PluginManager.showPluginView();
    await runSync(true);
  } finally {
    checking = false;
  }
}
