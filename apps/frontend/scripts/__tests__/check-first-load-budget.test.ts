import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  FIRST_LOAD_LIMIT,
  checkFirstLoadBudget,
  firstLoadFiles,
  productionBytes,
} from '../check-first-load-budget.mjs';

describe('firstLoadFiles', () => {
  it('counts the files a page names in its HTML and no screen file', () => {
    expect(
      firstLoadFiles([
        'index-abc.js',
        '__common-def.js',
        '__expo-metro-runtime-ghi.js',
        'CommitteeListScreen-jkl.js',
        'HomeSignedOutScreen-mno.js',
        'index-abc.js.map',
      ]).sort(),
    ).toEqual(['__common-def.js', '__expo-metro-runtime-ghi.js', 'index-abc.js']);
  });
});

describe('checkFirstLoadBudget', () => {
  it('passes when the first load fits', () => {
    expect(
      checkFirstLoadBudget([
        { name: 'index-abc.js', bytes: 400000 },
        { name: '__common-def.js', bytes: 40000 },
      ]),
    ).toBe(440000);
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
    expect(FIRST_LOAD_LIMIT).toBeLessThanOrEqual(453000);
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
