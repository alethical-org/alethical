import { describe, expect, it } from 'vitest';

import {
  directoryPageIsOutOfRange,
  directoryPageNumber,
  directoryPagePath,
  directoryTotalPages,
  isDefaultBillDirectoryParams,
} from '../directoryPagination';

describe('public directory pagination', () => {
  it('uses page 1 for missing, invalid, and non-positive page text', () => {
    for (const value of [undefined, '', 'words', '0', '-2']) {
      expect(directoryPageNumber(value)).toBe(1);
    }
  });

  it('keeps later safe page numbers', () => {
    expect(directoryPageNumber('2')).toBe(2);
    expect(directoryPageNumber('17')).toBe(17);
    expect(directoryPageNumber('9007199254740992')).toBe(1);
  });

  it('keeps page 1 at the plain address and names later pages', () => {
    expect(directoryPagePath('/bills', 1)).toBe('/bills');
    expect(directoryPagePath('/bills', 2)).toBe('/bills?page=2');
    expect(directoryPagePath('/legislators', 3)).toBe('/legislators?page=3');
  });

  it('always has at least 1 page, including an empty directory', () => {
    expect(directoryTotalPages(0, 10)).toBe(1);
    expect(directoryTotalPages(10, 10)).toBe(1);
    expect(directoryTotalPages(11, 10)).toBe(2);
  });

  it('recognises a page beyond the last real directory page', () => {
    expect(directoryPageIsOutOfRange(1, 10, 10)).toBe(false);
    expect(directoryPageIsOutOfRange(2, 10, 10)).toBe(true);
    expect(directoryPageIsOutOfRange(2, 0, 10)).toBe(true);
  });

  it('treats explicit resting Bills settings as the same unfiltered directory', () => {
    expect(isDefaultBillDirectoryParams({ page: '2' })).toBe(true);
    expect(
      isDefaultBillDirectoryParams({ page: '2', scope: 'legislature', sort: 'progress' }),
    ).toBe(true);
    expect(isDefaultBillDirectoryParams({ page: '2', q: 'water' })).toBe(false);
    expect(isDefaultBillDirectoryParams({ page: '2', sort: 'introduced' })).toBe(false);
  });
});
