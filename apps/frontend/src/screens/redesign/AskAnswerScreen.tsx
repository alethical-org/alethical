import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Plus } from 'lucide-react-native';

import { theme } from '../../theme/tokens';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { IaItem, MenuKey } from '../../navigation/ia';
import { RootScreenProps } from '../../navigation/types';
import { useAuth } from '../../providers/AuthProvider';
import {
  useAskAnswer,
  useLegislators,
  useToggleTrackedBill,
  useTrackedBills,
} from '../../hooks/useAppQueries';
import { AskAnswerBill, AskAnswerLegislator } from '../../data/types';

const t = theme;
const isWeb = Platform.OS === 'web';

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

function formatDataAsOf(dataAsOf?: string) {
  if (!dataAsOf) {
    return null;
  }
  const parsed = new Date(dataAsOf);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// The RAG synthesis returns light markdown (**bold**); strip the emphasis
// markers so the prose reads cleanly — there is no markdown renderer here.
function stripInlineMarkdown(value: string) {
  return value.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
}

// §4.7 follow-up chips — cross-intent templates filled from the *resolved*
// topic, so they are non-refusable by construction (rule 1): the topic already
// matched, so the target path returns results. A topic answer bridges to the
// other topic path. Capped at 3, ordered deep-dive → bills → legislators (§4.7
// rule 3). bill_text chunk-derived deep-dive chips are a follow-on.
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

// §4.7 follow-up chips for a bill_text answer — deterministic cross-intent
// templates filled from the answering bill's own policy-area tag, so they are
// non-refusable by construction (the bill is itself in that policy area, so
// each target path returns results). No LLM, no extra call. Deeper chunk-derived
// deep-dive chips (§4.7 rule 1) are the v1.1 upgrade (#261).
function billTextChips(topic?: string): { label: string; submit: string }[] {
  if (!topic) {
    return [];
  }
  return [
    {
      label: `What other ${topic} bills are there?`,
      submit: `What other ${topic} bills are there?`,
    },
    {
      label: `Which legislators authored ${topic} bills?`,
      submit: `Which legislators authored ${topic} bills?`,
    },
  ];
}

function FollowUpChips({
  chips,
  onAsk,
}: {
  chips: { label: string; submit: string }[];
  onAsk: (submit: string) => void;
}) {
  if (chips.length === 0) {
    return null;
  }
  return (
    <View style={styles.followupBlock}>
      <Text style={styles.followupHeading}>CONTINUE</Text>
      <View style={styles.followupRow}>
        {chips.map((chip) => (
          <Pressable
            key={chip.submit}
            accessibilityRole="button"
            accessibilityLabel={chip.submit}
            style={styles.followupChip}
            onPress={() => onAsk(chip.submit)}
          >
            <Text style={styles.followupChipText}>{chip.label} →</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function AnswerBillCard({
  bill,
  tracked,
  onOpen,
  onTrack,
}: {
  bill: AskAnswerBill;
  tracked: boolean;
  onOpen: () => void;
  onTrack: () => void;
}) {
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
        </View>
        {/* Signed out always shows "+ Track" (tapping starts sign-in); the
            affirmed state never renders signed-out (docs/grounded-ask-spec.md
            §9.2, Track-button states). */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tracked ? `Tracking ${bill.identifier}` : `Track ${bill.identifier}`}
          style={styles.trackButton}
          onPress={onTrack}
        >
          <Plus size={13} color={t.colors.surfaces.base} strokeWidth={3} />
          <Text style={styles.trackButtonText}>{tracked ? 'Tracking' : 'Track'}</Text>
        </Pressable>
      </View>
      <Text style={styles.billTitle}>{bill.title}</Text>
      {bill.summary ? <Text style={styles.billSummary}>{bill.summary}</Text> : null}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`View bill ${bill.identifier}`}
        onPress={onOpen}
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
          accessibilityRole="link"
          accessibilityLabel={`View profile for ${legislator.fullName}`}
          onPress={onOpenProfile}
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
              accessibilityRole="link"
              accessibilityLabel={`View ${bill.identifier}`}
              onPress={() => onOpenBill(bill.id)}
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

export function AskAnswerScreen({ navigation, route }: RootScreenProps<'Ask'>) {
  const question = route.params?.q?.trim() ?? '';
  const { isSignedIn, signInWithGoogle, user } = useAuth();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [retryValue, setRetryValue] = useState(question);
  const [copied, setCopied] = useState(false);

  const askQuery = useAskAnswer(question);
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);
  const trackedIds = useMemo(
    () => new Set((trackedQuery.data ?? []).map((bill) => bill.id)),
    [trackedQuery.data],
  );

  // §4.6 — the placeholder's "name" entry point. A query that resolves to a
  // single legislator name is records navigation, so redirect to that profile
  // instead of running it through the cite-or-refuse answer path. Reuses the
  // existing directory search (GET /legislators?q=); multiple or zero matches
  // fall through to the normal answer below.
  const nameQuery = useLegislators(question);
  const nameMatch = nameQuery.data && nameQuery.data.length === 1 ? nameQuery.data[0] : undefined;
  const resolvingName = Boolean(question) && (nameQuery.isLoading || Boolean(nameMatch));

  useEffect(() => {
    if (nameMatch) {
      navigation.replace('LegislatorProfile', { legislatorId: nameMatch.id });
    }
  }, [nameMatch, navigation]);

  const answer = askQuery.data;
  const isLegislators = answer?.intent === 'topic_legislators';
  const shownBills = answer?.bills ?? [];
  const shownLegislators = answer?.legislators ?? [];
  const hasMatches = Boolean(answer?.hasAnswer && answer.totalMatches > 0);
  const noMatches = Boolean(answer?.hasAnswer && answer.totalMatches === 0);
  const dataAsOf = formatDataAsOf(answer?.dataAsOf);
  const followUpChips = crossIntentChips(answer?.intent, answer?.topic);

  // §4.7 rule 4: follow-up chips fire their fully-qualified submit directly
  // (not populate — that is hero-only). Re-runs the Ask in place, updating ?q=.
  const askFollowUp = (submit: string) => {
    setRetryValue(submit);
    navigation.setParams({ q: submit });
  };

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

  // legislator_vote → the v1 honest vote deflection (§4.5 / §9.4): never a vote
  // answer. A resolved bill deep-links its Votes tab; otherwise it degrades to
  // the topic_bills list. hasAnswer is true, so this sits outside `pending`.
  const isVoteDeflection = answer?.intent === 'legislator_vote';
  const resolvedBill = answer?.resolvedBill;

  // bill_text → the §4.1 / §9.4 single-bill RAG answer: prose + passage
  // citations + the answering bill. hasAnswer is true, so (like vote deflection)
  // it renders its own block ahead of the NO MATCHES check.
  const isBillText = answer?.intent === 'bill_text';
  const answeringBill = answer?.answeringBill;
  const citations = answer?.citations ?? [];

  const submitRetry = () => {
    const next = retryValue.trim();
    if (next) {
      navigation.setParams({ q: next });
    }
  };

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

  const handleTrack = (billId: string) => {
    if (!isSignedIn) {
      void signInWithGoogle();
      return;
    }
    toggleTrackedBill.mutate(billId);
  };

  const copyLink = async () => {
    try {
      if (isWeb && typeof window !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }
      await Share.share({ message: `${question} — Alethical` });
    } catch {
      // Clipboard/share permission denied — leave the button label unchanged.
    }
  };

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.navWrap}>
          <TopNav
            openMenu={openMenu}
            onOpenMenuChange={setOpenMenu}
            onNavigate={handleNavigate}
            onSignIn={() => void signInWithGoogle()}
          />
        </View>
        <Container style={styles.body}>
          {/* Retry path: the persistent Ask bar (docs/grounded-ask-spec.md §9.1). */}
          <View style={styles.askBar}>
            <TextInput
              style={styles.askInput}
              value={retryValue}
              onChangeText={setRetryValue}
              placeholder="Ask about bills or legislators by issue or name"
              placeholderTextColor={t.colors.text.muted}
              onSubmitEditing={submitRetry}
              returnKeyType="search"
              {...(isWeb
                ? {
                    onKeyPress: (event: {
                      nativeEvent: { key: string };
                      preventDefault?: () => void;
                    }) => {
                      if (event.nativeEvent.key === 'Enter') {
                        event.preventDefault?.();
                        submitRetry();
                      }
                    },
                  }
                : null)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ask"
              style={styles.askButton}
              onPress={submitRetry}
            >
              <Text style={styles.askButtonText}>Ask</Text>
            </Pressable>
          </View>

          {askQuery.isLoading || resolvingName ? (
            <View style={styles.centerBlock}>
              <ActivityIndicator color={t.colors.brand.deep} />
            </View>
          ) : askQuery.isError ? (
            <View style={styles.centerBlock}>
              <Text style={styles.errorText}>Something went wrong answering this question.</Text>
              <Pressable accessibilityRole="button" onPress={() => askQuery.refetch()}>
                <Text style={styles.viewBillLink}>Try again →</Text>
              </Pressable>
            </View>
          ) : !question ? (
            <View style={styles.centerBlock}>
              <Text style={styles.errorText}>Type a question above to get started.</Text>
            </View>
          ) : answer && !answer.hasAnswer ? (
            <View style={styles.answerBlock}>
              <Text style={[styles.eyebrow, pending.muted && styles.eyebrowMuted]}>
                {pending.eyebrow}
              </Text>
              <Text style={styles.question}>{question}</Text>
              <Text style={styles.introLine}>{pending.body}</Text>
              <Pressable accessibilityRole="link" onPress={() => navigation.navigate('Bills')}>
                <Text style={styles.viewBillLink}>{pending.cta}</Text>
              </Pressable>
            </View>
          ) : isVoteDeflection && answer ? (
            <View style={styles.answerBlock}>
              {/* §9.4 vote-deflection: ANSWER eyebrow (not an error) + COMING
                  SOON badge; never a vote answer, no tallies or positions. */}
              <View style={styles.eyebrowRow}>
                <Text style={styles.eyebrow}>ANSWER</Text>
                <View style={styles.comingSoonBadge}>
                  <Text style={styles.comingSoonBadgeText}>COMING SOON</Text>
                </View>
              </View>
              <Text style={styles.question}>{question}</Text>
              {/* Fixed deflection copy owned by the layout (docs/grounded-ask-spec.md
                  §9.4) — .claude/rules/grounded-answers.md rules 3 & 4. */}
              <Text style={styles.introLine}>
                Vote-by-vote answers will land right here. Until then, every roll call on this bill
                is on its Votes page — each with a link to the official record.
              </Text>
              {resolvedBill ? (
                <View style={styles.cardsColumn}>
                  <AnswerBillCard
                    bill={resolvedBill}
                    tracked={isSignedIn && trackedIds.has(resolvedBill.id)}
                    onOpen={() => navigation.navigate('BillDetail', { billId: resolvedBill.id })}
                    onTrack={() => handleTrack(resolvedBill.id)}
                  />
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`See all votes on ${resolvedBill.identifier}`}
                    onPress={() =>
                      navigation.navigate('BillDetail', {
                        billId: resolvedBill.id,
                        tab: 'votes',
                      })
                    }
                  >
                    <Text style={styles.viewBillLink}>
                      See all votes on {resolvedBill.identifier} →
                    </Text>
                  </Pressable>
                </View>
              ) : shownBills.length > 0 ? (
                <>
                  {/* Unresolved bill → degrade to the topic_bills list, each card
                      deep-linking its Votes tab (§4.5 / §9.4). */}
                  <Text style={styles.introLine}>
                    No specific bill was named. Here are current-session bills on
                    <Text style={styles.topicPill}> {answer.topic ?? 'this topic'} </Text>— open any
                    to see its roll-call votes:
                  </Text>
                  <View style={styles.cardsColumn}>
                    {shownBills.map((bill) => (
                      <AnswerBillCard
                        key={bill.id}
                        bill={bill}
                        tracked={isSignedIn && trackedIds.has(bill.id)}
                        onOpen={() =>
                          navigation.navigate('BillDetail', { billId: bill.id, tab: 'votes' })
                        }
                        onTrack={() => handleTrack(bill.id)}
                      />
                    ))}
                  </View>
                </>
              ) : (
                <Pressable accessibilityRole="link" onPress={() => navigation.navigate('Bills')}>
                  <Text style={styles.viewBillLink}>Browse bills to see their votes →</Text>
                </Pressable>
              )}
            </View>
          ) : isBillText && answer && answer.billText ? (
            <View style={styles.answerBlock}>
              {/* §9.4 bill_text: answer prose + provenance strip + a Sources
                  section, each citation opening its official source. */}
              <Text style={styles.eyebrow}>ANSWER</Text>
              <Text style={styles.question}>{question}</Text>
              {answeringBill ? (
                <Text style={styles.provenance}>
                  {answeringBill.identifier}
                  {answer.sessionName ? ` · ${answer.sessionName}` : ''}
                  {dataAsOf ? ` · Data as of ${dataAsOf}` : ''}
                </Text>
              ) : null}
              <Text style={styles.billTextProse}>{stripInlineMarkdown(answer.billText)}</Text>
              {citations.length > 0 ? (
                <View style={styles.sourcesBlock}>
                  <Text style={styles.sourcesHeading}>SOURCES</Text>
                  {citations.map((citation, index) => (
                    <View key={`${citation.label}-${index}`} style={styles.citationCard}>
                      <Text style={styles.citationLabel}>
                        {index + 1}. {citation.label}
                      </Text>
                      <Text style={styles.citationExcerpt}>“{citation.excerpt}”</Text>
                      <Pressable
                        accessibilityRole="link"
                        accessibilityLabel={`Open the official source for ${citation.label}`}
                        onPress={() => void Linking.openURL(citation.url)}
                      >
                        <Text style={styles.citationLink}>Open official source ↗</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
              {answeringBill ? (
                <AnswerBillCard
                  bill={answeringBill}
                  tracked={isSignedIn && trackedIds.has(answeringBill.id)}
                  onOpen={() => navigation.navigate('BillDetail', { billId: answeringBill.id })}
                  onTrack={() => handleTrack(answeringBill.id)}
                />
              ) : null}
              <FollowUpChips
                chips={billTextChips(answeringBill?.policyAreas?.[0])}
                onAsk={askFollowUp}
              />
              <View style={styles.shareRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isWeb ? 'Copy link to this answer' : 'Share this answer'}
                  style={styles.shareButton}
                  onPress={() => void copyLink()}
                >
                  <Text style={styles.shareButtonText}>
                    {copied ? 'Link copied' : isWeb ? 'Copy link' : 'Share'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : noMatches ? (
            <View style={styles.answerBlock}>
              <Text style={styles.eyebrow}>NO MATCHES</Text>
              <Text style={styles.question}>{question}</Text>
              <Text style={styles.introLine}>
                {isLegislators
                  ? 'No current-session legislators are on the record for'
                  : 'No current-session bills match'}{' '}
                {answer?.topic ? (
                  <Text style={styles.topicPill}> {answer.topic} </Text>
                ) : (
                  <Text>this topic</Text>
                )}
                . Try another issue, or browse everything in Search.
              </Text>
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  navigation.navigate('Bills', answer?.topic ? { q: answer.topic } : undefined)
                }
              >
                <Text style={styles.viewBillLink}>Search all bills →</Text>
              </Pressable>
            </View>
          ) : hasMatches && answer && isLegislators ? (
            <View style={styles.answerBlock}>
              <Text style={styles.eyebrow}>ANSWER</Text>
              <Text style={styles.question}>{question}</Text>
              {/* Fixed framing copy owned by the layout, never LLM output
                  (docs/grounded-ask-spec.md §4.3; .claude/rules/grounded-answers.md rule 3). */}
              <Text style={styles.framingNote}>
                “Support” shown as what the public record shows: bills authored or co-authored on
                this topic — not inferred opinions.
              </Text>
              <Text style={styles.introLine}>
                Legislators on the record for
                <Text style={styles.topicPill}> {answer.topic} </Text>, grouped by chamber:
              </Text>
              <Text style={styles.provenance}>
                {shownLegislators.length} of {answer.totalMatches} legislators
                {answer.sessionName ? ` · ${answer.sessionName}` : ''}
                {dataAsOf ? ` · Data as of ${dataAsOf}` : ''}
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
                          legislatorId: legislator.id,
                        })
                      }
                      onOpenBill={(billId) => navigation.navigate('BillDetail', { billId })}
                    />
                  ))}
                </View>
              ))}
              {answer.totalBills && answer.totalBills > 0 ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() =>
                    navigation.navigate('Bills', answer.topic ? { q: answer.topic } : undefined)
                  }
                >
                  <Text style={styles.viewBillLink}>
                    See all {answer.totalBills} {answer.topic}{' '}
                    {answer.totalBills === 1 ? 'bill' : 'bills'} in Search →
                  </Text>
                </Pressable>
              ) : null}
              <FollowUpChips chips={followUpChips} onAsk={askFollowUp} />
              <View style={styles.shareRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isWeb ? 'Copy link to this answer' : 'Share this answer'}
                  style={styles.shareButton}
                  onPress={() => void copyLink()}
                >
                  <Text style={styles.shareButtonText}>
                    {copied ? 'Link copied' : isWeb ? 'Copy link' : 'Share'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : hasMatches && answer ? (
            <View style={styles.answerBlock}>
              <Text style={styles.eyebrow}>ANSWER</Text>
              <Text style={styles.question}>{question}</Text>
              <Text style={styles.introLine}>
                Current-session bills matching
                <Text style={styles.topicPill}> {answer.topic} </Text>, by legislative progress:
              </Text>
              <Text style={styles.provenance}>
                {shownBills.length} of {answer.totalMatches} matching bills
                {answer.sessionName ? ` · ${answer.sessionName}` : ''}
                {dataAsOf ? ` · Data as of ${dataAsOf}` : ''}
              </Text>
              <View style={styles.cardsColumn}>
                {shownBills.map((bill) => (
                  <AnswerBillCard
                    key={bill.id}
                    bill={bill}
                    tracked={isSignedIn && trackedIds.has(bill.id)}
                    onOpen={() => navigation.navigate('BillDetail', { billId: bill.id })}
                    onTrack={() => handleTrack(bill.id)}
                  />
                ))}
              </View>
              {answer.totalMatches > shownBills.length ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() =>
                    navigation.navigate('Bills', answer.topic ? { q: answer.topic } : undefined)
                  }
                >
                  <Text style={styles.viewBillLink}>
                    See all {answer.totalMatches} {answer.topic} bills in Search →
                  </Text>
                </Pressable>
              ) : null}
              <FollowUpChips chips={followUpChips} onAsk={askFollowUp} />
              <View style={styles.shareRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isWeb ? 'Copy link to this answer' : 'Share this answer'}
                  style={styles.shareButton}
                  onPress={() => void copyLink()}
                >
                  <Text style={styles.shareButtonText}>
                    {copied ? 'Link copied' : isWeb ? 'Copy link' : 'Share'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </Container>
        <Footer
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
  navWrap: {
    zIndex: 10,
  },
  body: {
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.xxl,
    flexGrow: 1,
  },
  askBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: t.radii.lg,
    paddingLeft: t.spacing.md,
    paddingRight: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    marginBottom: t.spacing.xl,
  },
  askInput: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: 15,
    color: t.colors.text.primary,
    paddingVertical: t.spacing.sm,
    ...(isWeb ? ({ outlineStyle: 'none' } as object) : null),
  },
  askButton: {
    backgroundColor: t.colors.brand.base,
    borderRadius: t.radii.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
  },
  askButtonText: {
    fontFamily: t.typography.ui,
    fontWeight: '700',
    fontSize: 14,
    color: t.colors.text.onGreen,
  },
  centerBlock: {
    alignItems: 'center',
    gap: t.spacing.md,
    paddingVertical: t.spacing.xxl,
  },
  errorText: {
    fontFamily: t.typography.body,
    fontSize: 15,
    color: t.colors.text.secondary,
  },
  answerBlock: {
    gap: t.spacing.md,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  eyebrow: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    letterSpacing: 1.4,
    color: t.colors.text.green,
    fontWeight: '700',
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
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
  // Out-of-scope is a calm, muted state — not an answer, not "coming soon".
  eyebrowMuted: {
    color: t.colors.text.muted,
  },
  question: {
    fontFamily: t.typography.title,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: t.colors.text.primary,
  },
  introLine: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
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
  billTextProse: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 25,
    color: t.colors.text.primary,
  },
  sourcesBlock: {
    gap: t.spacing.sm,
  },
  sourcesHeading: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    letterSpacing: 1.2,
    fontWeight: '700',
    color: t.colors.text.secondary,
  },
  citationCard: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: t.radii.card,
    padding: t.spacing.md,
    gap: 6,
  },
  citationLabel: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: '700',
    color: t.colors.text.secondary,
  },
  citationExcerpt: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
    color: t.colors.text.primary,
  },
  // Gray external link — the §9.4 grammar: gray ↗ leaves the app to the record.
  citationLink: {
    fontFamily: t.typography.ui,
    fontSize: 13,
    fontWeight: '700',
    color: t.colors.text.muted,
  },
  cardsColumn: {
    gap: t.spacing.md,
  },
  followupBlock: {
    gap: t.spacing.sm,
  },
  followupHeading: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    letterSpacing: 1.2,
    fontWeight: '700',
    color: t.colors.text.secondary,
  },
  followupRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
  },
  followupChip: {
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: t.radii.badge,
    backgroundColor: t.colors.surfaces.base,
    ...(isWeb
      ? ({ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 } as object)
      : { paddingHorizontal: 12, paddingVertical: 8 }),
  },
  followupChipText: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.brand.deep,
  },
  framingNote: {
    fontFamily: t.typography.body,
    fontSize: 13,
    lineHeight: 19,
    fontStyle: 'italic',
    color: t.colors.text.muted,
  },
  chamberGroup: {
    gap: t.spacing.sm,
  },
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
  legNameCol: {
    flexShrink: 1,
    gap: 2,
  },
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
  billPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  billPill: {
    backgroundColor: t.colors.tint.t150,
    borderRadius: t.radii.badge,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  billPillText: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: '700',
    color: t.colors.brand.deep,
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
    backgroundColor: t.colors.tint.t150,
    borderRadius: t.radii.badge,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  billBadgeText: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: '700',
    color: t.colors.brand.deep,
  },
  billStatus: {
    fontFamily: t.typography.ui,
    fontSize: 13,
    fontWeight: '600',
  },
  trackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.colors.footerBg,
    borderRadius: t.radii.md,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 6,
  },
  trackButtonText: {
    fontFamily: t.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    color: t.colors.surfaces.base,
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
  shareRow: {
    flexDirection: 'row',
    marginTop: t.spacing.sm,
  },
  shareButton: {
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: t.radii.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs,
    backgroundColor: t.colors.surfaces.base,
  },
  shareButtonText: {
    fontFamily: t.typography.ui,
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.text.secondary,
  },
});
