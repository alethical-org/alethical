import React, { useState, type ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { GreenLinkArrow, LinkArrowLabel, linkArrowRow } from '../LinkArrow';
import { useHover } from '../billDetail/interactions';
import { useResponsive } from '../../hooks/useResponsive';
import { committeeSlug, registerKindLabel } from '../../lib/committeeMoneyShared';
import { formatDay, formatMoney } from '../../lib/legislatorCampaignMoney';
import {
  CAMPAIGN_CONTRIBUTION_SOURCE_LABEL,
  LOBBYING_NO_SPENDING_PAGE,
  LOBBYING_RECORD_REVEAL_STEP,
  LOBBYIST_DONATIONS_UNAVAILABLE,
  LOBBYIST_PRINCIPALS_UNAVAILABLE,
  LOBBYIST_SOURCE_URL,
  lobbyingLobbyistCopy,
  lobbyingMissingSpendingPagesNote,
  lobbyingPrincipalCopy,
  lobbyingRevealLabel,
  PRINCIPAL_LOBBYISTS_UNAVAILABLE,
  recordCountLine,
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
  const [shown, setShown] = useState(LOBBYING_RECORD_REVEAL_STEP);
  const visible = rows.slice(0, shown);
  return (
    <LobbyingCard label="Lobbyists on the copy date" title={lobbyingPrincipalCopy.lobbyistsHeading}>
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
                <ClientLinkRow
                  label={row.name}
                  path={routePath.lobbyingLobbyist(
                    `${slugName(row.name)}-${row.registration_number}`,
                  )}
                  onPress={() => onOpenLobbyist(row)}
                />
              </View>
            ))}
          </View>
          {shown < total ? (
            <RevealButton
              label={lobbyingRevealLabel(total - visible.length, 'lobbyist', 'lobbyists')}
              onPress={() => setShown((value) => value + LOBBYING_RECORD_REVEAL_STEP)}
            />
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
  const [shown, setShown] = useState(LOBBYING_RECORD_REVEAL_STEP);
  const visible = rows.slice(0, shown);
  const hasMissingSpendingPages = visible.some((row) => !row.linkable);
  return (
    <LobbyingCard
      scan
      label="Clients on the copy date"
      title={lobbyingLobbyistCopy.principalsHeading}
    >
      <Paragraph fullWidth>{lobbyingLobbyistCopy.principalsIntroduction}</Paragraph>
      <RecordStrip sourceUrl={LOBBYIST_SOURCE_URL} sourceLabel={lobbyingLobbyistCopy.sourceLabel}>
        {state === 'reported' && total !== null && total > 0 ? (
          <CountLine inline>
            {recordCountLine(total, visible.length, 'client', 'clients')}
          </CountLine>
        ) : null}
      </RecordStrip>
      {state === 'unavailable' || total === null ? (
        <Unavailable>{LOBBYIST_PRINCIPALS_UNAVAILABLE}</Unavailable>
      ) : state === 'not_registered_today' ? (
        <Paragraph primary>
          Registration {registrationNumber} · not listed on the copy date
        </Paragraph>
      ) : total === 0 ? (
        <Paragraph primary>{lobbyingLobbyistCopy.noPrincipals}</Paragraph>
      ) : (
        <>
          {hasMissingSpendingPages ? (
            <Text style={styles.listNote}>
              {lobbyingMissingSpendingPagesNote(latestYear ?? null)}
            </Text>
          ) : null}
          <View role="list" style={styles.list}>
            {visible.map((row) =>
              row.linkable ? (
                <View key={`${row.entity_id}-${row.position}`} role="listitem">
                  <ClientLinkRow
                    label={row.name}
                    path={routePath.lobbyingPrincipal(
                      `${slugName(row.spending_name ?? row.name)}-${row.entity_id}`,
                    )}
                    onPress={() => onOpenPrincipal(row)}
                  />
                </View>
              ) : (
                <View
                  key={`${row.entity_id}-${row.position}`}
                  role="listitem"
                  style={styles.plainRow}
                >
                  <Text style={styles.rowName}>{row.name}</Text>
                  <Text style={styles.rowNote}>{LOBBYING_NO_SPENDING_PAGE}</Text>
                </View>
              ),
            )}
          </View>
          {shown < total ? (
            <RevealButton
              label={lobbyingRevealLabel(total - visible.length, 'client', 'clients')}
              onPress={() => setShown((value) => value + LOBBYING_RECORD_REVEAL_STEP)}
            />
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
  const [shown, setShown] = useState(LOBBYING_RECORD_REVEAL_STEP);
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
      scan
      label="Campaign donations under this registration number"
      title={lobbyingLobbyistCopy.donationsHeading}
    >
      <Paragraph>{lobbyingLobbyistCopy.donationsIntroduction}</Paragraph>
      <RecordStrip
        sourceUrl={contributions.source_url}
        sourceLabel={CAMPAIGN_CONTRIBUTION_SOURCE_LABEL}
      >
        {total !== null && total > 0 ? (
          <CountLine inline>
            {recordCountLine(total, visibleCount, 'donation', 'donations')}
          </CountLine>
        ) : null}
        {copiedDate ? <FileDate inline>{copiedDate}</FileDate> : null}
      </RecordStrip>
      {contributions.state === 'unavailable' || total === null ? (
        <Unavailable>{LOBBYIST_DONATIONS_UNAVAILABLE}</Unavailable>
      ) : total === 0 || contributions.state === 'not_reported' ? (
        <Paragraph primary>{lobbyingLobbyistCopy.noDonations}</Paragraph>
      ) : (
        <>
          {visible.map((year) => (
            <DonationYear
              key={year.year ?? 'unknown'}
              year={year}
              registeredName={registeredName}
              onOpenCommittee={onOpenCommittee}
            />
          ))}
          {shown < total ? (
            <RevealButton
              label={lobbyingRevealLabel(
                total - visibleCount,
                'campaign donation',
                'campaign donations',
              )}
              onPress={() => setShown((value) => value + LOBBYING_RECORD_REVEAL_STEP)}
            />
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
  const { isMobile, isTablet } = useResponsive();
  const paymentDateWidth = isMobile ? 100 : isTablet ? 116 : 124;
  const paymentAmountWidth = isMobile ? 96 : isTablet ? 104 : 108;
  return (
    <View style={styles.donationYear}>
      <View style={styles.yearBand}>
        <Text style={styles.yearLabel}>{year.year ?? 'YEAR NOT REPORTED'}</Text>
        <View style={styles.yearRule} />
      </View>
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
                  <LinkArrowLabel label={name} style={styles.committeeName} />
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
                      <View style={[styles.paymentText, { width: paymentDateWidth }]}>
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
                      <Text style={[styles.paymentAmount, { width: paymentAmountWidth }]}>
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

function ClientLinkRow({
  path,
  label,
  onPress,
}: {
  path: string;
  label: string;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      {...linkProps(path, onPress)}
      {...hover}
      style={({ pressed }) => [
        styles.linkRow,
        hovered && styles.rowHover,
        pressed && styles.rowPressed,
      ]}
    >
      <Text style={styles.rowName}>{label}</Text>
      <GreenLinkArrow />
    </Pressable>
  );
}

function RecordStrip({
  sourceUrl,
  sourceLabel,
  children,
}: {
  sourceUrl: string | null | undefined;
  sourceLabel: string;
  children: ReactNode;
}) {
  const { isMobile } = useResponsive();
  return (
    <View style={[styles.recordStrip, isMobile && styles.recordStripMobile]}>
      <View style={styles.recordStripCount}>{children}</View>
      {sourceUrl ? <LobbyingSourceLink url={sourceUrl} label={sourceLabel} /> : null}
    </View>
  );
}

function Paragraph({
  children,
  primary = false,
  fullWidth = false,
}: {
  children: ReactNode;
  primary?: boolean;
  fullWidth?: boolean;
}) {
  const { isMobile, isTablet } = useResponsive();
  const measure = isMobile ? 295 : isTablet ? 620 : 640;
  return (
    <Text
      style={[
        styles.paragraph,
        !fullWidth && { maxWidth: measure },
        { fontSize: isMobile || isTablet ? 16 : 17 },
        primary && styles.paragraphPrimary,
      ]}
    >
      {children}
    </Text>
  );
}

function CountLine({ children, inline = false }: { children: ReactNode; inline?: boolean }) {
  return <Text style={[styles.countLine, inline && styles.countLineInline]}>{children}</Text>;
}

function FileDate({ children, inline = false }: { children: ReactNode; inline?: boolean }) {
  return <Text style={[styles.fileDate, inline && styles.fileDateInline]}>{children}</Text>;
}

function Unavailable({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="alert" style={styles.unavailable}>
      {children}
    </Text>
  );
}

export function LobbyingSourceLink({ url, label }: { url: string; label: string }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      {...externalLinkProps(url, () => void Linking.openURL(url))}
      {...hover}
      style={styles.sourceLink}
    >
      <LinkArrowLabel
        label={label}
        style={[styles.sourceLabel, hovered && styles.sourceLabelHover]}
      />
    </Pressable>
  );
}

function RevealButton({ onPress, label }: { onPress: () => void; label: string }) {
  const [hovered, hover] = useHover();
  return (
    <View style={styles.revealWrap}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        {...hover}
        style={({ pressed }) => [
          styles.revealButton,
          hovered && styles.revealButtonHover,
          pressed && styles.revealButtonPressed,
        ]}
      >
        <Text style={styles.revealLabel}>{label}</Text>
        <GreenLinkArrow />
      </Pressable>
    </View>
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
    color: '#4f5651',
    fontFamily: theme.typography.body,
    lineHeight: 26,
  },
  paragraphPrimary: { marginTop: 16, color: '#11150f' },
  recordStrip: {
    minHeight: 45,
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  recordStripMobile: { alignItems: 'flex-start' },
  recordStripCount: { minWidth: 0, gap: 2 },
  countLine: {
    marginTop: 14,
    color: '#3f463f',
    fontFamily: theme.typography.body,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.15,
    fontVariant: ['tabular-nums'],
  },
  countLineInline: { marginTop: 0 },
  fileDate: {
    marginTop: 12,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  fileDateInline: { marginTop: 0 },
  sourceLink: {
    minHeight: 45,
    paddingVertical: 13,
    alignSelf: 'flex-start',
  },
  sourceLabel: {
    color: '#0f7a45',
    fontFamily: theme.typography.body,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
  },
  sourceLabelHover: { color: '#11832b', textDecorationLine: 'underline' },
  unavailable: {
    marginTop: 16,
    maxWidth: 820,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 24,
  },
  list: { marginTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(17,21,15,0.14)' },
  linkRow: {
    minHeight: 52,
    marginHorizontal: -10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    ...linkArrowRow,
    justifyContent: 'space-between',
    borderRadius: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.07)',
  },
  rowHover: { backgroundColor: '#f4f6f4' },
  rowPressed: { backgroundColor: '#eaeeea' },
  plainRow: {
    minHeight: 56,
    marginHorizontal: -10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.07)',
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
    fontWeight: '600',
    lineHeight: 21,
    fontVariant: ['tabular-nums'],
  },
  listNote: {
    marginTop: 4,
    color: '#6b716b',
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
  },
  revealWrap: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.1)',
  },
  revealButton: {
    ...linkArrowRow,
    minHeight: 52,
    width: '100%',
    justifyContent: 'center',
    backgroundColor: '#f7f8f7',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.14)',
    borderRadius: 10,
  },
  revealButtonHover: {
    backgroundColor: '#eef1ee',
    borderColor: 'rgba(17,21,15,0.28)',
  },
  revealButtonPressed: {
    backgroundColor: '#e7eae7',
    borderColor: 'rgba(17,21,15,0.36)',
  },
  revealLabel: {
    color: '#0f7a45',
    fontFamily: theme.typography.body,
    fontSize: 16,
    fontWeight: '700',
  },
  donationYear: { marginTop: 20 },
  yearBand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  yearRule: { height: 1, flex: 1, backgroundColor: 'rgba(17,21,15,0.14)' },
  yearLabel: {
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.3,
    fontVariant: ['tabular-nums'],
  },
  committeeList: { marginTop: 2 },
  committeeBlock: { marginTop: 18 },
  committeeLink: {
    ...linkArrowRow,
    minHeight: 45,
    paddingVertical: 12,
    alignSelf: 'flex-start',
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
    fontFamily: theme.typography.body,
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 1.125,
    fontVariant: ['tabular-nums'],
  },
  payments: {
    marginTop: 8,
    marginLeft: 16,
    paddingLeft: 16,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(17,21,15,0.14)',
  },
  paymentRow: {
    minHeight: 34,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.07)',
  },
  paymentText: { flexShrink: 0, minWidth: 0 },
  paymentDate: {
    color: '#11150f',
    fontFamily: theme.typography.body,
    fontSize: 15.5,
    fontWeight: '700',
    lineHeight: 21,
    fontVariant: ['tabular-nums'],
  },
  paymentAmount: {
    color: '#11150f',
    fontFamily: theme.typography.body,
    fontSize: 16.5,
    fontWeight: '800',
    lineHeight: 21,
    textAlign: 'right',
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
