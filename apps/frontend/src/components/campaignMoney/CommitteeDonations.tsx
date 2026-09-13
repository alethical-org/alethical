import { useMemo, type ReactNode } from 'react';
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
}: {
  committee: Pick<CampaignCommitteeMoney, 'registrationNumber' | 'split'>;
  headingLevel?: 2 | 4;
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
  const failed =
    summaryMismatch ||
    details.releaseMismatch ||
    details.received.isError ||
    details.made.isError ||
    details.received.data?.state === 'unavailable' ||
    details.made.data?.state === 'unavailable';
  return (
    <View style={s.section}>
      <DonorBreakdown
        headingLevel={headingLevel}
        payments={details.received.data?.payments ?? []}
        split={committee.split}
        year={year}
        complete={details.selectedComplete && !failed}
        failed={failed}
        onSelectTab={(tab) => onPreferences({ ...preferences, tab })}
      />
      {children}
      <DonorPaymentList
        groups={groups}
        year={year}
        tab={preferences.tab}
        onSelectTab={(tab) => onPreferences({ ...preferences, tab })}
        selectedSort={preferences.sort}
        onSelectSort={(sort) => onPreferences({ ...preferences, sort })}
        ready={details.selectedComplete && !failed}
        failed={failed}
        onRetry={() => {
          onRefresh();
          void details.received.refetch();
          void details.made.refetch();
        }}
      />
    </View>
  );
}
