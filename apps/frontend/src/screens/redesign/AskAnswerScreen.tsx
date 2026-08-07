import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme } from '../../theme/tokens';
import { ResultsHeader, SearchPageShell, SortControl } from '../../components/search/searchPieces';
import { BillResultCard } from '../../components/search/BillResultCard';
import { CitationCard, SuggestedQuestionChip } from '../../components/billDetail/CitationCard';
import { SourceLine } from '../../components/billDetail/SourceLine';
import { Skeleton } from '../../components/Skeleton';
import { IaItem, MenuKey } from '../../navigation/ia';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import { RootScreenProps } from '../../navigation/types';
import { useAuth } from '../../providers/AuthProvider';
import { useResponsive } from '../../hooks/useResponsive';
import {
  useAskAnswer,
  useBill,
  useBillVersionText,
  useLegislators,
} from '../../hooks/useAppQueries';
import { BillTrackButton } from '../../components/billDetail/BillTrackButton';
import { useBillTracking } from '../../hooks/useBillTracking';
import { SharePopover } from '../../components/billDetail/SharePopover';
import { bienniumEyebrow, pulledLabel, scopedChipQuery } from '../../lib/billDetail';
import {
  alphabeticalIndex,
  citedSections,
  followUpPrompts,
  parseAnswerBlocks,
  partialCoverageNote,
  passageTarget,
} from '../../lib/askAnswer';
import {
  ISSUE_ANSWER_SORT_OPTIONS,
  issueAnswerBills,
  issueAnswerFollowUps,
  issueAnswerUpdatedLabel as formatIssueAnswerUpdatedLabel,
  resolveIssueAnswerSort,
} from '../../lib/issueAnswer';
import {
  citationSectionAnchor,
  parseSectionAnchor,
  resolveSectionAnchor,
  sectionAnchorId,
} from '../../lib/billText';
import { STICKY_RAIL, useHover } from '../../components/billDetail/interactions';
import { AskAnswerBill, AskAnswerLegislator } from '../../data/types';

const t = theme;
const isWeb = Platform.OS === 'web';

// The chip-reached Ask answer page. Spec of record:
// docs/product-onboarding/grounded-ask-spec.md §9.5 (The chip-reached answer page —
// decided web design), which supersedes §9.1–§9.2 for the bill_text state; design
// handoff in docs/mockups/answer-web/.
//
// The bill-text state uses the two-column passage design from §9.5. The issue
// state is the separate full-width, sortable bill-list design from §9.6. Both
// share the question/session header, Share control, source line, and shell.
//
// Deliberately NO question field, Ask button or composer, and nothing gated on
// sign-in: a suggested chip on Bill Detail is the only way in, so an answer here
// can never be a refusal someone typed themselves (§9.5 Scope, with #832).
// The nav's Sign in button stays — it is global chrome.
//
// Every piece is shared with the screen it came from rather than re-implemented:
// the bill card is Search Bills' `BillResultCard`, the cited-section cards and the
// chips are Bill Detail's `CitationCard` / `SuggestedQuestionChip`, Share is Bill
// Detail's `SharePopover`, and the sticky rail and source line are its
// `STICKY_RAIL` and `SourceLine`.

// Status text colors mirror the v2 bill cards (HomeSignedOutScreen).
function statusColor(statusKey?: string) {
  if (statusKey === 'signed_into_law') {
    return t.colors.brand.deep;
  }
  if (statusKey === 'vetoed') {
    return t.colors.status.vetoedText;
  }
  return t.colors.text.secondary;
}

// §4.7 follow-up chips — cross-intent templates filled from the *resolved*
// topic, so they are non-refusable by construction (rule 1): the topic already
// matched, so the target path returns results. A topic answer bridges to the
// other topic path. bill_text answers don't use these: they offer the answering
// bill's own stored questions instead (§9.5 decision 7, `followUpPrompts`).
function crossIntentChips(intent?: string, topic?: string): { label: string; submit: string }[] {
  if (!topic) {
    return [];
  }
  if (intent === 'topic_bills') {
    const submit = `Which legislators authored ${topic} bills?`;
    return [{ label: submit, submit }];
  }
  if (intent === 'topic_legislators') {
    const submit = `What other ${topic} bills are there?`;
    return [{ label: submit, submit }];
  }
  return [];
}

function FollowUpChips({
  chips,
  onAsk,
}: {
  chips: { label: string; submit: string }[];
  onAsk: (submit: string) => void;
}) {
  const { isMobile } = useResponsive();
  if (chips.length === 0) {
    return null;
  }
  return (
    <View style={styles.followupBlock}>
      <Text
        accessibilityRole="header"
        aria-level={2}
        style={[styles.followupHeading, isMobile && styles.followupHeadingMobile]}
      >
        Ask another question
      </Text>
      <View style={styles.chipRow}>
        {chips.map((chip) => (
          <SuggestedQuestionChip
            key={chip.submit}
            label={chip.label}
            linkProps={linkProps(routePath.ask({ q: chip.submit }), () => onAsk(chip.submit))}
          />
        ))}
      </View>
    </View>
  );
}

function AnswerBillCard({
  bill,
  onOpen,
  tracked,
  onToggleTrack,
}: {
  bill: AskAnswerBill;
  onOpen: () => void;
  tracked: boolean;
  onToggleTrack: () => void;
}) {
  // RN-Web drops the DOM `title` prop, so set the tooltip on the host node.
  const titleRef = useRef<Text>(null);
  useEffect(() => {
    if (isWeb && titleRef.current) {
      (titleRef.current as unknown as HTMLElement).title = bill.title;
    }
  }, [bill.title]);
  return (
    <View style={[styles.billCard, t.shadows.card as object]}>
      <View style={styles.billCardTop}>
        <View style={styles.billCardTopLeft}>
          <View style={styles.billBadge}>
            <Text style={styles.billBadgeText}>{bill.identifier}</Text>
          </View>
          <Text style={[styles.billStatus, { color: statusColor(bill.statusKey) }]}>
            {bill.status}
          </Text>
          {/* Served only for a bill outside the Legislature's regular session, so
              two cards both reading "HF 5" can be told apart — they are different
              laws (#810). Same vocabulary as every other session label on the site
              (2025 FIRST SPECIAL SESSION), through the same helper. */}
          {bill.sessionName ? (
            <Text style={styles.billSessionTag}>{bienniumEyebrow(bill.id, bill.sessionName)}</Text>
          ) : null}
        </View>
        {/* Live Track button, consistent site-wide (#976). The card is a View, not
            a link wrapper, so no press-swallowing is needed here. */}
        <BillTrackButton size="card" tracked={tracked} onPress={onToggleTrack} />
      </View>
      {/* The PLAIN title, with the statutory one kept as a hover tooltip and the
          screen-reader name — the treatment BillHeader and the search card already
          use (.claude/rules/grounded-answers.md rule 10). HF 719's official title
          is eleven lines of statute citations, and this card was printing all of
          them on the vote deflection. */}
      <Text
        ref={titleRef}
        style={styles.billTitle}
        accessibilityLabel={bill.title}
        numberOfLines={bill.shortTitle ? undefined : 2}
      >
        {bill.shortTitle ?? bill.title}
      </Text>
      {bill.summary ? <Text style={styles.billSummary}>{bill.summary}</Text> : null}
      <Pressable
        {...linkProps(routePath.bill(bill.id), onOpen)}
        accessibilityLabel={`View bill ${bill.identifier}`}
      >
        <Text style={styles.viewBillLink}>View bill →</Text>
      </Pressable>
    </View>
  );
}

function AnswerLegislatorRow({
  legislator,
  onOpenProfile,
  onOpenBill,
}: {
  legislator: AskAnswerLegislator;
  onOpenProfile: () => void;
  onOpenBill: (billId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const partyDistrict = [
    legislator.party,
    legislator.district ? `District ${legislator.district}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const counts = [
    legislator.authoredCount ? `Authored ${legislator.authoredCount}` : null,
    legislator.coauthoredCount ? `Co-authored ${legislator.coauthoredCount}` : null,
  ].filter(Boolean);
  const billCount = legislator.bills.length;

  return (
    <View style={styles.legRow}>
      <View style={styles.legRowTop}>
        <View style={styles.legNameCol}>
          <Text style={styles.legName}>{legislator.fullName}</Text>
          {partyDistrict ? <Text style={styles.legMeta}>{partyDistrict}</Text> : null}
        </View>
        <Pressable
          {...linkProps(routePath.legislator(legislator.slug ?? legislator.id), onOpenProfile)}
          accessibilityLabel={`View profile for ${legislator.fullName}`}
        >
          <Text style={styles.viewBillLink}>View profile →</Text>
        </Pressable>
      </View>
      <Text style={styles.legCounts}>{counts.join(' · ')}</Text>
      {/* The underlying bills are the citation for the authorship claim. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Hide' : 'Show'} the ${billCount} ${billCount === 1 ? 'bill' : 'bills'} ${legislator.fullName} is on the record for`}
        onPress={() => setExpanded((value) => !value)}
      >
        <Text style={styles.onRecordToggle}>
          On the record: {billCount} {billCount === 1 ? 'bill' : 'bills'} {expanded ? '▾' : '▸'}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={styles.billPillsRow}>
          {legislator.bills.map((bill) => (
            <Pressable
              key={bill.id}
              {...linkProps(routePath.bill(bill.id), () => onOpenBill(bill.id))}
              accessibilityLabel={`View ${bill.identifier}`}
            >
              <View style={styles.billPill}>
                <Text style={styles.billPillText}>{bill.identifier}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// "← Back to HF 719". Required, not decorative: a chip on Bill Detail is the only
// way onto this page, so the way back has to be on it (§9.5 Layout). The target
// comes from the ANSWERING BILL in the payload, never from reading the question
// text — so it is right even when the bill was resolved by meaning rather than by
// name (§9.5 decision 10 / issue #859 task 10).
function BackToBill({
  identifier,
  billId,
  onPress,
}: {
  identifier: string;
  billId: string;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  const color = hovered ? t.colors.ink : BACK_LINK_GREY;
  return (
    <Pressable
      accessibilityLabel={`Back to ${identifier}`}
      {...linkProps(routePath.bill(billId), onPress)}
      {...hover}
      style={styles.backLink}
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
      <Text style={[styles.backLinkLabel, { color }]}>Back to {identifier}</Text>
    </Pressable>
  );
}

export function AskAnswerScreen({ navigation, route }: RootScreenProps<'Ask'>) {
  const question = route.params?.q?.trim() ?? '';
  const { isTracked, toggleTrack } = useBillTracking();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [issueSortOpen, setIssueSortOpen] = useState(false);
  const { isDesktop, isMobile } = useResponsive();

  const askQuery = useAskAnswer(question);

  // §4.6 — the placeholder's "name" entry point. A query that resolves to a
  // single legislator name is records navigation, so redirect to that profile
  // instead of running it through the cite-or-refuse answer path. Reuses the
  // existing directory search (GET /legislators?q=); multiple or zero matches
  // fall through to the normal answer below.
  const nameQuery = useLegislators(question);
  const nameMatch = nameQuery.data && nameQuery.data.length === 1 ? nameQuery.data[0] : undefined;
  const resolvingName = Boolean(question) && (nameQuery.isLoading || Boolean(nameMatch));

  // Exception to "no routing into old-design pages": this redirect is load-
  // bearing for resolvingName above — skipping it would leave a name query
  // spinning forever instead of landing on a (currently old-design) profile.
  useEffect(() => {
    if (nameMatch) {
      navigation.replace('LegislatorProfile', { legislatorId: nameMatch.slug ?? nameMatch.id });
    }
  }, [nameMatch, navigation]);

  const answer = askQuery.data;
  const isLegislators = answer?.intent === 'topic_legislators';
  const compactBills = answer?.bills ?? [];
  const shownLegislators = answer?.legislators ?? [];
  const hasMatches = Boolean(answer?.hasAnswer && answer.totalMatches > 0);
  const noMatches = Boolean(answer?.hasAnswer && answer.totalMatches === 0);
  const followUpChips =
    answer?.intent === 'topic_bills' && answer.topic
      ? issueAnswerFollowUps(answer.topic)
      : crossIntentChips(answer?.intent, answer?.topic);
  const issueSort = resolveIssueAnswerSort(route.params?.sort);
  const shownIssueBills = issueAnswerBills(
    answer?.billCards ?? [],
    answer?.latestActionBillCards ?? [],
    issueSort,
  );
  const issueAnswerUpdatedLabel = formatIssueAnswerUpdatedLabel(answer?.dataAsOf);
  const isIssueAnswer = Boolean(
    answer?.intent === 'topic_bills' && answer.hasAnswer && !answer.ambiguousReference,
  );

  // legislator_vote → the v1 honest vote deflection (§4.5 / §9.4): never a vote
  // answer. A resolved bill deep-links its Votes tab; otherwise it degrades to
  // the topic_bills list. hasAnswer is true, so this sits outside `pending`.
  const isVoteDeflection = answer?.intent === 'legislator_vote';
  const resolvedBill = answer?.resolvedBill;

  // bill_text → the §9.5 single-bill answer: the prose, the answering bill's card,
  // its remaining suggested questions, and the cited-section rail.
  const isBillText = answer?.intent === 'bill_text';
  const answeringBill = answer?.answeringBill;
  const citations = answer?.citations ?? [];

  // The answering bill is fetched in full rather than reshaped out of the Ask
  // payload, because four things on this page come from the bill record and not
  // from the answer: BillResultCard needs a whole `Bill`, "Ask another question"
  // needs the bill's stored question_prompts, the card's Effective line needs the
  // verified statutory date, and the source line needs the bill's OWN record date
  // (§9.5 decision 8a — never the Ask payload's corpus-wide `data_as_of`).
  const answeringBillId = answeringBill?.id ?? '';
  const billQuery = useBill(answeringBillId, { enabled: Boolean(answeringBillId) });
  const bill = billQuery.data;

  // The sections the Bill Text tab actually renders, so a cited section is only
  // linked to when its anchor really resolves there (see `passageTarget`).
  const currentVersion = bill?.versions.find((v) => v.isCurrent) ?? bill?.versions[0];
  const textQuery = useBillVersionText(bill?.id, currentVersion?.versionCode);
  const renderedSections = textQuery.data ?? [];
  const sectionsLoaded = textQuery.isSuccess;

  const sections = useMemo(() => citedSections(citations), [citations]);
  const answerBlocks = useMemo(() => parseAnswerBlocks(answer?.billText ?? ''), [answer?.billText]);
  const coverageNote = partialCoverageNote(answer?.coverage);
  // Held back until the bill's own prompts have landed. Rendered eagerly, the
  // block showed the generic fallback chips for the ~300ms the bill fetch takes
  // and then swapped all three for the bill's own — a visible flicker on the one
  // control the reader is being invited to use.
  const chips = useMemo(
    () => (billQuery.isPending ? [] : followUpPrompts(bill?.questionPrompts, question)),
    [billQuery.isPending, bill?.questionPrompts, question],
  );

  // House first, then Senate — drop empty chambers (spec §9.4).
  const chamberGroups = useMemo(
    () =>
      (
        [
          ['house', 'House'],
          ['senate', 'Senate'],
        ] as const
      )
        .map(([key, label]) => ({
          key,
          label,
          legislators: shownLegislators.filter((leg) => leg.chamber === key),
        }))
        .filter((group) => group.legislators.length > 0),
    [shownLegislators],
  );

  // States with no rendered answer body — out-of-scope refusal, or a bill_text
  // question we couldn't pin to a single bill (cite-or-refuse, §4.5): honest
  // copy, never a false "on the way" promise (.claude/rules/grounded-answers.md
  // rule 2). legislator_vote and answered bill_text render their own blocks below.
  const pending =
    answer?.intent === 'refuse'
      ? {
          eyebrow: 'OUT OF SCOPE',
          muted: true,
          body: 'Alethical answers questions about Minnesota bills, legislators, and votes. This one falls outside that — so we won’t guess.',
          cta: 'Browse Minnesota bills in Search →',
        }
      : {
          eyebrow: 'NO BILL MATCHED',
          muted: true,
          body: 'We couldn’t match this to a single Minnesota bill’s text. Try naming the bill, or browse bills by issue in Search.',
          cta: 'Browse bills in Search →',
        };

  // §4.7 rule 4: follow-up chips fire their fully-qualified submit directly
  // (not populate — that is hero-only). Re-runs the Ask in place, updating ?q=.
  const askFollowUp = (submit: string) => {
    navigation.setParams({ q: submit, sort: undefined });
  };

  const selectIssueSort = (key: string) => {
    const sort = resolveIssueAnswerSort(key);
    navigation.setParams({ sort: sort === 'progress' ? undefined : sort });
  };

  const openBill = (billId: string) => navigation.navigate('BillDetail', { billId });
  const openVotes = (billId: string) => navigation.navigate('BillDetail', { billId, tab: 'votes' });

  // Mirrors HomeSignedOutScreen's handler: only the shipped rows navigate.
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
        navigation.navigate('Tabs', { screen: 'Tracked' });
        return;
      default:
        return;
    }
  };

  // The bill the back link returns to: the answering bill on a bill_text answer,
  // the resolved bill on a vote deflection. Both come from the payload.
  const backBill = answeringBill ?? resolvedBill;
  // Share is on the answered states only (§9.2). The deflection's CTA already
  // routes to the shareable artifact, and a refusal has nothing to share.
  const showShare = Boolean(answer?.hasAnswer) && !isVoteDeflection;
  const shareUrl =
    isWeb && typeof window !== 'undefined'
      ? window.location.href
      : `https://alethical.com${routePath.ask({ q: question })}`;
  // From the existing helper, not the served session name ("94th Legislature
  // (2025 - 2026) Regular Session") — one vocabulary on every page (§9.5
  // decision 8). No date here: the page's single date is the source line
  // (§9.5 decision 8a, docs/design/ui-copy-guide.md § Dates on a page).
  // The BILL's own session wins over the answer-wide one. The answer-wide field
  // names the ground the search covered (the Legislature); this line sits under the
  // answer to one bill, and printing "2025–2026 Legislative Session" above an answer
  // about a special-session law states the wrong session for it (#810).
  const sessionLine = backBill
    ? bienniumEyebrow(backBill.id, backBill.sessionName ?? answer?.sessionName)
    : bienniumEyebrow('', answer?.sessionName);
  // The answering bill's OWN date, through the SAME helper the bill's page uses, so
  // the two pages cannot print different dates for one bill — which is the binding
  // half of §9.5 decision 8a. It reads "when we last pulled this bill", not when the
  // Legislature last acted on it (#861 / #875); building the label here from
  // `updatedAt` would have quietly reverted this page to the older meaning.
  const updatedLabel = bill ? pulledLabel(bill) : '';

  // An eyebrow only where it is load-bearing: it separates an honest empty state
  // or a deflection from a real answer. An ANSWERED page carries none — the
  // question is the heading and the answer sits right under it (§9.5 Layout; the
  // handoff draws no eyebrow).
  //
  // isBillText is checked BEFORE noMatches, and must be: `totalMatches` counts
  // matching bills for a TOPIC answer and is always 0 on a bill_text answer, so
  // the other order labelled every single-bill answer "NO MATCHES". The render
  // chain below already had this order; the eyebrow did not.
  // Nothing until the answer lands: `pending` is the refusal copy, so computing an
  // eyebrow from a not-yet-arrived answer printed "NO BILL MATCHED" over the
  // loading skeleton of a question that answers perfectly well.
  const eyebrow = !answer
    ? null
    : !answer.hasAnswer
      ? { text: pending.eyebrow, muted: true, comingSoon: false }
      : isVoteDeflection
        ? { text: 'ANSWER', muted: false, comingSoon: true }
        : isBillText
          ? null
          : noMatches
            ? { text: 'NO MATCHES', muted: true, comingSoon: false }
            : null;

  const hero = question ? (
    <View style={[styles.header, isIssueAnswer && styles.headerIssueAnswer]}>
      <View style={styles.headerMain}>
        {backBill ? (
          <BackToBill
            identifier={backBill.identifier}
            billId={backBill.id}
            onPress={() => openBill(backBill.id)}
          />
        ) : null}
        {eyebrow ? (
          <View style={styles.eyebrowRow}>
            <Text style={[styles.eyebrow, eyebrow.muted && styles.eyebrowMuted]}>
              {eyebrow.text}
            </Text>
            {eyebrow.comingSoon ? (
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonBadgeText}>COMING SOON</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <Text accessibilityRole="header" style={styles.h1}>
          {question}
        </Text>
        {sessionLine ? <Text style={styles.sessionLine}>{sessionLine}</Text> : null}
      </View>
      {showShare ? <SharePopover url={shareUrl} title={question} subject="answer" /> : null}
    </View>
  ) : null;

  const shell = (children: React.ReactNode) => (
    <SearchPageShell
      openMenu={openMenu}
      onOpenMenuChange={setOpenMenu}
      onNavigate={handleNavigate}
      onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
      onPrivacy={() => navigation.navigate('Privacy')}
      onTerms={() => navigation.navigate('Terms')}
      hero={hero}
      // The header ends in its own hairline, so the white panel's 40px top padding
      // is the whole gap below it. Left stacked with the hero's own bottom padding
      // the two make ~84px and the answer reads as detached from the question it
      // answers (issue #859, task 3).
      heroEndsWithRule={Boolean(hero) && !isIssueAnswer}
    >
      {children}
    </SearchPageShell>
  );

  if (askQuery.isLoading || resolvingName) {
    return shell(
      <View style={styles.stateBox}>
        <Skeleton height={22} width="70%" />
        <Skeleton height={22} width="90%" />
        <Skeleton height={22} width="55%" />
      </View>,
    );
  }

  if (askQuery.isError) {
    return shell(
      <View style={styles.stateBox}>
        <Text style={styles.stateText}>Something went wrong answering this question.</Text>
        <Pressable accessibilityRole="button" onPress={() => askQuery.refetch()}>
          <Text style={styles.viewBillLink}>Try again →</Text>
        </Pressable>
      </View>,
    );
  }

  // No ?q= at all. There is no field on this page to fill in, so the honest exit
  // is Search rather than an instruction to type something (§9.5 Scope).
  if (!question) {
    return shell(
      <View style={styles.stateBox}>
        <Text style={styles.stateText}>
          This page shows the answer to a question asked from a bill. Pick a bill and ask one of its
          suggested questions.
        </Text>
        <Pressable {...linkProps(routePath.bills(), () => navigation.navigate('Bills'))}>
          <Text style={styles.viewBillLink}>Browse Minnesota bills in Search →</Text>
        </Pressable>
      </View>,
    );
  }

  // --- The refusal / NO BILL MATCHED state (§9.5 decision 9). A chip cannot
  // produce it, but ?q= is shareable and hand-editable, so it must still render.
  if (answer && !answer.hasAnswer) {
    return shell(
      <View style={styles.narrowColumn}>
        <Text style={styles.bodyText}>{pending.body}</Text>
        <Pressable {...linkProps(routePath.bills(), () => navigation.navigate('Bills'))}>
          <Text style={styles.viewBillLink}>{pending.cta}</Text>
        </Pressable>
      </View>,
    );
  }

  // --- The vote deflection (§4.5 / §9.4): never a vote answer, no tallies.
  if (isVoteDeflection && answer) {
    return shell(
      <View style={styles.narrowColumn}>
        {/* Fixed deflection copy owned by the layout (docs/product-onboarding/grounded-ask-spec.md
            §9.4) — .claude/rules/grounded-answers.md rules 3 & 4. */}
        <Text style={styles.bodyText}>
          Vote-by-vote answers will land right here. Until then, every roll call on this bill is on
          its Votes page — each with a link to the official record.
        </Text>
        {resolvedBill ? (
          <View style={styles.cardsColumn}>
            <AnswerBillCard
              bill={resolvedBill}
              onOpen={() => openBill(resolvedBill.id)}
              tracked={isTracked(resolvedBill.id)}
              onToggleTrack={() => toggleTrack(resolvedBill.id)}
            />
            <Pressable
              {...linkProps(routePath.bill(resolvedBill.id, { tab: 'votes' }), () =>
                openVotes(resolvedBill.id),
              )}
              accessibilityLabel={`See all votes on ${resolvedBill.identifier}`}
            >
              <Text style={styles.viewBillLink}>See all votes on {resolvedBill.identifier} →</Text>
            </Pressable>
          </View>
        ) : compactBills.length > 0 ? (
          <>
            {/* Unresolved bill → degrade to the topic_bills list, each card
                deep-linking its Votes tab (§4.5 / §9.4). */}
            <Text style={styles.bodyText}>
              No specific bill was named. Here are bills on
              <Text style={styles.topicPill}> {answer.topic ?? 'this topic'} </Text>— open any to
              see its roll-call votes:
            </Text>
            <View style={styles.cardsColumn}>
              {compactBills.map((listed) => (
                <AnswerBillCard
                  key={listed.id}
                  bill={listed}
                  onOpen={() => openBill(listed.id)}
                  tracked={isTracked(listed.id)}
                  onToggleTrack={() => toggleTrack(listed.id)}
                />
              ))}
            </View>
          </>
        ) : (
          <Pressable {...linkProps(routePath.bills(), () => navigation.navigate('Bills'))}>
            <Text style={styles.viewBillLink}>Browse bills to see their votes →</Text>
          </Pressable>
        )}
      </View>,
    );
  }

  // --- The chip-reached single-bill answer (§9.5). Everything above is a state
  // this page must still be able to render; this is the one it was designed for.
  if (isBillText && answer && answer.billText) {
    return shell(
      <View>
        <View style={[styles.grid, isDesktop && styles.gridDesktop]}>
          <View style={[styles.contentCol, isDesktop && styles.contentColDesktop]}>
            {/* ABOVE the answer, deliberately: a reader who skims the first two
                lines and leaves is the one most at risk of being misled, so they
                have to see it first. After the list it protects nobody, which is
                the whole point (§9.5 decision 11, #883). Fixed layout copy — never
                model output, so the answer cannot soften the caveat about itself. */}
            {coverageNote ? <Text style={styles.coverageNote}>{coverageNote}</Text> : null}
            <AnswerBody blocks={answerBlocks} />

            {bill ? (
              <View style={styles.billCardBlock}>
                <BillResultCard
                  bill={bill}
                  tracked={isTracked(bill.id)}
                  onToggleTrack={() => toggleTrack(bill.id)}
                  onPress={() => openBill(bill.id)}
                  onSponsorPress={(legislatorId) =>
                    navigation.navigate('LegislatorProfile', { legislatorId })
                  }
                  onRollCalls={() => openVotes(bill.id)}
                />
              </View>
            ) : billQuery.isLoading ? (
              <View style={styles.billCardBlock}>
                <Skeleton height={220} radius={18} />
              </View>
            ) : null}

            {chips.length ? (
              <View style={styles.askAnotherBlock}>
                <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
                  Ask another question
                </Text>
                <View style={styles.chipRow}>
                  {chips.map((chip) => {
                    // Scoped to this bill the same way Bill Detail scopes its chips,
                    // so the bill_text path resolves it and the chip cannot dead-end
                    // in a refusal (rule 2). A real anchor, so each suggestion has
                    // its own shareable URL.
                    const submit = answeringBill
                      ? scopedChipQuery(answeringBill.identifier, chip)
                      : chip;
                    return (
                      <SuggestedQuestionChip
                        key={chip}
                        label={chip}
                        linkProps={linkProps(routePath.ask({ q: submit }), () =>
                          askFollowUp(submit),
                        )}
                      />
                    );
                  })}
                </View>
              </View>
            ) : null}
          </View>

          {sections.length ? (
            <View
              style={[
                styles.railCol,
                isDesktop && styles.railColDesktop,
                isDesktop && isWeb ? STICKY_RAIL : null,
              ]}
            >
              <View style={styles.railHead}>
                <Text accessibilityRole="header" style={styles.h2}>
                  From the bill
                </Text>
                <View style={styles.citedLabel}>
                  <Text style={styles.citedLabelText}>Cited Sections</Text>
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                    <Circle
                      cx={12}
                      cy={12}
                      r={9}
                      stroke={t.colors.brand.graphics}
                      strokeWidth={2}
                    />
                    <Path
                      d="M8.5 12.2 L11 14.7 L15.7 9.6"
                      stroke={t.colors.brand.graphics}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </View>
              </View>
              <View style={styles.railCards}>
                {sections.map((section) => {
                  // The anchor value the Bill Text tab answers to — id AND position
                  // (#854). Built by the same helper the tab's own citation chips
                  // use, and checked with the same resolver the tab runs on an
                  // incoming fragment, so a link cannot claim a landing spot the tab
                  // would not honour.
                  const anchor = citationSectionAnchor(section);
                  const target = passageTarget(
                    section.sectionId,
                    Boolean(resolveSectionAnchor(renderedSections, parseSectionAnchor(anchor))),
                    sectionsLoaded,
                  );
                  const billTextPath = bill ? routePath.bill(bill.id, { tab: 'text' }) : null;
                  return (
                    <CitationCard
                      key={section.key}
                      label={section.label}
                      sectionTopic={section.sectionTopic}
                      excerpts={section.excerpts}
                      variant="answer"
                      accessibilityLabel={
                        target === 'official'
                          ? `Open the official source for ${section.chipLabel}`
                          : `Read ${section.chipLabel} in the bill text`
                      }
                      linkProps={
                        target !== 'official' && billTextPath
                          ? // A REAL browser navigation, not the usual in-app
                            // transition: the target carries a URL fragment, and
                            // React Navigation rewrites the URL on navigate, so an
                            // in-app transition would drop `#ft-…` and the Bill Text
                            // tab would have nothing to scroll to. One page load buys
                            // a landing that scrolls and highlights, and a URL the
                            // reader can copy (grounded-answers rule 5).
                            passageLinkProps(
                              target === 'passage'
                                ? `${billTextPath}#${sectionAnchorId(parseSectionAnchor(anchor)!)}`
                                : billTextPath,
                              () =>
                                navigation.navigate('BillDetail', {
                                  billId: bill!.id,
                                  tab: 'text',
                                }),
                            )
                          : externalLinkProps(section.url, () => {
                              Linking.openURL(section.url).catch(() => {});
                            })
                      }
                    />
                  );
                })}
              </View>
              {/* This closes the card group as a quiet footnote on both layouts.
                  The trailing ellipsis already shows that each quote is cut off;
                  this line tells the reader how to get the rest. */}
              <Text style={styles.railGloss}>
                Each quote is the opening of a longer section — open one to read it in full
              </Text>
            </View>
          ) : null}
        </View>
        <SourceLine updatedLabel={updatedLabel} />
      </View>,
    );
  }

  // --- NO MATCHES on a topic answer (§4.5): in scope, just empty. Never shares
  // the out-of-scope label.
  if (noMatches) {
    return shell(
      <View style={styles.narrowColumn}>
        <Text style={styles.bodyText}>
          {isLegislators
            ? 'No legislators of this Legislature are on the record for'
            : 'No bills of this Legislature match'}{' '}
          {answer?.topic ? (
            <Text style={styles.topicPill}> {answer.topic} </Text>
          ) : (
            <Text>this topic</Text>
          )}
          . Try another issue, or browse everything in Search.
        </Text>
        <Pressable
          {...linkProps(routePath.bills(answer?.topic ? { q: answer.topic } : undefined), () =>
            navigation.navigate('Bills', answer?.topic ? { q: answer.topic } : undefined),
          )}
        >
          <Text style={styles.viewBillLink}>Search all bills →</Text>
        </Pressable>
      </View>,
    );
  }

  // --- topic_legislators (§4.3 / §9.4).
  if (hasMatches && answer && isLegislators) {
    return shell(
      <View style={styles.narrowColumn}>
        {/* Fixed framing copy owned by the layout, never LLM output
            (docs/product-onboarding/grounded-ask-spec.md §4.3; .claude/rules/grounded-answers.md rule 3). */}
        <Text style={styles.framingNote}>
          “Support” shown as what the public record shows: bills authored or co-authored on this
          topic — not inferred opinions.
        </Text>
        <Text style={styles.bodyText}>
          Legislators on the record for
          <Text style={styles.topicPill}> {answer.topic} </Text>, grouped by chamber:
        </Text>
        <Text style={styles.provenance}>
          {shownLegislators.length} of {answer.totalMatches} legislators
        </Text>
        {chamberGroups.map((group) => (
          <View key={group.key} style={styles.chamberGroup}>
            <Text style={styles.chamberHeading}>{group.label}</Text>
            {group.legislators.map((legislator) => (
              <AnswerLegislatorRow
                key={legislator.id}
                legislator={legislator}
                onOpenProfile={() =>
                  navigation.navigate('LegislatorProfile', {
                    legislatorId: legislator.slug ?? legislator.id,
                  })
                }
                onOpenBill={openBill}
              />
            ))}
          </View>
        ))}
        {answer.totalBills && answer.totalBills > 0 ? (
          <Pressable
            {...linkProps(routePath.bills(answer.topic ? { q: answer.topic } : undefined), () =>
              navigation.navigate('Bills', answer.topic ? { q: answer.topic } : undefined),
            )}
          >
            {/* No count, for the same reason as the topic list's link: an Ask
                covers the whole Legislature and Search browses one session, so a
                number here promises a page Search cannot show (#810). */}
            <Text style={styles.viewBillLink}>See all {answer.topic} bills in Search →</Text>
          </Pressable>
        ) : null}
        <FollowUpChips chips={followUpChips} onAsk={askFollowUp} />
      </View>,
    );
  }

  // --- topic_bills (§4.2 / §9.4).
  if (hasMatches && answer) {
    const issueTopic = answer.topic ?? 'this issue';
    const browseParams = { q: answer.topic, sort: issueSort };
    return shell(
      <View style={answer.ambiguousReference ? styles.narrowColumn : styles.issueAnswerColumn}>
        {answer.ambiguousReference ? (
          /* Not a topic result: the number named more than one bill. Saying so is
             the whole point — two "HF 5" cards with a topic heading above them
             would read as two bills about one subject, which they are not (#810). */
          <Text style={styles.bodyText}>
            <Text style={styles.topicPill}> {answer.ambiguousReference} </Text> is the number of
            more than one bill. A special session numbers its files from 1 again, so these are
            different laws. Open the one you meant:
          </Text>
        ) : null}
        {answer.ambiguousReference ? (
          <View style={styles.cardsColumn}>
            {compactBills.map((listed) => (
              <AnswerBillCard
                key={listed.id}
                bill={listed}
                onOpen={() => openBill(listed.id)}
                tracked={isTracked(listed.id)}
                onToggleTrack={() => toggleTrack(listed.id)}
              />
            ))}
          </View>
        ) : (
          <>
            <ResultsHeader
              count={shownIssueBills.length}
              noun="bill"
              dataAsOf={undefined}
              showRule={false}
              countTail={
                <View style={styles.issueCountTail}>
                  <Text style={styles.issueCountTailText}>of {answer.totalMatches} matching</Text>
                  <View style={[styles.issueTopicChip, isMobile && styles.issueTopicChipMobile]}>
                    <Text style={styles.issueTopicChipText}>{issueTopic}</Text>
                  </View>
                </View>
              }
              sortControl={
                <SortControl
                  options={[...ISSUE_ANSWER_SORT_OPTIONS]}
                  value={issueSort}
                  onSelect={selectIssueSort}
                  open={issueSortOpen}
                  onOpenChange={setIssueSortOpen}
                />
              }
            />
            <View style={styles.issueCardsColumn}>
              {shownIssueBills.map((listed) => (
                <BillResultCard
                  key={listed.id}
                  variant="issueAnswer"
                  excludedPolicyArea={answer.topic}
                  bill={listed}
                  tracked={isTracked(listed.id)}
                  onToggleTrack={() => toggleTrack(listed.id)}
                  onPress={() => openBill(listed.id)}
                  onSponsorPress={(legislatorId) =>
                    navigation.navigate('LegislatorProfile', { legislatorId })
                  }
                  onRollCalls={() => openVotes(listed.id)}
                />
              ))}
            </View>
          </>
        )}
        {!answer.ambiguousReference && answer.totalMatches > shownIssueBills.length ? (
          <Pressable
            {...linkProps(routePath.bills(browseParams), () =>
              navigation.navigate('Bills', browseParams),
            )}
            style={styles.issueSeeAllLink}
          >
            {/* No count in the link. An Ask covers the whole Legislature, including
                its special session, while Search browses ONE session at a time and
                defaults to the regular one — so promising a specific number here
                would promise a page Search cannot show (#810). The count above still
                says how many the answer matched. */}
            <Text style={styles.viewBillLink}>See all {issueTopic} bills in Search →</Text>
          </Pressable>
        ) : null}
        <FollowUpChips chips={followUpChips} onAsk={askFollowUp} />
        {!answer.ambiguousReference ? <SourceLine updatedLabel={issueAnswerUpdatedLabel} /> : null}
      </View>,
    );
  }

  return shell(null);
}

// The generated answer, displayed and never recomposed (§9.5 decision 5): the
// model's own sentences and their order pass through untouched, and the only thing
// the layout decides is the SHAPE of a list it wrote.
function AnswerBody({ blocks }: { blocks: ReturnType<typeof parseAnswerBlocks> }) {
  return (
    <View>
      {blocks.map((block, index) => {
        if (block.kind === 'paragraph') {
          return (
            <Text key={index} style={[styles.answerText, index > 0 && styles.answerTextSpaced]}>
              {block.text}
            </Text>
          );
        }
        const index3 = alphabeticalIndex(block.items);
        return index3 ? (
          <AlphabeticalIndex key={index} items={index3} />
        ) : (
          <View key={index} style={styles.points}>
            {block.items.map((item, i) => (
              <View key={i} style={styles.pointRow}>
                <View style={styles.bullet} />
                <Text style={styles.pointText}>{item}</Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

// A long list of short names, laid out as a three-column A→Z index so one name is
// findable at a glance (§9.5 decision 6). Layout only.
//
// Deliberately NO COUNT, and no total (#868). Retrieval hands the answer writer
// four passages of a bill (`_BILL_TEXT_CHUNK_LIMIT`), so on a 48-section bonding
// bill the model enumerates what it could see: for HF 719 it named 19 cities where
// the bill's own text names about 90. A count printed beside that list would turn
// an incomplete enumeration into a false claim of completeness — the worst failure
// this product can make (.claude/rules/grounded-answers.md rule 1). The caption
// states the ORDERING only, which is a fact about the layout and not about the
// bill; the reader needs it because these names are not in the answer's own order.
const INDEX_COLUMNS = 3;

function AlphabeticalIndex({ items }: { items: string[] }) {
  const rows = Math.ceil(items.length / INDEX_COLUMNS);
  const gridWeb = isWeb
    ? ({
        display: 'grid',
        gridAutoFlow: 'column',
        gridTemplateRows: `repeat(${rows}, auto)`,
        columnGap: 28,
        rowGap: 9,
        justifyContent: 'start',
      } as object)
    : null;
  return (
    <View style={styles.indexBlock}>
      <Text style={styles.indexCaption}>Listed A–Z</Text>
      <View style={[styles.indexList, gridWeb]}>
        {items.map((item) => (
          <Text key={item} style={styles.indexItem}>
            {item}
          </Text>
        ))}
      </View>
    </View>
  );
}

// A cited passage is reached by a genuine browser navigation on web (the fragment
// has to survive), and by an ordinary in-app navigate on native, where there is no
// anchor to carry.
function passageLinkProps(href: string, onPress: () => void) {
  if (!isWeb) {
    return { accessibilityRole: 'link' as const, onPress };
  }
  return { accessibilityRole: 'link' as const, href };
}

// Back-link grey, matching Bill Detail's breadcrumb (palette.ink500).
const BACK_LINK_GREY = '#4b524b';

const styles = StyleSheet.create({
  // --- Header (on the gradient) ---
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 32,
    flexWrap: 'wrap',
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink10,
  },
  headerIssueAnswer: { paddingBottom: 0, borderBottomWidth: 0 },
  headerMain: { minWidth: 0, flexShrink: 1, flexGrow: 1, flexBasis: 320 },
  backLink: {
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  backLinkLabel: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.semibold,
  },
  h1: {
    fontFamily: t.typography.title,
    fontSize: 42,
    lineHeight: 45,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.9,
    color: t.colors.text.primary,
  },
  sessionLine: {
    marginTop: 14,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.medium,
    letterSpacing: 0.7,
    color: t.colors.text.muted,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    marginBottom: 12,
  },
  eyebrow: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    letterSpacing: 1.4,
    color: t.colors.text.green,
    fontWeight: '700',
  },
  // Out-of-scope is a calm, muted state — not an answer, not "coming soon".
  eyebrowMuted: { color: t.colors.text.muted },
  comingSoonBadge: {
    backgroundColor: t.colors.tint.t150,
    borderRadius: t.radii.badge,
    ...(isWeb
      ? ({ paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2 } as object)
      : { paddingHorizontal: 8, paddingVertical: 2 }),
  },
  comingSoonBadgeText: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: '700',
    color: t.colors.brand.deep,
  },

  // --- Body grid (1.4fr / 1fr, 56px, collapsing under 1100px) ---
  grid: { gap: 40 },
  gridDesktop: { flexDirection: 'row', alignItems: 'flex-start', gap: 56 },
  contentCol: { minWidth: 0 },
  contentColDesktop: { flex: 1.4 },
  railCol: { minWidth: 0 },
  railColDesktop: { flex: 1 },
  // Single-column states (a refusal, a topic list) read as prose, so they keep a
  // measure rather than running the full 1240px.
  narrowColumn: { maxWidth: 760, gap: t.spacing.md },
  issueAnswerColumn: { width: '100%', gap: 20 },

  h2: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h3,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
  },

  // --- The answer ---
  answerText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subhead,
    lineHeight: 28,
    fontWeight: t.fontWeights.medium,
    color: '#2c322c',
  },
  answerTextSpaced: { marginTop: 22 },
  points: { marginTop: 18, gap: 14 },
  pointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  bullet: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: t.colors.text.primary,
    marginTop: 10,
  },
  pointText: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subhead,
    lineHeight: 28,
    color: '#2c322c',
  },
  // The muted framing-note register the topic_legislators answer already uses —
  // quiet and factual, NOT an error or a warning, because it accompanies a real,
  // correct, cited answer. No alert colour, no icon, no box.
  coverageNote: {
    marginBottom: 18,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    fontStyle: 'italic',
    color: '#6f756f',
    maxWidth: 620,
  },
  indexBlock: { marginTop: 18 },
  indexCaption: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.label,
    color: '#6f756f',
  },
  indexList: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 28,
    rowGap: 9,
  },
  indexItem: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.medium,
    color: '#2c322c',
  },

  billCardBlock: { marginTop: 36 },
  askAnotherBlock: { marginTop: 36, gap: 14 },
  chipRow: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 9 },

  // --- "From the bill" rail ---
  railHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  citedLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  citedLabelText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.text.muted,
  },
  railGloss: {
    fontFamily: t.typography.body,
    fontSize: 13,
    lineHeight: 19.5,
    color: '#6f756f',
    marginTop: 14,
    paddingLeft: t.spacing.underCardText,
  },
  railCards: { marginTop: 14, gap: 12 },

  // --- Shared / other states ---
  stateBox: { gap: t.spacing.md, maxWidth: 620 },
  stateText: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 25,
    color: t.colors.text.secondary,
  },
  bodyText: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 25,
    color: t.colors.text.secondary,
  },
  topicPill: {
    fontFamily: t.typography.mono,
    fontSize: 13,
    fontWeight: '700',
    color: t.colors.brand.deep,
    backgroundColor: t.colors.tint.t150,
    borderRadius: t.radii.badge,
    ...(isWeb
      ? ({ paddingLeft: 6, paddingRight: 6, paddingTop: 1, paddingBottom: 1 } as object)
      : null),
  },
  provenance: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    color: t.colors.text.muted,
  },
  cardsColumn: { gap: t.spacing.md },
  issueCardsColumn: { gap: 14 },
  issueCountTail: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 8,
  },
  issueCountTailText: {
    fontFamily: t.typography.body,
    fontSize: 14,
    color: '#6f756f',
  },
  issueTopicChip: {
    backgroundColor: '#f0ebfc',
    borderWidth: 1,
    borderColor: '#d8c9f7',
    borderRadius: 7,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  issueTopicChipMobile: { borderRadius: 12 },
  issueTopicChipText: {
    fontFamily: t.typography.mono,
    fontSize: 13,
    fontWeight: '700',
    color: '#5b30d6',
  },
  issueSeeAllLink: {
    minHeight: 44,
    alignSelf: 'flex-end',
    justifyContent: 'center',
  },
  followupBlock: { gap: 14, marginTop: 16 },
  followupHeading: {
    fontFamily: t.typography.title,
    fontSize: 22,
    letterSpacing: -0.3,
    fontWeight: t.fontWeights.heavy,
    color: t.colors.text.primary,
  },
  followupHeadingMobile: { fontSize: 19 },
  framingNote: {
    fontFamily: t.typography.body,
    fontSize: 13,
    lineHeight: 19,
    fontStyle: 'italic',
    color: t.colors.text.muted,
  },
  chamberGroup: { gap: t.spacing.sm },
  chamberHeading: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    letterSpacing: 1.2,
    fontWeight: '700',
    color: t.colors.text.secondary,
    marginTop: t.spacing.xs,
  },
  legRow: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: t.radii.card,
    padding: t.spacing.md,
    gap: 6,
  },
  legRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: t.spacing.sm,
  },
  legNameCol: { flexShrink: 1, gap: 2 },
  legName: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.text.primary,
  },
  legMeta: {
    fontFamily: t.typography.ui,
    fontSize: 13,
    color: t.colors.text.secondary,
  },
  legCounts: {
    fontFamily: t.typography.ui,
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.brand.deep,
  },
  onRecordToggle: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    color: t.colors.text.muted,
    marginTop: 2,
  },
  billPillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  billPill: {
    backgroundColor: t.colors.omnibus.fill,
    borderRadius: t.radii.badge,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  billPillText: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: '700',
    color: t.colors.omnibus.text,
  },
  billCard: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: t.radii.card,
    padding: t.spacing.md,
    gap: t.spacing.sm,
  },
  billCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.sm,
  },
  billCardTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    flexShrink: 1,
  },
  billBadge: {
    backgroundColor: t.colors.omnibus.fill,
    borderRadius: t.radii.badge,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  billBadgeText: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: '700',
    color: t.colors.omnibus.text,
  },
  billStatus: {
    fontFamily: t.typography.ui,
    fontSize: 13,
    fontWeight: '600',
  },
  // The session label beside the status, in the same small-caps treatment the
  // bill page's eyebrow uses — it is a qualifier on the bill number, not a second
  // status, so it reads quieter than the status it sits next to (#810).
  billSessionTag: {
    fontFamily: t.typography.ui,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: t.colors.text.faint,
  },
  billTitle: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    color: t.colors.text.primary,
  },
  billSummary: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: t.colors.text.secondary,
  },
  viewBillLink: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.text.green,
  },
});
