import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useCampaignMoneyDetails } from '../../hooks/useCampaignMoneyDetails';
import { prepareContributionChart } from '../../lib/campaignMoneyDetails';
import { numericText, useDetailsStyles } from './detailsStyles';
import { moneyDetailsCopy as copy } from '../../lib/campaignMoneyDetailsCopy';

/** Each history belongs to one registration, even on a profile with several accounts. */
export function CommitteeMixHistory({
  registrationNumber,
  committeeName,
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
  const s = useDetailsStyles();
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
  const legend = new Map(
    charts.flatMap(({ chart }) => chart.slices.map((slice) => [slice.kind, slice] as const)),
  );
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" aria-level={3} style={s.heading}>
        {copy.historyHeading}
      </Text>
      <Text style={[s.name, numericText(committeeName)]}>{committeeName}</Text>
      <Text style={s.body}>{copy.historyExplanation}</Text>
      <View>
        {charts.map(({ year: rowYear, chart }) => (
          <View key={rowYear} style={styles.row}>
            <Pressable
              accessibilityRole="button"
              aria-pressed={year === rowYear}
              accessibilityLabel={copy.chooseYear(rowYear)}
              onPress={() => onSelectYear(rowYear)}
              style={(state) => [
                styles.year,
                year === rowYear && styles.active,
                Boolean('focused' in state && state.focused) && s.focus,
              ]}
            >
              <Text style={[s.controlText, s.numeric]}>{rowYear}</Text>
            </Pressable>
            {chart.state === 'ready' ? (
              <View
                role="img"
                aria-label={`${rowYear}: ${chart.slices.map((slice) => `${slice.kind || copy.kindMissing} ${Math.round(slice.share * 1000) / 10}%`).join(', ')}`}
                style={styles.bar}
              >
                {chart.slices.map((slice) => (
                  <View
                    key={slice.kind}
                    style={{
                      flex: slice.share,
                      backgroundColor: slice.tab ? c[slice.tab] : c.other,
                      height: 24,
                    }}
                  />
                ))}
              </View>
            ) : (
              <Text style={[s.small, styles.empty]}>
                {chart.state === 'no_rows' ? copy.historyEmpty : copy.historyUnavailable}
              </Text>
            )}
          </View>
        ))}
      </View>
      <View style={s.horizontal}>
        {[...legend.values()].map((slice) => (
          <View key={slice.kind} style={s.horizontal}>
            <View
              style={[styles.swatch, { backgroundColor: slice.tab ? c[slice.tab] : c.other }]}
            />
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
  year: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 8 },
  active: { backgroundColor: c.tile },
  bar: { flex: 1, minWidth: 0, flexDirection: 'row', borderRadius: 4, overflow: 'hidden' },
  empty: { flex: 1 },
  swatch: { width: 12, height: 12, borderRadius: 6 },
});
