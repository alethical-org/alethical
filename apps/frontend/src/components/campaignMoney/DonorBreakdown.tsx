import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import type { CommitteeReceivedPayment } from '../../data/types';
import { useResponsive } from '../../hooks/useResponsive';
import { prepareContributionChart, type MoneyDetailsTab } from '../../lib/campaignMoneyDetails';
import { inKindDonationsNote } from '../../lib/committeeMoney';
import {
  formatMoney,
  isAmountAboveZero,
  splitExplanation,
  type SplitState,
} from '../../lib/legislatorCampaignMoney';
import { numericText, useCampaignMoneyTypography, useDetailsStyles } from './detailsStyles';
import { moneyDetailsCopy as copy } from '../../lib/campaignMoneyDetailsCopy';

type Split = {
  state: SplitState;
  reportedTotal: string | null;
  namedCashTotal: string | null;
  namedInKindTotal: string | null;
  unnamedTotal: string | null;
};

export function DonorBreakdown({
  payments,
  split,
  year,
  complete,
  failed,
  onSelectTab,
}: {
  payments: CommitteeReceivedPayment[];
  split: Split;
  year: number;
  complete: boolean;
  failed: boolean;
  onSelectTab: (tab: MoneyDetailsTab) => void;
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
  return (
    <View style={[s.section, styles.wrap]}>
      <Text accessibilityRole="header" aria-level={4} style={s.heading}>
        {copy.chartHeading(namesOnly)}
      </Text>
      {!complete ? (
        <Text style={s.body}>{failed ? copy.chartFailed : copy.chartLoading}</Text>
      ) : chart?.state === 'withheld' ? (
        <Text style={[s.body, numericText(explanation)]}>{explanation}</Text>
      ) : chart?.state === 'no_rows' ? (
        <Text style={[s.body, s.numeric]}>{copy.emptyTab('donor', year)}</Text>
      ) : chart?.state !== 'ready' ? (
        <Text style={s.body}>{copy.chartUnavailable}</Text>
      ) : (
        <>
          <Text style={s.small}>{copy.chartExplanation(namesOnly)}</Text>
          <View style={[styles.chartRow, isMobile && styles.chartStack]}>
            <View style={{ width: diameter, height: diameter, alignSelf: 'center' }}>
              <Svg width={diameter} height={diameter} viewBox="0 0 180 180" aria-hidden>
                {chart.slices.map((slice) => {
                  const length = Math.max(
                    0,
                    slice.share * circumference - (chart.slices.length > 1 ? 2 : 0),
                  );
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
                      strokeWidth={22}
                      strokeDasharray={`${length} ${circumference - length}`}
                      strokeDashoffset={-start}
                      transform="rotate(-90 90 90)"
                    />
                  );
                })}
              </Svg>
              <View pointerEvents="none" style={styles.center}>
                <Text
                  style={[
                    s.amount,
                    { fontSize: type.donutCenter, lineHeight: type.donutCenter * 1.1 },
                  ]}
                >
                  {formatMoney(chart.base)}
                </Text>
                <Text style={[s.small, styles.centerLabel]}>{copy.baseLabel(namesOnly)}</Text>
              </View>
            </View>
            <View style={[styles.legend, { minWidth: isMobile ? type.legendMin : 0 }]}>
              {chart.slices.map((slice) => {
                const content = (
                  <>
                    <View
                      style={[
                        styles.swatch,
                        { backgroundColor: slice.tab ? c[slice.tab] : c.unnamed },
                      ]}
                    />
                    <View style={styles.legendName}>
                      <Text style={[s.name, numericText(slice.kind)]}>
                        {slice.kind || copy.kindMissing}
                      </Text>
                      {slice.nameCount !== undefined ? (
                        <Text style={[s.small, s.numeric]}>{copy.names(slice.nameCount)}</Text>
                      ) : null}
                    </View>
                    <View style={styles.legendValue}>
                      <Text style={s.amount}>{formatMoney(slice.amount)}</Text>
                      <Text style={[s.amount, s.numeric]}>
                        {Math.round(slice.share * 1000) / 10}%
                      </Text>
                    </View>
                  </>
                );
                return slice.tab ? (
                  <Pressable
                    key={slice.kind}
                    accessibilityRole="button"
                    accessibilityLabel={copy.sliceAction(
                      slice.kind || copy.kindMissing,
                      slice.nameCount ?? 0,
                      formatMoney(slice.amount),
                      Math.round(slice.share * 1000) / 10,
                    )}
                    onPress={() => onSelectTab(slice.tab!)}
                    style={(state) => [
                      styles.legendRow,
                      Boolean('focused' in state && state.focused) && s.focus,
                    ]}
                  >
                    {content}
                  </Pressable>
                ) : (
                  <View key={slice.kind} style={styles.legendRow}>
                    {content}
                  </View>
                );
              })}
            </View>
          </View>
        </>
      )}
      {isAmountAboveZero(split.namedInKindTotal) ? (
        <Text style={[s.small, s.numeric]}>
          {inKindDonationsNote(formatMoney(split.namedInKindTotal)!, true)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 8 },
  chartRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 28 },
  chartStack: { flexDirection: 'column', alignItems: 'stretch', gap: 14 },
  center: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  centerLabel: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  legend: { flex: 1, maxWidth: 760, gap: 5 },
  legendRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  swatch: { width: 12, height: 12, borderRadius: 6, flexShrink: 0 },
  legendName: { flex: 1, minWidth: 0, gap: 3 },
  legendValue: { alignItems: 'flex-end', gap: 3 },
});
