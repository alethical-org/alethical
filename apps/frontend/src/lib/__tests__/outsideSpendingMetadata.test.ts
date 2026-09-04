import { describe, expect, it } from 'vitest';

import { outsideSpendingPageMetadata } from '../share';

// The outside-spending record's head (#1945): the bare address is one record and
// may be listed; every filtered view of the same rows is head only with noindex
// (docs/architecture/page-metadata-for-search-and-sharing-decisions.md §22).
describe('the outside-spending record’s page metadata', () => {
  it('lists the whole record on its own canonical address', () => {
    const head = outsideSpendingPageMetadata({});
    expect(head.noindex).toBe(false);
    expect(head.canonicalPath).toBe('/money/outside-spending');
    expect(head.title).toMatch(/^Outside spending/);
    expect(head.title.toLowerCase()).not.toContain('explorer');
  });

  it('keeps a subject’s view and any filter out of the index', () => {
    const filtered: Record<string, string>[] = [
      { spender: '30558' },
      { about: '18129' },
      { year: '2026' },
      { sort: 'largest' },
      { page: '2' },
    ];
    for (const params of filtered) {
      const head = outsideSpendingPageMetadata(params);
      expect(head.noindex).toBe(true);
      expect(head.canonicalPath).toBe('');
    }
  });
});
