import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import type { CommitteeReceivedPayment } from '../../data/types';
import { useResponsive } from '../../hooks/useResponsive';
import { prepareContributionChart } from '../../lib/campaignMoneyDetails';
import { inKindDonationsNote } from '../../lib/committeeMoneyShared';
import {
  formatMoney,
  isAmountAboveZero,
  splitExplanation,
  type SplitState,
} from '../../lib/legislatorCampaignMoney';
import { Dek } from './ContributionLabelsNote';
import { unnamedFigureDraws } from '../../lib/contributionFigures';
import { numericText, useCampaignMoneyTypography, useDetailsStyles } from './detailsStyles';
import { moneyDetailsCopy as copy, namedMoneyDefinition } from '../../lib/campaignMoneyDetailsCopy';

type Split = {
  state: SplitState;
  reportedTotal: string | null;
  namedTotal?: string | null;
  namedCashTotal: string | null;
  namedInKindTotal: string | null;
  unnamedTotal: string | null;
};

/**
 * The donut, its dek and its legend.
 *
 * The dek is the one place the 2 contribution labels are explained (#2182), so it draws
 * on its own terms rather than as a caption on the picture: its defining sentences follow
 * the Money in card's non-itemized figure, which means they are still there when the donut
 * is loading, failed or undrawable and the 2 labelled figures are on screen anyway. That is
 * `.claude/rules/grounded-answers.md` rule 12, which requires a page carrying 2 money
 * figures to say what the difference between them is.
 *
 * The legend is a list, not a set of controls. Reaching a kind's names is the tab strip's
 * job directly below, so no row is focusable, none takes a tab stop, and the donut carries
 * its own text alternative because the rows no longer carry one each.
 */
export function DonorBreakdown({
  payments,
  split,
  year,
  complete,
  failed,
  isBallot = false,
  headingLevel = 3,
}: {
  headingLevel?: 2 | 3;
  payments: CommitteeReceivedPayment[];
  split: Split;
  year: number;
  complete: boolean;
  failed: boolean;
  isBallot?: boolean;
}) {
  const { isMobile, isTablet } = useResponsive();
  const s = useDetailsStyles();
  const type = useCampaignMoneyTypography();
  const namesOnly = split.state === 'no_reported_total';
  const chart = complete ? prepareContributionChart(payments, split) : null;
  const diameter = isMobile ? 180 : isTablet ? 200 : 230;
  const circumference = Math.PI * 140;
  let offset = 0;
  const explanation = splitExplanation(split.state);
  // The card's own non-itemized figure, read through the shared rule so the dek's
  // defining sentences and that figure can never appear without each other.
  const hasUnnamed = unnamedFigureDraws(split);
  const dek = copy.chartExplanation(namesOnly, hasUnnamed, isBallot);
  // Without the donut there is no picture for the opening sentence to describe, so only
  // the sentences defining the 2 figures carry over into the states that draw no chart.
  const definition = hasUnnamed ? namedMoneyDefinition(isBallot) : [];
  return (
    <View style={[s.section, styles.wrap]}>
      <Text accessibilityRole="header" aria-level={headingLevel} style={s.heading}>
        {copy.chartHeading(namesOnly)}
      </Text>
      {!complete ? (
        <>
          <Text style={s.body}>{failed ? copy.chartFailed : copy.chartLoading}</Text>
          <Dek segments={definition} />
        </>
      ) : chart?.state === 'withheld' ? (
        <Text style={[s.body, numericText(explanation)]}>{explanation}</Text>
      ) : chart?.state === 'no_rows' ? (
        <>
          <Text style={[s.body, s.numeric]}>{copy.emptyTab('donor', year)}</Text>
          <Dek segments={definition} />
        </>
      ) : chart?.state !== 'ready' ? (
        <>
          <Text style={s.body}>{copy.chartUnavailable}</Text>
          <Dek segments={definition} />
        </>
      ) : (
        <>
          <Dek segments={dek} />
          <View style={[styles.chartRow, isMobile && styles.chartStack]}>
            <View style={{ width: diameter, height: diameter, alignSelf: 'center' }}>
              <Svg
                width={diameter}
                height={diameter}
                viewBox="0 0 180 180"
                role="img"
                aria-label={copy.chartAlternative(
                  chart.slices.map(
                    (slice) =>
                      `${slice.kind || copy.kindMissing} ${Math.round(slice.share * 1000) / 10}%`,
                  ),
                )}
              >
                {chart.slices.map((slice) => {
                  // One contiguous ring: no white cut between neighbouring slices, so a
                  // share is drawn at its own size rather than a few tenths short of it.
                  const length = Math.max(0, slice.share * circumference);
                  const start = offset;
                  offset += slice.share * circumference;
                  return (
                    <Circle
                      key={slice.kind}
                      cx={90}
                      cy={90}
                      r={70}
                      fill="none"
                      stroke={slice.tab ? c[slice.tab] : c.unnamed}
                      strokeWidth={30}
                      strokeDasharray={`${length} ${circumference - length}`}
                      strokeDashoffset={-start}
                      transform="rotate(-90 90 90)"
                    />
                  );
                })}
              </Svg>
              {/* The figure alone. The grey word under it named the base the percentages
                  divide by, which the dek's first sentence already says in words. */}
              <View pointerEvents="none" style={styles.center}>
                <Text
                  style={[
                    s.amount,
                    { fontSize: type.donutCenter, lineHeight: type.donutCenter * 1.1 },
                  ]}
                >
                  {formatMoney(chart.base)}
                </Text>
              </View>
            </View>
            <View style={[styles.legend, { minWidth: isMobile ? type.legendMin : 380 }]}>
              {chart.slices.map((slice) => (
                <View
                  key={slice.kind}
                  style={[
                    styles.legendRow,
                    // The non-itemized row is the one row that was never a link, and now
                    // that no row is, this rule is what holds it apart from the kinds.
                    slice.tab ? null : styles.legendRuled,
                    isMobile && styles.legendRowMobile,
                  ]}
                >
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: slice.tab ? c[slice.tab] : c.unnamed },
                    ]}
                  />
                  <View style={[styles.legendName, isMobile && styles.legendNameMobile]}>
                    <Text style={[s.name, numericText(slice.kind)]}>
                      {slice.kind || copy.kindMissing}
                    </Text>
                    {slice.nameCount !== undefined ? (
                      <Text style={[s.small, s.numeric]}>{copy.names(slice.nameCount)}</Text>
                    ) : null}
                  </View>
                  <Text numberOfLines={1} style={[s.amount, styles.legendAmount]}>
                    {formatMoney(slice.amount)}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      s.amount,
                      s.numeric,
                      styles.legendPercent,
                      isMobile ? null : styles.legendPercentWide,
                    ]}
                  >
                    {Math.round(slice.share * 1000) / 10}%
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </>
      )}
      {isAmountAboveZero(split.namedInKindTotal) ? (
        <Text style={[s.small, s.numeric]}>
          {inKindDonationsNote(formatMoney(split.namedInKindTotal)!)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 8 },
  chartRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 36 },
  chartStack: { flexDirection: 'column', alignItems: 'stretch', gap: 14 },
  center: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legend: { flex: 1, maxWidth: 760, gap: 0 },
  legendRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  legendRowMobile: { alignItems: 'flex-start' },
  legendRuled: { borderTopWidth: 1, borderTopColor: c.shadow, marginTop: 4 },
  swatch: { width: 14, height: 14, borderRadius: 3, flexShrink: 0 },
  // On a computer the name and its count share one baseline; on a phone the count
  // always sits under the name, whatever the name's length, so every row matches.
  legendName: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  legendNameMobile: { flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
  // A floor rather than a fixed width: 52px is the drawn column, and a percent that
  // measures a hair wider in the shipped face must push the column out rather than wrap
  // its own "%" onto a second line.
  legendPercent: { minWidth: 52, flexShrink: 0, textAlign: 'right' },
  legendPercentWide: { marginLeft: 16 },
  legendAmount: { flexShrink: 0 },
});
