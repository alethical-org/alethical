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
import { LobbyingChoiceMenu } from './LobbyingChoiceMenu';
import { externalLinkProps } from '../../navigation/links';
import { LinkArrowLabel } from '../LinkArrow';
import { finePointerHovered } from '../campaignMoney/finePointerHover';
import {
  REGISTRATION_MATCH_LIMIT,
  NAME_REGISTRATION_DIFFERENCE,
  SMALL_CONTRIBUTION_LIMIT,
  FILE_COPY_MEANING,
  CONTRIBUTION_REPORTING_URL,
  CONTRIBUTION_REPORTING_LABEL,
} from '../../lib/moneyRecordTrust';

/**
 * The lobbyist record page's donation-year control, unchanged: a browser menu in
 * a box we style. The directory's own 2 controls use `LobbyingDrawnSelect` below.
 */
export function LobbyingSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  inRow = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  inRow?: boolean;
}) {
  useEffect(() => ensureYearFilterWebStyles(), []);
  return (
    <View style={[styles.field, inRow && styles.fieldInRow]}>
      <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
      {Platform.OS === 'web' ? (
        <View style={styles.selectBox}>
          <select
            aria-label={label}
            {...yearFilterSelectProps}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            style={{ ...selectStyle, ...(disabled ? disabledSelectStyle : null) }}
          >
            {options.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <View style={styles.chevron} pointerEvents="none">
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" aria-hidden>
              <Path
                d="M6 9 L12 15 L18 9"
                stroke={disabled ? '#8a908a' : '#4f5651'}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </View>
        </View>
      ) : (
        <Choices value={value} options={options} onChange={onChange} disabled={disabled} />
      )}
    </View>
  );
}

/**
 * The directory's own control: a closed box we draw and an open list we draw.
 * The label sits beside the box on a computer and above it on a phone; either
 * way it is on screen, so it can name the control for a screen reader.
 */
export function LobbyingDrawnSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  labelBeside = false,
  fullWidth = false,
  width,
  fontSize = 16,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  labelBeside?: boolean;
  fullWidth?: boolean;
  width?: number;
  /** The phone steps the value down; the box grows rather than cutting it off. */
  fontSize?: number;
}) {
  const labelId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <View
      style={[
        styles.field,
        labelBeside && styles.fieldBeside,
        fullWidth && styles.fieldStacked,
        // Raise the entire field, so its menu clears the next stacked control.
        menuOpen && { zIndex: 1 },
      ]}
    >
      <Text
        nativeID={labelId}
        style={[
          styles.label,
          labelBeside && styles.labelBeside,
          fullWidth && styles.labelAbove,
          disabled && styles.labelDisabled,
        ]}
      >
        {label}
      </Text>
      {Platform.OS === 'web' ? (
        <LobbyingChoiceMenu
          label={label}
          labelId={labelId}
          value={value}
          options={options}
          onChange={onChange}
          disabled={disabled}
          width={width}
          fullWidth={fullWidth || width == null}
          valueSize={fontSize}
          onOpenChange={setMenuOpen}
        />
      ) : (
        <Choices value={value} options={options} onChange={onChange} disabled={disabled} />
      )}
    </View>
  );
}

/** Off the web there is no popup layer, so every choice is simply a button. */
function Choices({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
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
  );
}

/** Year and Sort by, as the results card header draws them at each width. */
export function LobbyingDonationSelects({
  donations,
  sort,
  requestedYear,
  loading = false,
  stacked = false,
  gap = 20,
  onYear,
  onSort,
}: {
  donations?: LobbyingDirectoryDonations;
  sort: LobbyingDonationSort;
  requestedYear?: number;
  loading?: boolean;
  stacked?: boolean;
  gap?: number;
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
  // Each box is as wide as its own longest choice, so nothing clips and the box
  // never resizes as the choice changes. Year widens only while it is showing a
  // disabled stand-in, which a reader never sees mid-interaction.
  const yearWidth = years.length ? 104 : loading ? 168 : 148;
  // The phone takes the card's full width, where a 2-line value is the right
  // failure rather than a value cut in half.
  const fontSize = stacked ? 15 : 16;
  return (
    <View style={[styles.controls, { gap }, stacked && styles.controlsStacked]}>
      <LobbyingDrawnSelect
        label="Year"
        labelBeside={!stacked}
        fullWidth={stacked}
        width={stacked ? undefined : yearWidth}
        fontSize={fontSize}
        value={String(selectedYear ?? '')}
        onChange={onYear}
        disabled={!years.length}
        options={
          years.length
            ? years.map((year) => ({ value: String(year), label: String(year) }))
            : [{ value: '', label: loading ? 'Loading years' : 'Unavailable' }]
        }
      />
      <LobbyingDrawnSelect
        label="Sort by"
        labelBeside={!stacked}
        fullWidth={stacked}
        // It is the open list that sets this figure, not the closed box:
        // `Recorded amount: highest first` measures 237.4 at 16 · 700, and an
        // option adds a 15 tick, a 9 gap, 12 of its own padding each side and
        // the panel's 6 each side.
        width={stacked ? undefined : 304}
        fontSize={fontSize}
        value={sort}
        options={LOBBYING_DONATION_SORTS}
        onChange={onSort}
      />
    </View>
  );
}

/**
 * What the amount column means, when the campaign file behind it was copied, how
 * many of the matched lobbyists carry one, and the method behind it. Each date sits
 * against the records it dates: this one belongs to the dollars, so it follows the
 * paragraph that explains them rather than sitting beside a control. A pending or
 * failed read establishes no count, so neither the count nor the unavailable
 * sentence prints until a response arrives.
 */
export function LobbyingDonationNotes({
  donations,
  settled,
  total,
  measure,
}: {
  donations?: LobbyingDirectoryDonations;
  settled: boolean;
  /** Every lobbyist the current name search matched, not the visible page. */
  total?: number | null;
  /** The note's own reading width at this band; the phone takes the full column. */
  measure?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const date = donations?.copied_at ? centralDateLabel(donations.copied_at) : null;
  // A name that matched nothing has no ratio to state, and `0 of the 0` beside the
  // no-match message would read as a figure rather than as an empty result.
  const matched = total != null && total > 0;
  const eligible =
    matched && donations?.eligible_count != null && donations.year != null
      ? lobbyingEligibleAmountLine(donations.eligible_count, total, donations.year)
      : null;
  const width = measure != null ? { maxWidth: measure } : null;
  return (
    <View>
      <Text style={[styles.note, styles.pretty, width]}>{LOBBYING_DONATION_AMOUNT_NOTE}</Text>
      {date ? <Text style={styles.fileDate}>{lobbyingCampaignFileDate(date)}</Text> : null}
      {settled && matched ? (
        <Text style={[styles.note, width, eligible ? styles.eligible : null]}>
          {eligible ?? LOBBYING_DONATION_AMOUNTS_UNAVAILABLE}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onPress={() => setExpanded(!expanded)}
        style={[styles.disclosure, styles.disclosureRow]}
      >
        {(state) => (
          <>
            <Text style={[styles.disclosureText, finePointerHovered(state) && styles.actionHover]}>
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
          </>
        )}
      </Pressable>
      <View nativeID={panelId}>
        {expanded ? (
          <View style={styles.explanation}>
            <Text style={[styles.note, width]}>{LOBBYING_DONATION_SCOPE_NOTE}</Text>
            <Text style={[styles.note, width]}>{LOBBYING_DONATION_METHOD_NOTE}</Text>
            <Text style={[styles.note, width]}>{REGISTRATION_MATCH_LIMIT}</Text>
            <Text style={[styles.note, width]}>{NAME_REGISTRATION_DIFFERENCE}</Text>
            <Text style={[styles.note, width]}>{SMALL_CONTRIBUTION_LIMIT}</Text>
            <Text style={[styles.note, width]}>{FILE_COPY_MEANING}</Text>
            <Pressable {...externalLinkProps(CONTRIBUTION_REPORTING_URL)} style={styles.disclosure}>
              {(state) => (
                <LinkArrowLabel
                  label={CONTRIBUTION_REPORTING_LABEL}
                  style={[styles.sourceLinkText, finePointerHovered(state) && styles.sourceHover]}
                />
              )}
            </Pressable>
            {donations?.source_url ? (
              <Pressable {...externalLinkProps(donations.source_url)} style={styles.disclosure}>
                {(state) => (
                  <LinkArrowLabel
                    label={LOBBYING_DONATION_SOURCE_LABEL}
                    style={[styles.sourceLinkText, finePointerHovered(state) && styles.sourceHover]}
                  />
                )}
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const selectStyle: CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  height: 48,
  width: '100%',
  maxWidth: '100%',
  padding: '0 42px 0 14px',
  borderRadius: 12,
  border: '1px solid rgba(17,21,15,0.18)',
  background: '#fff',
  color: '#11150f',
  cursor: 'pointer',
  fontFamily: theme.typography.body,
  fontSize: 16,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};
const disabledSelectStyle: CSSProperties = {
  background: '#f4f5f4',
  border: '1px solid rgba(17,21,15,0.1)',
  color: '#8a908a',
  cursor: 'not-allowed',
};
const styles = StyleSheet.create({
  field: { minWidth: 0, maxWidth: 370, gap: 8 },
  fieldStacked: { maxWidth: undefined, gap: 5 },
  fieldInRow: { flexGrow: 1, flexBasis: 180 },
  selectBox: { position: 'relative', minWidth: 0 },
  // The glyph carries 3.75 of slack inside its own 15 box, so a 16 offset puts
  // the drawn arrow 20 from the border, which is what a reader sees.
  chevron: { position: 'absolute', right: 16, top: '50%', transform: [{ translateY: -7.5 }] },
  fieldBeside: {
    maxWidth: undefined,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontFamily: theme.typography.body,
    color: '#2c322c',
    fontSize: 16,
    fontWeight: '700',
  },
  labelBeside: { fontSize: 15, fontWeight: '800', color: '#3f463f' },
  labelAbove: { fontSize: 14.5, fontWeight: '800', color: '#3f463f' },
  labelDisabled: { color: '#8a908a' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  // A wrapping column would size both boxes to the widest choice rather than to the
  // card, so the stacked arrangement never wraps.
  controlsStacked: { flexDirection: 'column', flexWrap: 'nowrap', alignItems: 'stretch' },
  note: {
    marginTop: 10,
    fontFamily: theme.typography.body,
    color: '#4f5651',
    fontSize: 15,
    lineHeight: 23,
  },
  // A 2-line paragraph risks a 1-word last line; the browser balances it instead.
  pretty: { ...({ textWrap: 'pretty' } as object) },
  eligible: { color: '#11150f', fontWeight: '700' },
  disclosureRow: { marginTop: 4 },
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
  actionHover: { textDecorationLine: 'underline' },
  sourceLinkText: {
    fontFamily: theme.typography.body,
    color: theme.colors.text.greenOnLight,
    fontSize: 15,
    fontWeight: '700',
  },
  sourceHover: { color: '#11832b', textDecorationLine: 'underline' },
  fileDate: {
    marginTop: 10,
    fontFamily: theme.typography.body,
    fontVariant: ['tabular-nums'],
    color: '#656c66',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
  },
  explanation: { paddingBottom: 4 },
  fallbackChoice: { minHeight: 44, justifyContent: 'center' },
});
