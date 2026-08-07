import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { ChevronDown, ChevronLeft, ChevronRight, Search, X } from '../icons';

import { theme } from '../../theme/tokens';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { useResponsive } from '../../hooks/useResponsive';
import { IaItem, MenuKey } from '../../navigation/ia';
import {
  LEGISLATOR_ROSTER_NOTE_TEXT,
  LEGISLATOR_SEAT_SOURCE_TEXT,
  LEGISLATOR_SEAT_SOURCE_URL,
} from '../../lib/legislatorRosterHeader';
import { CLEAR_SEARCH_TARGET_SIZE } from '../../lib/legislatorSearch';
import { useUnavailableControl } from '../billDetail/interactions';

// Shared building blocks for the redesigned Search Bills / Search Legislators
// screens (docs/mockups/search-bills + search-legislators). The two screens
// compose these; the per-page cards live in BillResultCard/LegislatorResultCard.
// High-fidelity: literal hex/px come from the .dc.html references.

const isWeb = Platform.OS === 'web';
const t = theme;

export type ChamberFilter = 'All' | 'House' | 'Senate';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-03-21" -> "as of Mar 21, 2026". Ordinary prose that trails the unit noun
// on the count line — it replaced a standalone uppercase mono "AS OF …" stamp.
// Returns null for a missing/unparseable value so the phrase is simply omitted.
function formatAsOf(dataAsOf: string | null | undefined): string | null {
  if (!dataAsOf) return null;
  const match = dataAsOf.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return `as of ${MONTHS[monthIndex]} ${Number(day)}, ${year}`;
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
  onPrivacy,
  onTerms,
  heroEndsWithRule,
}: {
  hero: ReactNode;
  children: ReactNode;
  /** Modal/toast overlays, rendered outside the scroll so they stay pinned. */
  overlay?: ReactNode;
  openMenu: MenuKey | null;
  onOpenMenuChange: (menu: MenuKey | null) => void;
  onNavigate: (item: IaItem) => void;
  onHome?: () => void;
  onPrivacy?: () => void;
  onTerms?: () => void;
  /**
   * The hero's last element is already a full-width rule (the bill page's tab
   * bar). Drop the hero's own bottom padding so the gap below that rule is the
   * white panel's 40px top padding and nothing else — left stacked, the two make
   * ~84px and the body reads as detached from the tabs it belongs to.
   */
  heroEndsWithRule?: boolean;
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
              openMenu={openMenu}
              onOpenMenuChange={onOpenMenuChange}
              onNavigate={onNavigate}
              onHome={onHome}
            />

            <Container style={[styles.heroBody, heroEndsWithRule && styles.heroBodyFlush]}>
              {hero}
            </Container>
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
  onClear,
  onSubmit,
  variant,
  helper,
  filters,
}: {
  title: string;
  placeholder: string;
  query: string;
  onQueryChange: (value: string) => void;
  /** Optional immediate clear handler for a screen that owns URL search state. */
  onClear?: () => void;
  onSubmit: () => void;
  variant: 'bills' | 'legislators';
  /** Optional helper line below the field (e.g. bills' "match every word" hint). */
  helper?: ReactNode;
  filters: ReactNode;
}) {
  const { isMobile } = useResponsive();
  const { focused, focusProps } = useFieldFocus();

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
            accessibilityLabel={placeholder}
            placeholderTextColor={t.colors.text.faint}
            style={[styles.searchInput, isMobile && styles.searchInputMobile, fieldOutlineReset]}
          />
          {query.length > 0 ? (
            <ClearFieldButton onPress={onClear ?? (() => onQueryChange(''))} />
          ) : null}
        </View>
      </View>

      {helper ? <View style={styles.helperRow}>{helper}</View> : null}

      <View style={styles.filterSlot}>{filters}</View>
    </View>
  );
}

// Bills' search helper line: "Results update as you type — bills match every
// word" ("every" bold, no terminal period). One line, and no "try a keyword or a
// bill number" tail — the field's own placeholder ("Search by keyword or bill
// number") already says that directly above it.
export function SearchHelperLine() {
  const { isMobile } = useResponsive();
  return (
    <Text style={[styles.helperText, isMobile && styles.helperTextMobile]}>
      Results update as you type — bills match <Text style={styles.helperStrong}>every</Text> word
    </Text>
  );
}

// Clear (×) button inside the as-you-type search field — appears only when the
// field has text and empties it. A bare ink glyph inset from the right edge to
// mirror the leading magnifier; a neutral circle fades in on hover. The 44px
// pressable is an invisible hit cushion around the small glyph, and the app-wide
// :focus-visible ring (App.tsx) shows keyboard focus, rounded to the pill.
function ClearFieldButton({ onPress }: { onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Clear search"
      onPress={onPress}
      {...hover}
      style={styles.clearField}
    >
      <View style={[styles.clearFieldGlyph, hovered && styles.clearFieldGlyphLit]}>
        <X size={16} color={hovered ? t.colors.text.primary : '#4f5651'} strokeWidth={2.4} />
      </View>
    </Pressable>
  );
}

// --- Chamber segmented control (All · House · Senate) ---
export function ChamberSegmented({
  value,
  onChange,
  onHoverOption,
  counts,
}: {
  value: ChamberFilter;
  onChange: (value: ChamberFilter) => void;
  /** Fires on hover of a chamber option — used to prefetch its filtered list. */
  onHoverOption?: (value: ChamberFilter) => void;
  /** Officeholder totals for a roster. Omit on pages whose chamber control has no counts. */
  counts?: Record<ChamberFilter, number>;
}) {
  return (
    <View style={styles.segmented}>
      {(['All', 'House', 'Senate'] as ChamberFilter[]).map((option) => {
        const active = value === option;
        return (
          <SegmentButton
            key={option}
            label={option}
            count={counts?.[option]}
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
  count,
  active,
  onPress,
  onHoverIn,
}: {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
  /** Fires the prefetch on hover (web) and touch-down (mobile — see onPressIn). */
  onHoverIn?: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      aria-pressed={active}
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
      {typeof count === 'number' ? (
        <Text style={[styles.segmentCount, active && styles.segmentCountActive]}>{count}</Text>
      ) : null}
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
  options: Array<{ label: string; value: string; disabled?: boolean }>;
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
    <View ref={wrapRef as never} style={styles.dropdownWrap}>
      <Pressable
        accessibilityRole="button"
        // `label` IS the current choice ("All statuses", "2025–2026"), but an
        // accessibilityLabel REPLACES the visible text for a screen reader rather
        // than adding to it — measured: the computed name came back "Filter by
        // status" while the button read "All statuses", so the current filter was
        // announced nowhere. Name the facet and its value together.
        accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}: ${label}` : label}
        // `aria-expanded` as a real prop, not accessibilityState — the state object
        // renders nothing on RN-Web, so until now this trigger announced no open or
        // closed state at all (#1025). The plain aria prop is forwarded on both
        // platforms, so nothing else is needed.
        aria-expanded={open}
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
            !active && (hovered || open) && { color: t.colors.purple.base },
          ]}
        >
          {label}
        </Text>
        <ChevronDown size={13} color={active ? t.colors.white : '#6f756f'} strokeWidth={2.2} />
      </Pressable>
      {open ? (
        // A group of buttons, deliberately not an ARIA menu — see the note above
        // DropdownItem. Same `role="group"` the active-filter chip row uses.
        <View
          role="group"
          accessibilityLabel={accessibilityLabel ?? label}
          style={styles.dropdownMenu}
        >
          {options.map((option) => (
            <DropdownItem
              key={`${option.value}-${option.label}`}
              label={option.label}
              selected={option.value === selectedValue}
              disabled={option.disabled}
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

// A single dropdown row. Selected → neutral grey fill (#f2f3f5), dark bold label,
// black check. Hovered (non-selected) → same neutral fill. (v2 spec §B: the menu
// uses black/neutral, never green — green is reserved for "action".) A `disabled`
// row (e.g. a not-yet-loaded prior session) reads muted grey and is inert: no
// hover, no press, no check.
//
// These rows are buttons, NOT `menuitem`s, and that is a decision rather than an
// oversight (#1025). An ARIA menu is a promise of a keyboard contract — arrow keys
// to move between items, Home/End, one tab stop for the whole menu — and none of
// that is built here. Claiming the role without the behaviour tells a reader the
// menu works in a way it does not, which is the thing this product refuses to do
// (docs/philosophy.md principle 4, say only what we can do). So: the trigger is a
// disclosure that reports whether it is open, the popover is a labelled group, and
// each row is an ordinary button — every one of which is true.
function DropdownItem({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const [hovered, hover] = useHover();
  const unavailableRef = useUnavailableControl(Boolean(disabled));
  if (disabled) {
    return (
      <View
        // A View has no `disabled` prop, so accessibilityState is all there was — and on
        // RN-Web it renders nothing, leaving this row announcing as a choice the reader
        // could make (#1025). The ref is what actually marks it. Not busy: nothing is
        // in flight, this option simply is not built yet.
        ref={unavailableRef}
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        style={styles.dropdownItem}
      >
        <Text style={[styles.dropdownItemText, styles.dropdownItemTextDisabled]}>{label}</Text>
      </View>
    );
  }
  const highlighted = selected || hovered;
  return (
    <Pressable
      accessibilityRole="button"
      // Not `aria-selected`: that is only meaningful inside a listbox, and this is a
      // labelled group of buttons (#1037 kept it that way rather than claim an ARIA
      // menu's keyboard contract). `aria-current` says which one is chosen and
      // promises nothing about arrow keys.
      aria-current={selected ? 'true' : undefined}
      onPress={onSelect}
      {...hover}
      style={[styles.dropdownItem, highlighted && styles.dropdownItemHighlight]}
    >
      <Text style={[styles.dropdownItemText, selected && styles.dropdownItemTextSelected]}>
        {label}
      </Text>
      {/* Hidden from assistive tech: measured, the glyph lands in the computed
          accessible name ("All statuses ✓"), where a screen reader reads it out as
          "check mark". `aria-current` above already says this is the chosen one. */}
      {selected ? (
        <Text aria-hidden style={styles.dropdownCheck}>
          ✓
        </Text>
      ) : null}
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
      aria-pressed={value}
      onPress={() => onChange(!value)}
      {...hover}
      style={[styles.omnibus, value ? styles.omnibusOn : hovered && styles.filterHover]}
    >
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
        <Path
          d="M12 4 v16 M6 8 h12 M7 8 l-3 6 h6 Z M17 8 l-3 6 h6 Z"
          stroke={value ? t.colors.white : hovered ? t.colors.purple.base : t.colors.text.primary}
          strokeWidth={1.7}
          strokeLinejoin="round"
        />
      </Svg>
      <Text
        style={[
          styles.omnibusText,
          value ? styles.omnibusTextOn : hovered && { color: t.colors.purple.base },
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
      aria-pressed={active}
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
          active ? styles.pillTextActive : hovered && { color: t.colors.purple.base },
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
      style={[styles.morePill, hovered && styles.morePillHover]}
    >
      <Text style={styles.morePillText}>{expanded ? 'Show fewer' : `+${hiddenCount} more`}</Text>
    </Pressable>
  );
}

// --- Results header: one prose count line ("10,000 bills as of Mar 21, 2026")
//     plus the sort control. There is deliberately no prose description of the
//     active facets — the removable chip row above already names every one of
//     them, and its closing session clause duplicated the session dropdown that
//     is always visible in the filter controls. ---
export function ResultsHeader({
  count,
  noun,
  dataAsOf,
  sortControl,
  sortLabel,
  countTail,
  nativeID,
  uniformDetails = false,
  showRosterNote = false,
  showRule = true,
}: {
  count: number;
  /** Singular unit noun ("bill"); pluralized unless the count is exactly 1. */
  noun: string;
  dataAsOf: string | null | undefined;
  /** Interactive sort control (Search Bills v2). Takes precedence over sortLabel. */
  sortControl?: ReactNode;
  /** Static "Sorted by …" label — the fallback for screens with no sort control
   *  yet (Search Legislators). Omit both to hide the meta row (e.g. no results). */
  sortLabel?: string;
  /** Extra count words or a matched-value chip, kept inside the shared count row. */
  countTail?: ReactNode;
  /** Scroll anchor for pagination (usePaginatedListScroll): a page change lands
   *  this count/sort row at the top of the viewport, first card just beneath it. */
  nativeID?: string;
  /** Keep the noun and date in one 17px muted run, as used by Search Legislators. */
  uniformDetails?: boolean;
  /** Show the static seat clarification beneath a complete current roster count. */
  showRosterNote?: boolean;
  /** Issue answers let the first card supply the next edge instead. */
  showRule?: boolean;
}) {
  const { isMobile } = useResponsive();
  const asOf = formatAsOf(dataAsOf);
  const unit = count === 1 ? noun : `${noun}s`;
  const meta = sortControl ?? (sortLabel ? <StaticSortLabel label={sortLabel} /> : null);
  return (
    <View
      nativeID={nativeID}
      style={[
        styles.resultsHeader,
        !showRule && styles.resultsHeaderNoRule,
        isMobile && styles.resultsHeaderMobile,
      ]}
    >
      <View style={[styles.resultsHeaderMain, isMobile && styles.resultsHeaderMainMobile]}>
        <View style={[styles.resultsCountRow, isMobile && styles.resultsCountRowMobile]}>
          <Text style={[styles.resultsCount, isMobile && styles.resultsCountMobile]}>
            {count.toLocaleString('en-US')}
          </Text>
          {/* The date is nested INSIDE the unit-noun span, one word space apart. A
              third flex child would inherit the row's gap and read as a double
              space; a middot or any other separator glyph is wrong here. */}
          {uniformDetails ? (
            <Text style={styles.resultsNoun}>{asOf ? `${unit} ${asOf}` : unit}</Text>
          ) : (
            <Text style={[styles.resultsNoun, isMobile && styles.resultsNounMobile]}>
              {asOf ? `${unit} ` : unit}
              {asOf ? (
                <Text style={[styles.resultsAsOf, isMobile && styles.resultsAsOfMobile]}>
                  {asOf}
                </Text>
              ) : null}
            </Text>
          )}
          {countTail}
        </View>
        {showRosterNote ? <RosterCountNote /> : null}
      </View>
      {meta ? (
        <View style={[styles.resultsMetaRow, isMobile && styles.resultsMetaRowMobile]}>{meta}</View>
      ) : null}
    </View>
  );
}

function RosterCountNote() {
  const [hovered, hover] = useHover();
  const sourceProps = isWeb
    ? {
        accessibilityRole: 'link' as const,
        href: LEGISLATOR_SEAT_SOURCE_URL,
        hrefAttrs: { target: '_blank' as const, rel: 'noopener' },
      }
    : {
        accessibilityRole: 'link' as const,
        onPress: () => void Linking.openURL(LEGISLATOR_SEAT_SOURCE_URL),
      };

  return (
    <Text style={styles.rosterCountNote}>
      <Text
        {...sourceProps}
        {...hover}
        style={[styles.rosterCountNoteLink, hovered && styles.rosterCountNoteLinkHover]}
      >
        {LEGISLATOR_SEAT_SOURCE_TEXT}
      </Text>{' '}
      {LEGISLATOR_ROSTER_NOTE_TEXT}
    </Text>
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
        // No accessibilityLabel on purpose. It would REPLACE the visible text, and
        // "Sorted by legislative progress" is already a complete, natural name that
        // carries the current sort — the `button` role supplies the rest. A label
        // here only duplicates the word "sort" in something read aloud in full every
        // time. FilterDropdown's trigger is the opposite case and keeps its label,
        // because "All statuses" alone loses the "filter by" context.
        // See FilterDropdown: accessibilityState renders nothing on RN-Web, so the
        // open/closed state has to be the plain aria prop (#1025).
        aria-expanded={open}
        onPress={() => onOpenChange(!open)}
        {...hover}
        style={[
          styles.sortTrigger,
          open && styles.sortTriggerOpen,
          (hovered || open) && styles.filterHover,
        ]}
      >
        <SortIcon />
        <Text
          style={[
            styles.sortText,
            { color: t.colors.text.primary },
            (hovered || open) && { color: t.colors.purple.base },
          ]}
        >
          Sorted by {(current?.label ?? '').toLowerCase()}
        </Text>
        <ChevronDown size={13} color="#6f756f" strokeWidth={2.2} />
      </Pressable>
      {open ? (
        <Pressable
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={() => onOpenChange(false)}
          style={styles.sortClickCatcher}
        />
      ) : null}
      {open ? (
        <View role="group" accessibilityLabel="Sort results" style={styles.sortMenu}>
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
  const unavailableRef = useUnavailableControl(Boolean(option.roadmap));
  if (option.roadmap) {
    return (
      // This row is the one a reader actually meets: the sort menu's "Most tracked".
      // It shipped as a bare View — no role, no state, eight plain `<div>`s to a
      // screen reader — so the roadmap tag beside it was the only thing saying the
      // choice can't be made, and that tag is visual only (#1025). The role makes it
      // a control; the ref is what marks the control unavailable, because
      // accessibilityState renders nothing here.
      <View
        ref={unavailableRef}
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        style={styles.sortItemRoadmap}
      >
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
      // Same call as DropdownItem above: a group of buttons, so `aria-current`
      // rather than `aria-selected`.
      aria-current={selected ? 'true' : undefined}
      onPress={onSelect}
      {...hover}
      style={[styles.sortItem, highlighted && styles.sortItemHighlight]}
    >
      <Text style={[styles.sortItemText, selected && styles.sortItemTextSelected]}>
        {option.label}
      </Text>
      {/* Hidden for the same reason as DropdownItem's: the glyph reaches the
          accessible name, and `aria-current` already carries the meaning. */}
      {selected ? (
        <Text aria-hidden style={styles.dropdownCheck}>
          ✓
        </Text>
      ) : null}
    </Pressable>
  );
}

// --- Active-filter chip row (v2 §D): removable, facet-color-coded chips + a
//     "Clear all" pill that keeps the session. ---
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
    // The row starts with its first chip: the mono "FILTERS" label was redundant
    // (every chip self-labels — "Issue: Health", "Chamber: House") and it ate
    // ~90px of the first row, wrapping the chips earlier. role="group" plus the
    // group label replace it semantically, so screen readers still announce the
    // set rather than a bare run of buttons.
    <View role="group" accessibilityLabel="Active filters" style={styles.chipRow}>
      {chips.map((chip) => (
        <ActiveFilterChip key={chip.key} chip={chip} />
      ))}
      <ClearAllButton onPress={onClearAll} />
    </View>
  );
}

// Mono section heading above the ISSUES pill row — on its own line, never an
// inline gutter label beside the first pill (inline, it indented row 1 only,
// leaving a ragged left edge and fitting one fewer pill on that row). Now the
// only mono label on the screen, so it has to read as a section heading.
export function FilterEyebrow({ label }: { label: string }) {
  const { isMobile } = useResponsive();
  return (
    <Text style={[styles.filterEyebrow, isMobile && styles.filterEyebrowMobile]}>{label}</Text>
  );
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

// Clear all terminates the filter-chip row, so it's a filled black pill, never a
// borderless text button: black (#11150f) is this product's active/affirmative
// control fill, matching the active chamber / status / issue controls. Never
// green, never grey.
function ClearAllButton({ onPress }: { onPress: () => void }) {
  const { isMobile } = useResponsive();
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Clear all filters"
      onPress={onPress}
      {...hover}
      style={[
        styles.clearAllBtn,
        isMobile ? styles.clearAllBtnMobile : styles.clearAllBtnWeb,
        !isMobile && hovered && styles.clearAllBtnHover,
      ]}
    >
      {/* Leading ✕, decorative: the Pressable's accessibilityLabel is the button's
          accessible name, so the glyph adds nothing for a screen reader. */}
      <X size={isMobile ? 16 : 13} color={t.colors.white} strokeWidth={2.2} />
      <Text style={[styles.clearAllText, isMobile && styles.clearAllTextMobile]}>Clear all</Text>
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

// --- Empty state: dashed card (icon · heading · one line of copy · one button) ---
//
// The bills card deliberately does NOT echo the active filters as a chip row. The
// real, removable chips sit ~90px above in facet colour with working ✕ buttons; a
// non-interactive lookalike below invites a click that does nothing, sits *below*
// the line telling you to remove filters *above*, and disagreed with the real row
// (it added the legislative session, which is always active and can only be
// changed, never cleared).
export function NoResults({
  variant,
  filterCount,
  query,
  legislatorState,
  onClear,
}: {
  variant: 'bills' | 'legislators';
  /** Bills only: how many removable filter chips are active. Drives the copy. */
  filterCount?: number;
  /** Bills only: the search term, when one is active. */
  query?: string;
  /** Legislator-specific copy, derived from the active search and filters. */
  legislatorState?: {
    heading: string;
    body: string;
    action: 'Clear search' | 'Clear filters' | 'Clear all';
  };
  onClear: () => void;
}) {
  const { isMobile } = useResponsive();
  const legislatorMobile = variant === 'legislators' && isMobile;
  // Bills copy branches on the filter stack, because one generic message is wrong
  // in the most common zero-result state — a typo'd search with nothing else
  // applied — where it names a filter stack the user never built. None of the
  // three takes a terminal period. Legislators receives its exact copy from the
  // screen's real search and filter state.
  //
  // A count of 0 is practically unreachable (no filters returns every bill), so it
  // falls through to the multi-filter wording rather than earning a fourth state.
  const onlyFilterIsQuery = filterCount === 1 && !!query;
  const onlyFilterIsFacet = filterCount === 1 && !query;
  let heading: string;
  let body: string;
  if (variant === 'legislators') {
    heading = legislatorState?.heading ?? 'No legislators match these filters';
    body = legislatorState?.body ?? 'Remove a filter or clear them all.';
  } else if (onlyFilterIsQuery) {
    // Curly quotes, matching the keyword chip's own label.
    heading = `No bills match “${query}”`;
    body = 'Try fewer or different words, or check the spelling';
  } else if (onlyFilterIsFacet) {
    heading = 'No bills match that filter';
    body = 'Try a different one, or clear it to see every bill';
  } else {
    // "all of these filters" names the actual cause: the intersection. Plural
    // "filters" in the subtitle is deliberate — with several stacked, removing one
    // often still returns zero, so a singular instruction sets the user up to fail.
    heading = 'No bills match all of these filters';
    body = 'Remove filters above, or clear them all, to widen your search';
  }
  return (
    <View
      {...(isWeb ? ({ role: 'status' } as object) : {})}
      style={[styles.noResults, legislatorMobile && styles.noResultsLegislatorsMobile]}
    >
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
      <Text
        accessibilityRole="header"
        style={[
          styles.noResultsHeading,
          variant === 'bills' && WRAP_ANYWHERE,
          legislatorMobile && styles.noResultsHeadingMobile,
        ]}
      >
        {heading}
      </Text>
      <Text style={[styles.noResultsBody, legislatorMobile && styles.noResultsBodyMobile]}>
        {body}
      </Text>
      <ClearButton
        label={
          variant === 'legislators' ? (legislatorState?.action ?? 'Clear filters') : 'Clear all'
        }
        accessibilityLabel={variant === 'bills' ? 'Clear all filters' : undefined}
        pill={variant === 'bills'}
        fullWidth={legislatorMobile}
        onPress={onClear}
      />
    </View>
  );
}

// The bills heading can quote the user's search term, so it needs to break inside
// a word rather than let a long unbroken string overflow the card. RN has no style
// key for it; RN-Web passes unknown properties straight through to CSS.
const WRAP_ANYWHERE = { overflowWrap: 'anywhere' } as unknown as TextStyle;

// Bills: the same action as the chip row's "Clear all", and in the zero state both
// are on screen at once — so it takes the same name and the same pill shape
// (999px). Shape is a convention here: PILL = the applied-filter layer (the active
// chips and any Clear all acting on them); ROUNDED-RECT (11–12px) = the controls
// you use to *build* a query (chamber, status, session, omnibus, issues, sort).
// Black, not green: green is reserved for forward actions (Sign in, Track, Copy).
// Legislators keeps its own label and rounded-rect until that card is revisited.
function ClearButton({
  label,
  accessibilityLabel,
  pill,
  fullWidth,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  pill: boolean;
  fullWidth: boolean;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      {...hover}
      style={[
        styles.clearBtn,
        pill && styles.clearBtnPill,
        fullWidth && styles.clearBtnFullWidth,
        hovered && styles.clearBtnHover,
      ]}
    >
      <X size={15} color={t.colors.white} strokeWidth={2.2} />
      <Text style={styles.clearBtnText}>{label}</Text>
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
  onPageChange,
}: {
  page: number;
  totalPages?: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  // Fired after a Prev/Next press (see usePaginatedListScroll): lands the first
  // result at the top of the viewport and moves keyboard focus onto the list.
  onPageChange?: () => void;
}) {
  if (!hasPrev && !hasNext) return null;
  return (
    <View style={styles.pagination}>
      <PageButton
        direction="prev"
        disabled={!hasPrev}
        onPress={() => {
          onPrev();
          onPageChange?.();
        }}
      />
      {/* aria-live: announce the new page number to screen readers, since the
          results below swap silently. */}
      <Text style={styles.pageLabel} accessibilityLiveRegion="polite">
        Page <Text style={styles.pageLabelNum}>{page}</Text>
        {typeof totalPages === 'number' ? ` of ${totalPages}` : ''}
      </Text>
      <PageButton
        direction="next"
        disabled={!hasNext}
        onPress={() => {
          onNext();
          onPageChange?.();
        }}
      />
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
      style={[
        styles.pageBtn,
        direction === 'prev' ? styles.pageBtnPrev : styles.pageBtnNext,
        disabled ? styles.pageBtnDisabled : hovered && styles.pageBtnHover,
      ]}
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
  // flexGrow: 1 makes the content fill the window even when there is little of
  // it, which is what lets the results panel and the footer below settle at the
  // bottom instead of stopping mid-screen.
  scrollContent: { paddingBottom: 0, flexGrow: 1 },
  heroWrap: { position: 'relative', zIndex: 2 },
  heroBody: { paddingTop: 36, paddingBottom: 44 },
  heroBodyFlush: { paddingBottom: 0 },
  // The white results panel is what absorbs the leftover height on a short page
  // (one result, a not-found bill), so the extra space reads as more of the same
  // panel rather than a grey stripe between the panel and the footer.
  resultsSection: {
    backgroundColor: t.colors.surfaces.base,
    paddingTop: 40,
    paddingBottom: 64,
    zIndex: 1,
    flexGrow: 1,
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
  searchInputMobile: { fontSize: 16 },
  // 44px invisible hit cushion; the visible glyph is inset by centering it, so
  // the × mirrors the leading magnifier's distance from the field edge (~20px on
  // web) instead of jamming against the border. borderRadius rounds the app-wide
  // :focus-visible outline (App.tsx) to the pill.
  clearField: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    width: CLEAR_SEARCH_TARGET_SIZE,
    height: CLEAR_SEARCH_TARGET_SIZE,
    borderRadius: CLEAR_SEARCH_TARGET_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearFieldGlyph: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearFieldGlyphLit: { backgroundColor: 'rgba(17,21,15,0.10)' },
  // 18px between the filter controls and the ISSUES section heading below them.
  // (Search Legislators puts a single child in this slot, so the gap is inert there.)
  filterSlot: { marginTop: 22, gap: 18 },
  helperRow: { marginTop: 10, paddingHorizontal: 2 },
  helperText: {
    fontFamily: t.typography.body,
    fontSize: 14,
    // #6f756f (the site's AA-safe muted grey on WHITE, 4.7:1) dips to 4.3:1 on
    // the hero's faintly-tinted gradient — below AA. #686e68 is a hair darker
    // and clears AA on the darkest gradient stop (4.8:1) while reading identically.
    color: '#686e68',
  },
  helperTextMobile: { fontSize: 16 },
  helperStrong: { color: '#4f5651', fontWeight: t.fontWeights.bold },

  // Shared filter-control hover/focus: purple border + a 3px purple ring (web).
  // Purple is the filter-affordance accent (v2 spec) — green is reserved for
  // "action", so filter controls never glow green on hover.
  filterHover: {
    borderColor: t.colors.purple.base,
    ...(isWeb ? { boxShadow: '0 0 0 3px rgba(91,48,214,0.14)' } : {}),
  },

  // mono section heading above the ISSUES pill row (0.12em tracking at each size)
  filterEyebrow: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.32,
    color: '#6f756f',
  },
  filterEyebrowMobile: { fontSize: 13, letterSpacing: 1.56 },

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
    flexDirection: 'row',
    gap: 8,
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
  segmentCount: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.semibold,
    color: '#6f756f',
  },
  segmentCountActive: { color: 'rgba(255,255,255,0.55)' },

  // dropdown — wrapper z-index:40 + menu (absolute) z-index:1, the shared recipe
  // every dropdown/menu on this screen uses so it opens in front of the content
  // below it (v2 spec, root-cause fix).
  dropdownWrap: { position: 'relative', zIndex: 40 },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 12,
    paddingVertical: 11,
    // Trailing chevron, so 3px less on the right (see `clearBtn`).
    paddingLeft: 18,
    paddingRight: 15,
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
    zIndex: 1,
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
  // Neutral grey highlight (#f2f3f5) for selected + hovered rows — the menu reads
  // black/neutral, never green (green is "action" only, v2 spec §B).
  dropdownItemHighlight: { backgroundColor: '#f2f3f5' },
  dropdownItemText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.primary,
  },
  // A not-yet-available (disabled) row, e.g. a prior session whose data isn't
  // loaded: muted grey, inert.
  dropdownItemTextDisabled: { color: '#6f756f', fontWeight: t.fontWeights.medium },
  dropdownItemTextSelected: { fontWeight: t.fontWeights.bold },
  dropdownCheck: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
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
    // Leading scales glyph, so 3px less on the left (see `clearBtn`).
    paddingLeft: 15,
    paddingRight: 18,
    minHeight: 44,
  },
  // Active (on): solid black fill + white text/icon, identical to the active
  // chamber / status controls (v2 spec §B) — never green.
  omnibusOn: { backgroundColor: t.colors.ink, borderColor: t.colors.ink },
  omnibusText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  omnibusTextOn: { color: t.colors.white, fontWeight: t.fontWeights.bold },

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
  // Selected issue pill: solid black fill + white label, count in translucent
  // white (v2 spec §C) — never green.
  pillActive: { backgroundColor: t.colors.ink, borderColor: t.colors.ink },
  pillText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  pillTextActive: { color: t.colors.white, fontWeight: t.fontWeights.bold },
  pillCount: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.faint,
  },
  pillCountActive: { color: 'rgba(255,255,255,0.55)' },
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
  // The "+N more" issue toggle keeps the design's green dashed treatment (it's an
  // additive "reveal" action, not a filter control) — so it hovers green, not the
  // purple of the filter controls.
  morePillHover: { borderColor: t.colors.brand.base },

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
    // react-native-web stamps position:relative + z-index:0 on every View, so the
    // sort control's z-index:40 wrapper is trapped inside this header's stacking
    // context and, being an earlier sibling, would paint UNDER the result-card
    // list (also z-index:0). Lifting the header above the list lets the open sort
    // menu overlay the cards below (root-cause-2 fix; the HTML mock avoids this
    // because plain divs are position:static).
    zIndex: 40,
  },
  resultsHeaderNoRule: { paddingBottom: 0, borderBottomWidth: 0 },
  // Mobile stacks the strip: the count line, then the sort control on its OWN
  // row, left-aligned 18px below it. Sharing the count's row and hanging off the
  // right edge read as scattered in a narrow column. Web deliberately keeps the
  // sort control on the RIGHT of one wide row — nothing bunches up there.
  resultsHeaderMobile: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    flexWrap: 'nowrap',
    gap: 18,
  },
  resultsHeaderMain: { minWidth: 0, flexShrink: 1, gap: 5 },
  resultsHeaderMainMobile: { width: '100%' },
  // baseline + wrap so a narrow phone drops the trailing "as of {date}" onto its
  // own line instead of truncating it.
  resultsCountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  resultsCountRowMobile: { gap: 8 },
  resultsCount: {
    fontFamily: t.typography.title,
    fontSize: 26,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.26,
    color: t.colors.text.primary,
  },
  resultsCountMobile: { fontSize: 34, letterSpacing: -0.68 },
  resultsNoun: {
    fontFamily: t.typography.body,
    fontSize: 17,
    // #6b716b, 5.0:1 on the white results section (AA).
    color: '#6b716b',
  },
  resultsNounMobile: { fontSize: 18 },
  // "as of {date}" trails the unit noun as ordinary prose, so it takes the body
  // face with no mono, no letter-spacing and no separator glyph. #6f756f is
  // 4.7:1 on the white results section (AA).
  resultsAsOf: {
    fontFamily: t.typography.body,
    fontSize: 14,
    color: '#6f756f',
  },
  resultsAsOfMobile: { fontSize: 15 },
  rosterCountNote: {
    width: '100%',
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 20.3,
    color: '#6f756f',
    ...(isWeb ? ({ textWrap: 'pretty' } as object) : null),
  },
  rosterCountNoteLink: { color: '#6f756f', textDecorationLine: 'underline' },
  rosterCountNoteLinkHover: { color: t.colors.text.greenOnLight },
  // flexShrink + maxWidth keep the sort control inside the viewport rather than
  // overflowing (and being clipped) off the right edge.
  resultsMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 18,
    flexShrink: 1,
    maxWidth: '100%',
  },
  resultsMetaRowMobile: { alignSelf: 'flex-start' },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sortText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
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
    ...(isWeb ? ({ whiteSpace: 'nowrap' } as object) : null),
  },
  sortTriggerOpen: { position: 'relative', zIndex: 2 },
  sortClickCatcher: {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 0,
    ...(isWeb ? ({ position: 'fixed' } as object) : ({ position: 'absolute' } as object)),
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
  // Filled black pill (#11150f = t.colors.ink), white label, leading ✕.
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: t.colors.ink,
    borderRadius: 999,
  },
  // Leading-icon optical centering: 3px less on the left than the right (see the
  // note on `clearBtn`). Measured before the fix: left edge to ✕ was 18px while
  // "all" to the right edge was 15.5px, on identical 14px padding.
  clearAllBtnWeb: {
    borderWidth: 1,
    borderColor: t.colors.ink,
    paddingVertical: 8,
    paddingLeft: 11,
    paddingRight: 14,
  },
  clearAllBtnMobile: { paddingVertical: 9, paddingLeft: 10, paddingRight: 13 },
  clearAllBtnHover: { backgroundColor: '#000000', borderColor: '#000000' },
  clearAllText: {
    fontFamily: t.typography.ui,
    fontSize: 13,
    fontWeight: t.fontWeights.bold,
    color: t.colors.white,
  },
  clearAllTextMobile: { fontSize: 16 },

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
  noResultsLegislatorsMobile: { marginTop: 18, paddingVertical: 32, paddingHorizontal: 20 },
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
  noResultsHeadingMobile: { fontSize: 20, lineHeight: 25 },
  noResultsBody: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    lineHeight: 25,
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  noResultsBodyMobile: { fontSize: 15, lineHeight: 22 },
  clearBtn: {
    marginTop: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: t.colors.ink,
    borderRadius: 12,
    paddingVertical: 14,
    // Leading-icon optical centering: 26px on the right, 3px less on the left.
    // Our icons sit on a 24-unit viewBox with the mark inset to the middle ~50%,
    // so the glyph carries ~3px of empty box on its outer side; symmetric padding
    // then reads ~3px off-centre against a label that sits flush to its own box.
    paddingLeft: 23,
    paddingRight: 26,
  },
  clearBtnPill: { borderRadius: 999 },
  clearBtnFullWidth: { width: '100%', minHeight: 46, justifyContent: 'center' },
  clearBtnHover: { backgroundColor: '#000000' },
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
  // Optical centering (see `clearBtn`): Previous carries a leading chevron, Next a
  // trailing one, so each trims 3px on the side its glyph sits.
  pageBtnPrev: { paddingLeft: 19 },
  pageBtnNext: { paddingRight: 19 },
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
