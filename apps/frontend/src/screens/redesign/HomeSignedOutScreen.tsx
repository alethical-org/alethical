import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Check, MapPin, Plus, Search } from 'lucide-react-native';

import { theme, prefersReducedMotion } from '../../theme/tokens';
import {
  Container,
  Footer,
  GoogleButton,
  MNMap,
  PageBackground,
  PrimaryButton,
  TopNav,
} from '../../theme/primitives';
import { IaItem, MenuKey } from '../../navigation/ia';
import { fieldFocusRing } from '../../theme/fieldFocus';
import { useAuth } from '../../providers/AuthProvider';
import { useResponsive } from '../../hooks/useResponsive';

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

// --- Static bill-card sample content (exact copy/values from the DC source) ---
interface SampleBill {
  billId: string;
  status: string;
  statusColor: string;
  /** Progress steps filled (of 5); `vetoed` paints the last filled step red. */
  progress: number;
  vetoed?: boolean;
  summary: string;
  author: string;
  action: string;
  actionDate: string;
  votes?: { text: string; pendingNote?: string };
  amberNote?: { lead: string; bold: string };
  tags: string[];
  companion?: string;
}

const RECENTLY_DECIDED: SampleBill[] = [
  {
    billId: 'SF 1832',
    status: 'Signed into Law',
    statusColor: t.colors.brand.deep,
    progress: 5,
    summary:
      'Refines the state paid-leave program ahead of launch: clarifies employer premium splits, adds a small-business grant, and aligns the wage-replacement schedule with the unemployment-insurance base.',
    author: 'Senator Alice Mann',
    action: 'Signed by the Governor',
    actionDate: 'July 6, 2026',
    votes: { text: 'House 79–52 · Senate 36–30' },
    tags: ['Labor', 'Health', 'Public Finance'],
    companion: 'COMPANION HF 1976 · IN COMMITTEE',
  },
  {
    billId: 'SF 940',
    status: 'Vetoed',
    statusColor: t.colors.status.vetoedText,
    progress: 5,
    vetoed: true,
    summary:
      'Would have issued a one-time registration-tax rebate funded by the projected surplus. Passed both chambers on party lines; returned without the Governor’s signature over long-term revenue concerns.',
    author: 'Senator Jason Rarick',
    action: 'Vetoed by the Governor',
    actionDate: 'June 30, 2026',
    votes: { text: 'House 68–66 · Senate 34–33' },
    amberNote: {
      lead: 'Possible next step: ',
      bold: 'override needs two-thirds — 90 House · 45 Senate',
    },
    tags: ['Taxation', 'Transportation'],
  },
];

const MOVING_NOW: SampleBill[] = [
  {
    billId: 'SF 2210',
    status: 'Passed both chambers',
    statusColor: t.colors.text.secondary,
    progress: 4,
    summary:
      'The judiciary and public-safety omnibus — funds courts, corrections, and prosecution for the biennium, adds co-responder mental-health teams, updates use-of-force reporting, and increases county-attorney diversion grants.',
    author: 'Senator Ron Latz',
    action: 'Sent to conference committee after House amendments',
    actionDate: 'June 24, 2026',
    votes: { text: 'House 102–31 · Senate 45–21' },
    tags: ['Public Safety', 'Judiciary'],
    companion: 'COMPANION HF 2489 · LAID OVER',
  },
  {
    billId: 'HF 615',
    status: 'Passed House',
    statusColor: t.colors.text.secondary,
    progress: 3,
    summary:
      'Appropriates $120M to the Border-to-Border Broadband fund, prioritizing unserved rural households, and shortens the challenge-process window that lets incumbents contest grant awards.',
    author: 'Representative Patty Acomb',
    action:
      'Received from House, first reading, referred to Agriculture, Veterans, Broadband and Rural Development',
    actionDate: 'June 5, 2026',
    votes: { text: 'House 121–12', pendingNote: '· Senate vote pending' },
    tags: ['Infrastructure', 'Rural Development'],
    companion: 'COMPANION SF 588 · IN COMMITTEE',
  },
  {
    billId: 'SF 1847',
    status: 'In Committee',
    statusColor: t.colors.text.secondary,
    progress: 2,
    summary:
      'The bill appropriates $2,500,000 from the bond proceeds fund for the development of a campground and recreational area in Brookston. It authorizes the sale and issuance of state bonds to fund this project and outlines the uses of the appropriated funds.',
    author: 'Senator Jason Rarick',
    action: 'Referred to the Capital Investment Committee',
    actionDate: 'May 18, 2026',
    amberNote: { lead: 'Vote threshold: ', bold: 'three-fifths to pass — 81 House · 41 Senate' },
    tags: ['Capital Investment', 'Recreation', 'Local Development'],
    companion: 'COMPANION HF 1210 · IN COMMITTEE',
  },
  {
    billId: 'HF 1',
    status: 'Introduced',
    statusColor: t.colors.text.secondary,
    progress: 1,
    summary:
      'The bill establishes an Office of Inspector General to enhance oversight of state-funded services, prevent fraud, and protect whistleblowers.',
    author: 'Representative Patti Anderson',
    action: 'Introduced, first reading',
    actionDate: 'Apr 27, 2026',
    tags: ['Fraud Prevention', 'Government Accountability', 'Grant Oversight'],
    companion: 'COMPANION SF 316 · PROPOSED',
  },
];

// --- Small shared bits ---

function useHover(): [boolean, { onHoverIn: () => void; onHoverOut: () => void }] {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }];
}

/** Green inline text link ("View bill text →", chief author, companion bill). */
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
const HF4138_TEXT_URL = 'https://www.revisor.mn.gov/bills/94/2026/0/HF/4138/versions/5/';
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
        <TextLink label="View bill text →" onPress={() => openExternal(HF4138_TEXT_URL)} />
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

function TrackButtonDark({ onPress }: { onPress?: () => void }) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Track bill"
      onPress={onPress}
      {...hoverProps}
      style={[
        styles.trackBtn,
        t.shadows.md as object,
        hovered && { backgroundColor: '#000000', borderColor: '#000000' },
      ]}
    >
      <Plus size={16} color={t.colors.white} strokeWidth={2.8} />
      <Text style={styles.trackBtnText}>Track</Text>
    </Pressable>
  );
}

function AmberFlag() {
  return (
    <Svg width={13} height={14} viewBox="0 0 24 24" fill="none">
      <Path d="M6 22 V3" stroke={t.colors.status.amber} strokeWidth={2} strokeLinecap="round" />
      <Path d="M6 3.5 H18.5 L15.5 8 L18.5 12.5 H6 Z" fill={t.colors.status.amber} />
    </Svg>
  );
}

function CompanionPill({ label }: { label: string }) {
  const [hovered, hoverProps] = useHover();
  return (
    <View
      {...hoverProps}
      style={[styles.companionPill, hovered && { borderColor: t.colors.brand.base }]}
    >
      <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
        <Path
          d="M4 8 H17 M13.5 4.5 L17 8 L13.5 11.5 M20 16 H7 M10.5 12.5 L7 16 L10.5 19.5"
          stroke={t.colors.brand.deep}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={styles.companionPillText}>{label}</Text>
    </View>
  );
}

function BillCardV2({ bill, onTrack }: { bill: SampleBill; onTrack: () => void }) {
  const { isMobile } = useResponsive();
  return (
    <View style={[styles.billCard, t.shadows.card as object]}>
      <View style={styles.billCardTop}>
        <View style={styles.billCardTopLeft}>
          <View style={styles.billBadgeSm}>
            <Text style={styles.billBadgeSmText}>{bill.billId}</Text>
          </View>
          <Text style={[styles.billStatus, { color: bill.statusColor }]}>{bill.status}</Text>
          {!isMobile ? <ProgressSteps filled={bill.progress} vetoed={bill.vetoed} /> : null}
        </View>
        <TrackButtonDark onPress={onTrack} />
      </View>
      {isMobile ? (
        <View style={styles.progressRowMobile}>
          <ProgressSteps filled={bill.progress} vetoed={bill.vetoed} />
        </View>
      ) : null}
      <Text style={styles.billSummary}>{bill.summary}</Text>
      <Text style={styles.billLine}>
        Chief author: <Text style={styles.billAuthor}>{bill.author}</Text>
      </Text>
      <Text style={styles.billLine}>
        Latest action: <Text style={styles.billAction}>{bill.action}</Text>
        <Text style={styles.billActionDate}> · {bill.actionDate}</Text>
      </Text>
      {bill.votes ? (
        <View style={styles.billVotesRow}>
          <Check size={15} color={t.colors.text.muted} strokeWidth={2.6} />
          <Text style={styles.billLineText}>
            {bill.votes.text.split(/(\d+–\d+)/g).map((part, i) =>
              /^\d+–\d+$/.test(part) ? (
                <Text key={i} style={styles.billVoteNum}>
                  {part}
                </Text>
              ) : (
                <Text key={i}>{part}</Text>
              ),
            )}
            {bill.votes.pendingNote ? (
              <Text style={styles.billVotePending}> {bill.votes.pendingNote}</Text>
            ) : null}
          </Text>
        </View>
      ) : null}
      {bill.amberNote ? (
        <View style={styles.billAmberRow}>
          <AmberFlag />
          <Text style={styles.billAmberText}>
            {bill.amberNote.lead}
            <Text style={styles.billAmberBold}>{bill.amberNote.bold}</Text>
          </Text>
        </View>
      ) : null}
      <View style={styles.billTagsRow}>
        {bill.tags.map((tag) => (
          <View key={tag} style={styles.billTag}>
            <Text style={styles.billTagText}>{tag}</Text>
          </View>
        ))}
        {bill.companion ? <CompanionPill label={bill.companion} /> : null}
      </View>
    </View>
  );
}

// --- The screen ---

export function HomeSignedOutScreen() {
  const navigation = useNavigation<any>();
  const { signInWithGoogle } = useAuth();
  const { isDesktop, isMobile } = useResponsive();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [askFocused, setAskFocused] = useState(false);
  const [finderFocused, setFinderFocused] = useState(false);
  const [askValue, setAskValue] = useState('');
  const [finderValue, setFinderValue] = useState('');
  const askInputRef = useRef<TextInput>(null);
  const finderInputRef = useRef<TextInput>(null);

  // Auto-grow the ask textarea (web): reset to content height so it grows AND
  // shrinks, capped at ASK_MAX_HEIGHT (then RN-Web scrolls it). RN-Web's own
  // onContentSizeChange can't shrink (it reads scrollHeight of the pinned box),
  // so drive the DOM node directly. Re-runs on typed or chip-inserted text and
  // on the mobile/desktop breakpoint (wrapping changes).
  useLayoutEffect(() => {
    if (!isWeb) return;
    const el = askInputRef.current as unknown as HTMLTextAreaElement | null;
    if (!el || typeof el.scrollHeight !== 'number') return;
    const empty = !askValue;
    if (empty && !isMobile) {
      // Desktop empty: pin one line. The wide field fits the placeholder, and
      // measuring it would only inflate the resting height.
      el.style.height = `${ASK_MIN_HEIGHT}px`;
      return;
    }
    // Mobile empty: the placeholder wraps to two lines on a phone, so size the
    // field to show all of it rather than clipping. scrollHeight ignores the
    // placeholder, so mirror it into the value only while measuring.
    if (empty) el.value = ASK_PLACEHOLDER;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, ASK_MIN_HEIGHT), ASK_MAX_HEIGHT);
    if (empty) el.value = '';
    el.style.height = `${next}px`;
  }, [askValue, isMobile]);

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
  const accountGradientWeb: object = isWeb
    ? { backgroundImage: 'linear-gradient(180deg,#f2f9f5 0%,#ffffff 100%)' }
    : { backgroundColor: t.colors.tint.t50 };

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
                  icon="bookmark"
                  title="Track Bills"
                  subtitle="Your watchlist — sign in to follow the bills you choose"
                  onPress={() => navigation.navigate('Tracked')}
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
                        onSubmitEditing={() => navigation.navigate('FindMyLegislator')}
                        placeholder="Enter an address, city, or area"
                        placeholderTextColor={t.colors.text.faint}
                        style={styles.finderInput}
                      />
                      {!isMobile && (
                        <PrimaryButton
                          label="Find"
                          onPress={() => navigation.navigate('FindMyLegislator')}
                        />
                      )}
                    </FieldShell>
                    {isMobile && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => navigation.navigate('FindMyLegislator')}
                        style={styles.askButtonMobile}
                      >
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
                    <MNMap size={284} />
                  </View>
                ) : null}
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
                <ViewAllButton onPress={() => navigation.navigate('Search')} />
              </View>
              <View style={styles.billGroups}>
                <View>
                  <Text style={styles.billGroupLabel}>RECENTLY DECIDED</Text>
                  <View style={styles.billStack}>
                    {RECENTLY_DECIDED.map((bill) => (
                      <BillCardV2 key={bill.billId} bill={bill} onTrack={signIn} />
                    ))}
                  </View>
                </View>
                <View>
                  <Text style={styles.billGroupLabel}>MOVING NOW</Text>
                  <View style={styles.billStack}>
                    {MOVING_NOW.map((bill) => (
                      <BillCardV2 key={bill.billId} bill={bill} onTrack={signIn} />
                    ))}
                  </View>
                </View>
              </View>
            </Container>
          </View>

          {/* START KNOWING */}
          <View style={styles.accountSection}>
            <Container>
              <View
                style={[
                  styles.accountCard,
                  accountGradientWeb,
                  !isDesktop && styles.accountCardStacked,
                ]}
              >
                <View style={[styles.accountText, !isDesktop && styles.accountColMobile]}>
                  <Text accessibilityRole="header" style={styles.accountH3}>
                    Start Knowing
                  </Text>
                  <Text style={styles.accountBody}>
                    Search bills and legislators, find who represents you, and get cited answers —
                    no account needed. An account makes it yours: track your bills, keep chat
                    history, and pick up where you left off.
                  </Text>
                </View>
                <View style={[styles.accountAction, !isDesktop && styles.accountColMobile]}>
                  <GoogleButton onPress={signIn} />
                </View>
              </View>
            </Container>
          </View>

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
  finderBand: { position: 'relative', paddingTop: 64, paddingBottom: 56, overflow: 'hidden' },
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
