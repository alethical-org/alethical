import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { piecePath, piecesLabelledGuide, piecesLabelledResearch } from '../../lib/research';
import { screenChunks } from '../screenChunks';
import { screenLoaderForPath, screenNameForPath } from '../screenPreload';

describe('screenNameForPath', () => {
  it('names the screen each money address lands on', () => {
    expect(screenNameForPath('/money')).toBe('MoneyLanding');
    expect(screenNameForPath('/money/committees')).toBe('CommitteeList');
    expect(screenNameForPath('/money/races')).toBe('MoneyByRace');
    expect(screenNameForPath('/money/outside-spending')).toBe('OutsideSpending');
  });

  it('reads the tab underneath the site root', () => {
    expect(screenNameForPath('/')).toBe('Home');
    expect(screenNameForPath('/tracked')).toBe('Tracked');
  });

  it('names the deepest screen, not the home page beneath it', () => {
    expect(screenNameForPath('/bills/HF1')).toBe('BillDetail');
    expect(screenNameForPath('/legislators')).toBe('Legislators');
  });

  // The address's query string decides this screen. Reading the pathname alone
  // fetched the not-found page's file on every payments-by-name visit and left the
  // real screen waiting behind React's 300 ms marker (17 Sep 2026).
  it('reads the query string, which alone tells payments-by-name from not-found', () => {
    expect(screenNameForPath('/money/payments?name=Larsen%2C+Mary+Lu&role=contributor')).toBe(
      'PaymentsUnderName',
    );
    expect(screenNameForPath('/money/payments')).toBe('NotFound');
  });
});

describe('screenLoaderForPath', () => {
  it('finds a downloadable screen for every address the router can reach', () => {
    for (const path of [
      '/',
      '/tracked',
      '/bills',
      '/bills/HF1',
      '/legislators',
      '/find-my-legislator',
      '/money',
      '/money/committees',
      '/money/races',
      '/money/outside-spending',
      '/money/search',
      '/read',
      '/about',
      '/contact',
      '/privacy',
      '/terms',
      '/this-address-does-not-exist',
    ]) {
      expect(screenLoaderForPath(path), path).toBeTypeOf('function');
    }
  });

  it('sends a guide to the same screen a research piece uses', () => {
    // Both addresses are one screen, so both wait on one download.
    const guide = piecesLabelledGuide()[0];
    const research = piecesLabelledResearch()[0];
    expect(screenLoaderForPath(piecePath(guide))).toBe(screenChunks.Research);
    expect(screenLoaderForPath(piecePath(research))).toBe(screenChunks.Research);
  });
});

describe('fetching a screen ahead of time', () => {
  const sourceOf = (...parts: string[]) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', ...parts), 'utf8');

  // Calling a loader directly downloads the piece and leaves nothing behind, so
  // the screen asks for it again and draws a frame late
  // (https://github.com/alethical-org/alethical/issues/2222). Going through
  // `loadAndRemember` is what lets the screen draw straight away.
  it('goes through the loader that remembers what arrived', () => {
    const source = sourceOf('screenPreload.ts');
    expect(source).toContain("import { loadAndRemember } from '../lib/loadOnDemand'");
    expect(source).not.toMatch(/(?<!AndRemember\()\bload\(\)/);
  });

  // The warming written for the money pages called its loaders directly, so the
  // 3 destinations it warms downloaded their screens and still drew a frame
  // late. The same mistake is easy to make again in the same file
  // (https://github.com/alethical-org/alethical/issues/1988).
  it('warms a money destination through that same loader', () => {
    const source = sourceOf('..', 'hooks', 'useAppQueries.ts');
    expect(source).toContain("import { loadAndRemember } from '../lib/loadOnDemand'");
    expect(source).not.toMatch(/(?<!AndRemember\()\bload\(\)/);
    expect(source).not.toMatch(/screenLoaderForPath\([^\n]*\)\?\.\(\)/);
  });
});
