import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  getCompleteOutsideSpendingPayments,
  getGroupedOutsideSpending,
} from '../../data/groupedOutsideSpending';
import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import {
  committeeSlug,
  OUTSIDE_ABOUT_INTRO,
  OUTSIDE_NEVER_ADDED,
} from '../../lib/committeeMoneyShared';
import { formatDay, formatMoney } from '../../lib/legislatorCampaignMoney';
import {
  OUTSIDE_GROUP_COPY as copy,
  outsideCheckedZeroLabel,
  outsideDirectionLabel,
  outsideExpansionLabel,
  outsidePaymentCountLabel,
  outsideRegistrationLabel,
  outsideSpenderCountLabel,
  outsideVendorLabel,
  paymentsForOutsideSpender,
  type OutsideGroupPayment,
  type OutsideSpenderGroup,
} from '../../lib/groupedOutsideSpending';
import {
  OUTSIDE_SPENDING_CARD_HEADING as OUTSIDE_SPENDING_HEADING,
  isMeasuredZero,
  outsideSpendingCoverage,
  outsideSpendingFigures,
  outsideSpendingPaymentCount,
  outsideSpendingPeriod,
  outsideSpendingUnavailableReason,
  type OutsideSpendingYear,
} from '../../lib/outsideSpending';
import { useResponsive } from '../../hooks/useResponsive';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import type { RootStackParamList } from '../../navigation/types';
import { LinkArrow } from '../LinkArrow';
import { numericText, useCampaignMoneyTypography, useDetailsStyles } from './detailsStyles';

export interface GroupedOutsideSpendingProps {
  year: OutsideSpendingYear;
  onOpenSource: (url: string) => void;
  enabled?: boolean;
  surface?: 'profile' | 'committee';
  releaseId?: string;
}

export function GroupedOutsideSpending(props: GroupedOutsideSpendingProps) {
  const scope = JSON.stringify([
    props.year.year,
    props.year.snapshotId,
    props.releaseId,
    props.year.committees.map((committee) => committee.registrationNumber).sort(),
  ]);
  return <OutsideYear key={scope} {...props} />;
}

function OutsideYear({
  year,
  onOpenSource,
  enabled = true,
  surface = 'profile',
  releaseId,
}: GroupedOutsideSpendingProps) {
  const { isMobile, isTablet } = useResponsive();
  const s = useDetailsStyles();
  const type = useCampaignMoneyTypography();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const registrations = [
    ...new Set(year.committees.map((committee) => committee.registrationNumber)),
  ].sort();
  const unavailable = outsideSpendingUnavailableReason(year);
  const zero = isMeasuredZero(year);
  const canRead =
    enabled &&
    !unavailable &&
    !zero &&
    Boolean(year.snapshotId || (surface === 'committee' && releaseId)) &&
    registrations.length > 0;
  const groupedQuery = useQuery({
    queryKey: [
      'campaign-money-outside-groups',
      year.year,
      year.snapshotId,
      registrations,
      releaseId,
    ],
    queryFn: ({ signal }) => getGroupedOutsideSpending(year, signal, releaseId),
    enabled: canRead,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const readFailed = groupedQuery.isError || (enabled && !unavailable && !zero && !canRead);
  const grouped = groupedQuery.isError ? undefined : groupedQuery.data;
  const paymentsQuery = useQuery({
    queryKey: [
      'campaign-money-outside-payments',
      grouped?.year,
      grouped?.snapshotId,
      grouped?.releaseId,
      registrations,
    ],
    queryFn: ({ signal }) => getCompleteOutsideSpendingPayments(grouped!, signal),
    enabled: enabled && Boolean(grouped) && expanded.size > 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const period = outsideSpendingPeriod(year);
  const count = outsideSpendingPaymentCount(year);
  const coverage = surface === 'profile' ? outsideSpendingCoverage(year) : null;
  // The existing summary remains readable if the new grouped read fails. It has no
  // spender counts, so the fallback never pretends to know how many groups paid.
  const figures = grouped
    ? grouped.figures
        .filter((figure) => figure.direction !== 'not recorded' || figure.paymentCount > 0)
        .map((figure) => ({
          key: figure.direction,
          label: figure.label,
          amount: figure.amount,
          payments: figure.paymentCount,
          spenders: figure.spenderCount,
        }))
    : outsideSpendingFigures(year).map((figure) => ({ ...figure, spenders: null }));

  return (
    <View style={[styles.card, isTablet && styles.cardTablet, isMobile && styles.cardMobile]}>
      <Text accessibilityRole="header" aria-level={2} style={[s.heading, styles.heading]}>
        {OUTSIDE_SPENDING_HEADING}
      </Text>
      <Text style={s.body}>
        {surface === 'committee' ? `${OUTSIDE_ABOUT_INTRO} ${OUTSIDE_NEVER_ADDED}` : copy.explainer}
      </Text>
      {unavailable ? (
        <Text style={s.body}>{unavailable}</Text>
      ) : zero ? (
        <Text style={[s.body, s.numeric]}>
          {outsideCheckedZeroLabel(year.year, surface === 'committee' ? 'committee' : 'legislator')}
        </Text>
      ) : (
        <>
          <View style={styles.figures}>
            {figures.map((figure) => (
              <View key={figure.key} style={styles.figure}>
                <Text style={[s.small, styles.figureLabel]}>{figure.label}</Text>
                <Text
                  style={[
                    s.amount,
                    styles.figureAmount,
                    { fontSize: type.figure, lineHeight: type.figure * 1.1 },
                  ]}
                >
                  {formatMoney(figure.amount) ?? copy.unknownAmount}
                </Text>
                <Text style={[s.small, s.numeric]}>
                  {outsidePaymentCountLabel(figure.payments)}
                  {figure.spenders !== null
                    ? ` · ${outsideSpenderCountLabel(figure.spenders)}`
                    : ''}
                </Text>
              </View>
            ))}
          </View>
          {period ? (
            <Text style={[s.small, s.numeric]}>
              {count === 1 ? copy.paymentMade : copy.paymentsMade} {period}
            </Text>
          ) : null}
          {coverage ? <Text style={[s.small, numericText(coverage)]}>{coverage}</Text> : null}
          <View style={[s.section, s.rule]}>
            <Text accessibilityRole="header" aria-level={3} style={[s.body, styles.subheading]}>
              {copy.heading}
            </Text>
            {grouped ? (
              <View style={styles.rows}>
                {grouped.groups.map((group) => (
                  <SpenderRow
                    key={group.key}
                    group={group}
                    year={year.year}
                    expanded={expanded.has(group.key)}
                    onToggle={() =>
                      setExpanded((previous) => {
                        const next = new Set(previous);
                        if (next.has(group.key)) next.delete(group.key);
                        else next.add(group.key);
                        return next;
                      })
                    }
                    payments={
                      paymentsQuery.isError || !paymentsQuery.data
                        ? undefined
                        : paymentsForOutsideSpender(paymentsQuery.data, group)
                    }
                    failed={paymentsQuery.isError}
                    onRetry={() => void paymentsQuery.refetch()}
                  />
                ))}
              </View>
            ) : (
              <View style={s.section}>
                <Text accessibilityRole={readFailed ? 'alert' : undefined} style={s.body}>
                  {readFailed ? copy.failed : copy.loading}
                </Text>
                {groupedQuery.isError ? (
                  <Retry onPress={() => void groupedQuery.refetch()} />
                ) : null}
              </View>
            )}
          </View>
        </>
      )}
      {year.sourceUrl ? (
        <Pressable
          {...externalLinkProps(year.sourceUrl, () => onOpenSource(year.sourceUrl!))}
          style={(state) => [
            styles.source,
            Boolean('focused' in state && state.focused) && s.focus,
          ]}
        >
          <Text style={[s.small, s.link, styles.sourceLabel]}>{copy.source}</Text>
          <LinkArrow color={c.link} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Retry({ onPress }: { onPress: () => void }) {
  const s = useDetailsStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={(state) => [s.control, Boolean('focused' in state && state.focused) && s.focus]}
    >
      <Text style={s.controlText}>{copy.retry}</Text>
    </Pressable>
  );
}

function SpenderRow({
  group,
  year,
  expanded,
  onToggle,
  payments,
  failed,
  onRetry,
}: {
  group: OutsideSpenderGroup;
  year: number;
  expanded: boolean;
  onToggle: () => void;
  payments: OutsideGroupPayment[] | undefined;
  failed: boolean;
  onRetry: () => void;
}) {
  const s = useDetailsStyles();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const name = group.name ?? copy.unknownName;
  const direction = outsideDirectionLabel(group.direction);
  const route =
    group.linkable && group.registrationNumber
      ? { slug: committeeSlug(name, group.registrationNumber), year: String(year) }
      : null;
  const href = route ? routePath.moneyCommittee(route.slug, { year: route.year }) : null;
  const color =
    group.direction === 'For' ? c.link : group.direction === 'Against' ? c.text : c.muted;
  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        <View style={styles.identity}>
          {href && route ? (
            <Text
              style={[s.name, s.link, styles.nameLink, numericText(name)]}
              {...linkProps(href, () => navigation.navigate('CommitteeMoney', route))}
            >
              {name}
            </Text>
          ) : (
            <Text style={[s.name, numericText(name)]}>{name}</Text>
          )}
          <Text style={[s.small, numericText(outsideRegistrationLabel(group.registrationNumber))]}>
            {outsideRegistrationLabel(group.registrationNumber)}
          </Text>
          <View style={s.horizontal}>
            <Text
              style={[
                s.small,
                styles.direction,
                { color, borderColor: group.direction === 'For' ? c.link : c.border },
                group.direction === 'not recorded' && { borderStyle: 'dashed' },
              ]}
            >
              {direction}
            </Text>
            <Text style={[s.small, s.numeric]}>{outsidePaymentCountLabel(group.paymentCount)}</Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          aria-expanded={expanded}
          onPress={onToggle}
          accessibilityLabel={outsideExpansionLabel(group, expanded)}
          style={(state) => [
            styles.expand,
            Boolean('focused' in state && state.focused) && s.focus,
          ]}
        >
          <Text style={s.amount}>{formatMoney(group.amount) ?? copy.unknownAmount}</Text>
          <Text aria-hidden style={s.name}>
            {expanded ? '−' : '+'}
          </Text>
        </Pressable>
      </View>
      {expanded ? (
        <View style={styles.payments}>
          {payments ? (
            payments.map((payment, index) => (
              <View
                key={`${payment.aboutRegistrationNumber}-${payment.recordNumber}-${index}`}
                style={styles.payment}
              >
                <View style={styles.paymentHeading}>
                  <Text style={[s.small, s.numeric, styles.paymentNumber]}>
                    {formatDay(payment.paidOn) ?? copy.unknownDate}
                  </Text>
                  <Text style={[s.small, s.numeric, styles.paymentNumber]}>
                    {formatMoney(payment.amount) ?? copy.unknownAmount}
                  </Text>
                </View>
                <Text style={[s.small, numericText(payment.purpose ?? copy.unknownPurpose)]}>
                  {payment.purpose ?? copy.unknownPurpose}
                </Text>
                <Text style={[s.small, numericText(outsideVendorLabel(payment.vendorName))]}>
                  {outsideVendorLabel(payment.vendorName)}
                </Text>
              </View>
            ))
          ) : (
            <View style={styles.payment}>
              <Text accessibilityRole={failed ? 'alert' : undefined} style={s.body}>
                {failed ? copy.detailsFailed : copy.detailsLoading}
              </Text>
              {failed ? <Retry onPress={onRetry} /> : null}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 18,
    backgroundColor: c.background,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingTop: 30,
    paddingHorizontal: 32,
    paddingBottom: 28,
  },
  cardTablet: { paddingTop: 26, paddingHorizontal: 26, paddingBottom: 24 },
  cardMobile: { paddingTop: 20, paddingHorizontal: 18, paddingBottom: 20 },
  heading: { letterSpacing: -0.24 },
  subheading: { fontWeight: '800', color: c.text },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  figure: {
    gap: 8,
    flexGrow: 1,
    flexBasis: 230,
    minWidth: 230,
    maxWidth: '100%',
    backgroundColor: c.tile,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  figureLabel: { fontWeight: '600', color: c.secondary },
  figureAmount: { letterSpacing: -0.36 },
  paymentNumber: { color: c.text },
  rows: { gap: 10 },
  group: { borderWidth: 1, borderColor: c.border, borderRadius: 12, overflow: 'hidden' },
  groupHead: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'center', padding: 16 },
  identity: { flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 0, gap: 5 },
  nameLink: { minHeight: 44, paddingVertical: 10 },
  direction: {
    borderWidth: 1,
    borderRadius: 7,
    paddingVertical: 1,
    paddingHorizontal: 7,
    fontSize: 12,
    fontWeight: '800',
  },
  expand: {
    minHeight: 44,
    minWidth: 44,
    maxWidth: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: 10,
  },
  payments: { borderTopWidth: 1, borderTopColor: c.border },
  payment: { gap: 8, padding: 16, borderBottomWidth: 1, borderBottomColor: c.border },
  paymentHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  source: { minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  sourceLabel: { fontWeight: '700' },
});
