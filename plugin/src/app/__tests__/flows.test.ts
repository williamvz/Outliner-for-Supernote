/* eslint-disable @typescript-eslint/no-explicit-any */
// Runs Today and Sync end to end against the real SDK code, with the device's
// native layer replaced by a scripted fake that behaves the way the docs say.
import {computeLayout} from '../../core/layout';
import {segment, tick, word} from '../../core/__fixtures__/strokes';
import type {StrokeShape} from '../../core/geometry';

const ok = (result: unknown) => Promise.resolve({success: true, result, error: null});

interface Fake {
  files: Map<string, string>;
  notes: Map<string, {template: string; pages: number}>;
  open: string;
  strokes: StrokeShape[];
  calls: string[];
  written: Map<string, number>;
}

const fake: Fake = {files: new Map(), notes: new Map(), open: '', strokes: [], calls: [], written: new Map()};
const byUuid = new Map<string, StrokeShape>();

const api: Record<string, (...a: any[]) => any> = {
  getCurrentFilePath: () => ok(fake.open),
  getCurrentPageNum: () => ok(0),
  getPageSize: () => ok({width: 1404, height: 1872}),
  saveCurrentNote: () => ok(true),
  createNote: ({notePath, template}: any) => {
    fake.notes.set(notePath, {template, pages: 1});
    return ok(true);
  },
  getNotePageTemplate: () => ok({name: 'user_custom', md5: 'abc123'}),
  openFile: (path: string) => {
    fake.open = path;
    return ok(true);
  },
  getElements: () =>
    ok(
      fake.strokes.map(s => {
        byUuid.set(s.id, s);
        return {uuid: s.id, type: 0, pageNum: 0, layerNum: 0, numInPage: 1, stroke: {}};
      }),
    ),
  // the point accessors
  opElementPointData: (uuid: string, _t: number, op: number, index: number[]) => {
    const s = byUuid.get(uuid)!;
    if (op === 0) return Promise.resolve(s.points.length);
    return Promise.resolve(s.points.slice(index[0], (index[1] ?? index[0]) + 1));
  },
  recognizeElements: (els: any[]) => ok(els.length > 3 ? 'send the budget' : 'Ideas'),
  clearElementCache: () => undefined,
  getNoteSystemTemplates: () => ok([{name: 'style_blank'}, {name: 'style_line'}]),
  getNoteTotalPageNum: (path: string) => ok(fake.notes.get(path)?.pages ?? 1),
  insertNotePage: ({notePath}: any) => {
    fake.notes.get(notePath)!.pages++;
    return ok(true);
  },
  createElement: (type: number) => ok({uuid: `e${Math.random()}`, type, pageNum: 0, layerNum: 0, numInPage: 1}),
  insertElements: () => ok(true),
  insertText: () => ok(true),
  getDeviceType: () => Promise.resolve(4),
};
const manager: Record<string, (...a: any[]) => any> = {
  hasPermission: () => Promise.resolve(1),
  requestPermission: () => Promise.resolve(1),
  getPluginDirPath: () => Promise.resolve('/data/plugin'),
  getDeviceType: () => Promise.resolve(4),
  getPluginName: () => Promise.resolve('Tana Sync'),
  closePluginView: () => Promise.resolve(true),
};
const fileUtils: Record<string, (...a: any[]) => any> = {
  exists: (p: string) => Promise.resolve(fake.notes.has(p) || fake.written.has(p)),
  makeDir: () => Promise.resolve(true),
};

const SN: Record<string, Record<string, (...a: any[]) => any>> = {
  NativePluginAPI: api,
  NativePluginManager: manager,
  RTNFileUtils: fileUtils,
};
const fakeModule = (name: string) =>
  new Proxy({}, {
    get: (_t, prop: string) => {
      if (prop === 'then') return undefined;
      const fn = SN[name]?.[prop];
      if (!fn) return name in SN ? undefined : () => Promise.resolve(null);
      return (...a: any[]) => {
        fake.calls.push(`${name}.${prop}`);
        return fn(...a);
      };
    },
  });

jest.mock('react-native/Libraries/TurboModule/TurboModuleRegistry', () => {
  const real = jest.requireActual('react-native/Libraries/TurboModule/TurboModuleRegistry');
  const wrap = (name: string, fallback: () => any) =>
    ['NativePluginAPI', 'NativePluginManager', 'RTNFileUtils'].includes(name) ? fakeModule(name) : fallback();
  return {
    ...real,
    get: (name: string) => wrap(name, () => real.get(name)),
    getEnforcing: (name: string) =>
      wrap(name, () => {
        try {
          return real.getEnforcing(name);
        } catch {
          return fakeModule(name);
        }
      }),
  };
});

const mockWorker = {
  getTasks: jest.fn(),
  postSync: jest.fn(),
  postNotes: jest.fn(),
  sendReport: jest.fn(),
  health: jest.fn(),
};
jest.mock('../../worker', () => ({
  ...mockWorker,
  NetworkError: class NetworkError extends Error {},
}));

import {NativeModules} from 'react-native';

(NativeModules as any).TanaNative = {
  readFile: async (p: string) => fake.files.get(p) ?? null,
  writeFile: async (p: string, c: string) => {
    fake.files.set(p, c);
    return true;
  },
  appendFile: async () => true,
  writeFileBase64: async (p: string, b64: string) => {
    fake.written.set(p, b64.length);
    return Math.floor((b64.length * 3) / 4);
  },
};

const {runToday} = require('../today');
const {runSelfTest} = require('../selftest');
const {runSync, applyPlan} = require('../sync');
const {getUi} = require('../ui');
const {loadPage} = require('../store');

const tasks = Array.from({length: 9}, (_, i) => ({
  id: `task${i}x`,
  name: `Task number ${i}`,
  priority: 'P2',
  deadline: '2026-10-29',
  domain: i % 2 ? 'Home' : 'Work',
  recurring: i === 2,
}));

beforeEach(() => {
  jest.clearAllMocks();
  fake.files.clear();
  fake.notes.clear();
  fake.written.clear();
  fake.calls = [];
  fake.open = '';
  fake.strokes = [];
  mockWorker.getTasks.mockResolvedValue({generatedAt: 'x', today: '2026-10-31', count: 9, refreshing: null, tasks});
});

describe('Today', () => {
  it('draws the page, writes it as a template, creates the notebook and opens it', async () => {
    await runToday();
    const lines = getUi().lines.join('\n');
    expect(lines).not.toMatch(/failed/i);
    expect(mockWorker.getTasks).toHaveBeenCalled();
    expect([...fake.written.keys()]).toEqual(['/storage/emulated/0/MyStyle/tana_today.png']);
    const [path, note] = [...fake.notes.entries()][0];
    expect(path).toMatch(/\/Note\/Tana\/\d{4}-\d{2}-\d{2}\.note$/);
    expect(note.template).toBe('/storage/emulated/0/MyStyle/tana_today.png');
    expect(fake.open).toBe(path);
    const state = await loadPage(path);
    expect(state.rows).toHaveLength(6);
    expect(state.rows[0]).toMatchObject({id: 'task0x', name: 'Task number 0'});
  });

  it('names a second notebook of the same day differently', async () => {
    await runToday();
    await runToday();
    const names = [...fake.notes.keys()];
    expect(new Set(names).size).toBe(2);
  });

  it('says what failed, with the step name, when the device refuses', async () => {
    api.createNote = () => Promise.resolve({success: false, result: null, error: {code: 9, message: 'no space'}});
    await runToday();
    expect(getUi().lines.join('\n')).toMatch(/create notebook.*no space|Today failed: createNote failed \(9\): no space/);
    api.createNote = ({notePath, template}: any) => {
      fake.notes.set(notePath, {template, pages: 1});
      return ok(true);
    };
  });
});

describe('Sync', () => {
  it('reads ticks, not-today marks and handwriting, then sends them after the OK', async () => {
    await runToday();
    const path = fake.open;
    const layout = computeLayout();
    const mid = (i: number) => (layout.rows[i].band.top + layout.rows[i].band.bottom) / 2;
    const slotY = (k: number) => layout.writingZone.top + k * layout.lineSpacing + 60;
    const dash = segment(layout.marginLeft + 6, slotY(0) - 15, layout.marginLeft + 40, slotY(0) - 15, 4);
    fake.strokes = [
      tick(layout.rows[0].checkbox.left + 8, mid(0)),
      tick(layout.rows[2].skip.left + 8, mid(2)),
      dash,
      word(layout.marginLeft + 70, slotY(0), 90),
      word(layout.marginLeft + 180, slotY(0), 90),
      word(layout.marginLeft + 290, slotY(0), 90),
      word(layout.marginLeft + 400, slotY(0), 90),
    ];
    mockWorker.postSync.mockResolvedValue({
      today: '2026-10-31',
      results: [
        {id: 'task0x', type: 'done', status: 'ok', detail: 'checked'},
        {id: 'task2x', type: 'postpone', status: 'ok', detail: 'deadline → 2026-11-01'},
      ],
    });
    mockWorker.postNotes.mockResolvedValue({day: '2026-10-31', imported: 1});

    await runSync();
    const plan = getUi().plan;
    expect(plan).not.toBeNull();
    expect(plan.done.map((r: any) => r.id)).toEqual(['task0x']);
    expect(plan.skip.map((r: any) => r.id)).toEqual(['task2x']);
    expect(plan.notes).toHaveLength(1);
    expect(plan.notes[0].text).toMatch(/budget/);
    expect(mockWorker.postSync).not.toHaveBeenCalled(); // nothing is sent before the OK

    await applyPlan(plan);
    expect(mockWorker.postSync).toHaveBeenCalledWith([
      {type: 'done', id: 'task0x'},
      {type: 'postpone', id: 'task2x'},
    ]);
    expect(mockWorker.postNotes).toHaveBeenCalledTimes(1);
    expect(mockWorker.postNotes.mock.calls[0][2]).toEqual([{level: 0, text: expect.stringMatching(/budget/), isTask: false}]);

    // a second Sync finds nothing new: the same ticks are not sent twice
    await runSync();
    const again = getUi().plan;
    expect(again.done).toHaveLength(0);
    expect(again.skip).toHaveLength(0);
    expect(again.notes).toHaveLength(0);
    expect(path).toBe(fake.open);
  });

  it('asks for a Today notebook when another notebook is open', async () => {
    fake.open = '/storage/emulated/0/Note/Other.note';
    await runSync();
    expect(getUi().lines.join('\n')).toMatch(/Open a Today notebook/);
    expect(getUi().plan).toBeNull();
  });
});

describe('Self-test', () => {
  it('runs every probe, and keeps going when one call is missing', async () => {
    mockWorker.health.mockResolvedValue({ok: true, tana: 'linked', workspace: 'W'});
    mockWorker.sendReport.mockResolvedValue({});
    const insertText = api.insertText;
    delete (api as any).insertText; // this firmware lacks it
    fake.open = '/storage/emulated/0/Note/Tana/2026-10-31.note';
    fake.notes.set(fake.open, {template: 'x', pages: 1});
    await runSelfTest();
    const lines = getUi().lines.join('\n');
    expect(lines).toMatch(/FAIL text box on open page/);
    expect(lines).toMatch(/PASS create notebook with image background/);
    expect(lines).toMatch(/PASS open notebook/);
    expect(lines).toMatch(/\d+ of \d+ checks FAILED/);
    expect(mockWorker.sendReport).toHaveBeenCalled();
    api.insertText = insertText;
  });
});
