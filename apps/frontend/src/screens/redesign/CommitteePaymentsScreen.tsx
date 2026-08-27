import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { YearControl } from '../../components/campaignMoney/CampaignMoneyTab';
import { UnderDevelopmentNotice } from '../../components/campaignMoney/UnderDevelopmentNotice';
import { Skeleton } from '../../components/Skeleton';
import type { CommitteeMadePayment, CommitteeReceivedPayment } from '../../data/types';
import { useCommitteeMoney, useCommitteePaymentsList } from '../../hooks/useAppQueries';
import { useResponsive } from '../../hooks/useResponsive';
import {
  CAP_NOTE,
  capNextLabel,
  committeeSlug,
  coveredPeriodDetail,
  coveredPeriodLine,
  emptyListTitle,
  emptyListWhy,
  isBallotQuestionFiler,
  isInKind,
  IN_KIND_CHIP,
  listLinkNote,
  madeRowMeta,
  notFoundBody,
  notFoundTitle,
  PAYMENTS_TAB_LABELS,
  paymentsEyebrow,
  paymentsTabFromParam,
  paymentsTitle,
  receivedRowMeta,
  registerKindFromEntityType,
  registrationNumberFromSlug,
  showingLine,
  staleHoldNote,
  uncoveredPeriodDetail,
  uncoveredPeriodLine,
  type PaymentsTab,
} from '../../lib/committeeMoney';
import { campaignMoneyYear, formatDay, formatMoney } from '../../lib/legislatorCampaignMoney';
import { centralDateLabel } from '../../lib/moneyLanding';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

/**
 * Every named payment behind one committee's figures, at
 * /money/committees/{name}-{number}/payments ("Money lists web.dc.html" screen C).
 *
 * Amounts DO appear here, largest first: ranking payments inside one committee is
 * a fact about that committee, not a comparison between filers on different
 * filing calendars (design doc §7). The year and the who-gave / where-it-went tab
 * ride in the address, so a shared link carries exactly what the sender saw.
 *
 * The list is capped at 250 rows at a time, and the cap card says the cap is
 * ours, not the filing's — the reports these payments come from list every one
 * of them, and they are public. "Showing X of Y" uses the served count, measured
 * with the same filter as the rows.
 */

const BOARD_VIEWER = 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/';

function BackChevron() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M15 5 L8 12 L15 19"
        stroke={t.colors.text.secondary}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CommitteePaymentsScreen({
  navigation,
  route,
}: RootScreenProps<'CommitteePayments'>) {
  const { isMobile } = useResponsive();
  const slug = route.params?.slug ?? '';
  const registrationNumber = registrationNumberFromSlug(slug);
  const year = campaignMoneyYear(route.params?.year);
  const tab = paymentsTabFromParam(route.params?.tab);

  // The committee's own header facts (name, kind, coverage). Shares the money
  // query's cache with the committee page, so arriving from there costs nothing.
  const moneyQuery = useCommitteeMoney(registrationNumber, year);
  const money = moneyQuery.data ?? null;
  const notFound = moneyQuery.data === null && !moneyQuery.isPending && !moneyQuery.isError;

  const list = useCommitteePaymentsList(
    registrationNumber,
    tab === 'gave' ? 'received' : 'made',
    year,
  );

  const name = money
    ? (money.register.name ?? money.committeeName ?? `Committee ${registrationNumber}`)
    : null;
  useDocumentTitle(
    registrationNumber ? `/money/committees/${slug}/payments` : null,
    name ? `${paymentsTitle(tab)} — ${name} | Alethical` : null,
  );

  const onSelectYear = (next: number) => navigation.setParams({ year: String(next) });
  const onSelectTab = (next: PaymentsTab) => navigation.setParams({ tab: next });
  const registerKind = money
    ? money.register.state === 'reported'
      ? money.register.kind
      : registerKindFromEntityType(money.entityType)
    : null;
  const isBallot = money ? isBallotQuestionFiler(money.entitySubType) : false;
  const checkedOn = money?.fetchedAt ? centralDateLabel(money.fetchedAt) : null;

  const pages = (list.data?.pages ?? []).filter(
    (page): page is NonNullable<typeof page> => page !== null,
  );
  const firstPage = pages[0];
  const rows = pages.flatMap((page) => page.payments);
  const linkable = new Set(pages.flatMap((page) => page.linkableRegistrationNumbers));
  const total = firstPage?.totalPayments ?? null;
  const listState = firstPage?.state ?? null;
  const yearCovered = money
    ? money.split.reportedThrough !== null || listState === 'reported'
    : false;

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        {/* The section is partially built (the who-got-paid page is #1780) and
            nothing else on the page says so at a glance. Deleting the element
            and its component file is the whole removal. */}
        <UnderDevelopmentNotice />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <Pressable
            {...linkProps(routePath.moneyCommittee(slug, { tab, year: String(year) }), () =>
              navigation.navigate('CommitteeMoney', { slug, tab, year: String(year) }),
            )}
            style={styles.backLink}
          >
            <BackChevron />
            <Text style={styles.backLabel}>{name ?? 'Committee'}</Text>
          </Pressable>

          {notFound && registrationNumber ? (
            <View style={styles.notFoundWrap}>
              <Text style={styles.eyebrow}>COMMITTEES</Text>
              <Text accessibilityRole="header" aria-level={1} style={styles.h1}>
                {notFoundTitle()}
              </Text>
              <Text style={styles.body}>{notFoundBody(registrationNumber)}</Text>
            </View>
          ) : (
            <>
              <Text style={[styles.eyebrow, styles.eyebrowSpaced]}>
                {paymentsEyebrow(tab).toUpperCase()}
              </Text>
              <Text
                accessibilityRole="header"
                aria-level={1}
                style={[styles.h1, isMobile && styles.h1Mobile]}
              >
                {paymentsTitle(tab)}
              </Text>
              <View style={styles.chipRow}>
                {registrationNumber ? (
                  <Text style={styles.regChip}>REG {registrationNumber}</Text>
                ) : null}
                {name ? <Text style={styles.entName}>{name}</Text> : null}
              </View>

              <View style={styles.yearRow}>
                <Text style={styles.yearLabel}>FILING YEAR</Text>
                <YearControl year={year} onSelect={onSelectYear} />
              </View>

              <View style={styles.stampCard}>
                {yearCovered ? (
                  <>
                    {coveredPeriodLine(
                      money?.split.reportedThrough,
                      money?.moneyIn.reportedPeriodStart,
                    ) ? (
                      <Text style={styles.stampPeriod}>
                        {coveredPeriodLine(
                          money?.split.reportedThrough,
                          money?.moneyIn.reportedPeriodStart,
                        )}
                      </Text>
                    ) : null}
                    <Text style={styles.stampDetail}>
                      {coveredPeriodDetail(money?.split.reportedThrough ?? null, checkedOn, {
                        isPartyUnit: registerKind === 'party_unit',
                        reportedPeriodStart: money?.moneyIn.reportedPeriodStart ?? null,
                      })}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.stampPeriodMuted}>{uncoveredPeriodLine(year)}</Text>
                    <Text style={styles.stampDetail}>{uncoveredPeriodDetail(year, checkedOn)}</Text>
                  </>
                )}
                {moneyQuery.isError && money ? (
                  <Text style={styles.stampDetail}>{staleHoldNote(checkedOn)}</Text>
                ) : null}
              </View>

              <View style={styles.tabsRow} role="tablist">
                {(Object.keys(PAYMENTS_TAB_LABELS) as PaymentsTab[]).map((key) => {
                  const active = key === tab;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => onSelectTab(key)}
                      accessibilityRole="tab"
                      aria-selected={active}
                      style={[styles.tab, active && styles.tabActive]}
                    >
                      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                        {PAYMENTS_TAB_LABELS[key]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {list.isPending ? (
                <View style={styles.listLoading}>
                  <View role="status" aria-busy style={styles.hidden}>
                    <Text>Loading figures</Text>
                  </View>
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <View key={index} style={styles.listRow}>
                      <View style={styles.listRowText}>
                        <Skeleton width={`${[58, 72, 44, 66, 52, 38][index]}%`} height={14} />
                        <Skeleton width={200} height={11} style={{ marginTop: 8 }} />
                      </View>
                      <Skeleton width={96} height={11} />
                    </View>
                  ))}
                </View>
              ) : list.isError && rows.length === 0 ? (
                <View style={styles.card}>
                  <Text accessibilityRole="alert" style={styles.body}>
                    We couldn’t load these payments right now. This is a problem on our side and
                    says nothing about the committee. Please try again in a moment.
                  </Text>
                </View>
              ) : !firstPage || firstPage.state !== 'reported' ? (
                <View style={styles.card}>
                  <Text style={styles.h3}>{emptyListTitle(tab, year)}</Text>
                  <Text style={styles.explain}>
                    {firstPage?.state === 'unavailable'
                      ? 'We could not read this committee’s payments out of our copy of Minnesota’s files. This is a gap on our side, not a statement about the committee.'
                      : emptyListWhy(year)}
                  </Text>
                  <Pressable
                    onPress={() =>
                      onSelectYear(year === new Date().getFullYear() ? year - 1 : year + 1)
                    }
                    accessibilityRole="button"
                    style={styles.primaryButton}
                  >
                    <Text style={styles.primaryButtonLabel}>
                      See {year === new Date().getFullYear() ? year - 1 : year + 1}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <PaymentRows
                  isMobile={isMobile}
                  tab={tab}
                  rows={rows}
                  total={total}
                  linkable={linkable}
                  isBallot={isBallot}
                  hasNextPage={Boolean(list.hasNextPage)}
                  isFetchingNextPage={list.isFetchingNextPage}
                  onMore={() => void list.fetchNextPage()}
                  navigation={navigation}
                />
              )}
            </>
          )}
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
  );
}

function PaymentRows({
  tab,
  rows,
  total,
  linkable,
  isBallot,
  hasNextPage,
  isFetchingNextPage,
  onMore,
  navigation,
  isMobile,
}: {
  isMobile: boolean;
  tab: PaymentsTab;
  rows: (CommitteeReceivedPayment | CommitteeMadePayment)[];
  total: number | null;
  linkable: Set<string>;
  isBallot: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onMore: () => void;
  navigation: RootScreenProps<'CommitteePayments'>['navigation'];
}) {
  const shaped = rows.map((payment, index) => {
    if (tab === 'gave') {
      const row = payment as CommitteeReceivedPayment;
      return {
        key: `${index}-${row.contributor}-${row.receivedOn}`,
        name: row.contributor ?? 'Name not given in the filing',
        meta: receivedRowMeta({
          contributorType: row.contributorType,
          receiptType: row.receiptType,
          inKind: row.inKind,
        }),
        date: formatDay(row.receivedOn),
        amount: formatMoney(row.amount),
        inKind: isInKind(row.inKind),
        linkNumber:
          row.contributorRegistrationNumber && linkable.has(row.contributorRegistrationNumber)
            ? row.contributorRegistrationNumber
            : null,
        linkName: row.contributor,
      };
    }
    const row = payment as CommitteeMadePayment;
    const isTransfer = row.expenditureType === 'Contribution';
    const displayName =
      (isTransfer ? (row.affectedCommitteeName ?? row.vendorName) : row.vendorName) ??
      'Name not given in the filing';
    return {
      key: `${index}-${displayName}-${row.paidOn}`,
      name: displayName,
      meta: madeRowMeta({
        expenditureType: row.expenditureType,
        purpose: row.purpose,
        vendorCity: row.vendorCity,
        vendorState: row.vendorState,
        inKind: row.inKind,
      }),
      date: formatDay(row.paidOn),
      amount: formatMoney(row.amount),
      inKind: isInKind(row.inKind),
      linkNumber:
        row.affectedCommitteeRegistrationNumber &&
        linkable.has(row.affectedCommitteeRegistrationNumber)
          ? row.affectedCommitteeRegistrationNumber
          : null,
      linkName: row.affectedCommitteeName,
    };
  });

  return (
    <View>
      <View style={styles.listHead}>
        <Text style={styles.listCount}>{showingLine(shaped.length, total) ?? ''}</Text>
        <Text style={styles.listSort}>LARGEST FIRST</Text>
      </View>
      <View style={styles.listRows}>
        {shaped.map((row) => {
          const inner = (
            <>
              <View style={styles.listRowText}>
                <View style={styles.listNameRow}>
                  <Text style={styles.listName}>{row.name}</Text>
                  {row.inKind ? (
                    <Text style={styles.inKindChip}>{IN_KIND_CHIP.toUpperCase()}</Text>
                  ) : null}
                </View>
                {row.meta ? <Text style={styles.listMeta}>{row.meta}</Text> : null}
                {isMobile ? (
                  <View style={styles.listBottomRow}>
                    <Text style={styles.listDateMobile}>
                      {row.date ? row.date.toUpperCase() : ''}
                    </Text>
                    <Text style={styles.listAmountMobile}>{row.amount ?? ''}</Text>
                  </View>
                ) : null}
              </View>
              {isMobile ? null : (
                <>
                  <Text style={styles.listDate}>{row.date ? row.date.toUpperCase() : ''}</Text>
                  <Text style={styles.listAmount}>{row.amount ?? ''}</Text>
                </>
              )}
            </>
          );
          if (row.linkNumber) {
            const targetSlug = committeeSlug(row.linkName, row.linkNumber);
            return (
              <Pressable
                key={row.key}
                {...linkProps(routePath.moneyCommittee(targetSlug), () =>
                  navigation.push('CommitteeMoney', { slug: targetSlug }),
                )}
                style={styles.listRow}
              >
                {inner}
              </Pressable>
            );
          }
          return (
            <View key={row.key} style={styles.listRow}>
              {inner}
            </View>
          );
        })}
      </View>

      {hasNextPage && total !== null ? (
        <View style={styles.capCard}>
          <Text style={styles.capHead}>THIS PAGE IS CAPPED</Text>
          <Text style={styles.capNote}>{CAP_NOTE}</Text>
          <View style={styles.capActions}>
            <Pressable
              onPress={onMore}
              accessibilityRole="button"
              aria-disabled={isFetchingNextPage}
              style={styles.capButton}
            >
              <Text style={styles.capButtonLabel}>
                {isFetchingNextPage ? 'Loading…' : capNextLabel(shaped.length, total)}
              </Text>
            </Pressable>
            <Text
              style={styles.source}
              {...externalLinkProps(BOARD_VIEWER, () => void Linking.openURL(BOARD_VIEWER))}
            >
              Open the filing itself
            </Text>
          </View>
        </View>
      ) : null}

      <Text style={styles.linkNote}>{listLinkNote(tab, isBallot)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  main: { paddingTop: 28, paddingBottom: 64 },
  mainMobile: { paddingTop: 18 },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  backLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  eyebrow: {
    fontFamily: t.typography.body,
    fontSize: 13,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.4,
    color: t.colors.brand.base,
  },
  eyebrowSpaced: { marginTop: 22 },
  h1: {
    marginTop: 12,
    fontFamily: t.typography.title,
    fontSize: 38,
    lineHeight: 44,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1,
    color: t.colors.text.primary,
    maxWidth: 1100,
  },
  h1Mobile: { fontSize: 28, lineHeight: 34 },
  h3: {
    fontFamily: t.typography.title,
    fontSize: 19,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.2,
    color: t.colors.text.primary,
  },
  body: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 26,
    color: t.colors.text.primary,
    maxWidth: 760,
  },
  explain: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.secondary,
    maxWidth: 780,
  },
  chipRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  regChip: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.text.secondary,
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 11,
    overflow: 'hidden',
  },
  entName: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    color: t.colors.text.secondary,
  },
  yearRow: { marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  yearLabel: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: t.colors.text.muted,
  },
  stampCard: {
    marginTop: 20,
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    padding: 18,
    gap: 8,
  },
  stampPeriod: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.brand.base,
  },
  stampPeriodMuted: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  stampDetail: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.secondary,
    maxWidth: 1000,
  },
  tabsRow: {
    marginTop: 26,
    flexDirection: 'row',
    gap: 30,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  tab: { paddingBottom: 12 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: t.colors.text.primary, marginBottom: -1 },
  tabLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  tabLabelActive: { color: t.colors.text.primary, fontWeight: t.fontWeights.bold },
  listHead: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  listCount: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: t.colors.text.secondary,
  },
  listSort: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.text.muted,
  },
  listRows: { marginTop: 12, gap: 9 },
  listLoading: { marginTop: 20, gap: 9 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.md,
    paddingVertical: 15,
    paddingHorizontal: 17,
    ...(t.shadows.card as object),
  },
  listRowText: { flex: 1, minWidth: 0 },
  listNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  listName: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  inKindChip: {
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: t.colors.text.secondary,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 7,
    paddingVertical: 2,
    paddingHorizontal: 7,
    overflow: 'hidden',
  },
  listMeta: {
    marginTop: 4,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    lineHeight: 19,
    color: t.colors.text.secondary,
  },
  listDate: {
    width: 116,
    textAlign: 'right',
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.4,
    color: t.colors.text.muted,
  },
  listAmount: {
    width: 104,
    textAlign: 'right',
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  listBottomRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  listDateMobile: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.4,
    color: t.colors.text.muted,
  },
  listAmountMobile: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  capCard: {
    marginTop: 20,
    maxWidth: 900,
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    padding: 18,
    gap: 9,
  },
  capHead: {
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.1,
    color: t.colors.text.secondary,
  },
  capNote: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.primary,
  },
  capActions: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  capButton: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 11,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  capButtonLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  source: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.base,
    textDecorationLine: 'underline',
  },
  linkNote: {
    marginTop: 16,
    maxWidth: 960,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    lineHeight: 20,
    color: t.colors.text.muted,
  },
  card: {
    marginTop: 24,
    maxWidth: 820,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    padding: 26,
    gap: 14,
    ...(t.shadows.card as object),
  },
  primaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: t.colors.text.primary,
    borderRadius: 11,
    paddingVertical: 13,
    paddingHorizontal: 19,
  },
  primaryButtonLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.surfaces.base,
  },
  notFoundWrap: { marginTop: 22, maxWidth: 760 },
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: 'hidden',
  },
});
