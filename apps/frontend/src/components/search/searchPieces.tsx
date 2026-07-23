import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { ChevronDown, ChevronLeft, ChevronRight, MapPin, Search, X } from 'lucide-react-native';

import { theme } from '../../theme/tokens';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { useResponsive } from '../../hooks/useResponsive';
import { IaItem, MenuKey } from '../../navigation/ia';

// Shared building blocks for the redesigned Search Bills / Search Legislators
// screens (docs/mockups/search-bills + search-legislators). The two screens
// compose these; the per-page cards live in BillResultCard/LegislatorResultCard.
// High-fidelity: literal hex/px come from the .dc.html references.

const isWeb = Platform.OS === 'web';
const t = theme;

export type ChamberFilter = 'All' | 'House' | 'Senate';

// The session filter reads as "2025–2026 Legislative Session" — the year range
// a regular person recognizes, not the DB's formal chamber name. formatSession-
// Label reshapes the served name (e.g. "94th Legislature (2025 - 2026) Regular
// Session") into that; the fallback covers the pre-load render.
export function formatSessionLabel(name: string): string {
  const years = name.match(/\b(20\d{2})\b(?:\s*[-–]\s*(20\d{2}))?/);
  if (!years) return name;
  const range = years[2] ? `${years[1]}–${years[2]}` : years[1];
  return `${range} Legislative Session`;
}

export const SESSION_LABEL_FALLBACK = '2025–2026 Legislative Session';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// "2026-03-21" -> "AS OF MAR 21, 2026" (the results header's mono meta). Returns
// null for a missing/unparseable value so the chip is simply omitted.
function formatAsOf(dataAsOf: string | null | undefined): string | null {
  if (!dataAsOf) return null;
  const match = dataAsOf.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return `AS OF ${MONTHS[monthIndex]} ${Number(day)}, ${year}`;
}

function useHover(): [boolean, { onHoverIn: () => void; onHoverOut: () => void }] {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }];
}

// --- Page scaffold: gradient hero (with masked dot overlay) + white results
//     section + shared footer. Mirrors HomeSignedOutScreen's scaffold. ---
export function SearchPageShell({
  hero,
  children,
  overlay,
  openMenu,
  onOpenMenuChange,
  onNavigate,
  onHome,
  onSignIn,
  onAsk,
  onPrivacy,
  onTerms,
}: {
  hero: ReactNode;
  children: ReactNode;
  /** Modal/toast overlays, rendered outside the scroll so they stay pinned. */
  overlay?: ReactNode;
  openMenu: MenuKey | null;
  onOpenMenuChange: (menu: MenuKey | null) => void;
  onNavigate: (item: IaItem) => void;
  onHome?: () => void;
  onSignIn: () => void;
  onAsk: () => void;
  onPrivacy?: () => void;
  onTerms?: () => void;
}) {
  const heroGradientWeb: object = isWeb
    ? { backgroundImage: 'linear-gradient(180deg,#f4f5f7 0%,#f7f8fa 55%,#fdfdfe 90%,#ffffff 100%)' }
    : { backgroundColor: t.colors.surfaces.s300 };
  const heroDotsWeb: object = isWeb
    ? {
        backgroundImage: t.gradients.dotInk,
        backgroundSize: '30px 30px',
        maskImage:
          'linear-gradient(to bottom, transparent 0px, transparent 110px, #000 230px, #000 calc(100% - 120px), transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0px, transparent 110px, #000 230px, #000 calc(100% - 120px), transparent 100%)',
      }
    : {};

  return (
    <PageBackground>
      <View style={styles.root}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* HERO WRAPPER — sits above the results section so filter dropdowns
              overlay it (rather than being painted under the white block). */}
          <View style={[styles.heroWrap, heroGradientWeb]}>
            {isWeb ? (
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFillObject as object, heroDotsWeb]}
              />
            ) : null}

            <TopNav
              // Search pages suppress the top-level ✦ Ask entry (variant="home"
              // is the Ask-hidden nav) — the search hero is the primary action here.
              variant="home"
              openMenu={openMenu}
              onOpenMenuChange={onOpenMenuChange}
              onNavigate={onNavigate}
              onHome={onHome}
              onSignIn={onSignIn}
              onAsk={onAsk}
            />

            <Container style={styles.heroBody}>{hero}</Container>
          </View>

          {/* RESULTS SECTION — white, matches the mock's results panel. */}
          <View style={styles.resultsSection}>
            <Container>{children}</Container>
          </View>

          <Footer onPrivacy={onPrivacy} onTerms={onTerms} />
        </ScrollView>
        {overlay}
      </View>
    </PageBackground>
  );
}

// --- Hero: H1 + search bar + filter-row slot ---
export function SearchHero({
  title,
  placeholder,
  query,
  onQueryChange,
  onSubmit,
  variant,
  onFindByAddress,
  helper,
  filters,
}: {
  title: string;
  placeholder: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  variant: 'bills' | 'legislators';
  onFindByAddress?: () => void;
  /** Optional helper line below the field (e.g. bills' "match every word" hint). */
  helper?: ReactNode;
  filters: ReactNode;
}) {
  const { isMobile } = useResponsive();
  const { focused, focusProps } = useFieldFocus();

  const findByAddress =
    variant === 'legislators' && onFindByAddress ? (
      <FindByAddressLink onPress={onFindByAddress} />
    ) : null;

  return (
    <View>
      <View style={styles.heroTitleRow}>
        <Text accessibilityRole="header" style={[styles.heroH1, isMobile && styles.heroH1Mobile]}>
          {title}
        </Text>
      </View>

      {/* SEARCH BAR — purple focus ring via fieldFocus. */}
      <View style={[styles.searchBarWrap, isMobile && styles.searchBarWrapMobile]}>
        <View
          style={[
            styles.searchBar,
            isMobile && styles.searchBarMobile,
            isWeb ? (styles.searchBarShadowWeb as object) : null,
            ...fieldFocusRing(focused),
          ]}
        >
          <Search size={22} color={t.colors.text.faint} strokeWidth={2} />
          <TextInput
            // The descriptive placeholder is the field's accessible name.
            value={query}
            onChangeText={onQueryChange}
            onFocus={focusProps.onFocus}
            onBlur={focusProps.onBlur}
            onSubmitEditing={onSubmit}
            returnKeyType="search"
            placeholder={placeholder}
            placeholderTextColor={t.colors.text.faint}
            style={[styles.searchInput, fieldOutlineReset]}
          />
          {!isMobile ? findByAddress : null}
          {!isMobile ? <HeroSearchButton onPress={onSubmit} /> : null}
        </View>
        {isMobile ? (
          <View style={styles.searchBarMobileActions}>
            {findByAddress}
            <HeroSearchButton onPress={onSubmit} full />
          </View>
        ) : null}
      </View>

      {helper ? <View style={styles.helperRow}>{helper}</View> : null}

      <View style={styles.filterSlot}>{filters}</View>
    </View>
  );
}

// Bills' search helper line: "Results update as you type. Bills match every word
// — try a keyword or a bill number." ("every" bold, per the v2 spec §A.)
export function SearchHelperLine() {
  return (
    <Text style={styles.helperText}>
      Results update as you type. Bills match <Text style={styles.helperStrong}>every</Text> word —
      try a keyword or a bill number.
    </Text>
  );
}

function FindByAddressLink({ onPress }: { onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} {...hover} style={styles.findByAddress}>
      <MapPin size={16} color={hovered ? t.colors.brand.deep : '#4b524b'} strokeWidth={2} />
      <Text style={[styles.findByAddressText, hovered && { color: t.colors.brand.deep }]}>
        Find by address
      </Text>
    </Pressable>
  );
}

function HeroSearchButton({ onPress, full }: { onPress: () => void; full?: boolean }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...hover}
      style={[
        styles.searchButton,
        full && styles.searchButtonFull,
        { backgroundColor: hovered ? t.colors.brand.hover : t.colors.brand.base },
      ]}
    >
      <Text style={styles.searchButtonText}>Search</Text>
    </Pressable>
  );
}

// --- Chamber segmented control (All · House · Senate) ---
export function ChamberSegmented({
  value,
  onChange,
  onHoverOption,
}: {
  value: ChamberFilter;
  onChange: (value: ChamberFilter) => void;
  /** Fires on hover of a chamber option — used to prefetch its filtered list. */
  onHoverOption?: (value: ChamberFilter) => void;
}) {
  return (
    <View style={styles.segmented}>
      {(['All', 'House', 'Senate'] as ChamberFilter[]).map((option) => {
        const active = value === option;
        return (
          <SegmentButton
            key={option}
            label={option}
            active={active}
            onPress={() => onChange(option)}
            onHoverIn={onHoverOption ? () => onHoverOption(option) : undefined}
          />
        );
      })}
    </View>
  );
}

function SegmentButton({
  label,
  active,
  onPress,
  onHoverIn,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  /** Fires the prefetch on hover (web) and touch-down (mobile — see onPressIn). */
  onHoverIn?: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      {...hover}
      onHoverIn={() => {
        hover.onHoverIn();
        onHoverIn?.();
      }}
      // Touch has no hover, so fire the same prefetch on touch-down (~100–200ms
      // before onPress completes) — the subsequent tap is a cache hit on mobile
      // too (#517). prefetchQuery honors staleTime, so a preceding hover on
      // desktop makes this a no-op, not a duplicate request.
      onPressIn={onHoverIn}
      style={[styles.segmentBtn, active && styles.segmentBtnActive]}
    >
      <Text
        style={[
          styles.segmentText,
          active ? styles.segmentTextActive : hovered && { color: t.colors.text.primary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// --- Filter dropdown (statuses / parties / session). Closes on outside click
//     via a document pointerdown listener (web) — never a click-away overlay.
//     Open state is optionally controlled so a row of dropdowns can enforce
//     "one open at a time" (opening one closes the others). ---
export function FilterDropdown({
  label,
  options,
  selectedValue,
  onSelect,
  accessibilityLabel,
  active,
  open: controlledOpen,
  onOpenChange,
}: {
  label: string;
  options: Array<{ label: string; value: string }>;
  selectedValue: string;
  onSelect: (value: string) => void;
  accessibilityLabel?: string;
  /** Non-default (actively narrowing) → black fill / white label; default reads
   *  neutral. (v2 spec §B: "non-default controls read black".) */
  active?: boolean;
  /** Controlled open state; omit to let the dropdown manage its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (value: boolean) => {
    if (onOpenChange) onOpenChange(value);
    else setInternalOpen(value);
  };
  const [hovered, hover] = useHover();
  const wrapRef = useRef<unknown>(null);

  useEffect(() => {
    if (!isWeb || !open) return;
    const handlePointerDown = (event: Event) => {
      const node = wrapRef.current as HTMLElement | null;
      const target = event.target as Node | null;
      if (node && target && node.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
    // setOpen is stable enough for this listener; only re-bind when open flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <View ref={wrapRef as never} style={[styles.dropdownWrap, open && styles.dropdownWrapOpen]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        {...hover}
        style={[
          styles.dropdownTrigger,
          active && styles.dropdownTriggerActive,
          !active && (hovered || open) && styles.filterHover,
        ]}
      >
        <Text
          style={[
            styles.dropdownTriggerText,
            active && styles.dropdownTriggerTextActive,
            !active && (hovered || open) && { color: t.colors.brand.deep },
          ]}
        >
          {label}
        </Text>
        <ChevronDown
          size={13}
          color={active ? t.colors.white : hovered || open ? t.colors.brand.deep : '#9aa39e'}
          strokeWidth={2.2}
        />
      </Pressable>
      {open ? (
        <View style={styles.dropdownMenu}>
          {options.map((option) => (
            <DropdownItem
              key={`${option.value}-${option.label}`}
              label={option.label}
              selected={option.value === selectedValue}
              onSelect={() => {
                setOpen(false);
                onSelect(option.value);
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// A single dropdown row. Selected → green-tint fill, green bold label, green
// check. Hovered (non-selected) → same green-tint fill + green label, matching
// the app's green hover accent.
function DropdownItem({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const [hovered, hover] = useHover();
  const highlighted = selected || hovered;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onSelect}
      {...hover}
      style={[styles.dropdownItem, highlighted && styles.dropdownItemHighlight]}
    >
      <Text
        style={[
          styles.dropdownItemText,
          highlighted && styles.dropdownItemTextHighlight,
          selected && styles.dropdownItemTextSelected,
        ]}
      >
        {label}
      </Text>
      {selected ? <Text style={styles.dropdownCheck}>✓</Text> : null}
    </Pressable>
  );
}

// --- Omnibus-only toggle (off white / on green) ---
export function OmnibusToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: value }}
      onPress={() => onChange(!value)}
      {...hover}
      style={[styles.omnibus, value ? styles.omnibusOn : hovered && styles.filterHover]}
    >
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
        <Path
          d="M12 4 v16 M6 8 h12 M7 8 l-3 6 h6 Z M17 8 l-3 6 h6 Z"
          stroke={
            value ? t.colors.brand.darkest : hovered ? t.colors.brand.deep : t.colors.text.primary
          }
          strokeWidth={1.7}
          strokeLinejoin="round"
        />
      </Svg>
      <Text
        style={[
          styles.omnibusText,
          value ? styles.omnibusTextOn : hovered && { color: t.colors.brand.deep },
        ]}
      >
        Omnibus only
      </Text>
    </Pressable>
  );
}

// --- Policy / area filter pill with an optional mono count ---
export function FilterPill({
  label,
  count,
  active,
  onPress,
  onHoverIn,
}: {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
  /** Fires on hover (web) and touch-down (mobile) — prefetches this pill's list. */
  onHoverIn?: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={typeof count === 'number' ? `${label}, ${count} bills` : label}
      onPress={onPress}
      {...hover}
      onHoverIn={() => {
        hover.onHoverIn();
        onHoverIn?.();
      }}
      // Touch has no hover, so fire the same prefetch on touch-down so the tap is
      // a cache hit on mobile too (#517); staleTime dedupes the desktop case.
      onPressIn={onHoverIn}
      style={[styles.pill, active ? styles.pillActive : hovered && styles.filterHover]}
    >
      <Text
        style={[
          styles.pillText,
          active ? styles.pillTextActive : hovered && { color: t.colors.brand.deep },
        ]}
      >
        {label}
      </Text>
      {typeof count === 'number' ? (
        <Text style={[styles.pillCount, active && styles.pillCountActive]}>{count}</Text>
      ) : null}
    </Pressable>
  );
}

/** Toggle at the end of the issue-pill row: reveals the rest of the common
 * issues, or collapses back to the inline set. */
export function MoreIssuesPill({
  expanded,
  hiddenCount,
  onPress,
}: {
  expanded: boolean;
  hiddenCount: number;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Show fewer issues' : `Show ${hiddenCount} more issues`}
      onPress={onPress}
      {...hover}
      style={[styles.morePill, hovered && styles.filterHover]}
    >
      <Text style={styles.morePillText}>{expanded ? 'Show fewer' : `+${hiddenCount} more`}</Text>
    </Pressable>
  );
}

// --- Results header: count + noun + plain-English filter description, plus the
//     "AS OF {date}" meta and the interactive sort control. ---
export function ResultsHeader({
  count,
  noun,
  description,
  dataAsOf,
  sortControl,
  sortLabel,
}: {
  count: number;
  noun: string;
  /** Plain-English description of the active filter intersection (v2 §E). */
  description?: string;
  dataAsOf: string | null | undefined;
  /** Interactive sort control (Search Bills v2). Takes precedence over sortLabel. */
  sortControl?: ReactNode;
  /** Static "Sorted by …" label — the fallback for screens with no sort control
   *  yet (Search Legislators). Omit both to hide the meta row (e.g. no results). */
  sortLabel?: string;
}) {
  const asOf = formatAsOf(dataAsOf);
  const meta = sortControl ?? (sortLabel ? <StaticSortLabel label={sortLabel} /> : null);
  return (
    <View style={styles.resultsHeader}>
      <View style={styles.resultsHeaderMain}>
        <View style={styles.resultsCountRow}>
          <Text style={styles.resultsCount}>{count.toLocaleString('en-US')}</Text>
          <Text style={styles.resultsNoun}>{noun}</Text>
        </View>
        {description ? <Text style={styles.resultsDescription}>{description}</Text> : null}
      </View>
      {meta ? (
        <View style={styles.resultsMetaRow}>
          {asOf ? <Text style={styles.asOfText}>{asOf}</Text> : null}
          {meta}
        </View>
      ) : null}
    </View>
  );
}

function StaticSortLabel({ label }: { label: string }) {
  return (
    <View style={styles.sortRow}>
      <SortIcon />
      <Text style={styles.sortText}>{label}</Text>
    </View>
  );
}

// --- Sort control: menu of orderings. "Most tracked" is a roadmap option —
//     shown once, inert, labeled "ON THE ROADMAP" (never selectable). Closes on
//     outside click via a document listener (web), never a click-away overlay. ---
export type SortOption = {
  key: string;
  label: string;
  /** Roadmap-only: rendered inert with an "ON THE ROADMAP" tag. */
  roadmap?: boolean;
};

export function SortControl({
  options,
  value,
  onSelect,
  open,
  onOpenChange,
}: {
  options: SortOption[];
  value: string;
  onSelect: (key: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [hovered, hover] = useHover();
  const wrapRef = useRef<unknown>(null);
  const current = options.find((option) => option.key === value) ?? options[0];

  useEffect(() => {
    if (!isWeb || !open) return;
    const handlePointerDown = (event: Event) => {
      const node = wrapRef.current as HTMLElement | null;
      const target = event.target as Node | null;
      if (node && target && node.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <View ref={wrapRef as never} style={styles.sortWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sort results"
        accessibilityState={{ expanded: open }}
        onPress={() => onOpenChange(!open)}
        {...hover}
        style={[styles.sortTrigger, (hovered || open) && styles.filterHover]}
      >
        <SortIcon />
        <Text style={[styles.sortText, (hovered || open) && { color: t.colors.brand.deep }]}>
          Sorted by {(current?.label ?? '').toLowerCase()}
        </Text>
        <ChevronDown
          size={13}
          color={hovered || open ? t.colors.brand.deep : '#6f756f'}
          strokeWidth={2.2}
        />
      </Pressable>
      {open ? (
        <View style={styles.sortMenu}>
          {options.map((option) => (
            <SortMenuItem
              key={option.key}
              option={option}
              selected={!option.roadmap && option.key === value}
              onSelect={() => {
                if (option.roadmap) return;
                onOpenChange(false);
                onSelect(option.key);
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SortMenuItem({
  option,
  selected,
  onSelect,
}: {
  option: SortOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const [hovered, hover] = useHover();
  if (option.roadmap) {
    return (
      <View style={styles.sortItemRoadmap}>
        <Text style={styles.sortItemRoadmapText}>{option.label}</Text>
        <View style={styles.roadmapTag}>
          <Text style={styles.roadmapTagText}>ON THE ROADMAP</Text>
        </View>
      </View>
    );
  }
  const highlighted = selected || hovered;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onSelect}
      {...hover}
      style={[styles.sortItem, highlighted && styles.sortItemHighlight]}
    >
      <Text style={[styles.sortItemText, selected && styles.sortItemTextSelected]}>
        {option.label}
      </Text>
      {selected ? <Text style={styles.dropdownCheck}>✓</Text> : null}
    </Pressable>
  );
}

// --- Active-filter chip row (v2 §D): mono "FILTERS" eyebrow + removable,
//     facet-color-coded chips + a "Clear all" that keeps the session. ---
export type FacetTone = 'keyword' | 'chamber' | 'status' | 'session' | 'omnibus' | 'issue';

export type FilterChip = {
  /** Stable key (facet + value). */
  key: string;
  tone: FacetTone;
  label: string;
  removeLabel: string;
  onRemove: () => void;
};

export function FilterChipRow({
  chips,
  onClearAll,
}: {
  chips: FilterChip[];
  onClearAll: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <View style={styles.chipRow}>
      <FilterEyebrow label="FILTERS" />
      {chips.map((chip) => (
        <ActiveFilterChip key={chip.key} chip={chip} />
      ))}
      <ClearAllButton onPress={onClearAll} />
    </View>
  );
}

// Mono eyebrow shared by the FILTERS chip row and the ISSUES pill row.
export function FilterEyebrow({ label }: { label: string }) {
  return <Text style={styles.filterEyebrow}>{label}</Text>;
}

const CHIP_TONES: Record<FacetTone, { bg: string; border: string; text: string }> = {
  keyword: { bg: '#eef0f2', border: '#d5dade', text: '#3f4650' },
  chamber: { bg: '#e9f0fb', border: '#cadcf3', text: '#345880' },
  status: { bg: '#e7f3f1', border: '#c3e3dd', text: '#2c6f66' },
  session: { bg: '#eeecfb', border: '#d7d0f4', text: '#4b3fa8' },
  // Filled soft amber here (no code badge in this row to disambiguate from);
  // ghosted amber stays on the bill cards (amber = code/omnibus identity). Uses
  // the shared omnibus token (not a hardcoded hex) so it matches the code badge
  // and inherits the AA-safe text color (#8f5a12, 5.2:1 — the raw #a76a1a from
  // the mockup is 3.98:1 and fails AA).
  omnibus: {
    bg: t.colors.omnibus.fill,
    border: t.colors.omnibus.border,
    text: t.colors.omnibus.text,
  },
  issue: { bg: '#e6f2f6', border: '#c2e0ea', text: '#2b6377' },
};

function ActiveFilterChip({ chip }: { chip: FilterChip }) {
  const [hovered, hover] = useHover();
  const tone = CHIP_TONES[chip.tone];
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
      <Text style={[styles.chipLabel, { color: tone.text }]}>{chip.label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={chip.removeLabel}
        onPress={chip.onRemove}
        {...hover}
        style={[styles.chipRemove, hovered && styles.chipRemoveHover]}
      >
        <X size={11} color={tone.text} strokeWidth={2.6} />
      </Pressable>
    </View>
  );
}

function ClearAllButton({ onPress }: { onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Clear all filters"
      onPress={onPress}
      {...hover}
      style={styles.clearAllBtn}
    >
      <X
        size={13}
        color={hovered ? t.colors.text.primary : t.colors.text.secondary}
        strokeWidth={2.2}
      />
      <Text style={[styles.clearAllText, hovered && { color: t.colors.text.primary }]}>
        Clear all
      </Text>
    </Pressable>
  );
}

function SortIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 5 V19 M7 19 L3.5 15.5 M7 19 L10.5 15.5 M15 5 h6 M15 10 h5 M15 15 h4"
        stroke="#9aa39e"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// --- Empty state: dashed card, active-filter chips (bills), black Clear button ---
export function NoResults({
  variant,
  total,
  activeFilters,
  onClear,
}: {
  variant: 'bills' | 'legislators';
  total?: number | null;
  activeFilters?: string[];
  onClear: () => void;
}) {
  const noun = variant === 'bills' ? 'bills' : 'legislators';
  const heading =
    variant === 'bills' ? 'No bills match your search' : 'No legislators match your search';
  const body =
    typeof total === 'number'
      ? `Your filters returned 0 of ${total.toLocaleString('en-US')} ${noun}. Try broadening or clearing them.`
      : 'Try broadening or clearing them.';
  return (
    <View style={styles.noResults}>
      <View style={styles.noResultsIcon}>
        <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
          {variant === 'bills' ? (
            <>
              <Circle cx={11} cy={11} r={7} stroke="#9aa39e" strokeWidth={2} />
              <Path d="M16.5 16.5 L21 21" stroke="#9aa39e" strokeWidth={2} strokeLinecap="round" />
            </>
          ) : (
            <>
              <Circle cx={12} cy={8} r={3.4} stroke="#9aa39e" strokeWidth={2} />
              <Path
                d="M5 20 a7 7 0 0 1 14 0"
                stroke="#9aa39e"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </>
          )}
        </Svg>
      </View>
      <Text accessibilityRole="header" style={styles.noResultsHeading}>
        {heading}
      </Text>
      <Text style={styles.noResultsBody}>{body}</Text>
      {activeFilters && activeFilters.length > 0 ? (
        <View style={styles.noResultsChips}>
          {activeFilters.map((filter) => (
            <View key={filter} style={styles.noResultsChip}>
              <Text style={styles.noResultsChipText}>{filter}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <ClearFiltersButton onPress={onClear} />
    </View>
  );
}

function ClearFiltersButton({ onPress }: { onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...hover}
      style={[styles.clearBtn, hovered && { backgroundColor: '#000000' }]}
    >
      <X size={15} color={t.colors.white} strokeWidth={2.2} />
      <Text style={styles.clearBtnText}>Clear filters</Text>
    </Pressable>
  );
}

// --- Pagination (Previous · Page N of M · Next) ---
export function Pagination({
  page,
  totalPages,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages?: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (!hasPrev && !hasNext) return null;
  return (
    <View style={styles.pagination}>
      <PageButton direction="prev" disabled={!hasPrev} onPress={onPrev} />
      <Text style={styles.pageLabel}>
        Page <Text style={styles.pageLabelNum}>{page}</Text>
        {typeof totalPages === 'number' ? ` of ${totalPages}` : ''}
      </Text>
      <PageButton direction="next" disabled={!hasNext} onPress={onNext} />
    </View>
  );
}

function PageButton({
  direction,
  disabled,
  onPress,
}: {
  direction: 'prev' | 'next';
  disabled: boolean;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  const color = disabled
    ? t.colors.borders.strong
    : hovered
      ? t.colors.brand.deep
      : t.colors.text.primary;
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={direction === 'prev' ? 'Previous page' : 'Next page'}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      {...hover}
      style={[styles.pageBtn, disabled ? styles.pageBtnDisabled : hovered && styles.pageBtnHover]}
    >
      {direction === 'prev' ? <Icon size={15} color={color} strokeWidth={2.2} /> : null}
      <Text style={[styles.pageBtnText, { color }]}>
        {direction === 'prev' ? 'Previous' : 'Next'}
      </Text>
      {direction === 'next' ? <Icon size={15} color={color} strokeWidth={2.2} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // scaffold
  root: { flex: 1, position: 'relative' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 0 },
  heroWrap: { position: 'relative', zIndex: 2 },
  heroBody: { paddingTop: 36, paddingBottom: 44 },
  resultsSection: {
    backgroundColor: t.colors.surfaces.base,
    paddingTop: 40,
    paddingBottom: 64,
    zIndex: 1,
  },

  // hero
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 22,
  },
  heroH1: {
    fontFamily: t.typography.title,
    fontSize: 58,
    lineHeight: 58,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1.16,
    color: t.colors.text.primary,
  },
  heroH1Mobile: { fontSize: 40, lineHeight: 42, letterSpacing: -0.8 },

  searchBarWrap: { marginTop: 28 },
  searchBarWrapMobile: { gap: 12 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 14,
    paddingVertical: 6,
    paddingRight: 6,
    paddingLeft: 24,
  },
  searchBarMobile: { paddingRight: 16 },
  searchBarShadowWeb: { boxShadow: '0 12px 34px rgba(17,21,15,0.07)' },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subhead,
    color: t.colors.text.primary,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  searchBarMobileActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  findByAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    minHeight: 44,
  },
  findByAddressText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    color: '#4b524b',
  },
  searchButton: {
    borderRadius: 11,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonFull: { flex: 1 },
  searchButtonText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.lg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.darkest,
  },
  filterSlot: { marginTop: 22, gap: 14 },
  helperRow: { marginTop: 10, paddingHorizontal: 2 },
  helperText: {
    fontFamily: t.typography.body,
    fontSize: 14,
    // #6f756f (the site's AA-safe muted grey on WHITE, 4.7:1) dips to 4.3:1 on
    // the hero's faintly-tinted gradient — below AA. #686e68 is a hair darker
    // and clears AA on the darkest gradient stop (4.8:1) while reading identically.
    color: '#686e68',
  },
  helperStrong: { color: '#4f5651', fontWeight: t.fontWeights.bold },

  // shared filter-control hover
  filterHover: { borderColor: t.colors.brand.base },

  // mono eyebrow (ISSUES / FILTERS row labels)
  filterEyebrow: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: '#6f756f',
  },

  // chamber segmented
  segmented: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
    backgroundColor: '#eef0f1',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
  },
  segmentBtn: {
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 20,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: { backgroundColor: t.colors.ink },
  segmentText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  segmentTextActive: { color: t.colors.white, fontWeight: t.fontWeights.bold },

  // dropdown
  dropdownWrap: { position: 'relative', zIndex: 30 },
  // An open dropdown outranks its sibling filter controls (the other dropdown,
  // segmented control, omnibus toggle) so its menu is never painted behind them.
  dropdownWrapOpen: { zIndex: 100 },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 18,
    minHeight: 44,
  },
  // Non-default (actively narrowing) dropdown: black fill / white label, matching
  // the chamber-active and omnibus-on controls (v2 spec §B).
  dropdownTriggerActive: { backgroundColor: t.colors.ink, borderColor: t.colors.ink },
  dropdownTriggerText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  dropdownTriggerTextActive: { color: t.colors.white, fontWeight: t.fontWeights.bold },
  dropdownMenu: {
    position: 'absolute',
    top: 50,
    left: 0,
    minWidth: 240,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 12,
    paddingVertical: 6,
    zIndex: 50,
    ...(t.shadows.panel as object),
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
    minHeight: 44,
  },
  // #f1faf4 is the design's green-tint row fill (per the .dc.html ref); the
  // nearest token is greenTint50 (#f2f9f5), close but not exact.
  dropdownItemHighlight: { backgroundColor: '#f1faf4' },
  dropdownItemText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.primary,
  },
  dropdownItemTextHighlight: { color: t.colors.brand.deep },
  dropdownItemTextSelected: { fontWeight: t.fontWeights.bold },
  dropdownCheck: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },

  // omnibus
  omnibus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 18,
    minHeight: 44,
  },
  omnibusOn: { backgroundColor: t.colors.brand.base, borderColor: t.colors.brand.base },
  omnibusText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  omnibusTextOn: { color: t.colors.brand.darkest, fontWeight: t.fontWeights.bold },

  // policy pill
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 15,
    minHeight: 40,
  },
  pillActive: { backgroundColor: t.colors.brand.base, borderColor: t.colors.brand.base },
  pillText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  pillTextActive: { color: t.colors.brand.darkest, fontWeight: t.fontWeights.bold },
  pillCount: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.faint,
  },
  pillCountActive: { color: '#0b7a45' },
  morePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: t.colors.brand.base,
    borderStyle: 'dashed',
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 15,
    minHeight: 40,
  },
  morePillText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.brand.deep,
  },

  // results header
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 20,
    paddingBottom: 22,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.09)',
  },
  resultsHeaderMain: { minWidth: 0, flexShrink: 1, gap: 6 },
  resultsCountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  resultsCount: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h2,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.25,
    color: t.colors.text.primary,
  },
  resultsNoun: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.muted,
  },
  resultsDescription: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: '#6f756f',
    maxWidth: 900,
  },
  // flexShrink + maxWidth keep the meta row inside the viewport on mobile so the
  // "AS OF …" stamp and the sort control wrap onto separate lines instead of the
  // control overflowing (and being clipped) off the right edge.
  resultsMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 18,
    flexShrink: 1,
    maxWidth: '100%',
  },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sortText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  asOfText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    letterSpacing: 0.6,
    color: t.colors.text.faint,
  },

  // sort control (trigger + menu)
  sortWrap: { position: 'relative', zIndex: 40 },
  sortTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minHeight: 44,
  },
  sortMenu: {
    position: 'absolute',
    top: 52,
    right: 0,
    minWidth: 250,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink12,
    borderRadius: 12,
    padding: 6,
    zIndex: 1,
    ...(t.shadows.panel as object),
  },
  sortItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    minHeight: 42,
  },
  sortItemHighlight: { backgroundColor: '#f2f3f5' },
  sortItemText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.primary,
  },
  sortItemTextSelected: { fontWeight: t.fontWeights.bold },
  sortItemRoadmap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    minHeight: 42,
  },
  sortItemRoadmapText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.medium,
    color: '#6f756f',
  },
  roadmapTag: {
    borderWidth: 1,
    borderColor: t.colors.alpha.ink20,
    borderStyle: 'dashed',
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  roadmapTagText: {
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: '#6f756f',
  },

  // active-filter chip row
  chipRow: {
    marginBottom: 22,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 8,
    maxWidth: '100%',
  },
  chipLabel: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.semibold,
    flexShrink: 1,
  },
  chipRemove: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,21,15,0.06)',
  },
  chipRemoveHover: { backgroundColor: 'rgba(17,21,15,0.14)' },
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  clearAllText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },

  // no results
  noResults: {
    maxWidth: 860,
    width: '100%',
    alignSelf: 'center',
    marginTop: 34,
    alignItems: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.alpha.ink20,
    borderRadius: 20,
    paddingVertical: 64,
    paddingHorizontal: 48,
  },
  noResultsIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: t.colors.surfaces.s400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noResultsHeading: {
    marginTop: 22,
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h1,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.28,
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  noResultsBody: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    lineHeight: 25,
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  noResultsChips: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  noResultsChip: {
    backgroundColor: '#f6f8f7',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink12,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  noResultsChipText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  clearBtn: {
    marginTop: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: t.colors.ink,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 26,
  },
  clearBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.white,
  },

  // pagination
  pagination: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  pageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink20,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 22,
    minHeight: 44,
  },
  pageBtnHover: { borderColor: t.colors.brand.base },
  pageBtnDisabled: { borderColor: t.colors.alpha.ink12 },
  pageBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
  },
  pageLabel: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  pageLabelNum: { fontWeight: t.fontWeights.heavy, color: t.colors.text.primary },
});
