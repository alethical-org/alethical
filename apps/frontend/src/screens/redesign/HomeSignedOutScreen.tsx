import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';
import { MapPin } from 'lucide-react-native';

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
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import { fieldFocusRing } from '../../theme/fieldFocus';
import { useResponsive } from '../../hooks/useResponsive';
import { useBillTracking } from '../../hooks/useBillTracking';
import { useBill, useBills, useTrackedBills } from '../../hooks/useAppQueries';
import { useLastVisitWithoutAdvancing } from '../../hooks/useTrackedBillsLastVisit';
import { useAuth } from '../../providers/AuthProvider';
import { SessionWatchCard } from '../../components/home/SessionWatchCard';
import { sessionWatch } from '../../lib/sessionWatch';
import { lastVisitFrom } from '../../lib/trackedBillsLastVisit';
import { BillResultCard } from '../../components/search/BillResultCard';
import { formatNiceDate, plainBillSummary } from '../../lib/billDetail';
import { HOT_ISSUE_BILL_KEYS } from '../../lib/hotIssues';
import type { Bill } from '../../data/types';

// The v2 signed-out home — docs/mockups/home-signed-out-v2 (README = state/token/copy
// spec; the .dc.html = literal values). The answer card and the bill cards are STATIC
// marketing illustration built from researched data — not ingestion, not generated
// answers (held decision 2026-07-12, see #143). Do not wire them to data here.

const t = theme;
const isWeb = Platform.OS === 'web';

// "Welcome back, Jordan" — the given name only. A full name in a greeting reads as
// an address label rather than a greeting, and the account control in the nav
// already carries the whole identity.
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

// The reader's LOCAL calendar day, so a visit at 9pm Minnesota time is not dated to
// the next day by its UTC timestamp. Same helper shape the tracked page uses.
function localDay(at: Date): string {
  const month = `${at.getMonth() + 1}`.padStart(2, '0');
  const day = `${at.getDate()}`.padStart(2, '0');
  return `${at.getFullYear()}-${month}-${day}`;
}

// Beside the hero's state line. Green rising line when something moved, grey clock
// when it is quiet, grey ring while we are still checking — never an error colour,
// because none of the three is a failure. The state line beside it carries the
// whole message, so these are decorative.
function HeroStateGlyph({ glyph }: { glyph: 'trend' | 'clock' | 'spinner' }) {
  if (glyph === 'trend') {
    return (
      <Svg
        width={30}
        height={30}
        viewBox="0 0 24 24"
        fill="none"
        style={heroGlyphStyle}
        aria-hidden
      >
        <Path
          d="M5 16 L11 10 L14 13 L19 8"
          stroke={theme.colors.brand.graphics}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M14.5 8 H19 V12.5"
          stroke={theme.colors.brand.graphics}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }
  if (glyph === 'spinner') {
    return (
      <Svg
        width={30}
        height={30}
        viewBox="0 0 24 24"
        fill="none"
        style={heroGlyphStyle}
        aria-hidden
      >
        <Circle
          cx={12}
          cy={12}
          r={9}
          stroke={theme.colors.status.progressEmpty}
          strokeWidth={2.2}
        />
        <Path
          d="M21 12 a9 9 0 0 0 -9 -9"
          stroke={theme.colors.text.muted}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
      </Svg>
    );
  }
  return (
    <Svg width={30} height={30} viewBox="0 0 24 24" fill="none" style={heroGlyphStyle} aria-hidden>
      <Circle cx={12} cy={12} r={8.5} stroke={theme.colors.text.muted} strokeWidth={1.9} />
      <Path
        d="M12 7.6 V12 L15 14"
        stroke={theme.colors.text.muted}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Nudged onto the first line's cap height rather than its box top.
const heroGlyphStyle = { marginTop: 8, flexShrink: 0 } as const;

// .18s ease micro-transitions (README "Hover / focus micro-states") — web only.
const transition = (props: string): object =>
  isWeb && !prefersReducedMotion()
    ? ({
        transitionProperty: props,
        transitionDuration: '0.18s',
        transitionTimingFunction: 'ease',
      } as object)
    : {};

// A row of city-name chips used to sit under the Find field. They were removed
// with #873: Minnesota legislative districts are drawn below city level, and the
// lookup's geocoder only matches a house number + street, so every city chip led
// to "address could not be geocoded" — a suggestion that can only refuse is what
// grounded-answers.md rule 2 forbids.

// --- Small shared bits ---

function useHover(): [boolean, { onHoverIn: () => void; onHoverOut: () => void }] {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }];
}

/** Green inline text link (chief author, "View bill profile →"). */
function TextLink({
  label,
  href,
  onPress,
  internal = false,
  size = 14,
  weight = t.fontWeights.bold,
}: {
  label: string;
  // External sources (revisor.mn.gov, house.mn.gov) get target="_blank"; an
  // `internal` href is an in-app page (a bill profile), so it navigates in place
  // via linkProps instead of opening a new tab.
  href?: string;
  onPress?: () => void;
  internal?: boolean;
  size?: number;
  weight?: '400' | '500' | '600' | '700' | '800' | '900';
}) {
  const [hovered, hoverProps] = useHover();
  const anchorProps = href
    ? internal
      ? linkProps(href, onPress)
      : externalLinkProps(href, onPress)
    : { accessibilityRole: 'link' as const, onPress };
  return (
    <Pressable {...anchorProps} {...hoverProps}>
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

// Hover lift for the hero entry buttons (mock: 0 10px 28px rgba(17,21,15,0.08)).
// Web-only micro-state (hover never fires on touch); native gets nothing.
const heroEntryHoverShadow = Platform.select({
  web: { boxShadow: '0 10px 28px rgba(17,21,15,0.08)' },
  default: {},
}) as object;

/**
 * Hero entry-point button — a real in-app link: leading icon + bold label + a
 * green trailing arrow. The two of these replace the hero's earlier free-form
 * Ask field and prompt chips (free-form Ask is roadmap, not shipped), routing to
 * the two search surfaces that work today.
 */
function HeroEntryButton({
  icon,
  label,
  href,
  onPress,
  fullWidth = false,
}: {
  icon: 'search' | 'person';
  label: string;
  href: string;
  onPress: () => void;
  /** Phones stack these full-width; every wider layout sizes them to content. */
  fullWidth?: boolean;
}) {
  const [hovered, hoverProps] = useHover();
  const green = t.colors.brand.graphics;
  return (
    <Pressable
      {...linkProps(href, onPress)}
      {...hoverProps}
      style={[
        styles.heroEntryButton,
        fullWidth && styles.heroEntryButtonFull,
        transition('border-color, box-shadow'),
        hovered && styles.heroEntryButtonHover,
        hovered && heroEntryHoverShadow,
      ]}
    >
      <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
        {icon === 'search' ? (
          <>
            <Circle cx={11} cy={11} r={7} stroke={green} strokeWidth={2} />
            <Path d="M16.5 16.5 L21 21" stroke={green} strokeWidth={2} strokeLinecap="round" />
          </>
        ) : (
          <>
            <Circle cx={12} cy={8} r={3.4} stroke={green} strokeWidth={2} />
            <Path
              d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"
              stroke={green}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </>
        )}
      </Svg>
      <Text style={styles.heroEntryLabel}>{label}</Text>
      {/* Trailing arrow — a text glyph, not an SVG stub, so it optically centers on
          the label's x-height. It reads as part of the link's name ("Search Bills →"),
          the same trailing-arrow convention as TextLink ("Read the full law →"). On
          this web hero Libre Franklin's missing U+2192 falls back to Helvetica and
          renders true; the SVG-arrow swap (memory: libre-franklin-omits-right-arrow-
          glyph) is an Android concern, and the desktop hero only renders at ≥1100px. */}
      <Text style={styles.heroEntryArrow}>→</Text>
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

// The bill code badge and the "View bill profile" footer link both point to our own
// bill profile page (in-app navigation), not the official source — so badge and link
// agree. The external source-text link lives on the bill profile, not on this teaser.
const HF4138_BILL_ID = '94-2026-HF4138';
// Chief author's legislator profile on our own site (in-app navigation), matching the
// badge and footer link. Her official House profile is reachable from that profile page.
const PEGGY_SCOTT_LEGISLATOR_ID = '2ebc386c-bf7e-4b9c-9d81-81f3bef1f971';

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
  const navigation = useNavigation<any>();
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

      {/* Full-width divider between the question and the bill facts. */}
      <View style={styles.billDividerRow}>
        <View style={styles.hairlineFlex} />
      </View>

      {/* badge + meta. Mobile: compact 2×2 grid (fixed 90px left column shared by
          badge + votes; right column holds dates and chief author, both aligned
          at 90 + 20px). Desktop: two balanced meta columns (left = signed/effective,
          right = chief author + vote counts). */}
      {isMobile ? (
        <View style={styles.billMetaMobile}>
          <View style={styles.billMetaMobileRow}>
            <View style={styles.billMetaMobileBadgeCell}>
              <Pressable
                {...linkProps(routePath.bill(HF4138_BILL_ID), () =>
                  navigation.navigate('BillDetail', { billId: HF4138_BILL_ID }),
                )}
                {...badgeHover}
                style={[styles.billBadgeLg, badgeHovered && { backgroundColor: '#fbe7bd' }]}
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
                  href={routePath.legislator(PEGGY_SCOTT_LEGISLATOR_ID)}
                  internal
                  size={13}
                  weight="600"
                  onPress={() =>
                    navigation.navigate('LegislatorProfile', {
                      legislatorId: PEGGY_SCOTT_LEGISLATOR_ID,
                    })
                  }
                />
              </View>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.billMetaRow}>
          <Pressable
            {...linkProps(routePath.bill(HF4138_BILL_ID), () =>
              navigation.navigate('BillDetail', { billId: HF4138_BILL_ID }),
            )}
            {...badgeHover}
            style={[styles.billBadgeLg, badgeHovered && { backgroundColor: '#fbe7bd' }]}
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
                    href={routePath.legislator(PEGGY_SCOTT_LEGISLATOR_ID)}
                    internal
                    size={13}
                    weight="600"
                    onPress={() =>
                      navigation.navigate('LegislatorProfile', {
                        legislatorId: PEGGY_SCOTT_LEGISLATOR_ID,
                      })
                    }
                  />
                </View>
                <Text style={[styles.billMetaText, { marginTop: 2 }]}>
                  House 132–2 · Senate 66–0
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}

      <Text style={styles.answerSummary}>
        Minnesota’s{' '}
        <Text style={styles.answerSummaryBold}>Stop Harms from Addictive Social Media Act</Text>{' '}
        will require parental consent for kids under 16, ban addictive features, and default their
        accounts to the strictest privacy.
      </Text>

      <View style={styles.citedRow}>
        <Text style={styles.citedLabel}>CITED SECTIONS</Text>
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
      </View>

      <View style={styles.sectionCardStack}>
        <CitedSectionCard
          n="1"
          title="Parental consent"
          quote="A covered social media platform may not create an account for a user identified as a child … without first obtaining verifiable parental consent."
        />
        <CitedSectionCard
          n="2"
          title="Addictive features"
          quote="A covered social media platform may not present addictive interface features in the display or feed of any account of a child."
          note="Such as infinite scrolling, autoplay video, and push notifications"
        />
        <CitedSectionCard
          n="3"
          title="Privacy by default"
          quote="An account for a child shall have all privacy settings set by default at the most private levels."
        />
      </View>

      <View style={styles.answerFooter}>
        <TextLink
          label="View bill profile →"
          href={routePath.bill(HF4138_BILL_ID)}
          internal
          onPress={() => navigation.navigate('BillDetail', { billId: HF4138_BILL_ID })}
        />
      </View>

      {/* de-emphasis overlay while a nav menu is open */}
      {dimmed ? <View pointerEvents="none" style={[styles.answerOverlay, blurOverlay]} /> : null}
    </View>
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
                    ? t.colors.brand.graphics
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

// Editorially flagged "🔥 Hot issue" bills (NEXT-home-spec §Bill Activity — Card
// chrome, web). A card carries the flag only when its bill is in the shared set
// (../../lib/hotIssues). The desktop feed is recency-driven (not curated), so a
// flagged bill shows the pill when it happens to appear in the top-2 passed /
// top-3 introduced.

function HomeSignedOutDesktop() {
  const navigation = useNavigation<any>();
  const { isTracked, toggleTrack } = useBillTracking();
  // ONE homepage, not two (#1034). Only the hero region branches on auth;
  // everything below it — Bills Moving, Find My Legislator, the footer, the nav —
  // is identical either way, so signing in never takes a capability away.
  const { isSignedIn, user } = useAuth();
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
  const [finderFocused, setFinderFocused] = useState(false);
  const [finderValue, setFinderValue] = useState('');
  const finderInputRef = useRef<TextInput>(null);
  // Find hands the typed address to Find My Legislator, which looks it up on
  // arrival (#873). Empty field focuses instead of navigating, same as Ask above.
  const openFinder = () => {
    const address = finderValue.trim();
    if (!address) {
      finderInputRef.current?.focus();
      return;
    }
    navigation.navigate('FindMyLegislator', { address });
  };

  // The signed-in hero's inputs. Both queries are gated on being signed in AND on
  // Home being the visible screen, like the feed queries above.
  const trackedQuery = useTrackedBills(isSignedIn && isFocused ? user?.id : undefined);
  // READS the last-looked mark and never advances it (#1034). Only opening the
  // tracked list itself advances it — a glance at a card showing two of six moved
  // bills must not mark all six as seen.
  const lastVisitQuery = useLastVisitWithoutAdvancing(
    isSignedIn && isFocused ? user?.id : undefined,
  );
  const lastVisitData = lastVisitQuery.data;
  const trackedBills = trackedQuery.data;
  const watchNow = useRef(new Date()).current;
  const watch = useMemo(() => {
    const lastVisit = lastVisitFrom(lastVisitData);
    // The tracked list itself is still loading, so we do not yet know what to
    // compare — the same "we have not asked" case, and it renders as pending
    // rather than as an empty watchlist (#1026, #1034).
    if (!trackedBills) return sessionWatch([], { state: 'not-checked' }, watchNow, '');
    const visitedOn =
      lastVisit.state === 'previous-visit' ? formatNiceDate(localDay(lastVisit.at)) : '';
    return sessionWatch(trackedBills, lastVisit, watchNow, visitedOn);
  }, [trackedBills, lastVisitData, watchNow]);

  // "Or start from what's moving now" scrolls to the Bill Activity section already
  // further down this page, so someone tracking nothing is never at a dead end.
  // scrollIntoView rather than an anchor href: the section is a View, not a routed
  // location, and RN-Web drops a bare `id` (memory: RN-Web sticky/scroll-spy).
  const billActivityRef = useRef<View>(null);
  const scrollToBillActivity = () => {
    if (!isWeb || !billActivityRef.current) return;
    (billActivityRef.current as unknown as HTMLElement).scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
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
            />

            <Container style={styles.heroBody}>
              <View style={[styles.heroGrid, styles.heroGridDesktop]}>
                {/* LEFT */}
                <View style={[styles.heroLeft, styles.heroLeftDesktop]}>
                  {isSignedIn ? (
                    <>
                      {/* The STATE LINE is the headline and the greeting is a small
                          eyebrow above it. The news is why someone returns, not being
                          recognised — but the greeting stays rather than vanishing: it
                          carries a secondary account confirmation inside the reading
                          flow, which matters on a shared device, and it gives a stable
                          anchor above a line whose length swings from "Checking…" to
                          "11 of the 14 bills…". */}
                      <Text style={styles.heroGreeting}>
                        Welcome back{user?.name ? `, ${firstName(user.name)}` : ''}
                      </Text>
                      <View style={styles.heroStateRow}>
                        <HeroStateGlyph glyph={watch.glyph} />
                        <Text accessibilityRole="header" style={styles.heroStateLine}>
                          {watch.heroLine}
                        </Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.heroEyebrow}>TRUTH, UNCONCEALED</Text>
                      <Text accessibilityRole="header" style={styles.heroH1}>
                        Grounded answers{'\n'}
                        <Text style={styles.heroH1Green}>on Minnesota law</Text>
                      </Text>
                      <Text style={styles.heroSubhead}>
                        We read every bill so you don’t have to — what it says, where it stands, and
                        how legislators voted. Plain language, with every claim linked to the
                        official record.
                      </Text>
                    </>
                  )}

                  {/* ENTRY POINTS. Two real links replace the earlier free-form Ask
                      field + prompt chips (free-form Ask is roadmap, not shipped, and
                      the field duplicated Bill Search below the fold). Side by side,
                      wrapping to stacked when the column gets narrow. */}
                  <View style={styles.heroEntryRow}>
                    <HeroEntryButton
                      icon="search"
                      label="Search Bills"
                      href={routePath.bills()}
                      onPress={() => navigation.navigate('Bills')}
                    />
                    <HeroEntryButton
                      icon="person"
                      label="Search Legislators"
                      href={routePath.legislators()}
                      onPress={() => navigation.navigate('Legislators')}
                    />
                  </View>
                </View>

                {/* RIGHT: the Session watch card replaces the example answer card in
                    the same slot, footprint and shadow — not a band above the hero,
                    which would stack two heroes and make a signed-in reader scroll
                    past a pitch that already worked. */}
                <View style={[styles.heroRight, styles.heroRightDesktop]}>
                  {isSignedIn ? (
                    <SessionWatchCard
                      watch={watch}
                      onBill={(billId) => navigation.navigate('BillDetail', { billId })}
                      onAllTracked={() => navigation.navigate('Tracked')}
                      onSearchBills={() => navigation.navigate('Bills')}
                      onWhatsMoving={scrollToBillActivity}
                    />
                  ) : (
                    <AnswerCard dimmed={openMenu !== null} />
                  )}
                </View>
              </View>
            </Container>
            <View style={styles.heroBottomSpace} />
          </View>

          {/* BILLS MOVING THROUGH THE LEGISLATURE */}
          <View ref={billActivityRef} style={styles.billsSection}>
            <Container>
              <Text style={styles.sectionEyebrow}>2025–26 LEGISLATIVE SESSION</Text>
              <View style={styles.billsHeadRow}>
                <Text accessibilityRole="header" style={styles.billsH2}>
                  Bills Moving Through the Legislature
                </Text>
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
                          hotIssue={HOT_ISSUE_BILL_KEYS.has(bill.id)}
                          tracked={isTracked(bill.id)}
                          onToggleTrack={() => toggleTrack(bill.id)}
                          onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
                          onSponsorPress={(legislatorId) =>
                            navigation.navigate('LegislatorProfile', { legislatorId })
                          }
                          onRollCalls={() =>
                            navigation.navigate('BillDetail', { billId: bill.id, tab: 'votes' })
                          }
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
                          hotIssue={HOT_ISSUE_BILL_KEYS.has(bill.id)}
                          tracked={isTracked(bill.id)}
                          onToggleTrack={() => toggleTrack(bill.id)}
                          onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
                          onSponsorPress={(legislatorId) =>
                            navigation.navigate('LegislatorProfile', { legislatorId })
                          }
                          onRollCalls={() =>
                            navigation.navigate('BillDetail', { billId: bill.id, tab: 'votes' })
                          }
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
              <View style={[styles.finderGrid, styles.finderGridDesktop]}>
                <View style={styles.finderLeft}>
                  <Text accessibilityRole="header" style={styles.finderH2}>
                    Find My Legislator
                  </Text>
                  <Text style={styles.finderSub}>
                    Find who represents you — their profile, committees, and the bills they’ve
                    authored.
                  </Text>
                  {/* Find field, with the Find button inline. The narrow-width variant
                      lives in HomeSignedOutMobile, which is the component that renders
                      below 1100px — this one never does (#1076). */}
                  <View style={styles.finderFieldWrap}>
                    <FieldShell focused={finderFocused} style={styles.finderShellInner}>
                      <MapPin size={22} color={t.colors.text.faint} strokeWidth={2} />
                      <TextInput
                        ref={finderInputRef}
                        // No accessibilityLabel: the placeholder names the field (see ask input above).
                        value={finderValue}
                        onChangeText={setFinderValue}
                        onFocus={() => setFinderFocused(true)}
                        onBlur={() => setFinderFocused(false)}
                        onSubmitEditing={openFinder}
                        placeholder="Enter your street address, city, and ZIP"
                        placeholderTextColor={t.colors.text.faint}
                        style={styles.finderInput}
                      />
                      <PrimaryButton label="Find" onPress={openFinder} />
                    </FieldShell>
                  </View>
                </View>
                <View style={styles.finderMap}>
                  <MNMap size={330} />
                </View>
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
// (grounded-answers rule 9). The API now derives a statutory effective date for
// enacted bills whose act resolves to one (#483 / #562 / #706) — HF 4138 is one of
// them, and `bill.effectiveDate` serves the same July 1, 2027 shown here. SF 856 is
// NOT: the Revisor flags it "various dates", so its value stays editorial and these
// literals stay the single source for both cards rather than one card silently
// switching sources.
// HF 4138 → 2026 Ch. 111 §§1–2 (325M), both "effective July 1, 2027";
// SF 856 → 2026 Ch. 92, Minnesota's default effective date (Aug 1 following the
// May 14, 2026 signing) for the act's general provisions (some sections stagger).
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
function SeeMore({ href, onPress }: { href: string; onPress: () => void }) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      {...linkProps(href, onPress)}
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
          stroke={hovered ? t.colors.brand.graphics : t.colors.text.primary}
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
  // Live data, so it goes through the shared cleaner (grounded-answers rule 9). Full
  // text — the card clamps to 4 lines visually, which is not the same as dropping
  // everything after the first sentence.
  const summary = plainBillSummary(bill.aiAnalysis?.summary);
  return (
    <Pressable
      {...linkProps(routePath.bill(bill.id), onPress)}
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
// The two referral wordings moved to `completeStatusText` (lib/billDetail), which
// rewrites them the same way AND names the committee the record holds, so they
// never reach this map any more (#812).
const ACTION_LABELS: Record<string, string> = {
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
function ActivityCardMobile({
  bill,
  hotIssue,
  onPress,
}: {
  bill: Bill;
  hotIssue: boolean;
  onPress: () => void;
}) {
  const [hovered, hoverProps] = useHover();
  const { filled, vetoed } = statusToProgress(bill.status);
  // Live data — same shared cleaner, full text (this card clamps to 3 lines).
  const summary = plainBillSummary(bill.aiAnalysis?.summary);
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
      {...linkProps(routePath.bill(bill.id), onPress)}
      {...hoverProps}
      style={[m.card, transition('border-color, box-shadow'), hovered && m.cardHover]}
    >
      <View style={m.activityHeadRow}>
        <BillBadge label={bill.identifier} />
        <Text style={m.activityStatus}>{bill.status}</Text>
        {hotIssue ? (
          <View style={[m.hotPill, m.activityHotPill]}>
            <Text style={m.hotPillText}>🔥 Hot issue</Text>
          </View>
        ) : null}
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
  // Same branch as desktop: only the HERO changes on auth, and everything below it
  // is identical either way (#1034, #1069). This component serves BOTH narrow
  // breakpoints — phone under 768 and tablet 768-1100 — which differ in layout, not
  // in content.
  const { isSignedIn, user } = useAuth();
  const { isTablet } = useResponsive();
  const [finderFocused, setFinderFocused] = useState(false);
  const [finderValue, setFinderValue] = useState('');
  const finderInputRef = useRef<TextInput>(null);

  // Only fetch when Home is the visible screen. Under a bottom-tabs navigator Home
  // stays mounted beneath a deep-linked stack screen (e.g. a bill), so ungated it
  // would fire these queries and contend with the visible screen's first load.
  const isFocused = useIsFocused();
  // The signed-in hero's inputs. READS the last-looked mark and never advances it —
  // only opening the tracked list does that (#1034).
  const trackedQuery = useTrackedBills(isSignedIn && isFocused ? user?.id : undefined);
  const lastVisitQuery = useLastVisitWithoutAdvancing(
    isSignedIn && isFocused ? user?.id : undefined,
  );
  const lastVisitData = lastVisitQuery.data;
  const trackedBills = trackedQuery.data;
  const watchNow = useRef(new Date()).current;
  const watch = useMemo(() => {
    const lastVisit = lastVisitFrom(lastVisitData);
    if (!trackedBills) return sessionWatch([], { state: 'not-checked' }, watchNow, '');
    const visitedOn =
      lastVisit.state === 'previous-visit' ? formatNiceDate(localDay(lastVisit.at)) : '';
    return sessionWatch(trackedBills, lastVisit, watchNow, visitedOn);
  }, [trackedBills, lastVisitData, watchNow]);
  const billActivityRef = useRef<View>(null);
  const scrollToBillActivity = () => {
    if (!isWeb || !billActivityRef.current) return;
    (billActivityRef.current as unknown as HTMLElement).scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  // In the News — two pinned bills by key (bypasses the /bills AI-summary gate).
  const news0 = useBill(IN_THE_NEWS[0].key, { enabled: isFocused });
  const news1 = useBill(IN_THE_NEWS[1].key, { enabled: isFocused });
  // Bill Activity — live, date-ordered now that action dates are ingested (#329):
  //   • Recently Introduced = newest by real introduction date (sort=introduced).
  //   • Recently Passed = most recently enacted bills (status=signed_into_law,
  //     ordered by latest-action date desc — the signing/enactment milestone).
  //     "Passed both chambers, not yet signed" is ~0 genuine bills in the corpus
  //     (#305), so enacted is the honest population for the "Recently Passed" card.
  // Counts match the web home (NEXT-home-spec §"Bill Activity"): 2 passed, 3
  // introduced. The specific bills are illustrative; selection is date-driven.
  const introduced = useBills(
    undefined,
    undefined,
    { sort: 'introduced' },
    { limit: 3 },
    { enabled: isFocused },
  );
  const signed = useBills(
    undefined,
    undefined,
    { status: 'signed_into_law', sort: 'latest_action' },
    { limit: 2 },
    { enabled: isFocused },
  );
  // Bill detail ships as the redesigned mobile screen, so every bill card on this
  // page (In the News, Bill Activity) routes there — same target as the desktop
  // variant's cards above and Search Bills' result cards.
  const openBill = (billId: string) => navigation.navigate('BillDetail', { billId });
  const openSearchBills = () => navigation.navigate('Bills');
  // Find hands the typed address to Find My Legislator, which looks it up on
  // arrival (#873). Empty field focuses instead of navigating — a blank lookup
  // has nothing to answer.
  const openFinder = () => {
    const address = finderValue.trim();
    if (!address) {
      finderInputRef.current?.focus();
      return;
    }
    navigation.navigate('FindMyLegislator', { address });
  };

  const newsBills = [
    { pin: IN_THE_NEWS[0], bill: news0.data },
    { pin: IN_THE_NEWS[1], bill: news1.data },
  ].filter((n) => n.bill != null) as { pin: (typeof IN_THE_NEWS)[number]; bill: Bill }[];
  const introducedBills = introduced.data?.data ?? [];
  const signedBills = signed.data?.data ?? [];

  // First-paint layout stability: "In the News" and "Bill Activity" are gated on
  // async query data, so until those queries resolve they'd render null (zero
  // height) and the Find My Legislator section below them would sit right under
  // the hero, then jump down once the data arrived. While a section's queries are
  // still loading,
  // render skeletons in its slot so the page holds its final order from the first
  // paint (no content-driven layout shift). On error/empty the section still
  // collapses to null, unchanged.
  const newsLoading = news0.isLoading || news1.isLoading;
  const activityLoading = introduced.isLoading || signed.isLoading;

  // Masked dot textures — only two sections carry them (Hero, Find My
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
            />

            {/* HERO COPY (headline + subhead only — no ask field) */}
            <Container style={m.heroBody}>
              {isSignedIn ? (
                /* Order is fixed at both narrow widths: greeting, the news, the card,
                   then the actions. The actions stay BELOW the card deliberately —
                   search is one tap away in the hamburger drawer on every narrow
                   screen, so these are a convenience duplicate rather than a gated
                   capability, and putting them above would bury what the person came
                   back for (#1069). */
                <>
                  <Text style={m.heroGreeting}>
                    Welcome back{user?.name ? `, ${firstName(user.name)}` : ''}
                  </Text>
                  <View style={m.heroStateRow}>
                    <HeroStateGlyph glyph={watch.glyph} />
                    <Text
                      accessibilityRole="header"
                      style={[m.heroStateLine, isTablet && m.heroStateLineTablet]}
                      numberOfLines={isTablet ? 4 : 6}
                    >
                      {watch.heroLine}
                    </Text>
                  </View>
                  <View style={m.heroWatchCard}>
                    <SessionWatchCard
                      watch={watch}
                      onBill={(billId) => navigation.navigate('BillDetail', { billId })}
                      onAllTracked={() => navigation.navigate('Tracked')}
                      onSearchBills={openSearchBills}
                      onWhatsMoving={scrollToBillActivity}
                    />
                  </View>
                  {/* Side by side on a tablet, stacked full-width on a phone. */}
                  <View style={[m.heroActions, isTablet && m.heroActionsTablet]}>
                    <HeroEntryButton
                      icon="search"
                      label="Search Bills"
                      href={routePath.bills()}
                      onPress={openSearchBills}
                      fullWidth={!isTablet}
                    />
                    <HeroEntryButton
                      icon="person"
                      label="Search Legislators"
                      href={routePath.legislators()}
                      onPress={() => navigation.navigate('Legislators')}
                      fullWidth={!isTablet}
                    />
                  </View>
                </>
              ) : (
                <>
                  <Text style={m.heroEyebrow}>TRUTH, UNCONCEALED</Text>
                  <Text accessibilityRole="header" style={m.heroH1}>
                    Grounded answers{'\n'}
                    <Text style={m.heroH1Green}>on Minnesota law</Text>
                  </Text>
                  <Text style={m.heroSubhead}>
                    We read every bill so you don’t have to — what it says, where it stands, and how
                    legislators voted. Plain language, every answer linked to official sources.
                  </Text>
                </>
              )}
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
              <SeeMore href={routePath.bills()} onPress={openSearchBills} />
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
              <SeeMore href={routePath.bills()} onPress={openSearchBills} />
            </Container>
          ) : null}

          {/* LEGISLATIVE BILL ACTIVITY — live. Check loading FIRST so the skeletons
              hold until BOTH date-ordered queries settle, then both cards render
              together — no stagger. */}
          {activityLoading ? (
            <Container style={[m.section, m.activitySectionBottom]}>
              <Text style={m.eyebrow}>2025–2026 SESSION</Text>
              <Text accessibilityRole="header" style={m.sectionH2}>
                Legislative Bill Activity
              </Text>
              <View style={m.activityGroup}>
                <Text style={m.groupLabel}>RECENTLY PASSED</Text>
                <View style={m.activityCardStack}>
                  <SkeletonCard lines={3} />
                  <SkeletonCard lines={3} />
                </View>
              </View>
              <View style={[m.activityGroup, m.activityGroupFollowing]}>
                <Text style={m.groupLabel}>RECENTLY INTRODUCED</Text>
                <View style={m.activityCardStack}>
                  <SkeletonCard lines={3} />
                  <SkeletonCard lines={3} />
                  <SkeletonCard lines={3} />
                </View>
              </View>
              <SeeMore href={routePath.bills()} onPress={openSearchBills} />
            </Container>
          ) : introducedBills.length > 0 || signedBills.length > 0 ? (
            <Container style={[m.section, m.activitySectionBottom]}>
              <Text style={m.eyebrow}>2025–2026 SESSION</Text>
              <Text accessibilityRole="header" style={m.sectionH2}>
                Legislative Bill Activity
              </Text>
              {signedBills.length > 0 ? (
                <View style={m.activityGroup}>
                  <Text style={m.groupLabel}>RECENTLY PASSED</Text>
                  <View style={m.activityCardStack}>
                    {signedBills.map((bill) => (
                      <ActivityCardMobile
                        key={bill.id}
                        bill={bill}
                        hotIssue={HOT_ISSUE_BILL_KEYS.has(bill.id)}
                        onPress={() => openBill(bill.id)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
              {introducedBills.length > 0 ? (
                <View
                  style={
                    signedBills.length > 0
                      ? [m.activityGroup, m.activityGroupFollowing]
                      : m.activityGroup
                  }
                >
                  <Text style={m.groupLabel}>RECENTLY INTRODUCED</Text>
                  <View style={m.activityCardStack}>
                    {introducedBills.map((bill) => (
                      <ActivityCardMobile
                        key={bill.id}
                        bill={bill}
                        hotIssue={HOT_ISSUE_BILL_KEYS.has(bill.id)}
                        onPress={() => openBill(bill.id)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
              <SeeMore href={routePath.bills()} onPress={openSearchBills} />
            </Container>
          ) : null}

          {/* Free-form Ask section removed — Ask is roadmap, not shipped, and it
              duplicated Search. Mirrors dropping the ask field from the web hero.
              Section order is now hero → In the News → Bill Activity → Find My
              Legislator → footer. */}

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
                    placeholder="Enter your street address, city, and ZIP"
                    placeholderTextColor={t.colors.text.faint}
                    style={m.finderInput}
                  />
                </FieldShell>
                <Pressable accessibilityRole="button" onPress={openFinder} style={m.findButton}>
                  <Text style={m.findButtonText}>Find</Text>
                </Pressable>
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

const m = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  // flexGrow: 1 fills the window on a short page so the footer lands at the
  // bottom (styles.footer in theme/primitives.tsx) instead of leaving a band
  // of background below it.
  scrollContent: { position: 'relative', paddingBottom: 0, flexGrow: 1 },
  // The hero owns a masked dot texture; overflow:hidden contains the texture
  // (and its fade) to the section so it never bleeds page-wide.
  heroWrap: { position: 'relative', overflow: 'hidden' },
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
  heroH1Green: { color: t.colors.brand.display },
  // Signed-in hero, narrow (#1069). The state line is the headline at every width;
  // the greeting stays a small eyebrow above it.
  heroGreeting: {
    fontFamily: theme.typography.ui,
    fontSize: theme.fontSizes.bodyLg,
    fontWeight: theme.fontWeights.semibold,
    color: theme.colors.text.muted,
  },
  heroStateRow: { marginTop: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  // The size ladder is PINNED rather than left to judgment: this is the largest and
  // most variable string on the page, and the worst real case is "11 of the 14 bills
  // you're tracking moved since you last opened your tracked bills on Mar 12".
  // 26px/6 lines under 768, 32px/4 lines on a tablet, 38px/4 on desktop.
  heroStateLine: {
    flex: 1,
    fontFamily: theme.typography.title,
    fontSize: 26,
    lineHeight: 33,
    fontWeight: theme.fontWeights.heavy,
    letterSpacing: -0.52,
    color: theme.colors.text.primary,
    ...(isWeb ? ({ textWrap: 'pretty' } as object) : null),
  },
  heroStateLineTablet: { fontSize: 32, lineHeight: 40, letterSpacing: -0.64 },
  heroWatchCard: { marginTop: 22 },
  // Stacked and full-width on a phone; side by side on a tablet.
  heroActions: { marginTop: 20, gap: 12 },
  heroActionsTablet: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
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
  // Bill Activity only: +20 bottom padding over the shared section rhythm. With the
  // Ask section gone, the green Find My Legislator band sits directly under this
  // list's "See more" button. The separation should be neutral page-background space
  // before the band, not more green inside it (that would leave the band's heading
  // floating in a green void), so the extra gap lives here, below "See more".
  activitySectionBottom: { paddingBottom: 60 },
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
    backgroundColor: t.colors.omnibus.fill,
    borderWidth: 1,
    borderColor: t.colors.omnibus.border,
    borderRadius: t.radii.badge,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  billBadgeText: {
    fontFamily: t.typography.mono,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.4,
    color: t.colors.omnibus.text,
  },
  // Editorial "🔥 Hot issue" flag: a NEUTRAL pill, matching web (BillResultCard
  // hotPill). Amber is reserved for the bill-code badge — a hot issue is an
  // editorial flag, not a code, so it must not wear the code color. Same neutral
  // tokens as web; only the font size stays at the larger mobile scale below.
  hotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaces.s400, // #f1f1f4 — neutral grey, never amber
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08, // rgba(17,21,15,0.08)
    borderRadius: t.radii.pill, // 999
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  hotPillText: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: 0.4,
    color: t.colors.text.secondary, // #4f5651
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
  // Cards within a group (web home shows 2 passed / 3 introduced). 18px apart,
  // matching the In-the-News card spacing (cardStack) so both stacks read alike.
  activityCardStack: { gap: 18 },
  groupLabel: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
    color: t.colors.text.muted,
  },
  activityHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Push the "🔥 Hot issue" flag to the card's right edge, matching where the
  // In-the-News card sits it (top-right of the top row).
  activityHotPill: { marginLeft: 'auto' },
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

const styles = StyleSheet.create({
  root: { flex: 1, position: 'relative' },
  scroll: { flex: 1 },
  // flexGrow: 1 fills the window on a short page so the footer lands at the
  // bottom (styles.footer in theme/primitives.tsx) instead of leaving a band
  // of background below it.
  scrollContent: { paddingBottom: 0, flexGrow: 1 },

  // hero
  heroWrap: { position: 'relative' },
  heroBody: { paddingTop: 80 },
  heroGrid: { gap: 40 },
  heroGridDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
  heroLeft: { flex: 1, minWidth: 0, maxWidth: 720 },
  // Nudge the left column down ~40px so it sits above center, headline anchored high.
  // The answer card on the right runs taller, so with a top-aligned grid the left
  // column's buttons left an empty pocket at the lower-left; this offset shrinks that
  // pocket while keeping the headline in the upper area (72px read as centered, and
  // full centering would open a new void at the top-left). Grid stays
  // alignItems:'flex-start'; only the left moves.
  heroLeftDesktop: { marginTop: 40 },
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
  heroH1Green: { color: t.colors.brand.display },
  heroSubhead: {
    marginTop: 36,
    fontFamily: t.typography.body,
    fontSize: 23,
    lineHeight: 34,
    color: t.colors.text.secondary,
    maxWidth: 660,
  },
  // Signed-in hero. The greeting is deliberately SMALL — 18px against the state
  // line's 38px. An older reference drew it at 52-60px; that spec is stale, and it
  // put the reader's own name where the news belongs.
  heroGreeting: {
    fontFamily: theme.typography.ui,
    fontSize: theme.fontSizes.subhead,
    fontWeight: theme.fontWeights.semibold,
    color: theme.colors.text.muted,
  },
  heroStateRow: { marginTop: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  heroStateLine: {
    flex: 1,
    fontFamily: theme.typography.title,
    fontSize: 38,
    lineHeight: 46,
    fontWeight: theme.fontWeights.heavy,
    letterSpacing: -0.76,
    color: theme.colors.text.primary,
  },
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
  // Hero entry buttons — two side-by-side links; wrap to stacked in a narrow column.
  heroEntryButtonFull: { alignSelf: 'stretch', justifyContent: 'center' },
  heroEntryRow: {
    marginTop: 44,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 14,
    maxWidth: 660,
  },
  heroEntryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink12,
    borderRadius: 14,
    paddingTop: 15,
    paddingRight: 20,
    paddingBottom: 15,
    paddingLeft: 17,
  },
  heroEntryButtonHover: { borderColor: 'rgba(45,212,126,0.55)' },
  heroEntryLabel: {
    fontFamily: t.typography.ui,
    fontSize: 19,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  heroEntryArrow: {
    fontFamily: t.typography.ui,
    fontSize: 19,
    fontWeight: t.fontWeights.regular,
    color: t.colors.brand.graphics,
  },
  heroRight: { minWidth: 0 },
  heroRightDesktop: { flex: 1, alignItems: 'flex-end', marginTop: -10 },
  // Tightened 88 -> 48: the answer card runs much taller than the left column, so
  // a tall bottom spacer left the hero reading bottom-heavy with a large trailing
  // gap down to "Bills Moving". Trimming it pulls that section up without moving the
  // card or the Search buttons.
  heroBottomSpace: { height: 48 },

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
  billDividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  hairlineFlex: { flex: 1, height: 1, backgroundColor: t.colors.alpha.ink08 },
  billMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    flexWrap: 'wrap',
    // 22px carries the facts→summary shift now that the plain hairline is gone.
    marginBottom: 22,
  },
  billBadgeLg: {
    marginTop: 5,
    backgroundColor: t.colors.omnibus.fill,
    borderWidth: 1,
    borderColor: t.colors.omnibus.border,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  billBadgeLgText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.6,
    color: t.colors.omnibus.text,
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
  billMetaMobile: { marginBottom: 22 },
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

  // Section eyebrow — small green label above a section (e.g. "2025–26 LEGISLATIVE SESSION").
  sectionEyebrow: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.6,
    color: t.colors.brand.deep,
    marginBottom: 22,
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
  finderMap: { flex: 0.85, alignItems: 'center', justifyContent: 'center' },

  // bills section
  // paddingBottom 76 -> 98: mirrors the mobile fix (#969). The green Find My
  // Legislator band sits directly below this section; the extra separation should be
  // neutral light page-background space here, below the last bill card, not more green
  // inside the band's top padding (that would float the band's heading in a green void).
  billsSection: { backgroundColor: t.colors.surfaces.base, paddingTop: 52, paddingBottom: 98 },
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
    backgroundColor: t.colors.omnibus.fill,
    borderWidth: 1,
    borderColor: t.colors.omnibus.border,
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  billBadgeSmText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.6,
    color: t.colors.omnibus.text,
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
