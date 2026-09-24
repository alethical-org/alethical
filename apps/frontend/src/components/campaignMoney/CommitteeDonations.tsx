import { useMemo, useRef, type ReactNode } from 'react';
import { View } from 'react-native';

import type { CampaignCommitteeMoney } from '../../data/types';
import { useCampaignMoneyDetails } from '../../hooks/useCampaignMoneyDetails';
import {
  groupContributionPayments,
  groupExpenditurePayments,
  type MoneyDetailsPreferences,
} from '../../lib/campaignMoneyDetails';
import { DonorBreakdown } from './DonorBreakdown';
import { DonorPaymentList } from './DonorPaymentList';
import { detailsStyles as s } from './detailsStyles';

/** Every read and amount in this component belongs to this one registration. */
export function CommitteeDonations({
  committee,
  year,
  releaseId,
  onRefresh,
  children,
  preferences,
  onPreferences,
  headingLevel,
  isBallot = false,
  showStatements = false,
}: {
  committee: Pick<CampaignCommitteeMoney, 'registrationNumber' | 'split'>;
  headingLevel?: 2 | 3;
  /** Only the committee page draws disclosure statements inside payment rows (#2347). */
  showStatements?: boolean;
  /** A ballot-question filer's naming line is $500 rather than $200, so the dek above
   *  the chart has to know which kind of filer this page is about. */
  isBallot?: boolean;
  year: number;
  releaseId?: string;
  onRefresh: () => void;
  children: ReactNode;
  preferences: MoneyDetailsPreferences;
  onPreferences: (preferences: MoneyDetailsPreferences) => void;
}) {
  const details = useCampaignMoneyDetails(committee.registrationNumber, year, { history: false });
  const groups = useMemo(
    () => [
      ...groupContributionPayments(
        details.received.data?.payments ?? [],
        details.received.data?.linkableRegistrationNumbers ?? [],
      ),
      ...groupExpenditurePayments(
        details.made.data?.payments ?? [],
        details.made.data?.linkableRegistrationNumbers ?? [],
      ),
    ],
    [details.received.data, details.made.data],
  );
  const summaryMismatch = Boolean(
    releaseId && details.received.data && details.received.data.releaseId !== releaseId,
  );
  // Every read succeeded, but the totals above and the lists came from 2 copies of the
  // Board's records taken at different times, which happens in the minutes after a
  // publish. Not a load failure, so it gets its own sentence (#2363).
  const mixedCopies = summaryMismatch || details.releaseMismatch;
  const failed =
    mixedCopies ||
    details.received.isError ||
    details.made.isError ||
    details.received.data?.state === 'unavailable' ||
    details.made.data?.state === 'unavailable';
  // The last lists that matched the totals stay on screen when a later read brings a
  // newer copy the totals have not caught up with: those rows and the totals still
  // belong to the same copy, so nothing is mixed and nothing blanks.
  const lastMatched = useRef<{
    key: string;
    groups: typeof groups;
    payments: NonNullable<typeof details.received.data>['payments'];
  } | null>(null);
  const key = `${committee.registrationNumber}:${year}:${releaseId ?? ''}`;
  const complete = details.selectedComplete && !failed;
  if (complete && details.received.data) {
    lastMatched.current = { key, groups, payments: details.received.data.payments };
  }
  const kept =
    !complete && mixedCopies && lastMatched.current?.key === key ? lastMatched.current : null;
  const shownGroups = kept ? kept.groups : groups;
  const shownPayments = kept ? kept.payments : (details.received.data?.payments ?? []);
  const shownComplete = complete || Boolean(kept);
  return (
    <View style={s.section}>
      <DonorBreakdown
        headingLevel={headingLevel}
        payments={shownPayments}
        split={committee.split}
        year={year}
        complete={shownComplete}
        failed={failed}
        mixedCopies={mixedCopies}
        isBallot={isBallot}
      />
      {children}
      <DonorPaymentList
        groups={shownGroups}
        year={year}
        tab={preferences.tab}
        onSelectTab={(tab) => onPreferences({ ...preferences, tab })}
        showStatements={showStatements}
        selectedSort={preferences.sort}
        onSelectSort={(sort) => onPreferences({ ...preferences, sort })}
        ready={shownComplete}
        failed={failed}
        mixedCopies={mixedCopies}
        onRetry={() => {
          onRefresh();
          void details.received.refetch();
          void details.made.refetch();
        }}
      />
    </View>
  );
}
