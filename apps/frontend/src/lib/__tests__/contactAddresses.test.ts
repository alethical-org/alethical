import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The only alethical.com addresses that exist. `ask@` is the published contact
// address, verified against the live production bundle on 6 Aug 2026; `eug@` is
// the maintainer's own and appears in repo metadata rather than reader-facing
// copy. Anything else in the source is invented.
//
// Why this test exists: a session drafting lockout copy wrote `hello@alethical.com`
// from memory into user-facing text (#1092). It was caught by an unrelated guard
// in signIn.test.ts that asserts sign-in copy never promises email -- the word
// "email" happened to sit next to it. That is luck. The same fabrication in a
// sentence without a trigger word would have shipped a contact address that
// bounces, which is worse than a typo: a reader who writes to it believes they
// have reached us. `.claude/rules/workflow.md` rule 9 requires resolving a
// factual claim from its primary source rather than from memory, and a contact
// address is exactly that kind of claim.
const ALLOWED = new Set(['ask@alethical.com', 'eug@alethical.com']);

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === '__tests__' || entry === 'fixtures' ? [] : sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe('alethical.com contact addresses in the app source', () => {
  it('only ever uses an address that actually exists', () => {
    const found = new Map<string, string[]>();

    for (const file of sourceFiles(SRC)) {
      const matches = readFileSync(file, 'utf8').match(/[a-zA-Z0-9._%+-]+@alethical\.com/g);
      for (const address of matches ?? []) {
        if (ALLOWED.has(address)) continue;
        found.set(address, [...(found.get(address) ?? []), file.slice(SRC.length + 1)]);
      }
    }

    // Name the offender and its file, so the failure says what to fix rather
    // than only that something is wrong.
    expect(
      [...found].map(([address, files]) => `${address} (${files.join(', ')})`),
      'invented alethical.com address in app source',
    ).toEqual([]);
  });

  it('still finds the published address, so the check cannot pass by scanning nothing', () => {
    const all = sourceFiles(SRC).flatMap(
      (file) => readFileSync(file, 'utf8').match(/[a-zA-Z0-9._%+-]+@alethical\.com/g) ?? [],
    );

    expect(all).toContain('ask@alethical.com');
  });
});
