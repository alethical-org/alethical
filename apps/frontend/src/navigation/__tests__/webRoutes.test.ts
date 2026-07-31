// Where a typed-in or bookmarked URL actually lands.
//
// Several paths in this app point at screens from the pre-redesign build. They
// still exist in the code, but none of them may render: a visitor who follows an
// old link has to arrive somewhere shipped, not on a page with no nav, no footer
// and no way back. `targetFromPathname` is the single place that decision is
// made, so the redirects below are pinned here rather than left to whoever next
// edits the routing switch.

import { describe, expect, it } from 'vitest';

import { IA, navDropdownItems } from '../ia';
import { pathForRoute, targetFromPathname } from '../webRoutes';

describe('old-design URLs land on a shipped page', () => {
  it('sends a standalone vote link to that bill’s Votes tab', () => {
    // The Vote Detail screen was cut before v0 (#38) but its URL kept resolving to
    // it. Every recorded roll call lives on the bill's Votes tab now (#83), so the
    // link still lands on the vote it named — just in the shipped design.
    expect(
      targetFromPathname('/bills/94-2025-SF334/votes/3cacafdb-debc-48b9-b654-0faad04dc716'),
    ).toEqual({ kind: 'bill', billId: '94-2025-SF334', tab: 'votes' });
  });

  it('keeps the bill id readable when the URL escaped it', () => {
    expect(targetFromPathname('/bills/a%20b/votes/v%201')).toEqual({
      kind: 'bill',
      billId: 'a b',
      tab: 'votes',
    });
  });

  it.each([['/tracked'], ['/account'], ['/chat'], ['/chat/new'], ['/chat/sessions/abc-123']])(
    'sends %s to the home page',
    (path) => {
      expect(targetFromPathname(path)).toEqual({ kind: 'tab', screen: 'Home' });
    },
  );

  it('sends the old search page to the bill list', () => {
    expect(targetFromPathname('/search')).toEqual({ kind: 'bills', params: {} });
  });
});

describe('live URLs still resolve to themselves', () => {
  it('leaves a plain bill link alone', () => {
    expect(targetFromPathname('/bills/94-2025-SF334')).toEqual({
      kind: 'bill',
      billId: '94-2025-SF334',
      tab: undefined,
      track: undefined,
    });
  });

  it('carries a tab the visitor asked for', () => {
    expect(targetFromPathname('/bills/94-2025-SF334?tab=text')).toMatchObject({
      kind: 'bill',
      tab: 'text',
    });
  });

  it('resolves the pages that have no redesigned replacement', () => {
    expect(targetFromPathname('/privacy')).toEqual({ kind: 'privacy' });
    expect(targetFromPathname('/terms')).toEqual({ kind: 'terms' });
  });
});

// Find My Legislator writes its own URL into the address bar, so that URL has to
// read back as the same screen — reloading, bookmarking or sharing it used to
// dump the visitor on Home instead (#764). The address the visitor typed rides
// in ?address= so the results are shareable too (grounded-answers.md rule 5).
describe('Find My Legislator round-trips through its URL', () => {
  it('resolves its own path instead of redirecting to Home', () => {
    expect(targetFromPathname('/find-my-legislator')).toEqual({
      kind: 'findMyLegislator',
      address: undefined,
    });
  });

  it('carries the address the visitor searched for', () => {
    expect(
      targetFromPathname('/find-my-legislator?address=350%20S%205th%20St%2C%20Minneapolis%2C%20MN'),
    ).toEqual({ kind: 'findMyLegislator', address: '350 S 5th St, Minneapolis, MN' });
  });

  it('writes back the same URL it reads', () => {
    const address = '350 S 5th St, Minneapolis, MN 55415';
    const path = pathForRoute({ name: 'FindMyLegislator', params: { address } });
    expect(path).toBe(
      '/find-my-legislator?address=350%20S%205th%20St%2C%20Minneapolis%2C%20MN%2055415',
    );
    expect(targetFromPathname(path)).toEqual({ kind: 'findMyLegislator', address });
  });

  it('leaves the address out when there is none to carry', () => {
    expect(pathForRoute({ name: 'FindMyLegislator' })).toBe('/find-my-legislator');
  });

  // The nav used to grey it out as "on the roadmap" while the desktop rail sent
  // people straight to it — the product saying two different things about the
  // same screen (#764). Now it is a live Search row.
  it('is offered as a live Search row, not a greyed roadmap pill', () => {
    const { live, roadmap } = navDropdownItems('search');
    expect(live.map((item) => item.id)).toContain('search-find-my-legislator');
    expect(roadmap.map((item) => item.id)).not.toContain('search-find-my-legislator');
  });

  // Districts are drawn below city level and the lookup's geocoder only matches a
  // house number + street, so nothing user-facing may offer a city or an "area"
  // (grounded-answers.md rule 2, never advertise what you can't answer).
  it('does not offer a city or an area it cannot look up', () => {
    const item = IA.find((entry) => entry.id === 'search-find-my-legislator');
    expect(item?.description).toBe('See who represents you — by street address');
  });
});
