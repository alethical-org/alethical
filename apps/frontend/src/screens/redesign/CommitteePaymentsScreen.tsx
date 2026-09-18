import { useRef, useState, type ComponentProps } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { YearControl } from '../../components/campaignMoney/YearControl';
import { ResultsHeading } from '../../components/campaignMoney/ResultsHeading';
import { Skeleton } from '../../components/Skeleton';
import type { CommitteeMadePayment, CommitteeReceivedPayment } from '../../data/types';
import { useCommitteeMoney, useCommitteePaymentsList } from '../../hooks/useAppQueries';
import { useResponsive } from '../../hooks/useResponsive';
import { committeeMoneyPageMetadata } from '../../lib/share';
import {
  CAP_NOTE,
  capNextLabel,
  emptyListTitle,
  emptyListWhy,
  LIST_LINK_NOTE,
  donorThresholdNote,
  madePaymentRow,
  PAYMENTS_TAB_LABELS,
  PAYMENTS_LOAD_ERROR,
  paymentsUnavailable,
  paymentsDirection,
  paymentsEyebrow,
  paymentsTitle,
  receivedPaymentRow,
  showingLine,
  reportPeriodLine,
  reportPeriodDetail,
  REPORT_LOAD_ERROR,
  REPORT_ROWS_REMAIN,
  PAYMENTS_MORE_ERROR,
  PAYMENTS_REFRESH_ERROR,
} from '../../lib/committeePaymentsPage';
import {
  committeeSlug,
  isBallotQuestionFiler,
  IN_KIND_CHIP,
  notFoundBody,
  notFoundTitle,
  paymentsTabFromParam,
  registerKindFromEntityType,
  registrationNumberFromSlug,
  uncoveredPeriodDetail,
  uncoveredPeriodLine,
  type PaymentsTab,
} from '../../lib/committeeMoneyShared';
import {
  committeeMoneyYears,
  committeeAlternativeYear,
  stampThroughDate,
} from '../../lib/committeeMoneyShared';
import { paymentFilesDownloadedLine } from '../../lib/campaignMoneyDetailsPageCopy';
import {
  BOARD_RECORD_LINK_LABEL,
  BOARD_VIEWER_INDEX,
  BOARD_RECORD_SENTENCE_TAIL,
  boardRecordUrl,
} from '../../lib/boardRecordLink';
import { campaignMoneyYear } from '../../lib/legislatorCampaignMoney';
import { centralDateLabel } from '../../lib/moneyLanding';
import { committeePaymentsShareContent } from '../../lib/moneyResultsShare';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';
import { contentTabStyle } from '../../theme/contentTabs';

/** The report dates describe the report. The payment list is selected by filing
 * year independently, and either source can remain readable while the other fails. */
export function CommitteePaymentsScreen({
  navigation,
  route,
}: RootScreenProps<'CommitteePayments'>) {
  const { isMobile, isTablet } = useResponsive();
  const desktop = !isMobile && !isTablet;
  const slug = route.params?.slug ?? '';
  const registrationNumber = registrationNumberFromSlug(slug);
  const year = campaignMoneyYear(route.params?.year);
  const tab = paymentsTabFromParam(route.params?.tab);
  const moneyQuery = useCommitteeMoney(registrationNumber, year);
  const money = moneyQuery.data ?? null;
  const list = useCommitteePaymentsList(registrationNumber, paymentsDirection(tab), year);
  const pending = useRef({ report: false, list: false });
  const [busy, setBusy] = useState({ report: false, list: false });
  const retryReport = async () => {
    if (pending.current.report || moneyQuery.isFetching) return;
    pending.current.report = true;
    setBusy((old) => ({ ...old, report: true }));
    try {
      await moneyQuery.refetch({ cancelRefetch: false });
    } finally {
      pending.current.report = false;
      setBusy((old) => ({ ...old, report: false }));
    }
  };
  const readList = async (more = false) => {
    if (pending.current.list || list.isFetching) return;
    pending.current.list = true;
    setBusy((old) => ({ ...old, list: true }));
    try {
      await (more
        ? list.fetchNextPage({ cancelRefetch: false })
        : list.refetch({ cancelRefetch: false }));
    } finally {
      pending.current.list = false;
      setBusy((old) => ({ ...old, list: false }));
    }
  };
  const name = money
    ? (money.register.name ?? money.committeeName ?? `Committee ${registrationNumber}`)
    : null;
  useDocumentTitle(
    registrationNumber ? `/money/committees/${slug}/payments` : null,
    name ? committeeMoneyPageMetadata(slug, 'payments', { name, canonicalSlug: slug }).title : null,
  );
  const pages = (list.data?.pages ?? []).filter(
    (page): page is NonNullable<typeof page> => page !== null,
  );
  const firstPage = pages[0];
  const rows = pages.flatMap((page) => page.payments);
  const linkable = new Set(pages.flatMap((page) => page.linkableRegistrationNumbers));
  // A register miss alone cannot erase valid records held under that number.
  const notFound =
    moneyQuery.data === null &&
    !moneyQuery.isPending &&
    !moneyQuery.isError &&
    list.data?.pages[0] === null &&
    !list.isPending &&
    !list.isError;
  const registerKind = money
    ? money.register.state === 'reported'
      ? money.register.kind
      : registerKindFromEntityType(money.entityType)
    : null;
  const isBallot = money?.entitySubType
    ? isBallotQuestionFiler(money.entitySubType)
    : registerKind === 'candidate_committee' || registerKind === 'party_unit'
      ? false
      : null;
  const boardUrl = boardRecordUrl(registerKind, registrationNumber ?? '', year);
  const reportEnd = money ? stampThroughDate(money.split, money.moneyOut) : null;
  const period = reportPeriodLine(reportEnd, money?.moneyIn.reportedPeriodStart);
  const copiedAt = firstPage?.fetchedAt ?? money?.fetchedAt;
  const checkedOn = copiedAt ? centralDateLabel(copiedAt) : null;
  const reportCopied = money?.filingsCopiedAt ? centralDateLabel(money.filingsCopiedAt) : null;
  const total = firstPage?.totalPayments ?? null;
  const selectYear = (next: number) => navigation.setParams({ year: String(next) });
  const onReport = () => void retryReport();
  const onList = () => void readList();
  const reportBusy = Boolean(busy.report || moneyQuery.isFetching);
  const listBusy = Boolean(busy.list || list.isFetching);
  const reportPanel = (
    <View
      style={[styles.reportAside, desktop && styles.reportAsideDesktop]}
      role="complementary"
      aria-label="Report information"
    >
      <View style={styles.stampCard}>
        {moneyQuery.isPending ? (
          <>
            <Text role="status" style={styles.stampDetail}>
              Loading report information
            </Text>
            <Skeleton width="70%" height={14} />
            <Skeleton width="95%" height={11} />
          </>
        ) : moneyQuery.isError && !money ? (
          <>
            <Text accessibilityRole="alert" style={styles.stampDetail}>
              {REPORT_LOAD_ERROR}
              {rows.length > 0 ? `. ${REPORT_ROWS_REMAIN}` : ''}
            </Text>
            <RetryButton onPress={onReport} busy={reportBusy} />
          </>
        ) : (
          <>
            {moneyQuery.isError ? (
              <>
                <Text accessibilityRole="alert" style={styles.stampDetail}>
                  We couldn’t refresh the report information. The last report information loaded for
                  this committee and filing year is still shown.
                </Text>
                <RetryButton onPress={onReport} busy={reportBusy} />
              </>
            ) : null}
            {period ? (
              <>
                <Text style={styles.stampPeriod}>{period}</Text>
                <Text style={styles.stampDetail}>
                  {reportPeriodDetail(money?.moneyIn.reportedPeriodStart)}
                </Text>
                {registerKind === 'party_unit' ? (
                  <Text style={styles.stampDetail}>
                    Party units file on their own calendar, so these dates are the party-unit
                    series’, not a candidate committee’s.
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.stampPeriodMuted}>{uncoveredPeriodLine(year)}</Text>
                <Text style={styles.stampDetail}>{uncoveredPeriodDetail(year, null)}</Text>
              </>
            )}
          </>
        )}
      </View>
      <View style={styles.reportSources}>
        <BoardLink url={boardUrl} />
        {boardUrl !== BOARD_VIEWER_INDEX ? (
          <Text style={styles.stampDetail}>{BOARD_RECORD_SENTENCE_TAIL.trim()}</Text>
        ) : null}
        {checkedOn ? (
          <Text style={styles.stampDetail}>
            {reportCopied
              ? paymentFilesDownloadedLine(checkedOn, reportCopied)
              : `Minnesota’s payment files copied ${checkedOn}. This is a copy date, not a reporting period.`}
          </Text>
        ) : null}
      </View>
    </View>
  );
  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <FocusPressable
            {...linkProps(routePath.moneyCommittee(slug, { tab, year: String(year) }), () =>
              navigation.navigate('CommitteeMoney', { slug, tab, year: String(year) }),
            )}
            style={styles.backLink}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
              <Path
                d="M15 5 L8 12 L15 19"
                stroke={t.colors.text.secondary}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={styles.backLabel}>{name ?? 'Committee'}</Text>
          </FocusPressable>
          {notFound && registrationNumber ? (
            <View style={styles.notFoundWrap}>
              <Text style={styles.eyebrow}>COMMITTEES</Text>
              <Text accessibilityRole="header" aria-level={1} style={styles.h1}>
                {notFoundTitle()}
              </Text>
              <Text style={styles.body}>{notFoundBody(registrationNumber)}</Text>
              <FocusPressable
                {...linkProps(routePath.moneyCommittees(), () =>
                  navigation.navigate('CommitteeList'),
                )}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonLabel}>Browse all committees</Text>
              </FocusPressable>
            </View>
          ) : (
            <>
              <Text style={[styles.eyebrow, styles.eyebrowSpaced]}>
                {paymentsEyebrow(tab).toUpperCase()}
              </Text>
              <ResultsHeading
                isMobile={isMobile}
                content={
                  registrationNumber &&
                  firstPage &&
                  firstPage.state !== 'unavailable' &&
                  !list.isPlaceholderData &&
                  !moneyQuery.isPlaceholderData
                    ? committeePaymentsShareContent({ name, registrationNumber, year, tab })
                    : null
                }
              >
                <Text
                  accessibilityRole="header"
                  aria-level={1}
                  style={[styles.h1, isTablet && styles.h1Tablet, isMobile && styles.h1Mobile]}
                >
                  {paymentsTitle(tab)}
                </Text>
              </ResultsHeading>
              <View style={styles.chipRow}>
                {registrationNumber ? (
                  <Text style={styles.regChip}>REG {registrationNumber}</Text>
                ) : null}
                {name ? <Text style={styles.entName}>{name}</Text> : null}
              </View>
              <View style={styles.controls}>
                <View style={styles.tabsRow} role="group" aria-label="Payment direction">
                  {(Object.keys(PAYMENTS_TAB_LABELS) as PaymentsTab[]).map((key) => (
                    <Pressable
                      key={key}
                      onPress={() => navigation.setParams({ tab: key })}
                      accessibilityRole="button"
                      aria-pressed={key === tab}
                      style={contentTabStyle(styles.tab, key === tab, styles.tabActive)}
                    >
                      <Text style={[styles.tabLabel, key === tab && styles.tabLabelActive]}>
                        {PAYMENTS_TAB_LABELS[key]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <YearControl
                  year={year}
                  onSelect={selectYear}
                  surface="committee"
                  years={committeeMoneyYears(year)}
                />
              </View>
              <View style={[styles.content, desktop && styles.contentDesktop]}>
                {reportPanel}
                <View style={styles.paymentsColumn}>
                  <Text role="status" accessibilityLiveRegion="polite" style={styles.hidden}>
                    {list.isPending
                      ? 'Loading payments'
                      : rows.length > 0
                        ? showingLine(rows.length, total, year, Boolean(list.hasNextPage))
                        : ''}
                  </Text>
                  {list.isError && rows.length > 0 && !list.isFetchNextPageError ? (
                    <View style={styles.refreshNotice}>
                      <Text accessibilityRole="alert" style={styles.explain}>
                        {PAYMENTS_REFRESH_ERROR}
                      </Text>
                      <RetryButton onPress={onList} busy={listBusy} />
                    </View>
                  ) : null}
                  {list.isPending ? (
                    <View style={styles.listLoading}>
                      <Text style={styles.explain}>Loading payments</Text>
                      {[0, 1, 2, 3, 4].map((index) => (
                        <View key={index} style={styles.loadingRow}>
                          <Skeleton width="64%" height={14} />
                          <Skeleton width="40%" height={11} />
                        </View>
                      ))}
                    </View>
                  ) : (list.isError && rows.length === 0) ||
                    (rows.length === 0 && paymentsUnavailable(firstPage?.state)) ? (
                    <View style={styles.card}>
                      <Text accessibilityRole="alert" style={styles.body}>
                        {PAYMENTS_LOAD_ERROR}
                      </Text>
                      <RetryButton onPress={onList} busy={listBusy} />
                    </View>
                  ) : rows.length === 0 ? (
                    <View style={styles.card}>
                      <Text accessibilityRole="header" aria-level={2} style={styles.h3}>
                        {emptyListTitle(tab, year)}
                      </Text>
                      <Text style={styles.explain}>{emptyListWhy(year)}</Text>
                      <FocusPressable
                        onPress={() => selectYear(committeeAlternativeYear(year))}
                        accessibilityRole="button"
                        style={styles.primaryButton}
                      >
                        <Text style={styles.primaryButtonLabel}>
                          See {committeeAlternativeYear(year)}
                        </Text>
                      </FocusPressable>
                    </View>
                  ) : (
                    <PaymentRows
                      isMobile={isMobile}
                      tab={tab}
                      year={year}
                      rows={rows}
                      total={total}
                      linkable={linkable}
                      isBallot={isBallot}
                      boardUrl={boardUrl}
                      hasNextPage={Boolean(list.hasNextPage)}
                      isFetchingNextPage={listBusy}
                      loadMoreError={list.isFetchNextPageError}
                      onMore={() => void readList(true)}
                      navigation={navigation}
                    />
                  )}
                </View>
              </View>
            </>
          )}
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
  );
}

function FocusPressable({
  style,
  ...props
}: Omit<ComponentProps<typeof Pressable>, 'style'> & { style?: StyleProp<ViewStyle> }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...props}
      onFocus={(event) => {
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        props.onBlur?.(event);
      }}
      style={[style, focused && styles.focused]}
    />
  );
}
function RetryButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  return (
    <FocusPressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={busy}
      aria-busy={busy}
      style={styles.primaryButton}
    >
      <Text style={styles.primaryButtonLabel}>{busy ? 'Loading…' : 'Try again'}</Text>
    </FocusPressable>
  );
}
function BoardLink({ url }: { url: string }) {
  return (
    <FocusPressable
      {...externalLinkProps(url, () => void Linking.openURL(url))}
      style={styles.sourceLink}
    >
      <Text style={styles.source}>
        {url === BOARD_VIEWER_INDEX
          ? 'Find this committee in the Board’s records'
          : BOARD_RECORD_LINK_LABEL}
      </Text>
    </FocusPressable>
  );
}
function PaymentRows({
  tab,
  year,
  rows,
  total,
  linkable,
  isBallot,
  boardUrl,
  hasNextPage,
  isFetchingNextPage,
  loadMoreError,
  onMore,
  navigation,
  isMobile,
}: {
  isMobile: boolean;
  tab: PaymentsTab;
  year: number;
  rows: (CommitteeReceivedPayment | CommitteeMadePayment)[];
  total: number | null;
  linkable: Set<string>;
  isBallot: boolean | null;
  boardUrl: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMoreError: boolean;
  onMore: () => void;
  navigation: RootScreenProps<'CommitteePayments'>['navigation'];
}) {
  const shaped = rows.map((payment) =>
    tab === 'gave'
      ? receivedPaymentRow(payment as CommitteeReceivedPayment, linkable)
      : madePaymentRow(payment as CommitteeMadePayment, linkable),
  );
  return (
    <View>
      <View style={styles.listHead}>
        <Text style={styles.listCount}>{showingLine(rows.length, total, year, hasNextPage)}</Text>
        <Text style={styles.listSort}>LARGEST FIRST</Text>
      </View>
      <View style={styles.rowsCard} role="list">
        {shaped.map((row, index) => {
          let link: { href: string; onPress: () => void } | null = null;
          if (row.linkNumber) {
            const targetSlug = committeeSlug(row.linkName, row.linkNumber);
            link = {
              href: routePath.moneyCommittee(targetSlug),
              onPress: () => navigation.push('CommitteeMoney', { slug: targetSlug }),
            };
          } else if (row.nameLink) {
            const { name, role } = row.nameLink;
            link = {
              href: routePath.moneyPaymentsUnderName(name, role),
              onPress: () => navigation.push('PaymentsUnderName', { name, role }),
            };
          }
          return (
            <View
              key={index}
              role="listitem"
              style={[styles.paymentRow, index > 0 && styles.paymentDivider]}
            >
              <View style={styles.listRowText}>
                {link ? (
                  <FocusPressable {...linkProps(link.href, link.onPress)} style={styles.nameLink}>
                    <Text
                      style={[
                        styles.listName,
                        styles.linkedName,
                        isMobile && styles.listNameMobile,
                      ]}
                    >
                      {row.name}
                    </Text>
                  </FocusPressable>
                ) : (
                  <Text style={[styles.listName, isMobile && styles.listNameMobile]}>
                    {row.name}
                  </Text>
                )}
                {row.meta ? <Text style={styles.listMeta}>{row.meta}</Text> : null}
                {row.inKind ? (
                  <Text style={styles.inKindChip}>{IN_KIND_CHIP.toUpperCase()}</Text>
                ) : null}
                <Text style={styles.listDate}>{row.date ?? 'Date not given in the filing'}</Text>
              </View>
              <Text style={[styles.listAmount, isMobile && styles.listNameMobile]}>
                {row.amount ?? 'Amount not given'}
              </Text>
            </View>
          );
        })}
      </View>
      {hasNextPage ? (
        <View style={styles.capCard}>
          <Text style={styles.capHead}>THIS PAGE IS CAPPED</Text>
          <Text style={styles.capNote}>{CAP_NOTE}</Text>
          {loadMoreError ? (
            <Text accessibilityRole="alert" style={styles.capNote}>
              {PAYMENTS_MORE_ERROR}
            </Text>
          ) : null}
          <View style={styles.capActions}>
            <FocusPressable
              onPress={onMore}
              accessibilityRole="button"
              disabled={isFetchingNextPage}
              aria-busy={isFetchingNextPage}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonLabel}>
                {isFetchingNextPage
                  ? 'Loading…'
                  : loadMoreError
                    ? 'Try again'
                    : capNextLabel(rows.length, total)}
              </Text>
            </FocusPressable>
            <BoardLink url={boardUrl} />
          </View>
        </View>
      ) : null}
      <Text style={styles.linkNote}>{LIST_LINK_NOTE}</Text>
      {tab === 'gave' && isBallot !== null ? (
        <Text style={styles.linkNote}>{donorThresholdNote(isBallot)}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  main: { paddingTop: 28, paddingBottom: 64 },
  mainMobile: { paddingTop: 18 },
  backLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  focused: { outlineWidth: 2, outlineColor: '#7c5cff', outlineStyle: 'solid', outlineOffset: 2 },
  h1Tablet: { fontSize: 34, lineHeight: 41 },
  content: { marginTop: 24, gap: 24 },
  contentDesktop: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 32 },
  reportAside: { minWidth: 0 },
  reportAsideDesktop: { width: 340, flexShrink: 1 },
  reportSources: { gap: 8, marginTop: 12, paddingHorizontal: 17 },
  paymentsColumn: { flex: 1, minWidth: 0 },
  controls: {
    marginTop: 22,
    gap: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  refreshNotice: {
    padding: 18,
    borderRadius: 12,
    backgroundColor: '#fff7ea',
    gap: 12,
    marginBottom: 18,
  },
  loadingRow: {
    padding: 18,
    gap: 8,
    marginTop: 10,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  rowsCard: {
    marginTop: 14,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
    backgroundColor: '#fff',
    boxShadow: '0 6px 18px rgba(17,21,15,0.05)',
  },
  paymentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 14 },
  paymentDivider: { borderTopWidth: 1, borderTopColor: t.colors.alpha.ink08 },
  nameLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
  linkedName: { color: t.colors.text.greenOnLight },
  listNameMobile: { fontSize: 16 },
  sourceLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
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
    color: t.colors.text.greenOnLight,
  },
  eyebrowSpaced: { marginTop: 22 },
  h1: {
    marginTop: 12,
    fontFamily: t.typography.title,
    fontSize: 42,
    lineHeight: 49,
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
    fontVariant: ['tabular-nums'],
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 26,
    color: t.colors.text.primary,
    maxWidth: 760,
  },
  explain: {
    fontVariant: ['tabular-nums'],
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.secondary,
    maxWidth: 780,
  },
  chipRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  regChip: {
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
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
  stampCard: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    padding: 18,
    gap: 8,
  },
  stampPeriod: {
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 17,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.text.primary,
  },
  stampPeriodMuted: {
    fontVariant: ['tabular-nums'],
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  stampDetail: {
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.secondary,
    maxWidth: 1000,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 18,
    flexWrap: 'wrap',
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  // 44px on the tab's own box at every width (phone band rule F1).
  tab: {
    minHeight: 44,
    justifyContent: 'flex-end',
    paddingBottom: 12,
  },
  tabActive: { marginBottom: -1 },
  tabLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  tabLabelActive: { color: t.colors.text.primary, fontWeight: t.fontWeights.bold },
  listHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  listCount: {
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
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
  listLoading: { marginTop: 8 },
  listRowText: { flex: 1, minWidth: 0 },
  listName: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
    flexShrink: 1,
    ...({ overflowWrap: 'anywhere' } as object),
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
    marginTop: 5,
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.text.muted,
  },
  listAmount: {
    maxWidth: '40%',
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 17,
    fontWeight: '800',
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
    fontVariant: ['tabular-nums'],
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
  source: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.greenOnLight,
    textDecorationLine: 'underline',
  },
  linkNote: {
    fontVariant: ['tabular-nums'],
    marginTop: 16,
    paddingHorizontal: 17,
    maxWidth: 960,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 25,
    color: t.colors.text.muted,
  },
  card: {
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
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: t.colors.text.primary,
    borderRadius: 11,
    paddingVertical: 13,
    paddingHorizontal: 19,
  },
  primaryButtonLabel: {
    fontVariant: ['tabular-nums'],
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
