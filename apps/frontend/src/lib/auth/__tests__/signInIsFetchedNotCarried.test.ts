import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const FRONTEND = path.resolve(__dirname, '../../../..');

/**
 * Nothing a first page loads may reach sign-in by a plain import.
 *
 * This is the shape of [#1976](https://github.com/alethical-org/alethical/issues/1976),
 * checked rather than remembered: sign-in is about 260,000 minified bytes and a
 * reader who is not signed in and is not signing in uses none of it. One plain
 * import anywhere in the app's own startup path puts all of it back into every
 * reader's first download, and nothing about that import would look wrong.
 *
 * The byte limit in `scripts/check-first-load-budget.mjs` would also catch it, in
 * a number with no explanation attached. This says which import did it.
 */

/** Where a relative import actually points, trying the extensions Metro tries. */
function resolveImport(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    `${base}.web.tsx`,
    `${base}.web.ts`,
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, 'index.web.tsx'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.web.ts'),
    path.join(base, 'index.ts'),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next extension.
    }
  }
  return null;
}

/**
 * Every file a page can reach by plain imports, from the app's own start and from
 * each screen. A `import()` is a separate download and stops the walk, which is
 * the whole point of the pattern.
 *
 * **The screens have to be in here, and leaving them out is how this guard first
 * failed to work.** Anything 2 screens both import is put in a shared file that
 * every page fetches, so it costs a first load exactly as the app's own start
 * does. The top bar is the case that proved it: it moved out of the start path
 * into that shared file, and a walk from `index.ts` alone then declared the top
 * bar's import of the account menu clean.
 */
function everyPageReachableFile(): string[] {
  const seen = new Set<string>();
  const queue = [path.join(FRONTEND, 'index.ts'), ...screenFiles()];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // Blank out every `import(...)`, so a fetched download is not walked into.
    const plain = source.replace(/import\(\s*(['"])([^'"]+)\1\s*\)/g, '');
    const specifiers = new Set<string>();
    for (const match of plain.matchAll(
      /(?:^|\n)\s*(?:import|export)(?!\s+type\b)[\s\S]{0,4000}?from\s*['"]([^'"]+)['"]/g,
    )) {
      specifiers.add(match[1]);
    }
    for (const match of plain.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
      specifiers.add(match[1]);
    }
    for (const specifier of specifiers) {
      const resolved = resolveImport(specifier, file);
      if (resolved) queue.push(resolved);
    }
  }
  return [...seen].map((file) => path.relative(FRONTEND, file));
}

/** Every screen the router can show, read off the loaders that fetch them. */
function screenFiles(): string[] {
  const loaders = path.join(FRONTEND, 'src/navigation/screenChunks.ts');
  const source = readFileSync(loaders, 'utf8');
  const files: string[] = [];
  for (const match of source.matchAll(/import\(\s*(['"])([^'"]+)\1\s*\)/g)) {
    const resolved = resolveImport(match[2], loaders);
    if (resolved) files.push(resolved);
  }
  expect(files.length).toBeGreaterThan(20);
  return files;
}

describe('sign-in is fetched, not carried by every page', () => {
  const carried = everyPageReachableFile();

  it.each([
    ['the sign-in client', 'src/lib/supabase.web.ts'],
    ['the sign-in dialog', 'src/components/auth/SignInDialog.tsx'],
    ['the dialog and its flows', 'src/providers/SignInMachinery.tsx'],
    ['the account menu and password dialog', 'src/components/auth/AccountControl.tsx'],
    ['the email-link page', 'src/screens/auth/EmailLinkPage.tsx'],
    ['the password field', 'src/components/auth/PasswordField.tsx'],
    ['the sign-in form frame', 'src/components/auth/SignInContainer.tsx'],
    ['everything sign-in, together', 'src/lib/auth/signInBundle.ts'],
  ])('does not carry %s', (_what, file) => {
    expect(carried).not.toContain(file);
  });

  it('carries the tiny fetcher and the question of whether to ask', () => {
    expect(carried).toContain('src/lib/auth/loadSignInBundle.ts');
    expect(carried).toContain('src/lib/auth/signInWorkPending.ts');
  });

  it('names the sign-in download in exactly 1 place', () => {
    // Two names for it would be 2 downloads, and the web build then moves their
    // shared middle — the sign-in client included — into the file every page
    // fetches, undoing the whole change.
    const namesIt = walkSource().filter((file) =>
      /import\(\s*(['"])[^'"]*signInBundle\1\s*\)/.test(
        readFileSync(path.join(FRONTEND, file), 'utf8'),
      ),
    );
    expect(namesIt).toEqual(['src/lib/auth/loadSignInBundle.ts']);
  });

  it('builds a sign-in client in only the 2 files that need to', () => {
    const constructs = walkSource().filter((file) =>
      /^import \{[^}]*\bAuthClient\b/m.test(readFileSync(path.join(FRONTEND, file), 'utf8')),
    );
    expect(constructs.sort()).toEqual([
      'src/lib/auth/temporaryAuthClient.ts',
      'src/lib/supabase.web.ts',
    ]);
  });
});

/** Every source file under `src/`, tests aside. */
function walkSource(): string[] {
  const out: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(path.relative(FRONTEND, full));
      }
    }
  };
  walk(path.join(FRONTEND, 'src'));
  return out;
}
