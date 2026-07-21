import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';
import { MapPin, Search } from 'lucide-react-native';

import { theme, prefersReducedMotion } from '../../theme/tokens';
import {
  Container,
  Footer,
  MNMap,
  PageBackground,
  PrimaryButton,
  TopNav,
} from '../../theme/primitives';
import { IaItem, MenuKey } from '../../navigation/ia';
import { fieldFocusRing } from '../../theme/fieldFocus';
import { useAuth } from '../../providers/AuthProvider';
import { useResponsive } from '../../hooks/useResponsive';
import { useBill, useBills } from '../../hooks/useAppQueries';
import { BillResultCard } from '../../components/search/BillResultCard';
import type { Bill } from '../../data/types';

// The v2 signed-out home — docs/mockups/home-signed-out-v2 (README = state/token/copy
// spec; the .dc.html = literal values). The answer card and the bill cards are STATIC
// marketing illustration built from researched data — not ingestion, not generated
// answers (held decision 2026-07-12, see #143). Do not wire them to data here.

const t = theme;
const isWeb = Platform.OS === 'web';

// Hero ask field auto-grows from one line to a ~4-line cap, then scrolls.
const ASK_MIN_HEIGHT = 60;
const ASK_MAX_HEIGHT = 150;
const ASK_PLACEHOLDER = 'Ask about bills or legislators by issue or name';

// Size the ask textarea (web) to its CONTENT: one line at rest, growing to fit a
// wrapped placeholder/value and shrinking back — never a fixed multi-line height,
// so it neither crops the text nor leaves an empty second line (#468 + follow-up).
// scrollHeight ignores the placeholder, so mirror it into the value only while
// measuring; Math.max floors a text that fits on one line at ASK_MIN_HEIGHT.
const measureAskField = (node: TextInput | null) => {
  if (!isWeb) return;
  const el = node as unknown as HTMLTextAreaElement | null;
  if (!el || typeof el.scrollHeight !== 'number') return;
  const empty = !el.value;
  if (empty) el.value = ASK_PLACEHOLDER;
  el.style.height = 'auto';
  const next = Math.min(Math.max(el.scrollHeight, ASK_MIN_HEIGHT), ASK_MAX_HEIGHT);
  if (empty) el.value = '';
  el.style.height = `${next}px`;
};

// Keep the ask field sized to its content. Measuring only on value change froze a
// stale height: a field measured at its mount width (or with the fallback font,
// before Libre Franklin loads — the fallback is wider and wraps the placeholder)
// stayed two lines tall after it later widened or the font swapped in. So
// also re-measure on the two things that silently change how the text wraps:
//   • the field's WIDTH — a ResizeObserver catches every reflow (viewport resize,
//     layout shift), guarded on width so our own height write can't feed back;
//   • web-font load — `fonts.ready`, since the font changes text metrics without
//     changing the (flex-driven) field width, so the observer alone would miss it.
const useAskAutoGrow = (ref: RefObject<TextInput | null>, value: string) => {
  useLayoutEffect(() => {
    measureAskField(ref.current);
  }, [ref, value]);
  useEffect(() => {
    if (!isWeb) return;
    const el = ref.current as unknown as HTMLElement | null;
    const remeasure = () => measureAskField(ref.current);
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== 'undefined') {
      let lastWidth = -1;
      observer = new ResizeObserver((entries) => {
        const width = Math.round(entries[0]?.contentRect.width ?? 0);
        if (width !== lastWidth) {
          lastWidth = width;
          remeasure();
        }
      });
      observer.observe(el);
    } else {
      window.addEventListener('resize', remeasure);
    }
    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
    fonts?.ready?.then(() => !cancelled && remeasure()).catch(() => {});
    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', remeasure);
    };
  }, [ref]);
};

// .18s ease micro-transitions (README "Hover / focus micro-states") — web only.
const transition = (props: string): object =>
  isWeb && !prefersReducedMotion()
    ? ({
        transitionProperty: props,
        transitionDuration: '0.18s',
        transitionTimingFunction: 'ease',
      } as object)
    : {};

const openExternal = (url: string) => {
  if (isWeb && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  void Linking.openURL(url);
};

const ASK_QUESTIONS = [
  'What’s in the new social media law for kids?',
  'What bills affect healthcare?',
  'Which legislators support affordable housing?',
];

const CITIES = [
  'MINNEAPOLIS',
  'SAINT PAUL',
  'ROCHESTER',
  'BLOOMINGTON',
  'DULUTH',
  'BROOKLYN PARK',
  'PLYMOUTH',
  'WOODBURY',
  'MAPLE GROVE',
  'BLAINE',
  'ST. CLOUD',
  'EAGAN',
  'EDINA',
  'MANKATO',
  'MOORHEAD',
];

// --- Small shared bits ---

function useHover(): [boolean, { onHoverIn: () => void; onHoverOut: () => void }] {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }];
}

/** Green inline text link ("Read the full law →", chief author, companion bill). */
function TextLink({
  label,
  onPress,
  size = 14,
  weight = t.fontWeights.bold,
}: {
  label: string;
  onPress?: () => void;
  size?: number;
  weight?: '400' | '500' | '600' | '700' | '800' | '900';
}) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} {...hoverProps}>
      <Text
        style={{
          fontFamily: t.typography.ui,
          fontSize: size,
          fontWeight: weight,
          color: hovered ? t.colors.brand.forest : t.colors.brand.deep,
          textDecorationLine: hovered ? 'underline' : 'none',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// Min time the purple press-glow stays lit after a chip press-in, so a quick tap still
// gets a full pulse; a press-and-hold keeps glowing past it. Kept equal to the
// capability cards' CARD_PULSE_MS (both 300ms) so the two press-glows feel identical —
// update the two together if either changes.
const CHIP_PULSE_MS = 300;

/** Hero example chip / finder city chip — purple hover glow, fills its input. */
function FillChip({
  label,
  city,
  onPress,
}: {
  label: string;
  city?: boolean;
  onPress: () => void;
}) {
  const [hovered, hoverProps] = useHover();
  const { isMobile } = useResponsive();
  // Touch has no hover, so a press shows the same purple glow the chip uses on hover.
  // The glow appears on press-in and stays lit while held (press-and-hold), matching
  // the capability cards' green press-glow; on release it fades no sooner than
  // CHIP_PULSE_MS, so a quick tap still gets a full pulse. Unlike the cards, a chip only
  // fills its input (it never unmounts), so onPress fires immediately and the glow fades
  // independently on release. Covers both hero example chips and city chips.
  const [pressed, setPressed] = useState(false);
  const pressStart = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (settleTimer.current ? clearTimeout(settleTimer.current) : undefined), []);
  const glow = hovered || pressed;
  const handlePressIn = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    pressStart.current = Date.now();
    setPressed(true);
  };
  // Drop the glow no sooner than CHIP_PULSE_MS after press-in. Fires on every release
  // (tap or drag-off), so the glow always clears; the fill runs from onPress.
  const handlePressOut = () => {
    const elapsed = pressStart.current != null ? Date.now() - pressStart.current : CHIP_PULSE_MS;
    const remaining = Math.max(0, CHIP_PULSE_MS - elapsed);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setPressed(false), remaining);
  };
  return (
    <Pressable
      accessibilityRole="button"
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      {...hoverProps}
      style={[
        city ? styles.cityChip : styles.exampleChip,
        transition('border-color, box-shadow'),
        glow && styles.chipHover,
        glow && (t.shadows.glowPurple as object),
      ]}
    >
      {/* Hover/press turns only the border + glow purple (chipHover + glowPurple);
          the label keeps its default color. */}
      <Text
        style={[
          city ? styles.cityChipText : styles.exampleChipText,
          !city && isMobile && styles.exampleChipTextMobile,
          city && isMobile && styles.cityChipTextMobile,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Ask / Finder input shell with the purple focus ring. */
function FieldShell({
  children,
  focused,
  style,
}: {
  children: React.ReactNode;
  focused: boolean;
  style?: object;
}) {
  return <View style={[styles.fieldShell, ...fieldFocusRing(focused), style]}>{children}</View>;
}

// --- Hero answer card (static sample answer — HF 4138) ---

const HF4138_STATUS_URL = 'https://www.revisor.mn.gov/bills/94/2026/0/HF/4138/';
// HF 4138 was enacted as 2026 Session Law Chapter 111, so the footer links to the
// signed law rather than a bill draft. Hardcoded because the hero is a static sample;
// the reusable bill card derives this from status (see BillCard reusability note).
const HF4138_LAW_URL = 'https://www.revisor.mn.gov/laws/2026/0/Session+Law/Chapter/111/';
const HF4138_AUTHOR_URL = 'https://www.house.mn.gov/members/profile/15314';
const SF4696_URL = 'https://www.revisor.mn.gov/bills/94/2026/0/SF/4696/';

function CitedSectionCard({
  n,
  title,
  quote,
  note,
}: {
  n: string;
  title: string;
  quote: string;
  note?: string;
}) {
  return (
    <View style={styles.sectionCardBox}>
      <View style={styles.sectionCardHead}>
        <View style={styles.sectionCardNum}>
          <Text style={styles.sectionCardNumText}>{n}</Text>
        </View>
        <Text style={styles.sectionCardTitle}>{title}</Text>
      </View>
      <View style={styles.sectionCardQuote}>
        <Text style={styles.sectionCardQuoteText}>{quote}</Text>
      </View>
      {note ? <Text style={styles.sectionCardNote}>{note}</Text> : null}
    </View>
  );
}

function AnswerCard({ dimmed }: { dimmed: boolean }) {
  const [badgeHovered, badgeHover] = useHover();
  const { isMobile } = useResponsive();
  const blurOverlay: object = isWeb
    ? {
        backgroundColor: 'rgba(255,255,255,0.6)',
        backdropFilter: 'blur(5px) saturate(0.9)',
        WebkitBackdropFilter: 'blur(5px) saturate(0.9)',
      }
    : { backgroundColor: 'rgba(255,255,255,0.75)' };
  return (
    <View style={[styles.answerCard, isMobile && styles.answerCardMobile, t.shadows.lg as object]}>
      {/* The bold question is the first element (the "ASKED" eyebrow was removed). */}
      <Text style={styles.askedQuestion}>What’s in the new social media law for kids?</Text>

      {/* BILL divider */}
      <View style={styles.billDividerRow}>
        <Text style={styles.billDividerLabel}>BILL</Text>
        <View style={styles.hairlineFlex} />
      </View>

      {/* badge + meta. Mobile: compact 2×2 grid (fixed 90px left column shared by
          badge + votes; right column holds dates and author/companion, both aligned
          at 90 + 20px). Desktop unchanged. */}
      {isMobile ? (
        <View style={styles.billMetaMobile}>
          <View style={styles.billMetaMobileRow}>
            <View style={styles.billMetaMobileBadgeCell}>
              <Pressable
                accessibilityRole="link"
                onPress={() => openExternal(HF4138_STATUS_URL)}
                {...badgeHover}
                style={[styles.billBadgeLg, badgeHovered && { backgroundColor: '#d5f2e2' }]}
              >
                <Text
                  style={[
                    styles.billBadgeLgText,
                    badgeHovered && { textDecorationLine: 'underline' },
                  ]}
                >
                  HF 4138
                </Text>
              </Pressable>
            </View>
            <View style={styles.billMetaMobileRight}>
              <Text style={styles.billMetaText}>
                <Text style={styles.billMetaBold}>Signed</Text> May 26, 2026
              </Text>
              <Text style={[styles.billMetaText, { marginTop: 2 }]}>
                <Text style={styles.billMetaBold}>Effective</Text> July 1, 2027
              </Text>
            </View>
          </View>
          <View style={[styles.billMetaMobileRow, { marginTop: 12 }]}>
            <View style={styles.billMetaMobileVotesCell}>
              <Text style={styles.billMetaText}>
                House <Text style={styles.billVoteNum}>132–2</Text>
              </Text>
              <Text style={[styles.billMetaText, { marginTop: 2 }]}>
                Senate <Text style={styles.billVoteNum}>66–0</Text>
              </Text>
            </View>
            <View style={styles.billMetaMobileRight}>
              <View style={styles.billMetaLinkRow}>
                <Text style={styles.billMetaText}>Chief author </Text>
                <TextLink
                  label="Rep. Peggy Scott →"
                  size={13}
                  weight="600"
                  onPress={() => openExternal(HF4138_AUTHOR_URL)}
                />
              </View>
              <View style={[styles.billMetaLinkRow, { marginTop: 2 }]}>
                <Text style={styles.billMetaText}>Companion bill </Text>
                <TextLink
                  label="SF 4696 →"
                  size={13}
                  weight="600"
                  onPress={() => openExternal(SF4696_URL)}
                />
              </View>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.billMetaRow}>
          <Pressable
            accessibilityRole="link"
            onPress={() => openExternal(HF4138_STATUS_URL)}
            {...badgeHover}
            style={[styles.billBadgeLg, badgeHovered && { backgroundColor: '#d5f2e2' }]}
          >
            <Text
              style={[styles.billBadgeLgText, badgeHovered && { textDecorationLine: 'underline' }]}
            >
              HF 4138
            </Text>
          </Pressable>
          <View style={styles.billMetaCols}>
            <View style={styles.billMetaColsRow}>
              <View>
                <Text style={styles.billMetaText}>
                  <Text style={styles.billMetaBold}>Signed</Text> May 26, 2026
                </Text>
                <Text style={[styles.billMetaText, { marginTop: 2 }]}>
                  <Text style={styles.billMetaBold}>Effective</Text> July 1, 2027
                </Text>
              </View>
              <View>
                <View style={styles.billMetaLinkRow}>
                  <Text style={styles.billMetaText}>Chief author </Text>
                  <TextLink
                    label="Rep. Peggy Scott →"
                    size={13}
                    weight="600"
                    onPress={() => openExternal(HF4138_AUTHOR_URL)}
                  />
                </View>
                <View style={[styles.billMetaLinkRow, { marginTop: 2 }]}>
                  <Text style={styles.billMetaText}>Companion bill </Text>
                  <TextLink
                    label="SF 4696 →"
                    size={13}
                    weight="600"
                    onPress={() => openExternal(SF4696_URL)}
                  />
                </View>
              </View>
            </View>
            <Text style={[styles.billMetaText, { marginTop: 10 }]}>House 132–2 · Senate 66–0</Text>
          </View>
        </View>
      )}

      <View style={styles.hairline} />

      <Text style={styles.answerSummary}>
        Minnesota’s{' '}
        <Text style={styles.answerSummaryBold}>Stop Harms from Addictive Social Media Act</Text>{' '}
        will require parental consent for kids under 16, ban addictive features, and default their
        accounts to the strictest privacy.
      </Text>

      <View style={styles.citedRow}>
        <Text style={styles.citedLabel}>Cited</Text>
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={12} r={9} stroke={t.colors.brand.deep} strokeWidth={2} />
          <Path
            d="M8.5 12.2 L11 14.7 L15.7 9.6"
            stroke={t.colors.brand.deep}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <Text style={styles.citedLabel}>Section 325M.40</Text>
      </View>

      <View style={styles.sectionCardStack}>
        <CitedSectionCard
          n="1"
          title="3(b) — Parental consent"
          quote={
            '“A covered social media platform may not create an account for a user identified as a child … without first obtaining verifiable parental consent.”'
          }
        />
        <CitedSectionCard
          n="2"
          title="5(a) — Addictive features"
          quote={
            '“A covered social media platform may not present addictive interface features in the display or feed of any account of a child.”'
          }
          note="Such as infinite scrolling, autoplay video, and push notifications"
        />
        <CitedSectionCard
          n="3"
          title="4(a) — Privacy by default"
          quote={
            '“An account for a child shall have all privacy settings set by default at the most private levels.”'
          }
        />
      </View>

      <View style={styles.answerFooter}>
        <TextLink label="Read the full law →" onPress={() => openExternal(HF4138_LAW_URL)} />
        <Text style={styles.answerFooterHost}>revisor.mn.gov</Text>
      </View>

      {/* de-emphasis overlay while a nav menu is open */}
      {dimmed ? <View pointerEvents="none" style={[styles.answerOverlay, blurOverlay]} /> : null}
    </View>
  );
}

// --- Capability card ---

// Min time the green press-glow shows before a tap navigates. The glow's fade-in
// is 180ms on web (instant on native), so this leaves a brief lit dwell — a quick
// tap still gets a full pulse, but navigation stays snappy. A press-and-hold keeps
// glowing past it and navigates on release.
const CARD_PULSE_MS = 300;

function CapabilityCard({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: 'search' | 'bookmark' | 'person';
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const [hovered, hoverProps] = useHover();
  // Touch has no hover, so a press shows the same green glow the card uses on hover.
  // The glow appears on press-in and stays lit while held (press-and-hold to preview);
  // on release the card navigates — but never before the glow has shown for
  // CARD_PULSE_MS, so a quick tap still gets a full pulse before it leaves.
  const [pressed, setPressed] = useState(false);
  const pressStart = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (settleTimer.current ? clearTimeout(settleTimer.current) : undefined), []);
  const glow = hovered || pressed;
  const c = t.colors.brand.deep;
  const handlePressIn = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    pressStart.current = Date.now();
    setPressed(true);
  };
  // Drop the glow no sooner than CARD_PULSE_MS after press-in, and navigate too when
  // this is a real selection. onPressOut fires first and only fades the glow, so a
  // press dragged off the card (no onPress) clears the glow without navigating.
  const settle = (navigate: boolean) => {
    const elapsed = pressStart.current != null ? Date.now() - pressStart.current : CARD_PULSE_MS;
    const remaining = Math.max(0, CARD_PULSE_MS - elapsed);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      setPressed(false);
      if (navigate) onPress();
    }, remaining);
  };
  return (
    <Pressable
      accessibilityRole="link"
      onPressIn={handlePressIn}
      onPressOut={() => settle(false)}
      onPress={() => settle(true)}
      {...hoverProps}
      style={[
        styles.capCard,
        transition('border-color, box-shadow'),
        glow && { borderColor: t.colors.brand.base },
        glow && (t.shadows.glowGreen as object),
      ]}
    >
      <View style={styles.capIconTile}>
        <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
          {icon === 'search' ? (
            <>
              <Circle cx={11} cy={11} r={7} stroke={c} strokeWidth={2} />
              <Path d="M16.5 16.5 L21 21" stroke={c} strokeWidth={2} strokeLinecap="round" />
            </>
          ) : null}
          {icon === 'bookmark' ? (
            <Path
              d="M7 4 h10 v16 l-5 -4 l-5 4 Z"
              stroke={c}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          ) : null}
          {icon === 'person' ? (
            <>
              <Circle cx={12} cy={8} r={3.4} stroke={c} strokeWidth={2} />
              <Path
                d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"
                stroke={c}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </>
          ) : null}
        </Svg>
      </View>
      <View style={styles.capBody}>
        <Text style={styles.capTitle}>{title}</Text>
        <Text style={styles.capSubtitle}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

// --- Bill card (v2) ---

function ProgressSteps({ filled, vetoed }: { filled: number; vetoed?: boolean }) {
  return (
    <View style={styles.progressRow}>
      {[0, 1, 2, 3, 4].map((i) => {
        const isFilled = i < filled;
        const isVetoedStep = vetoed && i === filled - 1;
        return (
          <View
            key={i}
            style={[
              styles.progressStep,
              {
                backgroundColor: isVetoedStep
                  ? t.colors.status.vetoedStep
                  : isFilled
                    ? t.colors.brand.deep
                    : t.colors.status.progressEmpty,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

// --- The screen ---

// Route entry. Mobile is an intentional redesign (docs/mockups/home-signed-out-mobile),
// not a reflow of the desktop layout, so it renders as its own component. Switching
// on a whole component (rather than an early return inside one) keeps each layout's
// hook order stable across a resize that crosses the breakpoint.
export function HomeSignedOutScreen() {
  const { isDesktop } = useResponsive();
  return isDesktop ? <HomeSignedOutDesktop /> : <HomeSignedOutMobile />;
}

function HomeSignedOutDesktop() {
  const navigation = useNavigation<any>();
  const { signInWithGoogle } = useAuth();
  const { isDesktop, isMobile } = useResponsive();
  // Only fetch when Home is the visible screen. Under a bottom-tabs navigator Home
  // stays mounted beneath a deep-linked stack screen (e.g. a bill), so ungated it
  // would fire these queries and contend with the visible screen's first load.
  const isFocused = useIsFocused();
  // Bill Activity — real, date-ordered data (#342: the section previously showed
  // fabricated bills under real legislators' names). Mirrors the mobile home feed
  // (#341); web shows more per NEXT-home-spec (§"Bill Activity"): 2 passed, 3
  // introduced. "Recently Passed" = enacted (signed_into_law) by latest action;
  // "Recently Introduced" = real introduction date desc.
  const recentlyPassed = useBills(
    undefined,
    undefined,
    { status: 'signed_into_law', sort: 'latest_action' },
    { limit: 2 },
    { enabled: isFocused },
  );
  const recentlyIntroduced = useBills(
    undefined,
    undefined,
    { sort: 'introduced' },
    { limit: 3 },
    { enabled: isFocused },
  );
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [askFocused, setAskFocused] = useState(false);
  const [finderFocused, setFinderFocused] = useState(false);
  const [askValue, setAskValue] = useState('');
  const [finderValue, setFinderValue] = useState('');
  const askInputRef = useRef<TextInput>(null);
  const finderInputRef = useRef<TextInput>(null);

  // Auto-size the ask field to its content (see useAskAutoGrow): one line at
  // rest, growing only when the placeholder/value actually wraps, and shrinking
  // back — RN-Web's onContentSizeChange can't shrink, so the hook drives the DOM
  // node and re-measures on resize + font-load.
  useAskAutoGrow(askInputRef, askValue);

  const signIn = () => void signInWithGoogle();
  // Ask routes to the answer page (#217): topic questions render a cited bill
  // list there; intents whose answer paths haven't shipped yet fall back to an
  // interim coming-soon state on the same page.
  const submitAsk = () => {
    const question = askValue.trim();
    if (!question) {
      askInputRef.current?.focus();
      return;
    }
    navigation.navigate('Ask', { q: question });
  };

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
        // About pages don't exist yet — rows close the menu without navigating
        // until those static pages ship (see PR notes / #143).
        return;
    }
  };

  const fillAsk = (question: string) => {
    setAskValue(question);
    askInputRef.current?.focus();
  };

  const titleCase = (s: string) =>
    s
      .toLowerCase()
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

  const fillFinder = (city: string) => {
    setFinderValue(titleCase(city));
    finderInputRef.current?.focus();
  };

  const heroGradientWeb: object = isWeb
    ? { backgroundImage: 'linear-gradient(180deg,#f4f5f7 0%,#f7f8fa 55%,#fdfdfe 90%,#ffffff 100%)' }
    : { backgroundColor: t.colors.surfaces.s300 };
  const heroDotsWeb: object = isWeb
    ? {
        backgroundImage: t.gradients.dotInk,
        backgroundSize: '30px 30px',
        maskImage:
          'linear-gradient(to bottom, transparent 0px, transparent 110px, #000 230px, #000 calc(100% - 180px), transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0px, transparent 110px, #000 230px, #000 calc(100% - 180px), transparent 100%)',
      }
    : {};
  const finderGradientWeb: object = isWeb
    ? { backgroundImage: 'linear-gradient(180deg,#eaf6ef 0%,#f2f9f5 45%,#ffffff 100%)' }
    : { backgroundColor: t.colors.tint.t100 };
  const finderDotsWeb: object = isWeb
    ? {
        backgroundImage: t.gradients.dotGreen,
        backgroundSize: '30px 30px',
        maskImage: 'linear-gradient(to bottom, transparent 0%, #000 36%, transparent 88%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 36%, transparent 88%)',
      }
    : {};

  return (
    <PageBackground>
      <View style={styles.root}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* HERO WRAPPER */}
          <View style={[styles.heroWrap, heroGradientWeb]}>
            {isWeb ? (
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFillObject as object, heroDotsWeb]}
              />
            ) : null}

            <TopNav
              variant="home"
              openMenu={openMenu}
              onOpenMenuChange={setOpenMenu}
              onNavigate={handleNavigate}
              onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
              onSignIn={signIn}
            />

            <Container style={styles.heroBody}>
              <View style={[styles.heroGrid, isDesktop && styles.heroGridDesktop]}>
                {/* LEFT */}
                <View style={styles.heroLeft}>
                  <Text style={styles.heroEyebrow}>TRUTH, UNCONCEALED</Text>
                  <Text
                    accessibilityRole="header"
                    style={[styles.heroH1, !isDesktop && styles.heroH1Mobile]}
                  >
                    Grounded answers{'\n'}
                    <Text style={styles.heroH1Green}>on Minnesota law</Text>
                  </Text>
                  <Text style={[styles.heroSubhead, !isDesktop && styles.heroSubheadMobile]}>
                    We read every bill so you don’t have to — what it says, where it stands, and how
                    everyone voted. Plain language, every answer linked to official sources.
                  </Text>

                  {/* ASK FIELD. Mobile stacks a full-width Ask button below the
                      field (inline, it would clip the placeholder on a narrow
                      screen) and top-aligns the icon so it holds as the field grows. */}
                  <View style={[styles.askShell, isMobile && styles.askFieldMobile]}>
                    <FieldShell
                      focused={askFocused}
                      style={isMobile ? styles.askShellMobileInner : undefined}
                    >
                      <Search
                        size={22}
                        color={t.colors.text.faint}
                        strokeWidth={2}
                        style={isMobile ? styles.askIconMobile : undefined}
                      />
                      <TextInput
                        ref={askInputRef}
                        // No accessibilityLabel: the descriptive placeholder is the field's
                        // accessible name. An aria-label here would make screen readers announce
                        // both it AND the placeholder (a11y refinement, see design-audit skill).
                        value={askValue}
                        onChangeText={setAskValue}
                        onFocus={() => setAskFocused(true)}
                        onBlur={() => setAskFocused(false)}
                        // Auto-grow (multiline): starts at one row; the layout effect
                        // above sizes it to content between one line and the cap.
                        multiline
                        numberOfLines={1}
                        blurOnSubmit={false}
                        // Enter submits (Shift+Enter = newline), matching the chat composer.
                        onKeyPress={(event) => {
                          const ne = event.nativeEvent as { key?: string; shiftKey?: boolean };
                          if (isWeb && ne.key === 'Enter' && !ne.shiftKey) {
                            (event as { preventDefault?: () => void }).preventDefault?.();
                            submitAsk();
                          }
                        }}
                        placeholder={ASK_PLACEHOLDER}
                        placeholderTextColor={t.colors.text.faint}
                        style={[styles.askInput, isMobile && styles.askInputMobile]}
                      />
                      {!isMobile && (
                        <Pressable
                          accessibilityRole="button"
                          onPress={submitAsk}
                          style={styles.askButton}
                        >
                          <Text style={styles.askButtonText}>Ask</Text>
                        </Pressable>
                      )}
                    </FieldShell>
                    {isMobile && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={submitAsk}
                        style={styles.askButtonMobile}
                      >
                        <Text style={styles.askButtonText}>Ask</Text>
                      </Pressable>
                    )}
                  </View>

                  {/* EXAMPLE CHIPS */}
                  <View style={styles.chipsRow}>
                    {ASK_QUESTIONS.map((q) => (
                      <FillChip key={q} label={q} onPress={() => fillAsk(q)} />
                    ))}
                  </View>
                </View>

                {/* RIGHT: answer card */}
                <View style={[styles.heroRight, isDesktop && styles.heroRightDesktop]}>
                  <AnswerCard dimmed={openMenu !== null} />
                </View>
              </View>
            </Container>
            <View style={styles.heroBottomSpace} />
          </View>

          {/* CAPABILITY DIRECTORY */}
          <View style={styles.capSection}>
            <Container>
              <Text style={styles.sectionEyebrow}>THE RECORD IS YOURS</Text>
              <View style={[styles.capGrid, !isDesktop && styles.capGridStacked]}>
                <CapabilityCard
                  icon="search"
                  title="Search Bills"
                  subtitle="Read any bill yourself — by issue or keyword"
                  onPress={() => navigation.navigate('Bills')}
                />
                <CapabilityCard
                  icon="person"
                  title="Search Legislators"
                  subtitle="See who writes your laws — profiles, committees, authored bills"
                  onPress={() => navigation.navigate('Legislators')}
                />
              </View>
            </Container>
          </View>

          {/* BILLS MOVING THROUGH THE LEGISLATURE */}
          <View style={styles.billsSection}>
            <Container>
              <Text style={styles.sectionEyebrow}>2025–26 LEGISLATIVE SESSION</Text>
              <View style={styles.billsHeadRow}>
                <Text
                  accessibilityRole="header"
                  style={[styles.billsH2, !isDesktop && styles.billsH2Mobile]}
                >
                  Bills Moving Through the Legislature
                </Text>
                <ViewAllButton onPress={() => navigation.navigate('Bills')} />
              </View>
              <View style={styles.billGroups}>
                {(recentlyPassed.data?.data ?? []).length > 0 ? (
                  <View>
                    <Text style={styles.billGroupLabel}>RECENTLY PASSED</Text>
                    <View style={styles.billStack}>
                      {(recentlyPassed.data?.data ?? []).map((bill) => (
                        <BillResultCard
                          key={bill.id}
                          bill={bill}
                          // Bill detail and legislator profile are old-design
                          // pages — cards stay visible but don't route
                          // anywhere until their new designs ship.
                          onPress={() => {}}
                          onToggleTrack={() => {}}
                          onSponsorPress={() => {}}
                          onRollCalls={() => {}}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
                {(recentlyIntroduced.data?.data ?? []).length > 0 ? (
                  <View>
                    <Text style={styles.billGroupLabel}>RECENTLY INTRODUCED</Text>
                    <View style={styles.billStack}>
                      {(recentlyIntroduced.data?.data ?? []).map((bill) => (
                        <BillResultCard
                          key={bill.id}
                          bill={bill}
                          onPress={() => {}}
                          onToggleTrack={() => {}}
                          onSponsorPress={() => {}}
                          onRollCalls={() => {}}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            </Container>
          </View>

          {/* FIND MY LEGISLATOR */}
          <View style={[styles.finderBand, finderGradientWeb]}>
            {isWeb ? (
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFillObject as object, finderDotsWeb]}
              />
            ) : null}
            <Container>
              <View style={[styles.finderGrid, isDesktop && styles.finderGridDesktop]}>
                <View style={styles.finderLeft}>
                  <Text
                    accessibilityRole="header"
                    style={[styles.finderH2, !isDesktop && styles.finderH2Mobile]}
                  >
                    Find My Legislator
                  </Text>
                  <Text style={styles.finderSub}>
                    Find who represents you — their profile, committees, and the bills they’ve
                    authored.
                  </Text>
                  {/* Find field. Mobile stacks a full-width Find button below the field
                      (matching the Ask hero); desktop keeps the Find button inline. */}
                  <View style={[styles.finderFieldWrap, isMobile && styles.askFieldMobile]}>
                    <FieldShell
                      focused={finderFocused}
                      style={isMobile ? styles.finderShellMobileInner : styles.finderShellInner}
                    >
                      <MapPin size={22} color={t.colors.text.faint} strokeWidth={2} />
                      <TextInput
                        ref={finderInputRef}
                        // No accessibilityLabel: the placeholder names the field (see ask input above).
                        value={finderValue}
                        onChangeText={setFinderValue}
                        onFocus={() => setFinderFocused(true)}
                        onBlur={() => setFinderFocused(false)}
                        // Find My Legislator is on the roadmap — the field stays
                        // visible but doesn't route anywhere yet.
                        placeholder="Enter an address, city, or area"
                        placeholderTextColor={t.colors.text.faint}
                        style={styles.finderInput}
                      />
                      {!isMobile && <PrimaryButton label="Find" />}
                    </FieldShell>
                    {isMobile && (
                      <Pressable accessibilityRole="button" style={styles.askButtonMobile}>
                        <Text style={styles.askButtonText}>Find</Text>
                      </Pressable>
                    )}
                  </View>
                  <View style={styles.cityRow}>
                    {CITIES.map((city) => (
                      <FillChip key={city} label={city} city onPress={() => fillFinder(city)} />
                    ))}
                  </View>
                </View>
                {isDesktop ? (
                  <View style={styles.finderMap}>
                    <MNMap size={330} />
                  </View>
                ) : null}
              </View>
            </Container>
          </View>

          {/* "Start Knowing" (Google sign-in CTA) removed until sign-in ships a
              real post-login experience — see conversation notes, reintroduce then. */}

          <Footer
            onPrivacy={() => navigation.navigate('Privacy')}
            onTerms={() => navigation.navigate('Terms')}
          />
          {/* Outside-click close is handled inside TopNav (web document listener). A
              full-screen overlay here stacked above the dropdown panel and swallowed
              its row hover/clicks. */}
        </ScrollView>
      </View>
    </PageBackground>
  );
}

// ============================================================================
// MOBILE HOME (v3) — docs/mockups/home-signed-out-mobile. An intentional redesign
// for mobile web (a separate web redesign follows), so it's a distinct single-
// column composition, not a reflow of the desktop layout above. Everything here
// is wired to REAL data (no static marketing cards):
//   • In the News = two editorially-pinned bills, fetched by key so they bypass
//     the /bills AI-summary list gate; rendered with their live status.
//   • Bill Activity = live, date-ordered: Recently Introduced by real introduction
//     date, Recently Passed = most recently enacted bill (#329, now that action
//     dates are ingested #328).
// ============================================================================

// Editorial "In the News" pins — keys verified against production 2026-07-15.
// Inclusion + order are editorial (docs/mockups/home-signed-out-mobile/NEXT-home-spec.md);
// each card shows that bill's real data. HF 4138 is the enacted social-media law
// the design's card 1 depicts (the mock labeled it "SF 3933", which is a different
// bill in our corpus). SF 856 is the enacted Office of the Inspector General bill.
// `effectiveDate` is editorial metadata verified from the enacted primary source
// (grounded-answers rule 9). Action dates are ingested now (#338), but the
// statutory effective date still isn't a stored or derivable field: the enactment
// "Effective date" action carries no parseable date, and the real date can fall in
// the future (HF 4138 → 2027), so it must come from the enacted text, not the API.
// HF 4138 → 2026 Ch. 111 §§1–2 (325M), both "effective July 1, 2027";
// SF 856 → 2025 Ch. 92, Minnesota's default effective date (Aug 1 following
// enactment) for the act's general provisions (some sections stagger).
const IN_THE_NEWS: { key: string; hotIssue: boolean; effectiveDate?: string }[] = [
  { key: '94-2026-HF4138', hotIssue: true, effectiveDate: 'July 1, 2027' },
  { key: '94-2025-SF856', hotIssue: true, effectiveDate: 'Aug 1, 2026' },
];

// status text → filled progress steps (of 5), mirroring BillResultCard.billStage
// so the bar always agrees with the shown status label.
function statusToProgress(status: string): { filled: number; vetoed: boolean } {
  const s = status.toLowerCase();
  if (s.includes('veto')) return { filled: 5, vetoed: true };
  if (s.includes('signed') || s.includes('law') || s.includes('enacted'))
    return { filled: 5, vetoed: false };
  if (s.includes('senate')) return { filled: 4, vetoed: false };
  if (s.includes('house')) return { filled: 3, vetoed: false };
  if (s.includes('committee')) return { filled: 2, vetoed: false };
  return { filled: 1, vetoed: false };
}

/** A cleaner display title: prefer the AI short title, fall back to the legal title. */
const billHeadline = (bill: Bill) => bill.aiAnalysis?.shortTitle || bill.title;

/** Green mono bill badge (e.g. "HF 4138"). */
function BillBadge({ label }: { label: string }) {
  return (
    <View style={m.billBadge}>
      <Text style={m.billBadgeText}>{label}</Text>
    </View>
  );
}

/** "See more" — full-width outline button → default Search Bills. */
function SeeMore({ onPress }: { onPress: () => void }) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      {...hoverProps}
      style={[
        m.seeMore,
        transition('border-color'),
        hovered && { borderColor: t.colors.brand.base },
      ]}
    >
      <Text style={[m.seeMoreText, hovered && { color: t.colors.brand.deep }]}>See more</Text>
      <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" style={m.seeMoreArrow}>
        <Path
          d="M3.5 12 H19.5 M13 6 L19.5 12 L13 18"
          stroke={hovered ? t.colors.brand.deep : t.colors.text.primary}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}

/** In-the-News card — editorial pin, real bill data. Whole card → bill detail. */
function NewsCardMobile({
  bill,
  hotIssue,
  effectiveDate,
  onPress,
}: {
  bill: Bill;
  hotIssue: boolean;
  effectiveDate?: string;
  onPress: () => void;
}) {
  const [hovered, hoverProps] = useHover();
  const summary = bill.aiAnalysis?.summary;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      {...hoverProps}
      style={[m.card, transition('border-color, box-shadow'), hovered && m.cardHover]}
    >
      <View style={m.cardTopRow}>
        <BillBadge label={bill.identifier} />
        {hotIssue ? (
          <View style={m.hotPill}>
            <Text style={m.hotPillText}>🔥 Hot issue</Text>
          </View>
        ) : null}
      </View>
      <Text style={m.newsTitle}>{billHeadline(bill)}</Text>
      {summary ? (
        <Text style={m.newsSummary} numberOfLines={4}>
          {summary}
        </Text>
      ) : null}
      <View style={m.cardMeta}>
        <Text style={m.metaStatus}>{bill.status}</Text>
        {effectiveDate ? <Text style={m.metaEffective}>Effective {effectiveDate}</Text> : null}
      </View>
    </Pressable>
  );
}

// Card meta line freshness treatment (#329, NEXT-home-spec.md §"Card meta line").
// updatedAt arrives as "YYYY-MM-DD" (formatUpdatedAt) or the "Unknown" sentinel
// when a bill still has no dated action; render it as a plain "Mon D, YYYY".
const META_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
function friendlyMetaDate(iso?: string): string | null {
  if (!iso || iso === 'Unknown') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const monthIndex = parseInt(match[2], 10) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return `${META_MONTHS[monthIndex]} ${parseInt(match[3], 10)}, ${match[1]}`;
}

// The MN source's latest-action text is often a terse fragment ("Referred to",
// "Introduction and first reading, referred to"); map the common ones to fuller,
// plain phrasing for the meta line. Unmapped values pass through trimmed.
const ACTION_LABELS: Record<string, string> = {
  'introduction and first reading, referred to': 'Introduced and referred to committee',
  'introduction and first reading, referred to committee': 'Introduced and referred to committee',
  'referred to': 'Referred to committee',
  'author stricken': 'Author removed',
  'bill was passed': 'Passed',
  'bill was passed as amended': 'Passed as amended',
  'third reading passed': 'Passed on third reading',
  'third reading passed as amended': 'Passed on third reading, as amended',
};
// Terse actions that merely restate an enacted status ("Chapter number" =
// assigned a session-law chapter; "Effective date"), and opaque companion-file
// artifacts ("See", "See Senate file in House") that carry no real action — both
// collapse to the "Updated {date}" freshness stamp rather than a latest-action line.
const RESTATING_ACTIONS = new Set([
  'chapter number',
  'effective date',
  'see',
  'see also',
  'see senate file in house',
  'see house file in senate',
]);
function cleanActionText(raw: string): string {
  const trimmed = raw.trim();
  return ACTION_LABELS[trimmed.toLowerCase()] ?? trimmed;
}

/** Bill Activity card — live data. Whole card → bill detail. */
function ActivityCardMobile({ bill, onPress }: { bill: Bill; onPress: () => void }) {
  const [hovered, hoverProps] = useHover();
  const { filled, vetoed } = statusToProgress(bill.status);
  const summary = bill.aiAnalysis?.summary;
  // Meta line freshness rule (design): show "Latest action: {action} · {date}"
  // (action dark, date grey), unless the latest action merely restates the bill's
  // status (e.g. an enacted bill whose last action is "Chapter number") or is an
  // opaque companion artifact — then show a plain "Updated {date}" stamp instead.
  const date = friendlyMetaDate(bill.updatedAt);
  const rawAction = bill.latestActionText?.trim();
  const actionKey = (rawAction ?? '').toLowerCase();
  const restatesStatus =
    !!rawAction &&
    (RESTATING_ACTIONS.has(actionKey) || actionKey === bill.status.trim().toLowerCase());
  const showUpdatedStamp = !!date && (!rawAction || restatesStatus);
  const action = rawAction ? cleanActionText(rawAction) : null;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      {...hoverProps}
      style={[m.card, transition('border-color, box-shadow'), hovered && m.cardHover]}
    >
      <View style={m.activityHeadRow}>
        <BillBadge label={bill.identifier} />
        <Text style={m.activityStatus}>{bill.status}</Text>
      </View>
      <View style={m.activityProgress}>
        <ProgressSteps filled={filled} vetoed={vetoed} />
      </View>
      <Text style={m.activityTitle}>{billHeadline(bill)}</Text>
      {summary ? (
        <Text style={m.newsSummary} numberOfLines={3}>
          {summary}
        </Text>
      ) : null}
      {showUpdatedStamp ? (
        <View style={m.cardMeta}>
          <Text style={m.metaEffective}>Updated {date}</Text>
        </View>
      ) : action ? (
        <View style={m.cardMeta}>
          <Text style={m.metaStatus}>
            Latest action: <Text style={m.metaActionBold}>{action}</Text>
            {date ? <Text style={m.metaEffective}> · {date}</Text> : null}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Placeholder card that reserves a data-gated section's height while its query
 * loads, so the mobile home keeps its final section order from the first paint
 * (no layout shift when In the News / Bill Activity arrive). Static grey bars —
 * no shimmer — and hidden from assistive tech since it carries no real content.
 */
function SkeletonCard({ lines }: { lines: number }) {
  return (
    <View
      style={m.card}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={m.skelBadge} />
      <View style={m.skelTitle} />
      {Array.from({ length: lines }).map((_, i) => (
        <View key={i} style={[m.skelLine, i === lines - 1 && m.skelLineShort]} />
      ))}
      <View style={m.skelMeta} />
    </View>
  );
}

function HomeSignedOutMobile() {
  const navigation = useNavigation<any>();
  const { signInWithGoogle } = useAuth();
  const [askFocused, setAskFocused] = useState(false);
  const [finderFocused, setFinderFocused] = useState(false);
  const [askValue, setAskValue] = useState('');
  const [finderValue, setFinderValue] = useState('');
  const askInputRef = useRef<TextInput>(null);
  const finderInputRef = useRef<TextInput>(null);

  // Only fetch when Home is the visible screen. Under a bottom-tabs navigator Home
  // stays mounted beneath a deep-linked stack screen (e.g. a bill), so ungated it
  // would fire these queries and contend with the visible screen's first load.
  const isFocused = useIsFocused();
  // In the News — two pinned bills by key (bypasses the /bills AI-summary gate).
  const news0 = useBill(IN_THE_NEWS[0].key, { enabled: isFocused });
  const news1 = useBill(IN_THE_NEWS[1].key, { enabled: isFocused });
  // Bill Activity — live, date-ordered now that action dates are ingested (#329):
  //   • Recently Introduced = newest by real introduction date (sort=introduced).
  //   • Recently Passed = most recently enacted bill (status=signed_into_law,
  //     ordered by latest-action date desc — the signing/enactment milestone).
  //     "Passed both chambers, not yet signed" is ~0 genuine bills in the corpus
  //     (#305), so enacted is the honest population for the "Recently Passed" card.
  const introduced = useBills(
    undefined,
    undefined,
    { sort: 'introduced' },
    { limit: 1 },
    { enabled: isFocused },
  );
  const signed = useBills(
    undefined,
    undefined,
    { status: 'signed_into_law', sort: 'latest_action' },
    { limit: 1 },
    { enabled: isFocused },
  );

  // Auto-size the ask field to its content — one line at rest, grow only on
  // real wrap, shrink back; re-measures on resize + font-load (see useAskAutoGrow).
  useAskAutoGrow(askInputRef, askValue);

  const signIn = () => void signInWithGoogle();
  const submitAsk = () => {
    const question = askValue.trim();
    if (!question) {
      askInputRef.current?.focus();
      return;
    }
    navigation.navigate('Ask', { q: question });
  };
  // Bill detail and Find My Legislator are old-design pages — the cards/field
  // stay visible but don't route anywhere until their new designs ship.
  const openBill = (_billId: string) => {};
  const openSearchBills = () => navigation.navigate('Bills');
  const openFinder = () => {};

  const titleCase = (s: string) =>
    s
      .toLowerCase()
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  const fillFinder = (city: string) => {
    setFinderValue(titleCase(city));
    finderInputRef.current?.focus();
  };

  const newsBills = [
    { pin: IN_THE_NEWS[0], bill: news0.data },
    { pin: IN_THE_NEWS[1], bill: news1.data },
  ].filter((n) => n.bill != null) as { pin: (typeof IN_THE_NEWS)[number]; bill: Bill }[];
  const introducedBill = introduced.data?.data?.[0];
  const signedBill = signed.data?.data?.[0];

  // First-paint layout stability: "In the News" and "Bill Activity" are gated on
  // async query data, so until those queries resolve they'd render null (zero
  // height) and the Ask section below them would sit right under the hero, then
  // jump down once the data arrived. While a section's queries are still loading,
  // render skeletons in its slot so the page holds its final order from the first
  // paint (no content-driven layout shift). On error/empty the section still
  // collapses to null, unchanged.
  const newsLoading = news0.isLoading || news1.isLoading;
  const activityLoading = introduced.isLoading || signed.isLoading;

  // Masked dot textures — ONLY three sections carry them (Hero, Ask, Find My
  // Legislator), each contained to its own section and faded soft at the edges
  // (mask stops lifted from the mock source). No page-wide dot field.
  const heroDotsWeb: object = isWeb
    ? {
        backgroundImage: t.gradients.dotInk, // rgba(17,21,15,0.07)
        backgroundSize: '30px 30px',
        maskImage:
          'linear-gradient(to bottom, transparent 0px, transparent 110px, #000 230px, #000 calc(100% - 40px), transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0px, transparent 110px, #000 230px, #000 calc(100% - 40px), transparent 100%)',
      }
    : {};
  const askDotsWeb: object = isWeb
    ? {
        backgroundImage: 'radial-gradient(rgba(17,21,15,0.09) 1.4px, transparent 1.5px)',
        backgroundSize: '30px 30px',
        maskImage:
          'linear-gradient(to bottom, transparent 0%, #000 32%, #000 84%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0%, #000 32%, #000 84%, transparent 100%)',
      }
    : {};
  const finderDotsWeb: object = isWeb
    ? {
        backgroundImage: t.gradients.dotGreen, // rgba(20,157,91,0.09)
        backgroundSize: '30px 30px',
        maskImage: 'linear-gradient(to bottom, transparent 0%, #000 36%, transparent 92%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 36%, transparent 92%)',
      }
    : {};
  // Find My Legislator + Be in the Know share ONE continuous background: green
  // tint fills the finder (held longer so it reads clearly green, not near-white),
  // then fades to white and STAYS white behind the account card — no hard section
  // break. Green dots are masked to the finder portion only.
  const greenBandGradientWeb: object = isWeb
    ? {
        backgroundImage:
          'linear-gradient(180deg,#eaf6ef 0%,#eaf6ef 20%,#f2f9f5 36%,#ffffff 52%,#ffffff 100%)',
      }
    : { backgroundColor: t.colors.tint.t100 };

  return (
    <PageBackground>
      <View style={m.root}>
        <ScrollView style={m.scroll} contentContainerStyle={m.scrollContent}>
          {/* HERO — TopNav + copy share one wrapper so the masked dot texture
              spans them, faded off the top bar and out before In the News. */}
          <View style={m.heroWrap}>
            {isWeb ? (
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFillObject as object, heroDotsWeb]}
              />
            ) : null}
            <TopNav
              variant="home"
              onNavigate={(item: IaItem) => {
                switch (item.id) {
                  case 'search-bills':
                    return navigation.navigate('Bills');
                  case 'search-legislators':
                    return navigation.navigate('Legislators');
                  case 'search-find-my-legislator':
                    return navigation.navigate('FindMyLegislator');
                  case 'track-bills':
                    return navigation.navigate('Tracked');
                  default:
                    return;
                }
              }}
              onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
              onSignIn={signIn}
            />

            {/* HERO COPY (no ask field — Ask is its own section below) */}
            <Container style={m.heroBody}>
              <Text style={m.heroEyebrow}>TRUTH, UNCONCEALED</Text>
              <Text accessibilityRole="header" style={m.heroH1}>
                Grounded answers{'\n'}
                <Text style={m.heroH1Green}>on Minnesota law</Text>
              </Text>
              <Text style={m.heroSubhead}>
                We read every bill so you don’t have to — what it says, where it stands, and how
                everyone voted. Plain language, every answer linked to official sources.
              </Text>
            </Container>
          </View>

          {/* IN THE NEWS — editorial pins, real data. Check loading FIRST so the
              skeletons hold until BOTH pinned-bill queries settle, then both cards
              render together — no "one card, then the second pops in" stagger. */}
          {newsLoading ? (
            <Container style={m.section}>
              <Text style={m.eyebrow}>IN THE NEWS</Text>
              <View style={m.cardStack}>
                <SkeletonCard lines={4} />
                <SkeletonCard lines={4} />
              </View>
              <SeeMore onPress={openSearchBills} />
            </Container>
          ) : newsBills.length > 0 ? (
            <Container style={m.section}>
              <Text style={m.eyebrow}>IN THE NEWS</Text>
              <View style={m.cardStack}>
                {newsBills.map(({ pin, bill }) => (
                  <NewsCardMobile
                    key={bill.id}
                    bill={bill}
                    hotIssue={pin.hotIssue}
                    effectiveDate={pin.effectiveDate}
                    onPress={() => openBill(bill.id)}
                  />
                ))}
              </View>
              <SeeMore onPress={openSearchBills} />
            </Container>
          ) : null}

          {/* LEGISLATIVE BILL ACTIVITY — live. Check loading FIRST so the skeletons
              hold until BOTH date-ordered queries settle, then both cards render
              together — no stagger. */}
          {activityLoading ? (
            <Container style={m.section}>
              <Text style={m.eyebrow}>2025–2026 SESSION</Text>
              <Text accessibilityRole="header" style={m.sectionH2}>
                Legislative Bill Activity
              </Text>
              <View style={m.activityGroup}>
                <Text style={m.groupLabel}>RECENTLY PASSED</Text>
                <SkeletonCard lines={3} />
              </View>
              <View style={[m.activityGroup, m.activityGroupFollowing]}>
                <Text style={m.groupLabel}>RECENTLY INTRODUCED</Text>
                <SkeletonCard lines={3} />
              </View>
              <SeeMore onPress={openSearchBills} />
            </Container>
          ) : introducedBill || signedBill ? (
            <Container style={m.section}>
              <Text style={m.eyebrow}>2025–2026 SESSION</Text>
              <Text accessibilityRole="header" style={m.sectionH2}>
                Legislative Bill Activity
              </Text>
              {signedBill ? (
                <View style={m.activityGroup}>
                  <Text style={m.groupLabel}>RECENTLY PASSED</Text>
                  <ActivityCardMobile bill={signedBill} onPress={() => openBill(signedBill.id)} />
                </View>
              ) : null}
              {introducedBill ? (
                <View
                  style={signedBill ? [m.activityGroup, m.activityGroupFollowing] : m.activityGroup}
                >
                  <Text style={m.groupLabel}>RECENTLY INTRODUCED</Text>
                  <ActivityCardMobile
                    bill={introducedBill}
                    onPress={() => openBill(introducedBill.id)}
                  />
                </View>
              ) : null}
              <SeeMore onPress={openSearchBills} />
            </Container>
          ) : null}

          {/* ASK — purple AI entry point (own masked dot texture) */}
          <View style={m.askWrap}>
            {isWeb ? (
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFillObject as object, askDotsWeb]}
              />
            ) : null}
            <Container style={m.section}>
              <Text style={m.eyebrow}>HAVE A QUESTION?</Text>
              <Text style={m.askSub}>Plain language answers linked to official sources.</Text>
              <FieldShell focused={askFocused} style={m.askShell}>
                <Search size={22} color={t.colors.text.faint} strokeWidth={2} style={m.askIcon} />
                <TextInput
                  ref={askInputRef}
                  value={askValue}
                  onChangeText={setAskValue}
                  onFocus={() => setAskFocused(true)}
                  onBlur={() => setAskFocused(false)}
                  multiline
                  numberOfLines={1}
                  blurOnSubmit={false}
                  onKeyPress={(event) => {
                    const ne = event.nativeEvent as { key?: string; shiftKey?: boolean };
                    if (isWeb && ne.key === 'Enter' && !ne.shiftKey) {
                      (event as { preventDefault?: () => void }).preventDefault?.();
                      submitAsk();
                    }
                  }}
                  placeholder={ASK_PLACEHOLDER}
                  placeholderTextColor={t.colors.text.faint}
                  style={m.askInput}
                />
              </FieldShell>
              <AskButton onPress={submitAsk} />
            </Container>
          </View>

          {/* FIND MY LEGISLATOR + BE IN THE KNOW share one continuous green→white
              background — the tint fades to white and stays white behind the
              account card (no hard section break). Green dots mask to the finder. */}
          <View style={[m.greenBand, greenBandGradientWeb]}>
            <View style={m.finderInner}>
              {isWeb ? (
                <View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFillObject as object, finderDotsWeb]}
                />
              ) : null}
              <Container style={[m.section, m.lastSectionBottom]}>
                <Text accessibilityRole="header" style={m.finderH2}>
                  Find My Legislator
                </Text>
                <Text style={m.finderSub}>
                  Find who represents you — their profile, committees, and the bills they’ve
                  authored.
                </Text>
                <FieldShell focused={finderFocused} style={m.finderShell}>
                  <MapPin size={22} color={t.colors.text.faint} strokeWidth={2} />
                  <TextInput
                    ref={finderInputRef}
                    value={finderValue}
                    onChangeText={setFinderValue}
                    onFocus={() => setFinderFocused(true)}
                    onBlur={() => setFinderFocused(false)}
                    onSubmitEditing={openFinder}
                    placeholder="Enter an address, city, or area"
                    placeholderTextColor={t.colors.text.faint}
                    style={m.finderInput}
                  />
                </FieldShell>
                <Pressable accessibilityRole="button" onPress={openFinder} style={m.findButton}>
                  <Text style={m.findButtonText}>Find</Text>
                </Pressable>
                <View style={m.cityRow}>
                  {CITIES.slice(0, 6).map((city) => (
                    <FillChip key={city} label={city} city onPress={() => fillFinder(city)} />
                  ))}
                </View>
              </Container>
            </View>

            {/* "Be in the Know" (Google sign-in CTA) removed until sign-in ships a
                real post-login experience — see conversation notes, reintroduce then. */}
          </View>

          <Footer
            onPrivacy={() => navigation.navigate('Privacy')}
            onTerms={() => navigation.navigate('Terms')}
          />
        </ScrollView>
      </View>
    </PageBackground>
  );
}

/** Full-width purple Ask button (mobile Ask section). */
function AskButton({ onPress }: { onPress: () => void }) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...hoverProps}
      style={[
        m.askButton,
        transition('background-color'),
        hovered && { backgroundColor: '#4a26b0' },
      ]}
    >
      <Text style={m.askButtonText}>Ask</Text>
    </Pressable>
  );
}

const m = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { position: 'relative', paddingBottom: 0 },
  // Hero + Ask each own their masked dot texture; overflow:hidden contains the
  // texture (and its fade) to the section so it never bleeds page-wide.
  heroWrap: { position: 'relative', overflow: 'hidden' },
  askWrap: { position: 'relative', overflow: 'hidden' },
  heroBody: { paddingTop: 40, paddingBottom: 40 },
  // Type scaled up ~1.2x for mobile legibility; the four largest black headers
  // (hero H1, "Legislative Bill Activity", "Find My Legislator", "Be in the Know")
  // hold their size to keep the hierarchy.
  heroEyebrow: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.semibold,
    letterSpacing: 2.4,
    color: t.colors.brand.deep,
  },
  heroH1: {
    marginTop: 14,
    fontFamily: t.typography.title,
    fontSize: 36,
    lineHeight: 39,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.8,
    color: t.colors.text.primary,
  },
  heroH1Green: { color: t.colors.brand.deep },
  heroSubhead: {
    marginTop: 18,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 27,
    color: t.colors.text.muted,
  },
  // Even section rhythm: every top-level section gets 40 top / 40 bottom, so the
  // gaps between stacked sections read as a consistent ~80px. 20px sides from
  // Container mobile. The last section before the footer overrides its bottom to
  // 96 (lastSectionBottom) so its content isn't crowded against the black footer.
  section: { paddingTop: 40, paddingBottom: 40 },
  lastSectionBottom: { paddingBottom: 96 },
  eyebrow: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.4,
    color: t.colors.brand.deep,
  },
  sectionH2: {
    marginTop: 8,
    fontFamily: t.typography.title,
    fontSize: 26,
    lineHeight: 30,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.6,
    color: t.colors.text.primary,
  },
  cardStack: { marginTop: 16, gap: 18 },
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 16,
    padding: 18,
    ...(t.shadows.card as object),
  },
  cardHover: { borderColor: t.colors.brand.base },
  // Skeleton placeholders (see SkeletonCard) — static grey bars sized to roughly
  // match a real card so the loading state reserves the section's final height.
  skelBadge: { width: 68, height: 22, borderRadius: 6, backgroundColor: t.colors.alpha.ink10 },
  skelTitle: {
    marginTop: 14,
    width: '85%',
    height: 20,
    borderRadius: 6,
    backgroundColor: t.colors.alpha.ink10,
  },
  skelLine: {
    marginTop: 10,
    width: '100%',
    height: 13,
    borderRadius: 5,
    backgroundColor: t.colors.alpha.ink08,
  },
  skelLineShort: { width: '60%' },
  skelMeta: {
    marginTop: 16,
    width: '45%',
    height: 13,
    borderRadius: 5,
    backgroundColor: t.colors.alpha.ink08,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  billBadge: {
    alignSelf: 'flex-start',
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: t.radii.badge,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  billBadgeText: {
    fontFamily: t.typography.mono,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.4,
    color: t.colors.brand.deep,
  },
  hotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.omnibus.fill,
    borderWidth: 1,
    borderColor: t.colors.omnibus.border,
    borderRadius: t.radii.pill,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  hotPillText: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: 0.4,
    color: t.colors.omnibus.text,
    // Stay on one line at the larger size.
    ...(isWeb ? ({ whiteSpace: 'nowrap' } as object) : null),
  },
  newsTitle: {
    marginTop: 12,
    fontFamily: t.typography.title,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.2,
    color: t.colors.text.primary,
  },
  newsSummary: {
    marginTop: 9,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26,
    color: t.colors.text.muted,
  },
  cardMeta: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 10,
  },
  metaStatus: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  // Bold action text in the "Latest action: {action}" meta line.
  metaActionBold: { color: t.colors.text.primary, fontWeight: t.fontWeights.bold },
  // Grey date. The mock's #9aa39e fails WCAG AA on white (~2.9:1), so this uses
  // the repo's AA-hardened faint token (the same darkening tokens.ts already
  // applied to the mock greys) — de-emphasized but readable.
  metaEffective: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.faint,
  },
  // A sub-labeled group (RECENTLY PASSED / RECENTLY INTRODUCED + its card).
  // marginTop 16 sits it below the section h2; gap 14 spaces the label from its
  // card. A group that FOLLOWS another (activityGroupFollowing) gets 32 above
  // instead, so its label has more space above than below and reads as grouped
  // with the card beneath it, not the card above.
  activityGroup: { marginTop: 16, gap: 14 },
  activityGroupFollowing: { marginTop: 32 },
  groupLabel: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
    color: t.colors.text.muted,
  },
  activityHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  activityStatus: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  activityProgress: { marginTop: 14 },
  activityTitle: {
    marginTop: 14,
    fontFamily: t.typography.title,
    fontSize: 20,
    lineHeight: 27,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.2,
    color: t.colors.text.primary,
  },
  seeMore: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink20,
    borderRadius: 13,
    paddingVertical: 14,
  },
  seeMoreText: {
    fontFamily: t.typography.ui,
    fontSize: 17,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  // Arrow drawn as an SVG, not the "→" glyph. Libre Franklin's Google-Fonts
  // latin subset omits U+2192, so a glyph arrow always falls back to a different
  // font per OS (Helvetica on desktop → long; Roboto on Android → short and
  // vertically offset), which read inconsistently. An SVG renders identically
  // everywhere. Nudged down ~1px so it optically centers on the label's x-height.
  seeMoreArrow: {
    position: 'relative',
    top: 1,
  },
  askSub: {
    marginTop: 8,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 25,
    color: t.colors.text.muted,
  },
  askShell: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 13,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  askIcon: { marginTop: 2 },
  askInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: t.typography.body,
    fontSize: 19,
    lineHeight: 26,
    color: t.colors.text.primary,
    ...(isWeb ? ({ outlineStyle: 'none' } as object) : null),
  },
  askButton: {
    marginTop: 12,
    backgroundColor: t.colors.purple.base,
    borderRadius: 13,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askButtonText: {
    fontFamily: t.typography.ui,
    fontSize: 19,
    fontWeight: t.fontWeights.bold,
    color: t.colors.white,
  },
  // Continuous green→white band spanning Find My Legislator + Be in the Know
  // (see greenBandGradientWeb). No hard break; section rhythm comes from the inner
  // Containers. finderInner is overflow:hidden to contain the masked green dots.
  greenBand: { position: 'relative' },
  finderInner: { position: 'relative', overflow: 'hidden' },
  finderH2: {
    fontFamily: t.typography.title,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.6,
    color: t.colors.text.primary,
  },
  finderSub: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 25,
    color: t.colors.text.secondary,
  },
  finderShell: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  finderInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: t.typography.body,
    fontSize: 19,
    color: t.colors.text.primary,
    paddingVertical: 4,
    ...(isWeb ? ({ outlineStyle: 'none' } as object) : null),
  },
  findButton: {
    marginTop: 12,
    backgroundColor: t.colors.brand.base,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  findButtonText: {
    fontFamily: t.typography.ui,
    fontSize: 19,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.onGreen,
  },
  cityRow: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  accountCard: {
    marginTop: 8,
    backgroundColor: t.colors.tint.t50,
    borderWidth: 1,
    borderColor: '#cbeed6',
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 24,
  },
  accountH3: {
    fontFamily: t.typography.title,
    fontSize: 24,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.2,
    color: t.colors.text.primary,
  },
  accountBody: {
    marginTop: 12,
    marginBottom: 20,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 27,
    color: t.colors.text.secondary,
  },
});

function ViewAllButton({ onPress }: { onPress: () => void }) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...hoverProps}
      style={[styles.viewAllBtn, hovered && { borderColor: t.colors.brand.base }]}
    >
      <Text style={[styles.viewAllText, hovered && { color: t.colors.brand.deep }]}>VIEW ALL</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, position: 'relative' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 0 },

  // hero
  heroWrap: { position: 'relative' },
  heroBody: { paddingTop: 80 },
  heroGrid: { gap: 40 },
  heroGridDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
  heroLeft: { flex: 1, minWidth: 0, maxWidth: 720 },
  heroEyebrow: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.medium,
    letterSpacing: 2.7,
    color: t.colors.brand.deep,
    marginBottom: 36,
  },
  heroH1: {
    fontFamily: t.typography.title,
    fontSize: 72,
    lineHeight: 72,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1.4,
    color: t.colors.text.primary,
  },
  heroH1Mobile: { fontSize: 44, lineHeight: 44, letterSpacing: -0.9 },
  heroH1Green: { color: t.colors.brand.deep },
  heroSubhead: {
    marginTop: 36,
    fontFamily: t.typography.body,
    fontSize: 23,
    lineHeight: 34,
    color: t.colors.text.secondary,
    maxWidth: 660,
  },
  heroSubheadMobile: { marginTop: 28, fontSize: 22, lineHeight: 33 },
  fieldShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 14,
    paddingVertical: 6,
    paddingRight: 6,
    paddingLeft: 26,
  },
  askShell: { marginTop: 48, maxWidth: 720 },
  askInput: {
    flex: 1,
    minWidth: 0,
    minHeight: ASK_MIN_HEIGHT,
    maxHeight: ASK_MAX_HEIGHT,
    fontFamily: t.typography.body,
    fontSize: 21,
    lineHeight: 28,
    color: t.colors.text.primary,
    paddingVertical: 16,
    paddingHorizontal: 6,
    textAlignVertical: 'top',
    ...(isWeb ? ({ outlineStyle: 'none' } as object) : null),
  },
  askButton: {
    backgroundColor: t.colors.brand.base,
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 40,
  },
  askButtonText: {
    fontFamily: t.typography.ui,
    fontSize: 20,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.darkest,
  },
  // Mobile: field row + full-width Ask button stacked in a column.
  askFieldMobile: { gap: 12 },
  // Top-align the icon (row no longer centers) and balance the right padding now
  // that the inline button is gone.
  askShellMobileInner: { alignItems: 'flex-start', paddingRight: 26 },
  askIconMobile: { marginTop: 17 },
  // Mobile ask size matches the Find field's placeholder (20px, tokens.h4) so the two
  // hero fields read consistently; still below the 21px desktop size.
  askInputMobile: { fontSize: 20, lineHeight: 26 },
  askButtonMobile: {
    backgroundColor: t.colors.brand.base,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    maxWidth: 720,
  },
  exampleChip: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink12,
    borderRadius: t.radii.pill,
    paddingVertical: 9,
    paddingHorizontal: 16,
    // 44px min touch target (WCAG 2.5.5); the label centers within it.
    minHeight: 44,
    justifyContent: 'center',
  },
  exampleChipText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.secondary,
  },
  exampleChipTextMobile: { fontSize: 15 },
  chipHover: { borderColor: t.colors.purple.base },
  heroRight: { minWidth: 0 },
  heroRightDesktop: { flex: 1, alignItems: 'flex-end', marginTop: -10 },
  heroBottomSpace: { height: 88 },

  // answer card
  answerCard: {
    width: 600,
    maxWidth: '100%',
    backgroundColor: t.colors.surfaces.base,
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 34,
    position: 'relative',
  },
  answerCardMobile: { paddingVertical: 24, paddingHorizontal: 22 },
  answerOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 20, zIndex: 5 },
  askedQuestion: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.subheadLg,
    fontWeight: t.fontWeights.bold,
    lineHeight: 25,
    color: t.colors.text.primary,
    marginBottom: 16,
  },
  billDividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  billDividerLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.2,
    color: t.colors.text.muted,
  },
  hairlineFlex: { flex: 1, height: 1, backgroundColor: t.colors.alpha.ink08 },
  hairline: { height: 1, backgroundColor: t.colors.alpha.ink08, marginBottom: 14 },
  billMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  billBadgeLg: {
    marginTop: 5,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  billBadgeLgText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.6,
    color: t.colors.brand.deep,
  },
  billMetaCols: { flex: 1, minWidth: 0 },
  billMetaColsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' },
  billMetaText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    lineHeight: 21,
    color: t.colors.text.secondary,
  },
  billMetaBold: { fontWeight: t.fontWeights.bold },
  billMetaLinkRow: { flexDirection: 'row', alignItems: 'center' },
  // Mobile compact metadata grid: fixed 90px left column + 20px gap + flexible right column.
  billMetaMobile: { marginBottom: 14 },
  billMetaMobileRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  // Left column wide enough for the "HF 4138" badge on one line; badge left-aligned
  // (flush with the votes below it), matching the design. Both cells share the width
  // so the right column aligns across both rows.
  billMetaMobileBadgeCell: { width: 104, alignItems: 'flex-start' },
  billMetaMobileVotesCell: { width: 104 },
  billMetaMobileRight: { flex: 1, minWidth: 0 },
  answerSummary: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subheadLg,
    lineHeight: 27,
    color: t.colors.ink,
    marginBottom: 14,
  },
  answerSummaryBold: { fontWeight: t.fontWeights.semibold },
  citedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  citedLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.text.muted,
  },
  sectionCardStack: { gap: 8 },
  sectionCardBox: {
    backgroundColor: '#f7f9f8',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  sectionCardHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  sectionCardNum: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: t.colors.purple.tint,
    borderWidth: 1,
    borderColor: t.colors.purple.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCardNumText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    color: t.colors.purple.base,
  },
  sectionCardTitle: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  sectionCardQuote: {
    marginTop: 8,
    paddingLeft: 12,
    borderLeftWidth: 3,
    borderLeftColor: t.colors.tint.border,
  },
  sectionCardQuoteText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary,
    fontStyle: 'italic',
  },
  sectionCardNote: {
    marginTop: 6,
    paddingLeft: 15,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 20,
    // muted, not faint: this note sits on the tinted card bg (#f7f9f8), where faint
    // (#70776f) is only 4.36:1 — below WCAG AA. muted (#656c66) is ~5.0:1 there.
    color: t.colors.text.muted,
  },
  answerFooter: {
    marginTop: 12,
    paddingLeft: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  answerFooterHost: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    color: t.colors.text.faint,
  },

  // capability directory
  capSection: { backgroundColor: t.colors.surfaces.base, paddingTop: 60, paddingBottom: 64 },
  sectionEyebrow: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.6,
    color: t.colors.brand.deep,
    marginBottom: 22,
  },
  capGrid: { flexDirection: 'row', gap: 20 },
  capGridStacked: { flexDirection: 'column' },
  capCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 16,
    padding: 24,
  },
  capIconTile: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: t.colors.tint.t150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capBody: { flex: 1, minWidth: 0 },
  capTitle: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.subheadLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  capSubtitle: {
    marginTop: 5,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    lineHeight: 24,
    color: t.colors.text.secondary,
  },

  // finder band
  finderBand: { position: 'relative', paddingTop: 64, paddingBottom: 128, overflow: 'hidden' },
  finderGrid: { gap: 40 },
  finderGridDesktop: { flexDirection: 'row', alignItems: 'center', gap: 56 },
  finderLeft: { flex: 1.15, minWidth: 0, maxWidth: 760 },
  finderH2: {
    fontFamily: t.typography.title,
    fontSize: 52,
    lineHeight: 53,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1,
    color: t.colors.text.primary,
  },
  finderH2Mobile: { fontSize: 40, lineHeight: 42 },
  finderSub: {
    marginTop: 22,
    fontFamily: t.typography.body,
    fontSize: 22,
    lineHeight: 33,
    color: t.colors.text.secondary,
    maxWidth: 820,
  },
  // Field-group wrapper (positioning); mirrors askShell so the mobile stacked Find
  // button and the field share the 600px cap and align.
  finderFieldWrap: { marginTop: 38, maxWidth: 600 },
  finderShellInner: { paddingLeft: 24 },
  // Mobile: balance right padding now that the inline Find button is gone (the default
  // fieldShell paddingRight of 6 assumes an inline trailing button).
  finderShellMobileInner: { paddingLeft: 24, paddingRight: 24 },
  finderInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.h4,
    color: t.colors.text.primary,
    paddingVertical: 16,
    paddingHorizontal: 6,
    ...(isWeb ? ({ outlineStyle: 'none' } as object) : null),
  },
  cityRow: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    maxWidth: 760,
  },
  cityChip: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 15,
    // 44px min touch target (WCAG 2.5.5); the label centers within it.
    minHeight: 44,
    justifyContent: 'center',
  },
  cityChipText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1,
    color: t.colors.text.primary,
  },
  // Mobile home scales city-chip labels up ~1.2x for legibility (2nd-pass delta #6).
  cityChipTextMobile: { fontSize: 15 },
  finderMap: { flex: 0.85, alignItems: 'center', justifyContent: 'center' },

  // bills section
  billsSection: { backgroundColor: t.colors.surfaces.base, paddingTop: 52, paddingBottom: 76 },
  billsHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 24,
    flexWrap: 'wrap',
    marginTop: -8,
  },
  billsH2: {
    fontFamily: t.typography.title,
    fontSize: 44,
    lineHeight: 48,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.9,
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  billsH2Mobile: { fontSize: 32, lineHeight: 36 },
  viewAllBtn: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink20,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  viewAllText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.6,
    color: t.colors.text.primary,
  },
  billGroups: { marginTop: 30, gap: 40 },
  billGroupLabel: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.7,
    color: t.colors.text.secondary,
    marginBottom: 16,
  },
  billStack: { gap: 18 },
  billCard: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 16,
    paddingVertical: 26,
    paddingHorizontal: 32,
  },
  billCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 24,
  },
  billCardTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  billBadgeSm: {
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  billBadgeSmText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.6,
    color: t.colors.brand.deep,
  },
  billStatus: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  progressRowMobile: { marginTop: 12 },
  progressStep: { width: 30, height: 7, borderRadius: 4 },
  trackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.colors.ink,
    borderWidth: 1,
    borderColor: t.colors.ink,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 22,
  },
  trackBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.white,
  },
  billSummary: {
    marginTop: 16,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.h4,
    lineHeight: 30,
    color: t.colors.ink,
  },
  billLine: {
    marginTop: 8,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.secondary,
  },
  billLineText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.secondary,
  },
  billAuthor: { color: t.colors.brand.deep, fontWeight: t.fontWeights.bold },
  billAction: { color: t.colors.text.primary, fontWeight: t.fontWeights.semibold },
  billActionDate: { color: t.colors.text.faint },
  billVotesRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexWrap: 'wrap',
  },
  billVoteNum: {
    fontFamily: t.typography.mono,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  billVotePending: { color: t.colors.text.faint, fontWeight: t.fontWeights.semibold },
  billAmberRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexWrap: 'wrap',
  },
  billAmberText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  billAmberBold: { color: t.colors.status.amber, fontWeight: t.fontWeights.bold },
  billTagsRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  billTag: {
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  billTagText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.text.secondary,
  },
  companionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  companionPillText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.3,
    color: t.colors.brand.deep,
  },

  // account card
  accountSection: { backgroundColor: t.colors.surfaces.base, paddingTop: 20, paddingBottom: 72 },
  accountCard: {
    borderWidth: 1,
    borderColor: t.colors.tint.t300,
    borderRadius: 20,
    paddingVertical: 36,
    paddingHorizontal: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 44,
  },
  accountCardStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 28 },
  // In a stacked (column) card, flex ratios distribute *vertical* space and clip the
  // text behind the button — so drop the ratio and let each block size to content.
  accountColMobile: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  accountText: { flex: 1.35, minWidth: 0 },
  accountH3: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h1,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
  },
  accountBody: {
    marginTop: 14,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subheadLg,
    lineHeight: 29,
    color: t.colors.text.secondary,
    maxWidth: 620,
  },
  accountAction: { flex: 1, minWidth: 0 },
});
