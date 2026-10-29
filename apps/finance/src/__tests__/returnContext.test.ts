import { describe, expect, it } from 'vitest';

import { returnTarget, safeFrom, withFrom } from '../returnContext';
import { hrefFor } from '../routes';

describe('return context', () => {
  it('attaches the earlier page’s own address, with its query', () => {
    expect(withFrom('/search?q=x', '/home?q=hortman')).toBe(
      '/search?q=x&from=%2Fhome%3Fq%3Dhortman',
    );
  });

  it('names the earlier page by its title and opens exactly that address', () => {
    expect(returnTarget('?from=%2Fhome%3Fq%3Dhortman')).toEqual({
      to: '/home?q=hortman',
      name: 'Finance Home',
    });
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
