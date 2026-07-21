import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useNavigation, useRoute } from '@react-navigation/native';

import { theme as t } from '../../theme/tokens';
import { IaItem, MenuKey } from '../../navigation/ia';
import { Bill, Legislator } from '../../data/types';
import { useAuth } from '../../providers/AuthProvider';
import { useResponsive } from '../../hooks/useResponsive';
import { useLegislator, useLegislatorBills } from '../../hooks/useAppQueries';
import {
  billStage,
  coAuthorCount,
  formatMonoDate,
  partyFull,
  stageLabel,
} from '../../lib/billDetail';
import { SearchPageShell } from '../../components/search/searchPieces';
import { useHover, isWeb } from '../../components/billDetail/interactions';

// Web Legislator Profile (docs/mockups/legislator-profile-web). Aggregates a
// member's public record — identity, committees (with leadership), chief-authored
// bills, contact — with a link back to the official source, plus a clearly-labeled
// "On the roadmap" zone. Chamber-parameterized from member data; the two design
// files are one layout with chamber differences applied.
//
// Grounded-answers notes: the design's "Ask about this legislator" card and the
// "Legislative Service" (elected years / term) card are intentionally NOT built —
// there is no legislator-scoped Ask answer path in v1 (person-scoped Ask is v1.1,
// and its chips would refuse — grounded-answers rule 2), and the corpus carries no
// election-year/term data (0/206 service periods have dates). The roadmap zone is
// static, non-committal, and clearly not-live.

const CURRENT_SESSION_LABEL = '94th Legislature (2025–2026)';
const PAST_SESSIONS = ['93rd Legislature (2023–2024)', '92nd Legislature (2021–2022)'];
// The current biennium's Revisor session code (094 + 2025). Only this session is
// ingested; past-session chief-author lists are on the roadmap.
const REVISOR_SESSION_CODE = '0942025';

export function LegislatorProfileWebScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { signInWithGoogle } = useAuth();
  const { isDesktop } = useResponsive();

  const legislatorId = String(route.params?.legislatorId ?? '');
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);

  const legislatorQuery = useLegislator(legislatorId);
  const legislator = legislatorQuery.data;
  // Show the first two chief-authored bills; "See more" hands off to the member's
  // full chief-author list on the Revisor (the official source).
  const billsQuery = useLegislatorBills(legislatorId, { role: 'chief_author', limit: 2 });
  const chiefBills = billsQuery.data?.data ?? [];

  const openUrl = (url: string) => {
    if (isWeb && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
    else Linking.openURL(url).catch(() => {});
  };
  const openBill = (billId: string) => navigation.navigate('BillDetail', { billId });
  const openLegislator = (id: string) => navigation.push('LegislatorProfile', { legislatorId: id });

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

  const shell = (children: React.ReactNode, hero: React.ReactNode, overlay?: React.ReactNode) => (
    <SearchPageShell
      openMenu={openMenu}
      onOpenMenuChange={setOpenMenu}
      onNavigate={handleNavigate}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
      onSignIn={() => void signInWithGoogle()}
      onAsk={() => navigation.navigate('Ask')}
      onPrivacy={() => navigation.navigate('Privacy')}
      onTerms={() => navigation.navigate('Terms')}
      hero={hero}
      overlay={overlay}
    >
      {children}
    </SearchPageShell>
  );

  if (legislatorQuery.isLoading) {
    return shell(
      <View style={styles.stateBox}>
        <ActivityIndicator color={t.colors.brand.base} />
        <Text style={styles.stateText}>Loading legislator…</Text>
      </View>,
      null,
    );
  }

  if (legislatorQuery.isError || !legislator) {
    return shell(
      <View style={styles.stateBox}>
        <Text style={styles.stateText}>
          We couldn’t load this legislator right now. Please try again in a moment.
        </Text>
      </View>,
      null,
    );
  }

  const chamberWord = legislator.chamber; // "House" | "Senate"
  const partyLabel = partyFull(legislator.party);
  const districtLine = `${chamberWord} District ${legislator.district}`;
  const shareUrl =
    isWeb && typeof window !== 'undefined'
      ? `${window.location.origin}/legislators/${encodeURIComponent(legislator.id)}`
      : `https://alethical.com/legislators/${encodeURIComponent(legislator.id)}`;
  const shareTitle = `${legislator.name} — ${partyLabel}, ${districtLine}`;

  const hero = (
    <Hero
      legislator={legislator}
      districtLine={districtLine}
      partyLabel={partyLabel}
      shareUrl={shareUrl}
      shareTitle={shareTitle}
      onAllLegislators={() => navigation.navigate('Legislators')}
      isDesktop={isDesktop}
    />
  );

  const bioText =
    legislator.bio && legislator.bio !== 'Live legislator profile loaded from the backend.'
      ? legislator.bio
      : null;
  const committees = legislator.committeeAssignments ?? [];
  const seeMoreUrl = chiefAuthorListUrl(legislator);

  const body = (
    <View style={[styles.grid, isDesktop && styles.gridDesktop]}>
      {/* LEFT COLUMN — the record */}
      <View style={styles.leftColumn}>
        {bioText ? (
          <View style={styles.card}>
            <Text style={styles.h2}>Biography</Text>
            <Text style={styles.bio}>{bioText}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={[styles.h2, styles.h2Spaced]}>Committees</Text>
          {committees.length > 0 ? (
            <View style={styles.committeeList}>
              {committees.map((committee) => (
                <CommitteeRow key={committee.name} name={committee.name} role={committee.role} />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyNote}>No current committee assignments on record.</Text>
          )}
        </View>

        <View>
          <View style={styles.authoredHead}>
            <Text style={styles.h2}>Chief-Authored Bills</Text>
            <SessionFilter />
          </View>
          <View style={styles.billStack}>
            {billsQuery.isLoading ? (
              <View style={styles.stateBoxSmall}>
                <ActivityIndicator color={t.colors.brand.base} />
              </View>
            ) : chiefBills.length > 0 ? (
              <>
                {chiefBills.map((bill) => (
                  <ChiefBillCard
                    key={bill.id}
                    bill={bill}
                    legislatorId={legislator.id}
                    onPress={() => openBill(bill.id)}
                    onOpenLegislator={openLegislator}
                  />
                ))}
                <SeeMoreButton onPress={() => openUrl(seeMoreUrl)} />
              </>
            ) : (
              <View style={styles.card}>
                <Text style={styles.emptyNote}>
                  No chief-authored bills in the {CURRENT_SESSION_LABEL} on record yet.
                </Text>
              </View>
            )}
          </View>
        </View>

        <RoadmapZone legislatorName={legislator.name} onClaim={() => setClaimOpen(true)} />
      </View>

      {/* RIGHT COLUMN — contact / source of record */}
      <View style={styles.rightColumn}>
        <View style={styles.card}>
          <Text style={[styles.h3, styles.h3Spaced]}>Contact</Text>
          <View style={styles.contactStack}>
            {legislator.officeAddress ? (
              <View>
                <Text style={styles.contactLabel}>CAPITOL OFFICE</Text>
                <Text style={styles.contactValue}>{legislator.officeAddress}</Text>
              </View>
            ) : null}
            {legislator.phone ? (
              <View>
                <Text style={styles.contactLabel}>PHONE</Text>
                <Text style={styles.contactValue}>{legislator.phone}</Text>
              </View>
            ) : null}
            {legislator.profileUrl ? (
              <SourceLink
                label={`Official ${chamberWord} profile →`}
                onPress={() => openUrl(legislator.profileUrl!)}
              />
            ) : null}
            {!legislator.officeAddress && !legislator.phone && !legislator.profileUrl ? (
              <Text style={styles.emptyNote}>No contact details are on record yet.</Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );

  const overlay = claimOpen ? (
    <ClaimModal legislatorName={legislator.name} onClose={() => setClaimOpen(false)} />
  ) : null;

  return shell(body, hero, overlay);
}

// Build the member's chief-author list URL on the Revisor (the official source
// the "See more" hands off to). The Revisor keys the list on the member's chamber
// profile id (House: /profile/{id}; Senate: member_bio.html?mem_id={id}), which we
// read out of profile_url. Falls back to the official profile page when the id
// can't be parsed, so the link always resolves.
function chiefAuthorListUrl(legislator: Legislator): string {
  const url = legislator.profileUrl ?? '';
  const body = legislator.chamber === 'Senate' ? 'Senate' : 'House';
  const houseId = url.match(/\/profile\/(\d+)/)?.[1];
  const senateId = url.match(/mem_id=(\d+)/)?.[1];
  const legid = body === 'House' ? houseId : senateId;
  if (!legid) return legislator.profileUrl ?? 'https://www.revisor.mn.gov/bills/';
  return (
    'https://www.revisor.mn.gov/revisor/pages/search_status/status_result.php' +
    `?body=${body}&session=${REVISOR_SESSION_CODE}&legid1=${legid}`
  );
}

// --- Hero: breadcrumb + eyebrow + portrait + identity + Share ---
function Hero({
  legislator,
  districtLine,
  partyLabel,
  shareUrl,
  shareTitle,
  onAllLegislators,
  isDesktop,
}: {
  legislator: Legislator;
  districtLine: string;
  partyLabel: string;
  shareUrl: string;
  shareTitle: string;
  onAllLegislators: () => void;
  isDesktop: boolean;
}) {
  return (
    <View>
      <Breadcrumb onPress={onAllLegislators} />
      <Text style={styles.eyebrow}>LEGISLATOR PROFILE</Text>
      <View style={[styles.heroRow, !isDesktop && styles.heroRowMobile]}>
        <View style={styles.identityRow}>
          <Portrait uri={legislator.photoUrl} name={legislator.name} />
          <View style={styles.identityText}>
            <Text style={[styles.h1, !isDesktop && styles.h1Mobile]} accessibilityRole="header">
              {legislator.name}
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>{districtLine}</Text>
              <View style={styles.metaDot} />
              <View style={styles.partyPill}>
                <Text style={styles.partyPillText}>{partyLabel}</Text>
              </View>
            </View>
          </View>
        </View>
        <SharePopover url={shareUrl} title={shareTitle} />
      </View>
    </View>
  );
}

function Portrait({ uri, name }: { uri?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .replace(/^(sen\.|rep\.|senator|representative)\s+/i, '')
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  if (uri && !failed) {
    return (
      <View style={styles.portrait}>
        <Image
          source={{ uri }}
          accessibilityLabel={name}
          resizeMode="cover"
          onError={() => setFailed(true)}
          style={styles.portraitImage}
        />
      </View>
    );
  }
  return (
    <View style={[styles.portrait, styles.portraitFallback]} accessibilityLabel={name}>
      <Text style={styles.portraitInitials}>{initials}</Text>
    </View>
  );
}

function Breadcrumb({ onPress }: { onPress: () => void }) {
  const [hovered, hover] = useHover();
  const color = hovered ? t.colors.text.primary : BREADCRUMB_GREY;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="All legislators"
      onPress={onPress}
      {...hover}
      style={styles.breadcrumb}
    >
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
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

// --- Committee row: green dot + name + optional leadership badge ---
function CommitteeRow({ name, role }: { name: string; role: string | null }) {
  return (
    <View style={styles.committeeRow}>
      <View style={styles.committeeDot} />
      <Text style={styles.committeeName}>{name}</Text>
      {role ? (
        <View style={styles.leadershipBadge}>
          <Text style={styles.leadershipBadgeText}>{role.toUpperCase()}</Text>
        </View>
      ) : null}
    </View>
  );
}

// --- Chief-authored bill card ---
function ChiefBillCard({
  bill,
  legislatorId,
  onPress,
  onOpenLegislator,
}: {
  bill: Bill;
  legislatorId: string;
  onPress: () => void;
  onOpenLegislator: (id: string) => void;
}) {
  const [hovered, hover] = useHover();
  const stage = billStage(bill.status);
  const filled = stage.index + 1;
  const label = stageLabel(bill.status);
  const title = bill.aiAnalysis?.shortTitle ?? bill.title;
  const summary = bill.aiAnalysis?.summary ?? '';
  const topics = bill.aiAnalysis?.policyAreas ?? [];
  const coAuthors = coAuthorCount(bill);
  // Co-chief authors = the OTHER chief sponsors on this bill (grounded from
  // chief_sponsors); shown as "Co-chief author: …" like the design.
  const coChiefs = (bill.sponsors ?? []).filter(
    (sponsor) => sponsor.role === 'chief_author' && sponsor.legislatorId !== legislatorId,
  );
  const movedDate = formatMonoDate(bill.updatedAt);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${bill.identifier}: ${title}`}
      onPress={onPress}
      {...hover}
      style={[styles.billCard, hovered && styles.billCardHover]}
    >
      <View style={styles.billTopRow}>
        <View style={styles.codeBadge}>
          <Text style={styles.codeBadgeText}>{bill.identifier}</Text>
        </View>
        <Text style={styles.billStatus}>{label}</Text>
        <View style={styles.progressRow}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View
              key={i}
              style={[
                styles.progressSeg,
                i < filled
                  ? stage.tone === 'vetoed'
                    ? styles.progressSegVetoed
                    : styles.progressSegFilled
                  : styles.progressSegEmpty,
              ]}
            />
          ))}
        </View>
        {movedDate ? <Text style={styles.movedText}>LAST MOVED {movedDate}</Text> : null}
      </View>
      <Text style={styles.billTitle}>{title}</Text>
      {summary ? <Text style={styles.billSummary}>{summary}</Text> : null}
      {coChiefs.length > 0 || coAuthors > 0 ? (
        <Text style={styles.coauthorLine}>
          {coChiefs.length > 0 ? (
            <>
              {coChiefs.length === 1 ? 'Co-chief author: ' : 'Co-chief authors: '}
              {coChiefs.map((sponsor, index) => (
                <Text key={sponsor.legislatorId ?? sponsor.name}>
                  {index > 0 ? ', ' : ''}
                  <Text
                    style={styles.coauthorLink}
                    onPress={
                      sponsor.legislatorId
                        ? () => onOpenLegislator(sponsor.legislatorId!)
                        : undefined
                    }
                  >
                    {sponsor.name}
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
      {topics.length > 0 ? (
        <View style={styles.topicRow}>
          {topics.slice(0, 3).map((topic) => (
            <View key={topic} style={styles.topicChip}>
              <Text style={styles.topicChipText}>{topic.toUpperCase()}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

function SeeMoreButton({ onPress }: { onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="See more chief-authored bills on the Revisor"
      onPress={onPress}
      {...hover}
      style={[styles.seeMore, hovered && styles.seeMoreHover]}
    >
      <Text style={styles.seeMoreText}>See more</Text>
      <Svg width={22} height={16} viewBox="0 0 33 24" fill="none" style={styles.seeMoreArrow}>
        <Path
          d="M3 12 H28 M20 5 L28 12 L20 19"
          stroke={t.colors.text.primary}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}

// --- Session filter (current session live; past sessions are roadmap) ---
function SessionFilter() {
  const [open, setOpen] = useState(false);
  const [hovered, hover] = useHover();
  return (
    <View style={styles.sessionWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        {...hover}
        style={[styles.sessionBtn, hovered && styles.sessionBtnHover]}
      >
        <Text style={styles.sessionBtnText}>{CURRENT_SESSION_LABEL}</Text>
        <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
          <Path
            d="M6 9 L12 15 L18 9"
            stroke={t.colors.text.muted}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
      {open ? (
        <>
          <Pressable
            accessibilityLabel="Close session filter"
            style={styles.sessionBackdrop}
            onPress={() => setOpen(false)}
          />
          <View style={[styles.sessionMenu, isWeb ? (styles.sessionMenuWeb as object) : null]}>
            <Pressable
              accessibilityRole="menuitem"
              onPress={() => setOpen(false)}
              style={styles.sessionActive}
            >
              <Text style={styles.sessionActiveText}>{CURRENT_SESSION_LABEL}</Text>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M5 12.5 L10 17.5 L19 7"
                  stroke={t.colors.brand.deep}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
            {PAST_SESSIONS.map((session) => (
              <View key={session} style={styles.sessionPast}>
                <Text style={styles.sessionPastText}>{session}</Text>
                <LockIcon />
              </View>
            ))}
            <Text style={styles.sessionNote}>
              Past-session archives — including retired legislators — are on the roadmap.
            </Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

function LockIcon() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path d="M5 11 h14 v9 h-14 Z" stroke={t.colors.text.muted} strokeWidth={2} />
      <Path
        d="M8 11 V8 a4 4 0 0 1 8 0 v3"
        stroke={t.colors.text.muted}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// --- Contact source link ---
function SourceLink({ label, onPress }: { label: string; onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} {...hover}>
      <Text style={[styles.sourceLink, hovered && styles.sourceLinkHover]}>{label}</Text>
    </Pressable>
  );
}

// --- On the roadmap zone (clearly not-live) ---
function RoadmapZone({ legislatorName, onClaim }: { legislatorName: string; onClaim: () => void }) {
  const { isDesktop } = useResponsive();
  return (
    <View style={styles.roadmap}>
      <Text style={styles.roadmapEyebrow}>ON THE ROADMAP</Text>
      <Text style={styles.roadmapSubtitle}>Features we plan to build.</Text>
      <View style={[styles.roadmapGrid, isDesktop && styles.roadmapGridDesktop]}>
        <View style={styles.dashedCard}>
          <Text style={styles.roadmapH3}>Claim this profile</Text>
          <Text style={styles.roadmapBody}>
            Are you {legislatorName}? Claiming links you to this existing record, so you can manage
            your biography, write up the bills you’ve worked on, and add your own context. Verified
            against official legislative records.
          </Text>
          <ClaimButton onPress={onClaim} />
        </View>
        <View style={styles.dashedCard}>
          <Text style={styles.roadmapH3}>Why the votes?</Text>
          <Text style={styles.roadmapBody}>
            See a roll call and wonder why {shortNameFor(legislatorName)} voted that way? Once
            claimed, a legislator will have the option to explain any vote they cast — right here,
            in their own words, alongside the record.
          </Text>
          <VoteExplanationPreview />
        </View>
      </View>
    </View>
  );
}

function shortNameFor(name: string): string {
  return name;
}

function ClaimButton({ onPress }: { onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Claim this profile"
      onPress={onPress}
      {...hover}
      style={[styles.claimBtn, hovered && styles.claimBtnHover]}
    >
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
        <Path
          d="M12 3 L20 6 V11 c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10 V6 Z"
          stroke={t.colors.brand.darkest}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <Path
          d="M8.5 12 L11 14.5 L15.5 9.5"
          stroke={t.colors.brand.darkest}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={styles.claimBtnText}>Claim this profile</Text>
    </Pressable>
  );
}

// A static, clearly-illustrative preview of the future vote-explanation feature.
// Deliberately carries NO real bill code / date / tally — it sits inside the
// dashed, de-emphasized roadmap card as a sketch of what's coming, never a record.
function VoteExplanationPreview() {
  return (
    <View style={styles.votePreview}>
      <View style={styles.voteCheck}>
        <Text style={styles.voteCheckMark}>✓</Text>
      </View>
      <View style={styles.votePreviewBody}>
        <View style={styles.votePreviewHead}>
          <Text style={styles.voteYes}>Voted Yes</Text>
          <View style={styles.voteSkeletonChip} />
        </View>
        <View style={styles.voteSkeletonLineFull} />
        <View style={styles.voteSkeletonLineShort} />
        <Text style={styles.voteExplLabel}>LEGISLATOR’S EXPLANATION</Text>
      </View>
    </View>
  );
}

// --- Claim modal (roadmap, not-live) ---
function ClaimModal({ legislatorName, onClose }: { legislatorName: string; onClose: () => void }) {
  const rows = [
    {
      title: 'Manage your biography',
      body: 'Add or refine the bio shown at the top of this profile.',
    },
    {
      title: 'Write up your bills',
      body: 'Explain the bills you’ve worked on in your own words, alongside the record.',
    },
    {
      title: 'Add your own context',
      body: 'Give constituents your perspective — without changing the public facts.',
    },
  ];
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose} accessibilityLabel="Close">
        <Pressable
          style={styles.modalCard}
          onPress={(event) => event.stopPropagation?.()}
          accessibilityRole={isWeb ? undefined : 'none'}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={styles.modalClose}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M6 6 L18 18 M18 6 L6 18"
                stroke={t.colors.text.muted}
                strokeWidth={2.2}
                strokeLinecap="round"
              />
            </Svg>
          </Pressable>
          <View style={styles.modalIcon}>
            <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 3 L20 6 V11 c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10 V6 Z"
                stroke={t.colors.brand.deep}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              <Path
                d="M8.5 12 L11 14.5 L15.5 9.5"
                stroke={t.colors.brand.deep}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </View>
          <View style={styles.modalTitleRow}>
            <Text style={styles.modalTitle}>Claim your profile</Text>
            <View style={styles.modalRoadmapPill}>
              <Text style={styles.modalRoadmapPillText}>ON THE ROADMAP</Text>
            </View>
          </View>
          <Text style={styles.modalIntro}>
            You’re claiming the profile Alethical already keeps for{' '}
            <Text style={styles.modalStrong}>{legislatorName}</Text>. Claiming links you to this
            existing record.
          </Text>
          <View style={styles.modalRows}>
            {rows.map((row) => (
              <View key={row.title} style={styles.modalRow}>
                <View style={styles.modalRowCheck}>
                  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                    <Path
                      d="M5 12.5 L10 17.5 L19 7"
                      stroke={t.colors.brand.deep}
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </View>
                <View style={styles.modalRowText}>
                  <Text style={styles.modalRowTitle}>{row.title}</Text>
                  <Text style={styles.modalRowBody}>{row.body}</Text>
                </View>
              </View>
            ))}
          </View>
          <View style={styles.modalVerify}>
            <LockIcon />
            <Text style={styles.modalVerifyText}>
              We verify every claim against official legislative records before your additions go
              live.
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.modalPrimary}>
            <Text style={styles.modalPrimaryText}>Start verification</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.modalSecondary}>
            <Text style={styles.modalSecondaryText}>Maybe later</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// --- Share popover (copy link + social), anchored; mirrors BillHeader's ---
function SharePopover({ url, title }: { url: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [btnHovered, btnHover] = useHover();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const enc = encodeURIComponent;
  const intents = {
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
    x: `https://twitter.com/intent/tweet?text=${enc(`${title} · Alethical`)}&url=${enc(url)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
    email: `mailto:?subject=${enc(title)}&body=${enc(`${title}\n\n${url}\n\nvia Alethical`)}`,
  };
  const copy = () => {
    if (isWeb && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1900);
  };
  const openIntent = (href: string) => {
    if (isWeb && typeof window !== 'undefined') window.open(href, '_blank', 'noopener');
    else Linking.openURL(href).catch(() => {});
  };

  return (
    <View style={styles.shareWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share this legislator"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setOpen((v) => !v);
          setCopied(false);
        }}
        {...btnHover}
        style={[styles.shareBtn, btnHovered && styles.shareBtnHover]}
      >
        <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
          <Circle cx={18} cy={5} r={2.6} stroke={t.colors.text.primary} strokeWidth={2} />
          <Circle cx={6} cy={12} r={2.6} stroke={t.colors.text.primary} strokeWidth={2} />
          <Circle cx={18} cy={19} r={2.6} stroke={t.colors.text.primary} strokeWidth={2} />
          <Path
            d="M8.4 10.7 L15.6 6.5 M8.4 13.3 L15.6 17.5"
            stroke={t.colors.text.primary}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
        <Text style={styles.shareBtnText}>Share</Text>
      </Pressable>
      {open ? (
        <>
          <Pressable
            accessibilityLabel="Close share"
            style={styles.shareBackdrop}
            onPress={() => setOpen(false)}
          />
          <View style={[styles.sharePanel, isWeb ? (styles.sharePanelWeb as object) : null]}>
            <View style={styles.sharePanelHead}>
              <Text style={styles.sharePanelTitle}>Share this legislator</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setOpen(false)}
                style={styles.shareClose}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M6 6 L18 18 M18 6 L6 18"
                    stroke={t.colors.text.muted}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                  />
                </Svg>
              </Pressable>
            </View>
            <View style={styles.shareUrlRow}>
              <TextInput
                value={url}
                editable={false}
                accessibilityLabel="Legislator link"
                style={[styles.shareUrlInput, isWeb ? ({ outlineStyle: 'none' } as object) : null]}
              />
              <Pressable accessibilityRole="button" onPress={copy} style={styles.shareCopyBtn}>
                {copied ? (
                  <>
                    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M5 12.5 L10 17.5 L19 7"
                        stroke={t.colors.text.onGreen}
                        strokeWidth={2.4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                    <Text style={styles.shareCopyText}>Copied</Text>
                  </>
                ) : (
                  <Text style={styles.shareCopyText}>Copy</Text>
                )}
              </Pressable>
            </View>
            <View style={styles.shareSocialSection}>
              <Text style={styles.shareSocialLabel}>SHARE TO</Text>
              <View style={styles.shareSocialRow}>
                <SocialButton
                  label="Share on LinkedIn"
                  onPress={() => openIntent(intents.linkedin)}
                >
                  <Path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
                </SocialButton>
                <SocialButton label="Share on X" onPress={() => openIntent(intents.x)}>
                  <Path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </SocialButton>
                <SocialButton
                  label="Share on Facebook"
                  onPress={() => openIntent(intents.facebook)}
                >
                  <Path d="M15.12 5.32H17V2.14A26.11 26.11 0 0 0 14.26 2c-2.72 0-4.58 1.66-4.58 4.7v2.6H6.61v3.56h3.07V22h3.68v-9.14h3.06l.46-3.56h-3.52V7.05c0-1.03.28-1.73 1.76-1.73z" />
                </SocialButton>
                <SocialButton
                  label="Share by email"
                  onPress={() => openIntent(intents.email)}
                  stroke
                >
                  <Path
                    d="M3 6.5 h18 v11 h-18 Z M4 7.5 L12 13 L20 7.5"
                    stroke={t.colors.text.primary}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </SocialButton>
              </View>
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

function SocialButton({
  label,
  onPress,
  children,
  stroke,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
  stroke?: boolean;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      {...hover}
      style={[styles.social, hovered && styles.socialHover]}
    >
      <Svg
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill={stroke ? 'none' : t.colors.text.primary}
      >
        {children}
      </Svg>
    </Pressable>
  );
}

const BREADCRUMB_GREY = '#4b524b';
const CODE_BADGE_FILL = t.colors.omnibus.fill;
const CODE_BADGE_BORDER = t.colors.omnibus.border;

const styles = StyleSheet.create({
  stateBox: { paddingVertical: 64, alignItems: 'center', justifyContent: 'center', gap: 12 },
  stateBoxSmall: { paddingVertical: 28, alignItems: 'center' },
  stateText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  // --- Hero ---
  breadcrumb: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  breadcrumbLabel: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.semibold,
  },
  eyebrow: {
    marginTop: 24,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.4,
    color: t.colors.brand.deep,
  },
  heroRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 32,
    flexWrap: 'wrap',
  },
  heroRowMobile: { alignItems: 'flex-start' },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 24, flexShrink: 1 },
  identityText: { flexShrink: 1 },
  portrait: {
    width: 128,
    height: 146,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    backgroundColor: t.colors.surfaces.s200,
    ...(t.shadows.card as object),
  },
  portraitImage: { width: '100%', height: '100%' },
  portraitFallback: { alignItems: 'center', justifyContent: 'center' },
  portraitInitials: {
    fontFamily: t.typography.title,
    fontSize: 40,
    fontWeight: t.fontWeights.heavy,
    color: t.colors.text.muted,
  },
  h1: {
    fontFamily: t.typography.title,
    fontSize: 56,
    lineHeight: 58,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1,
    color: t.colors.text.primary,
  },
  h1Mobile: { fontSize: 34, lineHeight: 38, letterSpacing: -0.6 },
  metaRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  metaText: { fontFamily: t.typography.body, fontSize: 22, color: t.colors.text.faint },
  metaDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#c3c9c4' },
  partyPill: {
    paddingVertical: 5,
    paddingHorizontal: 13,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: t.radii.pill,
  },
  partyPillText: {
    fontFamily: t.typography.body,
    fontSize: 14,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: t.colors.brand.deep,
  },
  // --- Body grid ---
  grid: { gap: 24 },
  gridDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
  leftColumn: { flex: 1.5, gap: 24, minWidth: 0 },
  rightColumn: { flex: 1, gap: 24, minWidth: 0 },
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    paddingVertical: 32,
    paddingHorizontal: 34,
    ...(t.shadows.card as object),
  },
  h2: {
    fontFamily: t.typography.title,
    fontSize: 30,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.6,
    color: t.colors.text.primary,
  },
  h2Spaced: { marginBottom: 20 },
  h3: {
    fontFamily: t.typography.title,
    fontSize: 26,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.5,
    color: t.colors.text.primary,
  },
  h3Spaced: { marginBottom: 18 },
  bio: {
    marginTop: 16,
    fontFamily: t.typography.body,
    fontSize: 20,
    lineHeight: 31,
    color: t.colors.text.secondary,
  },
  emptyNote: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    color: t.colors.text.muted,
    lineHeight: 24,
  },
  // --- Committees ---
  committeeList: { gap: 14 },
  committeeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  committeeDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: t.colors.brand.base },
  committeeName: { fontFamily: t.typography.body, fontSize: 20, color: '#1a201d' },
  leadershipBadge: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: t.radii.pill,
  },
  leadershipBadgeText: {
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.brand.deep,
  },
  // --- Authored bills ---
  authoredHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  billStack: { gap: 18 },
  billCard: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    paddingVertical: 26,
    paddingHorizontal: 32,
    ...(t.shadows.card as object),
  },
  billCardHover: { borderColor: t.colors.alpha.ink16 },
  billTopRow: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  codeBadge: {
    backgroundColor: CODE_BADGE_FILL,
    borderWidth: 1,
    borderColor: CODE_BADGE_BORDER,
    borderRadius: t.radii.badge,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  codeBadgeText: {
    fontFamily: t.typography.mono,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.6,
    color: t.colors.omnibus.text,
  },
  billStatus: {
    fontFamily: t.typography.body,
    fontSize: 14,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  progressSeg: { width: 30, height: 7, borderRadius: 4 },
  progressSegFilled: { backgroundColor: t.colors.brand.base },
  progressSegVetoed: { backgroundColor: t.colors.status.vetoedStep },
  progressSegEmpty: { backgroundColor: t.colors.status.progressEmpty },
  movedText: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    letterSpacing: 0.6,
    color: t.colors.text.muted,
  },
  billTitle: {
    marginTop: 14,
    fontFamily: t.typography.title,
    fontSize: 26,
    fontWeight: t.fontWeights.bold,
    letterSpacing: -0.3,
    lineHeight: 31,
    color: t.colors.text.primary,
  },
  billSummary: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 27,
    color: t.colors.text.secondary,
  },
  coauthorLine: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: 15,
    color: t.colors.text.muted,
  },
  coauthorLink: { color: t.colors.brand.deep, fontWeight: t.fontWeights.bold },
  topicRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  topicChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: t.radii.sm,
  },
  topicChipText: {
    fontFamily: t.typography.body,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.text.secondary,
  },
  seeMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 14,
  },
  seeMoreHover: { borderColor: t.colors.alpha.ink32, backgroundColor: t.colors.surfaces.s200 },
  seeMoreText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  seeMoreArrow: { display: 'flex' },
  // --- Session filter ---
  sessionWrap: { position: 'relative', zIndex: 40 },
  sessionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: t.radii.md,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  sessionBtnHover: { borderColor: t.colors.alpha.ink32, backgroundColor: t.colors.surfaces.s200 },
  sessionBtnText: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  sessionBackdrop: {
    ...(StyleSheet.absoluteFillObject as object),
    position: (isWeb ? 'fixed' : 'absolute') as 'absolute',
    top: -2000,
    left: -2000,
    right: -2000,
    bottom: -2000,
    zIndex: 0,
  },
  sessionMenu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 10,
    zIndex: 1,
    width: 344,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 14,
    padding: 8,
    ...(t.shadows.lg as object),
  },
  sessionMenuWeb: { boxShadow: '0 24px 60px rgba(17,21,15,0.2)' },
  sessionActive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#f1faf4',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  sessionActiveText: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  sessionPast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  sessionPastText: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.muted,
  },
  sessionNote: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
    fontFamily: t.typography.body,
    fontSize: 13,
    lineHeight: 19,
    color: t.colors.text.muted,
  },
  // --- Contact ---
  contactStack: { gap: 16 },
  contactLabel: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
    color: t.colors.text.muted,
  },
  contactValue: {
    marginTop: 6,
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
    color: '#1a201d',
  },
  sourceLink: {
    fontFamily: t.typography.body,
    fontSize: 16,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  sourceLinkHover: { color: t.colors.brand.forest },
  // --- Roadmap ---
  roadmap: {
    marginTop: 28,
    paddingTop: 32,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  roadmapEyebrow: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
    color: t.colors.text.muted,
  },
  roadmapSubtitle: {
    marginTop: 12,
    marginBottom: 20,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26,
    color: t.colors.text.faint,
  },
  roadmapGrid: { gap: 18 },
  roadmapGridDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
  dashedCard: {
    flex: 1,
    backgroundColor: t.colors.surfaces.s50,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.alpha.ink20,
    borderRadius: t.radii.lg,
    paddingVertical: 32,
    paddingHorizontal: 34,
  },
  roadmapH3: {
    fontFamily: t.typography.title,
    fontSize: 24,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.4,
    color: t.colors.text.primary,
  },
  roadmapBody: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 28,
    color: t.colors.text.secondary,
  },
  claimBtn: {
    marginTop: 18,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: t.colors.brand.base,
    borderWidth: 1,
    borderColor: t.colors.brand.base,
    borderRadius: t.radii.md,
    paddingVertical: 13,
    paddingHorizontal: 22,
  },
  claimBtnHover: { backgroundColor: '#28bf71', borderColor: '#28bf71' },
  claimBtnText: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.darkest,
  },
  // vote-explanation preview (static illustration)
  votePreview: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.md,
    paddingVertical: 16,
    paddingHorizontal: 18,
    opacity: 0.7,
  },
  voteCheck: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  voteCheckMark: { fontSize: 15, fontWeight: '800', color: t.colors.brand.deep },
  votePreviewBody: { flex: 1, minWidth: 0 },
  votePreviewHead: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  voteYes: {
    fontFamily: t.typography.body,
    fontSize: 17,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  voteSkeletonChip: { width: 64, height: 20, borderRadius: 6, backgroundColor: '#eef0f1' },
  voteSkeletonLineFull: { marginTop: 11, height: 9, borderRadius: 5, backgroundColor: '#eef0f1' },
  voteSkeletonLineShort: {
    marginTop: 7,
    height: 9,
    width: '72%',
    borderRadius: 5,
    backgroundColor: '#eef0f1',
  },
  voteExplLabel: {
    marginTop: 12,
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.1,
    color: t.colors.text.muted,
  },
  // --- Claim modal ---
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(10,14,12,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: 540,
    maxWidth: '100%',
    backgroundColor: t.colors.surfaces.base,
    borderRadius: 20,
    paddingVertical: 34,
    paddingHorizontal: 34,
    ...(t.shadows.lg as object),
  },
  modalClose: {
    position: 'absolute',
    top: 18,
    right: 18,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  modalIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitleRow: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  modalTitle: {
    fontFamily: t.typography.title,
    fontSize: 27,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.4,
    color: t.colors.text.primary,
  },
  modalRoadmapPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 11,
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: t.radii.pill,
  },
  modalRoadmapPillText: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.1,
    color: t.colors.text.muted,
  },
  modalIntro: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26,
    color: t.colors.text.secondary,
  },
  modalStrong: { color: t.colors.text.primary, fontWeight: t.fontWeights.bold },
  modalRows: { marginTop: 22, gap: 14 },
  modalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 13 },
  modalRowCheck: {
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
  modalRowText: { flex: 1, minWidth: 0 },
  modalRowTitle: {
    fontFamily: t.typography.body,
    fontSize: 17,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  modalRowBody: {
    marginTop: 2,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: t.colors.text.faint,
  },
  modalVerify: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#f7f9f8',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.md,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  modalVerifyText: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: t.colors.text.secondary,
  },
  modalPrimary: {
    marginTop: 22,
    backgroundColor: t.colors.brand.base,
    borderRadius: t.radii.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  modalPrimaryText: {
    fontFamily: t.typography.ui,
    fontSize: 17,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.darkest,
  },
  modalSecondary: { marginTop: 10, paddingVertical: 6, alignItems: 'center' },
  modalSecondaryText: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.muted,
  },
  // --- Share ---
  shareWrap: { position: 'relative', zIndex: 60 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 24,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: t.radii.md,
  },
  shareBtnHover: { borderColor: t.colors.alpha.ink32, backgroundColor: t.colors.surfaces.s200 },
  shareBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  shareBackdrop: {
    ...(StyleSheet.absoluteFillObject as object),
    position: (isWeb ? 'fixed' : 'absolute') as 'absolute',
    top: -2000,
    left: -2000,
    right: -2000,
    bottom: -2000,
    zIndex: 0,
  },
  sharePanel: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 12,
    zIndex: 1,
    width: 366,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: t.radii.xl,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 22,
    ...(t.shadows.lg as object),
  },
  sharePanelWeb: { boxShadow: '0 24px 60px rgba(17,21,15,0.2)' },
  sharePanelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sharePanelTitle: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.lg,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
  },
  shareClose: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.sm,
  },
  shareUrlRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f7f9f8',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 11,
    paddingVertical: 5,
    paddingRight: 5,
    paddingLeft: 14,
  },
  shareUrlInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.secondary,
  },
  shareCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.colors.brand.base,
    borderRadius: t.radii.sm,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  shareCopyText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.onGreen,
  },
  shareSocialSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  shareSocialLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
    color: t.colors.text.muted,
  },
  shareSocialRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  social: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.colors.surfaces.s400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialHover: { backgroundColor: '#e7e8ec' },
});
