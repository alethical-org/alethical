import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  FIRST_LOAD_LIMIT,
  checkFirstLoadBudget,
  firstLoadFiles,
  productionBytes,
} from '../check-first-load-budget.mjs';

const BUILT_PAGE = `<html><body>
  <div id="root"></div>
  <script src="/_expo/static/js/web/__expo-metro-runtime-ghi.js" defer></script>
  <script src="/_expo/static/js/web/__common-def.js" defer></script>
  <script src="/_expo/static/js/web/index-abc.js" defer></script>
</body></html>`;

describe('firstLoadFiles', () => {
  it('counts the files the built page names', () => {
    expect(firstLoadFiles(BUILT_PAGE).sort()).toEqual([
      '__common-def.js',
      '__expo-metro-runtime-ghi.js',
      'index-abc.js',
    ]);
  });

  it('never counts a file the page does not name, whatever it is called', () => {
    // Every other built file is fetched later, by the part that needs it, and a
    // reader downloads at most 1 of them per page. Counting them charged a
    // reader 12,529 bytes for a sign-in dialog and an email-link page nobody
    // had opened (#1976).
    const named = firstLoadFiles(BUILT_PAGE);
    expect(named).not.toContain('CommitteeListScreen-jkl.js');
    expect(named).not.toContain('SignInDialog-pqr.js');
    expect(named).not.toContain('EmailLinkPage-stu.js');
    expect(named).not.toContain('index-abc.js.map');
  });

  it('reads nothing from a page with no program on it', () => {
    expect(firstLoadFiles('<html><body><div id="root"></div></body></html>')).toEqual([]);
  });
});

describe('checkFirstLoadBudget', () => {
  it('passes when the first load fits', () => {
    expect(
      checkFirstLoadBudget([
        { name: 'index-abc.js', bytes: 300000 },
        { name: '__common-def.js', bytes: 40000 },
      ]),
    ).toBe(340000);
  });

  it('fails, and names the biggest file, when the first load grows past the limit', () => {
    expect(() =>
      checkFirstLoadBudget(
        [
          { name: 'index-abc.js', bytes: 400000 },
          { name: '__common-def.js', bytes: 60000 },
        ],
        445000,
      ),
    ).toThrow(/460000 bytes[\s\S]*over the 445000-byte limit by 15000[\s\S]*index-abc\.js/);
  });

  it('holds a limit no bigger than what the build produces today', () => {
    // A limit far above the real size would let the file grow back unnoticed,
    // which is the whole reason this check exists.
    // Every figure here is Vercel's own build, because a local build of the same
    // commit reads 542 bytes smaller and a ratchet set from the smaller number is
    // one the hosted build then fails, which stops the deploy
    // ([issue 2052](https://github.com/alethical-org/alethical/issues/2052)).
    // Vercel built 390,761 bytes for commit 01ffcbb0, which is the end-to-end
    // freshness deadline (issue 2023) plus the 2 changes that followed it, so the
    // ratchet sits 739 above that for the next change to spend.
    expect(FIRST_LOAD_LIMIT).toBeLessThanOrEqual(391500);
  });
});

describe('productionBytes', () => {
  it('never reports fewer bytes than production sends', () => {
    // Production compresses at quality 3 with a 19-bit window. A setting that
    // squeezed harder would report a release smaller than the one readers get,
    // which is the one way this check could lie in the direction that matters.
    const source = readFileSync(new URL('../check-first-load-budget.mjs', import.meta.url));
    expect(productionBytes(source)).toBeGreaterThan(
      brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }).length,
    );
  });

  it('measures the way production compresses, not the smallest a file could be', () => {
    const source = 'const a = 1;\n'.repeat(4000);
    const bytes = productionBytes(source);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(Buffer.byteLength(source));
  });
});
