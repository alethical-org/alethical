import { describe, expect, it } from 'vitest';

import {
  BILL_SEARCH_SORT_OPTIONS,
  BILL_SEARCH_SORT_TO_API,
  resolveBillSearchSort,
} from '../billSearchSort';

describe('Bill Search supports a newest-introduction order', () => {
  it('recognizes the URL value, shows an honest label, and requests the matching API order', () => {
    expect(resolveBillSearchSort('introduced', false)).toBe('introduced');
    expect(BILL_SEARCH_SORT_TO_API.introduced).toBe('introduced');
    expect(BILL_SEARCH_SORT_OPTIONS).toContainEqual({
      key: 'introduced',
      label: 'Introduction date',
    });
  });

  it('keeps the existing defaults for absent and stale values', () => {
    expect(resolveBillSearchSort('', false)).toBe('progress');
    expect(resolveBillSearchSort('', true)).toBe('best');
    expect(resolveBillSearchSort('best', false)).toBe('progress');
    expect(resolveBillSearchSort('not-a-sort', false)).toBe('progress');
  });
});
