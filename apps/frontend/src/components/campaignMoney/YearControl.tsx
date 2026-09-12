import { Pressable, StyleSheet, Text, View } from 'react-native';
import { campaignMoneyYears, type CampaignMoneyYear } from '../../lib/legislatorCampaignMoney';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import { theme as t } from '../../theme/tokens';
import { detailsStyles } from './detailsStyles';

/**
 * The year switch.
 *
 * Each year has its own web address, so a figure someone sends to
 * somebody else arrives showing the year they were looking at. Deliberately not a
 * copy of the session pill at the head of Chief-Authored Bills: that pill counts a
 * two-year legislature, and this counts a calendar year, which is the unit
 * Minnesota's own reports use.
 */
export function YearControl({
  year,
  onSelect,
  fullWidth = false,
  namesOnlyYears = new Set<number>(),
  years = campaignMoneyYears(),
}: {
  year: CampaignMoneyYear;
  onSelect: (year: CampaignMoneyYear) => void;
  /** Phone band: the years share the row in equal halves rather than sitting as
   *  left-packed pills, which read as a toolbar with room to spare
   *  (`Money committee.dc.html`, rules for this screen). */
  fullWidth?: boolean;
  namesOnlyYears?: ReadonlySet<number>;
  years?: readonly number[];
}) {
  return (
    <View
      style={[styles.years, fullWidth && styles.yearsFull]}
      role="group"
      aria-label="Choose a year"
    >
      <Text style={styles.yearWord}>Year</Text>
      {years.map((option) => {
        const active = option === year;
        return (
          <Pressable
            key={option}
            onPress={() => onSelect(option)}
            accessibilityRole="button"
            // aria-pressed rather than accessibilityState: the second is dropped on
            // the way to the browser, so a screen reader would hear no difference
            // between the year in view and the one beside it.
            aria-pressed={active}
            accessibilityLabel={`${option}${namesOnlyYears.has(option) ? ', named donations only' : ''}`}
            style={(state) => [
              styles.yearButton,
              namesOnlyYears.has(option) && { borderStyle: 'dashed' },
              fullWidth && styles.yearButtonFull,
              active && styles.yearButtonActive,
              Boolean('focused' in state && state.focused) && detailsStyles.focus,
            ]}
          >
            <Text style={[styles.yearLabel, active && styles.yearLabelActive]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  years: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    maxWidth: '100%',
    flexShrink: 1,
    gap: 6,
  },
  yearWord: { fontFamily: t.typography.body, fontSize: 15, color: c.secondary, paddingRight: 4 },
  yearsFull: { alignSelf: 'stretch', gap: 8 },
  yearButtonFull: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  yearButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.background,
  },
  yearButtonActive: {
    backgroundColor: c.link,
    borderColor: c.link,
  },
  yearLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    color: c.secondary,
  },
  yearLabelActive: { color: c.background },
});
