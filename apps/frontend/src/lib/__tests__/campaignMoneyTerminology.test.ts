import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Product labels must match the state categories even in empty states and spoken
// labels. Names, name matching and internal data field identifiers remain valid.
describe('campaign money source terminology', () => {
  it('does not reintroduce retired contribution labels in money UI copy', () => {
    const source = new URL('../../', import.meta.url).pathname;
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '__tests__' || entry.name === 'researchPieces') continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(path)) files.push(path);
      }
    };
    walk(join(source, 'components/campaignMoney'));
    for (const directory of ['lib', 'screens/redesign']) {
      for (const name of readdirSync(join(source, directory))) {
        if (
          /(money|committee|contribution|donor|outsideSpending)/i.test(name) &&
          /\.tsx?$/.test(name)
        ) {
          files.push(join(source, directory, name));
        }
      }
    }
    const retired = /named donations only|No named contributions in our records/;
    expect(files.filter((file) => retired.test(readFileSync(file, 'utf8')))).toEqual([]);
  });
});
