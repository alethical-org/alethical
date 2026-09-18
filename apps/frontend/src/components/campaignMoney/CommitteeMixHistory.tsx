import { useId, useState } from 'react';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import { Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';

import { useCampaignMoneyDetails } from '../../hooks/useCampaignMoneyDetails';
import { useResponsive } from '../../hooks/useResponsive';
import {
  MONEY_DETAILS_TABS,
  prepareContributionChart,
  type ContributionChart,
} from '../../lib/campaignMoneyDetails';
import { numericText, useDetailsStyles } from './detailsStyles';
import { moneyDetailsCopy as copy } from '../../lib/campaignMoneyDetailsCopy';
import { yearFilterButtonStyle, yearFilterLabelStyle } from '../../theme/yearFilters';

type Slice = ContributionChart['slices'][number];
const percentage = (slice: Slice) => `${Math.round(slice.share * 1000) / 10}%`;
const colour = (slice: Slice) => (slice.tab ? c[slice.tab] : c.other);

/** Each history belongs to one registration, even on a profile with several accounts. */
export function CommitteeMixHistory({
  registrationNumber,
  year,
  releaseId,
  onSelectYear,
}: {
  registrationNumber: string;
  committeeName: string;
  year: number;
  releaseId?: string;
  onSelectYear: (year: number) => void;
}) {
  const details = useCampaignMoneyDetails(registrationNumber, year);
  if (
    !details.historyComplete ||
    !details.history.data ||
    (releaseId && details.history.data.releaseId !== releaseId)
  )
    return null;
  const charts = details.history.data.years.map((record) => ({
    year: record.year,
    chart: prepareContributionChart(record.payments, {
      state: 'no_reported_total',
      namedCashTotal: null,
      reportedTotal: null,
      unnamedTotal: null,
    }),
  }));
  return (
    <MixHistory
      key={`${registrationNumber}:${details.history.data.releaseId}`}
      charts={charts}
      year={year}
      onSelectYear={onSelectYear}
    />
  );
}

function MixHistory({
  charts,
  year,
  onSelectYear,
}: {
  charts: { year: number; chart: ContributionChart }[];
  year: number;
  onSelectYear: (year: number) => void;
}) {
  const s = useDetailsStyles();
  const { isMobile } = useResponsive();
  const id = useId();
  const [earlierVisible, setEarlierVisible] = useState(false);
  const [expandedYears, setExpandedYears] = useState<number[]>([]);
  const [readout, setReadout] = useState<{ year: number; slice: Slice } | null>(null);
  // Unusable amounts never mean an empty year. An entirely empty history stays visible.
  const firstNonempty = charts.findIndex(({ chart }) => chart.state !== 'no_rows');
  const hiddenCount = firstNonempty > 0 ? firstNonempty : 0;
  const visibleCharts = earlierVisible ? charts : charts.slice(hiddenCount);
  const slices = charts.flatMap(({ chart }) => chart.slices);
  const legend = MONEY_DETAILS_TABS.flatMap(({ id: tab }) => {
    const slice = slices.find((item) => item.tab === tab && item.share > 0);
    return slice ? [slice] : [];
  });
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" aria-level={2} style={s.heading}>
        {copy.historyHeading}
      </Text>
      <Text style={[s.body, styles.explanation]}>{copy.historyExplanation}</Text>
      {hiddenCount > 0 && (
        <Pressable
          accessibilityRole="button"
          aria-expanded={earlierVisible}
          aria-controls={`${id}-years`}
          onPress={() => setEarlierVisible((value) => !value)}
          style={(state) => [
            styles.control,
            Boolean('hovered' in state && state.hovered) && styles.hover,
            Boolean('focused' in state && state.focused) && s.focus,
          ]}
        >
          <Text style={[s.controlText, styles.controlText]}>
            {earlierVisible ? copy.historyHideEarlier : copy.historyShowEarlier}
          </Text>
        </Pressable>
      )}
      <View nativeID={`${id}-years`}>
        {visibleCharts.map(({ year: rowYear, chart }) => {
          const expanded = expandedYears.includes(rowYear);
          return (
            <View key={rowYear} style={styles.yearBlock}>
              <View style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  aria-pressed={year === rowYear}
                  accessibilityLabel={copy.chooseYear(rowYear)}
                  onPress={() => onSelectYear(rowYear)}
                  style={(state) => yearFilterButtonStyle(styles.year, year === rowYear, state)}
                >
                  <Text style={yearFilterLabelStyle([s.controlText, s.numeric], year === rowYear)}>
                    {rowYear}
                  </Text>
                </Pressable>
                {chart.state === 'ready' ? (
                  <View style={[styles.barAndControl, isMobile && styles.mobileBarAndControl]}>
                    <View role="group" aria-label={String(rowYear)} style={styles.bar}>
                      {chart.slices
                        .filter((slice) => slice.share > 0)
                        .map((slice) => {
                          const label = `${rowYear}, ${slice.kind || copy.kindMissing} ${percentage(slice)}`;
                          const show = () => setReadout({ year: rowYear, slice });
                          return (
                            <Pressable
                              key={slice.kind}
                              accessibilityRole="button"
                              accessibilityLabel={label}
                              {...({ title: label } as object)}
                              onHoverIn={show}
                              onFocus={show}
                              onPress={show}
                              style={(state) => [
                                styles.segment,
                                { flex: slice.share, backgroundColor: colour(slice) },
                                Boolean('focused' in state && state.focused) && styles.segmentFocus,
                              ]}
                            />
                          );
                        })}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={copy.historyPercentagesLabel(rowYear, expanded)}
                      aria-expanded={expanded}
                      aria-controls={`${id}-${rowYear}-percentages`}
                      onPress={() =>
                        setExpandedYears((years) =>
                          expanded
                            ? years.filter((value) => value !== rowYear)
                            : [...years, rowYear],
                        )
                      }
                      style={(state) => [
                        styles.control,
                        Boolean('hovered' in state && state.hovered) && styles.hover,
                        Boolean('focused' in state && state.focused) && s.focus,
                      ]}
                    >
                      <Text style={[s.controlText, styles.controlText]}>
                        {expanded ? copy.historyHidePercentages : copy.historyViewPercentages}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text
                    style={[s.small, styles.empty, chart.state === 'no_rows' && styles.emptyChip]}
                  >
                    {chart.state === 'no_rows' ? copy.historyEmpty : copy.historyUnavailable}
                  </Text>
                )}
              </View>
              {chart.state === 'ready' && expanded && (
                <View
                  nativeID={`${id}-${rowYear}-percentages`}
                  role="list"
                  aria-label={copy.historyPercentagesHeading(rowYear)}
                  style={styles.percentages}
                >
                  {chart.slices.map((slice) => (
                    <View role="listitem" key={slice.kind} style={styles.shareRow}>
                      <View style={[styles.swatch, { backgroundColor: colour(slice) }]} />
                      <Text style={[s.small, styles.shareName]}>
                        {slice.kind || copy.kindMissing}
                      </Text>
                      <Text style={[s.small, s.numeric]}>{percentage(slice)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
      {slices.length > 0 && (
        <View role="status" aria-live="polite" style={styles.readout}>
          {readout ? (
            <>
              <View style={[styles.swatch, { backgroundColor: colour(readout.slice) }]} />
              <Text style={[s.small, s.numeric, styles.ink]}>{readout.year}</Text>
              <Text style={s.small}>{readout.slice.kind || copy.kindMissing}</Text>
              <Text style={[s.small, s.numeric, styles.ink]}>{percentage(readout.slice)}</Text>
            </>
          ) : (
            <Text style={s.small}>{copy.historyReadoutHint}</Text>
          )}
        </View>
      )}
      <View role="list" aria-label={copy.historyLegend} style={s.horizontal}>
        {legend.map((slice) => (
          <View key={slice.kind} role="listitem" style={s.horizontal}>
            <View style={[styles.swatch, { backgroundColor: colour(slice) }]} />
            <Text style={[s.small, numericText(slice.kind)]}>{slice.kind || copy.kindMissing}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 22,
    gap: 16,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 16,
  },
  explanation: { maxWidth: 900, textWrap: 'pretty' } as TextStyle,
  yearBlock: { gap: 8, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
  year: {
    minHeight: 44,
    minWidth: 58,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  barAndControl: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  mobileBarAndControl: { flexDirection: 'column', alignItems: 'stretch', paddingVertical: 8 },
  bar: {
    flex: 1,
    width: '100%',
    minWidth: 0,
    minHeight: 22,
    flexDirection: 'row',
    gap: 2,
    backgroundColor: c.background,
    borderRadius: 4,
    overflow: 'hidden',
  },
  segment: { height: 22, padding: 0, borderWidth: 0 },
  segmentFocus: { outlineColor: c.text, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: -2 },
  control: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.16)',
    borderRadius: 10,
    backgroundColor: c.background,
  },
  controlText: { color: c.text },
  hover: { backgroundColor: '#f3f5f4' },
  empty: { flex: 1 },
  emptyChip: {
    borderWidth: 1,
    borderColor: c.border,
    borderStyle: 'dashed',
    borderRadius: 6,
    paddingHorizontal: 10,
  },
  percentages: { paddingLeft: 72, gap: 8 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shareName: { flex: 1 },
  readout: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  ink: { color: c.text },
  swatch: { width: 14, height: 14, borderRadius: 3 },
});
