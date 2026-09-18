import { afterEach, expect, it, vi } from 'vitest';
import { lobbyingDonationYear, lobbyingRecordDonationYear } from '../lobbyingTypes';
afterEach(() => vi.useRealTimers());
it('uses Minnesota’s completed calendar year around midnight on New Year’s Day', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2027-01-01T01:00:00Z'));
  expect(lobbyingDonationYear('2026')).toBeUndefined();
  expect(lobbyingDonationYear('2025')).toBe(2025);
  expect(lobbyingRecordDonationYear('2027')).toBeUndefined();
  expect(lobbyingRecordDonationYear('2026')).toBe(2026);
  vi.setSystemTime(new Date('2027-01-01T06:00:00Z'));
  expect(lobbyingDonationYear('2026')).toBe(2026);
});
