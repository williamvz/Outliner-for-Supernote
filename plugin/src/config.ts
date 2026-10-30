import {getJSON, setJSON} from './storage';

export interface Config {
  workerUrl: string;
  passphrase: string;
}

const KEY = 'config';
let cached: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (!cached) {
    cached = await getJSON<Config>(KEY, {workerUrl: '', passphrase: ''});
  }
  return cached;
}

export async function saveConfig(config: Config): Promise<void> {
  cached = {
    workerUrl: config.workerUrl.trim().replace(/\/+$/, ''),
    passphrase: config.passphrase.trim(),
  };
  await setJSON(KEY, cached);
}
