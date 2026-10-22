import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// docs/design/ui-copy-guide.md, "Address fields leave the state implied": a ZIP
// field's placeholder, example and help text never name a state.
const SRC = join(__dirname, '..', '..');
const STATE_BEFORE_ZIP = /\b(?:[A-Z]{2}|Minnesota) (?:ZIP|\d{5})\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'dev' ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('ZIP field hints', () => {
  it('name the ZIP without a state in every placeholder and example', () => {
    const offenders = sourceFiles(SRC).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, at: `${relative(SRC, path)}:${index + 1}` }))
        .filter(
          ({ line }) =>
            /placeholder|EXAMPLE|answer: 'Enter a house number/.test(line) &&
            STATE_BEFORE_ZIP.test(line),
        )
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the shared address field example without a state', () => {
    const source = readFileSync(
      join(SRC, 'components', 'address', 'AddressSuggestionField.tsx'),
      'utf8',
    );
    expect(source).toContain('placeholder="350 S 5th St, Minneapolis 55415"');
  });
});
