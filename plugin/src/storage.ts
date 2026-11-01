import {NativeModules, TurboModuleRegistry} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

/**
 * JSON files in the plugin's private directory, written by our own native
 * module (android/.../TanaNativeModule.java). PluginHost ships no
 * AsyncStorage (spike Q6), and its own file utils cannot write content.
 * Without the native module (e.g. in Jest) values live in memory only.
 */

interface TanaNative {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<boolean>;
  appendFile(path: string, content: string): Promise<boolean>;
  writeFileBase64(path: string, base64: string): Promise<number>;
}

const native: TanaNative | undefined = NativeModules.TanaNative;
const memory = new Map<string, string>();
let dataDir: Promise<string> | null = null;

export const storageName = () => (native ? 'TanaNative files' : 'memory');

function dir(): Promise<string> {
  dataDir ??= PluginManager.getPluginDirPath().then(d => `${d ?? ''}/data`);
  return dataDir;
}

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = native ? await native.readFile(`${await dir()}/${key}.json`) : memory.get(key) ?? null;
  return raw ? (JSON.parse(raw) as T) : fallback;
}

export async function setJSON(key: string, value: unknown): Promise<void> {
  const raw = JSON.stringify(value);
  if (native) {
    await native.writeFile(`${await dir()}/${key}.json`, raw);
  } else {
    memory.set(key, raw);
  }
}

/** Writes binary content (given as base64) anywhere the plugin may write, e.g. MyStyle. */
export async function writeBinary(path: string, base64: string): Promise<number> {
  if (!native?.writeFileBase64) {
    throw new Error('native file module missing (TanaNative.writeFileBase64)');
  }
  return native.writeFileBase64(path, base64);
}

/** Native modules worth knowing about, for the spike report. */
export function nativeModuleInventory(): string[] {
  const names = [
    'TanaNative',
    'RNCAsyncStorage',
    'PlatformLocalStorage',
    'RNFSManager',
    'ReactNativeBlobUtil',
    'BlobModule',
    'FileReaderModule',
    'RTNFileUtils',
  ];
  return names.filter(n => {
    try {
      return NativeModules[n] != null || TurboModuleRegistry.get(n) != null;
    } catch {
      return false;
    }
  });
}
