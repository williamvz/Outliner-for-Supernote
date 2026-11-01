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
  showPluginView: () => Promise.resolve(true),
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

const {runTasks} = require('../tasks');
const {runNotes} = require('../notes');
const {runSync, applyPlan} = require('../sync');
const {runSelfTest} = require('../selftest');
const {handleTap} = require('../syncTap');
const {getUi} = require('../ui');
const {loadNotebook} = require('../store');

const tasks = Array.from({length: 31}, (_, i) => ({
  id: `task${i}xx`,
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
  mockWorker.getTasks.mockResolvedValue({generatedAt: 'x', today: '2026-10-31', count: 31, refreshing: null, tasks});
});

describe('Tasks', () => {
  it('makes a notebook with a page for every 14 tasks and opens it', async () => {
    await runTasks();
    expect(getUi().lines.join('\n')).not.toMatch(/failed/i);
    const [path, note] = [...fake.notes.entries()][0];
    expect(path).toMatch(/\/Note\/Tana\/Tasks \d{4}-\d{2}-\d{2}\.note$/);
    expect(note.template).toBe('/storage/emulated/0/MyStyle/tana_page.png');
    expect(note.pages).toBe(3); // 31 tasks = 14 + 14 + 3
    expect(fake.open).toBe(path);
    const state = await loadNotebook(path);
    expect(state.kind).toBe('tasks');
    expect(state.pages.map((p: unknown[]) => p.length)).toEqual([14, 14, 3]);
    expect(state.pages[1][0]).toMatchObject({id: 'task14xx'});
  });

  it('asks the Worker for the saved filters', async () => {
    const {saveFilters} = require('../store');
    await saveFilters({priorities: ['P1', 'P2'], domains: ['Work']});
    await runTasks();
    expect(mockWorker.getTasks).toHaveBeenCalledWith({priorities: ['P1', 'P2'], domains: ['Work']});
    await saveFilters({priorities: [], domains: []});
  });

  it('says so when no task matches', async () => {
    mockWorker.getTasks.mockResolvedValue({generatedAt: 'x', today: '2026-10-31', count: 0, refreshing: null, tasks: []});
    await runTasks();
    expect(getUi().lines.join('\n')).toMatch(/No open tasks match/);
    expect(fake.notes.size).toBe(0);
  });

  it('names a second notebook of the same day differently', async () => {
    await runTasks();
    await runTasks();
    expect(new Set(fake.notes.keys()).size).toBe(2);
  });

  it('says what failed, with the step name, when the device refuses', async () => {
    const real = api.createNote;
    api.createNote = () => Promise.resolve({success: false, result: null, error: {code: 9, message: 'no space'}});
    await runTasks();
    expect(getUi().lines.join('\n')).toMatch(/Tasks failed: createNote failed \(9\): no space/);
    api.createNote = real;
  });
});

describe('Notes', () => {
  it('creates today\'s notebook once, then opens it, then adds a page when it is open', async () => {
    await runNotes();
    const [path, note] = [...fake.notes.entries()][0];
    expect(path).toMatch(/\/Note\/Tana\/Notes \d{4}-\d{2}-\d{2}\.note$/);
    expect(note.pages).toBe(1);
    expect((await loadNotebook(path)).kind).toBe('notes');

    fake.open = '';
    await runNotes();
    expect(fake.notes.size).toBe(1);
    expect(fake.open).toBe(path);
    expect(fake.notes.get(path)!.pages).toBe(1);

    await runNotes(); // now it is open: add a page
    expect(fake.notes.get(path)!.pages).toBe(2);
  });
});

describe('Sync', () => {
  it('reads ticks and not-today marks on every page of a Tasks notebook, then sends after the OK', async () => {
    await runTasks();
    const layout = computeLayout();
    const mid = (i: number) => (layout.rows[i].band.top + layout.rows[i].band.bottom) / 2;
    // page 1: tick row 0; page 2: not-today on row 1
    const perPage: Record<number, StrokeShape[]> = {
      0: [tick(layout.rows[0].checkbox.left + 8, mid(0))],
      1: [tick(layout.rows[1].skip.left + 8, mid(1))],
      2: [],
    };
    api.getElements = (page: number) => {
      const list = perPage[page] ?? [];
      return ok(
        list.map(s => {
          byUuid.set(s.id, s);
          return {uuid: s.id, type: 0, pageNum: page, layerNum: 0, numInPage: 1, stroke: {}};
        }),
      );
    };
    mockWorker.postSync.mockResolvedValue({
      today: '2026-10-31',
      results: [
        {id: 'task0xx', type: 'done', status: 'ok', detail: 'checked'},
        {id: 'task15xx', type: 'postpone', status: 'ok', detail: 'deadline → 2026-11-01'},
      ],
    });

    await runSync();
    const plan = getUi().plan;
    expect(plan.done.map((r: any) => r.id)).toEqual(['task0xx']);
    expect(plan.skip.map((r: any) => r.id)).toEqual(['task15xx']);
    expect(mockWorker.postSync).not.toHaveBeenCalled(); // nothing goes out before the OK

    await applyPlan(plan);
    expect(mockWorker.postSync).toHaveBeenCalledWith([
      {type: 'done', id: 'task0xx'},
      {type: 'postpone', id: 'task15xx'},
    ]);

    await runSync(); // nothing new the second time
    expect(getUi().plan.done).toHaveLength(0);
    expect(getUi().plan.skip).toHaveLength(0);
  });

  it('reads handwriting on the Notes page and sends the outline', async () => {
    await runNotes();
    const layout = computeLayout(undefined, undefined, 'notes');
    const slotY = (k: number) => layout.writingZone.top + k * layout.lineSpacing + 60;
    const dash = segment(layout.marginLeft + 6, slotY(0) - 15, layout.marginLeft + 40, slotY(0) - 15, 4);
    const strokes = [
      dash,
      word(layout.marginLeft + 70, slotY(0), 90),
      word(layout.marginLeft + 180, slotY(0), 90),
      word(layout.marginLeft + 290, slotY(0), 90),
      word(layout.marginLeft + 400, slotY(0), 90),
    ];
    api.getElements = () =>
      ok(
        strokes.map(s => {
          byUuid.set(s.id, s);
          return {uuid: s.id, type: 0, pageNum: 0, layerNum: 0, numInPage: 1, stroke: {}};
        }),
      );
    mockWorker.postNotes.mockResolvedValue({day: '2026-10-31', imported: 1});

    await runSync();
    const plan = getUi().plan;
    expect(plan.notes).toHaveLength(1);
    expect(plan.notes[0].text).toMatch(/budget/);
    await applyPlan(plan);
    expect(mockWorker.postNotes.mock.calls[0][2]).toEqual([
      {level: 0, text: expect.stringMatching(/budget/), isTask: false},
    ]);
    await runSync();
    expect(getUi().plan.notes).toHaveLength(0);
  });

  it('asks for a Tasks or Notes notebook when another notebook is open', async () => {
    fake.open = '/storage/emulated/0/Note/Other.note';
    await runSync();
    expect(getUi().lines.join('\n')).toMatch(/Open a Tasks or Notes notebook/);
    expect(getUi().plan).toBeNull();
  });
});

describe('SYNC box on the page', () => {
  const tap = (x: number, y: number) => [{stroke: {points: {get: async () => ({x, y})}}}];

  it('a pen tap in the box opens the panel and runs a sync that closes itself after sending', async () => {
    await runTasks();
    fake.calls = [];
    const box = computeLayout().syncBox;
    await handleTap(tap((box.left + box.right) / 2, (box.top + box.bottom) / 2));
    expect(fake.calls).toContain('NativePluginManager.showPluginView');
    expect(getUi().plan).not.toBeNull();
    expect(getUi().closeAfterSend).toBe(true);
  });

  it('a stroke anywhere else does nothing', async () => {
    await runTasks();
    fake.calls = [];
    await handleTap(tap(300, 900));
    expect(fake.calls).toEqual([]);
  });

  it('does nothing in a notebook the plugin did not make', async () => {
    fake.open = '/storage/emulated/0/Note/Tana/Other.note';
    const box = computeLayout().syncBox;
    await handleTap(tap(box.left + 10, box.top + 10));
    expect(fake.calls).not.toContain('NativePluginManager.showPluginView');
  });
});

describe('Self-test', () => {
  it('runs every probe, and keeps going when one call is missing', async () => {
    mockWorker.health.mockResolvedValue({ok: true, tana: 'linked', workspace: 'W'});
    mockWorker.sendReport.mockResolvedValue({});
    const insertText = api.insertText;
    delete (api as any).insertText; // this firmware lacks it
    fake.open = '/storage/emulated/0/Note/Tana/Notes 2026-10-31.note';
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
