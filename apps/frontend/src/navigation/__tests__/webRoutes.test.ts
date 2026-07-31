// Where a typed-in or bookmarked URL actually lands.
//
// Several paths in this app point at screens from the pre-redesign build. They
// still exist in the code, but none of them may render: a visitor who follows an
// old link has to arrive somewhere shipped, not on a page with no nav, no footer
// and no way back. `targetFromPathname` is the single place that decision is
// made, so the redirects below are pinned here rather than left to whoever next
// edits the routing switch.

import { describe, expect, it } from 'vitest';

import { targetFromPathname } from '../webRoutes';

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

  it.each([
    ['/tracked'],
    ['/account'],
    ['/chat'],
    ['/chat/new'],
    ['/chat/sessions/abc-123'],
    ['/find-my-legislator'],
  ])('sends %s to the home page', (path) => {
    expect(targetFromPathname(path)).toEqual({ kind: 'tab', screen: 'Home' });
  });

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
