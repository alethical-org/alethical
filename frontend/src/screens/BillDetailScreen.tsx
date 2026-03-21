import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { PrimaryButton } from '../components/PrimaryButton';
import { PromptLink } from '../components/PromptLink';
import { ScreenView } from '../components/ScreenView';
import { SectionCard } from '../components/SectionCard';
import { useBill, useToggleTrackedBill, useTrackedBills } from '../hooks/useAppQueries';
import { RootStackParamList } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { theme } from '../theme/tokens';
import { useResponsive } from '../hooks/useResponsive';

type DetailTab = 'Summary' | 'Actions' | 'Versions' | 'Votes';
type Props = NativeStackScreenProps<RootStackParamList, 'BillDetail'>;

export function BillDetailScreen({ route, navigation }: Props) {
  const { billId } = route.params;
  const { isDesktop } = useResponsive();
  const { user } = useAuth();
  const [tab, setTab] = useState<DetailTab>('Summary');
  const billQuery = useBill(billId);
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);

  const bill = billQuery.data;
  const trackedIds = useMemo(() => new Set((trackedQuery.data ?? []).map((item) => item.id)), [trackedQuery.data]);

  if (!bill) {
    return (
      <ScreenView title="Bill not found" subtitle="This bill could not be loaded in the current demo dataset.">
        <Card>
          <Text style={styles.bodyText}>Try returning to search or the home screen.</Text>
        </Card>
      </ScreenView>
    );
  }

  const tracked = trackedIds.has(bill.id);

  return (
    <ScreenView
      title={bill.identifier}
      subtitle={`${bill.title}\n${bill.chamber} | ${bill.status} | Updated ${bill.updatedAt}`}
      actions={
        <>
          <PrimaryButton label={tracked ? 'Tracked' : 'Track'} onPress={() => toggleTrackedBill.mutate(bill.id)} />
          <PrimaryButton
            label="Open Chat"
            tone="secondary"
            onPress={() =>
              navigation.navigate('ChatSession', {
                title: `${bill.identifier} briefing`,
                seedPrompt: `Explain ${bill.identifier} in plain language.`,
                subjectType: 'bill',
                subjectId: bill.id,
                subjectLabel: bill.identifier,
              })
            }
          />
        </>
      }
    >
      <View style={styles.tabRow}>
        {(['Summary', 'Actions', 'Versions', 'Votes'] as DetailTab[]).map((value) => (
          <Chip key={value} label={value} selected={tab === value} onPress={() => setTab(value)} />
        ))}
      </View>

      <Card style={styles.billMetaCard}>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Session</Text>
          <Text style={styles.metaValue}>{bill.sessionLabel}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Status</Text>
          <Text style={styles.metaValue}>{bill.status}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Updated</Text>
          <Text style={styles.metaValue}>{bill.updatedAt}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Chamber</Text>
          <Text style={styles.metaValue}>{bill.chamber}</Text>
        </View>
      </Card>

      {tab === 'Summary' ? (
        <View style={[styles.summaryGrid, isDesktop && styles.summaryGridDesktop]}>
          <View style={styles.mainColumn}>
            <SectionCard title="What This Bill Does" eyebrow="Civic briefing">
              <Text style={styles.leadText}>{bill.briefing.what}</Text>
            </SectionCard>
            <View style={[styles.briefingGrid, isDesktop && styles.briefingGridDesktop]}>
              <SectionCard title="Why It Matters" style={styles.halfPanel}>
                <Text style={styles.bodyText}>{bill.briefing.why}</Text>
              </SectionCard>
              <SectionCard title="Who Is Affected" style={styles.halfPanel}>
                {bill.briefing.whoAffected.map((item) => (
                  <Text key={item} style={styles.listItem}>
                    • {item}
                  </Text>
                ))}
              </SectionCard>
            </View>
            <View style={[styles.briefingGrid, isDesktop && styles.briefingGridDesktop]}>
              <SectionCard title="Key Changes" style={styles.halfPanel}>
                {bill.briefing.keyChanges.map((item) => (
                  <Text key={item} style={styles.listItem}>
                    • {item}
                  </Text>
                ))}
              </SectionCard>
              <SectionCard title="Questions To Ask" style={styles.halfPanel}>
                <View style={styles.promptStack}>
                  {bill.questionPrompts.map((prompt) => (
                    <PromptLink
                      key={prompt}
                      prompt={prompt}
                      onPress={() =>
                        navigation.navigate('ChatSession', {
                          title: `${bill.identifier} question`,
                          seedPrompt: prompt,
                          subjectType: 'bill',
                          subjectId: bill.id,
                          subjectLabel: bill.identifier,
                        })
                      }
                    />
                  ))}
                </View>
              </SectionCard>
            </View>
            <SectionCard title="Debate Landscape" eyebrow="At a glance">
              <View style={[styles.briefingGrid, isDesktop && styles.briefingGridDesktop]}>
                <View style={styles.argumentColumn}>
                  <Text style={styles.argumentTitle}>Supporters May Say</Text>
                  {bill.briefing.supportersMaySay.map((item) => (
                    <Text key={item} style={styles.listItem}>
                      • {item}
                    </Text>
                  ))}
                </View>
                <View style={[styles.argumentColumn, isDesktop && styles.argumentColumnRight]}>
                  <Text style={styles.argumentTitle}>Concerns Some May Raise</Text>
                  {bill.briefing.concernsMayRaise.map((item) => (
                    <Text key={item} style={styles.listItem}>
                      • {item}
                    </Text>
                  ))}
                </View>
              </View>
            </SectionCard>
          </View>

          <View style={[styles.sideColumn, isDesktop && styles.sideColumnDesktop]}>
            <Card>
              <Text style={styles.snapshotTitle}>Bill Snapshot</Text>
              <Text style={styles.bodyText}>Chief sponsors: {bill.sponsorNames.join(', ')}</Text>
              <Text style={styles.bodyText}>Topics: {bill.topics.join(', ')}</Text>
              <Text style={styles.bodyText}>
                {bill.actionCount} actions | {bill.versionCount} versions | {bill.rollCallCount} roll calls
              </Text>
            </Card>
            <Card>
              <Text style={styles.snapshotTitle}>Official Sources</Text>
              {bill.officialLinks.map((link) => (
                <PrimaryButton
                  key={link.id}
                  label={link.label}
                  tone="secondary"
                  onPress={() => void Linking.openURL(link.url)}
                />
              ))}
            </Card>
            <Card>
              <Text style={styles.snapshotTitle}>Citations</Text>
              {bill.citations.map((citation) => (
                <View key={citation.id} style={styles.citationBlock}>
                  <Text style={styles.citationLabel}>{citation.label}</Text>
                  <Text style={styles.bodyText}>{citation.excerpt}</Text>
                </View>
              ))}
            </Card>
          </View>
        </View>
      ) : null}

      {tab === 'Actions' ? (
        <View style={styles.stack}>
          {bill.actions.map((action) => (
            <Card key={action.id}>
              <Text style={styles.snapshotTitle}>{action.date}</Text>
              <Text style={styles.bodyText}>{action.description}</Text>
            </Card>
          ))}
        </View>
      ) : null}

      {tab === 'Versions' ? (
        <View style={styles.stack}>
          {bill.versions.map((version) => (
            <Card key={version.id}>
              <Text style={styles.snapshotTitle}>{version.label}</Text>
              <Text style={styles.bodyText}>{version.date}</Text>
              <Text style={styles.bodyText}>{version.summary}</Text>
              <PrimaryButton label="Open Official Text" tone="secondary" onPress={() => void Linking.openURL(version.url)} />
            </Card>
          ))}
        </View>
      ) : null}

      {tab === 'Votes' ? (
        <View style={styles.stack}>
          {bill.votes.length === 0 ? (
            <Card>
              <Text style={styles.bodyText}>No roll call votes are available yet for this bill.</Text>
            </Card>
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
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  billMetaCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 0,
  },
  metaCell: {
    minWidth: 180,
    flex: 1,
    padding: theme.spacing.md,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs,
  },
  metaLabel: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  metaValue: {
    color: theme.colors.ink,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    textTransform: 'uppercase',
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
  sideColumn: {
    flex: 1,
    gap: theme.spacing.md,
    minWidth: 0,
  },
  sideColumnDesktop: {
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    paddingLeft: theme.spacing.md,
  },
  briefingGrid: {
    gap: theme.spacing.md,
    minWidth: 0,
  },
  briefingGridDesktop: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  halfPanel: {
    flex: 1,
    minWidth: 0,
  },
  argumentColumn: {
    flex: 1,
    gap: theme.spacing.sm,
    minWidth: 0,
  },
  argumentColumnRight: {
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    paddingLeft: theme.spacing.md,
  },
  argumentTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.3,
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
    fontSize: 22,
    lineHeight: 34,
  },
  listItem: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 24,
  },
  promptRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  promptStack: {
    gap: 0,
  },
  snapshotTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 22,
  },
  citationBlock: {
    gap: theme.spacing.xs,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  citationLabel: {
    color: theme.colors.accent,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  stack: {
    gap: theme.spacing.md,
  },
});
