import {TurboModuleRegistry} from 'react-native';

/**
 * Key-value storage. AsyncStorage is a native module; PluginHost may or may not
 * ship it (spike Q6). Until we know, fall back to memory so nothing crashes.
 */

interface KV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const memory = new Map<string, string>();
const memoryKV: KV = {
  getItem: async key => memory.get(key) ?? null,
  setItem: async (key, value) => {
    memory.set(key, value);
  },
};

let backend: KV | null = null;
let backendName = 'memory';

function resolve(): KV {
  if (backend) {
    return backend;
  }
  try {
    if (TurboModuleRegistry.get('RNCAsyncStorage') || TurboModuleRegistry.get('PlatformLocalStorage')) {
      backend = require('@react-native-async-storage/async-storage').default as KV;
      backendName = 'AsyncStorage';
      return backend;
    }
  } catch {
    // fall through to memory
  }
  backend = memoryKV;
  return backend;
}

export const storageName = () => {
  resolve();
  return backendName;
};

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await resolve().getItem(key);
  return raw ? (JSON.parse(raw) as T) : fallback;
}

export async function setJSON(key: string, value: unknown): Promise<void> {
  await resolve().setItem(key, JSON.stringify(value));
}

/** Native modules worth knowing about, for the spike report. */
export function nativeModuleInventory(): string[] {
  const names = [
    'RNCAsyncStorage',
    'PlatformLocalStorage',
    'RNFSManager',
    'ReactNativeBlobUtil',
    'RNMMKV',
    'MMKVNative',
    'RNCNetInfo',
    'BlobModule',
    'FileReaderModule',
    'RTNFileUtils',
  ];
  return names.filter(n => {
    try {
      return TurboModuleRegistry.get(n) != null;
    } catch {
      return false;
    }
  });
}
