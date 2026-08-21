import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme, prefersReducedMotion } from '../../theme/tokens';
import { Container, Footer, MNMap, PageBackground, TopNav } from '../../theme/primitives';
import { getHomeDotVisibility } from '../../theme/pageBackground';
import { IaItem, MenuKey } from '../../navigation/ia';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import { useResponsive } from '../../hooks/useResponsive';
import { useBillTracking } from '../../hooks/useBillTracking';
import {
  useBills,
  useCampaignFinanceSummary,
  useFeaturedBills,
  useSessions,
  useTrackedBills,
} from '../../hooks/useAppQueries';
import { useLastVisitWithoutAdvancing } from '../../hooks/useTrackedBillsLastVisit';
import { useAuth } from '../../providers/AuthProvider';
import { SessionWatchCard } from '../../components/home/SessionWatchCard';
import { MoneyPromoCard } from '../../components/home/MoneyPromoCard';
import { sessionWatch } from '../../lib/sessionWatch';
import { lastVisitFrom } from '../../lib/trackedBillsLastVisit';
import { BillResultCard } from '../../components/search/BillResultCard';
import { formatNiceDate, plainBillSummary } from '../../lib/billDetail';
import { HOT_ISSUE_BILL_KEYS } from '../../lib/hotIssues';
import { HomeLegislatorFinder } from '../../components/home/HomeLegislatorFinder';
import { HOME_BILL_GROUP_CONTINUATIONS, HOME_PUBLIC_INTRO } from '../../lib/homepage';
import { formatSessionLabel, SESSION_LABEL_FALLBACK } from '../../lib/sessionLabel';
import { LinkArrow } from '../../components/LinkArrow';
import type { Bill } from '../../data/types';

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
          color: t.colors.text.green,
          textDecorationLine: hovered ? 'underline' : 'none',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function BillGroupContinuationLink({
  label,
  params,
  onPress,
  fullWidth = false,
}: {
  label: string;
  params: { status?: string; sort: string };
  onPress: () => void;
  fullWidth?: boolean;
}) {
  const [hovered, hoverProps] = useHover();
  // Rest/hover color is shared by the label and the drawn arrow, so the mark never
  // diverges from the text it trails (LinkArrow takes a color, not `currentColor`).
  const color = fullWidth
    ? hovered
      ? t.colors.text.green
      : t.colors.text.primary
    : t.colors.text.green;
  return (
    <View style={fullWidth ? undefined : styles.billGroupContinuationRow}>
      <Pressable
        {...linkProps(routePath.bills(params), onPress)}
        {...hoverProps}
        style={
          fullWidth
            ? [
                m.billGroupContinuation,
                transition('border-color'),
                hovered && m.billGroupContinuationHover,
              ]
            : undefined
        }
      >
        {/* Row, not an inline glyph: the arrow is drawn (LinkArrow), and `alignItems:
            center` is what puts it on the label's midline at every font size. */}
        <View style={styles.billGroupContinuationContent}>
          <Text
            style={[
              fullWidth ? m.billGroupContinuationText : styles.billGroupContinuationText,
              hovered && !fullWidth && styles.billGroupContinuationTextHover,
              { color },
            ]}
          >
            {label}
          </Text>
          <LinkArrow color={color} style={styles.billGroupContinuationArrow} />
        </View>
      </Pressable>
    </View>
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
  searchBand = false,
}: {
  icon: 'search' | 'person';
  label: string;
  href: string;
  onPress: () => void;
  /** Phones stack these full-width; every wider layout sizes them to content. */
  fullWidth?: boolean;
  /** Signed-out phone band uses the handoff's larger, full-width treatment. */
  searchBand?: boolean;
}) {
  const [hovered, hoverProps] = useHover();
  const green = t.colors.brand.graphics;
  const iconSize = searchBand ? 23 : 21;
  return (
    <Pressable
      {...linkProps(href, onPress)}
      {...hoverProps}
      style={[
        styles.heroEntryButton,
        fullWidth && styles.heroEntryButtonFull,
        searchBand && m.searchActionLink,
        searchBand && searchActionRestShadow,
        transition('border-color, box-shadow'),
        hovered && (searchBand ? m.searchActionLinkHover : styles.heroEntryButtonHover),
        hovered && (searchBand ? searchActionHoverShadow : heroEntryHoverShadow),
      ]}
    >
      <Svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden={searchBand || undefined}
      >
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
      <Text style={[styles.heroEntryLabel, searchBand && m.searchActionLabel]}>{label}</Text>
      <LinkArrow
        color={searchBand ? t.colors.text.green : green}
        style={searchBand ? m.searchActionArrow : styles.heroEntryArrow}
      />
    </Pressable>
  );
}

const searchActionRestShadow = Platform.select({
  web: { boxShadow: '0 6px 18px rgba(17,21,15,0.05)' },
  default: {},
}) as object;

const searchActionHoverShadow = Platform.select({
  web: { boxShadow: '0 14px 34px rgba(17,21,15,0.10)' },
  default: {},
}) as object;

// --- Hero answer card (static sample answer — HF 4138) ---

// The bill code badge and the "View bill profile" footer link both point to our own
// bill profile page (in-app navigation), not the official source — so badge and link
// agree. The external source-text link lives on the bill profile, not on this teaser.
const HF4138_BILL_ID = '94-2026-HF4138';
// Chief author's legislator profile on our own site (in-app navigation), matching the
// badge and footer link. Her official House profile is reachable from that profile page.
const PEGGY_SCOTT_LEGISLATOR_ID = '2ebc386c-bf7e-4b9c-9d81-81f3bef1f971';

// Every literal below was re-verified against the ingested record on 2026-08-12, and
// `scripts/check_home_hero_card_literals.py` re-runs that check against the published
// API on a schedule (`.github/workflows/home-hero-card-facts.yml`, which files an issue
// on drift) so this card cannot go stale in silence (#1444, #1467). Signed 05/26/26 and Chapter 111 come
// from the bill's Governor-approval and Secretary-of-State actions; the effective date
// from `effective_date`; House 132–2 / Senate 66–0 from the two passage roll calls; all
// three excerpts are verbatim from the enacted text (version 5).
function CitedSectionCard({ title, quote, note }: { title: string; quote: string; note?: string }) {
  const { isMobile } = useResponsive();
  return (
    <View style={styles.sectionCardBox}>
      <View style={styles.sectionCardHead}>
        <Text style={styles.sectionCardTitle}>{title}</Text>
      </View>
      <View style={styles.sectionCardQuote}>
        <Text style={[styles.sectionCardQuoteText, isMobile && styles.sectionCardQuoteTextMobile]}>
          {quote}
        </Text>
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
    <View style={[styles.answerCard, isMobile && styles.answerCardMobile, t.shadows.md as object]}>
      {/* The card opens at the bill facts. The question moved out to the section
          above when the card left the hero: it is the example being shown, so it
          belongs beside the section's own heading rather than repeated inside the
          thing it labels. The divider that separated the two went with it. */}

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

      {/* The bolded string is the record's own `short_title` for HF 4138, character for
          character and capitalised as the record holds it, so this sentence and the bill
          profile this card links to name the law identically. It is a headline we wrote
          from the bill, not a legal name - HF 4138 carries no "may be cited as" clause -
          and nothing here calls it one. Typed, not fetched: it sits mid-sentence, so a
          pending state would be a hole in a sentence and an unreachable API would need a
          second name typed in as a fallback. `scripts/check_home_hero_card_literals.py`
          holds it to the record nightly instead. The straight apostrophe in "Minors'" is
          the record's; do not curl it to match the surrounding copy. */}
      <Text style={styles.answerSummary}>
        <Text style={styles.answerSummaryBold}>New Rules For Minors' Social Media Accounts</Text>{' '}
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
          title="Parental consent"
          quote="A covered social media platform may not create an account for a user identified as a child … without first obtaining verifiable parental consent."
        />
        <CitedSectionCard
          title="Addictive features"
          quote="A covered social media platform may not present addictive interface features in the display or feed of any account of a child."
          note="Such as infinite scrolling, autoplay video, and push notifications"
        />
        <CitedSectionCard
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

// Route entry. Mobile is an intentional separate layout (docs/product-onboarding/home-screen-guide.md),
// not a reflow of the desktop layout, so it renders as its own component. Switching
// on a whole component (rather than an early return inside one) keeps each layout's
// hook order stable across a resize that crosses the breakpoint.
/**
 * The hero headline is the page's `<h1>` — but only while Home is the screen you
 * are looking at. Home stays mounted beneath a deep-linked stack screen (see the
 * `isFocused` query gating below), so an unconditional header role ships this
 * headline into the markup of every bill and legislator page as a second,
 * competing `<h1>` ([#1355]). It is `display: none` there, so no screen reader
 * reads it, but a crawler that renders the page still finds it.
 */
const heroHeadingProps = (isFocused: boolean) =>
  isFocused ? ({ accessibilityRole: 'header', 'aria-level': 1 } as const) : {};

export function HomeSignedOutScreen() {
  const { isDesktop } = useResponsive();
  const isFocused = useIsFocused();
  const sessionsQuery = useSessions({ enabled: isFocused });
  const currentSession =
    sessionsQuery.data?.find((session) => session.isCurrent) ?? sessionsQuery.data?.[0];
  const sessionLabel = formatSessionLabel(currentSession ?? SESSION_LABEL_FALLBACK).toUpperCase();
  return isDesktop ? (
    <HomeSignedOutDesktop sessionLabel={sessionLabel} />
  ) : (
    <HomeSignedOutMobile sessionLabel={sessionLabel} />
  );
}

/** The money card's count, read live from the register on every homepage load.
 *
 *  `filerCount` is already null unless the register block came back `reported`
 *  (data/api.ts), so a stale or refused read reaches the card as "no number"
 *  rather than as a zero — which is the whole of rule 12's missing-versus-zero
 *  line, kept out of the card so the card cannot get it wrong.
 */
function useMoneyPromoCount(enabled: boolean) {
  const summary = useCampaignFinanceSummary({ enabled });
  return {
    filerCount: summary.data?.register.filerCount ?? null,
    countLoading: summary.isLoading,
  };
}

// Editorially flagged "🔥 Hot issue" bills (docs/product-onboarding/home-screen-guide.md).
// A card carries the flag only when its bill is in the shared set
// (../../lib/hotIssues). The desktop feed is recency-driven (not curated), so a
// flagged bill shows the pill when it happens to appear in the top-2 passed /
// top-3 introduced.

function HomeSignedOutDesktop({ sessionLabel }: { sessionLabel: string }) {
  const navigation = useNavigation<any>();
  const { isTracked, toggleTrack } = useBillTracking();
  // ONE homepage, not two (#1034). Only the hero region branches on auth;
  // everything below it — Bills Moving, Find My Legislator, the footer, the nav —
  // is identical either way, so signing in never takes a capability away.
  const { isSignedIn, user } = useAuth();
  const dotVisibility = getHomeDotVisibility(isWeb, false);
  // Only fetch when Home is the visible screen. Under a bottom-tabs navigator Home
  // stays mounted beneath a deep-linked stack screen (e.g. a bill), so ungated it
  // would fire these queries and contend with the visible screen's first load.
  const isFocused = useIsFocused();
  const { filerCount, countLoading } = useMoneyPromoCount(isFocused);
  // Bill Activity — real, date-ordered data (#342: the section previously showed
  // fabricated bills under real legislators' names). Mirrors the mobile home feed
  // (#341); web shows more per home-screen-guide.md §Bill activity: 2 passed, 3
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
  // The query does not retry, so one failure is terminal until the reader asks.
  const trackedFailed = trackedQuery.isError;
  const watchNow = useRef(new Date()).current;
  const watch = useMemo(() => {
    const lastVisit = lastVisitFrom(lastVisitData);
    // The tracked list itself is still loading, so we do not yet know what to
    // compare — the same "we have not asked" case, and it renders as pending
    // rather than as an empty watchlist (#1026, #1034).
    // A failed load has no bills and no visit answer either, so it must be told
    // apart here rather than inferred from those absences downstream.
    if (trackedFailed) return sessionWatch([], { state: 'not-checked' }, watchNow, '', true);
    if (!trackedBills) return sessionWatch([], { state: 'not-checked' }, watchNow, '');
    const visitedOn =
      lastVisit.state === 'previous-visit' ? formatNiceDate(localDay(lastVisit.at)) : '';
    return sessionWatch(trackedBills, lastVisit, watchNow, visitedOn);
  }, [trackedBills, trackedFailed, lastVisitData, watchNow]);

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
  const heroDotsWeb: object = dotVisibility.hero
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
  const finderDotsWeb: object = dotVisibility.finder
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
            {dotVisibility.hero ? (
              <View pointerEvents="none" style={[StyleSheet.absoluteFill as object, heroDotsWeb]} />
            ) : null}

            <TopNav
              openMenu={openMenu}
              onOpenMenuChange={setOpenMenu}
              onNavigate={handleNavigate}
              onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
            />

            <Container style={styles.heroBody}>
              {/* The grid branches on auth, and this is the one place the 2 states
                  genuinely want different proportions: signed out the right column
                  is a promo we are pitching, signed in it is the reader's own
                  tracked bills. Signed in keeps what shipped (even columns, 40px);
                  signed out widens the text and narrows the card, because a white
                  card with a shadow outweighs plain text at equal width. */}
              <View
                style={[
                  styles.heroGrid,
                  styles.heroGridDesktop,
                  isSignedIn ? styles.heroGridSignedIn : styles.heroGridSignedOut,
                ]}
              >
                {/* LEFT */}
                <View
                  style={[
                    styles.heroLeft,
                    styles.heroLeftDesktop,
                    isSignedIn ? styles.heroLeftSignedIn : undefined,
                  ]}
                >
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
                        <Text {...heroHeadingProps(isFocused)} style={styles.heroStateLine}>
                          {watch.heroLine}
                        </Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.heroEyebrow}>TRUTH, UNCONCEALED</Text>
                      <Text {...heroHeadingProps(isFocused)} style={styles.heroH1}>
                        Grounded answers{'\n'}
                        <Text style={styles.heroH1Green}>on Minnesota politics</Text>
                      </Text>
                      <Text style={styles.heroSubhead}>{HOME_PUBLIC_INTRO}</Text>
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

                {/* RIGHT: signed in this is the Legislative session watch card,
                    signed out it is the money promo. The signed-in slot is NOT a
                    pitch and must not become one — a band above the hero would
                    stack two heroes and make a returning reader scroll past a
                    pitch that already worked, which is why the money card sits in
                    its own band BELOW this hero when signed in. The example answer
                    that used to fill this slot signed out now has its own
                    full-width section further down. */}
                <View
                  style={[
                    styles.heroRight,
                    styles.heroRightDesktop,
                    isSignedIn ? undefined : styles.heroRightSignedOut,
                  ]}
                >
                  {isSignedIn ? (
                    <SessionWatchCard
                      watch={watch}
                      onBill={(billId) => navigation.navigate('BillDetail', { billId })}
                      onAllTracked={() => navigation.navigate('Tracked')}
                      onSearchBills={() => navigation.navigate('Bills')}
                      onWhatsMoving={scrollToBillActivity}
                      onRetry={() => void trackedQuery.refetch()}
                    />
                  ) : (
                    <MoneyPromoCard
                      variant="desktop"
                      filerCount={filerCount}
                      countLoading={countLoading}
                      dimmed={openMenu !== null}
                      onPress={() => navigation.navigate('MoneyLanding')}
                    />
                  )}
                </View>
              </View>
            </Container>

            {/* MONEY IN POLITICS — signed in only, and INSIDE the hero wrapper
                rather than in a band of its own. Outside it, the wrapper's
                gradient ended above the card and the page background took over,
                and those two gradients turn white at different points (55% here,
                60% on the page) — so a full-width edge ran across the page and
                the promo read as a separate section.
                The card is not a section: it is the tail of the hero.

                Two knock-on effects, both accepted (Eugene, 20 Aug 2026), and
                both follow from the backgrounds staying in percentages of the
                wrapper rather than being pinned to pixels or split into a second
                layer. The wrapper is now ~700px taller when signed in, so its
                gradient reaches white further down and the region around the
                Search pair sits lighter than before; and the dot grid runs behind
                and around the card, fading out 180px above the new bottom instead
                of above the Search pair. */}
            <View style={isSignedIn ? styles.heroMoneySpace : styles.heroBottomSpaceSignedOut} />
            {isSignedIn ? (
              <>
                <Container>
                  <MoneyPromoCard
                    variant="desktop"
                    filerCount={filerCount}
                    countLoading={countLoading}
                    dimmed={openMenu !== null}
                    onPress={() => navigation.navigate('MoneyLanding')}
                  />
                </Container>
                {/* The gradient has already reached #ffffff by here, so the white
                    section below starts with no visible edge either. */}
                <View style={styles.heroMoneySpace} />
              </>
            ) : null}
          </View>

          {/* WHAT AN ANSWER LOOKS LIKE — the example answer, moved out of the hero
              when the money card took that slot. Full width now, and the SECTION
              is the heading: the sample question used to be the h2, so heading
              navigation announced one bill as a section of the homepage with
              nothing marking it as an example. Signed-out only, as it always was. */}
          {!isSignedIn ? (
            <View style={styles.answerSection}>
              <Container>
                <Text accessibilityRole="header" aria-level={2} style={styles.answerSectionH2}>
                  What an answer looks like
                </Text>
                <Text style={styles.answerSectionQuestion}>
                  What’s in the new social media law for kids?
                </Text>
                <View style={styles.answerSectionCard}>
                  <AnswerCard dimmed={openMenu !== null} />
                </View>
              </Container>
            </View>
          ) : null}

          {/* BILLS MOVING THROUGH THE LEGISLATURE */}
          <View ref={billActivityRef} style={styles.billsSection}>
            <Container>
              <Text style={styles.sectionEyebrow}>{sessionLabel}</Text>
              <View style={styles.billsHeadRow}>
                <Text accessibilityRole="header" aria-level={2} style={styles.billsH2}>
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
                    <BillGroupContinuationLink
                      label={HOME_BILL_GROUP_CONTINUATIONS.passed.label}
                      params={HOME_BILL_GROUP_CONTINUATIONS.passed.params}
                      onPress={() =>
                        navigation.navigate('Bills', HOME_BILL_GROUP_CONTINUATIONS.passed.params)
                      }
                    />
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
                    <BillGroupContinuationLink
                      label={HOME_BILL_GROUP_CONTINUATIONS.introduced.label}
                      params={HOME_BILL_GROUP_CONTINUATIONS.introduced.params}
                      onPress={() =>
                        navigation.navigate(
                          'Bills',
                          HOME_BILL_GROUP_CONTINUATIONS.introduced.params,
                        )
                      }
                    />
                  </View>
                ) : null}
              </View>
            </Container>
          </View>

          {/* FIND MY LEGISLATOR */}
          <View style={[styles.finderBand, finderGradientWeb]}>
            {dotVisibility.finder ? (
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill as object, finderDotsWeb]}
              />
            ) : null}
            <Container>
              <View style={[styles.finderGrid, styles.finderGridDesktop]}>
                <View style={styles.finderLeft}>
                  <Text accessibilityRole="header" aria-level={2} style={styles.finderH2}>
                    Find My Legislator
                  </Text>
                  <Text style={styles.finderSub}>
                    See who represents you in the Minnesota House and Senate. Learn about their work
                    and how to contact them.
                  </Text>
                  <HomeLegislatorFinder
                    layout="desktop"
                    onNavigate={(params) => navigation.navigate('FindMyLegislator', params)}
                  />
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
// MOBILE HOME — docs/product-onboarding/home-screen-guide.md. An intentional redesign
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
// Inclusion + order are editorial (docs/product-onboarding/home-screen-guide.md);
// each card shows that bill's real data. HF 4138 is the enacted social-media law
// the design's card 1 depicts (the mock labeled it "SF 3933", which is a different
// bill in our corpus). SF 856 is the enacted Office of the Inspector General bill.
const IN_THE_NEWS: { key: string; hotIssue: boolean }[] = [
  { key: '94-2026-HF4138', hotIssue: true },
  { key: '94-2025-SF856', hotIssue: true },
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

/** In-the-News card — editorial pin, real bill data. Whole card → bill detail. */
function NewsCardMobile({
  bill,
  hotIssue,
  onPress,
}: {
  bill: Bill;
  hotIssue: boolean;
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
        {bill.effectiveDate ? (
          <Text style={m.metaEffective}>Effective {bill.effectiveDate}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// Card meta line freshness treatment (#329, home-screen-guide.md §Bill activity).
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

function HomeSignedOutMobile({ sessionLabel }: { sessionLabel: string }) {
  const navigation = useNavigation<any>();
  // Same branch as desktop: only the HERO changes on auth, and everything below it
  // is identical either way (#1034, #1069). This component serves BOTH narrow
  // breakpoints — phone under 768 and tablet 768-1100 — which differ in layout, not
  // in content.
  const { isSignedIn, user } = useAuth();
  const { isMobile, isTablet } = useResponsive();
  const dotVisibility = getHomeDotVisibility(isWeb, isMobile);
  // Only fetch when Home is the visible screen. Under a bottom-tabs navigator Home
  // stays mounted beneath a deep-linked stack screen (e.g. a bill), so ungated it
  // would fire these queries and contend with the visible screen's first load.
  const isFocused = useIsFocused();
  const { filerCount, countLoading } = useMoneyPromoCount(isFocused);
  // The signed-in hero's inputs. READS the last-looked mark and never advances it —
  // only opening the tracked list does that (#1034).
  const trackedQuery = useTrackedBills(isSignedIn && isFocused ? user?.id : undefined);
  const lastVisitQuery = useLastVisitWithoutAdvancing(
    isSignedIn && isFocused ? user?.id : undefined,
  );
  const lastVisitData = lastVisitQuery.data;
  const trackedBills = trackedQuery.data;
  // The query does not retry, so one failure is terminal until the reader asks.
  const trackedFailed = trackedQuery.isError;
  const watchNow = useRef(new Date()).current;
  const watch = useMemo(() => {
    const lastVisit = lastVisitFrom(lastVisitData);
    // A failed load has no bills and no visit answer either, so it must be told
    // apart here rather than inferred from those absences downstream.
    if (trackedFailed) return sessionWatch([], { state: 'not-checked' }, watchNow, '', true);
    if (!trackedBills) return sessionWatch([], { state: 'not-checked' }, watchNow, '');
    const visitedOn =
      lastVisit.state === 'previous-visit' ? formatNiceDate(localDay(lastVisit.at)) : '';
    return sessionWatch(trackedBills, lastVisit, watchNow, visitedOn);
  }, [trackedBills, trackedFailed, lastVisitData, watchNow]);
  const billActivityRef = useRef<Text>(null);
  const scrollToBillActivity = () => {
    if (!isWeb || !billActivityRef.current) return;
    (billActivityRef.current as unknown as HTMLElement).scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  // In the News — the 2 pins can span sessions, so their summaries share 1
  // cacheable public read rather than each opening a bill-detail and votes read.
  const news = useFeaturedBills(
    IN_THE_NEWS.map((bill) => bill.key),
    { enabled: isFocused },
  );
  // Bill Activity — live, date-ordered now that action dates are ingested (#329):
  //   • Recently Introduced = newest by real introduction date (sort=introduced).
  //   • Recently Passed = most recently enacted bills (status=signed_into_law,
  //     ordered by latest-action date desc — the signing/enactment milestone).
  //     "Passed both chambers, not yet signed" is ~0 genuine bills in the corpus
  //     (#305), so enacted is the honest population for the "Recently Passed" card.
  // Phone shows 2 cards in each group; each group's named continuation opens the
  // same ordering in Bill Search. The specific bills are illustrative; selection
  // is date-driven.
  const introduced = useBills(
    undefined,
    undefined,
    { sort: 'introduced' },
    { limit: 2 },
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
  const newsById = new Map(news.data?.map((bill) => [bill.id, bill]));
  const newsBills = IN_THE_NEWS.flatMap((pin) => {
    const bill = newsById.get(pin.key);
    return bill ? [{ pin, bill }] : [];
  });
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
  const newsLoading = news.isLoading;
  const activityLoading = introduced.isLoading || signed.isLoading;

  // Find My Legislator keeps its masked dots at every web width. The hero keeps
  // them on tablets but drops them on phones for a plain upper background.
  const heroDotsWeb: object = dotVisibility.hero
    ? {
        backgroundImage: t.gradients.dotInk, // rgba(17,21,15,0.07)
        backgroundSize: '30px 30px',
        maskImage:
          'linear-gradient(to bottom, transparent 0px, transparent 110px, #000 230px, #000 calc(100% - 40px), transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0px, transparent 110px, #000 230px, #000 calc(100% - 40px), transparent 100%)',
      }
    : {};
  const finderDotsWeb: object = dotVisibility.finder
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
  const searchBandGradientWeb: object = isWeb
    ? {
        // End on the same token PageBackground uses on phones. Keeping the
        // terminal color linked to the page prevents a seam if that base changes.
        backgroundImage: `linear-gradient(180deg,#eaf6ef 0%,#edf6f1 30%,#f2f7f5 62%,#f6f8f8 84%,${t.colors.surfaces.s200} 100%)`,
      }
    : { backgroundColor: t.colors.tint.t100 };

  return (
    <PageBackground>
      <View style={m.root}>
        <ScrollView style={m.scroll} contentContainerStyle={m.scrollContent}>
          {/* HERO — TopNav + copy share one wrapper. Tablets keep its masked dots;
              phones use the plain background. */}
          <View style={m.heroWrap}>
            {dotVisibility.hero ? (
              <View pointerEvents="none" style={[StyleSheet.absoluteFill as object, heroDotsWeb]} />
            ) : null}
            <TopNav
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
                      {...heroHeadingProps(isFocused)}
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
                      onRetry={() => void trackedQuery.refetch()}
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
                  {/* The money card is the third thing in this cluster because its
                      own action is a third search. It sits below the actions, not
                      above them, for the same reason they sit below the watch card:
                      what the reader came back for stays first (#1069). */}
                  <View style={m.heroMoneyCard}>
                    <MoneyPromoCard
                      variant={isTablet ? 'tabletSignedIn' : 'phoneSignedIn'}
                      filerCount={filerCount}
                      countLoading={countLoading}
                      onPress={() => navigation.navigate('MoneyLanding')}
                    />
                  </View>
                </>
              ) : (
                <>
                  <Text style={m.heroEyebrow}>TRUTH, UNCONCEALED</Text>
                  <Text {...heroHeadingProps(isFocused)} style={m.heroH1}>
                    Grounded answers{'\n'}
                    <Text style={m.heroH1Green}>on Minnesota politics</Text>
                  </Text>
                  <Text style={m.heroSubhead}>{HOME_PUBLIC_INTRO}</Text>
                </>
              )}
            </Container>
          </View>

          {/* IN THE NEWS — editorial pins, real data. Check loading FIRST so the
              skeletons hold until BOTH pinned-bill queries settle, then both cards
              render together — no "one card, then the second pops in" stagger. */}
          {newsLoading ? (
            <Container style={[m.section, !isSignedIn && m.newsSectionBeforeSearchBand]}>
              <Text style={m.eyebrow}>IN THE NEWS</Text>
              <View style={m.cardStack}>
                <SkeletonCard lines={4} />
                <SkeletonCard lines={4} />
              </View>
            </Container>
          ) : newsBills.length > 0 ? (
            <Container style={[m.section, !isSignedIn && m.newsSectionBeforeSearchBand]}>
              <Text style={m.eyebrow}>IN THE NEWS</Text>
              <View style={m.cardStack}>
                {newsBills.map(({ pin, bill }) => (
                  <NewsCardMobile
                    key={bill.id}
                    bill={bill}
                    hotIssue={pin.hotIssue}
                    onPress={() => openBill(bill.id)}
                  />
                ))}
              </View>
            </Container>
          ) : null}

          {!isSignedIn ? (
            <View style={[m.searchActionsBand, searchBandGradientWeb]}>
              <HeroEntryButton
                icon="search"
                label="Search Bills"
                href={routePath.bills()}
                onPress={openSearchBills}
                fullWidth
                searchBand
              />
              <HeroEntryButton
                icon="person"
                label="Search Legislators"
                href={routePath.legislators()}
                onPress={() => navigation.navigate('Legislators')}
                fullWidth
                searchBand
              />
              {/* Third in the search cluster rather than above In the news: a
                  partly-built section does not go ahead of today's news. */}
              <MoneyPromoCard
                variant="phoneSignedOut"
                filerCount={filerCount}
                countLoading={countLoading}
                onPress={() => navigation.navigate('MoneyLanding')}
              />
            </View>
          ) : null}

          {/* LEGISLATIVE BILL ACTIVITY — live. Check loading FIRST so the skeletons
              hold until BOTH date-ordered queries settle, then both cards render
              together — no stagger. */}
          {activityLoading ? (
            <Container style={[m.section, m.activitySectionBottom]}>
              <Text ref={billActivityRef} style={m.eyebrow}>
                {sessionLabel}
              </Text>
              <Text accessibilityRole="header" aria-level={2} style={m.sectionH2}>
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
            </Container>
          ) : introducedBills.length > 0 || signedBills.length > 0 ? (
            <Container style={[m.section, m.activitySectionBottom]}>
              <Text ref={billActivityRef} style={m.eyebrow}>
                {sessionLabel}
              </Text>
              <Text accessibilityRole="header" aria-level={2} style={m.sectionH2}>
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
                  <BillGroupContinuationLink
                    label={HOME_BILL_GROUP_CONTINUATIONS.passed.label}
                    params={HOME_BILL_GROUP_CONTINUATIONS.passed.params}
                    fullWidth
                    onPress={() =>
                      navigation.navigate('Bills', HOME_BILL_GROUP_CONTINUATIONS.passed.params)
                    }
                  />
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
                  <BillGroupContinuationLink
                    label={HOME_BILL_GROUP_CONTINUATIONS.introduced.label}
                    params={HOME_BILL_GROUP_CONTINUATIONS.introduced.params}
                    fullWidth
                    onPress={() =>
                      navigation.navigate('Bills', HOME_BILL_GROUP_CONTINUATIONS.introduced.params)
                    }
                  />
                </View>
              ) : null}
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
              {dotVisibility.finder ? (
                <View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill as object, finderDotsWeb]}
                />
              ) : null}
              <Container style={[m.section, m.lastSectionBottom]}>
                <Text accessibilityRole="header" aria-level={2} style={m.finderH2}>
                  Find My Legislator
                </Text>
                <Text style={m.finderSub}>
                  See who represents you in the Minnesota House and Senate. Learn about their work
                  and how to contact them.
                </Text>
                <HomeLegislatorFinder
                  layout={isTablet ? 'tablet' : 'phone'}
                  onNavigate={(params) => navigation.navigate('FindMyLegislator', params)}
                />
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

// The narrow layout's one section break. Every top-level section pads this much top
// and bottom (m.section), so two stacked sections always sit SECTION_BREAK apart —
// the gap under the signed-in hero's money card, above IN THE NEWS. Named so the
// hero can reuse the same number rather than restate it (see m.heroActions).
const SECTION_PADDING = 40;
const SECTION_BREAK = SECTION_PADDING * 2;

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
    color: t.colors.text.green,
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
  // most variable string on the page, and the worst real case is "11 of your 14
  // tracked bills moved since you last opened the list on Mar 12".
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
  // SECTION_BREAK, not 20 or 36: the pair and the money card under it are a section
  // of their own, so the space above the pair is the page's section break — the same
  // number the money card gets below it, before IN THE NEWS. At anything smaller the
  // pair read as the tail of the watch card's stack. The 12px between the buttons and
  // the 22px down to the money card are unchanged, so the pair and the card stay one
  // group, separated from the card above.
  heroActions: { marginTop: SECTION_BREAK, gap: 12 },
  heroActionsTablet: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  heroSubhead: {
    marginTop: 18,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 27,
    color: t.colors.text.muted,
  },
  // Even section rhythm: every top-level section gets SECTION_PADDING top and bottom,
  // so the gaps between stacked sections read as a consistent SECTION_BREAK. 24px
  // sides from Container mobile. The last section before the footer overrides its
  // bottom to 96 (lastSectionBottom) so its content isn't crowded against the black
  // footer.
  section: { paddingTop: SECTION_PADDING, paddingBottom: SECTION_PADDING },
  newsSectionBeforeSearchBand: { paddingBottom: 0 },
  heroMoneyCard: { marginTop: 22 },
  searchActionsBand: {
    position: 'relative',
    marginTop: 64,
    paddingTop: 40,
    paddingRight: 20,
    paddingBottom: 64,
    paddingLeft: 20,
    flexDirection: 'column',
    gap: 12,
  },
  searchActionLink: {
    alignSelf: 'stretch',
    minHeight: 59,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 14,
    paddingTop: 15,
    paddingRight: 20,
    paddingBottom: 15,
    paddingLeft: 17,
  },
  searchActionLinkHover: { borderColor: 'rgba(45,212,126,0.55)' },
  searchActionLabel: {
    flex: 1,
    fontFamily: t.typography.ui,
    fontSize: 22,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  searchActionArrow: {
    width: 22,
    height: 22,
  },
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
    color: t.colors.text.green,
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
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 6px 18px rgba(17,21,15,0.05)' } as object)
      : (t.shadows.card as object)),
  },
  cardHover: {
    borderColor: 'rgba(45,212,126,0.55)',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 14px 34px rgba(17,21,15,0.10)' } as object)
      : null),
  },
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
  billGroupContinuation: {
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink20,
    borderRadius: 13,
    paddingVertical: 15,
    paddingHorizontal: 14,
  },
  billGroupContinuationHover: { borderColor: t.colors.brand.base },
  billGroupContinuationText: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.bold,
    letterSpacing: -0.4,
    color: t.colors.text.primary,
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

/** The small green section label: 13px, bold, 0.2em of tracking (2.6px at 13px),
 *  #0f7a45. Two consumers spread this rather than repeating the values — the
 *  section eyebrows above each band, and the answer example's own label, which
 *  must read as the same thing. */
const sectionLabel = {
  fontFamily: t.typography.ui,
  fontSize: t.fontSizes.meta,
  fontWeight: t.fontWeights.bold,
  letterSpacing: 2.6,
  color: t.colors.text.green,
} as const;

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
  heroLeft: { flex: 1, minWidth: 0 },
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
    color: t.colors.text.green,
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
    width: 19,
    height: 19,
    top: 0,
  },
  heroRight: { minWidth: 0 },
  heroRightDesktop: { flex: 1, alignItems: 'flex-end', marginTop: -10 },
  // 120 above the card and 120 below, replacing the old 48 + 120 = 168. Even on
  // both sides deliberately: the card is the tail of the hero, not an intro to
  // the white section under it.
  heroMoneySpace: { height: 120 },
  // Signed out the next section's eyebrow peeks on a laptop while its heading
  // falls below the fold, which is the drawn rhythm for a hero that now ends on
  // a card rather than on the buttons.
  heroBottomSpaceSignedOut: { height: 140 },
  // 1fr / 0.72fr. Equal columns read as UNBALANCED here: a white card with a
  // shadow outweighs plain text at the same width.
  heroGridSignedOut: { gap: 96 },
  heroGridSignedIn: { gap: 40 },
  // The 720 cap belongs to the signed-in hero, which is unchanged. Signed out the
  // ratio sets the width: capping the left column at 720 leaves the extra space in
  // the right column instead, which strands the 583px card 89px short of the page
  // edge at 1600px. A style object cannot unset a value in React Native — an
  // override of `undefined` merges as absent — so the cap has to move rather than
  // be cancelled.
  heroLeftSignedIn: { maxWidth: 720 },
  heroRightSignedOut: { flex: 0.72 },
  answerSection: { backgroundColor: t.colors.surfaces.base, paddingTop: 60, paddingBottom: 80 },
  // The section label, not a headline. At 44px it matched "Bills Moving Through
  // the Legislature" and ranked one worked example equal to a whole section of
  // bills. These are sectionEyebrow's own values rather than a copy of them, so
  // the two labels cannot drift apart; marginBottom is the one difference (14
  // here against 22 there).
  //
  // Capitals come from textTransform rather than from typing the words in caps:
  // this element is a heading, and a heading whose text is literally uppercase
  // can be announced letter by letter.
  answerSectionH2: {
    ...sectionLabel,
    marginBottom: 14,
    textTransform: 'uppercase',
  },
  // With the headline gone this is the loudest line in the section, which is
  // right — the example is the content. Still not a heading: heading navigation
  // names the section, never a specific bill.
  answerSectionQuestion: {
    fontFamily: t.typography.ui,
    fontSize: 26,
    lineHeight: 35,
    fontWeight: t.fontWeights.bold,
    letterSpacing: -0.26,
    color: t.colors.text.primary,
  },
  answerSectionCard: { marginTop: 28 },

  // answer card
  answerCard: {
    width: '100%',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    backgroundColor: t.colors.surfaces.base,
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 34,
    position: 'relative',
  },
  answerCardMobile: { paddingVertical: 24, paddingHorizontal: 22 },
  answerOverlay: { ...StyleSheet.absoluteFill, borderRadius: 20, zIndex: 5 },
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
  sectionCardStack: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 14,
    alignItems: 'stretch',
  } as never,
  sectionCardBox: {
    backgroundColor: '#f7f9f8',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  sectionCardHead: { flexDirection: 'row', alignItems: 'center' },
  sectionCardTitle: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  sectionCardQuote: {
    marginTop: 8,
  },
  sectionCardQuoteText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary,
    fontStyle: 'italic',
    // Bill text, so the length is the bill's and not ours to predict: these three
    // run 143, 125 and 96 characters and the next bill's will differ again. Nothing
    // here is sized to fit a quote on one line - the cap holds the measure at about
    // 62-72 characters at 14px, and where the column is already narrower the column
    // governs and the cap does nothing. `pretty` keeps a last line off one word.
    ...(isWeb ? ({ maxWidth: '34em', textWrap: 'pretty' } as object) : null),
  },
  sectionCardQuoteTextMobile: { fontSize: 16, lineHeight: 24 },
  sectionCardNote: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 20.3,
    color: '#6f756f',
  },
  answerFooter: {
    marginTop: 12,
    paddingLeft: t.spacing.underCardText,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },

  // Section eyebrow — small green label above a section (e.g. "2025–26 LEGISLATIVE SESSION").
  sectionEyebrow: { ...sectionLabel, marginBottom: 22 },

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
  billGroupContinuationRow: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  billGroupContinuationText: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.green,
  },
  billGroupContinuationTextHover: { textDecorationLine: 'underline' },
  billGroupContinuationContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // 17px against the 15–16px label: the drawn arrow's ink is inset in its box, so a
  // box matched to the font size renders visibly shorter than the neighbouring caps.
  // `top: 0` cancels LinkArrow's default 1px drop, which is tuned for x-height
  // alignment; here the label is bold sentence case, so the arrow rides the cap band
  // (measured: cap-band centre 405.23px, arrow centre 405.75px — half a pixel).
  billGroupContinuationArrow: { width: 17, height: 17, top: 0 },
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
  billAuthor: { color: t.colors.text.green, fontWeight: t.fontWeights.bold },
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
    color: t.colors.text.green,
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
