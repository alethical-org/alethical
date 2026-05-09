import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';

import { BillCard } from '../components/BillCard';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { PromptLink } from '../components/PromptLink';
import { ScreenView } from '../components/ScreenView';
import { SectionCard } from '../components/SectionCard';
import { useLegislator, useLegislatorBills, useToggleTrackedBill, useTrackedBills } from '../hooks/useAppQueries';
import { RootStackParamList } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { theme } from '../theme/tokens';
import { useResponsive } from '../hooks/useResponsive';

type Props = NativeStackScreenProps<RootStackParamList, 'LegislatorProfile'>;

export function LegislatorProfileScreen({ route, navigation }: Props) {
  const { isDesktop } = useResponsive();
  const { user } = useAuth();
  const legislatorQuery = useLegislator(route.params.legislatorId);
  const billsQuery = useLegislatorBills(route.params.legislatorId);
  const trackedQuery = useTrackedBills(user?.id);
  const toggleTrackedBill = useToggleTrackedBill(user?.id);

  const legislator = legislatorQuery.data;
  const trackedIds = new Set((trackedQuery.data ?? []).map((item) => item.id));

  if (legislatorQuery.isLoading) {
    return (
      <ScreenView title="Loading legislator" subtitle="Fetching the latest profile from the backend.">
        <Card>
          <Text style={styles.bodyText}>Loading current service, committees, stats, and sponsored bills.</Text>
        </Card>
      </ScreenView>
    );
  }

  if (!legislator) {
    return (
      <ScreenView title="Legislator not found" subtitle="This profile could not be loaded from the backend.">
        <Card>
          <Text style={styles.bodyText}>
            {legislatorQuery.error instanceof Error ? legislatorQuery.error.message : 'Try returning to search.'}
          </Text>
        </Card>
      </ScreenView>
    );
  }

  return (
    <ScreenView
      title={legislator.name}
      subtitle={`${legislator.chamber} | District ${legislator.district} | ${legislator.party}`}
      actions={
        <PrimaryButton
          label="Ask About This Legislator"
          onPress={() =>
            navigation.navigate('ChatSession', {
              title: `${legislator.shortName} profile`,
              seedPrompt: `Summarize ${legislator.name}'s current session work.`,
              subjectType: 'legislator',
              subjectId: legislator.id,
              subjectLabel: legislator.name,
            })
          }
        />
      }
    >
      <Card style={styles.metaCard}>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Current Role</Text>
          <Text style={styles.metaValue}>{legislator.role}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>District</Text>
          <Text style={styles.metaValue}>{legislator.district}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Party</Text>
          <Text style={styles.metaValue}>{legislator.party}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Committees</Text>
          <Text style={styles.metaValue}>{legislator.committees.length}</Text>
        </View>
      </Card>
      <View style={[styles.grid, isDesktop && styles.gridDesktop]}>
        <View style={styles.mainColumn}>
          <SectionCard title="Profile">
            <Text style={styles.bodyText}>{legislator.bio}</Text>
          </SectionCard>
          <SectionCard title="Committees">
            {legislator.committees.length > 0 ? (
              legislator.committees.map((committee) => (
                <Text key={committee} style={styles.listItem}>
                  • {committee}
                </Text>
              ))
            ) : (
              <Text style={styles.bodyText}>No committee memberships are available yet.</Text>
            )}
          </SectionCard>
          <SectionCard title="Sponsored Bills">
            <View style={styles.stack}>
              {billsQuery.isLoading ? (
                <Card>
                  <Text style={styles.bodyText}>Loading sponsored bills.</Text>
                </Card>
              ) : null}
              {billsQuery.error ? (
                <Card>
                  <Text style={styles.bodyText}>
                    {billsQuery.error instanceof Error ? billsQuery.error.message : 'Sponsored bills could not be loaded.'}
                  </Text>
                </Card>
              ) : null}
              {!billsQuery.isLoading && !billsQuery.error && (billsQuery.data ?? []).length === 0 ? (
                <Card>
                  <Text style={styles.bodyText}>No sponsored bills are available yet.</Text>
                </Card>
              ) : null}
              {(billsQuery.data ?? []).map((bill) => (
                <BillCard
                  key={bill.id}
                  bill={bill}
                  tracked={trackedIds.has(bill.id)}
                  onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
                  onToggleTrack={() => toggleTrackedBill.mutate(bill.id)}
                />
              ))}
            </View>
          </SectionCard>
        </View>

        <View style={[styles.sideColumn, isDesktop && styles.sideColumnDesktop]}>
          <Card>
            <Text style={styles.cardTitle}>Current Service</Text>
            <Text style={styles.bodyText}>{legislator.role}</Text>
            <Text style={styles.bodyText}>Focus areas: {legislator.focusAreas.join(', ') || 'Unavailable'}</Text>
          </Card>
          <Card>
            <Text style={styles.cardTitle}>Service History</Text>
            {legislator.serviceHistory.map((service) => (
              <Text key={service.id} style={styles.listItem}>
                • {service.startYear}-{service.endYear ?? 'present'} {service.chamber} District {service.district} ({service.party})
              </Text>
            ))}
            {legislator.serviceHistory.length === 0 ? (
              <Text style={styles.bodyText}>No service history is available yet.</Text>
            ) : null}
          </Card>
          <Card>
            <Text style={styles.cardTitle}>Suggested Questions</Text>
            <View style={styles.promptStack}>
              {legislator.questionPrompts.map((prompt) => (
                <PromptLink
                  key={prompt}
                  prompt={prompt}
                  onPress={() =>
                    navigation.navigate('ChatSession', {
                      title: `${legislator.shortName} question`,
                      seedPrompt: prompt,
                      subjectType: 'legislator',
                      subjectId: legislator.id,
                      subjectLabel: legislator.name,
                    })
                  }
                />
              ))}
            </View>
          </Card>
        </View>
      </View>
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  metaCard: {
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
  grid: {
    gap: theme.spacing.md,
  },
  gridDesktop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  mainColumn: {
    flex: 1.7,
    gap: theme.spacing.md,
  },
  sideColumn: {
    flex: 1,
    gap: theme.spacing.md,
  },
  sideColumnDesktop: {
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    paddingLeft: theme.spacing.md,
  },
  stack: {
    gap: theme.spacing.md,
  },
  bodyText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
  listItem: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 24,
  },
  cardTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 22,
  },
  promptStack: {
    gap: 0,
  },
});
