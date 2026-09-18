import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  FIRST_LOAD_LIMIT,
  checkFirstLoadBudget,
  firstLoadCarriesItsSettings,
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

  it('counts a single startup file without charging for later screen code', () => {
    const html = '<script src="/_expo/static/js/web/index-abc.js" defer></script>';
    expect(firstLoadFiles(html)).toEqual(['index-abc.js']);
    expect(checkFirstLoadBudget([{ name: firstLoadFiles(html)[0], bytes: 295283 }])).toBe(295283);
  });

  it('never counts a file the page does not name, whatever it is called', () => {
    // Every other built file is fetched later, by the part that needs it, and a
    // reader fetches the screen and later details it needs. Counting them charged a
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
      checkFirstLoadBudget(
        [
          { name: 'index-abc.js', bytes: 300000 },
          { name: '__common-def.js', bytes: 40000 },
        ],
        350000,
      ),
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
        // Read as a build that inlined its settings, so this case stays about the
        // message and its numbers rather than about the projection, which has its
        // own cases below.
        true,
      ),
    ).toThrow(/460000 bytes[\s\S]*over the 445000-byte limit by 15000[\s\S]*index-abc\.js/);
  });

  it('reports the actual hosted preview size without predicting production from a fixed offset', () => {
    // Same code, hosted on 14 Sep: preview 338,978, production 338,820, against
    // that day's 339,072 limit. The retired +542 estimate rejected the preview at a
    // fictional 339,520.
    expect(
      checkFirstLoadBudget([{ name: 'index-preview.js', bytes: 338_978 }], 339_072, false),
    ).toBe(338_978);
    expect(
      checkFirstLoadBudget([{ name: 'index-production.js', bytes: 338_820 }], 339_072, true),
    ).toBe(338_820);
  });

  it('requires production to pass its own measured size even when a smaller build passes', () => {
    expect(checkFirstLoadBudget([{ name: 'index-local.js', bytes: 389_961 }], 390_500, false)).toBe(
      389_961,
    );
    expect(() =>
      checkFirstLoadBudget([{ name: 'index-production.js', bytes: 390_761 }], 390_500, true),
    ).toThrow(/390761 bytes[\s\S]*over the 390500-byte limit by 261/);
  });

  it('enforces the same hard boundary with or without settings', () => {
    for (const hasSettings of [false, true]) {
      expect(
        checkFirstLoadBudget(
          [{ name: 'index.js', bytes: FIRST_LOAD_LIMIT }],
          FIRST_LOAD_LIMIT,
          hasSettings,
        ),
      ).toBe(FIRST_LOAD_LIMIT);
      expect(() =>
        checkFirstLoadBudget(
          [{ name: 'index.js', bytes: FIRST_LOAD_LIMIT + 1 }],
          FIRST_LOAD_LIMIT,
          hasSettings,
        ),
      ).toThrow(/over the 296022-byte limit by 1/);
    }
  });

  it('does not let a settings-less build establish a production limit', () => {
    expect(() =>
      checkFirstLoadBudget([{ name: 'index.js', bytes: 500_000 }], 1_000, false),
    ).toThrow(/from Vercel’s hosted production measurement, never from a local build/);
  });

  /**
   * The correction to the first version of this, which keyed on `VERCEL=1`. The
   * excess belongs to a build that inlined no settings, not to a build that ran
   * somewhere particular: the main checkout holds a `.env`, so a build there is
   * already the size the host produces and adding the excess would fail a build
   * that would have deployed.
   */
  it('reads whether the settings were inlined off the program itself', () => {
    // Measured 8 Sep 2026: the live program carries a Supabase address and a
    // worktree's build carries none.
    expect(firstLoadCarriesItsSettings('a=\"https://abc.supabase.co\";')).toBe(true);
    expect(firstLoadCarriesItsSettings('a=\"\";b=2;')).toBe(false);
    // Not fooled by the setting's NAME appearing without a value, which is what a
    // build with no settings file still contains.
    expect(firstLoadCarriesItsSettings('EXPO_PUBLIC_SUPABASE_URL')).toBe(false);
  });

  it('leaves room above the hosted production measurement', () => {
    // The hosted production build of merge commit a092f832 serves its program file
    // as 295,283 Brotli bytes (read off www.alethical.com, 18 September 2026).
    expect(FIRST_LOAD_LIMIT).toBeGreaterThanOrEqual(295_283);
    expect(FIRST_LOAD_LIMIT - 295_283).toBe(739);
  });

  it('keeps the ratchet at the hosted figure plus its existing headroom', () => {
    expect(FIRST_LOAD_LIMIT).toBeLessThanOrEqual(296_022);
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
