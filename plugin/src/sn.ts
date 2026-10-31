import {NativeModules, TurboModuleRegistry} from 'react-native';
import {
  FileUtils,
  PluginCommAPI,
  PluginFileAPI,
  PluginManager,
  PluginNoteAPI,
  type Element,
} from 'sn-plugin-lib';
import type {Point, StrokeShape} from './core/geometry';
import {BASE_HEIGHT, BASE_WIDTH} from './core/layout';
import {describeError, logEvent, stackHint} from './spike/report';

/**
 * Thin typed layer over sn-plugin-lib. The SDK's declarations mostly say
 * Promise<Object>; at runtime they resolve to { success, result, error }.
 */

export class SnError extends Error {
  constructor(
    readonly api: string,
    readonly code: number | undefined,
    message: string | undefined,
  ) {
    super(`${api} failed${code !== undefined ? ` (${code})` : ''}: ${message ?? 'no details'}`);
  }
}

interface Res<T> {
  success: boolean;
  result: T | null;
  error: {code: number; message: string} | null;
}

/**
 * Runs one SDK call. A TypeError from inside the SDK usually means the
 * device's PluginHost lacks the native method behind it (v0.1 got
 * "undefined is not a function" from Today and Sync); the error then names
 * the call.
 */
export async function call<T>(api: string, run: () => Promise<unknown>): Promise<T> {
  let res: Res<T> | null | undefined;
  try {
    res = (await run()) as Res<T> | null | undefined;
  } catch (e) {
    const detail = nativeMethodMissing(api)
      ? ' (native method missing on this device)'
      : stackHint(e);
    throw new SnError(api, undefined, `${describeError(e)}${detail}`);
  }
  if (!res || !res.success) {
    throw new SnError(api, res?.error?.code, res?.error?.message);
  }
  return res.result as T;
}

/** Native methods behind the SDK calls this plugin makes. */
export const NATIVE_METHODS = [
  'getCurrentFilePath',
  'getCurrentPageNum',
  'getPageSize',
  'getPageDisplaySize',
  'saveCurrentNote',
  'getElements',
  'opElementPointData',
  'getNoteTotalPageNum',
  'createNote',
  'insertNotePage',
  'openFile',
  'reloadFile',
  'jumpToPage',
  'createElement',
  'insertElements',
  'modifyElements',
  'insertText',
  'recognizeElements',
  'clearElementCache',
] as const;

function nativeApi(): Record<string, unknown> | null {
  try {
    return (TurboModuleRegistry.get('NativePluginAPI') ??
      NativeModules.NativePluginAPI ??
      null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

const nativeMethodMissing = (method: string) => typeof nativeApi()?.[method] !== 'function';

/** The NATIVE_METHODS this device's PluginHost does not provide. */
export function missingNativeMethods(): string[] {
  return nativeApi() ? NATIVE_METHODS.filter(nativeMethodMissing) : ['NativePluginAPI module'];
}

export const ELEMENT_STROKE = 0;
export const ELEMENT_TEXT = 500;

export const PERMISSIONS = {
  read: 'plugin.permission.FILE:READ',
  write: 'plugin.permission.FILE:WRITE',
  internet: 'plugin.permission.INTERNET',
} as const;

/**
 * hasPermission: 1 = granted. requestPermission: 1 = this session, 2 = always,
 * 0 = denied, -1 = dialog dismissed. Raw codes go to the spike log.
 */
export async function ensurePermission(permission: string, why: string): Promise<boolean> {
  const has = await PluginManager.hasPermission(permission);
  if (has === 1) {
    return true;
  }
  const answer = await PluginManager.requestPermission(permission, why);
  logEvent(`permission ${permission}: has=${has} request=${answer}`);
  return answer === 1 || answer === 2;
}

export const currentFilePath = () =>
  call<string>('getCurrentFilePath', () => PluginCommAPI.getCurrentFilePath());
export const currentPage = () =>
  call<number>('getCurrentPageNum', () => PluginCommAPI.getCurrentPageNum());

export interface PageSize {
  width: number;
  height: number;
}

/**
 * Page size in pixels: getPageSize, else getPageDisplaySize (current page
 * only, deprecated), else the Nomad's 1404x1872. v0.1 failed right where it
 * first asked for getPageSize. The log says which source answered.
 */
export async function pageSizeOf(path: string, page: number): Promise<PageSize> {
  const attempts: Array<[string, () => Promise<PageSize>]> = [
    ['getPageSize', () => call<PageSize>('getPageSize', () => PluginFileAPI.getPageSize(path, page))],
    ['getPageDisplaySize', () => call<PageSize>('getPageDisplaySize', () => PluginCommAPI.getPageDisplaySize())],
  ];
  for (const [api, attempt] of attempts) {
    try {
      const size = await attempt();
      if (size?.width > 0 && size?.height > 0) {
        logEvent(`page size ${size.width}x${size.height} from ${api}`);
        return {width: size.width, height: size.height};
      }
      logEvent(`${api} returned ${JSON.stringify(size)}`);
    } catch (e) {
      logEvent(describeError(e));
    }
  }
  logEvent(`page size: using the Nomad default ${BASE_WIDTH}x${BASE_HEIGHT}`);
  return {width: BASE_WIDTH, height: BASE_HEIGHT};
}
/** File-level reads and writes see the open note only after it is saved. */
export const saveCurrentNote = () =>
  call<boolean>('saveCurrentNote', () => PluginNoteAPI.saveCurrentNote());
export const pageElements = (path: string, page: number) =>
  call<Element[]>('getElements', () => PluginFileAPI.getElements(page, path));
export const totalPages = (path: string) =>
  call<number>('getNoteTotalPageNum', () => PluginFileAPI.getNoteTotalPageNum(path));

export const createNote = (notePath: string, template: string) =>
  call<boolean>(
    'createNote',
    () => PluginFileAPI.createNote({notePath, template, mode: 0, isPortrait: true}),
  );
export const insertPage = (notePath: string, page: number, template: string) =>
  call<boolean>('insertNotePage', () => PluginFileAPI.insertNotePage({notePath, page, template}));
export const openFile = (path: string, page: number) =>
  call<boolean>('openFile', () => PluginFileAPI.openFile(path, page));
export const reloadFile = () => call<boolean>('reloadFile', () => PluginCommAPI.reloadFile());
export const jumpToPage = (page: number) =>
  call<boolean>('jumpToPage', () => PluginCommAPI.jumpToPage(page));

export const createElement = (type: number) =>
  call<Element>('createElement', () => PluginCommAPI.createElement(type));
export const insertElements = (path: string, page: number, elements: Element[]) =>
  call<boolean>('insertElements', () => PluginFileAPI.insertElements(path, page, elements));
export const modifyElements = (path: string, page: number, elements: Element[]) =>
  call<boolean>('modifyElements', () => PluginFileAPI.modifyElements(path, page, elements));
export const insertText = (textBox: object) =>
  call<boolean>('insertText', () => PluginNoteAPI.insertText(textBox));
export const recognize = (elements: Element[], size: PageSize) =>
  call<string>('recognizeElements', () => PluginCommAPI.recognizeElements(elements, size));

export {FileUtils, PluginCommAPI, PluginManager};

/** Reads a stroke's sample points, thinned out to keep the bridge traffic small. */
export async function strokeShape(element: Element, maxPoints = 96): Promise<StrokeShape> {
  const accessor = element.stroke?.points;
  if (!accessor) {
    return {id: element.uuid, points: []};
  }
  const n = await accessor.size();
  const points: Point[] = n > 0 ? await accessor.getRange(0, n) : [];
  return {id: element.uuid, points: thin(points, maxPoints)};
}

function thin(points: Point[], max: number): Point[] {
  if (points.length <= max) {
    return points;
  }
  const step = (points.length - 1) / (max - 1);
  return Array.from({length: max}, (_, i) => points[Math.round(i * step)]);
}
