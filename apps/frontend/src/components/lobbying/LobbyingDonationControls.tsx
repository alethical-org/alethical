import { useEffect, useState, type CSSProperties } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  LOBBYING_DONATION_SORTS,
  LOBBYING_DONATION_AMOUNT_NOTE,
  LOBBYING_DONATION_SCOPE_NOTE,
  LOBBYING_DONATION_METHOD_NOTE,
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
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  useEffect(() => ensureYearFilterWebStyles(), []);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {Platform.OS === 'web' ? (
        <select
          aria-label={label}
          {...yearFilterSelectProps}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          style={selectStyle}
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

export function LobbyingDonationControls({
  donations,
  sort,
  requestedYear,
  loading = false,
  onYear,
  onSort,
}: {
  requestedYear?: number;
  loading?: boolean;
  donations?: LobbyingDirectoryDonations;
  sort: LobbyingDonationSort;
  onYear: (year: string) => void;
  onSort: (sort: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const selectedYear = donations?.year ?? requestedYear;
  const years = [
    ...new Set([
      ...(donations?.available_years ?? []),
      ...(selectedYear != null ? [selectedYear] : []),
    ]),
  ].sort((a, b) => b - a);
  const date = donations?.copied_at ? centralDateLabel(donations.copied_at) : null;
  return (
    <View style={styles.section}>
      <View style={styles.controls}>
        <LobbyingSelect
          label="Year"
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
          value={sort}
          options={LOBBYING_DONATION_SORTS}
          onChange={onSort}
        />
      </View>
      <Text style={styles.note}>{LOBBYING_DONATION_AMOUNT_NOTE}</Text>
      {date ? <Text style={styles.note}>Campaign contribution file copied {date}.</Text> : null}
      {loading ? null : donations?.eligible_count != null && donations.year != null ? (
        <Text style={styles.note}>
          {donations.eligible_count.toLocaleString('en-US')} lobbyists in these results have an
          amount available for {donations.year}.
        </Text>
      ) : (
        <Text style={styles.note}>
          Donation amounts are unavailable. You can still browse lobbyists by name.
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        aria-expanded={expanded}
        onPress={() => setExpanded(!expanded)}
        style={styles.disclosure}
      >
        <Text style={styles.disclosureText}>
          {expanded ? 'Hide how these amounts are counted' : 'How these amounts are counted'}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={styles.explanation}>
          <Text style={styles.note}>{LOBBYING_DONATION_SCOPE_NOTE}</Text>
          <Text style={styles.note}>{LOBBYING_DONATION_METHOD_NOTE}</Text>
          <>
            {donations?.source_url ? (
              <Pressable {...externalLinkProps(donations.source_url)} style={styles.disclosure}>
                <LinkArrowLabel
                  label="View the Board’s campaign contribution file"
                  style={styles.disclosureText}
                />
              </Pressable>
            ) : null}
          </>
        </View>
      ) : null}
    </View>
  );
}
const selectStyle: CSSProperties = {
  minHeight: 48,
  width: '100%',
  maxWidth: '100%',
  padding: '0 12px',
  borderRadius: 11,
  border: '1px solid #d4d7d4',
  background: '#fff',
  color: '#11150f',
  fontFamily: theme.typography.body,
  fontSize: 16,
  fontVariantNumeric: 'tabular-nums',
};
const styles = StyleSheet.create({
  section: { marginTop: 20 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' },
  field: { minWidth: 0, flexGrow: 1, flexBasis: 180, maxWidth: 370, gap: 8 },
  label: { fontFamily: theme.typography.body, color: '#2c322c', fontSize: 16, fontWeight: '700' },
  note: {
    marginTop: 10,
    fontFamily: theme.typography.body,
    color: '#4f5651',
    fontSize: 15,
    lineHeight: 23,
  },
  disclosure: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  disclosureText: {
    fontFamily: theme.typography.body,
    color: theme.colors.text.greenOnLight,
    fontSize: 15,
    fontWeight: '700',
  },
  explanation: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderLeftWidth: 2,
    borderLeftColor: '#d4d7d4',
  },
  fallbackChoice: { minHeight: 44, justifyContent: 'center' },
});
