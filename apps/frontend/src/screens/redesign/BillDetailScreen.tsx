import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme as t, prefersReducedMotion } from '../../theme/tokens';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { Footer, TopNav } from '../../theme/primitives';
import { useResponsive } from '../../hooks/useResponsive';
import { titleCaseIssue } from '../../lib/issues';
import { IaItem, MenuKey } from '../../navigation/ia';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import { useAuth } from '../../providers/AuthProvider';
import { ReturnToast } from '../../components/search/ReturnToast';
import { shouldAnnounceTrack, trackReturnAction } from '../../lib/trackReturn';
import { useBill } from '../../hooks/useAppQueries';
import { useBillTracking } from '../../hooks/useBillTracking';
import { isNotFoundError } from '../../data/api';
import { BillNotFound } from '../../components/billDetail/BillNotFound';
import { BillTrackButton } from '../../components/billDetail/BillTrackButton';
import { Bill, VoteEvent } from '../../data/types';
import { formatSessionLabel, SESSION_LABEL_FALLBACK } from '../../lib/sessionLabel';
import {
  authorAddPrefix,
  authorNameOnly,
  askCardPrompts,
  authorTitleLabel,
  billOverviewUrl,
  buildActionTimeline,
  buildPartyBlocks,
  chamberBillLabel,
  chiefAuthor,
  citationChipLabel,
  citationsBySection,
  coAuthorCount,
  crossReferenceTargets,
  districtRowLabel,
  effectiveRailValue,
  formatAuthorDistrict,
  formatMonoDate,
  formatNiceDate,
  isKnownDistrict,
  latestActionEntry,
  MemberVote,
  orderBillVersions,
  parseActionDate,
  partyFull,
  plainBillSummary,
  plainKeyPoints,
  PartyBlock,
  PHASED_CAPTION,
  POINTER_CAPTION,
  pulledLabel,
  readDocumentLink,
  scopedChipQuery,
  TimelineAuthor,
  TimelineRow,
  titleSegments,
  validateRoll,
  versionTrackTag,
} from '../../lib/billDetail';
import { citationSectionAnchor } from '../../lib/billText';
import { NormalizedMotion, normalizeMemberName, normalizeMotion } from '../../lib/motionNormalize';
import { Skeleton } from '../../components/Skeleton';
import { GoBackLink } from '../../components/GoBackLink';
import { FullTextTab } from '../../components/billDetail/FullTextTab';
import { SuggestedQuestionChip } from '../../components/billDetail/CitationCard';
import { BillDetailWebScreen } from './BillDetailWebScreen';

// Bill Detail — mobile-first, single scrolling page (docs/mockups/bill-detail-mobile).
// Re-expressed in RN from the .dc.html literal values; support.js not ported.
//
// Data honesty (grounded-answers.md rules 1/4): the mock hardcodes party rosters
// and fabricates per-member votes; this build shows only what the record truthfully
// carries. Per-member roll-call votes + party now ship (#435/#443 → api.ts
// mapBillDetail), so the Votes section renders the real party-grouped member grid,
// crossover dots, and party splits from that data — degrading to the tally + result
// + proportion bar on rolls the corpus has no per-member records for. The companion
// row ships from the served link (#293). Still absent: the per-point cited-sections
// strip (#377), which fills in when its backend ships.

const isWeb = Platform.OS === 'web';

// Amber treatments (README design tokens). Text uses the AA-safe #8f5a12 the
// token system already settled on (omnibus.text); the FILLED code badge and the
// GHOSTED omnibus/chapter tag are distinguished by fill, same hue.
// Fill/border come from the shared omnibus tokens so the mobile code badge is
// identical to the web FactsRail's — the mockup's darker #fbe7bd/#eccf86 was a
// mobile-only local that made the same badge read differently per platform.
const AMBER_TEXT = t.colors.omnibus.text; // #8f5a12
const CODE_BADGE_FILL = t.colors.omnibus.fill;
const CODE_BADGE_BORDER = t.colors.omnibus.border;
const GHOST_AMBER_BORDER = t.colors.omnibus.ghostBorder; // #e3c17f — shared ghosted omnibus border

// Page ground — ONE flat cool-grey. Every zone (header + each content section) is
// a white surface (surfaces.base) sitting on this; the ground shows only in the
// gaps between those white panels, which is what makes them pop and gives the
// neutral-grey chips (#f1f1f4 hot-issue / topic pills) a white surface to sit on.
// A single-screen ground tone with no other consumer, so a local const rather
// than a shared token (avoids a speculative theme abstraction). Slightly cooler /
// deeper than surfaces.s300 (#f4f5f7) so white reads as a distinct surface.
const GROUND = '#eef1f4';
// Grey gap between stacked white panels — the only place the ground shows.
const PANEL_GAP = 12;

// Editorial "🔥 Hot issue" flag — the same set that drives the home "In the News"
// pins and Search Bills. Keys are `bill.id` (e.g. "94-2026-HF4138"). Only the own
// key of each flagged bill is listed; a companion INHERITS the flag via the live
// companion relationship (checked below), so both chambers' versions carry it
// without hardcoding every paired key. Kept local to this surface, matching the
// per-surface convention (the home screen holds its own copy) — no shared module
// exists yet across the surfaces carrying this flag.
const HOT_ISSUE_BILL_KEYS = new Set<string>(['94-2026-HF4138', '94-2025-SF856', '94-2026-SF5310']);

function isHotIssueBill(bill: { id: string; companion?: { id: string } | null }): boolean {
  return (
    HOT_ISSUE_BILL_KEYS.has(bill.id) ||
    Boolean(bill.companion && HOT_ISSUE_BILL_KEYS.has(bill.companion.id))
  );
}

// Section ids for the sticky jump chips + scroll-spy.
const SECTIONS = [
  { id: 'summary', label: 'Summary' },
  { id: 'actions', label: 'Actions' },
  { id: 'votes', label: 'Votes' },
  { id: 'versions', label: 'Versions' },
  { id: 'fulltext', label: 'Bill Text' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const STICKY_OFFSET = 60; // chip-bar height; sections scroll to just under it

// --- derivations -----------------------------------------------------------

type Tone = 'green' | 'neutral' | 'vetoed';

// Reuse the list card's status→tone rule so the pill always agrees with the label.
function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (s.includes('veto')) return 'vetoed';
  if (s.includes('signed') || s.includes('law') || s.includes('enacted')) return 'green';
  return 'neutral';
}

// Chamber label, party spelled out, effective/latest-action date, and chief-author
// display all come from the shared lib/billDetail helpers (parity with the web
// FactsRail); no mobile-local duplicates.

// The dot taxonomy, the SCHEDULED test and every action title now come from the
// shared buildActionTimeline (lib/billDetail) rather than mobile-local regexes, so
// the two platforms cannot drift apart (#559).

// --- small presentational pieces -------------------------------------------

function useHover(): [boolean, { onHoverIn: () => void; onHoverOut: () => void }] {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }];
}

function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  const dotColor =
    tone === 'green'
      ? t.colors.brand.base
      : tone === 'vetoed'
        ? t.colors.status.vetoedStep
        : t.colors.borders.strong;
  const textColor =
    tone === 'green'
      ? t.colors.brand.deep
      : tone === 'vetoed'
        ? t.colors.status.vetoedText
        : t.colors.text.secondary;
  return (
    <View style={styles.pill}>
      <View style={[styles.pillDot, { backgroundColor: dotColor }]} />
      <Text style={[styles.pillLabel, { color: textColor }]}>{label}</Text>
    </View>
  );
}

function ShareIcon({
  color = t.colors.text.primary,
  size = 15,
}: {
  color?: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={18} cy={5} r={2.6} stroke={color} strokeWidth={2} />
      <Circle cx={6} cy={12} r={2.6} stroke={color} strokeWidth={2} />
      <Circle cx={18} cy={19} r={2.6} stroke={color} strokeWidth={2} />
      <Path
        d="M8.4 10.7 L15.6 6.5 M8.4 13.3 L15.6 17.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function Chevron({ up, color = t.colors.text.primary }: { up?: boolean; color?: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path
        d={up ? 'M6 15 L12 9 L18 15' : 'M6 9 L12 15 L18 9'}
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CircleCheck() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={t.colors.brand.graphics} strokeWidth={2} />
      <Path
        d="M8.5 12.2 L11 14.7 L15.7 9.6"
        stroke={t.colors.brand.graphics}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// A tap/press-glowing text link (green, per the design's inline-link treatment).
// With `arrow`, a trailing "→" (U+2192) is appended in the link's own font at its
// size but weight 400 (the label stays 700) — a decorative, aria-hidden span so
// screen readers announce the label alone.
function TextLink({
  label,
  href,
  external,
  onPress,
  size = 17,
  arrow,
}: {
  label: string;
  // Absent for an in-page scroll target (e.g. "View votes →"), which stays a
  // plain link-styled pressable rather than a real anchor.
  href?: string;
  // Official-source URL (revisor.mn.gov) rather than an in-app page.
  external?: boolean;
  onPress: () => void;
  size?: number;
  arrow?: boolean;
}) {
  const [hovered, hover] = useHover();
  const anchor = href
    ? external
      ? externalLinkProps(href, onPress)
      : linkProps(href, onPress)
    : { accessibilityRole: 'link' as const, onPress };
  return (
    <Pressable {...anchor} {...hover}>
      <Text
        style={[
          styles.textLink,
          { fontSize: size },
          hovered && { color: t.colors.brand.forest, textDecorationLine: 'underline' },
        ]}
      >
        {label}
        {arrow ? (
          <Text aria-hidden style={styles.linkArrow}>
            {' →'}
          </Text>
        ) : null}
      </Text>
    </Pressable>
  );
}

// Section wrapper: full-bleed (so the sticky chip bar spans the width) with an
// inner column capped for comfortable reading on wide viewports.
function Section({
  id,
  onLayout,
  children,
  style,
}: {
  id: SectionId;
  onLayout: (id: SectionId, y: number) => void;
  children: React.ReactNode;
  style?: object;
}) {
  return (
    <View
      nativeID={`sec-${id}`}
      onLayout={(e) => onLayout(id, e.nativeEvent.layout.y)}
      style={[
        styles.sectionOuter,
        isWeb ? ({ scrollMarginTop: STICKY_OFFSET } as object) : null,
        style,
      ]}
    >
      <View style={styles.column}>{children}</View>
    </View>
  );
}

// --- screen -----------------------------------------------------------------

// Responsive dispatcher: the desktop/web design is a tabbed two-column layout
// (design_handoff_bill_profile_web); the narrow design is this single-scrolling
// page (design_handoff_bill_profile_mobile). Same pattern as HomeSignedOut.
export function BillDetailScreen() {
  const { isDesktop } = useResponsive();
  return isDesktop ? <BillDetailWebScreen /> : <BillDetailMobileScreen />;
}

function BillDetailMobileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { isSignedIn } = useAuth();
  const { isMobile } = useResponsive();

  const params: Record<string, unknown> = route.params ?? {};
  const billId = typeof params.billId === 'string' ? params.billId : '';
  // Deep link: /bills/:id?tab=votes lands on that section (grounded-answers rule 5
  // — the section is URL-addressable). Applied once, when that section lays out.
  const initialTab = SECTIONS.some((s) => s.id === params.tab) ? (params.tab as SectionId) : null;

  const billQuery = useBill(billId);
  const bill = billQuery.data;

  const { trackedIds, isTracked, toggleTrack, trackedLoading } = useBillTracking();
  const tracked = bill ? isTracked(bill.id) : false;
  const onTrack = useCallback(() => {
    if (bill) toggleTrack(bill.id, bill.identifier);
  }, [bill, toggleTrack]);

  // Intent-preserving track: a signed-out user who tapped Track returns here with
  // ?track=1. Once signed in and the tracked list has loaded, complete the track
  // (unless already tracked) and clear the param so a refresh doesn't repeat it.
  const autoTrackFired = useRef(false);
  const [justTracked, setJustTracked] = useState<string | null>(null);
  useEffect(() => {
    const action = trackReturnAction({
      requestedOnReturn: Boolean(params.track),
      signedIn: isSignedIn,
      billLoaded: Boolean(bill),
      trackedListLoading: trackedLoading,
      alreadyTracked: Boolean(bill && trackedIds.has(bill.id)),
      alreadyFired: autoTrackFired.current,
    });
    if (action === 'wait' || !bill) return;
    if (action === 'track') {
      autoTrackFired.current = true;
      // The message waits for the server to confirm the save. Announcing on the
      // attempt would claim a bill was tracked when the request had failed.
      toggleTrack(
        bill.id,
        bill.identifier,
        shouldAnnounceTrack(action) ? () => setJustTracked(bill.identifier) : undefined,
      );
    }
    navigation.setParams({ track: undefined });
  }, [params.track, isSignedIn, bill, trackedLoading, trackedIds, toggleTrack, navigation]);

  // The bill's OWN session, not whichever one is current: a special-session bill
  // belongs to a different session than the biennium, and labelling it with the
  // biennium's years would state the wrong thing about it (#746).
  const sessionLabel = bill?.session
    ? formatSessionLabel(bill.session)
    : bill?.sessionLabel
      ? formatSessionLabel(bill.sessionLabel)
      : SESSION_LABEL_FALLBACK;

  // chrome + overlays
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // scroll-spy
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<SectionId, number>>({
    summary: 0,
    actions: 0,
    votes: 0,
    versions: 0,
    fulltext: 0,
  });
  const [active, setActive] = useState<SectionId>('summary');
  // Section a cited-section chip asked to jump to; consumed by FullTextTab.
  const [ftAnchor, setFtAnchor] = useState<string | null>(null);
  const didInitialJump = useRef(false);

  const onSectionLayout = useCallback((id: SectionId, y: number) => {
    offsets.current[id] = y;
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y + STICKY_OFFSET + 8;
    let current: SectionId = 'summary';
    for (const s of SECTIONS) {
      if (offsets.current[s.id] <= y) current = s.id;
    }
    setActive((prev) => (prev === current ? prev : current));
  }, []);

  const jumpTo = useCallback((id: SectionId) => {
    setActive(id);
    if (isWeb && typeof document !== 'undefined') {
      // position:sticky + scroll-margin-top handle the offset; scrollIntoView is
      // the reliable web scroller (RN's imperative scrollTo is flaky under RNW).
      // 'auto' (instant) — 'smooth' silently no-ops inside this nested RNW
      // overflow container, so the jump would never fire.
      document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'auto', block: 'start' });
    } else {
      scrollRef.current?.scrollTo({
        y: Math.max(0, offsets.current[id] - STICKY_OFFSET),
        animated: true,
      });
    }
  }, []);

  // Initial ?tab= deep link: jump once the bill has loaded and painted. Deferred
  // to after paint (layout settles async) rather than fired during onLayout,
  // which scrolls too early and gets reset when content above finishes laying out.
  useEffect(() => {
    if (!bill || !initialTab || didInitialJump.current) return;
    didInitialJump.current = true;
    if (isWeb && typeof document !== 'undefined') {
      const id = window.setTimeout(() => {
        document
          .getElementById(`sec-${initialTab}`)
          ?.scrollIntoView({ behavior: 'auto', block: 'start' });
        setActive(initialTab);
      }, 180);
      return () => window.clearTimeout(id);
    }
    scrollRef.current?.scrollTo({ y: Math.max(0, offsets.current[initialTab] - STICKY_OFFSET) });
    setActive(initialTab);
  }, [bill, initialTab]);

  const handleNavigate = (item: IaItem) => {
    switch (item.id) {
      case 'search-bills':
        navigation.navigate('Bills');
        return;
      case 'search-legislators':
        navigation.navigate('Legislators');
        return;
      case 'search-find-my-legislator':
        navigation.navigate('FindMyLegislator');
        return;
      case 'track-bills':
        navigation.navigate('Tracked');
        return;
      default:
        return;
    }
  };

  // Native uses the navigation stack when it has one, then the bill list. Web's
  // shared GoBackLink makes the stricter decision from marked browser history.
  const goToBillList = () => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
    } else {
      navigation.navigate('Bills');
    }
  };

  // --- share ---
  const shareUrl = bill ? `https://alethical.com/bills/${bill.id}` : 'https://alethical.com';
  // Prefer the concise AI short title for the share text (the statutory title can
  // be hundreds of chars); fall back to it when absent.
  const shareTitle = bill
    ? `${bill.identifier} — ${bill.aiAnalysis?.shortTitle ?? bill.title}`
    : 'Alethical';
  const openExternal = (url: string) => {
    void Linking.openURL(url);
  };
  const copyLink = () => {
    if (isWeb && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(shareUrl);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1900);
  };

  // --- ask ---
  const goAsk = (q?: string) => {
    navigation.navigate('Ask', q ? { q, billId } : { billId });
  };

  // Roll-call member chips link to the member's profile (grounded-answers rule 5 —
  // URL-addressable).
  const openLegislator = (legislatorId: string) => {
    navigation.navigate('LegislatorProfile', { legislatorId });
  };

  // --- derived view model (only when the bill is loaded) ---
  const vm = useMemo(() => {
    if (!bill) return null;
    // Anchor "upcoming" to the real current date, NOT bill.updatedAt (the corpus
    // last-refresh stamp). A real-past action has happened and is never scheduled;
    // using updatedAt mis-flagged already-past enacted milestones (signing, filing)
    // as SCHEDULED whenever the corpus lagged those dates (see #537). Mirrors the
    // shipped web ActionsTab.
    const now = new Date();
    const tone = statusTone(bill.status);
    // Mirror the shipped web FactsRail (lib/billDetail): honest chief-author +
    // effective-date + issues wiring, reusing shared helpers.
    const chief = chiefAuthor(bill);
    // Both through the shared display cleaners, like the web tab: they strip a
    // bill-code preamble and statute citations without re-authoring the sentence,
    // so no surface can print the code the amber badge already shows, or legalese
    // (grounded-answers rule 9).
    const keyPoints = plainKeyPoints(bill.aiAnalysis?.keyPoints);
    // The key-point bullets ARE the plain-language summary; the standalone summary
    // paragraph is shown only as a fallback when there are no bullets (drops the
    // redundant prose the design removed).
    const summary = plainBillSummary(bill.aiAnalysis?.summary);
    // One chip per cited section. The strip shows the section label alone, so two
    // key points citing the same section produce two chips a reader cannot tell
    // apart, both jumping to the same passage. The web tab keeps every citation —
    // its cards quote a different excerpt each.
    const citations = citationsBySection(bill.citations ?? []);
    const issues = (bill.topics?.length ? bill.topics : (bill.aiAnalysis?.policyAreas ?? [])).slice(
      0,
      6,
    );
    const coauthors = coAuthorCount(bill);
    // Show EFFECTIVE {date} only when the backend served a statutory effective date
    // verified verbatim from the enacted bill text (#483). Otherwise the honest
    // LATEST ACTION {text · date} — we never label a last-action date as EFFECTIVE,
    // which is wrong whenever the real effective date is in the future (see #455).
    // Never the literal "Effective date" status string, nor a "· Unknown" suffix.
    // The served date is a verbatim statutory string ("August 1, 2025"), so it goes
    // through formatNiceDate for the rail's abbreviated month — matching the LATEST
    // ACTION branch, the Actions timeline, and the search card (#711).
    const niceDate =
      bill.updatedAt && bill.updatedAt !== 'Unknown' ? formatNiceDate(bill.updatedAt) : '';
    // The action text is the plain-language headline of the newest action (same
    // latestActionEntry the list card + Actions timeline use), so the rail names
    // the committee ("Referred to Transportation") instead of the raw clerk string
    // ("Referred to"). Falls back to the stored status text when a bill has no
    // action rows (#599 follow-up).
    // A law whose sections start on different days keeps the EFFECTIVE label and
    // leads with the earliest date it states about itself, plus the one muted
    // caption. Identical logic and copy to the web facts rail — both call the
    // shared effectiveRailValue so the two platforms cannot drift (#715).
    const latest = latestActionEntry(bill.actions ?? [], now, bill.sponsors);
    const effective = effectiveRailValue(bill);
    const dateLabel = effective ? 'EFFECTIVE' : 'LATEST ACTION';
    const dateValue =
      effective?.value ??
      (latest
        ? `${latest.label}${latest.date ? ` · ${latest.date}` : ''}`
        : bill.latestActionText
          ? `${bill.latestActionText}${niceDate ? ` · ${niceDate}` : ''}`
          : niceDate);
    const overviewUrl = billOverviewUrl(bill.officialLinks?.[0]?.url);
    const read = readDocumentLink(bill.versions, bill.actions);
    const readUrl = read.url ?? overviewUrl;
    // The curated, newest-first timeline — the SAME shared builder the web Actions
    // tab calls (#559), so a given record reads identically on a phone and a laptop.
    // Everything the mobile screen used to do itself now lives in there: plain-
    // language titles, collapsed co-author runs and floor-passage clusters, deduped
    // cross-chamber rows, chamber-labelled tallies, the resolved effective-date
    // schedule rows (#715), and the glossary of terms actually shown.
    // The author list goes in too, so a co-author row prints the full name and taps
    // through to the profile rather than showing the clerk's bare surname.
    const { rows: actionRows, glossary: actionGlossary } = buildActionTimeline(
      bill.actions,
      bill.votes,
      now,
      bill.effectiveSchedule,
      bill.sponsors,
    );
    // Show only outcome-determining roll calls (final passage, repassage,
    // concurrence, veto override, conference-report adoption, de-facto kill
    // votes), newest first — the same shared classifier + order the web Votes
    // tab uses (lib/motionNormalize.ts), so a given motion reads identically on
    // both. Administrative/scheduling motions are hidden (they remain in the
    // Actions timeline); a bill left with none falls through to the empty state.
    const rolls = bill.votes
      .map((vote) => ({
        vote,
        norm: normalizeMotion({
          motionText: vote.motion,
          resultText: vote.result,
          chamber: vote.chamber,
        }),
      }))
      .filter((r) => r.norm.outcomeDetermining)
      .sort(
        (a, b) =>
          (parseActionDate(b.vote.date)?.getTime() ?? 0) -
          (parseActionDate(a.vote.date)?.getTime() ?? 0),
      );
    const hasVotes = rolls.length > 0;
    return {
      tone,
      chief,
      keyPoints,
      summary,
      citations,
      issues,
      coauthors,
      dateLabel,
      dateValue,
      datePhased: effective?.phased ?? false,
      // The record's newest entry is a pointer somewhere else rather than a further
      // step for this bill, so the status pill above needs qualifying (#757).
      datePointer: latest?.kind === 'crossReference',
      overviewUrl,
      readUrl,
      readLabel: read.label,
      actionRows,
      actionGlossary,
      rolls,
      hasVotes,
      // The page's one last-updated stamp, for the single source line closing the
      // whole scroll at the foot of Bill Text (billSourceText drops the segment
      // when the bill carries no pull date). NOT `niceDate` above, which is the
      // Legislature's last action on the bill and feeds the LATEST ACTION rail row
      // — the same value under two labels was the #861 bug.
      updatedLabel: pulledLabel(bill),
    };
  }, [bill]);

  const shellProps = {
    openMenu,
    onOpenMenuChange: setOpenMenu,
    onNavigate: handleNavigate,
    onHome: () => navigation.navigate('Tabs', { screen: 'Home' }),
  };

  return (
    <View style={styles.pageGround}>
      {/* Pinned outside the scroll, so the confirmation stays put while the page
          moves under it. Only ever set by a return from sign-in (#1015). */}
      <ReturnToast
        visible={Boolean(justTracked)}
        billCode={justTracked ?? ''}
        onDismiss={() => setJustTracked(null)}
      />
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {/* 0 — top nav (scrolls away). On a white surface, so it reads as the TOP
            of the header's white block rather than a grey strip above it — the
            header (nav → title → status/flags → tabs) is one continuous white
            surface, and the grey ground shows only in the gaps between the content
            sections below. */}
        <View style={styles.navSurface}>
          <TopNav {...shellProps} />
        </View>

        {billQuery.isLoading ? (
          <View accessible accessibilityLabel="Loading bill">
            {/* header skeleton (breadcrumb · title · status · eyebrow) */}
            <View style={styles.headerOuter}>
              <View style={styles.column}>
                <Skeleton width={88} height={16} style={styles.skGap20} />
                <Skeleton width="92%" height={30} radius={8} />
                <Skeleton width="66%" height={30} radius={8} style={styles.skGap8} />
                <View style={styles.skStatusRow}>
                  <Skeleton width={128} height={28} radius={t.radii.pill} />
                </View>
                <Skeleton width={150} height={12} style={styles.skGap14} />
              </View>
            </View>
            {/* first content section skeleton (heading · lines · card) */}
            <View style={styles.column}>
              <Skeleton width={130} height={22} radius={8} style={styles.skGap24} />
              <View style={styles.skLines}>
                <Skeleton width="100%" height={14} />
                <Skeleton width="96%" height={14} />
                <Skeleton width="88%" height={14} />
              </View>
              <Skeleton width="100%" height={140} radius={t.radii.card} style={styles.skGap24} />
            </View>
          </View>
        ) : /* A bill that does not exist is a permanent answer, not a blip: say so
              and give a way out, instead of inviting a retry that can never work
              (#720). Same shared component the web screen renders. */
        isNotFoundError(billQuery.error) ? (
          <BillNotFound
            billId={billId}
            onBrowseBills={goToBillList}
            onAsk={() => navigation.navigate('Ask')}
          />
        ) : billQuery.isError || !bill || !vm ? (
          <View style={styles.stateBox}>
            <Text style={styles.stateText}>
              We couldn’t load this bill right now. Please try again in a moment.
            </Text>
            <GoBackLink href={routePath.bills()} onPress={goToBillList} mobile />
          </View>
        ) : (
          <>
            {/* 1 — bill header */}
            <View style={styles.headerOuter}>
              <View style={styles.column}>
                <GoBackLink href={routePath.bills()} onPress={goToBillList} mobile />
                <Text
                  accessibilityRole="header"
                  accessibilityLabel={bill.title}
                  // The design hero is a punchy AI short title. When a bill has
                  // none, fall back to the canonical statutory title but shrink +
                  // clamp it so a 40-word title doesn't consume the whole screen.
                  numberOfLines={bill.aiAnalysis?.shortTitle ? undefined : 4}
                  style={[styles.h1, bill.aiAnalysis?.shortTitle ? null : styles.h1Long]}
                >
                  {bill.aiAnalysis?.shortTitle ?? bill.title}
                </Text>
                <View style={styles.statusRow}>
                  <View style={styles.statusRowLeft}>
                    <StatusPill tone={vm.tone} label={bill.status} />
                    {bill.isOmnibus ? (
                      <View style={styles.omnibusTag}>
                        <Text style={styles.omnibusTagText}>OMNIBUS</Text>
                      </View>
                    ) : null}
                    {isHotIssueBill(bill) ? (
                      <View
                        style={styles.hotPill}
                        accessibilityRole="text"
                        accessibilityLabel="Hot issue"
                      >
                        <Text style={styles.hotPillText}>🔥 Hot issue</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.headerActions}>
                    <BillTrackButton
                      billId={bill.id}
                      tracked={tracked}
                      onPress={onTrack}
                      size="mobile"
                    />
                    <ShareButton onPress={() => setShareOpen(true)} />
                  </View>
                </View>
                <Text style={styles.eyebrow}>
                  {bill.chamber.toUpperCase()} · {sessionLabel.toUpperCase()}
                </Text>
              </View>
            </View>

            {/* 2 — sticky jump chips (scroll-spy) */}
            <View style={styles.chipBar}>
              <View style={styles.chipBarCenter}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipBarInner}
                >
                  {SECTIONS.map((s) => (
                    <JumpChip
                      key={s.id}
                      label={s.label}
                      active={active === s.id}
                      onPress={() => jumpTo(s.id)}
                    />
                  ))}
                </ScrollView>
              </View>
            </View>

            {/* 3 — Summary. No top grey gap: it sits flush under the sticky tab
                bar, whose own bottom border does the separating, so "Key points"
                starts clean on the white surface. The grey gaps stay between the
                content sections below. */}
            <Section id="summary" onLayout={onSectionLayout} style={styles.firstSection}>
              <Text accessibilityRole="header" style={styles.h2}>
                Key points
              </Text>
              {/* The cited bullets ARE the plain-language summary; fall back to the
                  summary paragraph only when there are no bullets (item 1). */}
              {vm.keyPoints.length > 0 ? (
                <View style={styles.points}>
                  {vm.keyPoints.map((point, i) => (
                    <View key={i} style={styles.pointRow}>
                      <View style={styles.pointBullet} />
                      <Text style={styles.pointText}>{point}</Text>
                    </View>
                  ))}
                </View>
              ) : vm.summary ? (
                <Text style={styles.lede}>{vm.summary}</Text>
              ) : null}

              {/* CITED SECTIONS strip (renders when the record carries citations;
                  empty until traceable key-point citations ship, #377). */}
              {vm.citations.length > 0 ? (
                <View style={styles.citedStrip}>
                  <View style={styles.citedLabelRow}>
                    <Text style={styles.citedLabel}>CITED SECTIONS</Text>
                    <CircleCheck />
                  </View>
                  <View style={styles.citedChips}>
                    {vm.citations.map((c, i) => (
                      <Pressable
                        key={`${c.id}-${i}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Jump to ${citationChipLabel(c.label, c.sectionTopic)} in Bill Text`}
                        disabled={!c.sectionId}
                        onPress={() => {
                          setFtAnchor(citationSectionAnchor(c));
                          jumpTo('fulltext');
                        }}
                        style={({ pressed }) => [
                          styles.citedChip,
                          pressed && styles.citedChipPressed,
                        ]}
                      >
                        <Text style={styles.citedChipText}>
                          {citationChipLabel(c.label, c.sectionTopic)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Facts card */}
              <View style={styles.factsCard}>
                {vm.dateValue ? (
                  <View style={styles.factsBlock}>
                    <Text style={styles.factsLabel}>{vm.dateLabel}</Text>
                    <Text style={styles.factsValue}>{vm.dateValue}</Text>
                    {/* Phased law: one muted caption pointing at Actions. Tapping
                        it scrolls to the Actions section and sets that jump chip
                        active, exactly as tapping the chip does (#715). */}
                    {vm.datePhased ? (
                      <Text style={styles.phasedCaption}>
                        {PHASED_CAPTION}
                        <Text>{' · '}</Text>
                        <Text
                          accessibilityRole="link"
                          onPress={() => jumpTo('actions')}
                          style={styles.phasedLink}
                        >
                          {'See dates\u00A0'}
                          <Text aria-hidden style={styles.phasedArrow}>
                            →
                          </Text>
                        </Text>
                      </Text>
                    ) : null}
                    {/* Said next to the status because that status reads
                        "Introduced" on 1,190 bills whose record has already
                        stopped talking about them and pointed elsewhere (#757). */}
                    {vm.datePointer ? (
                      <Text style={styles.pointerCaption}>{POINTER_CAPTION}</Text>
                    ) : null}
                  </View>
                ) : null}

                <View style={[styles.factsBlock, styles.factsDivider]}>
                  <Text style={styles.factsLabel}>{chamberBillLabel(bill.identifier)}</Text>
                  <View style={styles.codeBadgeWrap}>
                    <Text style={styles.codeBadge}>{bill.identifier}</Text>
                  </View>
                  <View style={styles.factsLinks}>
                    {vm.overviewUrl ? (
                      <TextLink
                        label="Bill overview"
                        arrow
                        href={vm.overviewUrl}
                        external
                        onPress={() => openExternal(vm.overviewUrl as string)}
                      />
                    ) : null}
                    {vm.readUrl ? (
                      <TextLink
                        label={vm.readLabel}
                        arrow
                        href={vm.readUrl}
                        external
                        onPress={() => openExternal(vm.readUrl as string)}
                      />
                    ) : null}
                  </View>
                  {/* Companion bill (#293): the paired House/Senate file. A grey
                      label + green value row (matching web) — the arrow sits at the
                      END of the value, never after "Companion". Links to the
                      companion's bill page (URL-addressable, grounded-answers rule 5);
                      shown only when the pair is linked. */}
                  {bill.companion ? (
                    <View style={styles.companionRow}>
                      <Text style={styles.factsKvKey}>Companion</Text>
                      <TextLink
                        label={`${bill.companion.chamber} (${bill.companion.identifier})`}
                        arrow
                        href={routePath.bill(bill.companion.id)}
                        onPress={() =>
                          navigation.navigate('BillDetail', { billId: bill.companion!.id })
                        }
                      />
                    </View>
                  ) : null}
                </View>

                {vm.chief ? (
                  <View style={[styles.factsBlock, styles.factsDivider]}>
                    <View style={styles.factsHeaderRow}>
                      <Text style={styles.factsLabel}>CHIEF AUTHOR</Text>
                      {vm.coauthors > 0 ? (
                        <Text style={styles.coauthors}>+{vm.coauthors} co-authors</Text>
                      ) : null}
                    </View>
                    {/* Aligned label -> value rows. Honorific is the grey label,
                        only the name + arrow is the green link; party and district
                        match. Party/District rows shown only when known — unknown
                        values (party null, "S-unknown" district) are a backend join
                        gap (#302), not shown as a wrong fallback. */}
                    <View style={styles.factsRows}>
                      <View style={styles.factsKvRow}>
                        <Text style={styles.factsKvKey}>{authorTitleLabel(vm.chief.chamber)}</Text>
                        {vm.chief.legislatorId ? (
                          <TextLink
                            label={authorNameOnly(vm.chief.name)}
                            arrow
                            href={routePath.legislator(vm.chief.slug ?? vm.chief.legislatorId)}
                            onPress={() =>
                              navigation.navigate('LegislatorProfile', {
                                legislatorId: vm.chief!.slug ?? vm.chief!.legislatorId,
                              })
                            }
                          />
                        ) : (
                          <Text style={styles.authorNamePlain}>
                            {authorNameOnly(vm.chief.name)}
                          </Text>
                        )}
                      </View>
                      {vm.chief.party ? (
                        <View style={styles.factsKvRow}>
                          <Text style={styles.factsKvKey}>Party</Text>
                          <Text style={styles.factsKvVal}>{partyFull(vm.chief.party)}</Text>
                        </View>
                      ) : null}
                      {isKnownDistrict(vm.chief.district) ? (
                        <View style={styles.factsKvRow}>
                          <Text style={styles.factsKvKey}>
                            {districtRowLabel(vm.chief.chamber)}
                          </Text>
                          <Text style={styles.factsKvVal}>
                            {formatAuthorDistrict(vm.chief.district, vm.chief.representedCity)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {vm.issues.length > 0 ? (
                  <View style={[styles.factsBlock, styles.factsDivider]}>
                    <Text style={styles.factsLabel}>ISSUES</Text>
                    <View style={styles.issueRow}>
                      {vm.issues.map((topic) => (
                        <View key={topic} style={styles.issueChip}>
                          <Text style={styles.issueChipText}>{titleCaseIssue(topic)}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>

              {/* Ask about this bill */}
              <AskCard
                billId={bill.id}
                identifier={bill.identifier}
                sessionLabel={bill.sessionLabel}
                questionPrompts={bill.questionPrompts}
                onAsk={goAsk}
              />
            </Section>

            {/* 4 — Actions */}
            <Section id="actions" onLayout={onSectionLayout}>
              <Text accessibilityRole="header" style={styles.h2}>
                Actions
              </Text>
              <Text style={styles.intro}>Every official step this bill has taken.</Text>
              <ActionLegend />
              {vm.actionRows.length > 0 ? (
                <MobileActionsTimeline
                  rows={vm.actionRows}
                  glossary={vm.actionGlossary}
                  onViewVotes={vm.hasVotes ? () => jumpTo('votes') : undefined}
                  onOpenBill={(billId) => navigation.navigate('BillDetail', { billId })}
                  onOpenLegislator={openLegislator}
                />
              ) : (
                <Text style={styles.emptyLine}>No recorded actions yet.</Text>
              )}
            </Section>

            {/* 5 — Votes */}
            <Section id="votes" onLayout={onSectionLayout}>
              <Text accessibilityRole="header" style={styles.h2}>
                Votes
              </Text>
              {vm.hasVotes ? (
                <MobileVotesSection
                  rolls={vm.rolls}
                  chiefParty={vm.chief?.party}
                  onOpenLegislator={openLegislator}
                  onOpenUrl={openExternal}
                />
              ) : (
                <View style={styles.noVotes}>
                  <View style={styles.noVotesIcon}>
                    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M7 5 V19 M7 19 L3.5 15.5 M7 19 L10.5 15.5 M14 8 h6 M14 13 h4"
                        stroke={t.colors.text.faint}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  </View>
                  <Text accessibilityRole="header" style={styles.noVotesHeading}>
                    No recorded roll-call votes
                  </Text>
                  <Text style={styles.noVotesBody}>
                    We don’t have recorded roll-call votes to show for {bill.identifier}. When a
                    chamber’s recorded vote is available, it appears here.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => goAsk()}
                    style={styles.noVotesAsk}
                  >
                    <Text style={styles.noVotesAskText}>Ask about this bill</Text>
                    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M6 12 H18 M13 7 L18 12 L13 17"
                        stroke={t.colors.white}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  </Pressable>
                </View>
              )}
            </Section>

            {/* 6 — Versions */}
            <Section id="versions" onLayout={onSectionLayout}>
              <Text accessibilityRole="header" style={styles.h2}>
                Versions
              </Text>
              <Text style={styles.intro}>
                A bill’s exact wording changes as it moves through the Legislature. Each version is
                a snapshot of the full text at one stage.
              </Text>
              {bill.versions.length > 0 ? (
                <View style={styles.versionList}>
                  {orderBillVersions(bill.versions, bill.actions).map((v, i) => (
                    <VersionRow
                      key={`${v.id}-${i}`}
                      label={v.label}
                      date={formatMonoDate(v.date)}
                      isLaw={vm.tone === 'green' && /session law|chapter/i.test(v.label)}
                      href={v.url}
                      onPress={v.url ? () => openExternal(v.url) : undefined}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyLine}>No published versions yet.</Text>
              )}
            </Section>

            {/* 7 — Bill Text */}
            <Section id="fulltext" onLayout={onSectionLayout} style={styles.lastSection}>
              <Text accessibilityRole="header" style={styles.h2}>
                Bill Text
              </Text>
              <FullTextTab
                bill={bill}
                targetSectionAnchor={ftAnchor}
                onAnchorConsumed={() => setFtAnchor(null)}
                updatedLabel={vm.updatedLabel}
              />
            </Section>
          </>
        )}

        {/* Outside the state branch on purpose: every state ends with the footer
            (loading, bill-not-found, load error, loaded), the way the web screen
            already does. On the short states it pins to the bottom of the window
            — see styles.footer in theme/primitives.tsx. */}
        <Footer
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>

      {/* SHARE SHEET */}
      <BottomSheet visible={shareOpen} onClose={() => setShareOpen(false)} label="Share sheet">
        <View style={styles.sheetIconPurple}>
          <ShareIcon color={t.colors.purple.base} size={22} />
        </View>
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          Share this bill
        </Text>
        <Text style={styles.sheetSub} numberOfLines={2}>
          {shareTitle}
        </Text>
        <View style={styles.shareUrlField}>
          <Text numberOfLines={1} style={styles.shareUrlText}>
            {shareUrl}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy link"
          onPress={copyLink}
          style={styles.copyBtn}
        >
          {copied ? (
            <>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M5 12.5 L10 17.5 L19 7"
                  stroke={t.colors.brand.darkest}
                  strokeWidth={2.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <Text style={styles.copyBtnText}>Link copied</Text>
            </>
          ) : (
            <Text style={styles.copyBtnText}>Copy link</Text>
          )}
        </Pressable>
        <View style={styles.shareToRow}>
          <Text style={styles.shareToLabel}>SHARE TO</Text>
          <View style={styles.socialRow}>
            <SocialButton
              label="Share on LinkedIn"
              onPress={() =>
                openExternal(
                  `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
                )
              }
              path="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"
              filled
            />
            <SocialButton
              label="Share on X"
              onPress={() =>
                openExternal(
                  `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareTitle + ' · Alethical')}&url=${encodeURIComponent(shareUrl)}`,
                )
              }
              path="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
              filled
            />
            <SocialButton
              label="Share on Facebook"
              onPress={() =>
                openExternal(
                  `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
                )
              }
              path="M15.12 5.32H17V2.14A26.11 26.11 0 0 0 14.26 2c-2.72 0-4.58 1.66-4.58 4.7v2.6H6.61v3.56h3.07V22h3.68v-9.14h3.06l.46-3.56h-3.52V7.05c0-1.03.28-1.73 1.76-1.73z"
              filled
            />
            <SocialButton
              label="Share by email"
              onPress={() =>
                openExternal(
                  `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(shareTitle + '\n\n' + shareUrl + '\n\nvia Alethical')}`,
                )
              }
              path="M4 7.5 L12 13 L20 7.5"
              rect
            />
          </View>
        </View>
      </BottomSheet>

      {/* NOTE: the Votes section has no sign-in / "see how your legislators voted"
          promotion. Per-district personalization isn't wired yet, so we don't advertise
          it (no unshippable capability). Sign-in stays available via the top nav. */}
    </View>
  );
}

// --- sub-components ---------------------------------------------------------

function ShareButton({ onPress }: { onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Share this bill"
      onPress={onPress}
      {...hover}
      style={[styles.shareBtn, hovered && { backgroundColor: t.colors.surfaces.s400 }]}
    >
      <ShareIcon />
      <Text style={styles.shareBtnText}>Share</Text>
    </Pressable>
  );
}

function JumpChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      aria-current={active ? 'location' : undefined}
      onPress={onPress}
      {...hover}
      style={[styles.jumpChip, active ? styles.jumpChipActive : hovered && styles.jumpChipHover]}
    >
      <Text style={[styles.jumpChipText, active && styles.jumpChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ActionLegend() {
  const items: Array<{ label: string; render: () => React.ReactNode }> = [
    {
      label: 'Enacted milestone',
      render: () => <View style={[styles.legendDot, { backgroundColor: t.colors.brand.base }]} />,
    },
    {
      label: 'Recorded vote',
      render: () => <View style={[styles.legendDot, { backgroundColor: t.colors.ink }]} />,
    },
    {
      label: 'Procedural step',
      render: () => (
        <View
          style={[
            styles.legendDot,
            {
              backgroundColor: t.colors.white,
              borderWidth: 2,
              borderColor: t.colors.borders.strong,
            },
          ]}
        />
      ),
    },
    {
      label: 'Not adopted',
      render: () => (
        <View style={[styles.legendDot, { backgroundColor: t.colors.status.vetoedStep }]} />
      ),
    },
    {
      label: 'Scheduled',
      render: () => (
        <View
          style={[
            styles.legendDot,
            {
              backgroundColor: t.colors.white,
              borderWidth: 2,
              borderColor: t.colors.brand.base,
              borderStyle: 'dashed',
            },
          ]}
        />
      ),
    },
  ];
  return (
    <View style={styles.legend}>
      {items.map((it) => (
        <View key={it.label} style={styles.legendItem}>
          {it.render()}
          <Text style={styles.legendText}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

// Up to this many co-author names show before the group row collapses the rest
// behind a "+N more" toggle — same cap as the web Actions tab.
const NAME_CAP = 3;

// The curated timeline plus its plain-language key, in mobile's single-column
// sizing. Every row already arrived cooked from buildActionTimeline; this only
// owns the layout and the per-group "+N more" open/closed state.
function MobileActionsTimeline({
  rows,
  glossary,
  onViewVotes,
  onOpenBill,
  onOpenLegislator,
}: {
  rows: TimelineRow[];
  glossary: Array<{ term: string; def: string }>;
  onViewVotes?: () => void;
  onOpenBill: (billId: string) => void;
  onOpenLegislator: (legislatorId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <View style={styles.timeline}>
        {rows.map((row) => (
          <ActionRow
            key={row.id}
            row={row}
            expanded={expanded.has(row.id)}
            onToggle={() => toggle(row.id)}
            onViewVotes={row.showVotes ? onViewVotes : undefined}
            onOpenBill={onOpenBill}
            onOpenLegislator={onOpenLegislator}
          />
        ))}
      </View>
      {glossary.length ? (
        <View style={styles.actionKeyBox}>
          <Text style={styles.actionKeyLabel}>PLAIN-LANGUAGE KEY</Text>
          <View style={styles.actionKeyList}>
            {glossary.map((g) => (
              <Text key={g.term} style={styles.actionKeyItem}>
                <Text style={styles.actionKeyTerm}>{g.term}</Text>
                <Text> — {g.def}</Text>
              </Text>
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}

function ActionRow({
  row,
  expanded,
  onToggle,
  onViewVotes,
  onOpenBill,
  onOpenLegislator,
}: {
  row: TimelineRow;
  expanded: boolean;
  onToggle: () => void;
  onViewVotes?: () => void;
  onOpenBill: (billId: string) => void;
  onOpenLegislator: (legislatorId: string) => void;
}) {
  // A row's title is grey for exactly ONE reason: the step hasn't happened yet.
  // Same rule and same token as the web tab (#734) — a past step dimmed by type
  // would read as pending.
  const scheduled = row.dot === 'scheduled';
  const names = row.authors ?? [];
  const dotStyle = (() => {
    switch (row.dot) {
      case 'green':
        return { backgroundColor: t.colors.brand.base };
      case 'red':
        return { backgroundColor: t.colors.status.vetoedStep };
      case 'vote':
        return { backgroundColor: t.colors.ink };
      case 'scheduled':
        return {
          backgroundColor: t.colors.white,
          borderWidth: 2,
          borderColor: t.colors.brand.base,
          borderStyle: 'dashed' as const,
        };
      default:
        return {
          backgroundColor: t.colors.white,
          borderWidth: 2,
          borderColor: t.colors.borders.strong,
        };
    }
  })();
  return (
    <View style={styles.actionRow}>
      <View style={styles.actionRail}>
        <View style={styles.actionRailLine} />
        <View style={[styles.actionDot, dotStyle]} />
      </View>
      <View style={styles.actionBody}>
        {/* An author group spanning several days states both ends; every other row
            states its one date. Already display-formatted by the shared builder. */}
        {row.dateRange || row.date ? (
          <Text style={styles.actionDate}>{row.dateRange || row.date}</Text>
        ) : null}
        <View style={styles.actionTitleRow}>
          {names.length ? (
            <ActionAuthorTitle
              names={names}
              expanded={expanded}
              onToggle={onToggle}
              onOpenLegislator={onOpenLegislator}
            />
          ) : (
            <Text style={[styles.actionTitle, scheduled && styles.actionTitleScheduled]}>
              {/* A "See also HF 2446" row links the code to that bill's page. Same
                  shared segments the web tab uses, so what is tappable cannot
                  differ between the two surfaces (#745). */}
              {titleSegments(row).map((seg, i) =>
                seg.billId ? (
                  <Text
                    key={i}
                    accessibilityLabel={`Open ${seg.text}`}
                    {...linkProps(routePath.bill(seg.billId), () => onOpenBill(seg.billId!))}
                    style={styles.actionBillCodeLink}
                  >
                    {seg.text}
                  </Text>
                ) : (
                  <Text key={i}>{seg.text}</Text>
                ),
              )}
            </Text>
          )}
          {row.tally ? (
            <View style={styles.actionTally}>
              <Text style={styles.actionTallyText}>{row.tally}</Text>
            </View>
          ) : null}
          {scheduled ? (
            <View style={styles.scheduledBadge}>
              <Text style={styles.scheduledBadgeText}>SCHEDULED</Text>
            </View>
          ) : null}
        </View>
        {row.meta ? <Text style={styles.actionMeta}>{row.meta}</Text> : null}
        {/* What each bill a "See also" row points at actually IS — one quiet line
            per target, from that target's own record (#757). Same shared helper the
            web tab uses, so neither surface can describe a target the other one
            doesn't. */}
        {crossReferenceTargets(row).map((target) => (
          <Text
            key={target.code}
            accessibilityLabel={`Open ${target.code}${
              target.status ? `, ${target.status}` : ''
            }: ${target.title}`}
            // A real anchor, like every other in-app link since #770, so ⌘-click
            // and right-click behave as they do anywhere else on the web.
            {...linkProps(routePath.bill(target.billId), () => onOpenBill(target.billId))}
            style={styles.actionTargetLine}
          >
            <Text style={styles.actionTargetCode}>{target.code}</Text>
            <Text>{` — ${target.title}`}</Text>
            {target.status ? (
              <Text style={styles.actionTargetStatus}>{` · ${target.status}`}</Text>
            ) : null}
          </Text>
        ))}
        {/* The sections that state no date. Deliberately UNDATED — no dot and
            nothing in the date column — because placing it on a day would mean
            picking one of the two Minn. Stat. 645.02 candidates (#715). */}
        {row.note ? (
          <View style={styles.undatedNote}>
            <Text style={styles.undatedNoteText}>{row.note}</Text>
          </View>
        ) : null}
        {onViewVotes ? <TextLink label="View votes →" size={15} onPress={onViewVotes} /> : null}
      </View>
    </View>
  );
}

// A collapsed co-author group: "N co-authors added — name, name, name +M more".
// Names past NAME_CAP hide behind an in-place toggle. It reads in the same weight
// and ink as any other row that has happened — the collapsing is what keeps it
// quiet, not a dimmer treatment.
//
// Each name is the member's full name, tapping through to their profile — resolved
// by the shared builder from the bill's own author list, so this surface and the web
// tab link the same names. One the builder could not pin to a single member stays as
// the record wrote it, plain and untappable.
function ActionAuthorTitle({
  names,
  expanded,
  onToggle,
  onOpenLegislator,
}: {
  names: TimelineAuthor[];
  expanded: boolean;
  onToggle: () => void;
  onOpenLegislator: (legislatorId: string) => void;
}) {
  const isGroup = names.length > 1;
  const hidden = isGroup ? Math.max(0, names.length - NAME_CAP) : 0;
  const shown = !isGroup || expanded ? names : names.slice(0, NAME_CAP);
  return (
    <Text style={styles.actionTitle}>
      {authorAddPrefix(names.length)}
      {shown.map((author, i) => (
        <Text key={`${author.label}-${i}`}>
          {i > 0 ? ', ' : ''}
          {author.legislatorId ? (
            <Text
              accessibilityLabel={`Open ${author.label}'s profile`}
              {...linkProps(routePath.legislator(author.slug ?? author.legislatorId), () =>
                onOpenLegislator((author.slug ?? author.legislatorId) as string),
              )}
              style={styles.actionBillCodeLink}
            >
              {author.label}
            </Text>
          ) : (
            <Text>{author.label}</Text>
          )}
        </Text>
      ))}
      {hidden > 0 ? (
        <Text onPress={onToggle} style={styles.actionMoreLink}>
          {expanded ? '  show less' : `  +${hidden} more`}
        </Text>
      ) : null}
    </Text>
  );
}

type RollFilter = 'all' | 'yes' | 'no' | 'abs';

// Votes section — roll-call cards as one-open-at-a-time accordions with party-grouped
// member grids, crossover dots, and filter + search. Mirrors the
// shipped web VotesTab (components/billDetail/VotesTab) with mobile sizing + a single
// open roll. Grounded framing (grounded-answers rule 3): describe records, never assert
// an inferred partisan pattern — the party grouping + crossover legend only frame when
// per-member data AND the chief author's party are known.
function MobileVotesSection({
  rolls,
  chiefParty,
  onOpenLegislator,
  onOpenUrl,
}: {
  rolls: { vote: VoteEvent; norm: NormalizedMotion }[];
  chiefParty: string | undefined;
  onOpenLegislator: (legislatorId: string) => void;
  onOpenUrl: (url: string) => void;
}) {
  // One roll open at a time on mobile (spec §Votes — roll accordion). Seed the first
  // roll open so the member grid is discoverable without a tap.
  const [openRoll, setOpenRoll] = useState<number>(0);
  const [howToOpen, setHowToOpen] = useState(false);

  const hasMemberData = rolls.some((r) => r.vote.votes.length > 0);
  const partyKnown = !!chiefParty && chiefParty.trim() !== '';
  const framed = hasMemberData && partyKnown;
  const chief = partyFull(chiefParty);

  return (
    <View>
      <Text style={styles.intro}>
        Each recorded <Text style={styles.introStrong}>roll call</Text> lists how members voted.
      </Text>

      {framed ? (
        <View style={styles.howTo}>
          <Pressable
            accessibilityRole="button"
            aria-expanded={howToOpen}
            onPress={() => setHowToOpen((v) => !v)}
            style={styles.howToHead}
          >
            <Text style={styles.howToTitle}>How to read a roll call</Text>
            <Chevron up={howToOpen} color={t.colors.text.muted} />
          </Pressable>
          {howToOpen ? (
            <View style={styles.howToBody}>
              <Text style={styles.howToText}>
                The chief author is a <Text style={styles.introStrong}>{chief}</Text> legislator.
                Each roll call below groups members by party, with each block’s Yes–No split.
              </Text>
              <View style={styles.crossLegend}>
                <View style={styles.crossDotInline} />
                <Text style={styles.crossLegendText}>
                  marks members who voted against their party’s majority
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.rollList}>
        {rolls.map(({ vote, norm }, i) => (
          <MobileRollCard
            key={vote.id}
            vote={vote}
            norm={norm}
            open={openRoll === i}
            onToggle={() => setOpenRoll((cur) => (cur === i ? -1 : i))}
            onOpenLegislator={onOpenLegislator}
            onOpenUrl={onOpenUrl}
          />
        ))}
      </View>
    </View>
  );
}

function MobileRollCard({
  vote,
  norm,
  open,
  onToggle,
  onOpenLegislator,
  onOpenUrl,
}: {
  vote: VoteEvent;
  norm: NormalizedMotion;
  open: boolean;
  onToggle: () => void;
  onOpenLegislator: (legislatorId: string) => void;
  onOpenUrl: (url: string) => void;
}) {
  const [filter, setFilter] = useState<RollFilter>('all');
  const [search, setSearch] = useState('');
  const { focused, focusProps } = useFieldFocus();

  const passed = norm.passed;
  const chamberLabel = vote.chamber ?? '';
  const { yes, no, absent } = vote.breakdown;
  const total = yes + no + absent;
  const barYes = total > 0 ? (yes / total) * 100 : 0;
  const barNo = total > 0 ? (no / total) * 100 : 0;
  const hasMembers = vote.votes.length > 0;

  // Consistent per-member honorific (Sen./Rep.) from this roll's chamber, applied
  // before grouping so bare names no longer sort above "Senator "-prefixed ones.
  const blocks = useMemo(
    () =>
      hasMembers
        ? buildPartyBlocks(
            vote.votes.map((v) => ({ ...v, name: normalizeMemberName(v.name, vote.chamber) })),
          )
        : [],
    [vote.votes, vote.chamber, hasMembers],
  );
  if (hasMembers) validateRoll(blocks, yes, no);

  const q = search.trim().toLowerCase();
  const matchTab = (m: MemberVote) =>
    filter === 'all'
      ? true
      : filter === 'yes'
        ? m.vote === 'YES'
        : filter === 'no'
          ? m.vote === 'NO'
          : m.vote === 'ABSENT';
  const matchQ = (m: MemberVote) => !q || m.name.toLowerCase().includes(q);

  return (
    <View style={styles.rollCard}>
      <Pressable
        accessibilityRole={hasMembers ? 'button' : undefined}
        aria-expanded={hasMembers ? open : undefined}
        accessibilityLabel={
          hasMembers
            ? `${chamberLabel} ${norm.title}. ${yes} yes, ${no} no, ${passed ? 'passed' : 'failed'}. ${open ? 'Hide' : 'Show'} member votes.`
            : undefined
        }
        onPress={hasMembers ? onToggle : undefined}
        disabled={!hasMembers}
      >
        <View style={styles.rollHeaderRow}>
          <View style={styles.rollHeaderLeft}>
            <Text style={styles.rollMotion}>
              {chamberLabel ? (
                <Text style={styles.rollMotionChamber}>{chamberLabel} · </Text>
              ) : null}
              {norm.title}
            </Text>
            {norm.subline ? <Text style={styles.rollSubline}>{norm.subline}</Text> : null}
          </View>
          <View style={styles.rollTallyCol}>
            <Text style={styles.rollTally}>
              {yes}–{no}
            </Text>
            {absent > 0 ? <Text style={styles.rollAbsent}>{absent} didn’t vote</Text> : null}
          </View>
        </View>
        <View style={styles.rollBadgeRow}>
          {passed ? (
            <View style={styles.passedPill}>
              <Text style={styles.passedPillText}>PASSED</Text>
            </View>
          ) : (
            <View style={styles.failedPill}>
              <Text style={styles.failedPillText}>FAILED</Text>
            </View>
          )}
          {hasMembers ? (
            <View style={styles.seeWho}>
              <Text style={styles.seeWhoText}>{open ? 'Hide members' : 'See who voted'}</Text>
              <Chevron up={open} color={t.colors.brand.graphics} />
            </View>
          ) : null}
        </View>
      </Pressable>

      {/* meta: date + official-record link — outside the toggle so the link isn't
          an interactive element nested inside the accordion button. */}
      {vote.date || vote.officialUrl ? (
        <View style={styles.rollMetaRow}>
          {vote.date ? <Text style={styles.rollMeta}>{formatMonoDate(vote.date)}</Text> : null}
          {vote.date && vote.officialUrl ? <Text style={styles.rollMeta}> · </Text> : null}
          {vote.officialUrl ? <RecordLink url={vote.officialUrl} onOpen={onOpenUrl} /> : null}
        </View>
      ) : null}

      {/* proportion bar — full-chamber denominator, so a non-unanimous roll shows the
          missing members as a neutral remainder rather than a fully-filled bar. */}
      <View style={styles.rollBar}>
        <View style={[styles.rollBarYes, { flexGrow: barYes }]} />
        <View style={[styles.rollBarNo, { flexGrow: barNo }]} />
        {absent > 0 ? <View style={styles.rollBarRest} /> : null}
      </View>

      {open && hasMembers ? (
        <View style={styles.expand}>
          <View style={styles.segmented}>
            <FilterSeg
              label={`All ${total}`}
              active={filter === 'all'}
              onPress={() => setFilter('all')}
            />
            <FilterSeg
              label={`Yes ${yes}`}
              active={filter === 'yes'}
              onPress={() => setFilter('yes')}
            />
            <FilterSeg
              label={`No ${no}`}
              active={filter === 'no'}
              onPress={() => setFilter('no')}
            />
            {absent > 0 ? (
              <FilterSeg
                label={`Didn’t vote ${absent}`}
                active={filter === 'abs'}
                onPress={() => setFilter('abs')}
              />
            ) : null}
          </View>
          <View style={[styles.searchField, ...fieldFocusRing(focused)]}>
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
              <Circle cx={11} cy={11} r={6.5} stroke={t.colors.text.muted} strokeWidth={2} />
              <Path
                d="M16 16 L20 20"
                stroke={t.colors.text.muted}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
            <TextInput
              value={search}
              onChangeText={setSearch}
              onFocus={focusProps.onFocus}
              onBlur={focusProps.onBlur}
              // The placeholder is the field's accessible name — no separate label
              // (that would make screen readers announce placeholder AND label).
              placeholder="Find a legislator"
              placeholderTextColor={t.colors.text.faint}
              style={[styles.searchInput, fieldOutlineReset]}
            />
          </View>

          <View style={styles.blocks}>
            {blocks.map((block) => (
              <PartyBlockView
                key={block.party}
                block={block}
                filtered={block.members.filter((m) => matchTab(m) && matchQ(m))}
                onOpenLegislator={onOpenLegislator}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function PartyBlockView({
  block,
  filtered,
  onOpenLegislator,
}: {
  block: PartyBlock;
  filtered: MemberVote[];
  onOpenLegislator: (legislatorId: string) => void;
}) {
  return (
    <View>
      <View style={styles.blockHead}>
        <Text style={styles.blockLabel}>{block.label}</Text>
        <Text style={styles.blockMeta}>{block.seats}</Text>
        <Text style={styles.blockMeta}>·</Text>
        <Text style={styles.blockSplit}>
          <Text style={styles.blockYes}>{block.yes} Yes</Text>
          <Text style={styles.blockMeta}> · </Text>
          <Text style={styles.blockNo}>{block.no} No</Text>
        </Text>
        {block.absent > 0 ? (
          <Text style={styles.blockMeta}>· {block.absent} didn’t vote</Text>
        ) : null}
      </View>
      {filtered.length ? (
        <View style={styles.chips}>
          {filtered.map((m) => (
            <MemberChip
              key={m.legislatorId}
              member={m}
              onPress={() => onOpenLegislator(m.slug ?? m.legislatorId)}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.blockEmpty}>No members in this group.</Text>
      )}
    </View>
  );
}

function MemberChip({ member, onPress }: { member: MemberVote; onPress: () => void }) {
  const yea = member.vote === 'YES';
  const nay = member.vote === 'NO';
  return (
    <Pressable
      accessibilityLabel={`${member.name}, voted ${member.vote.toLowerCase()}${member.crossover ? ', crossed party lines' : ''}`}
      {...linkProps(routePath.legislator(member.slug ?? member.legislatorId), onPress)}
      style={({ pressed }) => [
        styles.chip,
        yea ? styles.chipYes : nay ? styles.chipNo : styles.chipAbs,
        pressed && styles.chipPressed,
      ]}
    >
      <Text
        style={[
          styles.chipMark,
          yea ? styles.chipYesText : nay ? styles.chipNoText : styles.chipAbsText,
        ]}
      >
        {yea ? '✓' : nay ? '✕' : '–'}
      </Text>
      <Text
        style={[
          styles.chipName,
          yea ? styles.chipYesText : nay ? styles.chipNoText : styles.chipAbsText,
        ]}
      >
        {member.name}
      </Text>
      {member.crossover ? <View style={styles.crossDot} /> : null}
    </Pressable>
  );
}

function FilterSeg({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      aria-pressed={active}
      onPress={onPress}
      style={({ pressed }) => [
        styles.seg,
        active && styles.segActive,
        pressed && !active && styles.segPressed,
      ]}
    >
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

function RecordLink({ url, onOpen }: { url: string; onOpen: (url: string) => void }) {
  return (
    <Pressable {...externalLinkProps(url, () => onOpen(url))}>
      {({ pressed }) => (
        <Text style={[styles.recordLink, pressed && styles.recordLinkPressed]}>
          Official record →
        </Text>
      )}
    </Pressable>
  );
}

function VersionRow({
  label,
  date,
  isLaw,
  href,
  onPress,
}: {
  label: string;
  date: string;
  isLaw: boolean;
  // Absent when the version carries no official document — the row then falls
  // back to a plain (inert) link so it still renders without a destination.
  href?: string;
  onPress?: () => void;
}) {
  const [hovered, hover] = useHover();
  const tag = isLaw ? null : versionTrackTag(label);
  const anchor = href
    ? externalLinkProps(href, onPress)
    : { accessibilityRole: onPress ? ('link' as const) : undefined, onPress };
  return (
    <Pressable
      accessibilityLabel={`${isLaw ? 'Read the full law' : 'Read the bill text'} — ${label}`}
      disabled={!onPress}
      {...anchor}
      {...hover}
      style={[styles.versionRow, hovered && onPress ? styles.versionRowHover : null]}
    >
      <View style={styles.versionIcon}>
        <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
          <Path
            d="M7 3.5 h7 l4 4 v13 h-11 Z M14 3.5 v4 h4 M9.5 12 h5 M9.5 15.5 h5"
            stroke={t.colors.text.secondary}
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      </View>
      <View style={styles.versionBody}>
        <View style={styles.versionLabelRow}>
          <Text style={styles.versionLabel}>{label}</Text>
          {isLaw ? (
            <View style={styles.chapterChip}>
              <Text style={styles.chapterChipText}>SESSION LAW</Text>
            </View>
          ) : tag ? (
            <View style={styles.versionTrackTag}>
              <Text style={styles.versionTrackTagText}>{tag}</Text>
            </View>
          ) : null}
        </View>
        {date ? <Text style={styles.versionDate}>{date}</Text> : null}
        {onPress ? (
          <Text style={styles.versionLink}>
            {isLaw ? 'Read the full law →' : 'Read the bill text →'}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// Chips-only: free-form Ask is on the roadmap, not shipped, so a typable field
// would over-promise. Matches the Answer page's "Ask another question", which is
// already chips-only, and stays identical to the web SummaryTab Ask module.
function AskCard({
  billId,
  identifier,
  sessionLabel,
  questionPrompts,
  onAsk,
}: {
  billId: string;
  identifier: string;
  sessionLabel?: string;
  questionPrompts: string[] | undefined;
  onAsk: (q?: string) => void;
}) {
  // Bill-specific chips from the served question_prompts, shared with the web
  // SummaryTab so the chip set is identical on both surfaces (#627).
  const { chips } = askCardPrompts(questionPrompts);
  return (
    <View style={styles.askCard}>
      <Text accessibilityRole="header" style={styles.askTitle}>
        Ask about this bill
      </Text>
      <Text style={styles.askSub}>Answers cite the bill text</Text>
      {/* System-suggested chips scope to this bill (`${id}: ${chip}`) so the
          /ask bill_text path always resolves — a chip can never refuse
          (grounded-answers rule 2). Each is a real anchor to its own answer URL,
          matching the Answer page's "Ask another question". */}
      {chips.length ? (
        <View style={styles.askChips}>
          {chips.map((chip) => {
            const scoped = scopedChipQuery(identifier, chip, sessionLabel);
            return (
              <SuggestedQuestionChip
                key={chip}
                label={chip}
                linkProps={linkProps(routePath.ask({ q: scoped, billId }), () => onAsk(scoped))}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function SocialButton({
  label,
  onPress,
  path,
  filled,
  rect,
}: {
  label: string;
  onPress: () => void;
  path: string;
  filled?: boolean;
  rect?: boolean;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      {...hover}
      style={[styles.social, hovered && { backgroundColor: '#e7e8ec' }]}
    >
      <Svg
        width={21}
        height={21}
        viewBox="0 0 24 24"
        fill={filled ? t.colors.text.primary : 'none'}
      >
        {rect ? (
          <>
            <Path
              d="M3 5 h18 v14 h-18 Z"
              stroke={t.colors.text.primary}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <Path
              d={path}
              stroke={t.colors.text.primary}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <Path d={path} />
        )}
      </Svg>
    </Pressable>
  );
}

// A bottom sheet built on RN Modal (escapes stacking contexts, per design-build).
function BottomSheet({
  visible,
  onClose,
  label,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable
          style={styles.sheet}
          accessibilityViewIsModal
          accessibilityLabel={label}
          onPress={(e) => e.stopPropagation?.()}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={styles.sheetClose}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M6 6 L18 18 M18 6 L6 18"
                stroke={t.colors.text.faint}
                strokeWidth={2.2}
                strokeLinecap="round"
              />
            </Svg>
          </Pressable>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const COLUMN_MAX = 640;

const styles = StyleSheet.create({
  // Flat cool-grey page ground (replaces the old multi-stop gradient + green
  // radial wash). White panels sit on it; grey shows only in the gaps.
  pageGround: { flex: 1, backgroundColor: GROUND },
  scroll: { flex: 1 },
  // flexGrow: 1 fills the window on a short page so the footer lands at the
  // bottom (styles.footer in theme/primitives.tsx) instead of leaving a band
  // of background below it.
  scrollContent: { flexGrow: 1 },
  // skeleton loading state (mirrors header + first content section)
  skGap8: { marginTop: 8 },
  skGap14: { marginTop: 14 },
  skGap20: { marginBottom: 20 },
  skGap24: { marginTop: 24 },
  skStatusRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  skLines: { marginTop: 16, gap: 12 },
  stateBox: { paddingVertical: 80, paddingHorizontal: 20, alignItems: 'center', gap: 14 },
  stateText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.muted,
    textAlign: 'center',
  },

  // shared column
  column: { width: '100%', maxWidth: COLUMN_MAX, alignSelf: 'center', paddingHorizontal: 20 },

  // The top nav sits on white, so it reads as the top of the header's white surface
  // (nav → title → status/flags → tabs is one continuous white block) rather than a
  // grey strip above it. zIndex keeps the nav — and its dropdowns/drawer — above the
  // sticky chip bar (zIndex 50) when both are on screen.
  navSurface: { backgroundColor: t.colors.surfaces.base, zIndex: 60 },

  // header — the continuation of that white surface, so the neutral status pill, the
  // "🔥 Hot issue" flag and the OMNIBUS tag pop against white (matching web) instead
  // of blending into a grey header. paddingTop is white breathing room below the nav
  // (the nav now sits on the same white surface, not on the grey ground).
  headerOuter: {
    position: 'relative',
    backgroundColor: t.colors.surfaces.base,
    paddingTop: 26,
    paddingBottom: 18,
  },
  h1: {
    fontFamily: t.typography.title,
    fontSize: 32,
    lineHeight: 35,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.64,
    color: t.colors.text.primary,
  },
  // Long statutory-title fallback (no AI short title): smaller + clamped.
  h1Long: { fontSize: 23, lineHeight: 29, letterSpacing: -0.3 },
  statusRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  statusRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pillDot: { width: 10, height: 10, borderRadius: 5 },
  pillLabel: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
  },
  omnibusTag: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: GHOST_AMBER_BORDER,
    backgroundColor: 'transparent',
  },
  omnibusTagText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.84,
    color: AMBER_TEXT,
  },
  // Neutral "🔥 Hot issue" flag — same treatment as the web BillResultCard pill
  // (#f1f1f4 bg, rgba(17,21,15,0.08) border, #4f5651 text, 999 radius), but sized
  // to THIS header's tag tier (12px, matching OMNIBUS) rather than the larger
  // home-card size. Never amber — amber is reserved for the bill-code badge.
  hotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaces.s400,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.pill,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  hotPillText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.24,
    color: t.colors.text.secondary,
    ...(isWeb ? ({ whiteSpace: 'nowrap' } as object) : null),
  },
  // Track + Share grouped at the right end of the status row.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 10,
    paddingVertical: 10,
    // Leading share glyph, so 3px less on the left (docs/design/design-principles.md §2, Optical centering).
    paddingLeft: 11,
    paddingRight: 14,
    minHeight: 44,
  },
  shareBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  eyebrow: {
    marginTop: 12,
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.medium,
    letterSpacing: 0.78,
    color: t.colors.text.faint,
  },

  // sticky chip bar — CSS position:sticky on web (RNW stickyHeaderIndices is
  // unreliable with fragment children); scrolls away on native.
  chipBar: {
    backgroundColor: t.colors.alpha.white90,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
    zIndex: 50,
    ...(isWeb
      ? ({
          position: 'sticky',
          top: 0,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        } as object)
      : null),
  },
  // Centered wrapper so the chip row's left edge lines up with the section
  // content column on wide viewports (on mobile maxWidth exceeds the viewport,
  // so it's full-width and the chips scroll horizontally).
  chipBarCenter: { width: '100%', maxWidth: COLUMN_MAX, alignSelf: 'center' },
  chipBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  jumpChip: {
    paddingVertical: 9,
    paddingHorizontal: 15,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    backgroundColor: t.colors.surfaces.base,
    minHeight: 40,
    justifyContent: 'center',
  },
  jumpChipActive: { backgroundColor: t.colors.ink, borderColor: t.colors.ink },
  jumpChipHover: { backgroundColor: t.colors.surfaces.s200, borderColor: t.colors.purple.base },
  jumpChipText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  jumpChipTextActive: { color: t.colors.white, fontWeight: t.fontWeights.bold },

  // sections
  // Each content section is a white surface on the grey ground. PANEL_GAP of grey
  // shows above each one, so the ground appears only in the gaps between the white
  // content panels. paddingBottom matches paddingTop now that the panel owns its own
  // bottom breathing room (the old 8 relied on the next section's transparent top
  // padding for separation).
  sectionOuter: {
    backgroundColor: t.colors.surfaces.base,
    marginTop: PANEL_GAP,
    paddingTop: 28,
    paddingBottom: 28,
  },
  // The first (Summary) section drops that top gap: it sits flush under the sticky
  // chip bar, whose own bottom border separates it, so "Key points" starts clean on
  // the white surface instead of behind a second grey band.
  firstSection: { marginTop: 0 },
  lastSection: { paddingBottom: 40 },
  h2: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h2,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.25,
    color: t.colors.text.primary,
  },
  intro: {
    marginTop: 8,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 24,
    color: t.colors.text.muted,
  },
  introStrong: { fontWeight: t.fontWeights.semibold, color: t.colors.text.secondary },
  lede: {
    marginTop: 8,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 24,
    color: t.colors.text.secondary,
  },
  emptyLine: {
    marginTop: 14,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    color: t.colors.text.muted,
  },

  // key points
  points: { marginTop: 18, gap: 15 },
  pointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pointBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.ink,
    marginTop: 9,
  },
  pointText: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subheadLg,
    fontWeight: t.fontWeights.medium,
    lineHeight: 28,
    color: '#2c322c',
  },

  // cited sections strip (mono label + green check, then purple § chips)
  citedStrip: { marginTop: 22 },
  citedLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  citedLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.7,
    color: t.colors.text.faint,
  },
  citedChips: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  citedChip: {
    backgroundColor: t.colors.purple.tint,
    borderWidth: 1,
    borderColor: t.colors.purple.border,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 11,
    // A chip now carries the section's topic, so it can be longer than a phone is
    // wide ("Sec. 2 · Human services systems modernization advisory council").
    // Without these it kept its full intrinsic width and the text was clipped off
    // the right edge; now it stops at the column and wraps to a second line.
    maxWidth: '100%',
    flexShrink: 1,
  },
  citedChipPressed: { opacity: 0.6 },
  citedChipText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.2,
    color: t.colors.purple.base,
  },

  // facts card
  factsCard: {
    marginTop: 28,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 16,
    overflow: 'hidden',
    ...(t.shadows.card as object),
  },
  factsBlock: { paddingVertical: 16, paddingHorizontal: 18 },
  factsDivider: { borderTopWidth: 1, borderTopColor: t.colors.alpha.ink08 },
  factsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  factsLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.6,
    color: t.colors.text.faint,
  },
  factsValue: {
    marginTop: 4,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subheadLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  codeBadgeWrap: { marginTop: 11, flexDirection: 'row' },
  codeBadge: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.6,
    color: AMBER_TEXT,
    backgroundColor: CODE_BADGE_FILL,
    borderWidth: 1,
    borderColor: CODE_BADGE_BORDER,
    borderRadius: t.radii.badge,
    paddingVertical: 6,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  factsLinks: { marginTop: 14, gap: 12, alignItems: 'flex-start' },
  companionRow: { marginTop: 12, flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  coauthors: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    color: t.colors.text.faint,
  },
  authorNamePlain: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  factsRows: { marginTop: 11, gap: 8 },
  factsKvRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  factsKvKey: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: t.colors.text.faint,
    minWidth: 120,
    flexShrink: 0,
  },
  factsKvVal: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.primary,
  },
  issueRow: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  issueChip: {
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  issueChipText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.5,
    color: t.colors.text.secondary,
  },

  // link (shared)
  textLink: {
    fontFamily: t.typography.ui,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
    ...(isWeb && !prefersReducedMotion()
      ? ({ transitionProperty: 'color', transitionDuration: '0.15s' } as object)
      : null),
  },
  // The "→" (U+2192) comes from an OS fallback font (Libre Franklin omits the
  // glyph), whose baseline sits low against the link letters — nudge it up so it
  // optically centers on the text to its left.
  linkArrow: { fontWeight: t.fontWeights.regular, position: 'relative', top: -2 },

  // ask card
  askCard: {
    marginTop: 24,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 16,
    padding: 18,
    ...(t.shadows.card as object),
  },
  askTitle: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h3,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.22,
    color: t.colors.text.primary,
  },
  askSub: {
    marginTop: 6,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.muted,
  },
  askChips: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 8,
  },

  // actions
  legend: {
    marginTop: 22,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendDot: { width: 11, height: 11, borderRadius: 6 },
  legendText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.faint,
  },
  timeline: { marginTop: 26 },
  actionRow: { flexDirection: 'row', gap: 14 },
  // How many sections start on this row's date — only ever counted off sections
  // that STATE that date, never a count resting on an inferred date (#715).
  actionMeta: {
    marginTop: 4,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    color: t.colors.text.muted,
  },
  undatedNote: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#f7f9f8',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 10,
  },
  undatedNoteText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  // Phased caption — mobile's larger 15px type; WRAPS rather than truncating.
  phasedCaption: {
    marginTop: 7,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: t.colors.text.muted,
  },
  phasedLink: { fontWeight: t.fontWeights.bold, color: t.colors.text.green },
  phasedArrow: { fontWeight: t.fontWeights.regular },
  // Same quiet caption weight as the phased-law one: it qualifies the status it
  // sits under rather than competing with it (#757).
  pointerCaption: {
    marginTop: 9,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: t.colors.text.muted,
  },
  actionRail: { width: 24, alignItems: 'center' },
  actionRailLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: t.colors.alpha.ink08,
  },
  actionDot: { marginTop: 6, width: 14, height: 14, borderRadius: 7 },
  actionBody: { flex: 1, paddingBottom: 24 },
  actionDate: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    letterSpacing: 0.5,
    color: t.colors.text.faint,
  },
  actionTitleRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  actionTitle: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.subheadLg,
    fontWeight: t.fontWeights.bold,
    lineHeight: 25,
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  // The ONE reason a title is grey: it hasn't happened yet. Same token as the web
  // tab so the rule cannot drift between the two platforms (#559).
  actionTitleScheduled: { color: t.colors.text.muted },
  actionMoreLink: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.green,
  },
  // A linked bill code inside a "See also" title. Green like every other in-product
  // link, inheriting the title's size and weight so the row's rhythm is unchanged.
  // Underlined, because mid-sentence there is no position to mark it as a link and
  // there is no hover on a phone — colour alone would be the only cue (WCAG 1.4.1).
  actionBillCodeLink: { color: t.colors.text.green, textDecorationLine: 'underline' },
  // What each "See also" target is, one line each (#757). Lighter than the row
  // title: this is the record speaking about ANOTHER bill, not a step this one took.
  actionTargetLine: {
    marginTop: 5,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary,
  },
  // Bold, not mono: the mono face's wide space renders "HF 2446" as "HF  2446",
  // which reads as a typo right under the same code set in body type.
  actionTargetCode: { fontWeight: t.fontWeights.bold },
  actionTargetStatus: { color: t.colors.text.muted },
  actionTally: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: t.radii.badge,
  },
  actionTallyText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  // Plain-language key — one definition per line (mobile is a single column), and
  // separated from the timeline by WHITESPACE rather than the web tab's hairline:
  // a border here collides with the vertical timeline line running down beside it
  // (NEXT-bill-detail-spec.md §Actions).
  actionKeyBox: { marginTop: 18 },
  actionKeyLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
    color: t.colors.text.muted,
  },
  actionKeyList: { marginTop: 12, gap: 9 },
  actionKeyItem: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary,
  },
  actionKeyTerm: { fontWeight: t.fontWeights.bold, color: t.colors.text.primary },
  scheduledBadge: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: t.colors.brand.base,
    borderStyle: 'dashed',
  },
  scheduledBadgeText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.brand.deep,
  },

  // votes
  rollList: { marginTop: 18, gap: 14 },
  rollCard: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 14,
    padding: 18,
    ...(t.shadows.card as object),
  },
  rollHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  rollHeaderLeft: { flex: 1, minWidth: 0 },
  rollMotion: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.subheadLg,
    fontWeight: t.fontWeights.bold,
    lineHeight: 25,
    color: t.colors.text.primary,
  },
  rollMotionChamber: { color: t.colors.text.muted },
  rollSubline: {
    marginTop: 4,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 19,
    color: t.colors.text.faint,
  },
  rollMeta: {
    marginTop: 4,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    letterSpacing: 0.65,
    color: t.colors.text.faint,
  },
  rollTally: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.h3,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  rollTallyCol: { alignItems: 'flex-end' },
  rollAbsent: {
    marginTop: 2,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.label,
    color: t.colors.text.muted,
  },
  rollBadgeRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  seeWho: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  seeWhoText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.4,
    color: t.colors.brand.deep,
  },
  rollMetaRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  recordLink: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.semibold,
    letterSpacing: 0.5,
    color: t.colors.text.green,
  },
  recordLinkPressed: { color: t.colors.brand.forest, textDecorationLine: 'underline' },
  passedPill: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 7,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
  },
  passedPillText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.brand.deep,
  },
  failedPill: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 7,
    backgroundColor: '#fdecec',
    borderWidth: 1,
    borderColor: '#f5c6c4',
  },
  failedPillText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.status.vetoedText,
  },
  rollBar: {
    marginTop: 12,
    flexDirection: 'row',
    height: 9,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: t.colors.status.progressEmpty,
  },
  rollBarYes: { backgroundColor: t.colors.brand.base },
  rollBarNo: { backgroundColor: t.colors.status.vetoedStep },
  rollBarRest: { flexGrow: 1, minWidth: 6, backgroundColor: t.colors.status.progressEmpty },

  // how to read a roll call (collapsible, framed only)
  howTo: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 12,
    backgroundColor: t.colors.surfaces.s200,
  },
  howToHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 12,
    // Trailing chevron, so 3px less on the right (docs/design/design-principles.md §2, Optical centering).
    paddingLeft: 14,
    paddingRight: 11,
  },
  howToTitle: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  howToBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 9,
  },
  howToText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.faint,
  },
  crossLegend: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  crossLegendText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.muted,
    flex: 1,
  },
  crossDotInline: { width: 7, height: 7, borderRadius: 4, backgroundColor: t.colors.omnibus.text },

  // expanded member grid
  expand: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  segmented: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
    backgroundColor: '#eef0f1',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 11,
    flexWrap: 'wrap',
    alignSelf: 'flex-start',
  },
  seg: { borderRadius: 7, paddingVertical: 7, paddingHorizontal: 12 },
  segActive: { backgroundColor: t.colors.text.primary },
  segPressed: { backgroundColor: t.colors.alpha.ink08 },
  segText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  segTextActive: { color: t.colors.white, fontWeight: t.fontWeights.bold },
  searchField: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: t.radii.md,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  searchInput: {
    flex: 1,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    color: t.colors.text.primary,
  },
  blocks: { marginTop: 22, gap: 26 },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  blockLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.text.primary,
  },
  blockMeta: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.muted,
  },
  blockSplit: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
  },
  blockYes: { color: t.colors.brand.deep },
  blockNo: { color: t.colors.dangerRamp.r600 },
  blockEmpty: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.muted,
  },
  chips: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: t.radii.pill,
    borderWidth: 1,
  },
  chipPressed: { opacity: 0.6 },
  chipYes: { backgroundColor: '#e9faf1', borderColor: t.colors.tint.border },
  chipNo: { backgroundColor: '#fdecec', borderColor: '#f5c6c4' },
  chipAbs: { backgroundColor: '#f4f5f4', borderColor: t.colors.alpha.ink08 },
  chipMark: { fontSize: t.fontSizes.meta, fontWeight: t.fontWeights.heavy },
  chipName: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.semibold,
  },
  chipYesText: { color: t.colors.brand.deep },
  chipNoText: { color: t.colors.dangerRamp.r600 },
  chipAbsText: { color: t.colors.text.muted },
  crossDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.omnibus.text },

  // no votes
  noVotes: {
    marginTop: 16,
    alignItems: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.alpha.ink20,
    borderRadius: 18,
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  noVotesIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: t.colors.surfaces.s400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noVotesHeading: {
    marginTop: 18,
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h3,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.22,
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  noVotesBody: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    lineHeight: 25,
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  noVotesAsk: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: t.colors.purple.base,
    borderRadius: t.radii.md,
    paddingVertical: 12,
    // Trailing arrow glyph, so 3px less on the right (docs/design/design-principles.md §2, Optical centering).
    paddingLeft: 22,
    paddingRight: 19,
  },
  noVotesAskText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.white,
  },

  // versions
  versionList: { marginTop: 16, gap: 11 },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
    ...(t.shadows.card as object),
    ...(isWeb
      ? ({ transitionProperty: 'border-color', transitionDuration: '0.15s' } as object)
      : null),
  },
  versionRowHover: { borderColor: t.colors.brand.base },
  versionIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: t.colors.surfaces.s400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versionBody: { flex: 1, minWidth: 0 },
  versionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' },
  versionLabel: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  chapterChip: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: GHOST_AMBER_BORDER,
    backgroundColor: 'transparent',
  },
  chapterChipText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.5,
    color: AMBER_TEXT,
  },
  // Neutral grey track marker (UNOFFICIAL / CONFERENCE) — never amber; amber is
  // reserved for the bill/law CODE and omnibus indicators.
  versionTrackTag: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 7,
    backgroundColor: t.colors.alpha.ink06,
  },
  versionTrackTagText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.1,
    color: t.colors.text.faint,
  },
  versionDate: {
    marginTop: 2,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    letterSpacing: 0.5,
    color: t.colors.text.faint,
  },
  versionLink: {
    marginTop: 8,
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },

  // bottom sheet
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(10,14,12,0.55)',
  },
  sheet: {
    width: '100%',
    maxWidth: COLUMN_MAX,
    alignSelf: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 26,
    paddingBottom: 30,
    paddingHorizontal: 22,
  },
  sheetClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetIconPurple: {
    width: 48,
    height: 48,
    borderRadius: 13,
    backgroundColor: t.colors.purple.tint,
    borderWidth: 1,
    borderColor: t.colors.purple.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    marginTop: 16,
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h3,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.22,
    color: t.colors.text.primary,
  },
  sheetSub: {
    marginTop: 8,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    lineHeight: 25,
    color: t.colors.text.muted,
  },
  shareUrlField: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaces.s300,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink12,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  shareUrlText: {
    flex: 1,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.small,
    color: t.colors.text.secondary,
  },
  copyBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.colors.brand.base,
    borderRadius: 12,
    paddingVertical: 15,
    minHeight: 48,
  },
  copyBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.onGreen,
  },
  shareToRow: {
    marginTop: 20,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  shareToLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.6,
    color: t.colors.text.faint,
  },
  socialRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  social: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: t.colors.surfaces.s400,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
