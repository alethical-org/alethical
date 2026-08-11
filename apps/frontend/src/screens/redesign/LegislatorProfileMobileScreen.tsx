import { useMemo, useState, type CSSProperties } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme as t } from '../../theme/tokens';
import { profilePartyBadgeAppearance } from '../../theme/legislatorBadgeAppearance';
import { Footer, PageBackground, TopNav } from '../../theme/primitives';
import { Skeleton } from '../../components/Skeleton';
import { GoBackLink } from '../../components/GoBackLink';
import { VoteCountLinkChip } from '../../components/VoteCountLinkChip';
import { coAuthorCount, formatMonoDate, partyFull, plainBillSummary } from '../../lib/billDetail';
import {
  buildAskChips,
  legislatorDisplayName,
  legislatorVoteLabel,
  splitOfficeAddress,
} from '../../lib/legislatorProfile';
import { IaItem, MenuKey } from '../../navigation/ia';
import { externalLinkProps, linkProps, pressInsideLink, routePath } from '../../navigation/links';
import {
  useLegislator,
  useLegislatorBills,
  useLegislatorVotes,
  useSessions,
} from '../../hooks/useAppQueries';
import { Bill, Legislator } from '../../data/types';
import { formatLegislatureLabel } from '../../lib/sessionLabel';
import { BillTrackButton } from '../../components/billDetail/BillTrackButton';
import { MobileShareSheet } from '../../components/share/MobileShareSheet';
import { useBillTracking } from '../../hooks/useBillTracking';
import {
  CARD_CONTENT_LAYER,
  CARD_CONTROL_LAYER,
  CARD_LINK_LAYER,
} from '../../lib/billCardControlLayers';
import {
  buildLegislatorShareContent,
  legislatorPageMetadata,
  publicPageUrl,
} from '../../lib/share';
import { useDocumentTitle } from '../../navigation/documentTitle';

const isWeb = Platform.OS === 'web';
const COLUMN_MAX = 640;

// Amber code-badge treatment (shared omnibus tokens — same badge as the web
// profile and the Bill Detail rail).
const AMBER_TEXT = t.colors.omnibus.text;
const CODE_BADGE_FILL = t.colors.omnibus.fill;
const CODE_BADGE_BORDER = t.colors.omnibus.border;
const claimPreviewStyle: CSSProperties = {
  alignSelf: 'flex-start',
  alignItems: 'center',
  backgroundColor: t.colors.tint.t150,
  border: `1px solid ${t.colors.tint.border}`,
  borderRadius: 12,
  color: t.colors.brand.deep,
  cursor: 'default',
  display: 'inline-flex',
  fontFamily: t.typography.ui,
  fontSize: 15,
  fontWeight: t.fontWeights.bold,
  gap: 9,
  marginTop: 16,
  padding: '12px 20px 12px 17px',
};

// ── small helpers ─────────────────────────────────────────────────────────────
function useHover(): [boolean, { onHoverIn: () => void; onHoverOut: () => void }] {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }];
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
// Inline text link with the "→" text glyph appended by the caller (house style).
// Serves both an in-app destination (default) and an external one (`external`) —
// the two calls below need different anchor behaviour, so the caller says which.
function TextLink({
  label,
  href,
  onPress,
  size = 15,
  external = false,
}: {
  label: string;
  href: string;
  onPress: () => void;
  size?: number;
  external?: boolean;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      {...(external ? externalLinkProps(href, onPress) : linkProps(href, onPress))}
      {...hover}
    >
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

function BillCardView({
  bill,
  legislatorId,
  onOpen,
  onVotes,
  onOpenLegislator,
  tracked,
  onToggleTrack,
}: {
  bill: Bill;
  legislatorId: string;
  onOpen: () => void;
  onVotes: () => void;
  onOpenLegislator: (id: string) => void;
  tracked: boolean;
  onToggleTrack: () => void;
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
    <View style={styles.billCard}>
      <Pressable
        {...linkProps(routePath.bill(bill.id), onOpen)}
        accessibilityLabel={`Open ${bill.identifier}`}
        style={styles.billCardOverlay}
      />
      <View style={styles.billCardContent}>
        <View style={styles.billTopRow}>
          <Text style={styles.codeBadge}>{bill.identifier}</Text>
          <Text style={styles.billStage}>{bill.status}</Text>
          <View style={styles.billTopSpacer} />
          <View style={styles.billCardControl}>
            <BillTrackButton
              billId={bill.id}
              size="card"
              tracked={tracked}
              onPress={pressInsideLink(onToggleTrack)}
            />
          </View>
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
                      style={[styles.coAuthorLink, styles.billCardControl]}
                      // This link sits above the full-card bill link. Cancel the
                      // underlying link as a second guard for web pointer events.
                      onPress={
                        s.legislatorId
                          ? pressInsideLink(() => onOpenLegislator(s.legislatorId!))
                          : undefined
                      }
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
      </View>
      {tags.length > 0 || bill.companion || bill.rollCallCount > 0 ? (
        <View style={[styles.tagRow, styles.billCardContent]}>
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
          <View style={styles.billCardControl}>
            <VoteCountLinkChip
              count={bill.rollCallCount}
              href={routePath.bill(bill.id, { tab: 'votes' })}
              onPress={pressInsideLink(onVotes)}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ── Ask about these issues ────────────────────────────────────────────────────
// Preset question rows hand off to the one-shot Ask answer flow (grounded-answers §9: the
// router produces an answer page, never opens chat directly).
function AskCard({ chips, onAsk }: { chips: string[]; onAsk: (q: string) => void }) {
  return (
    <View style={styles.askCard}>
      <Text
        accessibilityRole="header"
        accessibilityLabel="Ask about these issues"
        style={styles.askTitle}
      >
        Ask about these issues
      </Text>
      <Text style={styles.askSub}>
        Topics from this legislator’s bills. Answers cite the public record.
      </Text>
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
  const { isTracked, toggleTrack } = useBillTracking();

  const params: Record<string, unknown> = route.params ?? {};
  const legislatorId = typeof params.legislatorId === 'string' ? params.legislatorId : '';

  const legQuery = useLegislator(legislatorId);
  const billsQuery = useLegislatorBills(legislatorId, { limit: 100, role: 'chief_author' });
  const votesQuery = useLegislatorVotes(legislatorId, 1);
  const sessionsQuery = useSessions();

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [showAllBills, setShowAllBills] = useState(false);

  const leg = legQuery.data;
  // Same shared builder api/page.ts used for the first response (#1325).
  useDocumentTitle(
    legislatorId ? `/legislators/${legislatorId}` : null,
    leg
      ? legislatorPageMetadata({
          slug: leg.slug ?? leg.id,
          displayName: legislatorDisplayName(leg.name, leg.chamber),
          districtLine: `${leg.chamber} District ${leg.district}`,
        }).title
      : null,
  );
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

  // Native uses the navigation stack when it has one, then the directory. Web's
  // shared GoBackLink makes the stricter decision from marked browser history.
  const goToLegislatorList = () => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
    } else {
      navigation.navigate('Legislators');
    }
  };

  const shellProps = {
    openMenu,
    onOpenMenuChange: setOpenMenu,
    onNavigate: handleNavigate,
    onHome: () => navigation.navigate('Tabs', { screen: 'Home' }),
  };

  const shareContent = leg
    ? buildLegislatorShareContent({
        displayName: legislatorDisplayName(leg.name, leg.chamber),
        districtLine: `${leg.chamber} District ${leg.district}`,
        url: publicPageUrl(`/legislators/${encodeURIComponent(leg.slug ?? leg.id)}`),
      })
    : {
        subject: 'legislator' as const,
        title: 'Alethical',
        description: 'Minnesota’s legislative record, in plain language.',
        url: publicPageUrl('/'),
      };
  const openExternal = (url: string) => void Linking.openURL(url);

  const allBills = billsQuery.data?.data ?? [];
  const previewVote = votesQuery.data?.[0];
  const visibleBills = showAllBills ? allBills : allBills.slice(0, 2);
  const hasRealBio = leg?.bio ?? null;
  const committees = leg?.committeeAssignments ?? [];
  const service = leg?.legislativeService;
  // Peel a leading leadership title out of the office blob into its own labeled
  // row (never inline it into the mailing address) — mirrors the web profile.
  const office = leg?.officeAddress ? splitOfficeAddress(leg.officeAddress) : null;

  return (
    <PageBackground>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
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
            <GoBackLink href={routePath.legislators()} onPress={goToLegislatorList} mobile />
          </View>
        ) : (
          <>
            {/* HERO */}
            <View style={styles.heroOuter}>
              <View style={styles.column}>
                <GoBackLink href={routePath.legislators()} onPress={goToLegislatorList} mobile />
                <Text style={styles.eyebrow}>LEGISLATOR PROFILE</Text>
                <View style={styles.heroIdentity}>
                  <View style={styles.portrait}>
                    {leg.photoUrl ? (
                      <Image
                        source={{ uri: leg.photoUrl }}
                        accessibilityLabel={leg.name}
                        style={styles.portraitImg}
                        // Fit-inside, never fill — see LEGISLATOR_PORTRAIT_HEIGHT
                        // in lib/legislatorSearch.ts for why (#1334).
                        resizeMode="contain"
                      />
                    ) : (
                      <Text style={styles.portraitInitials}>{initialsOf(leg.name)}</Text>
                    )}
                  </View>
                  <Text style={styles.heroName}>
                    {legislatorDisplayName(leg.name, leg.chamber)}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <View style={styles.metaLeft}>
                    <Text style={styles.metaText}>{`${leg.chamber} District ${leg.district}`}</Text>
                    <View style={styles.partyPill}>
                      <Text numberOfLines={1} style={styles.partyPillText}>
                        {partyFull(leg.party)}
                      </Text>
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
                          href={leg.profileUrl}
                          onPress={() => openExternal(leg.profileUrl as string)}
                          external
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
                      {currentSession ? formatLegislatureLabel(currentSession) : 'Current session'}
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
                            {currentSession
                              ? formatLegislatureLabel(currentSession)
                              : 'Current session'}
                          </Text>
                          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                            <Path
                              d="M5 12.5 L10 17.5 L19 7"
                              stroke={t.colors.brand.graphics}
                              strokeWidth={2.4}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </Svg>
                        </View>
                        {pastSessions.map((s) => (
                          <View key={s.slug} style={styles.popoverPast}>
                            <Text style={styles.popoverPastText}>{formatLegislatureLabel(s)}</Text>
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
                    No chief-authored bills in{' '}
                    {currentSession ? formatLegislatureLabel(currentSession) : 'this session'}.
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
                        tracked={isTracked(bill.id)}
                        onToggleTrack={() => toggleTrack(bill.id, bill.identifier)}
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
                  chips={buildAskChips(allBills)}
                  onAsk={(q) => navigation.navigate('Ask', { q, legislatorId })}
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
                      Are you {legislatorDisplayName(leg.name, leg.chamber)}? Claiming links you to
                      this existing record, so you can manage your biography, write up the bills
                      you’ve worked on, and add your own context. Verified against official
                      legislative records.
                    </Text>
                    <span aria-disabled={true} style={claimPreviewStyle}>
                      <ShieldCheck color={t.colors.brand.deep} />
                      <Text style={styles.claimBtnText}>Claim this profile</Text>
                    </span>
                  </View>

                  <View style={styles.roadmapCard}>
                    <Text accessibilityRole="header" style={styles.roadmapCardTitle}>
                      Why the votes?
                    </Text>
                    <Text style={styles.roadmapCardBody}>
                      Wonder why {leg.shortName} voted that way? Once claimed, a legislator will
                      have the option to explain any vote they cast — right here, in their own
                      words, alongside the record.
                    </Text>
                    {previewVote ? (
                      <View style={styles.votePreview}>
                        <View style={styles.votePreviewTopRow}>
                          <View style={styles.votePreviewCheck}>
                            <Text style={styles.votePreviewCheckText}>✓</Text>
                          </View>
                          <Text style={styles.votePreviewVoted}>
                            {legislatorVoteLabel(previewVote.vote)}
                          </Text>
                          <Text style={styles.votePreviewCode}>{previewVote.billCode}</Text>
                          <Text style={styles.votePreviewMeta}>
                            {formatMonoDate(previewVote.date)} · {previewVote.chamber.toUpperCase()}
                          </Text>
                        </View>
                        <View style={styles.votePreviewLines}>
                          <View style={[styles.votePreviewLine, { width: '100%' }]} />
                          <View style={[styles.votePreviewLine, { width: '72%' }]} />
                        </View>
                        <Text style={styles.votePreviewLabel}>LEGISLATOR’S EXPLANATION</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            </View>
          </>
        )}

        {/* Outside the state branch on purpose: every state ends with the footer
            (loading, load error, loaded). On the short states it pins to the
            bottom of the window — see styles.footer in theme/primitives.tsx. */}
        {/* In-app routes, matching the desktop profile: the footer link's own
            href is /privacy and /terms, so sending the click to the marketing
            site would land somewhere other than the URL it advertises. */}
        <Footer
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>

      <MobileShareSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        content={shareContent}
      />
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  // flexGrow: 1 fills the window on a short page so the footer lands at the
  // bottom (styles.footer in theme/primitives.tsx) instead of leaving a band
  // of background below it.
  scrollContent: { flexGrow: 1 },
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
    height: 114,
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
  partyPill: profilePartyBadgeAppearance.phone.container,
  partyPillText: profilePartyBadgeAppearance.phone.text,
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
    paddingHorizontal: 10,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: 999,
  },
  leadershipBadgeText: {
    fontFamily: t.typography.mono,
    fontSize: 10,
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
    // Trailing chevron, so 3px less on the right (docs/design/design-principles.md §2, Optical centering).
    paddingLeft: 14,
    paddingRight: 11,
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
    position: 'relative',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 18,
    padding: 20,
    ...(t.shadows.card as object),
  },
  billCardOverlay: {
    ...CARD_LINK_LAYER,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 18,
  },
  billCardContent: isWeb ? CARD_CONTENT_LAYER : {},
  billCardControl: CARD_CONTROL_LAYER,
  billTopRow: { flexDirection: 'row', alignItems: 'center', gap: 11, flexWrap: 'wrap' },
  billTopSpacer: { flex: 1 },
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
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(17,21,15,0.22)',
    borderRadius: 16,
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
  claimBtnText: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
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
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
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
  },
  votePreviewCheckText: {
    fontSize: 14,
    fontWeight: t.fontWeights.heavy,
    color: t.colors.brand.graphics,
  },
  votePreviewTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  votePreviewVoted: {
    fontFamily: t.typography.body,
    fontSize: 17,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  votePreviewCode: {
    fontFamily: t.typography.mono,
    fontSize: 13,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.52,
    color: AMBER_TEXT,
    backgroundColor: CODE_BADGE_FILL,
    borderWidth: 1,
    borderColor: CODE_BADGE_BORDER,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 9,
    overflow: 'hidden',
  },
  votePreviewMeta: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    letterSpacing: 0.55,
    color: '#6f756f',
  },
  votePreviewLines: { marginTop: 11, gap: 7 },
  votePreviewLine: { height: 9, borderRadius: 5, backgroundColor: '#eef0f1' },
  votePreviewLabel: {
    marginTop: 12,
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1,
    color: '#6f756f',
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
