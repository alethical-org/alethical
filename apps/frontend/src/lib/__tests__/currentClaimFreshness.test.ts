import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  API_SHARED_CACHE_MAX_AGE_MS,
  CURRENT_CLAIM_MAX_AGE_MS,
  PAGE_SHARED_CACHE_MAX_AGE_MS,
  claimsSomethingCurrent,
  currentClaimAgeMs,
  currentClaimDeadlineFitsTheChain,
  currentClaimIsWithheld,
  currentClaimQueryRoots,
  msUntilCurrentClaimExpires,
  seededClaimAgeMs,
  servedClaimAgeMs,
} from '../currentClaimFreshness';

const REPO = join(__dirname, '..', '..', '..', '..', '..');

/**
 * The deadline on a displayed claim about who currently holds office
 * (https://github.com/alethical-org/alethical/issues/2023).
 *
 * Every case here is written so that removing the behaviour it names makes it
 * fail. The ones worth saying that about out loud are the 2 that assert an
 * ABSENCE is read as old: they are the whole difference between a bound that
 * holds and one that holds when the network is helpful.
 */
describe('how old a current claim is allowed to be', () => {
  it('names one deadline that covers every hop the chain can add', () => {
    expect(currentClaimDeadlineFitsTheChain()).toBe(true);
    // Stated as the arithmetic rather than as one number, so a later change to a
    // cache window fails here instead of quietly outliving the published figure.
    expect(API_SHARED_CACHE_MAX_AGE_MS + PAGE_SHARED_CACHE_MAX_AGE_MS).toBeLessThanOrEqual(
      CURRENT_CLAIM_MAX_AGE_MS,
    );
    expect(CURRENT_CLAIM_MAX_AGE_MS).toBe(20 * 60_000);
  });

  it('reads a missing cache age as the oldest the window allows, never as fresh', () => {
    // The failure this stops: a cache that does not report `Age`, or a browser
    // that hides it, making a 6-minute-old answer look brand new.
    expect(servedClaimAgeMs(null)).toBe(API_SHARED_CACHE_MAX_AGE_MS);
    expect(servedClaimAgeMs(undefined)).toBe(API_SHARED_CACHE_MAX_AGE_MS);
    expect(servedClaimAgeMs(Number.NaN)).toBe(API_SHARED_CACHE_MAX_AGE_MS);
    // A negative age is not a fresher answer, it is a broken one.
    expect(servedClaimAgeMs(-30)).toBe(API_SHARED_CACHE_MAX_AGE_MS);
  });

  it('believes a reported cache age, up to the window it cannot exceed', () => {
    expect(servedClaimAgeMs(0)).toBe(0);
    expect(servedClaimAgeMs(45)).toBe(45_000);
    // Past its own window a cache is reporting something impossible, so the
    // window wins and the answer is treated as being at the limit.
    expect(servedClaimAgeMs(99_999)).toBe(API_SHARED_CACHE_MAX_AGE_MS);
  });

  it('puts an answer embedded in a page at its deadline when no age travelled with it', () => {
    // This is today's state for a seeded read whose page function has not been
    // taught to pass the age on, and it must land on the safe side.
    expect(seededClaimAgeMs(undefined)).toBe(
      API_SHARED_CACHE_MAX_AGE_MS + PAGE_SHARED_CACHE_MAX_AGE_MS,
    );
    expect(currentClaimIsWithheld(seededClaimAgeMs(undefined))).toBe(false);
    // Not withheld on arrival, but with only the grace period left, so the
    // recheck happens straight away rather than in 5 minutes.
    expect(msUntilCurrentClaimExpires(seededClaimAgeMs(undefined))).toBe(4 * 60_000);
  });

  it('adds the page cache to an age a page did measure', () => {
    expect(seededClaimAgeMs(0)).toBe(PAGE_SHARED_CACHE_MAX_AGE_MS);
    expect(seededClaimAgeMs(20_000)).toBe(PAGE_SHARED_CACHE_MAX_AGE_MS + 20_000);
  });

  it('withholds at the deadline, not after it', () => {
    expect(currentClaimIsWithheld(CURRENT_CLAIM_MAX_AGE_MS - 1)).toBe(false);
    expect(currentClaimIsWithheld(CURRENT_CLAIM_MAX_AGE_MS)).toBe(true);
    expect(currentClaimIsWithheld(CURRENT_CLAIM_MAX_AGE_MS + 1)).toBe(true);
  });

  it('measures age as elapsed time on one clock, so a wrong clock cannot hide staleness', () => {
    // The same answer, read by a browser whose clock is an hour behind and one an
    // hour ahead. Both moments move together because both come from that
    // browser's own clock, so the age is identical and the offset cancels. A
    // `now - validated_at` across 2 machines would differ by an hour here, and
    // one of the 2 would report a 12-minute-old claim as fresh.
    const behind = currentClaimAgeMs({
      servedAgeMs: 60_000,
      receivedAt: 1_000_000 - 3_600_000,
      now: 1_660_000 - 3_600_000,
    });
    const ahead = currentClaimAgeMs({
      servedAgeMs: 60_000,
      receivedAt: 1_000_000 + 3_600_000,
      now: 1_660_000 + 3_600_000,
    });
    expect(behind).toBe(720_000);
    expect(ahead).toBe(720_000);
  });

  it('never reports a negative age when a clock steps backwards mid-visit', () => {
    const age = currentClaimAgeMs({ servedAgeMs: 5_000, receivedAt: 900, now: 100 });
    expect(age).toBe(5_000);
  });

  it('asks again only for the reads whose answer can go wrong silently', () => {
    expect(claimsSomethingCurrent(['committee-money', '17868', 2026])).toBe(true);
    expect(claimsSomethingCurrent(['legislator-campaign-money', 'jim-abeler', 2026])).toBe(true);
    expect(claimsSomethingCurrent(['campaign-finance-name-search', 'abeler', 5])).toBe(true);
    expect(claimsSomethingCurrent(['campaign-finance-summary'])).toBe(true);

    // Dated records, deliberately left alone: each carries the period it covers
    // and the day we copied it, so an old one is labelled rather than wrong.
    expect(claimsSomethingCurrent(['committee-payments', '17868', 'received', 2026])).toBe(false);
    expect(claimsSomethingCurrent(['committee-filings', '17868'])).toBe(false);
    expect(claimsSomethingCurrent(['payments-under-name', 'Acme', 'gave'])).toBe(false);
    expect(claimsSomethingCurrent(['outside-spending', '', '', 'amount'])).toBe(false);
    expect(claimsSomethingCurrent(['campaign-finance-committees', 1, 50])).toBe(false);
    expect(claimsSomethingCurrent(['money-by-race', 2026])).toBe(false);
    expect(claimsSomethingCurrent(['bill', 'HF1'])).toBe(false);
    expect(claimsSomethingCurrent([])).toBe(false);
    expect(claimsSomethingCurrent([42])).toBe(false);
  });
});

describe('the app and the API agree on which answers carry a current claim', () => {
  /**
   * The 2 lists are written in 2 languages and nothing links them, so this reads
   * the API's own file and holds them level. Without it the API can move a read
   * onto its long cache window while the app still believes that read expires, or
   * the reverse, and neither side would fail a test of its own.
   *
   * The API names the 4 in the comment above `MONEY_RECORD_PATHS` that explains
   * which reads are deliberately absent from it, so that comment is the source
   * read here.
   */
  it('names the same 4 reads on both sides', () => {
    const publicPy = readFileSync(join(REPO, 'alethical/api/routers/public.py'), 'utf8');
    const start = publicPy.indexOf('The 4 public reads that fail that test');
    const end = publicPy.indexOf('MONEY_RECORD_PATHS = frozenset');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const absentFromTheLongWindow = publicPy.slice(start, end);

    const apiPaths = [
      '/api/v1/campaign-finance/search',
      '/api/v1/campaign-finance/summary',
      '/api/v1/committees/{registration_number}/finance',
      '/api/v1/legislators/{legislator_id}/campaign-finance',
    ];
    for (const path of apiPaths) {
      expect(absentFromTheLongWindow).toContain(path);
    }
    // Exactly 4, so a 5th read joining that list without joining the app's is a
    // failure here rather than a claim nobody rechecks.
    expect(absentFromTheLongWindow.match(/\* `\/api\/v1\//g)).toHaveLength(apiPaths.length);

    expect(currentClaimQueryRoots()).toEqual([
      'campaign-finance-name-search',
      'campaign-finance-summary',
      'committee-money',
      'legislator-campaign-money',
    ]);
  });

  it('serves a validation time from every one of those 4 reads and from no other', () => {
    const publicPy = readFileSync(join(REPO, 'alethical/api/routers/public.py'), 'utf8');
    // 4 payloads carry it, plus the one definition of the function itself.
    expect(
      publicPy.match(/"current_claim_validated_at": current_claim_validated_at\(\)/g),
    ).toHaveLength(4);
  });
});
