import { describe, expect, it } from 'vitest';

import { billDetailNeedsVotes, billDetailVotePrefetchIsUseful } from '../billDetailRequestMode';

describe('bill detail request mode', () => {
  it.each(['summary', 'text', 'versions'] as const)(
    'keeps votes out of a desktop %s visit',
    (tab) => {
      expect(billDetailNeedsVotes(true, tab)).toBe(false);
      expect(billDetailVotePrefetchIsUseful(tab)).toBe(false);
    },
  );

  it.each(['actions', 'votes'] as const)('loads votes for a desktop %s visit', (tab) => {
    expect(billDetailNeedsVotes(true, tab)).toBe(true);
    expect(billDetailVotePrefetchIsUseful(tab)).toBe(true);
  });

  it.each(['summary', 'actions', 'votes', 'text', 'versions'] as const)(
    'keeps votes on the single-page phone %s visit',
    (tab) => expect(billDetailNeedsVotes(false, tab)).toBe(true),
  );
});
