// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same 2 stand-ins the other hook tests need: the hooks file reaches the sign-in
// provider, which loads a native module at import time, and `__DEV__` is a
// build-time constant Node does not supply.
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ accessToken: null, user: null, session: null }),
}));

import { createAppQueryClient } from '../../lib/appQueryClient';
import { committeeRegisterQueryKey } from '../../lib/committeeList';
import { committeeMoneyQueryKey } from '../../lib/committeeMoney';
import {
  API_SHARED_CACHE_MAX_AGE_MS,
  currentClaimAgeMs,
  currentClaimIsWithheld,
  CURRENT_CLAIM_MAX_AGE_MS,
  PAGE_SHARED_CACHE_MAX_AGE_MS,
} from '../../lib/currentClaimFreshness';
import { campaignFinanceSummaryQueryKey } from '../../lib/moneyLanding';
import { renderPageData, resetSeededPayloadsForTests } from '../../lib/pageData';
import {
  useCampaignFinanceSummary,
  useCampaignFinanceCommittees,
  useCommitteeMoney,
} from '../useAppQueries';
import { useCurrentClaimExpiry } from '../useCurrentClaimExpiry';

/**
 * The end-to-end age of a displayed claim about who currently holds office,
 * measured on a clock this test controls rather than by waiting
 * (https://github.com/alethical-org/alethical/issues/2023).
 *
 * WHY THIS FILE EXISTS RATHER THAN MORE UNIT TESTS. Each hop already had its own
 * short limit and each hop's own test passed. What nothing measured was the total,
 * and the total was the defect: an answer that had already aged in 2 shared caches
 * reached the app's store stamped as if it had just been fetched, and then no
 * money read was ever rechecked. Only a case that puts a deliberately old answer
 * through the real hooks can see that.
 *
 * THE NUMBER IT PINS is 20 minutes. The 2 assertions that make it a measurement
 * rather than a restatement of the constant are `dataUpdatedAt` (the app's own
 * record of when this answer was validated) and `isStale` (whether anything will
 * ever ask again).
 *
 * NO REAL RECORD IS TOUCHED. The withdrawal case is simulated by moving the clock
 * forward against a fixture, never by withdrawing a real person's confirmed
 * committee.
 */

const NOON = new Date('2026-09-07T12:00:00.000Z');

/** What `/campaign-finance/summary` serves: 2 counts about who sits right now. */
const SUMMARY = {
  register: { state: 'reported', filer_count: 1603 },
  legislator_committee_confirmations: {
    state: 'reported',
    confirmed_member_count: 200,
    sitting_member_count: 200,
    newest_confirmation_at: '2026-08-30T00:00:00Z',
  },
  freshness: { downloads_fetched_at: '2026-08-12T12:00:00Z' },
  current_claim_validated_at: '2026-09-07T11:54:00.000Z',
};

/** A read of dated filings, which must keep behaving exactly as it did. */
const REGISTER = {
  state: 'reported',
  ordered_by: 'name',
  committees: [
    {
      registration_number: '20963',
      name: '34th Senate District RPM',
      kind: 'party_unit',
      is_closed: false,
      termination_date: null,
    },
  ],
  page: { has_more: true, total: 1603 },
  register_total: 1603,
  by_kind: { party_unit: 1 },
  as_of: '2026-08-12',
};

/**
 * What `/committees/41363/finance?year=2025` serves. The confirmed member is the
 * claim that expires: a person can take that sign-off back, and past the deadline
 * the sentence naming them is withheld while every dated figure stays.
 */
const FINANCE = {
  registration_number: '41363',
  committee_name: '100 Percent Future Fund',
  year: 2025,
  fetched_at: '2026-09-01T12:00:00Z',
  register: { state: 'reported', name: '100 Percent Future Fund' },
  confirmed_for: { legislator_id: 'abc', slug: 'erin-murphy', full_name: 'Erin Murphy' },
  current_claim_validated_at: '2026-09-07T11:54:00.000Z',
  split: { state: 'shown', reported_total: '880.0000', named_total: '700.0000' },
  money_in: { state: 'reported' },
  money_out: { state: 'reported' },
};

type Seen = { isStale: boolean; dataUpdatedAt: number; hasData: boolean };

function renderQuery(useHook: () => { isStale: boolean; dataUpdatedAt: number; data: unknown }) {
  const passes: Seen[] = [];
  function Probe() {
    const query = useHook();
    passes.push({
      isStale: query.isStale,
      dataUpdatedAt: query.dataUpdatedAt,
      hasData: query.data !== undefined,
    });
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const client = createAppQueryClient();
  act(() => {
    createRoot(host).render(
      (
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      ) as ReactNode,
    );
  });
  return passes;
}

function seed(block: string) {
  const holder = document.createElement('div');
  holder.innerHTML = block;
  document.body.append(...holder.childNodes);
  resetSeededPayloadsForTests();
}

beforeEach(() => {
  // Only `Date` is faked here, so React and React Query keep their real timers
  // and behave normally. The 2 cases that need to advance a timer say so.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('no case here needs the network');
    }),
  );
});

afterEach(() => {
  document.body.innerHTML = '';
  resetSeededPayloadsForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('an answer embedded in a page reaches the app with its real age', () => {
  it('records when the claim was validated, not when the page first drew', () => {
    // 6 minutes of API cache is the most its window allows, so this is the worst
    // real case rather than an invented one.
    seed(
      renderPageData([
        {
          key: campaignFinanceSummaryQueryKey(),
          payload: SUMMARY,
          validatedAgeMs: API_SHARED_CACHE_MAX_AGE_MS,
        },
      ]),
    );

    const passes = renderQuery(() => useCampaignFinanceSummary());

    // The #1966 win is intact: the counts are on screen at the first render.
    expect(passes[0].hasData).toBe(true);
    // And the app knows they are 16 minutes old, not new. This is the assertion
    // the whole issue turns on: before it, this number was `Date.now()`.
    const ageOnArrival = NOON.getTime() - passes[0].dataUpdatedAt;
    expect(ageOnArrival).toBe(API_SHARED_CACHE_MAX_AGE_MS + PAGE_SHARED_CACHE_MAX_AGE_MS);
    expect(ageOnArrival).toBe(16 * 60_000);
    // So something will ask again, which is what an open tab never used to do.
    expect(passes[0].isStale).toBe(true);
  });

  it('assumes the worst where no age travelled with the answer', () => {
    seed(renderPageData([{ key: campaignFinanceSummaryQueryKey(), payload: SUMMARY }]));

    const passes = renderQuery(() => useCampaignFinanceSummary());

    expect(passes[0].hasData).toBe(true);
    expect(NOON.getTime() - passes[0].dataUpdatedAt).toBe(
      API_SHARED_CACHE_MAX_AGE_MS + PAGE_SHARED_CACHE_MAX_AGE_MS,
    );
    expect(passes[0].isStale).toBe(true);
  });

  it('leaves a read of dated filings stamped as it always was', () => {
    // The other half of the bound, and it matters: aging out a filing that
    // carries its own date would trade a working page for nothing, and the
    // design prefers an old labelled figure to a blank one.
    seed(
      renderPageData([
        { key: committeeRegisterQueryKey({ page: 1, pageSize: 50 }), payload: REGISTER },
      ]),
    );

    const passes = renderQuery(() => useCampaignFinanceCommittees({ page: 1, pageSize: 50 }));

    expect(passes[0].hasData).toBe(true);
    expect(passes[0].dataUpdatedAt).toBe(NOON.getTime());
    expect(passes[0].isStale).toBe(false);
  });

  /**
   * The one way a seeded committee answer can be wrong while every part of it
   * looks right: the shared caches counted twice.
   *
   * A seeded answer's whole age rides in `initialDataUpdatedAt`, so the shaped
   * answer's own `servedAgeMs` has to be 0. Adding the API cache's age in both
   * places puts a 16-minute claim at 22 minutes, past a deadline it has not
   * reached, and the page then withholds a member nobody has withdrawn.
   */
  it('counts the API cache once for a served committee answer, not twice', () => {
    seed(
      renderPageData([
        {
          key: committeeMoneyQueryKey('41363', 2025),
          payload: FINANCE,
          validatedAgeMs: API_SHARED_CACHE_MAX_AGE_MS,
        },
      ]),
    );

    const passes: { servedAgeMs: number | undefined; dataUpdatedAt: number }[] = [];
    function Probe() {
      const query = useCommitteeMoney('41363', 2025);
      passes.push({
        servedAgeMs: query.data?.currentClaim.servedAgeMs,
        dataUpdatedAt: query.dataUpdatedAt,
      });
      return null;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const client = createAppQueryClient();
    act(() => {
      createRoot(host).render(
        (
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>
        ) as ReactNode,
      );
    });

    expect(passes[0].servedAgeMs).toBe(0);
    const ageNow = currentClaimAgeMs({
      servedAgeMs: passes[0].servedAgeMs ?? 0,
      receivedAt: passes[0].dataUpdatedAt,
      now: NOON.getTime(),
    });
    expect(ageNow).toBe(API_SHARED_CACHE_MAX_AGE_MS + PAGE_SHARED_CACHE_MAX_AGE_MS);
    expect(ageNow).toBe(16 * 60_000);
    expect(currentClaimIsWithheld(ageNow)).toBe(false);
  });
});

describe('a displayed claim stops being drawn at the deadline', () => {
  function renderExpiry(options: { servedAgeMs: number; dataUpdatedAt: number }) {
    const passes: boolean[] = [];
    const refetch = vi.fn();
    function Probe() {
      passes.push(
        useCurrentClaimExpiry({
          servedAgeMs: options.servedAgeMs,
          dataUpdatedAt: options.dataUpdatedAt,
          refetch,
        }),
      );
      return null;
    }
    const host = document.createElement('div');
    document.body.append(host);
    act(() => {
      createRoot(host).render((<Probe />) as ReactNode);
    });
    return { passes, refetch };
  }

  it('still names the member inside the deadline', () => {
    const { passes } = renderExpiry({
      servedAgeMs: 16 * 60_000,
      dataUpdatedAt: NOON.getTime(),
    });
    expect(passes.at(-1)).toBe(false);
  });

  it('withholds it once the claim is 20 minutes old', () => {
    const { passes } = renderExpiry({
      servedAgeMs: CURRENT_CLAIM_MAX_AGE_MS,
      dataUpdatedAt: NOON.getTime(),
    });
    expect(passes.at(-1)).toBe(true);
  });

  it('counts what the caches added as well as time spent on the page', () => {
    // 6 minutes arrived with the answer and 14 more pass in the browser. Neither
    // alone reaches the deadline; together they do, and the old code counted
    // only the second.
    const { passes } = renderExpiry({
      servedAgeMs: 6 * 60_000,
      dataUpdatedAt: NOON.getTime() - 14 * 60_000,
    });
    expect(passes.at(-1)).toBe(true);
  });

  it('asks the service again when the deadline arrives, before withholding anything', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOON);

    const { passes, refetch } = renderExpiry({
      servedAgeMs: 16 * 60_000,
      dataUpdatedAt: NOON.getTime(),
    });
    expect(passes.at(-1)).toBe(false);
    expect(refetch).not.toHaveBeenCalled();

    // 1 second short of the deadline: still drawn, still nothing asked.
    act(() => {
      vi.advanceTimersByTime(4 * 60_000 - 1_000);
    });
    expect(passes.at(-1)).toBe(false);
    expect(refetch).not.toHaveBeenCalled();

    // At the deadline the recheck fires and, with no fresh answer, the claim is
    // withheld rather than left on screen.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(passes.at(-1)).toBe(true);
  });

  it('withholds nothing on a page that has no answer yet', () => {
    const { passes, refetch } = renderExpiry({
      servedAgeMs: undefined as unknown as number,
      dataUpdatedAt: undefined as unknown as number,
    });
    expect(passes.at(-1)).toBe(false);
    expect(refetch).not.toHaveBeenCalled();
  });
});
