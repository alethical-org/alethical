import { describe, expect, it } from 'vitest';

import { readerIsSavingData } from '../dataSaving';

const noMedia = () => ({ matches: false });

describe('readerIsSavingData', () => {
  it('holds back when the browser data-saver switch is on', () => {
    expect(
      readerIsSavingData({ navigator: { connection: { saveData: true } }, matchMedia: noMedia }),
    ).toBe(true);
  });

  it.each(['slow-2g', '2g', '3g'])('holds back on a %s connection', (effectiveType) => {
    expect(
      readerIsSavingData({ navigator: { connection: { effectiveType } }, matchMedia: noMedia }),
    ).toBe(true);
  });

  it('holds back when the display setting asks for reduced data', () => {
    expect(
      readerIsSavingData({
        navigator: { connection: {} },
        matchMedia: (query: string) => ({ matches: query === '(prefers-reduced-data: reduce)' }),
      }),
    ).toBe(true);
  });

  it('goes ahead on a fast connection with the switch off', () => {
    expect(
      readerIsSavingData({
        navigator: { connection: { saveData: false, effectiveType: '4g' } },
        matchMedia: noMedia,
      }),
    ).toBe(false);
  });

  it('goes ahead when the browser reports nothing at all', () => {
    expect(readerIsSavingData({})).toBe(false);
    expect(readerIsSavingData({ navigator: {} })).toBe(false);
    expect(readerIsSavingData({ navigator: null })).toBe(false);
  });

  it('goes ahead when a browser throws instead of answering', () => {
    expect(
      readerIsSavingData({
        get navigator(): never {
          throw new Error('blocked');
        },
      }),
    ).toBe(false);
  });
});
