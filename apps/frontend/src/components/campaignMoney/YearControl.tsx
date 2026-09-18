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
  surface?: 'committee' | 'profile';
  onSelect: (year: CampaignMoneyYear) => void;
  /** Let year buttons share available space while wrapping at their natural width. */
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
      <Text aria-hidden style={styles.yearWord}>
        Year
      </Text>
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
            accessibilityLabel={`${option}${namesOnlyYears.has(option) ? ', itemized contributions only' : ''}`}
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
  yearWord: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: '400',
    color: c.secondary,
    paddingRight: 8,
    flexShrink: 0,
  },
  yearsFull: { alignSelf: 'stretch', gap: 8 },
  yearButtonFull: { flexGrow: 1, flexBasis: 'auto' },
  yearButton: {
    minHeight: 44,
    minWidth: 76,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink18,
    backgroundColor: c.background,
  },
  yearButtonActive: {
    backgroundColor: c.text,
    borderColor: c.text,
  },
  yearLabel: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: 0.15,
    fontVariant: ['tabular-nums'],
    color: c.text,
  },
  yearLabelActive: { color: c.background },
});
