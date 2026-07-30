// `formatSessionLabel` turns the session name the API serves into the words a
// reader recognizes. The special-session cases are #746: Minnesota's 2025 first
// special session is a separate session whose files are numbered from 1 again, so
// its label has to be distinguishable from the biennium's at a glance.

import { describe, expect, it } from 'vitest';

import { formatSessionLabel } from '../sessionLabel';

describe('formatSessionLabel', () => {
  it('reduces a biennium to its year range', () => {
    expect(formatSessionLabel('94th Legislature (2025 - 2026) Regular Session')).toBe(
      '2025–2026 Legislative Session',
    );
  });

  it('keeps the special-session wording, so it cannot be mistaken for the biennium', () => {
    const label = formatSessionLabel('94th Legislature (2025) First Special Session');
    expect(label).toBe('2025 First Special Session');
    expect(label).not.toBe(formatSessionLabel('94th Legislature (2025 - 2026) Regular Session'));
  });

  it('leaves a name it cannot read alone rather than inventing years', () => {
    expect(formatSessionLabel('Current session')).toBe('Current session');
  });
});
