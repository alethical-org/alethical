import { describe, expect, it } from 'vitest';
import { lobbyingPageMetadata } from '../lobbyingMetadata';

describe('shared lobbying page titles', () => {
  it('keeps the accepted landing title', () => {
    expect(lobbyingPageMetadata('/money/lobbying', 'Lobbying')).toMatchObject({
      title: 'Lobbying | Alethical',
      socialTitle: 'Lobbying',
      canonicalPath: '/money/lobbying',
      noindex: false,
    });
  });

  it.each(['Principals', 'Lobbyists'])(
    'keeps %s and the numbered page in the shared title',
    (name) => {
      const path = `/money/lobbying/${name.toLowerCase()}`;
      expect(lobbyingPageMetadata(path, name, { kind: 'directory', page: 1 }).title).toBe(
        `${name} — lobbying | Alethical`,
      );
      expect(
        lobbyingPageMetadata(`${path}?page=2`, name, { kind: 'directory', page: 2 }),
      ).toMatchObject({
        title: `${name} — page 2 — lobbying | Alethical`,
        socialTitle: `${name} — page 2 — lobbying`,
        canonicalPath: `${path}?page=2`,
        noindex: false,
      });
    },
  );

  it.each([
    ['principal', 'MN Chamber of Commerce', 'Lobbying principal'],
    ['lobbyist', 'Kozak, Andrew', 'Minnesota lobbyist'],
  ] as const)(
    'keeps the accepted %s title for the browser and shared preview',
    (kind, name, label) => {
      const metadata = lobbyingPageMetadata('/money/lobbying/record', name, { kind });
      expect(metadata).toMatchObject({
        title: `${name} — ${label} | Alethical`,
        socialTitle: `${name} — ${label}`,
      });
      expect(metadata.description).not.toContain(name);
      expect(metadata.description).toBe(
        'Records from the Minnesota Campaign Finance and Public Disclosure Board',
      );
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
      title: 'Principals — page 2 — lobbying | Alethical',
      canonicalPath: '',
      noindex: true,
    });
  });
});
