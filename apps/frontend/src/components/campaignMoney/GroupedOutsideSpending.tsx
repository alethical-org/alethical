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
  BOARD_DOWNLOADS_URL,
  committeeSlug,
  downloadsPageUrl,
  NAMED_DONATIONS_LINK_LABEL,
  OUTSIDE_ABOUT_INTRO,
  OUTSIDE_NEVER_ADDED,
} from '../../lib/committeeMoneyShared';
import { formatDay, formatMoney } from '../../lib/moneyFormat';
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
import Svg, { Path } from 'react-native-svg';

import { LinkArrowLabel } from '../LinkArrow';
import { numericText, useCampaignMoneyTypography, useDetailsStyles } from './detailsStyles';

export interface GroupedOutsideSpendingProps {
  year: OutsideSpendingYear;
  onOpenSource: (url: string) => void;
  enabled?: boolean;
  surface?: 'profile' | 'committee';
  releaseId?: string;
  /** True only where we hold that this year's ballot did not carry the subject. The
   *  checked-zero sentence says so; in every other year it stays silent. */
  notOnTheBallot?: boolean;
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
  notOnTheBallot = false,
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
  const downloadsHref = year.sourceUrl ? downloadsPageUrl(year.sourceUrl) : BOARD_DOWNLOADS_URL;
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
      {/* Absent in the checked-zero state, and only there: a card that explains what
          outside spending is and then says there was none of it hands the reader a
          definition of something not on the page. Every other state still draws it,
          because in those the sentence is the only thing saying what the card is about. */}
      {zero ? null : (
        <Text style={[s.body, { maxWidth: 900, ...({ textWrap: 'pretty' } as object) }]}>
          {surface === 'committee'
            ? `${OUTSIDE_ABOUT_INTRO} ${OUTSIDE_NEVER_ADDED}`
            : copy.explainer}
        </Text>
      )}
      {unavailable ? (
        <Text style={s.body}>{unavailable}</Text>
      ) : zero ? (
        <Text style={s.body}>
          {outsideCheckedZeroLabel(
            year.year,
            surface === 'committee' ? 'committee' : 'legislator',
            notOnTheBallot,
          )}
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
      {/* The served address is the bulk download itself, which streams a statewide
          spreadsheet with no page behind it, so the link lands on the page that download
          lives on, derived from the served address rather than typed in (#2186). The
          filename directly above the link names the Board's own row on that page. */}
      <View style={styles.foot}>
        {!unavailable && !zero && period ? (
          <Text style={[s.small, styles.plainNumbers]}>
            {count === 1 ? copy.paymentMade : copy.paymentsMade} {period}
          </Text>
        ) : null}
        <View style={styles.sourceBlock}>
          <Text style={[s.small, styles.sourceFile]}>{copy.sourceFile}</Text>
          <Pressable
            {...externalLinkProps(downloadsHref, () => onOpenSource(downloadsHref))}
            style={(state) => [
              styles.source,
              Boolean('focused' in state && state.focused) && s.focus,
            ]}
          >
            <LinkArrowLabel
              label={NAMED_DONATIONS_LINK_LABEL}
              style={[s.small, s.link, styles.sourceLabel]}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Drawn rather than typed, like `LinkArrow`: the text characters this replaces landed
 *  at a different size on every operating system. It turns over when the row opens. */
function Chevron({ open }: { open: boolean }) {
  return (
    <Svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
    >
      <Path
        d="M6 9 L12 15 L18 9"
        stroke={c.secondary}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
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
  const { isMobile, isTablet } = useResponsive();
  const name = group.name ?? copy.unknownName;
  const direction = outsideDirectionLabel(group.direction);
  const route =
    group.linkable && group.registrationNumber
      ? { slug: committeeSlug(name, group.registrationNumber), year: String(year) }
      : null;
  const href = route ? routePath.moneyCommittee(route.slug, { year: route.year }) : null;
  const stance = (
    <Text
      style={[
        s.small,
        styles.direction,
        group.direction === 'Against' && styles.opposing,
        group.direction === 'not recorded' && styles.notStated,
      ]}
    >
      {direction}
    </Text>
  );
  const meta = `${outsideRegistrationLabel(group.registrationNumber)} · ${outsidePaymentCountLabel(group.paymentCount)}`;
  return (
    <View style={styles.group}>
      <View style={[styles.groupHead, isMobile && styles.groupHeadMobile]}>
        <View style={[styles.identity, isMobile && styles.identityMobile]}>
          <View style={styles.nameLine}>
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
            {isMobile ? stance : null}
          </View>
          <Text style={[s.small, styles.plainNumbers]}>{meta}</Text>
        </View>
        {!isMobile ? (
          <View style={[styles.stanceColumn, isTablet && styles.stanceColumnTablet]}>{stance}</View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          aria-expanded={expanded}
          {...{ dataSet: { arrowFocus: 'true' } }}
          onPress={onToggle}
          accessibilityLabel={outsideExpansionLabel(group, expanded)}
          style={styles.expand}
        >
          {(state) => (
            <>
              <Text
                style={[
                  s.amount,
                  !isMobile && styles.amountColumn,
                  !isMobile && isTablet && styles.amountColumnTablet,
                ]}
              >
                {formatMoney(group.amount) ?? copy.unknownAmount}
              </Text>
              <View
                aria-hidden
                style={[
                  styles.expandArrow,
                  Boolean('focused' in state && state.focused) && s.namesFocus,
                ]}
              >
                <Chevron open={expanded} />
              </View>
            </>
          )}
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
  rows: { borderTopWidth: 1, borderTopColor: c.border },
  group: { borderBottomWidth: 1, borderBottomColor: c.border },
  groupHead: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    minHeight: 60,
    paddingVertical: 6,
  },
  groupHeadMobile: { flexWrap: 'wrap' },
  identity: { flex: 1, minWidth: 0, gap: 3 },
  // Keep the phone's existing name/chip flow; the amount can wrap below it.
  identityMobile: { flexBasis: 220 },
  stanceColumn: { minWidth: 104, flexGrow: 0, flexShrink: 0, alignItems: 'flex-start' },
  stanceColumnTablet: { minWidth: 100 },
  amountColumn: { minWidth: 120, flexShrink: 0, textAlign: 'right' },
  amountColumnTablet: { minWidth: 110 },
  plainNumbers: { fontWeight: '400', fontVariant: ['tabular-nums'] },
  nameLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  nameLink: { minHeight: 44, paddingVertical: 10 },
  direction: {
    color: c.text,
    borderColor: 'rgba(17,21,15,0.4)',
    borderWidth: 1,
    borderRadius: 7,
    paddingVertical: 1,
    paddingHorizontal: 7,
    fontSize: 12,
    fontWeight: '800',
  },
  opposing: { color: c.background, backgroundColor: c.text, borderColor: c.text },
  notStated: {
    color: c.muted,
    borderColor: 'rgba(17,21,15,0.3)',
    borderStyle: 'dashed',
    fontWeight: '700',
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
    ...({ outlineStyle: 'none' } as object),
  },
  expandArrow: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  payments: { paddingLeft: 18, paddingBottom: 12 },
  payment: { gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border },
  paymentHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  foot: { gap: 14 },
  sourceBlock: { gap: 2 },
  // Tabular figures so "$200" sits straight, but the ordinary body weight: it is a
  // sentence about the file, not a figure of its own.
  sourceFile: { fontVariant: ['tabular-nums'] },
  source: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  sourceLabel: { fontWeight: '700' },
});
