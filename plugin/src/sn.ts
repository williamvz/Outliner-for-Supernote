import {
  FileUtils,
  PluginCommAPI,
  PluginFileAPI,
  PluginManager,
  PluginNoteAPI,
  type Element,
} from 'sn-plugin-lib';
import type {Point, StrokeShape} from './core/geometry';

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

export async function call<T>(api: string, pending: Promise<unknown>): Promise<T> {
  const res = (await pending) as Res<T> | null | undefined;
  if (!res || !res.success) {
    throw new SnError(api, res?.error?.code, res?.error?.message);
  }
  return res.result as T;
}

export const ELEMENT_STROKE = 0;
export const ELEMENT_TEXT = 500;

export const PERMISSIONS = {
  read: 'plugin.permission.FILE:READ',
  write: 'plugin.permission.FILE:WRITE',
  internet: 'plugin.permission.INTERNET',
} as const;

/** 1 = granted (this time or always), 0 = not granted. Asks when needed. */
export async function ensurePermission(permission: string, why: string): Promise<boolean> {
  if ((await PluginManager.hasPermission(permission)) === 1) {
    return true;
  }
  const answer = await PluginManager.requestPermission(permission, why);
  return answer === 1 || answer === 2;
}

export const currentFilePath = () =>
  call<string>('getCurrentFilePath', PluginCommAPI.getCurrentFilePath());
export const currentPage = () =>
  call<number>('getCurrentPageNum', PluginCommAPI.getCurrentPageNum());
export const pageSize = (path: string, page: number) =>
  call<{width: number; height: number}>('getPageSize', PluginFileAPI.getPageSize(path, page));
export const pageElements = (path: string, page: number) =>
  call<Element[]>('getElements', PluginFileAPI.getElements(page, path));
export const totalPages = (path: string) =>
  call<number>('getNoteTotalPageNum', PluginFileAPI.getNoteTotalPageNum(path));

export const createNote = (notePath: string, template: string) =>
  call<boolean>(
    'createNote',
    PluginFileAPI.createNote({notePath, template, mode: 0, isPortrait: true}),
  );
export const insertPage = (notePath: string, page: number, template: string) =>
  call<boolean>('insertNotePage', PluginFileAPI.insertNotePage({notePath, page, template}));
export const openFile = (path: string, page: number) =>
  call<boolean>('openFile', PluginFileAPI.openFile(path, page));
export const reloadFile = () => call<boolean>('reloadFile', PluginCommAPI.reloadFile());
export const jumpToPage = (page: number) =>
  call<boolean>('jumpToPage', PluginCommAPI.jumpToPage(page));

export const createElement = (type: number) =>
  call<Element>('createElement', PluginCommAPI.createElement(type));
export const insertElements = (path: string, page: number, elements: Element[]) =>
  call<boolean>('insertElements', PluginFileAPI.insertElements(path, page, elements));
export const modifyElements = (path: string, page: number, elements: Element[]) =>
  call<boolean>('modifyElements', PluginFileAPI.modifyElements(path, page, elements));
export const insertText = (textBox: object) =>
  call<boolean>('insertText', PluginNoteAPI.insertText(textBox));
export const recognize = (elements: Element[], size: {width: number; height: number}) =>
  call<string>('recognizeElements', PluginCommAPI.recognizeElements(elements, size));

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
