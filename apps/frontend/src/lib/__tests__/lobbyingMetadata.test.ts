import { describe, expect, it } from 'vitest';
import { lobbyingPageMetadata } from '../lobbyingMetadata';

describe('shared lobbying page titles', () => {
  it('names the state in the landing title and says what the section holds', () => {
    expect(lobbyingPageMetadata('/money/lobbying', 'Lobbying')).toMatchObject({
      title: 'Lobbying in Minnesota | Alethical',
      socialTitle: 'Lobbying in Minnesota',
      canonicalPath: '/money/lobbying',
      noindex: false,
    });
    expect(lobbyingPageMetadata('/money/lobbying', 'Lobbying').description).toContain(
      'Campaign Finance and Public Disclosure Board',
    );
  });

  it.each(['Principals', 'Lobbyists'])(
    'keeps %s and the numbered page in the shared title, with its own description',
    (name) => {
      const path = `/money/lobbying/${name.toLowerCase()}`;
      const first = lobbyingPageMetadata(path, name, { kind: 'directory', page: 1 });
      expect(first.title).toBe(`${name} — Minnesota lobbying | Alethical`);
      expect(first.description).not.toContain('Page');
      const second = lobbyingPageMetadata(`${path}?page=2`, name, { kind: 'directory', page: 2 });
      expect(second).toMatchObject({
        title: `${name} — page 2 — Minnesota lobbying | Alethical`,
        socialTitle: `${name} — page 2 — Minnesota lobbying`,
        canonicalPath: `${path}?page=2`,
        noindex: false,
      });
      expect(second.description.endsWith(' Page 2.')).toBe(true);
      // The 2 directories show different things, so they say different things.
      expect(second.description).toContain(
        name === 'Lobbyists'
          ? 'recorded campaign donations for a completed year'
          : 'reported lobbying spending',
      );
    },
  );

  it.each([
    [
      'principal',
      'MN Chamber of Commerce',
      'Minnesota lobbying principal',
      'spending reported by year',
    ],
    ['lobbyist', 'Kozak, Andrew', 'Minnesota lobbyist', 'registered to represent'],
  ] as const)(
    'gives a %s record a state-qualified title and a kind-specific description without the name',
    (kind, name, label, promise) => {
      const metadata = lobbyingPageMetadata('/money/lobbying/record', name, { kind });
      expect(metadata).toMatchObject({
        title: `${name} — ${label} | Alethical`,
        socialTitle: `${name} — ${label}`,
      });
      // The title already carries the name; the description says what the page shows.
      expect(metadata.description).not.toContain(name);
      expect(metadata.description).toContain(promise);
      expect(metadata.description).toContain('Campaign Finance and Public Disclosure Board');
      expect(metadata.description).not.toContain('Alethical');
    },
  );

  it('keeps the viewed page in a filtered title without indexing the filter address', () => {
    expect(
      lobbyingPageMetadata('/money/lobbying/principals?q=Assn&page=2', 'Principals', {
        kind: 'directory',
        page: 2,
        noindex: true,
      }),
    ).toMatchObject({
      title: 'Principals — page 2 — Minnesota lobbying | Alethical',
      canonicalPath: '',
      noindex: true,
    });
  });
});
