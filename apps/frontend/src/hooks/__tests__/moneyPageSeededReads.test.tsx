// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The hooks file reaches the sign-in provider, which loads Expo's native
// browser module at import time and cannot run in Node. None of the 4 money
// reads here is signed in, so a signed-out stand-in is the whole of what they
// need. `__DEV__` is a build-time constant Metro supplies and Node does not.
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ accessToken: null, user: null, session: null }),
}));

import { committeeRegisterQueryKey } from '../../lib/committeeList';
import { createAppQueryClient } from '../../lib/appQueryClient';
import { moneyByRaceQueryKey } from '../../lib/moneyByRace';
import { campaignFinanceSummaryQueryKey } from '../../lib/moneyLanding';
import { outsideSpendingRecordQueryKey } from '../../lib/outsideSpending';
import { renderPageData, resetSeededPayloadsForTests } from '../../lib/pageData';
import {
  useCampaignFinanceCommittees,
  useCampaignFinanceRaces,
  useCampaignFinanceSummary,
  useOutsideSpendingRecord,
} from '../useAppQueries';

/**
 * The reads `api/page.ts` served, read by the very hooks the money screens call
 * (issue #1966). Two things are checked that nothing else can check:
 *
 * - **The list is there on the FIRST render, with no loading state**, which is
 *   what makes the app's arrival one paint rather than a snapshot, then a
 *   skeleton, then the rows.
 * - **No request is made at all.** The app's freshness window is 5 minutes, so
 *   data present at the first render is not stale and nothing refetches.
 */

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

/** One render, capturing what each render pass saw, in order. */
function renderOnce(useHook: () => { isPending: boolean; data: unknown }) {
  const passes: { isPending: boolean; data: unknown }[] = [];
  function Probe() {
    const query = useHook();
    passes.push({ isPending: query.isPending, data: query.data });
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

afterEach(() => {
  document.body.innerHTML = '';
  resetSeededPayloadsForTests();
  vi.unstubAllGlobals();
});

describe('a money screen draws the served records on its first render', () => {
  it('has the register’s rows with no loading state and no request', () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requests.push(url);
        throw new Error('the screen must not need this');
      }),
    );
    seed(
      renderPageData([
        { key: committeeRegisterQueryKey({ page: 1, pageSize: 50 }), payload: REGISTER },
      ]),
    );

    const passes = renderOnce(() => useCampaignFinanceCommittees({ page: 1, pageSize: 50 }));

    expect(passes[0].isPending).toBe(false);
    expect(passes[0].data).toMatchObject({
      state: 'reported',
      registerTotal: 1603,
      // The date the page prints comes from the same read as the count beside it.
      asOf: '2026-08-12',
      committees: [{ registrationNumber: '20963', name: '34th Senate District RPM' }],
    });
    expect(requests).toEqual([]);
  });

  it('fetches as before when nothing was served for its key', () => {
    seed(
      renderPageData([
        { key: committeeRegisterQueryKey({ page: 2, pageSize: 50 }), payload: REGISTER },
      ]),
    );

    // Page 2's rows must never answer page 1's question, so page 1 loads as it
    // always did rather than showing the wrong 50 filers.
    const passes = renderOnce(() => useCampaignFinanceCommittees({ page: 1, pageSize: 50 }));

    expect(passes[0].isPending).toBe(true);
    expect(passes[0].data).toBeUndefined();
  });

  it('reads a served payload once, so a second screen does not reuse it', () => {
    seed(
      renderPageData([
        { key: committeeRegisterQueryKey({ page: 1, pageSize: 50 }), payload: REGISTER },
      ]),
    );

    expect(
      renderOnce(() => useCampaignFinanceCommittees({ page: 1, pageSize: 50 }))[0].isPending,
    ).toBe(false);
    expect(
      renderOnce(() => useCampaignFinanceCommittees({ page: 1, pageSize: 50 }))[0].isPending,
    ).toBe(true);
  });

  it('has the landing’s counts and its copy date together', () => {
    seed(
      renderPageData([
        {
          key: campaignFinanceSummaryQueryKey(),
          payload: {
            register: { state: 'reported', filer_count: 1603 },
            legislator_committee_confirmations: {
              state: 'reported',
              confirmed_member_count: 200,
              sitting_member_count: 200,
              newest_confirmation_at: '2026-08-30T00:00:00Z',
            },
            freshness: { downloads_fetched_at: '2026-08-12T12:00:00Z' },
          },
        },
      ]),
    );

    const passes = renderOnce(() => useCampaignFinanceSummary());

    expect(passes[0].isPending).toBe(false);
    expect(passes[0].data).toMatchObject({
      register: { state: 'reported', filerCount: 1603 },
      confirmations: { confirmedMemberCount: 200, sittingMemberCount: 200 },
      freshness: { downloadsFetchedAt: '2026-08-12T12:00:00Z' },
    });
  });

  it('has every contest on Money by race, so its 778 rows are not asked for twice', () => {
    seed(
      renderPageData([
        {
          key: moneyByRaceQueryKey({ year: 2026 }),
          payload: {
            state: 'reported',
            year: 2026,
            ordered_by: 'office, district, name',
            as_of: '2026-08-12',
            contests: [
              {
                office: 'State Senator',
                district: '34',
                committees: [{ registration_number: '20963', name: 'Volunteers for Someone' }],
              },
            ],
          },
        },
      ]),
    );

    const passes = renderOnce(() => useCampaignFinanceRaces({ year: 2026 }));

    expect(passes[0].isPending).toBe(false);
    expect(passes[0].data).toMatchObject({ state: 'reported', year: 2026 });
  });

  it('has the outside-spending record’s figures, and withholds what is not reported', () => {
    seed(
      renderPageData([
        {
          key: outsideSpendingRecordQueryKey({ year: null, sort: 'newest', page: 1 }),
          payload: {
            state: 'not_reported',
            rows: [],
            figures: { row_count: 12 },
            fetched_at: '2026-09-01T12:00:00Z',
          },
        },
      ]),
    );

    const passes = renderOnce(() =>
      useOutsideSpendingRecord({ year: null, sort: 'newest', page: 1 }),
    );

    expect(passes[0].isPending).toBe(false);
    // A gap is never a zero: the served state says nothing is reported, so no
    // figure is shaped at all (`.claude/rules/grounded-answers.md` rule 12).
    expect(passes[0].data).toMatchObject({
      state: 'not_reported',
      figures: null,
      fetchedAt: '2026-09-01T12:00:00Z',
    });
  });
});
