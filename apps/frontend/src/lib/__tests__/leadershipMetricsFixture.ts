import type { LeadershipMetrics } from '../leadershipMetrics';

const asOf = '2026-09-07T00:00:00Z';
const periods7d = {
  startsAt: '2026-08-31T00:00:00Z',
  endsAt: asOf,
  previousStartsAt: '2026-08-24T00:00:00Z',
  previousEndsAt: '2026-08-31T00:00:00Z',
};
const periods30d = {
  startsAt: '2026-08-08T00:00:00Z',
  endsAt: asOf,
  previousStartsAt: '2026-07-09T00:00:00Z',
  previousEndsAt: '2026-08-08T00:00:00Z',
};

export function leadershipFixture(): LeadershipMetrics {
  const actions = {
    billSearchesWithResults: 12,
    legislatorSearchesWithResults: 2,
    moneySearchesWithResults: 0,
    findMyLegislatorWithResults: 1,
    officialSourceLinksOpened: 5,
    newBillWatches: 3,
    newReaderAccounts: 1,
    newCommitteeWatches: 0,
  };
  return {
    asOf,
    errors: { operations: null, accounts: null, activity: null },
    accounts: {
      currentAccountsCreated: 23,
      currentConfirmedAccounts: 20,
      currentUnconfirmedAccounts: 3,
      created7d: 4,
      created30d: 8,
      previousCreated7d: 2,
      previousCreated30d: 6,
      periods7d,
      periods30d,
      asOf,
      source: 'supabase',
      scope: 'current_surviving_reader_accounts',
      definition: 'Counts current surviving reader accounts by their signup date.',
      historyLimitation: 'Deleted accounts are not included, so past creation totals can decrease.',
    },
    activity: {
      actions7d: { ...actions },
      actions30d: { ...actions },
      previousActions7d: { ...actions },
      previousActions30d: { ...actions },
      periods7d,
      periods30d,
      fetchedAt: asOf,
      teamExclusionConfigured: true,
      history: Object.fromEntries(
        Object.keys(actions).map((key) => [
          key,
          {
            recordingStartedAt: '2026-07-01T00:00:00Z',
            current7dComplete: true,
            current30dComplete: true,
            previous7dComplete: true,
            previous30dComplete: true,
          },
        ]),
      ) as NonNullable<LeadershipMetrics['activity']>['history'],
      totalsSinceStart: { newReaderAccounts: 12, newBillWatches: 8, newCommitteeWatches: 3 },
      readers: {
        registeredReaders: 12,
        currentBillWatches: 6,
        differentBillsCurrentlyWatched: 4,
        currentReaderAccounts: 12,
        currentBillFollowingReaders: 3,
        currentCommitteeFollowingReaders: 1,
        currentCommitteeWatches: 2,
        differentCommitteesCurrentlyWatched: 2,
      },
    },
    operations: {
      fetchedAt: asOf,
      periodStartedAt: periods30d.startsAt,
      periodEndedAt: asOf,
      corpus: {
        bills: 2001,
        legislators: 206,
        current_legislators: 200,
        committees: 125,
        scope:
          'Inventory counts include all stored records across all sessions. Currently serving counts distinct people in the current-session roster. Committee records are legislative committees, not campaign committees.',
        coveragePercentage: {
          value: null,
          reason: 'No matching official denominator is stored for corpus coverage.',
        },
      },
      freshness: [
        'Minnesota bills',
        'Minnesota legislator roster',
        'Minnesota campaign payments',
        'Minnesota campaign filings',
        'Minnesota lobbying expenditures',
      ].map((source) => ({
        source,
        lastSucceededAt: '2026-09-06T00:00:00Z',
        meaning:
          source === 'Minnesota bills'
            ? 'Latest recorded successful refresh of 1 bill, not proof that every bill is current.'
            : 'Latest recorded successful source check.',
        unavailableReason: null,
        currentPublishedFetchCompletedAt: null,
        publishedDataMeaning:
          'End of the fetch window for the currently published dataset; a newer unchanged check may not replace it.',
        publishedDataUnavailableReason: 'No current usable published dataset is recorded.',
      })),
      reliability: {
        recordedIngestionFailures: {
          value: 2,
          meaning:
            'Recorded ingestion runs marked failed and finished in the window; not all background-job failures or interrupted runs.',
        },
        billSummaryFailures: {
          value: 1,
          meaning: 'Stored failed requests, not a count of every failed attempt.',
        },
        billSummaryAmbiguous: {
          value: 1,
          meaning: 'Stored outcomes remain ambiguous, not proven failures.',
        },
        allRequestFailures: {
          value: null,
          reason:
            'API errors are reported to Sentry; no complete durable request-failure counter is stored in this database.',
        },
        allJobFailures: {
          value: null,
          reason:
            'The ingestion ledger does not record every background job or failed attempt; no complete durable job-failure total is available here.',
        },
      },
      costs: {
        billSummaryLoggedCost: {
          valueMicrousd: 1234567,
          requestsWithLoggedCost: 4,
          requestsWithoutLoggedCost: 1,
          status: 'partial',
          unavailableReason: 'Some finished bill-summary requests lack a valid logged cost.',
          meaning:
            'Logged bill-summary list-price estimates for provider calls finished in the window, in millionths of a US dollar; not invoices, reserved budgets, or total operating cost.',
        },
        totalOperatingCost: {
          value: null,
          reason:
            'Complete hosting, storage, monitoring, and AI vendor bills are not stored together in this database.',
        },
      },
    },
  };
}
