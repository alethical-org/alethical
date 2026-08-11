import { describe, expect, it } from 'vitest';
import { loadedDirectoryPageIsOutOfRange } from '../directoryPagination';

describe('directory page status after the app loads', () => {
  it('shows 404 only after an unfiltered directory proves the page is beyond the end', () => {
    const base = {
      isSuccess: true,
      isDefaultDirectory: true,
      page: 3,
      total: 20,
      pageSize: 10,
    };

    expect(loadedDirectoryPageIsOutOfRange(base)).toBe(true);
    expect(loadedDirectoryPageIsOutOfRange({ ...base, isSuccess: false })).toBe(false);
    expect(loadedDirectoryPageIsOutOfRange({ ...base, isDefaultDirectory: false })).toBe(false);
    expect(loadedDirectoryPageIsOutOfRange({ ...base, total: undefined })).toBe(false);
    expect(loadedDirectoryPageIsOutOfRange({ ...base, page: 2 })).toBe(false);
  });
});
