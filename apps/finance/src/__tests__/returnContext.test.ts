import { describe, expect, it } from 'vitest';

import { returnTarget, safeFrom, withFrom } from '../returnContext';
import { hrefFor } from '../routes';

describe('return context', () => {
  it('attaches the earlier page’s own address, with its query', () => {
    expect(withFrom('/search?q=x', '/home?q=hortman')).toBe(
      '/search?q=x&from=%2Fhome%3Fq%3Dhortman',
    );
  });

  it('names Home by its heading and opens exactly that address', () => {
    expect(returnTarget('?from=%2Fhome%3Fq%3Dhortman')).toEqual({
      to: '/home?q=hortman',
      name: 'Research public records',
    });
  });

  it('names any other page by its title', () => {
    expect(returnTarget('?from=%2Fmoney')?.name).toBe('Campaign money');
  });

  it.each([
    'https://example.com/',
    '//example.com/home',
    '/\\example.com',
    '/sign-in',
    '/',
    '/nope',
  ])('refuses %s as an earlier page', (value) => {
    expect(safeFrom(value)).toBeNull();
    expect(withFrom('/home', value)).toBe('/home');
  });

  it('keeps the nearest filtered pages when the fourth earlier page is trimmed', () => {
    const top = '/media-buys?tab=stations';
    const station = withFrom('/media-buys/stations/kare', top);
    const filtered = withFrom('/media-buys?station=KARE&year=2025', station);
    const folder = withFrom('/media-buys/folders/kare-folder', filtered);
    const file = withFrom('/media-buys/files/kare-file?version=held&page=2', folder);
    const backFolder = returnTarget(new URL(file, 'https://finance.test').search)!;
    expect(backFolder.to.split('?')[0]).toBe('/media-buys/folders/kare-folder');
    const backList = returnTarget(new URL(backFolder.to, 'https://finance.test').search)!;
    expect(backList.to).toContain('station=KARE&year=2025');
    const backStation = returnTarget(new URL(backList.to, 'https://finance.test').search)!;
    expect(backStation.to).toBe('/media-buys/stations/kare');
    expect(returnTarget(new URL(backStation.to, 'https://finance.test').search)).toBeNull();
    expect(new URL(file, 'https://finance.test').searchParams.get('version')).toBe('held');
    expect(new URL(file, 'https://finance.test').searchParams.get('page')).toBe('2');
  });

  it('preserves encoded search text and section anchors while trimming the oldest page', () => {
    const top = '/home?q=old';
    const station = withFrom('/media-buys/stations/kare?view=held#records', top);
    const list = withFrom('/media-buys?station=KARE&year=2025&q=A%26B%3F%25#folders', station);
    const folder = withFrom('/media-buys/folders/kare-folder#files', list);
    const file = withFrom('/media-buys/files/kare-file?version=held#facts', folder);
    const fileUrl = new URL(file, 'https://finance.test');
    expect(fileUrl.hash).toBe('#facts');
    const folderUrl = new URL(returnTarget(fileUrl.search)!.to, fileUrl);
    expect(folderUrl.hash).toBe('#files');
    const listUrl = new URL(returnTarget(folderUrl.search)!.to, fileUrl);
    expect(listUrl.hash).toBe('#folders');
    expect(listUrl.searchParams.get('q')).toBe('A&B?%');
    const stationUrl = new URL(returnTarget(listUrl.search)!.to, fileUrl);
    expect(stationUrl.hash).toBe('#records');
    expect(stationUrl.searchParams.get('view')).toBe('held');
    expect(stationUrl.searchParams.has('from')).toBe(false);
  });

  it('keeps at most 3 earlier pages', () => {
    let address = '/home?step=0';
    for (let step = 1; step <= 6; step += 1) address = withFrom(`/home?step=${step}`, address);
    let depth = 0;
    let current: string | null = address;
    while (current) {
      const query: string = current.includes('?') ? current.slice(current.indexOf('?') + 1) : '';
      current = new URLSearchParams(query).get('from');
      if (current) depth += 1;
    }
    expect(depth).toBeLessThanOrEqual(3);
  });
});

describe('hrefFor', () => {
  it('fills a pattern, encoding each part, and adds only the query values given', () => {
    expect(hrefFor('payments-under-name', { query: 'A/B & C' }, { role: 'donor', year: '' })).toBe(
      '/money/names/A%2FB%20%26%20C?role=donor',
    );
  });

  it('refuses a missing parameter', () => {
    expect(() => hrefFor('committee')).toThrow('committee needs id');
  });
});
