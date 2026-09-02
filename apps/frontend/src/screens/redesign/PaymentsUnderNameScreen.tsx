import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { UnderDevelopmentNotice } from '../../components/campaignMoney/UnderDevelopmentNotice';
import { Skeleton } from '../../components/Skeleton';
import { usePaymentsUnderName } from '../../hooks/useAppQueries';
import { useResponsive } from '../../hooks/useResponsive';
import { committeeSlug, IN_KIND_CHIP } from '../../lib/committeeMoney';
import {
  centralDateLabel,
  RECORD_DOES_NOT_COVER,
  RECORD_DOES_NOT_COVER_HEADING,
} from '../../lib/moneyLanding';
import {
  BACK_TO_RESULTS,
  CAP_HEADING,
  CAP_NEXT_LABEL,
  CAP_NOTE,
  committeesInRows,
  filesLastCopiedLine,
  INDEPENDENT_IS_A_SEPARATE_FILING,
  LIST_NOTE,
  LOAD_ERROR,
  NOTHING_FILED_WHY,
  ORDERED_NEWEST_FIRST,
  paymentNameRole,
  paymentsShowingLine,
  paymentsUnderNameEyebrow,
  paymentsUnderNameHeading,
  paymentsUnderNameStandfirst,
  paymentUnderNameRow,
  nothingFiledTitle,
  RECORDS_UNAVAILABLE_TITLE,
  RECORDS_UNAVAILABLE_WHY,
  SEARCH_ANOTHER_NAME,
} from '../../lib/paymentsUnderName';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

/**
 * Every payment filed under exactly one printed name, at
 * /money/payments?name=…&role=… ("Money lists web.dc.html" screen D; issue
 * #1780).
 *
 * Reached from a name row on /money/search, which already carries the `role` this
 * page needs, verbatim. Both halves of the state are in the address, so what a
 * reader opened is what a reader can send (grounded-answers.md rule 5).
 *
 * Four things this page does deliberately, each because the alternative would be
 * a false claim rather than because it is tidier:
 *
 * - **No total, of any kind, anywhere.** Every row carries its own amount and
 *   nothing adds them: the rows come from committees on different filing
 *   calendars, so a sum would set one period against another (rule 12). This is
 *   the single line the whole page turns on, and a test fails if a total appears.
 * - **The page is a spelling, not an organisation.** The heading quotes the
 *   string it searched for, and no sentence says this is everything a person or
 *   business received — 2 spellings of one name are never joined, so the page
 *   cannot be read as a profile.
 * - **Newest first, and it says so.** The server serves no other order on a
 *   name-keyed lookup, unlike the committee's own payments page, whose design
 *   ranks by amount inside one committee. The design drew "LARGEST FIRST" here;
 *   the built page prints the order it actually has.
 * - **A capped list never prints "of N".** No count is served on a name-keyed
 *   lookup, so the page says how many rows are on it and that more are filed
 *   (rule 11).
 */

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

export function PaymentsUnderNameScreen({
  navigation,
  route,
}: RootScreenProps<'PaymentsUnderName'>) {
  const { isMobile } = useResponsive();
  const name = route.params?.name ?? '';
  // The router refuses an address with no name or an unserved role, so a resolved
  // route always has both. Re-read here anyway rather than casting: this screen is
  // also reachable by an in-app navigate, which does not pass through the router.
  const role = paymentNameRole(route.params?.role);

  const list = usePaymentsUnderName(name, role);

  // The pathname alone, without the query string: the tab-title store is keyed by
  // pathname and only writes the title when it matches `window.location.pathname`,
  // so a key carrying the query would be remembered and never applied — which is
  // how this page shipped its first draft still showing the search's title.
  useDocumentTitle(
    role ? '/money/payments' : null,
    role ? `${paymentsUnderNameHeading(name, role)} | Alethical` : null,
  );

  const pages = list.data?.pages ?? [];
  const firstPage = pages[0];
  const rows = pages.flatMap((page) => page.payments);
  const linkable = new Set(pages.flatMap((page) => page.linkableRegistrationNumbers));
  const checkedOn = firstPage?.fetchedAt ? centralDateLabel(firstPage.fetchedAt) : null;
  const backToSearch = routePath.moneySearch({ q: name });

  if (!role) {
    // Only reachable by an in-app navigate with a role we do not serve. Nothing to
    // say about a question we did not ask, so the page sends the reader back to
    // the search rather than showing an empty list.
    return (
      <PageBackground>
        <ScrollView contentContainerStyle={styles.page}>
          <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
          <Container style={[styles.main, isMobile && styles.mainMobile]}>
            <View style={styles.card}>
              <Text accessibilityRole="header" aria-level={1} style={styles.h3}>
                {nothingFiledTitle(name)}
              </Text>
              <Text style={styles.explain}>{NOTHING_FILED_WHY}</Text>
              <SearchAnotherName href={backToSearch} navigation={navigation} name={name} />
            </View>
          </Container>
          <Footer />
        </ScrollView>
      </PageBackground>
    );
  }

  const state = firstPage?.state ?? null;

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        {/* The money section is still being built: lobbying is not loaded, and no
            sitting member's committee has been confirmed by a person yet. Deleting
            the element and its component file is the whole removal. */}
        <UnderDevelopmentNotice />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <Pressable
            {...linkProps(backToSearch, () => navigation.navigate('MoneySearch', { q: name }))}
            style={styles.backLink}
          >
            <BackChevron />
            <Text style={styles.backLabel}>{BACK_TO_RESULTS}</Text>
          </Pressable>

          <Text style={styles.eyebrow}>{paymentsUnderNameEyebrow(role)}</Text>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.h1, isMobile && styles.h1Mobile]}
          >
            {paymentsUnderNameHeading(name, role)}
          </Text>
          <Text style={styles.standfirst}>{paymentsUnderNameStandfirst(role)}</Text>
          {role === 'independent_vendor' ? (
            <Text style={styles.standfirst}>{INDEPENDENT_IS_A_SEPARATE_FILING}</Text>
          ) : null}
          {/* The one freshness date this page shows. Not the period any money
              covers — every row carries its own date (rule 12). */}
          <Text style={styles.stamp}>{filesLastCopiedLine(checkedOn).toUpperCase()}</Text>

          {list.isPending ? (
            <View style={styles.listLoading}>
              <View role="status" aria-busy style={styles.hidden}>
                <Text>Loading these payments</Text>
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
              <Text accessibilityRole="alert" style={styles.explain}>
                {LOAD_ERROR}
              </Text>
            </View>
          ) : state === 'unavailable' ? (
            /* Our copy of the download did not answer. Never "nothing is filed":
               that is a claim about the records we did not establish. */
            <View style={styles.card}>
              <Text style={styles.h3}>{RECORDS_UNAVAILABLE_TITLE}</Text>
              <Text style={styles.explain}>{RECORDS_UNAVAILABLE_WHY}</Text>
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.h3}>{nothingFiledTitle(name)}</Text>
              <Text style={styles.explain}>{NOTHING_FILED_WHY}</Text>
              <SearchAnotherName href={backToSearch} navigation={navigation} name={name} />
            </View>
          ) : (
            <PaymentRows
              isMobile={isMobile}
              rows={rows}
              role={role}
              linkable={linkable}
              hasNextPage={Boolean(list.hasNextPage)}
              isFetchingNextPage={list.isFetchingNextPage}
              onMore={() => void list.fetchNextPage()}
              navigation={navigation}
            />
          )}

          <View style={styles.notCoveredBox}>
            <Text style={styles.notCoveredLabel}>
              {RECORD_DOES_NOT_COVER_HEADING.toUpperCase()}
            </Text>
            <View style={styles.notCoveredList}>
              {RECORD_DOES_NOT_COVER.map((line) => (
                <Text key={line} style={styles.notCoveredLine}>
                  {line}
                </Text>
              ))}
            </View>
          </View>
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
  );
}

function SearchAnotherName({
  href,
  navigation,
  name,
}: {
  href: string;
  navigation: RootScreenProps<'PaymentsUnderName'>['navigation'];
  name: string;
}) {
  return (
    <Pressable
      {...linkProps(href, () => navigation.navigate('MoneySearch', { q: name }))}
      style={styles.primaryButton}
    >
      <Text style={styles.primaryButtonLabel}>{SEARCH_ANOTHER_NAME}</Text>
    </Pressable>
  );
}

function PaymentRows({
  isMobile,
  rows,
  role,
  linkable,
  hasNextPage,
  isFetchingNextPage,
  onMore,
  navigation,
}: {
  isMobile: boolean;
  rows: Parameters<typeof committeesInRows>[0];
  role: Parameters<typeof paymentUnderNameRow>[1];
  linkable: ReadonlySet<string>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onMore: () => void;
  navigation: RootScreenProps<'PaymentsUnderName'>['navigation'];
}) {
  // Shaped in lib/paymentsUnderName.ts rather than here, so the line this screen
  // draws is decided in the one place a test can pin it.
  const shaped = rows.map((payment, index) => {
    const row = paymentUnderNameRow(payment, role, linkable);
    return { ...row, key: `${index}-${row.name}-${row.date ?? ''}` };
  });

  return (
    <View>
      <View style={styles.listHead}>
        <Text style={styles.listCount}>
          {paymentsShowingLine(shaped.length, committeesInRows(rows), hasNextPage)}
        </Text>
        <Text style={styles.listSort}>{ORDERED_NEWEST_FIRST}</Text>
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

      {hasNextPage ? (
        <View style={styles.capCard}>
          <Text style={styles.capHead}>{CAP_HEADING}</Text>
          <Text style={styles.capNote}>{CAP_NOTE}</Text>
          <View style={styles.capActions}>
            <Pressable
              onPress={onMore}
              accessibilityRole="button"
              aria-disabled={isFetchingNextPage}
              style={styles.capButton}
            >
              <Text style={styles.capButtonLabel}>
                {isFetchingNextPage ? 'Loading…' : CAP_NEXT_LABEL}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Text style={styles.linkNote}>{LIST_NOTE}</Text>
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
    marginTop: 22,
    fontFamily: t.typography.body,
    fontSize: 13,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.4,
    color: t.colors.brand.base,
  },
  h1: {
    marginTop: 12,
    maxWidth: 1100,
    fontFamily: t.typography.title,
    fontSize: 38,
    lineHeight: 44,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1,
    color: t.colors.text.primary,
  },
  h1Mobile: { fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  standfirst: {
    marginTop: 14,
    maxWidth: 820,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 26,
    color: t.colors.text.secondary,
  },
  stamp: {
    marginTop: 16,
    fontFamily: t.typography.mono,
    fontSize: 11.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.text.muted,
  },
  listHead: {
    marginTop: 26,
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
  listLoading: { marginTop: 26, gap: 9 },
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: 'hidden',
  },
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
  // The body face on every amount, matching the big totals (ruled 1 Sep 2026, #1924).
  // `listDate` directly above keeps mono, which is the whole point: 2 faces separate a
  // date from a dollar figure, not one dollar figure from another.
  listAmount: {
    width: 104,
    textAlign: 'right',
    fontFamily: t.typography.body,
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
    fontFamily: t.typography.body,
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
  capActions: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 14 },
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
  linkNote: {
    marginTop: 16,
    maxWidth: 960,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    lineHeight: 20,
    color: t.colors.text.muted,
  },
  card: {
    marginTop: 26,
    maxWidth: 820,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: t.radii.lg,
    padding: 26,
    gap: 12,
    ...(t.shadows.card as object),
  },
  h3: {
    fontFamily: t.typography.title,
    fontSize: 21,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
  },
  explain: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: t.colors.text.secondary,
  },
  primaryButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
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
  notCoveredBox: {
    marginTop: 34,
    maxWidth: 960,
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 15,
    padding: 22,
  },
  notCoveredLabel: {
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: t.colors.text.secondary,
  },
  notCoveredList: { marginTop: 12, gap: 8 },
  notCoveredLine: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 25,
    color: t.colors.ink,
  },
});
