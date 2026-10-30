import {loadConfig} from '../config';
import {ensurePermission, PERMISSIONS, PluginManager} from '../sn';
import {getJSON, nativeModuleInventory, setJSON, storageName} from '../storage';
import {health} from '../worker';
import {describeError, record, timed} from './report';

/** Checks that need no notebook page; run from the plugin panel. */
export async function runQuickChecks(): Promise<void> {
  const perms: string[] = [];
  for (const [name, permission] of Object.entries(PERMISSIONS)) {
    const has = await PluginManager.hasPermission(permission);
    const granted = await ensurePermission(permission, 'Tana sync spike');
    perms.push(`${name}=${granted} (has=${has})`);
  }
  record(
    'permissions',
    perms.every(p => p.includes('=true')) ? 'pass' : 'fail',
    perms.join(', '),
  );

  try {
    const probe = {at: Date.now()};
    await setJSON('spike.probe', probe);
    const back = await getJSON<{at: number} | null>('spike.probe', null);
    const persisted = storageName() !== 'memory' && back?.at === probe.at;
    record(
      'q6-storage',
      persisted ? 'pass' : 'fail',
      `backend=${storageName()}, round trip ${back?.at === probe.at ? 'ok' : 'failed'}; ` +
        `native modules present: ${nativeModuleInventory().join(', ') || 'none of the probed ones'}`,
    );
  } catch (e) {
    record('q6-storage', 'fail', describeError(e));
  }

  try {
    const [deviceType, dir, name] = await Promise.all([
      PluginManager.getDeviceType(),
      PluginManager.getPluginDirPath(),
      PluginManager.getPluginName(),
    ]);
    record('device', 'info', `deviceType=${deviceType}, plugin=${name}, dir=${dir}`);
  } catch (e) {
    record('device', 'fail', describeError(e));
  }

  const config = await loadConfig();
  if (!config.workerUrl) {
    record('net', 'info', 'Worker URL not set (Config)');
    return;
  }
  try {
    const {value, ms} = await timed(health);
    record('net', value.ok ? 'pass' : 'fail', `GET /health → tana=${value.tana}`, ms);
  } catch (e) {
    record('net', 'fail', describeError(e));
  }
}
