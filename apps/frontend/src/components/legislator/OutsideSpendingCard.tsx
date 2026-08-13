import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';
import { useResponsive } from '../../hooks/useResponsive';
import { externalLinkProps } from '../../navigation/links';
import { LinkArrow } from '../LinkArrow';
import { useHover } from '../billDetail/interactions';
import {
  formatSpendingAmount,
  isMeasuredZero,
  outsideSpendingFetchedOn,
  outsideSpendingFigures,
  outsideSpendingPaymentCount,
  outsideSpendingPeriod,
  outsideSpendingSharedReason,
  outsideSpendingSourceUrl,
  outsideSpendingUnavailableReason,
  type OutsideSpendingYear,
} from '../../lib/outsideSpending';

// Outside spending on a legislator's profile (#1332). One card, used by both the web
// and the mobile profile layout, so the two cannot end up wording the same money
// differently.
//
// Every sentence in here is fixed copy owned by this layout, never generated text
// (`.claude/rules/grounded-answers.md` rule 3: the query describes records, the
// layout owns the framing). The 2 rules that decide the wording:
//
// * **The point of the block is that this money is not in the candidate's own
//   report.** A reader who reads only that report is missing part of the picture and
//   has no way to know it, so the card says so above the figures rather than in a
//   footnote below them, where the reader most at risk would never reach it.
// * **Nothing may suggest the legislator sought, welcomed or coordinated it.**
//   Coordination is illegal and asserting it without a source is the most damaging
//   claim available on this page. So: "spent supporting them", never "raised",
//   "received", "backers" or "support for". The 2 sides are never subtracted from
//   each other, never ordered by size, and never drawn as opposing halves of one bar,
//   because a shape can imply a contest the filings do not describe.

const HEADING = 'Spending by Outside Groups';

export function OutsideSpendingCard({
  years,
  isLoading,
  isError,
  onOpenSource,
}: {
  years: OutsideSpendingYear[];
  isLoading: boolean;
  isError: boolean;
  onOpenSource: (url: string) => void;
}) {
  const { isMobile } = useResponsive();
  const sourceUrl = outsideSpendingSourceUrl(years);
  const fetchedOn = outsideSpendingFetchedOn(years);
  // Today every legislator hits this: no committee link is confirmed, so both years
  // give the same answer and 2 year headings would imply the years were the question.
  const sharedReason = outsideSpendingSharedReason(years);
  return (
    <View style={[styles.card, isMobile && styles.cardMobile]}>
      <Text
        accessibilityRole="header"
        aria-level={2}
        style={[styles.heading, isMobile && styles.headingMobile]}
      >
        {HEADING}
      </Text>
      <Text style={styles.explainer}>
        Money that other groups spent to support or oppose this legislator. It does not go
        to their campaign and appears nowhere in the reports their campaign files, so
        reading only those reports leaves this money out.
      </Text>
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={t.colors.brand.base} />
        </View>
      ) : isError || years.length === 0 ? (
        // A failed request is our problem, and saying nothing at all would leave the
        // reader thinking the figures were 0.
        <Text style={styles.note}>
          We could not load this right now. This is a problem at our end and says nothing
          about what was spent.
        </Text>
      ) : sharedReason ? (
        <Text style={[styles.note, styles.sharedReason]}>{sharedReason}</Text>
      ) : (
        <View style={styles.yearStack}>
          {years.map((year) => (
            <YearBlock key={year.year} year={year} />
          ))}
        </View>
      )}
      {sourceUrl ? (
        <View style={styles.sourceRow}>
          <SourceLink
            label="Minnesota Campaign Finance Board filings"
            href={sourceUrl}
            onPress={() => onOpenSource(sourceUrl)}
          />
          {fetchedOn ? <Text style={styles.fetched}>Copied from the state on {fetchedOn}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function YearBlock({ year }: { year: OutsideSpendingYear }) {
  const figures = outsideSpendingFigures(year);
  const unavailable = outsideSpendingUnavailableReason(year);
  const period = outsideSpendingPeriod(year);
  const payments = outsideSpendingPaymentCount(year);
  return (
    <View style={styles.yearBlock}>
      <Text accessibilityRole="header" aria-level={3} style={styles.yearLabel}>
        {year.year}
      </Text>
      {unavailable ? (
        <Text style={styles.note}>{unavailable}</Text>
      ) : isMeasuredZero(year) ? (
        // The one place a 0 is honest here: the link is confirmed, the download covers
        // the year, and no group filed a payment. That is a checked finding, so it is
        // stated as one instead of being drawn as an empty figure.
        <Text style={styles.note}>
          No outside group reported spending anything to support or oppose this legislator
          in {year.year}.
        </Text>
      ) : (
        <>
          <View style={styles.figureRow}>
            {figures.map((figure) => (
              <View key={figure.key} style={styles.figure}>
                <Text style={styles.figureLabel}>{figure.label}</Text>
                <Text style={styles.figureAmount}>{formatSpendingAmount(figure.amount)}</Text>
                <Text style={styles.figureMeta}>
                  {figure.payments === 1 ? '1 payment' : `${figure.payments} payments`}
                </Text>
              </View>
            ))}
          </View>
          {period ? (
            <Text style={styles.figureMeta}>
              {payments === 1 ? 'Payment made' : 'Payments made'} {period}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

function SourceLink({
  label,
  href,
  onPress,
}: {
  label: string;
  href: string;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  // A drawn arrow, not the text character: Libre Franklin omits it, so each operating
  // system picks a different fallback and the mark lands at a different size on phones.
  const color = hovered ? t.colors.brand.forest : t.colors.brand.deep;
  return (
    <Pressable style={styles.sourceLinkRow} {...externalLinkProps(href, onPress)} {...hover}>
      <Text style={[styles.sourceLink, hovered && styles.sourceLinkHover]}>{label}</Text>
      <LinkArrow color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    paddingVertical: 32,
    paddingHorizontal: 34,
    ...(t.shadows.card as object),
  },
  cardMobile: { borderRadius: 18, paddingVertical: 22, paddingHorizontal: 22 },
  // Web's own section heading is 30; the phone layout's is the h3 token, so the one
  // card matches whichever screen it is sitting in rather than importing web's scale
  // onto a 375px column.
  heading: {
    fontFamily: t.typography.title,
    fontSize: 30,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.6,
    color: t.colors.text.primary,
  },
  headingMobile: { fontSize: t.fontSizes.h3, letterSpacing: -0.22 },
  explainer: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26,
    color: t.colors.text.secondary,
  },
  loading: { paddingVertical: 28, alignItems: 'center' },
  yearStack: { marginTop: 22, gap: 24 },
  yearBlock: { gap: 12 },
  yearLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.4,
    color: t.colors.brand.deep,
  },
  // Wraps rather than dividing the row into fixed columns, so a third figure can
  // appear on the day one is published without squeezing the two that are always there.
  figureRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 28 },
  figure: { gap: 4, minWidth: 150 },
  figureLabel: {
    fontFamily: t.typography.body,
    fontSize: 15,
    color: t.colors.text.muted,
  },
  figureAmount: {
    fontFamily: t.typography.title,
    fontSize: 28,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.5,
    color: t.colors.text.primary,
  },
  figureMeta: {
    fontFamily: t.typography.body,
    fontSize: 15,
    color: t.colors.text.muted,
  },
  note: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 24,
    color: t.colors.text.muted,
  },
  sharedReason: { marginTop: 18 },
  sourceRow: { marginTop: 24, gap: 6 },
  sourceLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sourceLink: {
    fontFamily: t.typography.body,
    fontSize: 16,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  sourceLinkHover: { color: t.colors.brand.forest },
  fetched: {
    fontFamily: t.typography.body,
    fontSize: 14,
    color: t.colors.text.muted,
  },
});
