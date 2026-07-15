import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, Check } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import { useBill, useToggleTrackedBill, useTrackedBills } from '../hooks/useAppQueries';
import { RootStackParamList } from '../navigation/types';
import { trackSignInReturnTo } from '../navigation/webRoutes';
import { useAuth } from '../providers/AuthProvider';
import { titleCaseIssue } from '../lib/issues';
import { theme } from '../theme/tokens';
import { useResponsive } from '../hooks/useResponsive';
import type { BillSponsor } from '../data/types';

type DetailTab = 'Summary' | 'Actions' | 'Versions' | 'Votes';
type Props = NativeStackScreenProps<RootStackParamList, 'BillDetail'>;

// The URL uses a lowercase tab slug; the UI uses the capitalized label. Keeping
// the tab URL-addressable (e.g. /bills/{id}?tab=votes) is a grounded-answer
// requirement (grounded-answers.md rule 5; docs/grounded-ask-spec.md §9.3).
const TAB_SLUGS: Record<DetailTab, 'summary' | 'actions' | 'versions' | 'votes'> = {
  Summary: 'summary',
  Actions: 'actions',
  Versions: 'versions',
  Votes: 'votes',
};
const TAB_FROM_SLUG: Record<string, DetailTab> = {
  summary: 'Summary',
  actions: 'Actions',
  versions: 'Versions',
  votes: 'Votes',
};
const pendingBillChatStorageKey = 'alethical.pendingBillChat';

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <Text style={styles.bodyText}>{message}</Text>
    </Card>
  );
}

export function BillDetailScreen({ route, navigation }: Props) {
  const { billId } = route.params;
  const { isDesktop } = useResponsive();
  const { isSignedIn, signInWithGoogle, user } = useAuth();
  const [tab, setTab] = useState<DetailTab>(
    (route.params.tab && TAB_FROM_SLUG[route.params.tab]) || 'Summary',
  );

  // Switching tabs updates the shareable URL (?tab=votes); Summary is the clean
  // default (/bills/{id} with no query).
  const selectTab = (value: DetailTab) => {
    setTab(value);
    navigation.setParams({
      tab: value === 'Summary' ? undefined : TAB_SLUGS[value],
    });
  };
  const billQuery = useBill(billId);
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);

  const bill = billQuery.data;
  const trackedIds = useMemo(
    () => new Set((trackedQuery.data ?? []).map((item) => item.id)),
    [trackedQuery.data],
  );

  // Intent-preserving track: a signed-out user who tapped Track was sent through
  // sign-in and back here with ?track=1. Once signed in and the tracked list has
  // loaded, complete the track (unless already tracked) and clear the param so a
  // refresh doesn't re-trigger it.
  const autoTrackFired = useRef(false);
  useEffect(() => {
    if (!route.params.track || !isSignedIn || !bill || trackedQuery.isLoading) {
      return;
    }
    if (!autoTrackFired.current && !trackedIds.has(bill.id)) {
      autoTrackFired.current = true;
      toggleTrackedBill.mutate(bill.id);
    }
    navigation.setParams({ track: undefined });
  }, [
    route.params.track,
    isSignedIn,
    bill,
    trackedQuery.isLoading,
    trackedIds,
    toggleTrackedBill,
    navigation,
  ]);

  if (billQuery.isLoading) {
    return (
      <ScreenView title="Loading bill" subtitle="Fetching the latest bill detail from the backend.">
        <Card>
          <Text style={styles.bodyText}>
            Loading official status, actions, versions, and votes.
          </Text>
        </Card>
      </ScreenView>
    );
  }

  if (!bill?.aiAnalysis) {
    return (
      <ScreenView
        title="Bill not found"
        subtitle="This bill does not have AI enrichment available in Bill Explorer."
      >
        <Card>
          <Text style={styles.bodyText}>
            {billQuery.error instanceof Error
              ? billQuery.error.message
              : 'Try returning to search or the home screen.'}
          </Text>
        </Card>
      </ScreenView>
    );
  }

  const tracked = trackedIds.has(bill.id);
  const analysis = bill.aiAnalysis;
  const sponsors: BillSponsor[] =
    bill.sponsors ??
    bill.sponsorNames.map((name, index) => ({
      name,
      role: 'chief_author',
      legislatorId: bill.chiefSponsorIds[index],
    }));
  const chiefAuthors = sponsors.filter((sponsor) => sponsor.role === 'chief_author');
  const coAuthors = sponsors.filter((sponsor) => sponsor.role !== 'chief_author');
  const progressSteps = bill.progress ?? [];
  const headerMeta = [
    bill.chamber,
    bill.status,
    bill.updatedAt !== 'Unknown' ? `Updated ${bill.updatedAt}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
  const chatParams = {
    title: `${bill.identifier} analysis`,
    subjectType: 'bill' as const,
    subjectId: bill.id,
    subjectLabel: bill.identifier,
  };
  const goBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Tabs', { screen: 'Home' });
  };

  return (
    <ScreenView hideHeader>
      {isDesktop ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to results"
          onPress={goBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <ArrowLeft color={theme.colors.ink} size={18} strokeWidth={2.2} />
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
      ) : null}
      <Card style={styles.analysisCard}>
        <View style={styles.compactHeader}>
          <View style={styles.compactTitleWrap}>
            <Text style={styles.identifier}>{bill.identifier}</Text>
            <Text style={styles.compactMeta}>{headerMeta}</Text>
            <View style={styles.sponsorRow}>
              <Text style={styles.sponsorText}>Author: </Text>
              {chiefAuthors.length > 0 ? (
                chiefAuthors.map((sponsor, index) => {
                  const clickable = Boolean(sponsor.legislatorId);
                  return (
                    <Pressable
                      key={`${sponsor.legislatorId ?? sponsor.name}-${index}`}
                      accessibilityRole={clickable ? 'link' : undefined}
                      disabled={!clickable}
                      onPress={() => {
                        if (sponsor.legislatorId) {
                          navigation.navigate('LegislatorProfile', {
                            legislatorId: sponsor.legislatorId,
                          });
                        }
                      }}
                    >
                      <Text style={[styles.sponsorText, clickable && styles.sponsorLink]}>
                        {sponsor.name}
                        {index < chiefAuthors.length - 1 ? ', ' : ''}
                      </Text>
                    </Pressable>
                  );
                })
              ) : (
                <Text style={styles.sponsorText}>Unavailable</Text>
              )}
            </View>
          </View>
          <View style={styles.compactActions}>
            <PrimaryButton
              label={tracked ? 'Tracked' : 'Track'}
              onPress={() => {
                if (!isSignedIn) {
                  void signInWithGoogle(trackSignInReturnTo(bill.id));
                  return;
                }
                toggleTrackedBill.mutate(bill.id);
              }}
            />
            <PrimaryButton
              label="Share"
              tone="secondary"
              onPress={() =>
                void Share.share({
                  message: `${bill.identifier}: ${analysis?.summary ?? bill.title}`,
                })
              }
            />
            <PrimaryButton
              label="Ask AI"
              tone="secondary"
              onPress={() => {
                if (Platform.OS === 'web' && typeof window !== 'undefined') {
                  const params = new URLSearchParams();
                  params.set('title', chatParams.title);
                  params.set('subjectType', chatParams.subjectType);
                  params.set('subjectId', chatParams.subjectId);
                  params.set('subjectLabel', chatParams.subjectLabel);
                  window.sessionStorage.setItem(
                    pendingBillChatStorageKey,
                    JSON.stringify(chatParams),
                  );
                  window.history.pushState({}, '', `/chat/new?${params.toString()}`);
                }
                navigation.navigate('ChatSession', {
                  title: chatParams.title,
                  subjectType: chatParams.subjectType,
                  subjectId: chatParams.subjectId,
                  subjectLabel: chatParams.subjectLabel,
                });
              }}
            />
          </View>
        </View>
        <Text style={styles.leadText}>{analysis.summary}</Text>
        <View style={styles.policyAreaWrap}>
          {analysis.policyAreas.map((area) => (
            <View key={area} style={styles.policyPill}>
              <Text style={styles.policyPillText}>{titleCaseIssue(area)}</Text>
            </View>
          ))}
        </View>
        <View style={styles.keyPointStack}>
          <Text style={styles.sectionTitle}>Key Points</Text>
          {analysis.keyPoints.length > 0 ? (
            analysis.keyPoints.map((point, index) => (
              <View key={`${index}-${point}`} style={styles.keyPointRow}>
                <View style={styles.keyPointNumber}>
                  <Text style={styles.keyPointNumberText}>{index + 1}</Text>
                </View>
                <Text style={styles.keyPointText}>{point}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.bodyText}>No key points are available yet.</Text>
          )}
        </View>
      </Card>

      <Card style={styles.progressCard}>
        <Text style={styles.sectionTitle}>Legislative Progress</Text>
        <View style={styles.progressRow}>
          {progressSteps.map((step, index) => (
            <View key={step.key} style={styles.progressStep}>
              <View style={styles.progressMarkerRow}>
                <View
                  style={[
                    styles.progressLine,
                    index === 0 && styles.progressLineHidden,
                    progressSteps[index - 1]?.reached && step.reached && styles.progressLineReached,
                  ]}
                />
                <View
                  style={[
                    styles.progressDot,
                    step.reached && styles.progressDotReached,
                    step.current && styles.progressDotCurrent,
                  ]}
                >
                  {step.reached ? (
                    <Check color={theme.colors.white} size={14} strokeWidth={3} />
                  ) : (
                    <Text style={styles.progressDotText}>{index + 1}</Text>
                  )}
                </View>
                <View
                  style={[
                    styles.progressLine,
                    index === progressSteps.length - 1 && styles.progressLineHidden,
                    step.reached && progressSteps[index + 1]?.reached && styles.progressLineReached,
                  ]}
                />
              </View>
              <Text style={[styles.progressLabel, !step.reached && styles.progressLabelMuted]}>
                {step.label}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      <Card style={styles.authorsCard}>
        <Text style={styles.sectionTitle}>Legislative Authors</Text>
        {chiefAuthors.length > 0 ? (
          <View style={styles.chiefAuthorPanel}>
            <Text style={styles.authorRoleLabel}>Chief Author</Text>
            {chiefAuthors.map((author) => (
              <Pressable
                key={author.legislatorId ?? author.name}
                disabled={!author.legislatorId}
                onPress={() => {
                  if (author.legislatorId) {
                    navigation.navigate('LegislatorProfile', { legislatorId: author.legislatorId });
                  }
                }}
                style={styles.authorLine}
              >
                <View style={styles.authorTextBlock}>
                  <Text style={styles.authorName}>{author.name}</Text>
                  <Text style={styles.authorMeta}>
                    {[author.chamber, author.district].filter(Boolean).join(' | ')}
                  </Text>
                </View>
                {author.party ? <Text style={styles.partyBadge}>{author.party}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.bodyText}>No chief author is available yet.</Text>
        )}
        {coAuthors.length > 0 ? (
          <>
            <Text style={styles.authorGroupTitle}>Co-authors</Text>
            <View style={[styles.coAuthorGrid, isDesktop && styles.coAuthorGridDesktop]}>
              {coAuthors.map((author) => (
                <Pressable
                  key={`${author.legislatorId ?? author.name}-${author.role}`}
                  disabled={!author.legislatorId}
                  onPress={() => {
                    if (author.legislatorId) {
                      navigation.navigate('LegislatorProfile', {
                        legislatorId: author.legislatorId,
                      });
                    }
                  }}
                  style={[styles.coAuthorItem, isDesktop && styles.coAuthorItemDesktop]}
                >
                  <View style={styles.authorTextBlock}>
                    <Text style={styles.coAuthorName}>{author.name}</Text>
                    <Text style={styles.authorMeta}>
                      {[author.chamber, author.district].filter(Boolean).join(' | ')}
                    </Text>
                  </View>
                  {author.party ? <Text style={styles.partyBadge}>{author.party}</Text> : null}
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </Card>

      <View style={styles.tabRow}>
        {(['Summary', 'Actions', 'Versions', 'Votes'] as DetailTab[]).map((value) => (
          <Chip
            key={value}
            label={value}
            selected={tab === value}
            onPress={() => selectTab(value)}
          />
        ))}
      </View>

      {tab === 'Summary' ? (
        <View style={[styles.summaryGrid, isDesktop && styles.summaryGridDesktop]}>
          <View style={styles.mainColumn}>
            <Card>
              <Text style={styles.snapshotTitle}>Bill Snapshot</Text>
              <Text style={styles.bodyText}>
                {bill.actionCount} actions | {bill.versionCount} versions | {bill.rollCallCount}{' '}
                roll calls
              </Text>
            </Card>
            <Card>
              <Text style={styles.snapshotTitle}>Official Sources</Text>
              {bill.officialLinks.length > 0 ? (
                bill.officialLinks.map((link) => (
                  <PrimaryButton
                    key={link.id}
                    label={link.label}
                    tone="secondary"
                    onPress={() => void Linking.openURL(link.url)}
                  />
                ))
              ) : (
                <Text style={styles.bodyText}>No official source link is available yet.</Text>
              )}
            </Card>
          </View>
        </View>
      ) : null}

      {tab === 'Actions' ? (
        <View style={styles.stack}>
          {bill.actions.length > 0 ? (
            bill.actions.map((action) => (
              <Card key={action.id}>
                {action.date ? <Text style={styles.actionDate}>{action.date}</Text> : null}
                <Text style={styles.bodyText}>{action.description}</Text>
              </Card>
            ))
          ) : (
            <EmptyState message="No useful action timeline is available yet for this bill." />
          )}
        </View>
      ) : null}

      {tab === 'Versions' ? (
        <View style={styles.stack}>
          {bill.versions.length > 0 ? (
            bill.versions.map((version) => (
              <Card key={version.id}>
                <Text style={styles.snapshotTitle}>{version.label}</Text>
                <Text style={styles.bodyText}>{version.date}</Text>
                <Text style={styles.bodyText}>{version.summary}</Text>
                {version.url ? (
                  <PrimaryButton
                    label="Open Official Text"
                    tone="secondary"
                    onPress={() => void Linking.openURL(version.url)}
                  />
                ) : null}
              </Card>
            ))
          ) : (
            <EmptyState message="No bill text versions are available yet for this bill." />
          )}
        </View>
      ) : null}

      {tab === 'Votes' ? (
        <View style={styles.stack}>
          {bill.votes.length === 0 ? (
            <EmptyState message="No roll call votes are available yet for this bill." />
          ) : (
            bill.votes.map((vote) => (
              <Card key={vote.id}>
                <Text style={styles.snapshotTitle}>{vote.motion}</Text>
                <Text style={styles.bodyText}>{vote.date}</Text>
                <Text style={styles.bodyText}>{vote.result}</Text>
                <PrimaryButton
                  label="Open Vote Detail"
                  tone="secondary"
                  onPress={() =>
                    navigation.navigate('VoteDetail', { billId: bill.id, voteEventId: vote.id })
                  }
                />
              </Card>
            ))
          )}
        </View>
      ) : null}
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  compactHeader: {
    gap: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing.md,
  },
  backButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 8,
    backgroundColor: theme.colors.surface,
  },
  backButtonText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  pressed: {
    opacity: 0.72,
  },
  compactTitleWrap: {
    gap: theme.spacing.xs,
  },
  identifier: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  compactMeta: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  compactActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  sponsorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
  },
  sponsorText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 14,
    lineHeight: 20,
  },
  sponsorLink: {
    color: theme.colors.accent,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  analysisCard: {
    gap: theme.spacing.md,
  },
  progressCard: {
    gap: theme.spacing.md,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressStep: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  progressMarkerRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.surfaceAlt,
  },
  progressLineReached: {
    backgroundColor: theme.colors.ink,
  },
  progressLineHidden: {
    backgroundColor: 'transparent',
  },
  progressDot: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  progressDotReached: {
    backgroundColor: theme.colors.ink,
  },
  progressDotCurrent: {
    borderWidth: 2,
    borderColor: theme.colors.accent,
  },
  progressDotText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 11,
    fontWeight: '700',
  },
  progressDotTextReached: {
    color: theme.colors.white,
  },
  progressLabel: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 13,
    paddingHorizontal: 2,
  },
  progressLabelMuted: {
    color: theme.colors.mutedInk,
  },
  authorsCard: {
    gap: theme.spacing.md,
  },
  chiefAuthorPanel: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.primarySoft,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  authorRoleLabel: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  authorLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  authorTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  authorName: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 17,
    fontWeight: '700',
  },
  authorMeta: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.ui,
    fontSize: 13,
    marginTop: 2,
  },
  partyBadge: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
  },
  authorGroupTitle: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  coAuthorGrid: {
    gap: theme.spacing.sm,
  },
  coAuthorGridDesktop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  coAuthorItem: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
  },
  coAuthorItemDesktop: {
    flexBasis: '48%',
  },
  coAuthorName: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 15,
    fontWeight: '700',
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  policyAreaWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  policyPill: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.primarySoft,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
  },
  policyPillText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  keyPointStack: {
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  keyPointRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
  },
  keyPointNumber: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.ink,
    flexShrink: 0,
  },
  keyPointNumberText: {
    color: theme.colors.white,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
  },
  keyPointText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  summaryGrid: {
    gap: theme.spacing.md,
  },
  summaryGridDesktop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  mainColumn: {
    flex: 1.7,
    gap: theme.spacing.md,
    minWidth: 0,
  },
  bodyText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
  leadText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 18,
    lineHeight: 28,
  },
  snapshotTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 22,
  },
  actionDate: {
    color: theme.colors.accent,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  stack: {
    gap: theme.spacing.md,
  },
});
