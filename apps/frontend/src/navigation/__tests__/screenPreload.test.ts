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
