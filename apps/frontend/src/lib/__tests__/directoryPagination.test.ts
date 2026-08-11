import { describe, expect, it } from 'vitest';

import {
  directoryJumpPages,
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

  it('adds useful jump points so a deep bill page is not 1,000 clicks away', () => {
    expect(directoryJumpPages(1, 1052)).toEqual([11, 101, 1001, 1052]);
    expect(directoryJumpPages(879, 1052)).toEqual([1, 779, 869, 889, 979, 1052]);
  });

  it('keeps all 1,052 bill pages within 12 directory links of page 1', () => {
    const totalPages = 1052;
    const distance = new Map<number, number>([[1, 0]]);
    const queue = [1];

    while (queue.length > 0) {
      const page = queue.shift()!;
      const neighbours = [
        ...(page > 1 ? [page - 1] : []),
        ...(page < totalPages ? [page + 1] : []),
        ...directoryJumpPages(page, totalPages),
      ];
      for (const neighbour of neighbours) {
        if (!distance.has(neighbour)) {
          distance.set(neighbour, distance.get(page)! + 1);
          queue.push(neighbour);
        }
      }
    }

    expect(distance.size).toBe(totalPages);
    expect(Math.max(...distance.values())).toBeLessThanOrEqual(12);
  });
});
