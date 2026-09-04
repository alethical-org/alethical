import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `api/page.ts` is a Vercel Node function that serves the first response of every
 * page on the site. A value import anywhere in its import graph that reaches
 * `react-native` (or an Expo package) cannot load in Node, and the crash is at
 * module load, so it takes down every address at once — which is what happened on
 * 4 Sep 2026 when the function imported `apps/frontend/src/data/api.ts` for one
 * parser. Vitest resolves `react-native` fine, so `pageEndpoint.test.ts` cannot see
 * it; this walks the source graph instead.
 */
const REPO_ROOT = resolve(__dirname, '../../../../..');
const ENTRY = resolve(REPO_ROOT, 'api/page.ts');
const FORBIDDEN = /^(react-native|expo|@expo\/|@react-native|@react-navigation|@supabase\/)/;

const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\s)[^'"]*?\sfrom\s+['"]([^'"]+)['"]/gm;
const SIDE_EFFECT_IMPORT_RE = /^\s*import\s+['"]([^'"]+)['"]/gm;

function resolveRelative(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.web.ts`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

function valueImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  for (const re of [IMPORT_RE, SIDE_EFFECT_IMPORT_RE]) {
    re.lastIndex = 0;
    for (const match of source.matchAll(re)) specifiers.push(match[1]);
  }
  return specifiers;
}

describe('the page function stays loadable in Node', () => {
  it('reaches no react-native or Expo module through any value import', () => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    const queue = [ENTRY];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const specifier of valueImports(file)) {
        if (specifier.startsWith('.')) {
          const target = resolveRelative(file, specifier);
          if (target) queue.push(target);
        } else if (FORBIDDEN.test(specifier)) {
          offenders.push(`${file.replace(`${REPO_ROOT}/`, '')} imports ${specifier}`);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  it('would have caught the 4 Sep 2026 outage: data/api.ts imports react-native', () => {
    const api = resolve(REPO_ROOT, 'apps/frontend/src/data/api.ts');
    expect(valueImports(api)).toContain('react-native');
  });
});
