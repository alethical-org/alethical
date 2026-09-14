import React, { useState, type ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useResponsive } from '../../hooks/useResponsive';
import { committeeSlug, registerKindLabel } from '../../lib/committeeMoneyShared';
import { formatDay, formatMoney } from '../../lib/legislatorCampaignMoney';
import {
  CAMPAIGN_CONTRIBUTION_SOURCE_LABEL,
  LOBBYIST_DONATIONS_UNAVAILABLE,
  LOBBYIST_PRINCIPALS_UNAVAILABLE,
  lobbyingLobbyistCopy,
  lobbyingNoSpendingRows,
  lobbyingPrincipalCopy,
  PRINCIPAL_LOBBYISTS_UNAVAILABLE,
  recordCountLine,
  SHOW_NEXT_30,
  visibleLobbyingDonationYears,
} from '../../lib/lobbyingRecordCopy';
import type {
  LobbyingAssociation,
  LobbyingContributions,
  LobbyingContributionYear,
  LobbyingPrincipalLobbyist,
} from '../../lib/lobbyingTypes';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import { theme } from '../../theme/tokens';
import { LobbyingCard } from './LobbyingPageFrame';

const REVEAL_STEP = 30;

export function PrincipalLobbyistsCard({
  state,
  total,
  rows,
  onOpenLobbyist,
}: {
  state: 'reported' | 'not_reported' | 'unavailable';
  total: number | null;
  rows: readonly LobbyingPrincipalLobbyist[];
  onOpenLobbyist: (row: LobbyingPrincipalLobbyist) => void;
}) {
  const [shown, setShown] = useState(REVEAL_STEP);
  const visible = rows.slice(0, shown);
  return (
    <LobbyingCard
      label="Registered for this principal today"
      title={lobbyingPrincipalCopy.lobbyistsHeading}
    >
      <Paragraph>{lobbyingPrincipalCopy.lobbyistsIntroduction}</Paragraph>
      {state === 'unavailable' || total === null ? (
        <Unavailable>{PRINCIPAL_LOBBYISTS_UNAVAILABLE}</Unavailable>
      ) : total === 0 || state === 'not_reported' ? (
        <Paragraph primary>{lobbyingPrincipalCopy.noLobbyists}</Paragraph>
      ) : (
        <>
          <CountLine>{recordCountLine(total, visible.length, 'lobbyist', 'lobbyists')}</CountLine>
          <View role="list" style={styles.list}>
            {visible.map((row) => (
              <View key={row.registration_number} role="listitem">
                <Pressable
                  {...linkProps(
                    routePath.lobbyingLobbyist(`${slugName(row.name)}-${row.registration_number}`),
                    () => onOpenLobbyist(row),
                  )}
                  style={styles.linkRow}
                >
                  <Text style={styles.rowName}>{row.name}</Text>
                  <RowArrow />
                </Pressable>
              </View>
            ))}
          </View>
          {shown < total ? (
            <RevealButton onPress={() => setShown((value) => value + REVEAL_STEP)} />
          ) : null}
        </>
      )}
    </LobbyingCard>
  );
}

export function LobbyistPrincipalsCard({
  state,
  registrationNumber,
  total,
  rows,
  latestYear,
  onOpenPrincipal,
}: {
  state: 'reported' | 'not_registered_today' | 'unavailable';
  registrationNumber: string;
  total: number | null;
  rows: readonly LobbyingAssociation[];
  latestYear: number | null | undefined;
  onOpenPrincipal: (row: LobbyingAssociation) => void;
}) {
  const [shown, setShown] = useState(REVEAL_STEP);
  const visible = rows.slice(0, shown);
  return (
    <LobbyingCard label="Represents today" title={lobbyingLobbyistCopy.principalsHeading}>
      <Paragraph>{lobbyingLobbyistCopy.principalsIntroduction}</Paragraph>
      {state === 'unavailable' || total === null ? (
        <Unavailable>{LOBBYIST_PRINCIPALS_UNAVAILABLE}</Unavailable>
      ) : state === 'not_registered_today' ? (
        <Paragraph primary>Registration {registrationNumber} · not registered today</Paragraph>
      ) : total === 0 ? (
        <Paragraph primary>{lobbyingLobbyistCopy.noPrincipals}</Paragraph>
      ) : (
        <>
          <CountLine>{recordCountLine(total, visible.length, 'principal', 'principals')}</CountLine>
          <View role="list" style={styles.list}>
            {visible.map((row) =>
              row.linkable ? (
                <View key={`${row.entity_id}-${row.position}`} role="listitem">
                  <Pressable
                    {...linkProps(
                      routePath.lobbyingPrincipal(
                        `${slugName(row.spending_name ?? row.name)}-${row.entity_id}`,
                      ),
                      () => onOpenPrincipal(row),
                    )}
                    style={styles.linkRow}
                  >
                    <Text style={styles.rowName}>{row.name}</Text>
                    <RowArrow />
                  </Pressable>
                </View>
              ) : (
                <View
                  key={`${row.entity_id}-${row.position}`}
                  role="listitem"
                  style={styles.plainRow}
                >
                  <Text style={styles.rowName}>{row.name}</Text>
                  <Text style={styles.rowNote}>{lobbyingNoSpendingRows(latestYear ?? null)}</Text>
                </View>
              ),
            )}
          </View>
          {shown < total ? (
            <RevealButton onPress={() => setShown((value) => value + REVEAL_STEP)} />
          ) : null}
        </>
      )}
    </LobbyingCard>
  );
}

export function LobbyistDonationsCard({
  contributions,
  registeredName,
  copiedDate,
  onOpenCommittee,
}: {
  contributions: LobbyingContributions;
  registeredName: string;
  copiedDate: string | null;
  onOpenCommittee: (registrationNumber: string, name: string) => void;
}) {
  const [shown, setShown] = useState(REVEAL_STEP);
  const total = contributions.payment_count;
  const visible = visibleLobbyingDonationYears(contributions.years, shown);
  const visibleCount = visible.reduce(
    (yearTotal, year) =>
      yearTotal +
      year.committees.reduce(
        (committeeTotal, committee) => committeeTotal + committee.payments.length,
        0,
      ),
    0,
  );
  return (
    <LobbyingCard
      label="Donations under this registration number"
      title={lobbyingLobbyistCopy.donationsHeading}
    >
      <Paragraph>{lobbyingLobbyistCopy.donationsIntroduction}</Paragraph>
      {copiedDate ? <FileDate>{copiedDate}</FileDate> : null}
      {contributions.source_url ? (
        <Text
          {...externalLinkProps(
            contributions.source_url,
            () => void Linking.openURL(contributions.source_url!),
          )}
          style={styles.contributionSource}
        >
          {CAMPAIGN_CONTRIBUTION_SOURCE_LABEL} ↗
        </Text>
      ) : null}
      {contributions.state === 'unavailable' || total === null ? (
        <Unavailable>{LOBBYIST_DONATIONS_UNAVAILABLE}</Unavailable>
      ) : total === 0 || contributions.state === 'not_reported' ? (
        <Paragraph primary>{lobbyingLobbyistCopy.noDonations}</Paragraph>
      ) : (
        <>
          <CountLine>{recordCountLine(total, visibleCount, 'donation', 'donations')}</CountLine>
          {visible.map((year) => (
            <DonationYear
              key={year.year ?? 'unknown'}
              year={year}
              registeredName={registeredName}
              onOpenCommittee={onOpenCommittee}
            />
          ))}
          {shown < total ? (
            <RevealButton onPress={() => setShown((value) => value + REVEAL_STEP)} />
          ) : null}
        </>
      )}
    </LobbyingCard>
  );
}

function DonationYear({
  year,
  registeredName,
  onOpenCommittee,
}: {
  year: LobbyingContributionYear;
  registeredName: string;
  onOpenCommittee: (registrationNumber: string, name: string) => void;
}) {
  return (
    <View style={styles.donationYear}>
      <Text style={styles.yearLabel}>{year.year ?? 'YEAR NOT REPORTED'}</Text>
      <View role="list" style={styles.committeeList}>
        {year.committees.map((committee, index) => {
          const name = committee.name ?? 'Committee name not reported';
          const registration = committee.registration_number;
          const kind = registerKindLabel(committee.kind);
          const meta = [kind?.toUpperCase(), registration ? `REGISTRATION ${registration}` : null]
            .filter(Boolean)
            .join(' · ');
          const linkable = committee.linkable && registration !== null && committee.name !== null;
          return (
            <View
              key={`${committee.registration_number ?? 'unknown'}-${index}`}
              role="listitem"
              style={styles.committeeBlock}
            >
              {linkable ? (
                <Pressable
                  {...linkProps(routePath.moneyCommittee(committeeSlug(name, registration)), () =>
                    onOpenCommittee(registration, name),
                  )}
                  style={styles.committeeLink}
                >
                  <Text style={styles.committeeName}>{name}</Text>
                  <RowArrow small />
                </Pressable>
              ) : (
                <Text style={styles.committeeName}>{name}</Text>
              )}
              {meta ? <Text style={styles.committeeMeta}>{meta}</Text> : null}
              <View style={styles.payments}>
                {committee.payments.map((payment) => {
                  const filedName = payment.contributor_name?.trim() || null;
                  const showFiledName = filedName !== null && filedName !== registeredName;
                  const donatedGoods = payment.in_kind === 'Yes';
                  return (
                    <View key={payment.record_number} style={styles.paymentRow}>
                      <View style={styles.paymentText}>
                        <Text style={styles.paymentDate}>
                          {formatDay(payment.received_on) ?? 'Date not reported'}
                        </Text>
                        {showFiledName ? (
                          <Text style={styles.paymentNote}>Filed as {filedName}</Text>
                        ) : null}
                        {donatedGoods ? (
                          <Text style={styles.paymentMarker}>
                            DONATED GOODS OR SERVICES
                            {payment.in_kind_description ? ` · ${payment.in_kind_description}` : ''}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.paymentAmount}>
                        {formatMoney(payment.amount) ?? 'Not reported'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Paragraph({ children, primary = false }: { children: ReactNode; primary?: boolean }) {
  const { isMobile, isTablet } = useResponsive();
  return (
    <Text
      style={[
        styles.paragraph,
        { fontSize: isMobile || isTablet ? 16 : 17 },
        primary && styles.paragraphPrimary,
      ]}
    >
      {children}
    </Text>
  );
}

function CountLine({ children }: { children: ReactNode }) {
  return <Text style={styles.countLine}>{children}</Text>;
}

function FileDate({ children }: { children: ReactNode }) {
  return <Text style={styles.fileDate}>{children}</Text>;
}

function Unavailable({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="alert" style={styles.unavailable}>
      {children}
    </Text>
  );
}

function RevealButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.revealButton}>
      <Text style={styles.revealLabel}>{SHOW_NEXT_30}</Text>
      <RowArrow small />
    </Pressable>
  );
}

function RowArrow({ small = false }: { small?: boolean }) {
  const size = small ? 14 : 16;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M5 12 H19 M14 7 L19 12 L14 17"
        stroke="#0f7a45"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function slugName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const styles: Record<string, any> = {
  paragraph: {
    marginTop: 12,
    maxWidth: 820,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    lineHeight: 26,
  },
  paragraphPrimary: { marginTop: 16, color: '#11150f' },
  countLine: {
    marginTop: 14,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  fileDate: {
    marginTop: 12,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  contributionSource: {
    minHeight: 44,
    alignSelf: 'flex-start',
    color: '#0f7a45',
    fontFamily: theme.typography.body,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
  },
  unavailable: {
    marginTop: 16,
    maxWidth: 820,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 24,
  },
  list: { marginTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(17,21,15,0.08)' },
  linkRow: {
    minHeight: 52,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.08)',
  },
  plainRow: {
    minHeight: 56,
    paddingVertical: 10,
    paddingHorizontal: 2,
    justifyContent: 'center',
    gap: 3,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.08)',
  },
  rowName: {
    flexShrink: 1,
    color: '#11150f',
    fontFamily: theme.typography.body,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 23,
  },
  rowNote: {
    color: '#6b716b',
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 21,
    fontVariant: ['tabular-nums'],
  },
  revealButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  revealLabel: {
    color: '#0f7a45',
    fontFamily: theme.typography.body,
    fontSize: 16,
    fontWeight: '700',
  },
  donationYear: { marginTop: 20 },
  yearLabel: {
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.3,
    fontVariant: ['tabular-nums'],
  },
  committeeList: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.12)',
  },
  committeeBlock: {
    paddingTop: 6,
    paddingBottom: 13,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.08)',
  },
  committeeLink: {
    minHeight: 44,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  committeeName: {
    color: '#11150f',
    fontFamily: theme.typography.body,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 24,
  },
  committeeMeta: {
    color: '#656c66',
    fontFamily: theme.typography.mono,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.96,
    fontVariant: ['tabular-nums'],
  },
  payments: { marginTop: 8, gap: 6 },
  paymentRow: {
    minHeight: 30,
    paddingLeft: 18,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
  },
  paymentText: { flex: 1, minWidth: 0 },
  paymentDate: {
    color: '#11150f',
    fontFamily: theme.typography.body,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 21,
    fontVariant: ['tabular-nums'],
  },
  paymentAmount: {
    color: '#11150f',
    fontFamily: theme.typography.body,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    fontVariant: ['tabular-nums'],
  },
  paymentNote: {
    marginTop: 2,
    color: '#6b716b',
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 21,
  },
  paymentMarker: {
    marginTop: 2,
    color: '#656c66',
    fontFamily: theme.typography.mono,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.72,
    lineHeight: 18,
  },
};
