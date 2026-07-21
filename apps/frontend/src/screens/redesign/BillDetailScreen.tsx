import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { Footer, PageBackground, TopNav } from '../../theme/primitives';
import { useResponsive } from '../../hooks/useResponsive';
import { titleCaseIssue } from '../../lib/issues';
import { IaItem, MenuKey } from '../../navigation/ia';
import { useAuth } from '../../providers/AuthProvider';
import { useBill, useSessions } from '../../hooks/useAppQueries';
import { Bill, BillAction, VoteEvent } from '../../data/types';
import { formatSessionLabel, SESSION_LABEL_FALLBACK } from '../../components/search/searchPieces';

// Bill Detail — mobile-first, single scrolling page (docs/mockups/bill-detail-mobile).
// Re-expressed in RN from the .dc.html literal values; support.js not ported.
//
// Data honesty (grounded-answers.md rules 1/4): the mock hardcodes party rosters
// and fabricates per-member votes. The API maps citations, questionPrompts, and
// per-member votes to empty (see api.ts mapBillDetail), and member-level rendering
// is deferred (#83). So this build shows only what the record truthfully carries:
// the roll-call tally + result + proportion bar (no member grid, no crossover, no
// fabricated party split), no per-point cited-sections strip (#377), no companion
// (#293). Those sections fill in when their backends ship.

const isWeb = Platform.OS === 'web';

// Amber treatments (README design tokens). Text uses the AA-safe #8f5a12 the
// token system already settled on (omnibus.text); the FILLED code badge and the
// GHOSTED omnibus/chapter tag are distinguished by fill, same hue.
const AMBER_TEXT = t.colors.omnibus.text; // #8f5a12
const CODE_BADGE_FILL = '#fbe7bd';
const CODE_BADGE_BORDER = '#eccf86';
const GHOST_AMBER_BORDER = '#e3c17f';

// Section ids for the sticky jump chips + scroll-spy.
const SECTIONS = [
  { id: 'summary', label: 'Summary' },
  { id: 'actions', label: 'Actions' },
  { id: 'votes', label: 'Votes' },
  { id: 'versions', label: 'Versions' },
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

function billLabelFromIdentifier(identifier: string): string {
  const prefix = identifier.trim().slice(0, 2).toUpperCase();
  if (prefix === 'SF') return 'SENATE BILL';
  if (prefix === 'HF') return 'HOUSE BILL';
  return 'BILL';
}

function partySpelledOut(party?: string): string {
  const p = (party ?? '').toUpperCase();
  if (p === 'DFL') return 'Democratic–Farmer–Labor';
  if (p === 'R' || p === 'REPUBLICAN') return 'Republican';
  if (p === 'I' || p === 'IND' || p === 'INDEPENDENT') return 'Independent';
  return party ? party : 'Independent';
}

// The facts-card status date: honest about what we have. Signed/enacted bills that
// carry an explicit "effective" action label read EFFECTIVE; everything else reads
// LATEST ACTION. We never invent an effective date the record doesn't state.
function statusDate(bill: Bill): { label: string; value: string } | null {
  const actionText = bill.latestActionText?.trim();
  const date = bill.updatedAt && bill.updatedAt !== 'Unknown' ? bill.updatedAt : '';
  const value = actionText || date;
  if (!value) return null;
  const effective = statusTone(bill.status) === 'green' && /effective/i.test(actionText ?? '');
  return { label: effective ? 'EFFECTIVE' : 'LATEST ACTION', value };
}

type Dot = 'green' | 'red' | 'vote' | 'scheduled' | 'plain';

// Dot taxonomy by what the action DOES, not by example (spec §Dot taxonomy).
// Derived from the description text since BillAction carries no kind field.
function classifyAction(a: BillAction, upcoming: boolean): { dot: Dot; isVote: boolean } {
  if (upcoming) return { dot: 'scheduled', isVote: false };
  const d = a.description.toLowerCase();
  const isVote =
    /\b(vote|roll call|third reading|repassed|concurred|passed the (house|senate)|passed (house|senate))\b/.test(
      d,
    );
  if (/\b(veto|failed|not adopted|rejected)\b/.test(d)) return { dot: 'red', isVote: false };
  if (/\b(signed|effective|enacted|chapter|became law)\b/.test(d)) return { dot: 'green', isVote };
  if (isVote) return { dot: 'vote', isVote: true };
  return { dot: 'plain', isVote: false };
}

// upcoming = actionDate parses to a date after the last-updated stamp. The action
// dates arrive pre-formatted; parse leniently and treat unparseable as not-upcoming.
function isUpcoming(dateStr: string, now: Date | null): boolean {
  if (!now) return false;
  const d = new Date(dateStr);
  return !Number.isNaN(d.getTime()) && d.getTime() > now.getTime();
}

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
      <Circle cx={12} cy={12} r={9} stroke={t.colors.brand.deep} strokeWidth={2} />
      <Path
        d="M8.5 12.2 L11 14.7 L15.7 9.6"
        stroke={t.colors.brand.deep}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// A tap/press-glowing text link (green, per the design's inline-link treatment).
function TextLink({
  label,
  onPress,
  size = 17,
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

export function BillDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { isSignedIn, signInWithGoogle } = useAuth();
  const { isMobile } = useResponsive();

  const params: Record<string, unknown> = route.params ?? {};
  const billId = typeof params.billId === 'string' ? params.billId : '';
  // Deep link: /bills/:id?tab=votes lands on that section (grounded-answers rule 5
  // — the section is URL-addressable). Applied once, when that section lays out.
  const initialTab = SECTIONS.some((s) => s.id === params.tab) ? (params.tab as SectionId) : null;

  const billQuery = useBill(billId);
  const bill = billQuery.data;

  const sessionsQuery = useSessions();
  const currentSession =
    sessionsQuery.data?.find((item) => item.isCurrent) ?? sessionsQuery.data?.[0];
  const sessionLabel = currentSession?.name
    ? formatSessionLabel(currentSession.name)
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
  });
  const [active, setActive] = useState<SectionId>('summary');
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
    navigation.navigate('Ask', q ? { q } : undefined);
  };

  // --- derived view model (only when the bill is loaded) ---
  const vm = useMemo(() => {
    if (!bill) return null;
    const now = bill.updatedAt && bill.updatedAt !== 'Unknown' ? new Date(bill.updatedAt) : null;
    const tone = statusTone(bill.status);
    const chief = (bill.sponsors ?? []).find((s) => s.role === 'chief_author');
    const keyPoints = bill.aiAnalysis?.keyPoints ?? [];
    const lede = bill.aiAnalysis?.summary?.trim() ?? '';
    const dateInfo = statusDate(bill);
    // Newest-first timeline (API returns chronological; reverse for display).
    const actions = [...bill.actions].reverse().map((a) => {
      const upcoming = a.date ? isUpcoming(a.date, now) : false;
      const { dot, isVote } = classifyAction(a, upcoming);
      return { ...a, upcoming, dot, isVote };
    });
    const hasVotes = bill.votes.length > 0;
    return { tone, chief, keyPoints, lede, dateInfo, actions, hasVotes };
  }, [bill]);

  const shellProps = {
    variant: 'page' as const,
    openMenu,
    onOpenMenuChange: setOpenMenu,
    onNavigate: handleNavigate,
    onHome: () => navigation.navigate('Tabs', { screen: 'Home' }),
    onSignIn: () => void signInWithGoogle(),
    onAsk: () => navigation.navigate('Ask'),
  };

  return (
    <PageBackground>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {/* 0 — top nav (scrolls away) */}
        <TopNav {...shellProps} />

        {billQuery.isLoading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={t.colors.brand.base} />
            <Text style={styles.stateText}>Loading bill…</Text>
          </View>
        ) : billQuery.isError || !bill || !vm ? (
          <View style={styles.stateBox}>
            <Text style={styles.stateText}>
              We couldn’t load this bill right now. Please try again in a moment.
            </Text>
            <TextLink label="Back to all bills →" onPress={() => navigation.navigate('Bills')} />
          </View>
        ) : (
          <>
            {/* 1 — bill header */}
            <View style={styles.headerOuter}>
              {isWeb ? <View pointerEvents="none" style={styles.headerDots} /> : null}
              <View style={styles.column}>
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
                  </View>
                  <ShareButton onPress={() => setShareOpen(true)} />
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

            {/* 3 — Summary */}
            <Section id="summary" onLayout={onSectionLayout}>
              <Text accessibilityRole="header" style={styles.h2}>
                Key points
              </Text>
              {vm.lede ? <Text style={styles.lede}>{vm.lede}</Text> : null}
              {vm.keyPoints.length > 0 ? (
                <View style={styles.points}>
                  {vm.keyPoints.map((point, i) => (
                    <View key={i} style={styles.pointRow}>
                      <View style={styles.pointBullet} />
                      <Text style={styles.pointText}>{point}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Facts card */}
              <View style={styles.factsCard}>
                {vm.dateInfo ? (
                  <View style={styles.factsBlock}>
                    <Text style={styles.factsLabel}>{vm.dateInfo.label}</Text>
                    <Text style={styles.factsValue}>{vm.dateInfo.value}</Text>
                  </View>
                ) : null}

                <View style={[styles.factsBlock, styles.factsDivider]}>
                  <Text style={styles.factsLabel}>{billLabelFromIdentifier(bill.identifier)}</Text>
                  <View style={styles.codeBadgeWrap}>
                    <Text style={styles.codeBadge}>{bill.identifier}</Text>
                  </View>
                  <View style={styles.factsLinks}>
                    {bill.officialLinks.length > 0 ? (
                      <TextLink
                        label={vm.tone === 'green' ? 'Read the full law →' : 'Read the bill text →'}
                        onPress={() => openExternal(bill.officialLinks[0].url)}
                      />
                    ) : null}
                    {bill.officialLinks.slice(1).map((link) => (
                      <TextLink
                        key={link.id}
                        label={`${link.label} →`}
                        onPress={() => openExternal(link.url)}
                      />
                    ))}
                  </View>
                </View>

                {vm.chief ? (
                  <View style={[styles.factsBlock, styles.factsDivider]}>
                    <View style={styles.factsHeaderRow}>
                      <Text style={styles.factsLabel}>CHIEF AUTHOR</Text>
                      {typeof bill.coAuthorCount === 'number' && bill.coAuthorCount > 0 ? (
                        <Text style={styles.coauthors}>+{bill.coAuthorCount} co-authors</Text>
                      ) : null}
                    </View>
                    {vm.chief.legislatorId ? (
                      <View style={styles.authorNameRow}>
                        <TextLink
                          label={`${vm.chief.name} →`}
                          size={19}
                          onPress={() =>
                            navigation.navigate('LegislatorProfile', {
                              legislatorId: vm.chief!.legislatorId,
                            })
                          }
                        />
                      </View>
                    ) : (
                      <Text style={styles.authorNamePlain}>{vm.chief.name}</Text>
                    )}
                    <View style={styles.factsRows}>
                      <View style={styles.factsKvRow}>
                        <Text style={styles.factsKvKey}>Party</Text>
                        <Text style={styles.factsKvVal}>{partySpelledOut(vm.chief.party)}</Text>
                      </View>
                      {vm.chief.district ? (
                        <View style={styles.factsKvRow}>
                          <Text style={styles.factsKvKey}>District</Text>
                          <Text style={styles.factsKvVal}>{vm.chief.district}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {bill.topics.length > 0 ? (
                  <View style={[styles.factsBlock, styles.factsDivider]}>
                    <Text style={styles.factsLabel}>ISSUES</Text>
                    <View style={styles.issueRow}>
                      {bill.topics.slice(0, 6).map((topic) => (
                        <View key={topic} style={styles.issueChip}>
                          <Text style={styles.issueChipText}>{titleCaseIssue(topic)}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>

              {/* Ask about this bill */}
              <AskCard placeholder="Ask a question about this bill" onAsk={goAsk} />
            </Section>

            {/* 4 — Actions */}
            <Section id="actions" onLayout={onSectionLayout}>
              <Text accessibilityRole="header" style={styles.h2}>
                Actions
              </Text>
              <Text style={styles.intro}>Every official step this bill has taken.</Text>
              <ActionLegend />
              {vm.actions.length > 0 ? (
                <View style={styles.timeline}>
                  {/* action_number isn't unique in the source data, so a.id can
                      collide — index-suffix the key to keep it stable + unique. */}
                  {vm.actions.map((a, i) => (
                    <ActionRow
                      key={`${a.id}-${i}`}
                      action={a}
                      onViewVotes={a.isVote && vm.hasVotes ? () => jumpTo('votes') : undefined}
                    />
                  ))}
                </View>
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
                <>
                  <Text style={styles.intro}>
                    Each recorded <Text style={styles.introStrong}>roll call</Text> and how it
                    resolved.
                  </Text>
                  <View style={styles.rollList}>
                    {bill.votes.map((v) => (
                      <RollCard key={v.id} vote={v} />
                    ))}
                  </View>
                  {/* Member-by-member breakdown is deferred (#83): the record's
                      per-member votes aren't rendered in-app yet, so we show the
                      tally + result only rather than fabricate a member grid. */}
                </>
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
                    No floor votes yet
                  </Text>
                  <Text style={styles.noVotesBody}>
                    {bill.identifier} hasn’t had a recorded roll-call vote. Roll calls appear here
                    when a chamber votes.
                  </Text>
                </View>
              )}
            </Section>

            {/* 6 — Versions */}
            <Section id="versions" onLayout={onSectionLayout} style={styles.lastSection}>
              <Text accessibilityRole="header" style={styles.h2}>
                Versions
              </Text>
              <Text style={styles.intro}>
                A bill’s exact wording changes as it moves through the Legislature. Each version is
                a snapshot of the full text at one stage.
              </Text>
              {bill.versions.length > 0 ? (
                <View style={styles.versionList}>
                  {bill.versions.map((v, i) => (
                    <VersionRow
                      key={`${v.id}-${i}`}
                      label={v.label}
                      date={v.date}
                      isLaw={vm.tone === 'green' && /session law|chapter/i.test(v.label)}
                      onPress={v.url ? () => openExternal(v.url) : undefined}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyLine}>No published versions yet.</Text>
              )}
              <Text style={styles.sourceLine}>Source: Minnesota Legislature · revisor.mn.gov</Text>
            </Section>

            <Footer
              onPrivacy={() => navigation.navigate('Privacy')}
              onTerms={() => navigation.navigate('Terms')}
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

      {/* NOTE: the design's "your legislators voted" sign-in bottom sheet is
          intentionally not built yet — it advertises per-member roll-call reveal,
          which is deferred (#83). Adding it would advertise an unshippable
          capability (grounded-answers.md rule 2). Sign-in stays available via the
          top nav. Wire this sheet + the votes teaser together when #83 ships. */}
    </PageBackground>
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
      accessibilityState={{ selected: active }}
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

function ActionRow({
  action,
  onViewVotes,
}: {
  action: BillAction & { upcoming: boolean; dot: Dot };
  onViewVotes?: () => void;
}) {
  const dotStyle = (() => {
    switch (action.dot) {
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
        {action.date ? <Text style={styles.actionDate}>{action.date.toUpperCase()}</Text> : null}
        <View style={styles.actionTitleRow}>
          <Text style={[styles.actionTitle, action.upcoming && { color: t.colors.text.faint }]}>
            {action.description}
          </Text>
          {action.upcoming ? (
            <View style={styles.scheduledBadge}>
              <Text style={styles.scheduledBadgeText}>SCHEDULED</Text>
            </View>
          ) : null}
        </View>
        {onViewVotes ? <TextLink label="View votes →" size={15} onPress={onViewVotes} /> : null}
      </View>
    </View>
  );
}

function RollCard({ vote }: { vote: VoteEvent }) {
  const yes = vote.breakdown.yes;
  const no = vote.breakdown.no;
  const total = yes + no + (vote.breakdown.absent || 0);
  const passed = /pass|adopt|prevail|agreed/i.test(vote.result);
  const failed = /fail|not adopt|reject|lost/i.test(vote.result);
  const yesPct = total > 0 ? Math.round((yes / total) * 100) : 0;
  const noPct = total > 0 ? Math.round((no / total) * 100) : 0;
  return (
    <View style={styles.rollCard}>
      <View style={styles.rollHeaderRow}>
        <View style={styles.rollHeaderLeft}>
          <Text style={styles.rollMotion}>{vote.motion}</Text>
          {vote.date ? <Text style={styles.rollMeta}>{vote.date.toUpperCase()}</Text> : null}
        </View>
        <Text style={styles.rollTally}>
          {yes}–{no}
        </Text>
      </View>
      <View style={styles.rollBarRow}>
        {passed ? (
          <View style={styles.passedPill}>
            <Text style={styles.passedPillText}>PASSED</Text>
          </View>
        ) : failed ? (
          <View style={styles.failedPill}>
            <Text style={styles.failedPillText}>FAILED</Text>
          </View>
        ) : vote.result ? (
          <View style={styles.resultPill}>
            <Text style={styles.resultPillText}>{vote.result.toUpperCase()}</Text>
          </View>
        ) : null}
        <View style={styles.rollBar}>
          <View style={[styles.rollBarYes, { flexGrow: yesPct }]} />
          <View style={[styles.rollBarNo, { flexGrow: noPct }]} />
        </View>
      </View>
    </View>
  );
}

function VersionRow({
  label,
  date,
  isLaw,
  onPress,
}: {
  label: string;
  date: string;
  isLaw: boolean;
  onPress?: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole={onPress ? 'link' : undefined}
      accessibilityLabel={`${isLaw ? 'Read the full law' : 'Read the bill text'} — ${label}`}
      disabled={!onPress}
      onPress={onPress}
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
          ) : null}
        </View>
        {date ? <Text style={styles.versionDate}>{date}</Text> : null}
      </View>
      {onPress ? (
        <Text style={styles.versionLink}>
          {isLaw ? 'Read the full law →' : 'Read the bill text →'}
        </Text>
      ) : null}
    </Pressable>
  );
}

function AskCard({ placeholder, onAsk }: { placeholder: string; onAsk: (q?: string) => void }) {
  const { focused, focusProps } = useFieldFocus();
  const [q, setQ] = useState('');
  return (
    <View style={styles.askCard}>
      <Text accessibilityRole="header" style={styles.askTitle}>
        Ask about this bill
      </Text>
      <Text style={styles.askSub}>No account needed — answers cite the bill text.</Text>
      <View style={[styles.askField, ...fieldFocusRing(focused)]}>
        <TextInput
          value={q}
          onChangeText={setQ}
          onFocus={focusProps.onFocus}
          onBlur={focusProps.onBlur}
          onSubmitEditing={() => onAsk(q.trim() || undefined)}
          returnKeyType="search"
          placeholder={placeholder}
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
  scroll: { flex: 1 },
  stateBox: { paddingVertical: 80, paddingHorizontal: 20, alignItems: 'center', gap: 14 },
  stateText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    color: t.colors.text.muted,
    textAlign: 'center',
  },

  // shared column
  column: { width: '100%', maxWidth: COLUMN_MAX, alignSelf: 'center', paddingHorizontal: 20 },

  // header
  headerOuter: { position: 'relative', paddingTop: 8, paddingBottom: 18 },
  headerDots: {
    ...(StyleSheet.absoluteFillObject as object),
    ...(isWeb
      ? ({
          backgroundImage: t.gradients.dotInk,
          backgroundSize: '30px 30px',
          maskImage:
            'linear-gradient(to bottom, transparent 0px, #000 40px, #000 calc(100% - 20px), transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0px, #000 40px, #000 calc(100% - 20px), transparent 100%)',
        } as object)
      : null),
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
  sectionOuter: { paddingTop: 28, paddingBottom: 8 },
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
  coauthors: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    color: t.colors.text.faint,
  },
  authorNameRow: { marginTop: 11, flexDirection: 'row' },
  authorNamePlain: {
    marginTop: 11,
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.subheadLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  factsRows: { marginTop: 10, gap: 7 },
  factsKvRow: { flexDirection: 'row', gap: 12 },
  factsKvKey: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: t.colors.text.faint,
    minWidth: 64,
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
    fontSize: t.fontSizes.lg,
    color: t.colors.text.primary,
    paddingVertical: 14,
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
  rollBarRow: { marginTop: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  resultPill: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 7,
    backgroundColor: t.colors.surfaces.s400,
  },
  resultPillText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.5,
    color: t.colors.text.secondary,
  },
  rollBar: {
    flex: 1,
    flexDirection: 'row',
    height: 9,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: t.colors.status.progressEmpty,
  },
  rollBarYes: { backgroundColor: t.colors.brand.base },
  rollBarNo: { backgroundColor: t.colors.status.vetoedStep },

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
  versionDate: {
    marginTop: 2,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    letterSpacing: 0.5,
    color: t.colors.text.faint,
  },
  versionLink: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  sourceLine: {
    marginTop: 24,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    color: t.colors.text.faint,
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
