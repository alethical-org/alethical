import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GoBackLink } from '../../components/GoBackLink';
import { SearchPageShell } from '../../components/search/searchPieces';
import { ApiError, getLeadershipMetricsFromApi } from '../../data/api';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import { useResponsive } from '../../hooks/useResponsive';
import {
  leadershipActionRows,
  leadershipDate,
  type LeadershipMetrics,
} from '../../lib/leadershipMetrics';
import { useDocumentTitle } from '../../navigation/documentTitle';
import type { MenuKey } from '../../navigation/ia';
import { routePath } from '../../navigation/links';
import { navigateTopNavItem } from '../../navigation/topNavRoutes';
import type { RootScreenProps } from '../../navigation/types';
import { useAuth } from '../../providers/AuthProvider';
import { useSignInModal } from '../../providers/signInModalContext';
import { fieldFocusRing, useFieldFocus } from '../../theme/fieldFocus';
import { theme as t } from '../../theme/tokens';

function Action({
  label,
  onPress,
  selected,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
}) {
  const { focused, focusProps } = useFieldFocus();
  return (
    <Pressable
      accessibilityRole="button"
      aria-pressed={selected}
      onPress={onPress}
      {...focusProps}
      style={[styles.button, selected && styles.selected, ...fieldFocusRing(focused)]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}
function Message({ children, retry }: { children: ReactNode; retry?: () => void }) {
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      <Text style={styles.body}>{children}</Text>
      {retry ? <Action label="Retry" onPress={retry} /> : null}
    </View>
  );
}
function Card({ title, children }: { title: string; children: ReactNode }) {
  const { isDesktop } = useResponsive();
  return (
    <View style={[styles.card, isDesktop && styles.cardWide]}>
      <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
        {title}
      </Text>
      {children}
    </View>
  );
}
function Row({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>
          {typeof value === 'number' ? value.toLocaleString('en-US') : value}
        </Text>
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

/** Mounted only for this allowed account and token; never stored in a shared query cache. */
function PrivateMetrics({ accessToken }: { accessToken: string }) {
  const [attempt, setAttempt] = useState(0);
  const [days, setDays] = useState<7 | 30>(7);
  const [loaded, setLoaded] = useState<{
    attempt: number;
    result: LeadershipMetrics | null;
    restricted: boolean;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null);
    void getLeadershipMetricsFromApi(accessToken, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setLoaded({ attempt, result, restricted: false });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({
            attempt,
            result: null,
            restricted: error instanceof ApiError && error.status === 403,
          });
      },
    );
    return () => controller.abort();
  }, [accessToken, attempt]);
  const current = loaded?.attempt === attempt ? loaded : null;
  if (!current) return <Message>Loading leadership metrics…</Message>;
  if (current.restricted)
    return <Message>Restricted access. This account cannot view leadership metrics.</Message>;
  if (!current.result)
    return (
      <Message retry={() => setAttempt((v) => v + 1)}>
        Leadership metrics are unavailable. Try again.
      </Message>
    );
  const { accounts, activity, operations, errors, asOf } = current.result;
  const accountPeriod = accounts?.[days === 7 ? 'periods7d' : 'periods30d'];
  const actionPeriod = activity?.[days === 7 ? 'periods7d' : 'periods30d'];
  const costs = operations?.costs.billSummaryLoggedCost;
  return (
    <View style={styles.content}>
      <View style={styles.toolbar}>
        <View role="group" aria-label="Account creation and activity range" style={styles.buttons}>
          {([7, 30] as const).map((range) => (
            <Action
              key={range}
              label={`Last ${range} days`}
              selected={range === days}
              onPress={() => setDays(range)}
            />
          ))}
        </View>
        <Action label="Refresh" onPress={() => setAttempt((v) => v + 1)} />
      </View>
      <Text style={styles.note}>
        The range changes account creation and recorded activity only. Current records stay current.
        Updated {leadershipDate(asOf)}.
      </Text>
      <View style={styles.grid}>
        <Card title="Accounts created">
          {!accounts ? (
            <Message>{errors.accounts}</Message>
          ) : (
            <>
              <Row
                label="Current surviving accounts created"
                value={accounts.currentAccountsCreated}
              />
              <Row label="Current confirmed accounts" value={accounts.currentConfirmedAccounts} />
              <Row
                label="Current unconfirmed accounts"
                value={accounts.currentUnconfirmedAccounts}
              />
              <Row
                label={`Surviving accounts created in last ${days} days`}
                value={accounts[days === 7 ? 'created7d' : 'created30d']}
              />
              <Row
                label={`Surviving accounts created in previous ${days} days`}
                value={accounts[days === 7 ? 'previousCreated7d' : 'previousCreated30d']}
              />
              <Text style={styles.note}>{accounts.definition}</Text>
              <Text style={styles.note}>{accounts.historyLimitation}</Text>
              <Text style={styles.note}>
                Current range: {leadershipDate(accountPeriod?.startsAt ?? null)} to{' '}
                {leadershipDate(accountPeriod?.endsAt ?? null)}. Previous range:{' '}
                {leadershipDate(accountPeriod?.previousStartsAt ?? null)} to{' '}
                {leadershipDate(accountPeriod?.previousEndsAt ?? null)}.
              </Text>
              <Text style={styles.note}>
                Source: Supabase sign-in records. Updated {leadershipDate(accounts.asOf)}.
              </Text>
            </>
          )}
        </Card>
        <Card title="Recorded activity">
          <Text style={styles.note}>
            Accounts first used counts first signed-in use, not sign-ups.
          </Text>
          {!activity ? (
            <Message>{errors.activity}</Message>
          ) : (
            <>
              <View role="table" aria-label="Recorded activity by range">
                <View role="row" style={styles.comparison}>
                  <Text role="columnheader" style={[styles.label, styles.actionColumn]}>
                    Action
                  </Text>
                  <Text role="columnheader" style={[styles.label, styles.countColumn]}>
                    Last {days} days
                  </Text>
                  <Text role="columnheader" style={[styles.label, styles.countColumn]}>
                    Previous {days} days
                  </Text>
                </View>
                {leadershipActionRows(activity, days).map((row) => (
                  <View key={row.label} role="row" style={[styles.row, styles.comparison]}>
                    <View role="rowheader" style={styles.actionColumn}>
                      <Text style={styles.label}>{row.label}</Text>
                      <Text style={styles.note}>{row.note}</Text>
                    </View>
                    <Text role="cell" style={[styles.body, styles.countColumn]}>
                      {row.current}
                    </Text>
                    <Text role="cell" style={[styles.body, styles.countColumn]}>
                      {row.previous}
                    </Text>
                  </View>
                ))}
              </View>
              {actionPeriod ? (
                <Text style={styles.note}>
                  Current range: {leadershipDate(actionPeriod.startsAt)} to{' '}
                  {leadershipDate(actionPeriod.endsAt)}. Previous range:{' '}
                  {leadershipDate(actionPeriod.previousStartsAt)} to{' '}
                  {leadershipDate(actionPeriod.previousEndsAt)}.
                </Text>
              ) : (
                <Text style={styles.note}>Range history is unavailable.</Text>
              )}
              <Text style={styles.note}>
                Source: Alethical recorded actions. Updated {leadershipDate(activity.fetchedAt)}.
              </Text>
            </>
          )}
        </Card>
        <Card title="Current follows">
          {!activity ? (
            <Message>{errors.activity}</Message>
          ) : (
            <>
              <Row label="Current bill follows" value={activity.readers.currentBillWatches} />
              <Row
                label="Different bills currently followed"
                value={activity.readers.differentBillsCurrentlyWatched}
              />
              <Row
                label="Readers currently following bills"
                value={activity.readers.currentBillFollowingReaders ?? 'Not recorded yet'}
              />
              <Row
                label="Current committee follows"
                value={activity.readers.currentCommitteeWatches ?? 'Not recorded yet'}
              />
              <Row
                label="Different committees currently followed"
                value={activity.readers.differentCommitteesCurrentlyWatched ?? 'Not recorded yet'}
              />
              <Row
                label="Readers currently following committees"
                value={activity.readers.currentCommitteeFollowingReaders ?? 'Not recorded yet'}
              />
              <Text style={styles.note}>
                Current saved follows, not all follows ever created. Updated{' '}
                {leadershipDate(activity.fetchedAt)}.
              </Text>
            </>
          )}
        </Card>
        <Card title="Records Alethical holds">
          {!operations ? (
            <Message>{errors.operations}</Message>
          ) : (
            <>
              <Row label="Stored bills" value={operations.corpus.bills} />
              <Row label="Stored legislators" value={operations.corpus.legislators} />
              <Row label="Stored legislative committees" value={operations.corpus.committees} />
              <Text style={styles.note}>{operations.corpus.scope}</Text>
              <Row
                label="Share of official records held"
                value="Unavailable"
                note={operations.corpus.coveragePercentage.reason}
              />
              <Text style={styles.note}>
                Current database records. Updated {leadershipDate(operations.fetchedAt)}.
              </Text>
            </>
          )}
        </Card>
        <Card title="Source checks and published data">
          {!operations ? (
            <Message>{errors.operations}</Message>
          ) : (
            operations.freshness.map((source) => (
              <View key={source.source} style={styles.row}>
                <Text accessibilityRole="header" aria-level={3} style={styles.label}>
                  {source.source}
                </Text>
                <Text style={styles.body}>
                  Latest successful check: {leadershipDate(source.lastSucceededAt)}
                </Text>
                <Text style={styles.note}>{source.meaning}</Text>
                {source.unavailableReason ? (
                  <Text style={styles.note}>{source.unavailableReason}</Text>
                ) : null}
                <Text style={styles.body}>
                  Published data fetch completed:{' '}
                  {source.currentPublishedFetchCompletedAt
                    ? leadershipDate(source.currentPublishedFetchCompletedAt)
                    : 'Unavailable'}
                </Text>
                <Text style={styles.note}>{source.publishedDataMeaning}</Text>
                {source.publishedDataUnavailableReason &&
                source.publishedDataUnavailableReason !== source.publishedDataMeaning ? (
                  <Text style={styles.note}>{source.publishedDataUnavailableReason}</Text>
                ) : null}
              </View>
            ))
          )}
        </Card>
        <Card title="Recorded failures and logged cost">
          {!operations || !costs ? (
            <Message>{errors.operations}</Message>
          ) : (
            <>
              <Text style={styles.note}>
                30 complete UTC days: {leadershipDate(operations.periodStartedAt)} to{' '}
                {leadershipDate(operations.periodEndedAt)}.
              </Text>
              <Row
                label="Recorded source-import failures"
                value={operations.reliability.recordedIngestionFailures.value}
                note={operations.reliability.recordedIngestionFailures.meaning}
              />
              <Row
                label="Bill-summary requests marked failed"
                value={operations.reliability.billSummaryFailures.value}
                note={operations.reliability.billSummaryFailures.meaning}
              />
              <Row
                label="Bill-summary requests with an uncertain outcome"
                value={operations.reliability.billSummaryAmbiguous.value}
                note={operations.reliability.billSummaryAmbiguous.meaning}
              />
              <Row
                label="All request failures"
                value="Unavailable"
                note={operations.reliability.allRequestFailures.reason}
              />
              <Row
                label="All background-job failures"
                value="Unavailable"
                note={operations.reliability.allJobFailures.reason}
              />
              <Row
                label="Logged bill-summary list-price estimate"
                value={
                  costs.valueMicrousd === null
                    ? 'Unavailable'
                    : `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(costs.valueMicrousd / 1000000)}${costs.status === 'partial' ? ' · Partial records' : ''}`
                }
                note={costs.meaning}
              />
              <Row label="Requests with a logged cost" value={costs.requestsWithLoggedCost} />
              <Row
                label="Requests without a valid logged cost"
                value={costs.requestsWithoutLoggedCost}
              />
              {costs.unavailableReason ? (
                <Text style={styles.note}>{costs.unavailableReason}</Text>
              ) : null}
              <Row
                label="Total operating cost"
                value="Unavailable"
                note={operations.costs.totalOperatingCost.reason}
              />
            </>
          )}
        </Card>
      </View>
    </View>
  );
}

export function AdminSiteMetricsScreen({ navigation }: RootScreenProps<'AdminSiteMetrics'>) {
  const { user, accessToken, isLoading, isSignedIn } = useAuth();
  const access = useAdminAccess();
  const { openSignIn } = useSignInModal();
  const { isMobile } = useResponsive();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  useDocumentTitle('/admin/site-metrics', 'Leadership metrics | Alethical');
  return (
    <SearchPageShell
      openMenu={openMenu}
      onOpenMenuChange={setOpenMenu}
      onNavigate={(item) => navigateTopNavItem(navigation, item)}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
      onPrivacy={() => navigation.navigate('Privacy')}
      onTerms={() => navigation.navigate('Terms')}
      hero={
        <View>
          <GoBackLink
            href={routePath.home()}
            mobile={isMobile}
            onPress={() =>
              navigation.canGoBack()
                ? navigation.goBack()
                : navigation.navigate('Tabs', { screen: 'Home' })
            }
          />
          <Text style={styles.adminLabel}>Admin</Text>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.h1, isMobile && styles.h1Mobile]}
          >
            Leadership metrics
          </Text>
          <Text style={styles.intro}>
            Account growth, recorded activity, and the records Alethical holds
          </Text>
        </View>
      }
    >
      {access.state === 'signed-out' ? (
        <View>
          <Message>Sign in with an administrator account to view leadership metrics.</Message>
          <Action
            label="Sign in"
            onPress={() => openSignIn({ intent: 'nav', returnTo: '/admin/site-metrics' })}
          />
        </View>
      ) : access.state === 'loading' || isLoading ? (
        <Message>Checking access…</Message>
      ) : access.state === 'restricted' ? (
        <Message>Restricted access. This account cannot view leadership metrics.</Message>
      ) : access.state === 'error' ? (
        <Message retry={access.retry}>We couldn’t check access. Try again.</Message>
      ) : access.state === 'allowed' && isSignedIn && user && accessToken ? (
        <PrivateMetrics key={`${user.id}:${accessToken}`} accessToken={accessToken} />
      ) : null}
    </SearchPageShell>
  );
}

const styles = StyleSheet.create({
  comparison: { flexDirection: 'row', gap: 10 },
  actionColumn: { flex: 1.5, minWidth: 0, gap: 6 },
  countColumn: { flex: 1, minWidth: 0 },
  content: { gap: 18, paddingBottom: 32 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' },
  card: {
    width: '100%',
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: t.radii.card,
    padding: 20,
    backgroundColor: t.colors.surface,
    gap: 12,
  },
  cardWide: { width: '48%' },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderColor: t.colors.border, gap: 6 },
  rowTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  label: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  value: {
    fontFamily: t.typography.ui,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '700',
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  body: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 23,
    color: t.colors.text.primary,
  },
  note: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  h2: {
    fontFamily: t.typography.title,
    fontSize: 23,
    fontWeight: '700',
    color: t.colors.text.primary,
  },
  adminLabel: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text.green,
    marginBottom: 8,
  },
  h1: {
    fontFamily: t.typography.title,
    fontSize: 48,
    fontWeight: '800',
    color: t.colors.text.primary,
  },
  h1Mobile: { fontSize: 36 },
  intro: {
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26,
    color: t.colors.text.secondary,
    marginTop: 14,
    maxWidth: 720,
  },
  state: { gap: 16, paddingVertical: 24, alignItems: 'flex-start' },
  button: {
    minHeight: 44,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 8,
    backgroundColor: t.colors.surface,
  },
  buttonText: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text.primary,
  },
  selected: { backgroundColor: t.colors.accentSoft, borderColor: t.colors.brand.deep },
});
