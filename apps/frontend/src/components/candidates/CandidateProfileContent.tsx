import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useResponsive } from '../../hooks/useResponsive';
import {
  CandidateLink,
  CandidateSourceLine,
  candidateDate,
  candidateText,
  safeCandidateUrl,
} from './CandidateControls';
import { candidateElectionLabel, candidateOfficeLabel, areaLabel } from './CandidateResultsContent';
import type { CandidateProfileRecord } from './types';

/** An approved source image keeps its natural ratio; failure removes the whole slot. */
export function CandidatePortrait({
  url,
  name,
  width,
  credit,
}: {
  url: string;
  name: string;
  width: number;
  credit?: string;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  if (state === 'failed' || !safeCandidateUrl(url) || Platform.OS !== 'web') return null;
  return (
    <View style={{ width, flexShrink: 0, gap: 6 }}>
      <img
        src={url}
        alt={name}
        onLoad={() => setState('loaded')}
        onError={() => setState('failed')}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          boxSizing: 'border-box',
          minHeight: state === 'loading' ? width * 1.25 : undefined,
          background: state === 'loading' ? '#eef0ef' : undefined,
          border: '1px solid rgba(17,21,15,0.12)',
        }}
      />
      {credit ? (
        <Text style={[candidateText.body, { fontSize: 12, lineHeight: 17 }]}>{credit}</Text>
      ) : null}
    </View>
  );
}

export function candidateElectionHasPassed(date: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return date < `${value('year')}-${value('month')}-${value('day')}`;
}

export function CandidateProfileContent({
  record,
  onBack,
  onOpenLegislator,
  fromSearch = true,
  children,
}: {
  record: CandidateProfileRecord;
  children?: React.ReactNode;
  onBack(): void;
  fromSearch?: boolean;
  onOpenLegislator?(slug: string): void;
  /** Kept for the existing preview route; joint records never invent separate people. */
  onOpenProfile?(id: string): void;
}) {
  const { isMobile, isDesktop } = useResponsive();
  const bodyStyle = { fontSize: isMobile ? 16 : 17, lineHeight: isMobile ? 24 : 25.5 };
  const inset = isMobile ? 18 : isDesktop ? 28 : 24;
  const leg = record.legislator;
  const past = candidateElectionHasPassed(record.election.date);
  const reelection = !past && leg?.serviceStatus === 'current' && leg.isReelection;
  const showService =
    leg && (leg.serviceStatus === 'former' || (leg.serviceStatus === 'current' && !reelection));
  return (
    <View
      style={[
        styles.page,
        {
          paddingHorizontal: isMobile ? 20 : isDesktop ? 40 : 32,
          paddingTop: isMobile ? 16 : isDesktop ? 24 : 22,
        },
      ]}
    >
      <View style={styles.content}>
        <CandidateLink
          internal
          url="/candidates"
          label={fromSearch ? 'Back to candidates' : 'Find my candidates'}
          onPress={onBack}
        />
        <View
          style={{
            marginTop: 12,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: isMobile ? 14 : isDesktop ? 22 : 20,
          }}
        >
          {record.photo && !record.isJointTicket ? (
            <CandidatePortrait
              key={record.photo.url}
              url={record.photo.url}
              name={record.candidate.name}
              credit={record.photo.credit}
              width={isMobile ? 84 : isDesktop ? 120 : 112}
            />
          ) : null}
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[
              candidateText.title,
              {
                fontSize: isMobile ? 32 : isDesktop ? 44 : 40,
                lineHeight: (isMobile ? 32 : isDesktop ? 44 : 40) * 1.08,
                flexShrink: 1,
                minWidth: 0,
                ...(Platform.OS === 'web'
                  ? ({ overflowWrap: 'anywhere', textWrap: 'balance' } as object)
                  : {}),
              },
            ]}
          >
            {record.candidate.name}
          </Text>
        </View>
        {leg ? (
          <View accessibilityLabel="Legislator profile" style={styles.legislator}>
            <View
              style={{
                paddingTop: isMobile ? 16 : 18,
                paddingHorizontal: isMobile ? 16 : 20,
                paddingBottom: 8,
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 14,
              }}
            >
              {record.isJointTicket && leg.photoUrl ? (
                <CandidatePortrait
                  key={leg.photoUrl}
                  url={leg.photoUrl}
                  name={leg.name}
                  width={64}
                />
              ) : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                {record.isJointTicket ? (
                  <Text
                    style={[
                      candidateText.strong,
                      { fontSize: 17, fontWeight: '800', marginBottom: 8 },
                    ]}
                  >
                    {leg.name}
                  </Text>
                ) : null}
                {showService ? (
                  <View style={{ gap: 3, marginBottom: 12 }}>
                    <Text style={styles.label}>
                      {leg.serviceStatus === 'current'
                        ? 'Currently serving as'
                        : 'Formerly served as'}
                    </Text>
                    {leg.office ? (
                      <Text style={[candidateText.strong, { fontSize: 17 }]}>{leg.office}</Text>
                    ) : null}
                    {leg.votingArea ? (
                      <Text style={candidateText.body}>{leg.votingArea}</Text>
                    ) : null}
                  </View>
                ) : null}
                <Text style={[candidateText.body, { fontSize: 15.5, lineHeight: 23 }]}>
                  See their bills, votes, and work in office
                </Text>
                <CandidateLink
                  internal
                  url={leg.profileUrl}
                  label="View legislator profile"
                  onPress={onOpenLegislator ? () => onOpenLegislator(leg.slug) : undefined}
                />
              </View>
            </View>
            {leg.source ? (
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: 'rgba(17,21,15,0.08)',
                  paddingTop: 6,
                  paddingBottom: 12,
                  paddingHorizontal: inset,
                }}
              >
                <CandidateLink
                  url={leg.source.url}
                  label={`Service records from ${leg.source.authority}`}
                />
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={styles.card}>
          <View
            style={{
              paddingTop: isMobile ? 20 : isDesktop ? 26 : 24,
              paddingHorizontal: inset,
              paddingBottom: isMobile ? 16 : isDesktop ? 20 : 18,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View aria-hidden style={styles.building}>
                <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" aria-hidden>
                  <Path
                    d="M3.5 9.5L12 4.5L20.5 9.5M5.5 10V18M10 10V18M14 10V18M18.5 10V18M3.5 20H20.5"
                    stroke="#149d5b"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </View>
              <Text
                accessibilityRole="header"
                aria-level={2}
                style={[
                  candidateText.title,
                  {
                    fontSize: isMobile ? 19 : isDesktop ? 21 : 20,
                    lineHeight: 28,
                    flexShrink: 1,
                  },
                ]}
              >
                Official candidate record
              </Text>
            </View>
            <View style={{ marginTop: 16, gap: 3 }}>
              <Text style={styles.label}>
                {past ? 'Candidate for' : reelection ? 'Running for reelection' : 'Running for'}
              </Text>
              <Text
                style={[
                  candidateText.strong,
                  { fontSize: isMobile ? 18 : isDesktop ? 20 : 19, lineHeight: 27 },
                ]}
              >
                {candidateOfficeLabel(record.office, record.votingArea)}
              </Text>
              <Text style={[candidateText.body, bodyStyle]}>{areaLabel(record.votingArea)}</Text>
              <Text
                style={[
                  candidateText.body,
                  bodyStyle,
                  { marginTop: 6, fontVariant: ['tabular-nums'] },
                ]}
              >
                {candidateElectionLabel(record.election)} · {candidateDate(record.election.date)}
              </Text>
            </View>
            {record.candidate.party ? (
              <Text style={[candidateText.party, { marginTop: 12 }]}>
                {record.candidate.party.toUpperCase() === 'NONPARTISAN'
                  ? 'Nonpartisan'
                  : record.candidate.party}
              </Text>
            ) : null}
            {record.website && safeCandidateUrl(record.website) ? (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.label}>Campaign website</Text>
                <CandidateLink
                  url={record.website}
                  label={record.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                />
              </View>
            ) : null}
          </View>
          <CandidateSourceLine
            source={record.source}
            style={{ paddingHorizontal: inset, paddingTop: 8, paddingBottom: 14 }}
          />
        </View>
        {children}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  page: { paddingBottom: 56, width: '100%' },
  content: { maxWidth: 760, width: '100%', alignSelf: 'center' },
  label: { ...candidateText.body, fontSize: 14.5, fontWeight: '700', marginBottom: 2 },
  legislator: {
    marginTop: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 14,
  },
  card: {
    marginTop: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 16,
    ...(Platform.OS === 'web' ? ({ boxShadow: '0 8px 24px rgba(17,21,15,0.05)' } as object) : {}),
  },
  building: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#e4f8ee',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
});
