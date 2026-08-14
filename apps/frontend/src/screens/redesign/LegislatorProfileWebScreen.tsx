import { useMemo, useState, type CSSProperties } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useNavigation, useRoute } from '@react-navigation/native';

import { theme as t } from '../../theme/tokens';
import { GoBackLink } from '../../components/GoBackLink';
import { profilePartyBadgeAppearance } from '../../theme/legislatorBadgeAppearance';
import { IaItem, MenuKey } from '../../navigation/ia';
import { externalLinkProps, linkProps, pressInsideLink, routePath } from '../../navigation/links';
import { Bill, Legislator, LegislatorVote } from '../../data/types';
import { useAuth } from '../../providers/AuthProvider';
import { useResponsive } from '../../hooks/useResponsive';
import {
  useLegislator,
  useLegislatorBills,
  useLegislatorOutsideSpending,
  useLegislatorVotes,
  useSessions,
} from '../../hooks/useAppQueries';
import { OutsideSpendingCard } from '../../components/legislator/OutsideSpendingCard';
import { outsideSpendingYears } from '../../lib/outsideSpending';
import {
  billStage,
  coAuthorCount,
  formatMonoDate,
  partyFull,
  plainBillSummary,
  stageLabel,
} from '../../lib/billDetail';
import {
  buildAskChips,
  legislatorDisplayName,
  legislatorDistrictLine,
  legislatorVoteLabel,
  splitOfficeAddress,
} from '../../lib/legislatorProfile';
import { SearchPageShell } from '../../components/search/searchPieces';
import { useHover, isWeb } from '../../components/billDetail/interactions';
import { SharePopover } from '../../components/billDetail/SharePopover';
import {
  buildLegislatorShareContent,
  legislatorPageMetadata,
  publicPageUrl,
} from '../../lib/share';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { Skeleton } from '../../components/Skeleton';
import { VoteCountLinkChip } from '../../components/VoteCountLinkChip';
import { formatLegislatureLabel, type SessionDisplaySource } from '../../lib/sessionLabel';
import { BillTrackButton } from '../../components/billDetail/BillTrackButton';
import { useBillTracking } from '../../hooks/useBillTracking';
import {
  CARD_CONTENT_LAYER,
  CARD_CONTROL_LAYER,
  CARD_LINK_LAYER,
} from '../../lib/billCardControlLayers';

// Web Legislator Profile (docs/product-onboarding/legislator-profile-guide.md). Aggregates a
// member's public record — identity, committees (with leadership), chief-authored
// bills, contact — with a link back to the official source, plus a clearly-labeled
// "On the roadmap" zone. Chamber-parameterized from member data; the two design
// files are one layout with chamber differences applied.
//
// Grounded-answers notes: the "Legislative Service" card renders the member's
// ordered election history + current-chamber term, ingested from the official
// bios into legislator_election_history (issue #486); it shows only when real
// data is present. The "Ask about these issues" card uses starter chips that
// stay topic-scoped and answerable — the mock's literal person/vote chips would refuse or deflect today
// (no person-scoped Ask answer path; that's #484), and grounded-answers rule 2
// forbids chips that lead to a refusal. The roadmap zone stays non-interactive
// and clearly not-live; its vote specimen uses real record facts so it never
// redacts information the public record already holds.

const PAST_SESSIONS: SessionDisplaySource[] = [
  { sessionNumber: 93, yearStart: 2023, yearEnd: 2024 },
  { sessionNumber: 92, yearStart: 2021, yearEnd: 2022 },
];
// The current biennium's Revisor session code (094 + 2025). Only this session is
// ingested; past-session chief-author lists are on the roadmap.
const REVISOR_SESSION_CODE = '0942025';

export function LegislatorProfileWebScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { isDesktop } = useResponsive();
  const { isTracked, toggleTrack } = useBillTracking();

  const legislatorId = String(route.params?.legislatorId ?? '');
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);

  const legislatorQuery = useLegislator(legislatorId);
  const legislator = legislatorQuery.data;
  // A person's name cannot be guessed from the address, so the tab keeps what
  // the server sent until the profile loads (#1325).
  useDocumentTitle(
    legislatorId ? `/legislators/${legislatorId}` : null,
    legislator
      ? legislatorPageMetadata({
          slug: legislator.slug ?? legislator.id,
          displayName: legislatorDisplayName(legislator.name, legislator.chamber),
          districtLine: `${legislator.chamber} District ${legislator.district}`,
        }).title
      : null,
  );
  // Show the first two chief-authored bills; "See more" hands off to the member's
  // full chief-author list on the Revisor (the official source).
  const billsQuery = useLegislatorBills(legislatorId, { role: 'chief_author', limit: 2 });
  const votesQuery = useLegislatorVotes(legislatorId, 1);
  // This year and last: the current election cycle, derived so it cannot go stale.
  const outsideSpendingQuery = useLegislatorOutsideSpending(
    legislatorId,
    outsideSpendingYears(new Date()),
  );
  const sessionsQuery = useSessions();
  const currentSession =
    sessionsQuery.data?.find((session) => session.isCurrent) ?? sessionsQuery.data?.[0];
  const currentSessionLabel = currentSession
    ? formatLegislatureLabel(currentSession)
    : 'Current Legislature';
  const chiefBills = billsQuery.data?.data ?? [];
  const previewVote = votesQuery.data?.[0];

  const openUrl = (url: string) => {
    if (isWeb && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
    else Linking.openURL(url).catch(() => {});
  };
  const openBill = (billId: string) => navigation.navigate('BillDetail', { billId });
  const openBillVotes = (billId: string) =>
    navigation.navigate('BillDetail', { billId, tab: 'votes' });
  const openLegislator = (id: string) => navigation.push('LegislatorProfile', { legislatorId: id });
  const openAsk = (q: string) => navigation.navigate('Ask', { q: q || undefined, legislatorId });
  // Starter chips for the Ask box, derived from the issues THIS member works on
  // (their chief bills' policy areas). Phrased as topic questions the grounded
  // router actually answers (topic_bills) — never person- or vote-scoped, which
  // would refuse (grounded-answers rule 2; no vote chips pre-v1.1).
  const askChips = buildAskChips(chiefBills);

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

  const shell = (children: React.ReactNode, hero: React.ReactNode) => (
    <SearchPageShell
      openMenu={openMenu}
      onOpenMenuChange={setOpenMenu}
      onNavigate={handleNavigate}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
      onPrivacy={() => navigation.navigate('Privacy')}
      onTerms={() => navigation.navigate('Terms')}
      hero={hero}
    >
      {children}
    </SearchPageShell>
  );

  if (legislatorQuery.isLoading) {
    return shell(<LegislatorBodySkeleton isDesktop={isDesktop} />, <LegislatorHeroSkeleton />);
  }

  if (legislatorQuery.isError || !legislator) {
    return shell(
      <View style={styles.stateBox}>
        <GoBackLink href={routePath.legislators()} onPress={goToLegislatorList} />
        <Text style={styles.stateText}>
          We couldn’t load this legislator right now. Please try again in a moment.
        </Text>
      </View>,
      null,
    );
  }

  const chamberWord = legislator.chamber; // "House" | "Senate"
  const displayName = legislatorDisplayName(legislator.name, chamberWord);
  const partyLabel = partyFull(legislator.party);
  const districtLine = legislatorDistrictLine(chamberWord, legislator.district);
  // Share the readable slug URL (falls back to the UUID only for a row served
  // without a slug); the backend resolves either form.
  const shareSlug = legislator.slug ?? legislator.id;
  const shareContent = buildLegislatorShareContent({
    displayName,
    districtLine,
    url: publicPageUrl(`/legislators/${encodeURIComponent(shareSlug)}`),
  });

  const hero = (
    <Hero
      legislator={legislator}
      displayName={displayName}
      districtLine={districtLine}
      partyLabel={partyLabel}
      shareContent={shareContent}
      onAllLegislators={goToLegislatorList}
      isDesktop={isDesktop}
    />
  );

  const bioText = legislator.bio ?? null;
  const committees = legislator.committeeAssignments ?? [];
  const service = legislator.legislativeService;
  const seeMoreUrl = chiefAuthorListUrl(legislator);
  // The office blob can lead with a leadership title rather than an address line;
  // peel it off so it gets its own labeled row (never inlined into the address).
  const office = legislator.officeAddress ? splitOfficeAddress(legislator.officeAddress) : null;

  const body = (
    <View style={[styles.grid, isDesktop && styles.gridDesktop]}>
      {/* LEFT COLUMN — the record */}
      <View style={styles.leftColumn}>
        {bioText ? (
          <View style={styles.card}>
            <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
              Biography
            </Text>
            <Text style={styles.bio}>{bioText}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text accessibilityRole="header" aria-level={2} style={[styles.h2, styles.h2Spaced]}>
            Committees
          </Text>
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
            <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
              Chief-Authored Bills
            </Text>
            <SessionFilter currentSessionLabel={currentSessionLabel} />
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
                    onViewVotes={() => openBillVotes(bill.id)}
                    onOpenBill={openBill}
                    onOpenLegislator={openLegislator}
                    tracked={isTracked(bill.id)}
                    onToggleTrack={() => toggleTrack(bill.id, bill.identifier)}
                  />
                ))}
                <SeeMoreButton href={seeMoreUrl} onPress={() => openUrl(seeMoreUrl)} />
              </>
            ) : (
              <View style={styles.card}>
                <Text style={styles.emptyNote}>
                  No chief-authored bills in the {currentSessionLabel} on record yet.
                </Text>
              </View>
            )}
          </View>
        </View>

        <OutsideSpendingCard
          years={outsideSpendingQuery.data ?? []}
          isLoading={outsideSpendingQuery.isLoading}
          isError={outsideSpendingQuery.isError}
          onOpenSource={openUrl}
        />

        <RoadmapZone legislatorName={displayName} vote={previewVote} />
      </View>

      {/* RIGHT COLUMN — contact / source of record */}
      <View style={styles.rightColumn}>
        <View style={styles.card}>
          <Text accessibilityRole="header" aria-level={2} style={[styles.h3, styles.h3Spaced]}>
            Contact
          </Text>
          <View style={styles.contactStack}>
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
            {legislator.phone ? (
              <View>
                <Text style={styles.contactLabel}>PHONE</Text>
                <Text style={styles.contactValue}>{legislator.phone}</Text>
              </View>
            ) : null}
            {legislator.profileUrl ? (
              <SourceLink
                label={`Official ${chamberWord} profile →`}
                href={legislator.profileUrl}
                onPress={() => openUrl(legislator.profileUrl!)}
              />
            ) : null}
            {!legislator.officeAddress && !legislator.phone && !legislator.profileUrl ? (
              <Text style={styles.emptyNote}>No contact details are on record yet.</Text>
            ) : null}
          </View>
        </View>

        {service && service.lines.length > 0 ? (
          <View style={styles.card}>
            <Text accessibilityRole="header" aria-level={2} style={[styles.h3, styles.h3Spaced]}>
              Legislative Service
            </Text>
            <View style={styles.serviceStack}>
              {service.lines.map((line, index) => (
                <Text key={`${line.label}-${index}`} style={styles.serviceRow}>
                  <Text style={styles.serviceLabel}>{line.label}: </Text>
                  {line.elected}
                </Text>
              ))}
              {service.term ? (
                <Text style={styles.serviceRow}>
                  <Text style={styles.serviceLabel}>Term: </Text>
                  {service.term}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        <AskCard chips={askChips} onAsk={openAsk} />
      </View>
    </View>
  );

  return shell(body, hero);
}

// Build the member's chief-author list URL on the Revisor (the official source
// the "See more" hands off to). The Revisor keys the list on the member's chamber
// id, which we read out of profile_url — House: house.mn.gov/members/profile/{id};
// Senate: senate.leg.state.mn.us/members/member_bio.php?leg_id={id}. Both confirmed
// to resolve to the member's real chief-author list. Falls back to the official
// profile page when the id can't be parsed, so the link always resolves.
function chiefAuthorListUrl(legislator: Legislator): string {
  const url = legislator.profileUrl ?? '';
  const body = legislator.chamber === 'Senate' ? 'Senate' : 'House';
  const legid =
    body === 'House'
      ? url.match(/\/profile\/(\d+)/)?.[1]
      : url.match(/(?:leg_id|mem_id)=(\d+)/)?.[1];
  if (!legid) return legislator.profileUrl ?? 'https://www.revisor.mn.gov/bills/';
  return (
    'https://www.revisor.mn.gov/revisor/pages/search_status/status_result.php' +
    `?body=${body}&session=${REVISOR_SESSION_CODE}&legid1=${legid}`
  );
}

// --- Hero: breadcrumb + eyebrow + portrait + identity + Share ---
function Hero({
  legislator,
  displayName,
  districtLine,
  partyLabel,
  shareContent,
  onAllLegislators,
  isDesktop,
}: {
  legislator: Legislator;
  displayName: string;
  districtLine: string;
  partyLabel: string;
  shareContent: ReturnType<typeof buildLegislatorShareContent>;
  onAllLegislators: () => void;
  isDesktop: boolean;
}) {
  return (
    <View>
      <GoBackLink
        href={routePath.legislators()}
        onPress={onAllLegislators}
        style={styles.backLink}
      />
      <Text style={styles.eyebrow}>LEGISLATOR PROFILE</Text>
      <View style={[styles.heroRow, !isDesktop && styles.heroRowMobile]}>
        <View style={styles.identityRow}>
          <Portrait uri={legislator.photoUrl} name={displayName} />
          <View style={styles.identityText}>
            <Text
              style={[styles.h1, !isDesktop && styles.h1Mobile]}
              accessibilityRole="header"
              aria-level={1}
            >
              {displayName}
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>{districtLine}</Text>
              <View style={styles.metaDot} />
              <View style={styles.partyPill}>
                <Text numberOfLines={1} style={styles.partyPillText}>
                  {partyLabel}
                </Text>
              </View>
            </View>
          </View>
        </View>
        <SharePopover content={shareContent} />
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
          // Fit-inside, never fill — see LEGISLATOR_PORTRAIT_HEIGHT in
          // lib/legislatorSearch.ts for why cropping is off the table (#1334).
          resizeMode="contain"
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
// The card body (badge → summary) is the press target that opens the bill; the
// chip row below holds its own links (topics, companion, view votes) as separate
// pressables, so those don't fight the card's press (RN-Web nested-press).
function ChiefBillCard({
  bill,
  legislatorId,
  onPress,
  onViewVotes,
  onOpenBill,
  onOpenLegislator,
  tracked,
  onToggleTrack,
}: {
  bill: Bill;
  legislatorId: string;
  onPress: () => void;
  onViewVotes: () => void;
  onOpenBill: (id: string) => void;
  onOpenLegislator: (id: string) => void;
  tracked: boolean;
  onToggleTrack: () => void;
}) {
  const [hovered, hover] = useHover();
  const stage = billStage(bill.status);
  const filled = stage.index + 1;
  const label = stageLabel(bill.status);
  const title = bill.aiAnalysis?.shortTitle ?? bill.title;
  const summary = plainBillSummary(bill.aiAnalysis?.summary, { firstSentenceOnly: true });
  const topics = bill.aiAnalysis?.policyAreas ?? [];
  const coAuthors = coAuthorCount(bill);
  // Co-chief authors = the OTHER chief sponsors on this bill (grounded from
  // chief_sponsors); shown as "Co-chief author: …" like the design.
  const coChiefs = (bill.sponsors ?? []).filter(
    (sponsor) => sponsor.role === 'chief_author' && sponsor.legislatorId !== legislatorId,
  );
  const movedDate = formatMonoDate(bill.updatedAt);
  const companion = bill.companion;
  const hasVotes = (bill.rollCallCount ?? 0) > 0;

  return (
    <View style={[styles.billCard, hovered && styles.billCardHover]}>
      <Pressable
        {...linkProps(routePath.bill(bill.id), onPress)}
        accessibilityLabel={`${bill.identifier}: ${title}`}
        {...hover}
        style={styles.billCardOverlay}
      />
      <View style={styles.billCardContent}>
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
                      style={[styles.coauthorLink, styles.billCardControl]}
                      // This link sits above the full-card bill link. Cancel the
                      // underlying link as a second guard for web pointer events.
                      onPress={
                        sponsor.legislatorId
                          ? pressInsideLink(() => onOpenLegislator(sponsor.legislatorId!))
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
      </View>
      {topics.length > 0 || companion || hasVotes ? (
        <View style={[styles.topicRow, styles.billCardContent]}>
          {topics.slice(0, 3).map((topic) => (
            <View key={topic} style={styles.topicChip}>
              <Text style={styles.topicChipText}>{topic.toUpperCase()}</Text>
            </View>
          ))}
          {companion ? (
            <LinkChip
              label={`COMPANION ${companion.identifier} · ${(companion.status || '').toUpperCase()}`}
              href={routePath.bill(companion.id)}
              onPress={() => onOpenBill(companion.id)}
            />
          ) : null}
          {hasVotes ? (
            <View style={styles.billCardControl}>
              <VoteCountLinkChip
                count={bill.rollCallCount}
                href={routePath.bill(bill.id, { tab: 'votes' })}
                onPress={pressInsideLink(onViewVotes)}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// Outline chip that links from a bill card to its companion bill.
function LinkChip({ label, href, onPress }: { label: string; href: string; onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      {...linkProps(href, onPress)}
      accessibilityLabel={label}
      {...hover}
      style={[styles.linkChip, styles.billCardControl, hovered && styles.linkChipHover]}
    >
      <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
        <Path
          d="M4 8 H17 M13.5 4.5 L17 8 L13.5 11.5 M20 16 H7 M10.5 12.5 L7 16 L10.5 19.5"
          stroke={t.colors.brand.graphics}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={styles.linkChipText}>{label}</Text>
    </Pressable>
  );
}

// --- Ask chips (right rail) ---
// The chips route to the shipped grounded Ask (bill/topic), which cites the public record.
// The mock's literal person/vote chips ("what bills has this legislator led / how
// did they vote / which committees") refuse or deflect today — there is no
// person-scoped answer path (#484), so shipping them would violate grounded-
// answers rule 2 (chips must never lead to a refusal). Until #484 lands the chips
// stay topic-scoped and answerable.
function AskCard({ chips, onAsk }: { chips: string[]; onAsk: (q: string) => void }) {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" aria-level={2} style={styles.h3}>
        Ask about these issues
      </Text>
      <Text style={styles.askSubtext}>
        Topics from this legislator’s bills. Answers cite the public record.
      </Text>
      <View style={styles.askChipRow}>
        {chips.map((chip) => (
          <AskChip key={chip} label={chip} onPress={() => onAsk(chip)} />
        ))}
      </View>
    </View>
  );
}

function AskChip({ label, onPress }: { label: string; onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      {...hover}
      style={[styles.askChip, hovered && styles.askChipHover]}
    >
      <Text style={[styles.askChipText, hovered && styles.askChipTextHover]}>{label}</Text>
    </Pressable>
  );
}

function SeeMoreButton({ href, onPress }: { href: string; onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      {...externalLinkProps(href, onPress)}
      accessibilityLabel="See more chief-authored bills on the Revisor"
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
function SessionFilter({ currentSessionLabel }: { currentSessionLabel: string }) {
  const [open, setOpen] = useState(false);
  const [hovered, hover] = useHover();
  return (
    <View style={styles.sessionWrap}>
      <Pressable
        accessibilityRole="button"
        aria-expanded={open}
        onPress={() => setOpen((v) => !v)}
        {...hover}
        style={[styles.sessionBtn, hovered && styles.sessionBtnHover]}
      >
        <Text style={styles.sessionBtnText}>{currentSessionLabel}</Text>
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
              <Text style={styles.sessionActiveText}>{currentSessionLabel}</Text>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M5 12.5 L10 17.5 L19 7"
                  stroke={t.colors.brand.graphics}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
            {PAST_SESSIONS.map((session) => {
              const label = formatLegislatureLabel(session);
              return (
                <View key={label} style={styles.sessionPast}>
                  <Text style={styles.sessionPastText}>{label}</Text>
                  <LockIcon />
                </View>
              );
            })}
            <Text style={styles.sessionNote}>
              Past-session archives — including retired legislators — are on the roadmap
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
function SourceLink({
  label,
  href,
  onPress,
}: {
  label: string;
  href: string;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable {...externalLinkProps(href, onPress)} {...hover}>
      <Text style={[styles.sourceLink, hovered && styles.sourceLinkHover]}>{label}</Text>
    </Pressable>
  );
}

// --- On the roadmap zone (clearly not-live) ---
function RoadmapZone({ legislatorName, vote }: { legislatorName: string; vote?: LegislatorVote }) {
  const { isDesktop } = useResponsive();
  return (
    <View style={styles.roadmap}>
      <Text accessibilityRole="header" aria-level={2} style={styles.roadmapEyebrow}>
        ON THE ROADMAP
      </Text>
      <Text style={styles.roadmapSubtitle}>Features we plan to build.</Text>
      <View style={[styles.roadmapGrid, isDesktop && styles.roadmapGridDesktop]}>
        <View style={styles.dashedCard}>
          <Text accessibilityRole="header" aria-level={3} style={styles.roadmapH3}>
            Claim this profile
          </Text>
          <Text style={styles.roadmapBody}>
            Are you {legislatorName}? Claiming links you to this existing record, so you can manage
            your biography, write up the bills you’ve worked on, and add your own context. Verified
            against official legislative records.
          </Text>
          <ClaimPreview />
        </View>
        <View style={styles.dashedCard}>
          <Text accessibilityRole="header" aria-level={3} style={styles.roadmapH3}>
            Why the votes?
          </Text>
          <Text style={styles.roadmapBody}>
            Wonder why {legislatorName} voted that way? Once claimed, a legislator will have the
            option to explain any vote they cast — right here, in their own words, alongside the
            record.
          </Text>
          {vote ? <VoteExplanationPreview vote={vote} /> : null}
        </View>
      </View>
    </View>
  );
}

function ClaimPreview() {
  return (
    <span aria-disabled={true} style={claimPreviewStyle}>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
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
      <Text style={styles.claimBtnText}>Claim this profile</Text>
    </span>
  );
}

// The vote facts are real. Only the grey explanation lines are illustrative,
// because that future text has not been written.
function VoteExplanationPreview({ vote }: { vote: LegislatorVote }) {
  return (
    <View style={styles.votePreview}>
      <View style={styles.votePreviewHead}>
        <View style={styles.voteCheck}>
          <Text style={styles.voteCheckMark}>✓</Text>
        </View>
        <Text style={styles.voteYes}>{legislatorVoteLabel(vote.vote)}</Text>
        <Text style={styles.voteCode}>{vote.billCode}</Text>
        <Text style={styles.voteMeta}>
          {formatMonoDate(vote.date)} · {vote.chamber.toUpperCase()}
        </Text>
      </View>
      <View style={styles.voteSkeletonLines}>
        <View style={styles.voteSkeletonLineFull} />
        <View style={styles.voteSkeletonLineShort} />
      </View>
      <Text style={styles.voteExplLabel}>LEGISLATOR’S EXPLANATION</Text>
    </View>
  );
}

const CODE_BADGE_FILL = t.colors.omnibus.fill;
const CODE_BADGE_BORDER = t.colors.omnibus.border;
const claimPreviewStyle: CSSProperties = {
  alignSelf: 'flex-start',
  alignItems: 'center',
  backgroundColor: t.colors.tint.t150,
  border: `1px solid ${t.colors.tint.border}`,
  borderRadius: t.radii.md,
  color: t.colors.brand.deep,
  cursor: 'default',
  display: 'inline-flex',
  fontFamily: t.typography.ui,
  fontSize: 15,
  fontWeight: t.fontWeights.bold,
  gap: 9,
  marginTop: 18,
  padding: '12px 20px 12px 17px',
};

// Loading skeletons — mirror the hero (breadcrumb · portrait + identity) and the
// two-column body (record cards + contact sidebar), rendered inside the same
// SearchPageShell so the nav + back link appear instantly.
function LegislatorHeroSkeleton() {
  return (
    <View accessible accessibilityLabel="Loading legislator">
      <Skeleton width={110} height={16} style={styles.skHeroCrumb} />
      <Skeleton width={150} height={12} style={styles.skGap14} />
      <View style={styles.skIdentityRow}>
        <Skeleton width={128} height={146} radius={t.radii.card} />
        <View style={styles.skIdentityText}>
          <Skeleton width={260} height={32} radius={8} />
          <Skeleton width={200} height={16} style={styles.skGap14} />
        </View>
      </View>
    </View>
  );
}

function LegislatorBodySkeleton({ isDesktop }: { isDesktop: boolean }) {
  return (
    <View style={[styles.grid, isDesktop && styles.gridDesktop]}>
      <View style={styles.leftColumn}>
        <Skeleton width="100%" height={180} radius={t.radii.card} />
        <Skeleton width="100%" height={240} radius={t.radii.card} />
      </View>
      <View style={styles.rightColumn}>
        <Skeleton width="100%" height={220} radius={t.radii.card} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // skeleton loading state
  skHeroCrumb: { marginTop: 8, marginBottom: 18 },
  skGap14: { marginTop: 14 },
  skIdentityRow: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 20 },
  skIdentityText: { gap: 4, minWidth: 0, flexShrink: 1 },
  stateBox: { paddingVertical: 64, alignItems: 'center', justifyContent: 'center', gap: 12 },
  stateBoxSmall: { paddingVertical: 28, alignItems: 'center' },
  stateText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  // --- Hero ---
  backLink: { marginTop: 8 },
  eyebrow: {
    marginTop: 4,
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
    height: 166,
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
  partyPill: profilePartyBadgeAppearance.web.container,
  partyPillText: profilePartyBadgeAppearance.web.text,
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
    // RN-Web makes every View its own stacking context (position:relative,
    // z-index:0), so the session dropdown (inside sessionWrap here) can't escape
    // above the sibling bill list on z-index alone — this header row must sit
    // above billStack for the menu to overlay the first card.
    zIndex: 30,
  },
  billStack: { gap: 18, zIndex: 0 },
  billCard: {
    position: 'relative',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    paddingVertical: 26,
    paddingHorizontal: 32,
    ...(t.shadows.card as object),
  },
  billCardOverlay: {
    ...CARD_LINK_LAYER,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: t.radii.lg,
  },
  billCardContent: isWeb ? CARD_CONTENT_LAYER : {},
  billCardControl: CARD_CONTROL_LAYER,
  billCardHover: { borderColor: t.colors.alpha.ink16 },
  billTopRow: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  billTopSpacer: { flex: 1 },
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
    // Trailing chevron, so 3px less on the right (docs/design/design-principles.md §2, Optical centering).
    paddingLeft: 16,
    paddingRight: 13,
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
    // Trailing checkmark, so 3px less on the right (docs/design/design-principles.md §2, Optical centering).
    paddingLeft: 14,
    paddingRight: 11,
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
  // --- Legislative Service ---
  serviceStack: { gap: 12 },
  serviceRow: { fontFamily: t.typography.body, fontSize: 17, color: '#1a201d' },
  serviceLabel: { fontWeight: t.fontWeights.bold, color: t.colors.text.primary },
  // --- Bill-card link chips (companion / view votes) ---
  linkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 6,
    // Leading companion/votes glyph, so 3px less on the left (docs/design/design-principles.md §2, Optical centering).
    paddingLeft: 9,
    paddingRight: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: t.radii.sm,
  },
  linkChipHover: { borderColor: t.colors.brand.base },
  linkChipText: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.4,
    color: t.colors.brand.deep,
  },
  // --- Ask box (right rail) ---
  askSubtext: {
    marginTop: 8,
    fontFamily: t.typography.body,
    fontSize: 17,
    color: t.colors.text.faint,
  },
  askChipRow: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 9,
  },
  askChip: {
    // Cap at the row width so a long generated chip (e.g. "…retirement and
    // social security…") wraps its text to a second line instead of overflowing
    // the card, rather than sizing to its single-line intrinsic width.
    maxWidth: '100%',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink12,
    borderRadius: t.radii.pill,
    paddingVertical: 9,
    paddingHorizontal: 15,
  },
  askChipHover: { borderColor: t.colors.purple.base },
  askChipText: {
    fontFamily: t.typography.body,
    fontSize: 14,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.secondary,
  },
  askChipTextHover: { color: t.colors.purple.base },
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
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(17,21,15,0.22)',
    borderRadius: 16,
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
  claimBtnText: {
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  // vote-explanation preview (real vote facts, illustrative explanation)
  votePreview: {
    marginTop: 20,
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
  },
  voteCheckMark: { fontSize: 15, fontWeight: '800', color: t.colors.brand.graphics },
  votePreviewHead: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  voteYes: {
    fontFamily: t.typography.body,
    fontSize: 17,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  voteCode: {
    fontFamily: t.typography.mono,
    fontSize: 13,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.52,
    color: t.colors.omnibus.text,
    backgroundColor: CODE_BADGE_FILL,
    borderWidth: 1,
    borderColor: CODE_BADGE_BORDER,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 9,
    overflow: 'hidden',
  },
  voteMeta: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    letterSpacing: 0.55,
    color: '#6f756f',
  },
  voteSkeletonLines: { marginTop: 11, gap: 7 },
  voteSkeletonLineFull: { height: 9, borderRadius: 5, backgroundColor: '#eef0f1' },
  voteSkeletonLineShort: {
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
    color: '#6f756f',
  },
});
