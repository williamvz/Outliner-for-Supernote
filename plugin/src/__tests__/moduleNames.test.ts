import {readdirSync, statSync} from 'fs';
import {join, parse} from 'path';

/**
 * Metro tries the source extensions in the order js, jsx, json, ts, tsx, so
 * `import './layout'` picks layout.json over layout.ts. On the device that
 * made computeLayout undefined ("undefined is not a function") in the first
 * four builds, while Jest, which tries ts before json, never noticed. Keep
 * data files and code files from sharing a name.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('module names', () => {
  it('has no .json file next to a .js/.jsx/.ts/.tsx file of the same name', () => {
    const byKey = new Map<string, string[]>();
    for (const file of files(join(__dirname, '..'))) {
      const {dir, name, ext} = parse(file);
      byKey.set(join(dir, name), [...(byKey.get(join(dir, name)) ?? []), ext]);
    }
    const clashes = [...byKey]
      .filter(([, exts]) => exts.includes('.json') && exts.some(e => ['.js', '.jsx', '.ts', '.tsx'].includes(e)))
      .map(([key]) => key);
    expect(clashes).toEqual([]);
  });
});
