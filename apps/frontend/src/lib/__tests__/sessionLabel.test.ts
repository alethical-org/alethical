// `formatSessionLabel` turns the session name the API serves into the words a
// reader recognizes. The special-session cases are #746: Minnesota's 2025 first
// special session is a separate session whose files are numbered from 1 again, so
// its label has to be distinguishable from the biennium's at a glance.

import { describe, expect, it } from 'vitest';

import {
  formatLegislativeYearRange,
  formatLegislatureLabel,
  formatSessionLabel,
  normalizeLegislativeYearRanges,
} from '../sessionLabel';

const currentSession = {
  slug: '94-2025-regular',
  name: '94th Legislature (2025 - 2026) Regular Session',
  isCurrent: true,
  sessionNumber: 94,
  yearStart: 2025,
  yearEnd: 2026,
};

describe('formatSessionLabel', () => {
  it('uses one short en-dash range for every legislative biennium', () => {
    expect(formatLegislativeYearRange(2025, 2026)).toBe('2025–26');
    expect(formatLegislativeYearRange(2023, 2024)).toBe('2023–24');
    expect(formatLegislativeYearRange(2021, 2022)).toBe('2021–22');
    expect(formatLegislativeYearRange(2019, 2020)).toBe('2019–20');
  });

  it('builds both approved labels from the session record', () => {
    expect(formatSessionLabel(currentSession)).toBe('2025–26 Legislative Session');
    expect(formatLegislatureLabel(currentSession)).toBe('94th Legislature (2025–26)');
  });

  it('keeps the special-session wording, so it cannot be mistaken for the biennium', () => {
    const label = formatSessionLabel('94th Legislature (2025) First Special Session');
    expect(label).toBe('2025 First Special Session');
    expect(label).not.toBe(formatSessionLabel('94th Legislature (2025 - 2026) Regular Session'));
  });

  it('leaves a name it cannot read alone rather than inventing years', () => {
    expect(formatSessionLabel('Current session')).toBe('Current session');
  });

  it('normalizes a legislative range inside fallback display copy', () => {
    expect(normalizeLegislativeYearRanges('94th Legislature (2025-2026)')).toBe(
      '94th Legislature (2025–26)',
    );
    expect(normalizeLegislativeYearRanges('2025–2026 Legislative Session')).toBe(
      '2025–26 Legislative Session',
    );
  });
});
