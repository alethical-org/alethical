import { describe, expect, it } from 'vitest';
import type { MoneyByRacePage, RaceCommittee } from '../../data/types';
import { moneyByRacePageSnapshot, renderPageSnapshot } from '../pageSnapshot';
import { RACE_DONOR_EXPLANATION } from '../moneyByRace';

const committee: RaceCommittee = {
  registrationNumber: '90001',
  name: 'Example House Committee',
  isClosed: false,
  terminationDate: null,
  reportedTotal: '1234',
  reportedThrough: '2026-06-30',
  reportedPeriodStart: null,
  named: {
    state: 'not_reported',
    total: null,
    payments: null,
    firstPaymentOn: null,
    lastPaymentOn: null,
  },
};
const page: MoneyByRacePage = {
  state: 'reported',
  year: 2026,
  office: null,
  orderedBy: 'district_then_name',
  committeeCount: 2,
  contestCount: 2,
  asOf: '2026-08-12',
  fetchedAt: '2026-09-01T12:00:00Z',
  offices: [
    { office: 'House', committeeCount: 1 },
    { office: 'Governor', committeeCount: 1 },
  ],
  contests: [
    {
      office: 'House',
      district: '12A',
      anchor: 'house-12a',
      committeeCount: 1,
      periodsDiffer: false,
      committees: [committee],
    },
    {
      office: 'Governor',
      district: null,
      anchor: 'governor',
      committeeCount: 1,
      periodsDiffer: false,
      committees: [
        { ...committee, name: 'Example Governor Committee', registrationNumber: '90002' },
      ],
    },
  ],
};

describe('the first race response follows the directory or selected-group address', () => {
  it('starts with group links and counts, without committee rows or amounts', () => {
    const snapshot = moneyByRacePageSnapshot(page);
    const text = renderPageSnapshot(snapshot);
    expect(snapshot.subheading).toBe('2 candidate committees');
    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.records?.[0].href).toBe('/money/races?office=House&year=2026&group=house-12a');
    expect(snapshot.records?.[1].href).toBe(
      '/money/races?office=Governor&year=2026&group=governor',
    );
    expect(text).not.toContain('Example House Committee');
    expect(text).not.toContain('$1,234');
    expect(text).not.toContain('Payment files copied');
    expect(text).toContain('Committee list copied Aug 12, 2026');
    expect(snapshot.sections?.[0].body).toContain(RACE_DONOR_EXPLANATION);
  });

  it('filters only the directory and clears its search when opening a group', () => {
    const snapshot = moneyByRacePageSnapshot(page, { office: 'House', q: 'house 12a' });
    expect(snapshot.subheading).toBe('1 candidate committee');
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records?.[0].href).not.toContain('q=');
    expect(snapshot.body).not.toContain('By district or court seat');
    expect(moneyByRacePageSnapshot(page, { office: 'Unknown' }).records).toHaveLength(2);
  });

  it('opens a whole group from all-office data, even when its office parameter is stale', () => {
    const snapshot = moneyByRacePageSnapshot(page, { office: 'Governor', group: 'house-12a' });
    const text = renderPageSnapshot(snapshot);
    expect(snapshot.heading).toBe('House District 12A');
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records?.[0].label).toBe('Example House Committee');
    expect(snapshot.records?.[0].href).toContain('?year=2026');
    expect(text).toContain('$1,234');
    expect(text).toContain('No itemized contributions in our records for 2026');
    expect(text).not.toContain('Example Governor Committee');
    expect(snapshot.body.filter((line) => line === RACE_DONOR_EXPLANATION)).toHaveLength(1);
    expect(snapshot.sections?.flatMap((section) => section.body)).not.toContain(
      RACE_DONOR_EXPLANATION,
    );
    expect(text).toContain('Payment files copied Sep 1, 2026');
  });

  it('provides recovery for an unknown shared group, not an unrelated group', () => {
    const snapshot = moneyByRacePageSnapshot(page, { group: 'unknown' });
    expect(snapshot.body).toContain(
      'We couldn’t find this office, district or court seat in our records',
    );
    expect(snapshot.records).toBeUndefined();
    expect(snapshot.links[0].label).toBe('Choose another office, district or court seat');
  });
});
