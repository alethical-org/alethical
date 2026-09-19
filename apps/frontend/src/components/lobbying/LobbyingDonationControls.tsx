import { useEffect, useId, useState, type CSSProperties } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  LOBBYING_DONATION_SORTS,
  LOBBYING_DONATION_AMOUNT_NOTE,
  LOBBYING_DONATION_AMOUNTS_UNAVAILABLE,
  LOBBYING_DONATION_EXPLANATION_HIDE_LABEL,
  LOBBYING_DONATION_EXPLANATION_LABEL,
  LOBBYING_DONATION_METHOD_NOTE,
  LOBBYING_DONATION_SCOPE_NOTE,
  LOBBYING_DONATION_SOURCE_LABEL,
  lobbyingCampaignFileDate,
  lobbyingEligibleAmountLine,
} from '../../lib/lobbyingDonationDirectory';
import { centralDateLabel } from '../../lib/moneyLanding';
import type { LobbyingDirectoryDonations, LobbyingDonationSort } from '../../lib/lobbyingTypes';
import { theme } from '../../theme/tokens';
import { ensureYearFilterWebStyles, yearFilterSelectProps } from '../../theme/yearFilters';
import { externalLinkProps } from '../../navigation/links';
import { LinkArrowLabel } from '../LinkArrow';

/** Native browser menus provide keyboard and phone behavior without a second popup system. */
export function LobbyingSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  inRow = false,
  /** The directory header sets its label beside the box and sizes each box to its
   *  own longest choice, so the selected label never clips. */
  labelBeside = false,
  fullWidth = false,
  width,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  inRow?: boolean;
  labelBeside?: boolean;
  fullWidth?: boolean;
  width?: number;
}) {
  useEffect(() => ensureYearFilterWebStyles(), []);
  return (
    <View
      style={[
        styles.field,
        inRow && styles.fieldInRow,
        labelBeside && styles.fieldBeside,
        fullWidth && styles.fieldStacked,
      ]}
    >
      <Text style={[styles.label, labelBeside && styles.labelBeside]}>{label}</Text>
      {Platform.OS === 'web' ? (
        <select
          aria-label={label}
          {...yearFilterSelectProps}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          style={width != null ? { ...selectStyle, width, flexShrink: 0 } : selectStyle}
        >
          {options.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      ) : (
        <View>
          {options.map((item) => (
            <Pressable
              key={item.value}
              disabled={disabled}
              accessibilityRole="button"
              aria-pressed={value === item.value}
              onPress={() => onChange(item.value)}
              style={styles.fallbackChoice}
            >
              <Text>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/** Year and Sort by, as the results card header draws them at each width. */
export function LobbyingDonationSelects({
  donations,
  sort,
  requestedYear,
  loading = false,
  stacked = false,
  onYear,
  onSort,
}: {
  donations?: LobbyingDirectoryDonations;
  sort: LobbyingDonationSort;
  requestedYear?: number;
  loading?: boolean;
  stacked?: boolean;
  onYear: (year: string) => void;
  onSort: (sort: string) => void;
}) {
  const selectedYear = donations?.year ?? requestedYear;
  const years = [
    ...new Set([
      ...(donations?.available_years ?? []),
      ...(selectedYear != null ? [selectedYear] : []),
    ]),
  ].sort((a, b) => b - a);
  return (
    <View style={[styles.controls, stacked && styles.controlsStacked]}>
      <LobbyingSelect
        label="Year"
        labelBeside={!stacked}
        fullWidth={stacked}
        // Sized to hold `Loading years`, its own longest choice, so no state clips
        // the box and the box never changes width.
        width={stacked ? undefined : 164}
        value={String(selectedYear ?? '')}
        onChange={onYear}
        disabled={!years.length}
        options={
          years.length
            ? years.map((year) => ({ value: String(year), label: String(year) }))
            : [{ value: '', label: loading ? 'Loading years' : 'Unavailable' }]
        }
      />
      <LobbyingSelect
        label="Sort by"
        labelBeside={!stacked}
        fullWidth={stacked}
        width={stacked ? undefined : 256}
        value={sort}
        options={LOBBYING_DONATION_SORTS}
        onChange={onSort}
      />
    </View>
  );
}

/**
 * What the amount column means, the count it covers, and the campaign file it was
 * copied from. A pending or failed read establishes no count, so neither the
 * eligible count nor the unavailable sentence prints until a response arrives.
 */
export function LobbyingDonationNotes({
  donations,
  settled,
  stacked = false,
}: {
  donations?: LobbyingDirectoryDonations;
  settled: boolean;
  stacked?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const date = donations?.copied_at ? centralDateLabel(donations.copied_at) : null;
  const eligible =
    donations?.eligible_count != null && donations.year != null
      ? lobbyingEligibleAmountLine(donations.eligible_count, donations.year)
      : null;
  return (
    <View>
      <Text style={styles.note}>{LOBBYING_DONATION_AMOUNT_NOTE}</Text>
      {settled ? (
        <Text style={[styles.note, eligible ? styles.eligible : null]}>
          {eligible ?? LOBBYING_DONATION_AMOUNTS_UNAVAILABLE}
        </Text>
      ) : null}
      <View style={[styles.discloseRow, stacked && styles.discloseRowStacked]}>
        <Pressable
          accessibilityRole="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onPress={() => setExpanded(!expanded)}
          style={styles.disclosure}
        >
          <Text style={styles.disclosureText}>
            {expanded
              ? LOBBYING_DONATION_EXPLANATION_HIDE_LABEL
              : LOBBYING_DONATION_EXPLANATION_LABEL}
          </Text>
          {/* A reveal control keeps the site's ink text and flipping chevron; the
              green arrow stays reserved for a link that changes the address. */}
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
            <Path
              d={expanded ? 'M6 15 L12 9 L18 15' : 'M6 9 L12 15 L18 9'}
              stroke={theme.colors.text.primary}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
        {date ? <Text style={styles.fileDate}>{lobbyingCampaignFileDate(date)}</Text> : null}
      </View>
      <View nativeID={panelId}>
        {expanded ? (
          <View style={styles.explanation}>
            <Text style={styles.note}>{LOBBYING_DONATION_SCOPE_NOTE}</Text>
            <Text style={styles.note}>{LOBBYING_DONATION_METHOD_NOTE}</Text>
            {donations?.source_url ? (
              <Pressable {...externalLinkProps(donations.source_url)} style={styles.disclosure}>
                <LinkArrowLabel
                  label={LOBBYING_DONATION_SOURCE_LABEL}
                  style={styles.sourceLinkText}
                />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const selectStyle: CSSProperties = {
  minHeight: 48,
  width: '100%',
  maxWidth: '100%',
  padding: '0 40px 0 14px',
  borderRadius: 12,
  border: '1px solid #d4d7d4',
  background: '#fff',
  color: '#11150f',
  fontFamily: theme.typography.body,
  fontSize: 16,
  fontVariantNumeric: 'tabular-nums',
};
const styles = StyleSheet.create({
  field: { minWidth: 0, maxWidth: 370, gap: 8 },
  fieldStacked: { maxWidth: undefined },
  fieldInRow: { flexGrow: 1, flexBasis: 180 },
  fieldBeside: {
    maxWidth: undefined,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  label: { fontFamily: theme.typography.body, color: '#2c322c', fontSize: 16, fontWeight: '700' },
  labelBeside: { fontSize: 15, fontWeight: '800', color: '#3f463f' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, alignItems: 'center' },
  // A wrapping column would size both boxes to the widest choice rather than to the
  // card, so the stacked arrangement never wraps.
  controlsStacked: {
    flexDirection: 'column',
    flexWrap: 'nowrap',
    alignItems: 'stretch',
    gap: 14,
  },
  note: {
    marginTop: 10,
    fontFamily: theme.typography.body,
    color: '#4f5651',
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 680,
  },
  eligible: { color: '#11150f', fontWeight: '700' },
  discloseRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  discloseRowStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 0 },
  disclosure: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  disclosureText: {
    fontFamily: theme.typography.body,
    color: theme.colors.text.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  sourceLinkText: {
    fontFamily: theme.typography.body,
    color: theme.colors.text.greenOnLight,
    fontSize: 15,
    fontWeight: '700',
  },
  fileDate: {
    fontFamily: theme.typography.body,
    fontVariant: ['tabular-nums'],
    color: '#656c66',
    fontSize: 14.5,
    lineHeight: 22,
  },
  explanation: { paddingBottom: 4 },
  fallbackChoice: { minHeight: 44, justifyContent: 'center' },
});
