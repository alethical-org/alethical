/**
 * The Money by race read: the served payload, its shaper, and the key it is stored
 * under.
 *
 * `data/api.ts` and `hooks/useAppQueries.ts` are in the program every page downloads
 * before anything draws, and they need only these names from the page. Importing
 * them from `lib/moneyByRace.ts` put every sentence that page prints, and the money
 * formatters behind it, into that first download. This module imports only types.
 * `lib/moneyByRace.ts` re-exports every name here, so the screen, its tests and
 * `api/page.ts` import them from where they always did.
 */

import type { MoneyByRacePage, RaceCommittee, RaceContest } from '../data/types';

/*
 * The served payload and its shaping live here, not in `data/api.ts`: the server-side
 * first response (`api/page.ts`) runs in Node, where `data/api.ts`'s React Native
 * import cannot load, and importing it there took every page on the site down on
 * 4 Sep 2026. A file `api/page.ts` reaches must import nothing from `react-native`.
 */

/** The page's own 2-state reading of the served state; nothing unknown is "reported". */
function racesPageState(state: string | undefined): 'reported' | 'unavailable' {
  return state === 'reported' ? 'reported' : 'unavailable';
}

interface ApiRaceCommitteePayload {
  registration_number?: string | null;
  name?: string | null;
  is_closed?: boolean | null;
  termination_date?: string | null;
  reported_total?: string | null;
  reported_through?: string | null;
  reported_period_start?: string | null;
  named?: {
    state?: string | null;
    total?: string | null;
    payments?: number | null;
    first_payment_on?: string | null;
    last_payment_on?: string | null;
  } | null;
}

interface ApiRaceContestPayload {
  office?: string | null;
  district?: string | null;
  anchor?: string | null;
  committee_count?: number | null;
  periods_differ?: boolean | null;
  committees?: ApiRaceCommitteePayload[] | null;
}

export interface ApiMoneyByRacePayload {
  state?: string;
  ordered_by?: string;
  year?: number;
  office?: string | null;
  offices?: { office?: string | null; committee_count?: number | null }[] | null;
  committee_count?: number | null;
  contest_count?: number | null;
  contests?: ApiRaceContestPayload[] | null;
  as_of?: string | null;
  fetched_at?: string | null;
}

function raceCommittee(row: ApiRaceCommitteePayload): RaceCommittee {
  const named = row.named ?? {};
  const namedState = named.state;
  return {
    registrationNumber: row.registration_number ?? '',
    name: row.name ?? '',
    isClosed: row.is_closed ?? false,
    terminationDate: row.termination_date ?? null,
    reportedTotal: row.reported_total ?? null,
    reportedThrough: row.reported_through ?? null,
    reportedPeriodStart: row.reported_period_start ?? null,
    named: {
      // An unknown state is "unavailable", never "reported": a figure a page cannot
      // stand behind must not be drawn as one.
      state:
        namedState === 'reported' || namedState === 'not_reported' ? namedState : 'unavailable',
      total: named.total ?? null,
      payments: named.payments ?? null,
      firstPaymentOn: named.first_payment_on ?? null,
      lastPaymentOn: named.last_payment_on ?? null,
    },
  };
}

function raceContest(contest: ApiRaceContestPayload): RaceContest {
  const committees = (contest.committees ?? []).map(raceCommittee);
  return {
    office: contest.office ?? '',
    district: contest.district ?? null,
    anchor: contest.anchor ?? '',
    committeeCount: contest.committee_count ?? committees.length,
    periodsDiffer: contest.periods_differ ?? false,
    committees,
  };
}

/**
 * The shaping alone, so the server-side first response (`api/page.ts`) draws the
 * page from the same read the app does rather than a second reading of it.
 */
export function getCampaignFinanceRacesFromApiPayload(
  payload: ApiMoneyByRacePayload,
  requestedYear: number,
): MoneyByRacePage {
  const state = racesPageState(payload.state);
  return {
    state,
    orderedBy: payload.ordered_by ?? '',
    year: payload.year ?? requestedYear,
    office: payload.office ?? null,
    offices: (payload.offices ?? [])
      .filter((entry) => typeof entry.office === 'string' && entry.office)
      .map((entry) => ({
        office: entry.office as string,
        committeeCount: entry.committee_count ?? 0,
      })),
    committeeCount: payload.committee_count ?? null,
    contestCount: payload.contest_count ?? null,
    contests: state === 'reported' ? (payload.contests ?? []).map(raceContest) : [],
    asOf: payload.as_of ?? null,
    fetchedAt: payload.fetched_at ?? null,
  };
}

/**
 * The React Query key the Money by race read answers. Shared with `api/page.ts`
 * so the payload it already read is labelled with the key the app asks for
 * (issue #1966).
 */
export function moneyByRaceQueryKey(options: {
  year: number;
  office?: string;
}): readonly unknown[] {
  return ['campaign-finance-races', options.year, options.office ?? 'all'];
}
