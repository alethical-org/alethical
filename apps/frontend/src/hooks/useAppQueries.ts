import { useCallback, useEffect } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  askFromApi,
  createChatSessionFromApi,
  BillListFilters,
  fetchBillVersionText,
  getSavedSuggestedAnswerFromApi,
  getFeaturedBillsFromApi,
  getBillFromApi,
  getBillVotesFromApi,
  getChatSessionFromApi,
  getCurrentUserFromApi,
  getLegislatorBillsFromApi,
  getMetaFromApi,
  getLegislatorCampaignMoneyFromApi,
  getLegislatorFromApi,
  getLegislatorOutsideSpendingFromApi,
  getLegislatorVotesFromApi,
  campaignFinanceFilingsFromPayload,
  campaignFinanceSummaryFromPayload,
  committeeRegisterPageFromPayload,
  getCampaignFinanceCommitteesFromApi,
  getCampaignFinanceRacesFromApi,
  getCampaignFinanceFilingsFromApi,
  getCampaignFinanceNameSearchFromApi,
  getCampaignFinanceSummaryFromApi,
  getCommitteeFilingsFromApi,
  getCommitteeFinanceFromApi,
  getCommitteePaymentsMadeFromApi,
  getCommitteePaymentsReceivedFromApi,
  getOutsideSpendingFromApi,
  getOutsideSpendingRecordFromApi,
  getPaymentsUnderNameFromApi,
  ListPagination,
  LegislatorListFilters,
  listChatSessionsFromApi,
  listBillsFromApi,
  listLegislatorsFromApi,
  listPolicyAreasFromApi,
  listSessionsFromApi,
  listTrackedBillsFromApi,
  listTrackedCommitteesFromApi,
  lookupRepresentativeFromApi,
  suggestRepresentativeAddressesFromApi,
  sendChatMessageToApi,
  setTrackedBillFromApi,
  setTrackedCommitteeFromApi,
} from '../data/api';
import {
  getNotificationPreference,
  listSavedPlaces,
  updateNotificationPreference,
} from '../data/accountPreferences';
import type {
  CommitteeFilingsPage,
  CommitteeOutsideSpendingPage,
  CommitteeMadePayment,
  CommitteePaymentsPage,
  CommitteeReceivedPayment,
  CommitteeRegisterPage,
  MoneyByRacePage,
} from '../data/types';
import { NotificationPreference, RepresentativeLookupInput } from '../data/types';
import { COMMITTEE_PAGE_SIZE, committeeRegisterQueryKey } from '../lib/committeeList';
import {
  getCampaignFinanceRacesFromApiPayload,
  moneyByRaceQueryKey,
  type ApiMoneyByRacePayload,
} from '../lib/moneyByRace';
import {
  campaignFinanceFilingsQueryKey,
  campaignFinanceSummaryQueryKey,
} from '../lib/moneyLanding';
import { readerIsSavingData } from '../lib/dataSaving';
import { campaignMoneyYear } from '../lib/legislatorCampaignMoney';
import { seededQueryData } from '../lib/pageData';
import {
  outsideSpendingLoadFailure,
  outsideSpendingRecordPageFromPayload,
  outsideSpendingRecordQueryKey,
} from '../lib/outsideSpending';
import {
  PAYMENTS_UNDER_NAME_PAGE_SIZE,
  type PaymentNameRole,
  type PaymentUnderName,
} from '../lib/paymentsUnderName';
import { trackState, TrackState } from '../lib/trackedState';
import { routePath } from '../navigation/links';
import { screenLoaderForPath } from '../navigation/screenPreload';
import { useAuth } from '../providers/AuthProvider';

export function useCurrentUser() {
  const { accessToken, user } = useAuth();

  return useQuery({
    queryKey: ['current-user', user?.id ?? 'anon'],
    queryFn: () => getCurrentUserFromApi(accessToken ?? ''),
    enabled: Boolean(accessToken),
    retry: false,
  });
}

export interface SuggestedAnswerIdentity {
  billId: string;
  suggestionIndex: number;
}

const suggestedAnswerQueryKey = (identity: SuggestedAnswerIdentity) => [
  'saved-ask-suggestion',
  identity.billId,
  identity.suggestionIndex,
];

export function useAskAnswer(question?: string, identity?: SuggestedAnswerIdentity) {
  const trimmed = question?.trim();
  const validIdentity = Boolean(
    identity?.billId &&
    Number.isSafeInteger(identity.suggestionIndex) &&
    identity.suggestionIndex >= 0,
  );
  const savedQuery = useQuery({
    queryKey: validIdentity ? suggestedAnswerQueryKey(identity!) : ['saved-ask-suggestion', 'none'],
    queryFn: () => getSavedSuggestedAnswerFromApi(identity!.billId, identity!.suggestionIndex),
    enabled: validIdentity,
    retry: false,
  });
  const postQuery = useQuery({
    queryKey: ['ask', trimmed ?? ''],
    queryFn: () => askFromApi(trimmed!),
    enabled:
      Boolean(trimmed) && (!validIdentity || (savedQuery.isSuccess && savedQuery.data === null)),
  });

  if (validIdentity && savedQuery.data) {
    return { ...savedQuery, data: savedQuery.data };
  }
  if (validIdentity && !savedQuery.isSuccess) {
    return { ...savedQuery, data: undefined };
  }
  return postQuery;
}

/** Warm only the read-only saved-answer route. A miss never starts generation. */
export function usePrefetchSuggestedAnswer() {
  const queryClient = useQueryClient();
  return (billId: string, suggestionIndex: number) => {
    const identity = { billId, suggestionIndex };
    return void queryClient.prefetchQuery({
      queryKey: suggestedAnswerQueryKey(identity),
      queryFn: () => getSavedSuggestedAnswerFromApi(billId, suggestionIndex),
      retry: false,
    });
  };
}

export function useBills(
  query?: string,
  session?: string,
  filters: BillListFilters = {},
  pagination: ListPagination = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: [
      'bills',
      session ?? 'current',
      query ?? '',
      filters,
      pagination.limit ?? 20,
      pagination.offset ?? 0,
    ],
    queryFn: () => listBillsFromApi(query, session, filters, pagination),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    retry: false,
  });
}

export function usePolicyAreas(session?: string, scope?: 'legislature') {
  return useQuery({
    queryKey: ['policy-areas', session ?? 'current', scope ?? 'session'],
    queryFn: () => listPolicyAreasFromApi(session, scope),
    retry: false,
  });
}

export function useSessions(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: listSessionsFromApi,
    retry: false,
    enabled: options.enabled ?? true,
  });
}

export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: getMetaFromApi,
    retry: false,
  });
}

export function useBill(
  billId: string,
  options: { enabled?: boolean; includeVotes?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const includeVotes = options.includeVotes ?? true;
  const billQuery = useQuery({
    queryKey: ['bill', billId],
    queryFn: () => getBillFromApi(billId),
    retry: false,
    enabled,
  });
  const votesQuery = useQuery({
    queryKey: ['bill-votes', billId],
    queryFn: () => getBillVotesFromApi(billId),
    retry: false,
    enabled: enabled && includeVotes,
  });

  const bill = billQuery.data;
  const votes = votesQuery.data;
  return {
    ...billQuery,
    data: bill && votes ? { ...bill, votes, rollCallCount: votes.length } : bill,
    isLoading: billQuery.isLoading || (includeVotes && votesQuery.isLoading),
    voteError: votesQuery.error,
    voteIsLoading: includeVotes && votesQuery.isLoading,
  };
}

export function useFeaturedBills(billIds: readonly string[], options: { enabled?: boolean } = {}) {
  const featuredIds = billIds.map((billId) => billId.trim()).filter(Boolean);
  return useQuery({
    queryKey: ['featured-bills', featuredIds],
    queryFn: () => getFeaturedBillsFromApi(featuredIds),
    retry: false,
    enabled: (options.enabled ?? true) && featuredIds.length > 0,
  });
}

export function useBillVersionText(
  billId?: string,
  versionCode?: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ['bill-version-text', billId, versionCode],
    queryFn: () => fetchBillVersionText(billId!, versionCode!),
    retry: false,
    enabled: (options.enabled ?? true) && !!billId && !!versionCode,
  });
}

export function useLegislators(
  query?: string,
  session?: string,
  filters: LegislatorListFilters = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ['legislators', session ?? 'current', query ?? '', filters],
    queryFn: () => listLegislatorsFromApi(query, session, filters),
    retry: false,
    enabled: options.enabled ?? true,
  });
}

export function useLegislator(legislatorId: string) {
  return useQuery({
    queryKey: ['legislator', legislatorId],
    queryFn: () => getLegislatorFromApi(legislatorId),
    retry: false,
  });
}

/**
 * Outside spending about one legislator, one request per calendar year (#1332).
 *
 * A year is its own request because the endpoint answers one year at a time and each
 * year carries its own state: a year our download does not reach must be able to say
 * so without blanking a year it does.
 *
 * `allSettled`, not `all`, and that is the whole point of this comment. With `all`, one
 * year's request failing rejected the combined query, so the other year's real figures
 * were thrown away and replaced by a whole-card error -- a year we could answer, silently
 * turned into a year we could not. A failed year now becomes its own placeholder that
 * says only what happened to it. Found by an automated review on #1332.
 */
export function useLegislatorOutsideSpending(legislatorId: string, years: number[]) {
  return useQuery({
    queryKey: ['legislator-outside-spending', legislatorId, years],
    queryFn: async () => {
      const settled = await Promise.allSettled(
        years.map((year) => getLegislatorOutsideSpendingFromApi(legislatorId, year)),
      );
      return settled.map((result, index) =>
        result.status === 'fulfilled' ? result.value : outsideSpendingLoadFailure(years[index]),
      );
    },
    enabled: Boolean(legislatorId),
    retry: false,
  });
}

export function useLegislatorVotes(legislatorId: string, limit = 1) {
  return useQuery({
    queryKey: ['legislator-votes', legislatorId, limit],
    queryFn: () => getLegislatorVotesFromApi(legislatorId, limit),
    enabled: Boolean(legislatorId),
    retry: false,
  });
}

/**
 * One legislator's own campaign money for one year (#1329).
 *
 * `enabled` gates on the tab being open rather than on the legislator existing,
 * because the money tab is a second address on the same page and a reader who never
 * opens it should never pay for the request.
 */
export function useLegislatorCampaignMoney(
  legislatorId: string,
  year: number,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ['legislator-campaign-money', legislatorId, year],
    queryFn: () => getLegislatorCampaignMoneyFromApi(legislatorId, year),
    enabled: Boolean(legislatorId) && (options.enabled ?? true),
    retry: false,
  });
}

/**
 * The /money landing's counts and dates (register, confirmations, freshness).
 * Each block carries its own state; a block that is not served renders its
 * designed absent state rather than a number.
 */
export function useCampaignFinanceSummary(options: { enabled?: boolean } = {}) {
  const key = campaignFinanceSummaryQueryKey();
  return useQuery({
    queryKey: key,
    queryFn: getCampaignFinanceSummaryFromApi,
    // The /money page function already read this, so on a first load the counts
    // and the copy date are drawn without a second request (issue #1966).
    initialData: seededQueryData(key, campaignFinanceSummaryFromPayload),
    retry: false,
    // The homepage reads this too, and Home stays mounted beneath a deep-linked
    // stack screen, so an ungated read there would contend with the visible
    // screen's first load. The /money landing passes nothing and gets the
    // previous always-on behaviour.
    enabled: options.enabled ?? true,
  });
}

/** The landing's newest filed reports (no amounts, no filed date). */
export function useCampaignFinanceFilings(limit = 5) {
  const key = campaignFinanceFilingsQueryKey(limit);
  return useQuery({
    queryKey: key,
    queryFn: () => getCampaignFinanceFilingsFromApi(limit),
    initialData: seededQueryData(key, campaignFinanceFilingsFromPayload),
    retry: false,
  });
}

/**
 * One numbered page of the register for the committees list at /money/committees.
 *
 * `page` comes out of the address, so the list a reader is looking at is a link
 * they can send and the browser's Back button returns to it
 * (`.claude/rules/grounded-answers.md` rule 5). One request per page: 50 rows is
 * half the register endpoint's own maximum, and the order is the filed name,
 * which does not move between requests, so a fixed offset is stable.
 *
 * `keepPreviousData` so typing in the find-a-committee box narrows the list in
 * place instead of blanking it between keystrokes.
 */
/** The Money by race page: every candidate committee grouped by contest, for one
 *  year and optionally one office (issue #1954). */
export function useCampaignFinanceRaces(options: { year: number; office?: string }) {
  const { year, office } = options;
  const key = moneyByRaceQueryKey({ year, office });
  return useQuery({
    queryKey: key,
    queryFn: (): Promise<MoneyByRacePage> => getCampaignFinanceRacesFromApi({ year, office }),
    // The bare /money/races address is served with this read already made, which
    // is what stops the page downloading all 778 rows a second time (#1966).
    initialData: seededQueryData(key, (payload: ApiMoneyByRacePayload) =>
      getCampaignFinanceRacesFromApiPayload(payload, year),
    ),
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useCampaignFinanceCommittees(options: {
  kind?: string;
  query?: string;
  /** 1-based numbered page, straight off the address. */
  page: number;
  pageSize: number;
}) {
  const { kind, query, page, pageSize } = options;
  const key = committeeRegisterQueryKey({ kind, query, page, pageSize });
  return useQuery({
    queryKey: key,
    queryFn: (): Promise<CommitteeRegisterPage> =>
      getCampaignFinanceCommitteesFromApi({
        kind,
        q: query,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
    // A plain numbered page is served with its own rows already read, so the list
    // is drawn in the app's first paint (#1966). A kind chip or a typed name is a
    // filtered view the page function does not read, and fetches as before.
    initialData: seededQueryData(key, committeeRegisterPageFromPayload),
    retry: false,
    placeholderData: keepPreviousData,
  });
}

/**
 * Once /money is drawn, quietly load the records behind the 3 places its links
 * go: the committee register, money by race, and outside spending (#1966).
 *
 * Why it is worth doing: those 3 reads are the slowest on the site when
 * Cloudflare's copy has expired. Measured against production on 4 Sep 2026 by
 * forcing a cache miss, 3 runs each: outside spending 2.91/2.75/2.73 s, races
 * 1.35/1.32/1.42 s, committees 0.76/0.45/0.45 s. Each of those addresses is now
 * served with its own records already read, but that only helps a reader who
 * types the address; a reader who clicks through from /money never fetches new
 * page HTML, so without this the click starts the slow read from nothing.
 * React Query keeps an answer fresh for 5 minutes (`APP_QUERY_STALE_TIME`), so
 * the destination screen draws from the warmed entry with no request of its own.
 *
 * Three rules this follows, each of which can make warming worse than useless:
 *
 * - **Never during the landing's own first load.** `ready` is passed true only
 *   once /money's own reads have settled, so a guess cannot compete for the
 *   connection with the page the reader is actually looking at.
 * - **Nothing at all for a reader who is saving data**, because this is bytes
 *   nobody asked for (`readerIsSavingData`).
 * - **One request at a time, cheapest first.** All 3 at once inflate each other
 *   at the origin: measured on production, races went from 1.32-1.42 s alone to
 *   1.54-1.60 s alongside the other 2, and outside spending from 2.73-2.91 s to
 *   2.86-2.91 s. Nobody is waiting on speculative work, so it queues.
 *
 * Every key comes from the same shared builder the destination screen's own hook
 * uses, with the settings that screen falls back to when its address carries
 * none. A warmed entry under any other key is wasted bytes.
 */
export function useWarmMoneyDestinations(ready: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!ready) return;
    if (readerIsSavingData()) return;

    let stopped = false;
    // The 3 addresses, in the order they are warmed. Their screen files come
    // first and together: each is a few tens of kilobytes from Vercel's own
    // network (11.6 KB, 13.3 KB and 31.4 KB unpacked), so nothing waits on them,
    // and a click then has both the screen's code and its records already.
    const destinations = ['/money/committees', '/money/races', '/money/outside-spending'];
    const warms: (() => Promise<unknown>)[] = [
      () =>
        Promise.all(
          destinations.map((path) => {
            const load = screenLoaderForPath(path);
            return load ? load().catch(() => undefined) : undefined;
          }),
        ),
      // CommitteeListScreen at /money/committees: no kind chip, no typed name,
      // page 1.
      () =>
        queryClient.prefetchQuery({
          queryKey: committeeRegisterQueryKey({ page: 1, pageSize: COMMITTEE_PAGE_SIZE }),
          queryFn: () =>
            getCampaignFinanceCommitteesFromApi({ limit: COMMITTEE_PAGE_SIZE, offset: 0 }),
          retry: false,
        }),
      // MoneyByRaceScreen at /money/races: the year that screen defaults to, no
      // office chip.
      () => {
        const year = campaignMoneyYear(undefined);
        return queryClient.prefetchQuery({
          queryKey: moneyByRaceQueryKey({ year }),
          queryFn: () => getCampaignFinanceRacesFromApi({ year }),
          retry: false,
        });
      },
      // OutsideSpendingScreen at /money/outside-spending: no subject, every
      // year, newest first, page 1.
      () =>
        queryClient.prefetchQuery({
          queryKey: outsideSpendingRecordQueryKey({ year: null, sort: 'newest', page: 1 }),
          queryFn: () => getOutsideSpendingRecordFromApi({ year: null, sort: 'newest', page: 1 }),
          retry: false,
        }),
    ];

    const run = async () => {
      for (const warm of warms) {
        if (stopped) return;
        await warm();
      }
    };
    // Wait for a gap in the browser's own work, so warming never lands in the
    // middle of the landing page finishing its drawing. Safari and React Native
    // have no idle callback, so a short timer stands in.
    const idle = whenBrowserIsIdle(run);

    return () => {
      stopped = true;
      idle();
    };
  }, [ready, queryClient]);
}

/** Run `task` when the browser next has nothing to do, or shortly, whichever
 *  comes first. Returns the function that cancels it. */
function whenBrowserIsIdle(task: () => void): () => void {
  const scope = globalThis as {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof scope.requestIdleCallback === 'function') {
    const handle = scope.requestIdleCallback(task, { timeout: 2000 });
    return () => scope.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(task, 500);
  return () => clearTimeout(timer);
}

/**
 * One typed name matched across the 5 kinds of record, for /money/search.
 *
 * Runs on any non-empty query, including a 1- or 2-character one: the server
 * answers those with its own "too short" state, and rendering that served state
 * is how the page says "type at least 3 characters" instead of "nothing found",
 * which would be a false claim about the records.
 */
export function useCampaignFinanceNameSearch(query: string, limit = 5) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['campaign-finance-name-search', trimmed, limit],
    queryFn: () => getCampaignFinanceNameSearchFromApi(trimmed, limit),
    enabled: trimmed.length > 0,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

/**
 * One committee's money for one year, keyed on its registration number. Resolves
 * `null` on "in neither the register nor the downloads we hold", so the page can
 * tell that fact about our records apart from a fault. When a refetch fails, the
 * last accepted data stays in `data` and the screen labels it as held figures
 * rather than blanking (design's service-unreachable state).
 */
export function useCommitteeMoney(registrationNumber: string | null, year: number) {
  return useQuery({
    queryKey: ['committee-money', registrationNumber, year],
    queryFn: () => getCommitteeFinanceFromApi(registrationNumber ?? '', year),
    enabled: Boolean(registrationNumber),
    retry: false,
  });
}

/** The largest payments into a committee for one year, for the page's short list. */
export function useCommitteePaymentsReceived(
  registrationNumber: string | null,
  year: number,
  options: { limit?: number; offset?: number; enabled?: boolean } = {},
) {
  const limit = options.limit ?? 6;
  const offset = options.offset ?? 0;
  return useQuery({
    queryKey: ['committee-payments', registrationNumber, 'received', year, limit, offset],
    queryFn: () =>
      getCommitteePaymentsReceivedFromApi(registrationNumber ?? '', {
        year,
        sort: 'amount',
        limit,
        offset,
      }),
    enabled: Boolean(registrationNumber) && (options.enabled ?? true),
    retry: false,
    placeholderData: keepPreviousData,
  });
}

/**
 * The full-payments view's list: pages of 250, largest first, accumulated as the
 * reader asks for more. 250 matches the served maximum, so "Show the next 250"
 * is one request.
 */
export function useCommitteePaymentsList(
  registrationNumber: string | null,
  direction: 'received' | 'made',
  year: number,
) {
  return useInfiniteQuery({
    queryKey: ['committee-payments-list', registrationNumber, direction, year],
    queryFn: ({
      pageParam,
    }): Promise<CommitteePaymentsPage<CommitteeReceivedPayment | CommitteeMadePayment> | null> =>
      direction === 'received'
        ? getCommitteePaymentsReceivedFromApi(registrationNumber ?? '', {
            year,
            sort: 'amount',
            limit: 250,
            offset: pageParam,
          })
        : getCommitteePaymentsMadeFromApi(registrationNumber ?? '', {
            year,
            sort: 'amount',
            limit: 250,
            offset: pageParam,
          }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage && lastPage.hasMore ? allPages.length * 250 : undefined,
    enabled: Boolean(registrationNumber),
    retry: false,
  });
}

/**
 * Every payment filed under exactly one printed name, for /money/payments (issue
 * #1780): pages of 250, newest first, accumulated as the reader asks for more.
 *
 * Newest first because that is the only order the server serves on a name-keyed
 * lookup, and the page says so where a reader can see it. 250 matches the served
 * maximum, so one press is one request.
 *
 * No `year` is passed, so this is every year our copy of the downloads reaches.
 * A payment carries its own date and reads honestly in a list spanning years,
 * which is why the name route makes the year optional where the committee route
 * does not.
 */
export function usePaymentsUnderName(name: string, role: PaymentNameRole | null) {
  return useInfiniteQuery({
    queryKey: ['payments-under-name', name, role],
    queryFn: ({ pageParam }): Promise<CommitteePaymentsPage<PaymentUnderName>> =>
      getPaymentsUnderNameFromApi(name, role as PaymentNameRole, {
        limit: PAYMENTS_UNDER_NAME_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length * PAYMENTS_UNDER_NAME_PAGE_SIZE : undefined,
    enabled: name.length > 0 && role !== null,
    retry: false,
  });
}

/**
 * Every report a committee is recorded as having filed, for the Filings tab:
 * pages of 100, newest period first, accumulated as the reader asks for more.
 * 100 matches the served maximum, and no committee in the live catalogue holds
 * more than 74 filed reports, so the whole history is usually one request.
 */
export function useCommitteeFilingsList(
  registrationNumber: string | null,
  options: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: ['committee-filings', registrationNumber],
    queryFn: ({ pageParam }): Promise<CommitteeFilingsPage> =>
      getCommitteeFilingsFromApi(registrationNumber ?? '', { limit: 100, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length * 100 : undefined,
    enabled: Boolean(registrationNumber) && (options.enabled ?? true),
    retry: false,
  });
}

/** The largest payments out of a committee for one year. */
export function useCommitteePaymentsMade(
  registrationNumber: string | null,
  year: number,
  options: { limit?: number; offset?: number; enabled?: boolean } = {},
) {
  const limit = options.limit ?? 6;
  const offset = options.offset ?? 0;
  return useQuery({
    queryKey: ['committee-payments', registrationNumber, 'made', year, limit, offset],
    queryFn: () =>
      getCommitteePaymentsMadeFromApi(registrationNumber ?? '', {
        year,
        sort: 'amount',
        limit,
        offset,
      }),
    enabled: Boolean(registrationNumber) && (options.enabled ?? true),
    retry: false,
    placeholderData: keepPreviousData,
  });
}

// Warm the detail-page cache on navigation intent (card hover / press-in) so the
// bill or legislator is already loading — usually loaded — by the time the user
// clicks, replacing the full-page "Loading…" spinner with an instant open. Keys
// and query fns match useBill / useLegislator exactly, so the prefetched entry is
// the one the detail screen reads; prefetchQuery honors the default staleTime, so
// hovering a whole list fetches each target at most once per freshness window.
export function usePrefetchBill() {
  const queryClient = useQueryClient();
  return (billId: string) =>
    void queryClient.prefetchQuery({
      queryKey: ['bill', billId],
      queryFn: () => getBillFromApi(billId),
      retry: false,
    });
}

export function usePrefetchBillVotes() {
  const queryClient = useQueryClient();
  return (billId: string) =>
    void queryClient.prefetchQuery({
      queryKey: ['bill-votes', billId],
      queryFn: () => getBillVotesFromApi(billId),
    });
}

export function usePrefetchLegislator() {
  const queryClient = useQueryClient();
  return (legislatorId: string) =>
    void queryClient.prefetchQuery({
      queryKey: ['legislator', legislatorId],
      queryFn: () => getLegislatorFromApi(legislatorId),
      retry: false,
    });
}

// Warm a committee's money-page cache AND its screen file on navigation intent
// (row hover / press-in), so the page opens with no loading skeleton and no
// waiting on a separate download, matching usePrefetchBill / usePrefetchLegislator
// (#1966 AC5) plus the route-splitting piece each screen now downloads on its
// own (screenLoaderForPath, #1970/#1975). A money row's link never carries a
// year (CommitteeMoney is always pushed with just a slug), so the screen falls
// back to the current filing year (campaignMoneyYear with no route param) —
// prefetch that same year so the key lines up exactly with what the screen
// reads. `slug` is the same value the row's own link already builds with
// committeeSlug(), so screenLoaderForPath resolves the same CommitteeMoney
// chunk the click would load.
export function usePrefetchCommitteeMoney() {
  const queryClient = useQueryClient();
  return (registrationNumber: string, slug: string) => {
    const year = campaignMoneyYear(undefined);
    void queryClient.prefetchQuery({
      queryKey: ['committee-money', registrationNumber, year],
      queryFn: () => getCommitteeFinanceFromApi(registrationNumber, year),
      retry: false,
    });
    void screenLoaderForPath(routePath.moneyCommittee(slug))?.();
  };
}

// Warm the bill-list cache for a filter combo the user is about to select
// (chip hover), so the filtered results are already loading — usually loaded —
// by the time they tap, making the swap feel instant instead of waiting on a
// fresh GET /bills round trip (#492). The key must match useBills exactly so
// the prefetched entry is the one the list reads; prefetchQuery honors the
// default staleTime, so hovering across chips fetches each combo at most once
// per freshness window.
export function usePrefetchBills() {
  const queryClient = useQueryClient();
  return (
    query: string | undefined,
    session: string | undefined,
    filters: BillListFilters,
    pagination: ListPagination,
  ) =>
    void queryClient.prefetchQuery({
      queryKey: [
        'bills',
        session ?? 'current',
        query ?? '',
        filters,
        pagination.limit ?? 20,
        pagination.offset ?? 0,
      ],
      queryFn: () => listBillsFromApi(query, session, filters, pagination),
      retry: false,
    });
}

export function useLegislatorBills(legislatorId: string, pagination: ListPagination = {}) {
  return useQuery({
    queryKey: [
      'legislator-bills',
      legislatorId,
      pagination.limit ?? 20,
      pagination.offset ?? 0,
      pagination.role ?? 'all',
      pagination.session ?? 'current',
    ],
    queryFn: () => getLegislatorBillsFromApi(legislatorId, pagination),
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useTrackedBills(userId?: string) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: ['tracked-bills', userId ?? 'anon'],
    queryFn: () => listTrackedBillsFromApi(accessToken ?? ''),
    enabled: Boolean(userId && accessToken),
    retry: false,
  });
}

// What the Track button honestly knows about this reader's tracked state, plus the
// way out when the answer never came (#1013, #1021). Kept next to the query it reads
// so the two cannot drift, and deliberately NOT derived from `isLoading` or
// `isPending` — see the comment block in `lib/trackedState.ts` for why neither flag
// alone is correct on this version of React Query.
//
// `recheck` refetches the ONE shared query every Track button on the page reads
// (`['tracked-bills', userId]`), so a single press resolves every unresolved button
// at once. That is the design's "one press fixes the page", and it needs no
// coordination — it falls out of every button already sharing one query key. The same
// sharing is why the extra observers cost nothing: measured A/B against main, page
// load fires the same number of requests with and without these subscriptions.
export function useTrackedListState(): {
  state: (isTracked: boolean) => TrackState;
  isError: boolean;
  recheck: () => void;
} {
  const { isSignedIn, user } = useAuth();
  const trackedQuery = useTrackedBills(user?.id);
  const hasList = trackedQuery.data !== undefined;
  const isError = trackedQuery.isError;
  return {
    state: (isTracked: boolean) => trackState({ isSignedIn, hasList, isError, isTracked }),
    // Only ever true for a signed-in reader with no list to fall back on: a
    // signed-out visitor's state is not unknown, so no page should show them a
    // failure notice about a list they do not have.
    isError: isSignedIn && !hasList && isError,
    recheck: () => void trackedQuery.refetch(),
  };
}

/**
 * Throw away what we hold about this reader's watchlist, so the next read comes
 * from the server. Every write to the watchlist calls this, from wherever it is
 * made, because a write that skips it leaves a stale list on screen that looks
 * exactly like a current one.
 *
 * It exists as a shared hook rather than an inline call because there are TWO
 * write paths and only one of them used to refresh anything. The other is a
 * Track press made while signed out, which the server holds and completes at
 * sign-in (`SignInModalProvider`): it wrote the row and refreshed nothing, so
 * the reader landed back on the bill with the Track button still offering to
 * track a bill they now tracked, and — since #1698 — the account menu printing
 * a count one short of the truth. Nothing corrected it until a tab focus or a
 * later mount happened to refetch.
 *
 * `refetchType: 'all'` refreshes the query even when nothing is watching it,
 * which is the case here: the account menu is shut while the write happens.
 */
export function useRefreshTrackedBills(userId?: string) {
  const queryClient = useQueryClient();

  return useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['tracked-bills', userId ?? 'anon'],
      refetchType: 'all',
    });
    void queryClient.invalidateQueries({ queryKey: ['bills'] });
    void queryClient.invalidateQueries({ queryKey: ['bill'] });
  }, [queryClient, userId]);
}

export function useSetTrackedBill(userId?: string) {
  const { accessToken } = useAuth();
  const refreshTrackedBills = useRefreshTrackedBills(userId);

  return useMutation({
    mutationFn: ({ billId, tracked }: { billId: string; tracked: boolean }) =>
      setTrackedBillFromApi(accessToken ?? '', billId, tracked),
    onSuccess: refreshTrackedBills,
  });
}

/**
 * The committees this reader follows (#1943). One shared query, like the bill
 * list, so the Tracked page and every Track control on a committee page read one
 * truth and a single write refreshes all of them.
 */
export function useTrackedCommittees(userId?: string) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: ['tracked-committees', userId ?? 'anon'],
    queryFn: () => listTrackedCommitteesFromApi(accessToken ?? ''),
    enabled: Boolean(userId && accessToken),
    retry: false,
  });
}

export function useRefreshTrackedCommittees(userId?: string) {
  const queryClient = useQueryClient();

  return useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['tracked-committees', userId ?? 'anon'],
      refetchType: 'all',
    });
  }, [queryClient, userId]);
}

export function useSetTrackedCommittee(userId?: string) {
  const { accessToken } = useAuth();
  const refresh = useRefreshTrackedCommittees(userId);

  return useMutation({
    mutationFn: ({
      registrationNumber,
      tracked,
    }: {
      registrationNumber: string;
      tracked: boolean;
    }) => setTrackedCommitteeFromApi(accessToken ?? '', registrationNumber, tracked),
    onSuccess: refresh,
  });
}

export function useRepresentativeLookup() {
  return useMutation({
    mutationFn: (input: RepresentativeLookupInput) => lookupRepresentativeFromApi(input),
  });
}

export function useAddressSuggestions(address?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['address-suggestions', address ?? ''],
    queryFn: () => suggestRepresentativeAddressesFromApi(address ?? ''),
    enabled: Boolean(address) && (options.enabled ?? true),
    staleTime: 60_000,
    retry: false,
  });
}

export function useChatSessions(userId?: string) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: ['chat-sessions', userId ?? 'anon'],
    queryFn: () => listChatSessionsFromApi(accessToken ?? ''),
    enabled: Boolean(userId && accessToken),
    retry: false,
  });
}

export function useChatSession(userId: string | undefined, sessionId: string | undefined) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: ['chat-session', userId ?? 'anon', sessionId ?? 'new'],
    queryFn: () => getChatSessionFromApi(accessToken ?? '', sessionId ?? ''),
    enabled: Boolean(userId && sessionId && accessToken),
    retry: false,
  });
}

export function useCreateChatSession(userId?: string) {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();

  return useMutation({
    mutationFn: (input: {
      title: string;
      subjectType: 'bill';
      subjectId?: string;
      seedPrompt?: string;
      subjectLabel?: string;
    }) => createChatSessionFromApi(accessToken ?? '', input),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ['chat-sessions', userId ?? 'anon'] });
      queryClient.setQueryData(['chat-session', userId ?? 'anon', session.id], session);
    },
  });
}

export function useSendChatMessage(userId?: string) {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();

  return useMutation({
    mutationFn: (input: { sessionId: string; text: string }) =>
      sendChatMessageToApi(accessToken ?? '', input),
    onSuccess: (session) => {
      if (!session) {
        return;
      }

      queryClient.setQueryData(['chat-session', userId ?? 'anon', session.id], session);
      void queryClient.invalidateQueries({ queryKey: ['chat-sessions', userId ?? 'anon'] });
    },
  });
}

export function useNotificationPreference(userId?: string) {
  return useQuery({
    queryKey: ['notification-preference', userId ?? 'anon'],
    queryFn: () => getNotificationPreference(userId ?? ''),
    enabled: Boolean(userId),
  });
}

export function useUpdateNotificationPreference(userId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { key: keyof NotificationPreference; value: boolean }) =>
      updateNotificationPreference(userId ?? '', input.key, input.value),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['notification-preference', userId ?? 'anon'],
      });
    },
  });
}

export function useSavedPlaces(userId?: string) {
  return useQuery({
    queryKey: ['saved-places', userId ?? 'anon'],
    queryFn: () => listSavedPlaces(userId ?? ''),
    enabled: Boolean(userId),
  });
}

/**
 * The outside-spending record for one committee, one direction at a time, for the
 * committee page's "Spent about them" and "Spent by them" tabs (#1947). Pages of 50
 * accumulate as the reader asks for more. The first page doubles as the presence
 * check that decides whether the tab is drawn at all: a subject with no rows gets no
 * tab, because "spent nothing" and "we hold nothing" cannot be told apart.
 *
 * No year filter, deliberately: outside spending is filed by election cycle rather
 * than by the filing year the page's control selects, so each row carries its own
 * date and the tab reads the whole subject.
 */
export function useOutsideSpending(
  subject: { about?: string | null; spender?: string | null },
  sort: 'newest' | 'largest',
  options: { enabled?: boolean } = {},
) {
  const about = subject.about ?? undefined;
  const spender = subject.spender ?? undefined;
  return useInfiniteQuery({
    queryKey: ['outside-spending', about ?? '', spender ?? '', sort],
    queryFn: ({ pageParam }): Promise<CommitteeOutsideSpendingPage | null> =>
      getOutsideSpendingFromApi({ about, spender, sort, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last?.hasMore ? last.pageNumber + 1 : undefined),
    enabled: Boolean(about || spender) && (options.enabled ?? true),
    retry: false,
  });
}

/**
 * One page of the outside-spending record page for one subject, with its figures
 * (#1945; the committee page's tabs use `useOutsideSpending` above). The previous
 * answer is kept while a new page, year or sort loads, and it stays on screen when a
 * later request fails, which is what lets the page print "figures as accepted"
 * over the last figures it holds rather than a blank.
 */
export function useOutsideSpendingRecord(options: {
  about?: string;
  spender?: string;
  year: number | null;
  sort: 'newest' | 'largest';
  page: number;
}) {
  const key = outsideSpendingRecordQueryKey(options);
  return useQuery({
    queryKey: key,
    queryFn: () => getOutsideSpendingRecordFromApi(options),
    // The bare /money/outside-spending address is served with this read already
    // made, so its figures are on screen at once rather than after the cold
    // 2,975 ms read that made it the slowest first load on the money pages (#1966).
    initialData: seededQueryData(key, outsideSpendingRecordPageFromPayload),
    retry: false,
    placeholderData: keepPreviousData,
  });
}
