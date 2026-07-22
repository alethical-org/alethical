import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
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

import { theme as t } from '../../theme/tokens';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { Footer, PageBackground, TopNav } from '../../theme/primitives';
import { Skeleton } from '../../components/Skeleton';
import { coAuthorCount, formatMonoDate, partyFull, plainBillSummary } from '../../lib/billDetail';
import { buildAskChips, splitOfficeAddress } from '../../lib/legislatorProfile';
import { IaItem, MenuKey } from '../../navigation/ia';
import { useAuth } from '../../providers/AuthProvider';
import { useLegislator, useLegislatorBills, useSessions } from '../../hooks/useAppQueries';
import { Bill, Legislator } from '../../data/types';

const isWeb = Platform.OS === 'web';
const COLUMN_MAX = 640;

// Amber code-badge treatment (matches Bill Detail mobile).
const AMBER_TEXT = t.colors.omnibus.text;
const CODE_BADGE_FILL = '#fbe7bd';
const CODE_BADGE_BORDER = '#eccf86';
const BREADCRUMB_GREY = '#4b524b';

// ── small helpers ─────────────────────────────────────────────────────────────
function useHover(): [boolean, { onHoverIn: () => void; onHoverOut: () => void }] {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }];
}

// Official title form: "Sen. …" / "Rep. …", stripping any existing chamber prefix
// on the stored name so we don't double it up.
function honorificName(name: string, chamber: Legislator['chamber']) {
  const stripped = name.replace(/^(Senator|Representative|Sen\.|Rep\.)\s+/i, '').trim();
  return `${chamber === 'House' ? 'Rep.' : 'Sen.'} ${stripped}`;
}

function initialsOf(name: string) {
  const parts = name
    .replace(/^(Senator|Representative|Sen\.|Rep\.)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

// Coarse 5-segment progress derived from the bill's REAL current status string
// (no separate progress data on the list payload). Reflects status, never invents.
function statusSegments(status: string): number {
  const s = status.toLowerCase();
  if (s.includes('veto')) return 4;
  if (s.includes('signed') || s.includes('law') || s.includes('enacted') || s.includes('chapter'))
    return 5;
  if (s.includes('passed') && s.includes('senate')) return 4;
  if (s.includes('passed')) return 3;
  if (s.includes('committee') || s.includes('referred')) return 2;
  return 1;
}

// ── shared inline components ────────────────────────────────────────────────
function Breadcrumb({ onPress }: { onPress: () => void }) {
  const [hovered, hover] = useHover();
  const color = hovered ? t.colors.ink : BREADCRUMB_GREY;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="All legislators"
      onPress={onPress}
      {...hover}
      style={styles.breadcrumb}
    >
      <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
        <Path
          d="M15 6 L9 12 L15 18"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={[styles.breadcrumbLabel, { color }]}>All legislators</Text>
    </Pressable>
  );
}

// Inline text link with the "→" text glyph appended by the caller (house style).
function TextLink({
  label,
  onPress,
  size = 15,
}: {
  label: string;
  onPress: () => void;
  size?: number;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} {...hover}>
      <Text
        style={[
          styles.textLink,
          { fontSize: size },
          hovered && { color: t.colors.brand.forest, textDecorationLine: 'underline' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
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

function ShieldCheck({ color, size = 17 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3 L20 6 V11 c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10 V6 Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path
        d="M8.5 12 L11 14.5 L15.5 9.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

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
          <ScrollView showsVerticalScrollIndicator={false}>
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
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
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

// ── committees ──────────────────────────────────────────────────────────────
function CommitteeRow({ name, role }: { name: string; role?: string | null }) {
  return (
    <View style={styles.committeeRow}>
      <View style={styles.committeeBullet} />
      <View style={styles.committeeBody}>
        <Text style={styles.committeeName}>{name}</Text>
        {role ? (
          <View style={styles.leadershipBadge}>
            <Text style={styles.leadershipBadgeText}>{role.toUpperCase()}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ── chief-authored bill card ──────────────────────────────────────────────────

// "94th Legislature (2025 - 2026) Regular Session" → "94th Legislature (2025–2026)"
// (en-dash the year range, drop the "Regular Session" suffix), per the design.
function formatSessionChip(name: string | undefined): string {
  if (!name) return 'Current session';
  return name
    .replace(/\s*-\s*/, '–')
    .replace(/\s+Regular Session\s*$/i, '')
    .trim();
}

function BillCardView({
  bill,
  legislatorId,
  onOpen,
  onVotes,
  onOpenLegislator,
}: {
  bill: Bill;
  legislatorId: string;
  onOpen: () => void;
  onVotes: () => void;
  onOpenLegislator: (id: string) => void;
}) {
  const filled = statusSegments(bill.status);
  const tags = bill.aiAnalysis?.policyAreas ?? [];
  const summary =
    plainBillSummary(bill.aiAnalysis?.summary, { firstSentenceOnly: true }) || undefined;
  // Plain-language short title as the heading, not the statutory run-on (#459).
  const cardTitle = bill.aiAnalysis?.shortTitle ?? bill.title;
  const coAuthors = coAuthorCount(bill);
  // Co-chief authors = the OTHER chief sponsors on this bill (grounded from
  // chief_sponsors), shown as "Co-chief author: …" like the design.
  const coChiefs = (bill.sponsors ?? []).filter(
    (s) => s.role === 'chief_author' && s.legislatorId !== legislatorId,
  );
  const movedDate = formatMonoDate(bill.updatedAt);
  return (
    <Pressable accessibilityRole="link" onPress={onOpen} style={styles.billCard}>
      <View style={styles.billTopRow}>
        <Text style={styles.codeBadge}>{bill.identifier}</Text>
        <Text style={styles.billStage}>{bill.status}</Text>
      </View>
      <View style={styles.progressRow}>
        {Array.from({ length: 5 }, (_, i) => (
          <View
            key={i}
            style={[styles.progressSeg, i < filled ? styles.progressOn : styles.progressOff]}
          />
        ))}
      </View>
      {movedDate ? <Text style={styles.lastMoved}>LAST MOVED {movedDate}</Text> : null}
      <Text style={styles.billTitle}>{cardTitle}</Text>
      {summary ? <Text style={styles.billSummary}>{summary}</Text> : null}
      {coChiefs.length > 0 || coAuthors > 0 ? (
        <Text style={styles.coAuthor}>
          {coChiefs.length > 0 ? (
            <>
              {coChiefs.length === 1 ? 'Co-chief author: ' : 'Co-chief authors: '}
              {coChiefs.map((s, i) => (
                <Text key={s.legislatorId ?? s.name}>
                  {i > 0 ? ', ' : ''}
                  <Text
                    style={styles.coAuthorLink}
                    onPress={s.legislatorId ? () => onOpenLegislator(s.legislatorId!) : undefined}
                  >
                    {s.name}
                  </Text>
                </Text>
              ))}
              {coAuthors > 0 ? `   +${coAuthors} co-authors` : ''}
            </>
          ) : (
            `+${coAuthors} co-authors`
          )}
        </Text>
      ) : null}
      {tags.length > 0 || bill.companion || bill.rollCallCount > 0 ? (
        <View style={styles.tagRow}>
          {tags.slice(0, 3).map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag.toUpperCase()}</Text>
            </View>
          ))}
          {bill.companion ? (
            <View style={styles.companionChip}>
              <Text style={styles.companionChipText}>
                COMPANION {bill.companion.identifier} · {bill.companion.status.toUpperCase()}
              </Text>
            </View>
          ) : null}
          {bill.rollCallCount > 0 ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="View votes"
              onPress={onVotes}
              style={styles.voteChip}
            >
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M5 20 V10 M12 20 V4 M19 20 V14"
                  stroke={t.colors.brand.deep}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </Svg>
              <Text style={styles.voteChipText}>VIEW VOTES</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

// ── Ask about this legislator ─────────────────────────────────────────────────
// Stacked (mobile): full-width field, full-width Ask button below, then starter
// chips. Hands off to the one-shot Ask answer flow (grounded-answers §9: the
// router produces an answer page, never opens chat directly).
function AskCard({
  shortName,
  chips,
  onAsk,
}: {
  shortName: string;
  chips: string[];
  onAsk: (q?: string) => void;
}) {
  const { focused, focusProps } = useFieldFocus();
  const [q, setQ] = useState('');
  return (
    <View style={styles.askCard}>
      <Text accessibilityRole="header" style={styles.askTitle}>
        Ask about this legislator
      </Text>
      <Text style={styles.askSub}>No account needed — answers cite the public record.</Text>
      <View style={[styles.askField, ...fieldFocusRing(focused)]}>
        <TextInput
          value={q}
          onChangeText={setQ}
          onFocus={focusProps.onFocus}
          onBlur={focusProps.onBlur}
          onSubmitEditing={() => onAsk(q.trim() || undefined)}
          returnKeyType="search"
          placeholder={`Ask about ${shortName}’s record`}
          placeholderTextColor={t.colors.text.faint}
          style={[styles.askInput, fieldOutlineReset]}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ask"
        onPress={() => onAsk(q.trim() || undefined)}
        style={styles.askBtn}
      >
        <Text style={styles.askBtnText}>Ask</Text>
      </Pressable>
      <View style={styles.askChips}>
        {chips.map((chip) => (
          <Pressable
            key={chip}
            accessibilityRole="button"
            onPress={() => onAsk(chip)}
            style={styles.askChip}
          >
            <Text style={styles.askChipText}>{chip}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ── mobile screen ─────────────────────────────────────────────────────────────
export function LegislatorProfileMobileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { signInWithGoogle } = useAuth();

  const params: Record<string, unknown> = route.params ?? {};
  const legislatorId = typeof params.legislatorId === 'string' ? params.legislatorId : '';

  const legQuery = useLegislator(legislatorId);
  const billsQuery = useLegislatorBills(legislatorId, { limit: 100, role: 'chief_author' });
  const sessionsQuery = useSessions();

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [showAllBills, setShowAllBills] = useState(false);
  const [copied, setCopied] = useState(false);

  const leg = legQuery.data;
  const currentSession = useMemo(
    () => sessionsQuery.data?.find((s) => s.isCurrent) ?? sessionsQuery.data?.[0],
    [sessionsQuery.data],
  );
  const pastSessions = useMemo(
    () => (sessionsQuery.data ?? []).filter((s) => !s.isCurrent),
    [sessionsQuery.data],
  );

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

  // "← All legislators" is a back affordance: when the search list is the screen
  // beneath us (the user drilled in from it), pop back so its URL-encoded filters
  // are restored intact. When we arrived directly (a shared link, no list below),
  // open a fresh unfiltered list instead.
  const goToLegislatorList = () => {
    const state = navigation.getState?.();
    const prev = state?.routes?.[(state.index ?? 1) - 1];
    if (prev?.name === 'Legislators') {
      navigation.goBack();
    } else {
      navigation.navigate('Legislators');
    }
  };

  const shellProps = {
    variant: 'page' as const,
    openMenu,
    onOpenMenuChange: setOpenMenu,
    onNavigate: handleNavigate,
    onHome: () => navigation.navigate('Tabs', { screen: 'Home' }),
    onSignIn: () => void signInWithGoogle(),
    onAsk: () => navigation.navigate('Ask'),
  };

  const shareUrl = leg ? `https://alethical.com/legislators/${leg.id}` : 'https://alethical.com';
  const shareTitle = leg
    ? `${honorificName(leg.name, leg.chamber)} — ${partyFull(leg.party)}, ${leg.chamber} District ${leg.district}`
    : 'Alethical';
  const openExternal = (url: string) => void Linking.openURL(url);
  const copyLink = () => {
    if (isWeb && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(shareUrl);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1900);
  };

  const allBills = billsQuery.data?.data ?? [];
  const visibleBills = showAllBills ? allBills : allBills.slice(0, 2);
  const hasRealBio =
    leg?.bio && leg.bio !== 'Live legislator profile loaded from the backend.' ? leg.bio : null;
  const committees = leg?.committeeAssignments ?? [];
  const service = leg?.legislativeService;
  // Peel a leading leadership title out of the office blob into its own labeled
  // row (never inline it into the mailing address) — mirrors the web profile.
  const office = leg?.officeAddress ? splitOfficeAddress(leg.officeAddress) : null;

  return (
    <PageBackground>
      <ScrollView style={styles.scroll}>
        <TopNav {...shellProps} />

        {legQuery.isLoading ? (
          <View accessible accessibilityLabel="Loading legislator">
            {/* hero skeleton (breadcrumb · eyebrow · portrait + name · meta) */}
            <View style={styles.heroOuter}>
              <View style={styles.column}>
                <Skeleton width={110} height={16} style={styles.skGap20} />
                <Skeleton width={150} height={12} />
                <View style={styles.skHeroIdentity}>
                  <Skeleton width={88} height={104} radius={14} />
                  <Skeleton width="55%" height={26} radius={8} />
                </View>
                <Skeleton width={210} height={14} style={styles.skGap16} />
              </View>
            </View>
            {/* first card skeleton */}
            <View style={styles.column}>
              <Skeleton width="100%" height={200} radius={t.radii.card} style={styles.skGap8} />
            </View>
          </View>
        ) : legQuery.isError || !leg ? (
          <View style={styles.stateBox}>
            <Text style={styles.stateText}>We couldn’t load this legislator.</Text>
            <TextLink label="All legislators →" onPress={goToLegislatorList} />
          </View>
        ) : (
          <>
            {/* HERO */}
            <View style={styles.heroOuter}>
              <View style={styles.column}>
                <Breadcrumb onPress={goToLegislatorList} />
                <Text style={styles.eyebrow}>LEGISLATOR PROFILE</Text>
                <View style={styles.heroIdentity}>
                  <View style={styles.portrait}>
                    {leg.photoUrl ? (
                      <Image
                        source={{ uri: leg.photoUrl }}
                        accessibilityLabel={leg.name}
                        style={styles.portraitImg}
                        resizeMode="cover"
                      />
                    ) : (
                      <Text style={styles.portraitInitials}>{initialsOf(leg.name)}</Text>
                    )}
                  </View>
                  <Text style={styles.heroName}>{honorificName(leg.name, leg.chamber)}</Text>
                </View>
                <View style={styles.metaRow}>
                  <View style={styles.metaLeft}>
                    <Text style={styles.metaText}>{`${leg.chamber} District ${leg.district}`}</Text>
                    <View style={styles.partyPill}>
                      <Text style={styles.partyPillText}>{partyFull(leg.party)}</Text>
                    </View>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Share this legislator"
                    onPress={() => setShareOpen(true)}
                    style={styles.shareBtn}
                  >
                    <ShareIcon />
                    <Text style={styles.shareBtnText}>Share</Text>
                  </Pressable>
                </View>
              </View>
            </View>

            {/* BIOGRAPHY */}
            {hasRealBio ? (
              <View style={styles.section}>
                <View style={styles.column}>
                  <View style={styles.card}>
                    <Text accessibilityRole="header" style={styles.cardTitle}>
                      Biography
                    </Text>
                    <Text style={styles.bodyText}>{hasRealBio}</Text>
                  </View>
                </View>
              </View>
            ) : null}

            {/* COMMITTEES */}
            {committees.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.column}>
                  <View style={styles.card}>
                    <Text accessibilityRole="header" style={styles.cardTitle}>
                      Committees
                    </Text>
                    <View style={styles.committeeList}>
                      {committees.map((c) => (
                        <CommitteeRow key={c.name} name={c.name} role={c.role} />
                      ))}
                    </View>
                  </View>
                </View>
              </View>
            ) : null}

            {/* LEGISLATIVE SERVICE (issue #486) — renders only with real data */}
            {service && service.lines.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.column}>
                  <View style={styles.card}>
                    <Text accessibilityRole="header" style={styles.cardTitle}>
                      Legislative Service
                    </Text>
                    <View style={styles.serviceList}>
                      {service.lines.map((line, index) => (
                        <Text key={`${line.label}-${index}`} style={styles.serviceLine}>
                          <Text style={styles.serviceLabel}>{line.label}: </Text>
                          {line.elected}
                        </Text>
                      ))}
                      {service.term ? (
                        <Text style={styles.serviceLine}>
                          <Text style={styles.serviceLabel}>Term: </Text>
                          {service.term}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              </View>
            ) : null}

            {/* CONTACT */}
            {leg.officeAddress || leg.phone || leg.profileUrl ? (
              <View style={styles.section}>
                <View style={styles.column}>
                  <View style={styles.card}>
                    <Text accessibilityRole="header" style={styles.cardTitle}>
                      Contact
                    </Text>
                    <View style={styles.contactList}>
                      {office?.leadership ? (
                        <View>
                          <Text style={styles.contactLabel}>LEADERSHIP</Text>
                          <Text style={styles.contactValue}>{office.leadership}</Text>
                        </View>
                      ) : null}
                      {office?.address ? (
                        <View>
                          <Text style={styles.contactLabel}>CAPITOL OFFICE</Text>
                          <Text style={styles.contactValue}>{office.address}</Text>
                        </View>
                      ) : null}
                      {leg.phone ? (
                        <View>
                          <Text style={styles.contactLabel}>PHONE</Text>
                          <Text style={styles.contactValue}>{leg.phone}</Text>
                        </View>
                      ) : null}
                      {leg.profileUrl ? (
                        <TextLink
                          label={`Official ${leg.chamber} profile →`}
                          onPress={() => openExternal(leg.profileUrl as string)}
                        />
                      ) : null}
                    </View>
                  </View>
                </View>
              </View>
            ) : null}

            {/* CHIEF-AUTHORED BILLS */}
            <View style={styles.section}>
              <View style={styles.column}>
                <Text accessibilityRole="header" style={styles.sectionHeading}>
                  Chief-Authored Bills
                </Text>
                <View style={styles.sessionFilterWrap}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSessionOpen((v) => !v)}
                    style={styles.sessionBtn}
                  >
                    <Text style={styles.sessionBtnText}>
                      {formatSessionChip(currentSession?.name)}
                    </Text>
                    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M6 9 L12 15 L18 9"
                        stroke={t.colors.text.faint}
                        strokeWidth={2.2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  </Pressable>
                  {sessionOpen ? (
                    <>
                      <Pressable
                        style={styles.popoverScrim}
                        onPress={() => setSessionOpen(false)}
                        accessibilityLabel="Close"
                      />
                      <View style={styles.popover} accessibilityRole="menu">
                        <View style={styles.popoverActive}>
                          <Text style={styles.popoverActiveText}>
                            {formatSessionChip(currentSession?.name)}
                          </Text>
                          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                            <Path
                              d="M5 12.5 L10 17.5 L19 7"
                              stroke={t.colors.brand.deep}
                              strokeWidth={2.4}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </Svg>
                        </View>
                        {pastSessions.map((s) => (
                          <View key={s.slug} style={styles.popoverPast}>
                            <Text style={styles.popoverPastText}>{s.name}</Text>
                            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                              <Path
                                d="M5 11 h14 v9 h-14 Z"
                                stroke={t.colors.text.faint}
                                strokeWidth={2}
                                strokeLinejoin="round"
                              />
                              <Path
                                d="M8 11 V8 a4 4 0 0 1 8 0 v3"
                                stroke={t.colors.text.faint}
                                strokeWidth={2}
                                strokeLinecap="round"
                              />
                            </Svg>
                          </View>
                        ))}
                        <Text style={styles.popoverNote}>
                          Past-session archives — including retired legislators — are on the
                          roadmap.
                        </Text>
                      </View>
                    </>
                  ) : null}
                </View>

                {billsQuery.isLoading ? (
                  <View style={styles.billsLoading}>
                    <ActivityIndicator color={t.colors.brand.base} />
                  </View>
                ) : allBills.length === 0 ? (
                  <Text style={styles.emptyBills}>
                    No chief-authored bills in {formatSessionChip(currentSession?.name)}.
                  </Text>
                ) : (
                  <View style={styles.billList}>
                    {visibleBills.map((bill) => (
                      <BillCardView
                        key={bill.id}
                        bill={bill}
                        legislatorId={legislatorId}
                        onOpen={() => navigation.navigate('BillDetail', { billId: bill.id })}
                        onVotes={() =>
                          navigation.navigate('BillDetail', { billId: bill.id, tab: 'votes' })
                        }
                        onOpenLegislator={(id) =>
                          navigation.navigate('LegislatorProfile', { legislatorId: id })
                        }
                      />
                    ))}
                    {allBills.length > 2 && !showAllBills ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setShowAllBills(true)}
                        style={styles.seeMore}
                      >
                        <Text style={styles.seeMoreText}>See more →</Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>
            </View>

            {/* ASK ABOUT THIS LEGISLATOR */}
            <View style={styles.section}>
              <View style={styles.column}>
                <AskCard
                  shortName={leg.shortName}
                  chips={buildAskChips(allBills)}
                  onAsk={(q) => navigation.navigate('Ask', q ? { q } : undefined)}
                />
              </View>
            </View>

            {/* ON THE ROADMAP */}
            <View style={styles.section}>
              <View style={styles.column}>
                <View style={styles.roadmapZone}>
                  <Text style={styles.roadmapEyebrow}>ON THE ROADMAP</Text>
                  <Text style={styles.roadmapSub}>Features we plan to build.</Text>

                  <View style={styles.roadmapCard}>
                    <Text accessibilityRole="header" style={styles.roadmapCardTitle}>
                      Claim this profile
                    </Text>
                    <Text style={styles.roadmapCardBody}>
                      Are you {honorificName(leg.name, leg.chamber)}? Claiming links you to this
                      existing record, so you can manage your biography, write up the bills you’ve
                      worked on, and add your own context. Verified against official legislative
                      records.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setClaimOpen(true)}
                      style={styles.claimBtn}
                    >
                      <ShieldCheck color={t.colors.brand.darkest} />
                      <Text style={styles.claimBtnText}>Claim this profile</Text>
                    </Pressable>
                  </View>

                  <View style={styles.roadmapCard}>
                    <Text accessibilityRole="header" style={styles.roadmapCardTitle}>
                      Why the votes?
                    </Text>
                    <Text style={styles.roadmapCardBody}>
                      See a roll call and wonder why {leg.shortName} voted that way? Once claimed, a
                      legislator will have the option to explain any vote they cast — right here, in
                      their own words, alongside the record.
                    </Text>
                    {/* Ghosted sample-vote preview — a dimmed illustration of the explanation
                        layer, clearly not a live record. */}
                    <View style={styles.votePreview}>
                      <View style={styles.votePreviewCheck}>
                        <Text style={styles.votePreviewCheckText}>✓</Text>
                      </View>
                      <View style={styles.votePreviewBody}>
                        <View style={styles.votePreviewTopRow}>
                          <Text style={styles.votePreviewVoted}>Voted Yes</Text>
                          <Text style={styles.votePreviewCode}>HF 0000</Text>
                        </View>
                        <Text style={styles.votePreviewMeta}>MMM 0, 2026 · {leg.chamber}</Text>
                        <View style={styles.votePreviewLines}>
                          <View style={[styles.votePreviewLine, { width: '100%' }]} />
                          <View style={[styles.votePreviewLine, { width: '70%' }]} />
                        </View>
                        <Text style={styles.votePreviewLabel}>LEGISLATOR’S EXPLANATION</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            </View>

            <Footer
              onPrivacy={() => openExternal('https://www.alethical.com/privacy')}
              onTerms={() => openExternal('https://www.alethical.com/terms')}
            />
          </>
        )}
      </ScrollView>

      {/* SHARE SHEET */}
      <BottomSheet visible={shareOpen} onClose={() => setShareOpen(false)} label="Share sheet">
        <View style={styles.sheetIconPurple}>
          <ShareIcon color={t.colors.purple.base} size={22} />
        </View>
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          Share this legislator
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

      {/* CLAIM SHEET */}
      <BottomSheet
        visible={claimOpen}
        onClose={() => setClaimOpen(false)}
        label="Claim profile sheet"
      >
        <View style={styles.sheetIconGreen}>
          <ShieldCheck color={t.colors.brand.deep} size={24} />
        </View>
        <View style={styles.claimTitleRow}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            Claim your profile
          </Text>
          <View style={styles.roadmapTag}>
            <Text style={styles.roadmapTagText}>ON THE ROADMAP</Text>
          </View>
        </View>
        <Text style={styles.sheetSub}>
          You’re claiming the profile Alethical already keeps for{' '}
          {leg ? honorificName(leg.name, leg.chamber) : 'this legislator'}. Claiming links you to
          this existing record.
        </Text>
        <View style={styles.claimRows}>
          {[
            ['Manage your biography', 'Add or refine the bio shown at the top of this profile.'],
            [
              'Write up your bills',
              'Explain the bills you’ve worked on in your own words, alongside the record.',
            ],
            [
              'Add your own context',
              'Give constituents your perspective — without changing the public facts.',
            ],
          ].map(([title, body]) => (
            <View key={title} style={styles.claimRow}>
              <View style={styles.claimCheck}>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M5 12.5 L10 17.5 L19 7"
                    stroke={t.colors.brand.deep}
                    strokeWidth={2.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </View>
              <View style={styles.claimRowBody}>
                <Text style={styles.claimRowTitle}>{title}</Text>
                <Text style={styles.claimRowSub}>{body}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={styles.claimVerifyNote}>
          <Text style={styles.claimVerifyText}>
            We verify every claim against official legislative records before your additions go
            live.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setClaimOpen(false)}
          style={styles.claimPrimary}
        >
          <Text style={styles.claimPrimaryText}>Start verification</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setClaimOpen(false)}
          style={styles.claimSecondary}
        >
          <Text style={styles.claimSecondaryText}>Maybe later</Text>
        </Pressable>
      </BottomSheet>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  column: { width: '100%', maxWidth: COLUMN_MAX, alignSelf: 'center', paddingHorizontal: 20 },
  // skeleton loading state (mirrors hero + first card)
  skGap8: { marginTop: 8 },
  skGap16: { marginTop: 16 },
  skGap20: { marginBottom: 20 },
  skHeroIdentity: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 16 },

  stateBox: { paddingVertical: 60, alignItems: 'center', gap: 12 },
  stateText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.muted,
  },

  textLink: {
    fontFamily: t.typography.ui,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },

  // hero
  heroOuter: { paddingTop: 22, paddingBottom: 8 },
  breadcrumb: {
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  breadcrumbLabel: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.semibold,
  },
  eyebrow: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.4,
    color: t.colors.brand.deep,
  },
  heroIdentity: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 16 },
  portrait: {
    width: 88,
    height: 104,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    backgroundColor: t.colors.surfaces.s300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portraitImg: { width: '100%', height: '100%' },
  portraitInitials: {
    fontFamily: t.typography.title,
    fontSize: 30,
    fontWeight: t.fontWeights.heavy,
    color: t.colors.text.faint,
  },
  heroName: {
    flex: 1,
    fontFamily: t.typography.title,
    fontSize: 32,
    lineHeight: 34,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.5,
    color: t.colors.text.primary,
  },
  metaRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  metaLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  metaText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subhead,
    color: t.colors.text.muted,
  },
  partyPill: {
    paddingVertical: 4,
    paddingHorizontal: 11,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: 999,
  },
  partyPillText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.6,
    color: t.colors.brand.deep,
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
    paddingHorizontal: 14,
  },
  shareBtnText: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },

  // sections + cards
  section: { paddingTop: 16 },
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 18,
    padding: 22,
    ...(t.shadows.card as object),
  },
  cardTitle: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h3,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.22,
    color: t.colors.text.primary,
  },
  bodyText: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subhead,
    lineHeight: 26,
    color: t.colors.text.secondary,
  },
  sectionHeading: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h3,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.22,
    color: t.colors.text.primary,
    marginBottom: 12,
  },

  // legislative service (issue #486)
  serviceList: { marginTop: 16, gap: 10 },
  serviceLine: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subhead,
    lineHeight: 26,
    color: t.colors.text.secondary,
  },
  serviceLabel: { fontWeight: t.fontWeights.bold, color: t.colors.text.primary },

  // committees
  committeeList: { marginTop: 16, gap: 13 },
  committeeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  committeeBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.brand.base,
    marginTop: 8,
  },
  committeeBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  committeeName: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subhead,
    color: t.colors.text.primary,
  },
  leadershipBadge: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: 999,
  },
  leadershipBadgeText: {
    fontFamily: t.typography.mono,
    fontSize: 9,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.brand.deep,
  },

  // contact
  contactList: { marginTop: 16, gap: 15 },
  contactLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: t.colors.text.faint,
  },
  contactValue: {
    marginTop: 6,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.primary,
  },

  // session filter
  sessionFilterWrap: { position: 'relative', zIndex: 40, marginBottom: 16 },
  sessionBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 11,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  sessionBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  popoverScrim: {
    position: 'absolute',
    top: -1000,
    left: -1000,
    right: -1000,
    bottom: -1000,
    zIndex: 0,
  } as object,
  popover: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 8,
    zIndex: 1,
    width: 300,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 14,
    padding: 8,
    ...(t.shadows.panel as object),
  },
  popoverActive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: t.colors.tint.t50,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  popoverActiveText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  popoverPast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  popoverPastText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.faint,
  },
  popoverNote: {
    marginTop: 4,
    paddingTop: 10,
    paddingHorizontal: 14,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 19,
    color: t.colors.text.faint,
  },

  // bills
  billsLoading: { paddingVertical: 30, alignItems: 'center' },
  emptyBills: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: t.colors.text.muted,
  },
  billList: { gap: 14 },
  billCard: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 18,
    padding: 20,
    ...(t.shadows.card as object),
  },
  billTopRow: { flexDirection: 'row', alignItems: 'center', gap: 11, flexWrap: 'wrap' },
  codeBadge: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.5,
    color: AMBER_TEXT,
    backgroundColor: CODE_BADGE_FILL,
    borderWidth: 1,
    borderColor: CODE_BADGE_BORDER,
    borderRadius: t.radii.badge,
    paddingVertical: 5,
    paddingHorizontal: 11,
    overflow: 'hidden',
  },
  billStage: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  progressRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  progressSeg: { flex: 1, height: 7, borderRadius: 4 },
  progressOn: { backgroundColor: t.colors.brand.base },
  progressOff: { backgroundColor: t.colors.status.progressEmpty },
  lastMoved: {
    marginTop: 10,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    letterSpacing: 0.6,
    color: t.colors.text.faint,
  },
  billTitle: {
    marginTop: 12,
    fontFamily: t.typography.title,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: t.fontWeights.bold,
    letterSpacing: -0.2,
    color: t.colors.text.primary,
  },
  billSummary: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  coAuthor: {
    marginTop: 9,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    color: t.colors.text.faint,
  },
  tagRow: { marginTop: 15, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tag: {
    paddingVertical: 6,
    paddingHorizontal: 11,
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: 8,
  },
  tagText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.6,
    color: t.colors.text.secondary,
  },
  voteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 11,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 8,
  },
  voteChipText: {
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.3,
    color: t.colors.brand.deep,
  },
  seeMore: {
    marginTop: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 14,
    paddingVertical: 15,
  },
  seeMoreText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },

  // roadmap
  roadmapZone: {
    marginTop: 12,
    paddingTop: 26,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  roadmapEyebrow: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
    color: t.colors.text.faint,
  },
  roadmapSub: {
    marginTop: 10,
    marginBottom: 16,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.muted,
  },
  roadmapCard: {
    marginBottom: 14,
    backgroundColor: t.colors.surfaces.s50,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.borders.strong,
    borderRadius: 18,
    padding: 22,
  },
  roadmapCardTitle: {
    fontFamily: t.typography.title,
    fontSize: 20,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.2,
    color: t.colors.text.primary,
  },
  roadmapCardBody: {
    marginTop: 11,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 25,
    color: t.colors.text.secondary,
  },
  claimBtn: {
    marginTop: 16,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: t.colors.brand.base,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 20,
  },
  claimBtnText: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.onGreen,
  },

  // bottom sheet
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,14,12,0.55)' },
  sheet: {
    width: '100%',
    maxWidth: COLUMN_MAX,
    maxHeight: '92%',
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
    top: 0,
    right: 0,
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
  sheetIconGreen: {
    width: 48,
    height: 48,
    borderRadius: 13,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
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
    lineHeight: 24,
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

  // claim sheet
  claimTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  roadmapTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: 999,
  },
  roadmapTagText: {
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1,
    color: t.colors.text.faint,
  },
  claimRows: { marginTop: 20, gap: 14 },
  claimRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  claimCheck: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  claimRowBody: { flex: 1 },
  claimRowTitle: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  claimRowSub: {
    marginTop: 2,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 20,
    color: t.colors.text.muted,
  },
  claimVerifyNote: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  claimVerifyText: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary,
  },
  claimPrimary: {
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.brand.base,
    borderRadius: 12,
    paddingVertical: 15,
  },
  claimPrimaryText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.onGreen,
  },
  claimSecondary: {
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  claimSecondaryText: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.faint,
  },

  // co-author link + companion chip
  coAuthorLink: { color: t.colors.brand.deep, fontWeight: t.fontWeights.bold },
  companionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 11,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 8,
  },
  companionChipText: {
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.3,
    color: t.colors.brand.deep,
  },

  // ghosted sample-vote preview (Why the votes?)
  votePreview: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 12,
    paddingVertical: 15,
    paddingHorizontal: 16,
    opacity: 0.7,
  },
  votePreviewCheck: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  votePreviewCheckText: {
    fontSize: 14,
    fontWeight: t.fontWeights.heavy,
    color: t.colors.brand.deep,
  },
  votePreviewBody: { flex: 1, minWidth: 0 },
  votePreviewTopRow: { flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' },
  votePreviewVoted: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  votePreviewCode: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.4,
    color: AMBER_TEXT,
    backgroundColor: CODE_BADGE_FILL,
    borderWidth: 1,
    borderColor: CODE_BADGE_BORDER,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  votePreviewMeta: {
    marginTop: 6,
    fontFamily: t.typography.mono,
    fontSize: 10,
    letterSpacing: 0.5,
    color: t.colors.text.faint,
  },
  votePreviewLines: { marginTop: 10, gap: 6 },
  votePreviewLine: { height: 9, borderRadius: 5, backgroundColor: t.colors.surfaces.s300 },
  votePreviewLabel: {
    marginTop: 11,
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1,
    color: t.colors.text.faint,
  },

  // ask card
  askCard: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 18,
    padding: 22,
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
    marginTop: 8,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: t.colors.text.muted,
  },
  askField: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  askInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: t.colors.text.primary,
    paddingVertical: 13,
  },
  askBtn: {
    marginTop: 10,
    backgroundColor: t.colors.purple.base,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.bold,
    color: t.colors.white,
  },
  askChips: { marginTop: 14, gap: 8 },
  askChip: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink12,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  askChipText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.secondary,
  },
});
