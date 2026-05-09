import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import { useBill, useToggleTrackedBill, useTrackedBills } from '../hooks/useAppQueries';
import { RootStackParamList } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { theme } from '../theme/tokens';
import { useResponsive } from '../hooks/useResponsive';

type DetailTab = 'Summary' | 'Actions' | 'Versions' | 'Votes';
type Props = NativeStackScreenProps<RootStackParamList, 'BillDetail'>;

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
    const [tab, setTab] = useState<DetailTab>('Summary');
    const billQuery = useBill(billId);
    const trackedQuery = useTrackedBills(user?.id);
    const toggleTrackedBill = useToggleTrackedBill(user?.id);

    const bill = billQuery.data;
    const trackedIds = useMemo(() => new Set((trackedQuery.data ?? []).map((item) => item.id)), [trackedQuery.data]);

    if (billQuery.isLoading) {
        return (
            <ScreenView title="Loading bill" subtitle="Fetching the latest bill detail from the backend.">
                <Card>
                    <Text style={styles.bodyText}>Loading official status, actions, versions, and votes.</Text>
                </Card>
            </ScreenView>
        );
    }

    if (!bill?.aiAnalysis) {
        return (
            <ScreenView title="Bill not found" subtitle="This bill does not have AI enrichment available in Bill Explorer.">
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
    const sponsors = bill.sponsorNames.map((name, index) => ({
        name,
        legislatorId: bill.chiefSponsorIds[index],
    }));

    return (
        <ScreenView
            hideHeader
        >
            <Card style={styles.analysisCard}>
                <View style={styles.compactHeader}>
                    <View style={styles.compactTitleWrap}>
                        <Text style={styles.identifier}>{bill.identifier}</Text>
                        <Text style={styles.compactMeta}>
                            {bill.chamber} | {bill.status} | Updated {bill.updatedAt}
                        </Text>
                        <View style={styles.sponsorRow}>
                            <Text style={styles.sponsorText}>Author: </Text>
                            {sponsors.length > 0 ? (
                                sponsors.map((sponsor, index) => {
                                    const clickable = Boolean(sponsor.legislatorId);
                                    return (
                                        <Pressable
                                            key={`${sponsor.legislatorId ?? sponsor.name}-${index}`}
                                            accessibilityRole={clickable ? 'link' : undefined}
                                            disabled={!clickable}
                                            onPress={() => {
                                                if (sponsor.legislatorId) {
                                                    navigation.navigate('LegislatorProfile', { legislatorId: sponsor.legislatorId });
                                                }
                                            }}
                                        >
                                            <Text style={[styles.sponsorText, clickable && styles.sponsorLink]}>
                                                {sponsor.name}{index < sponsors.length - 1 ? ', ' : ''}
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
                                    void signInWithGoogle();
                                    return;
                                }
                                toggleTrackedBill.mutate(bill.id);
                            }}
                        />
                        <PrimaryButton
                            label="Share"
                            tone="secondary"
                            onPress={() => void Share.share({ message: `${bill.identifier}: ${analysis?.summary ?? bill.title}` })}
                        />
                        <PrimaryButton
                            label="Ask AI"
                            tone="secondary"
                            onPress={() =>
                                navigation.navigate('ChatSession', {
                                    title: `${bill.identifier} analysis`,
                                    seedPrompt: `Use the official bill record to explain ${bill.identifier} in plain language.`,
                                    subjectType: 'bill',
                                    subjectId: bill.id,
                                    subjectLabel: bill.identifier,
                                })
                            }
                        />
                    </View>
                </View>
                <Text style={styles.leadText}>{analysis.summary}</Text>
                <View style={styles.policyAreaWrap}>
                    {analysis.policyAreas.map((area) => (
                        <View key={area} style={styles.policyPill}>
                            <Text style={styles.policyPillText}>{area}</Text>
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

            <View style={styles.tabRow}>
                {(['Summary', 'Actions', 'Versions', 'Votes'] as DetailTab[]).map((value) => (
                    <Chip key={value} label={value} selected={tab === value} onPress={() => setTab(value)} />
                ))}
            </View>

            {tab === 'Summary' ? (
                <View style={[styles.summaryGrid, isDesktop && styles.summaryGridDesktop]}>
                    <View style={styles.mainColumn}>
                        <Card>
                            <Text style={styles.snapshotTitle}>Bill Snapshot</Text>
                            <Text style={styles.bodyText}>
                                {bill.actionCount} actions | {bill.versionCount} versions | {bill.rollCallCount} roll calls
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
                                    <PrimaryButton label="Open Official Text" tone="secondary" onPress={() => void Linking.openURL(version.url)} />
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
