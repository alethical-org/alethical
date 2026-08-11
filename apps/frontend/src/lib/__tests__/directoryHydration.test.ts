import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { loadedDirectoryPageIsOutOfRange } from '../directoryPagination';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

function source(path: string) {
  return readFileSync(join(ROOT, path), 'utf8');
}

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

  it.each(['SearchBillsScreen.tsx', 'SearchLegislatorsScreen.tsx'])(
    'keeps %s wired to the tested 404 decision',
    (screen) => {
      const screenSource = source(`screens/redesign/${screen}`);

      expect(screenSource).toContain('loadedDirectoryPageIsOutOfRange');
      expect(screenSource).toContain("navigation.replace('NotFound'");
    },
  );
});
