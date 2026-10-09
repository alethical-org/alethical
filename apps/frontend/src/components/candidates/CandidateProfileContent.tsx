import { useId, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useResponsive } from '../../hooks/useResponsive';
import { GoBackLink } from '../GoBackLink';
import { CandidateLink, candidateDate, candidateText, safeCandidateUrl } from './CandidateControls';
import { candidateElectionLabel, candidateOfficeLabel, areaLabel } from './CandidateResultsContent';
import type { CandidateProfileRecord } from './types';
import { PERSON_RECORD_COPY } from '../../lib/personRecords';
import { CandidateRecordSources, ElectionRecordStatus } from './ElectionResult';
import { ProfileContextLabel } from '../ProfileContextLabel';

import {
  candidateElectionHasPassed,
  candidateServiceSourceLabel,
  candidatePartyLabel,
  candidateWebsiteLabel,
  CANDIDATE_PROFILE_COPY,
} from '../../lib/candidatePublicCopy';
export { candidateElectionHasPassed } from '../../lib/candidatePublicCopy';

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

export function CandidateProfileContent({
  record,
  onBack,
  onOpenLegislator,
  onOpenPerson,
  children,
}: {
  record: CandidateProfileRecord;
  children?: React.ReactNode;
  onBack(): void;
  onOpenLegislator?(slug: string): void;
  onOpenPerson?(id: string): void;
  /** Kept for the existing preview route; joint records never invent separate people. */
  onOpenProfile?(id: string): void;
}) {
  const { isMobile, isDesktop } = useResponsive();
  const bodyStyle = { fontSize: isMobile ? 16 : 17, lineHeight: isMobile ? 24 : 25.5 };
  const inset = isMobile ? 18 : isDesktop ? 28 : 24;
  const leg = record.legislator;
  const personDescription = useId();
  const past = record.electionEnded ?? candidateElectionHasPassed(record.election.date);
  const showRecordStatus =
    record.result && (record.result.status !== 'certified' || Boolean(record.result.outcome));
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
        <GoBackLink
          href="/candidates"
          onPress={onBack}
          mobile={isMobile}
          style={{ minHeight: 44, marginBottom: 0 }}
        />
        <ProfileContextLabel>Candidate profile</ProfileContextLabel>
        <View
          style={{
            marginTop: 14,
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
        {record.people?.length ? (
          <View style={{ marginTop: 12 }}>
            <Text nativeID={personDescription} style={candidateText.body}>
              {PERSON_RECORD_COPY.introduction}
            </Text>
            <View
              style={
                record.isJointTicket
                  ? { marginTop: 10, flexDirection: isMobile ? 'column' : 'row', gap: 10 }
                  : undefined
              }
            >
              {record.people.map((person) => (
                <View
                  key={person.id}
                  style={
                    record.isJointTicket
                      ? {
                          flex: 1,
                          minWidth: 0,
                          paddingHorizontal: 16,
                          paddingTop: 12,
                          paddingBottom: 4,
                          borderWidth: 1,
                          borderColor: 'rgba(17,21,15,0.1)',
                          borderRadius: 14,
                          backgroundColor: '#fff',
                        }
                      : undefined
                  }
                >
                  {record.isJointTicket ? (
                    <Text
                      style={[
                        candidateText.strong,
                        { fontSize: 17, fontWeight: '800', lineHeight: 23 },
                      ]}
                    >
                      {person.name}
                    </Text>
                  ) : null}
                  <CandidateLink
                    internal
                    label={PERSON_RECORD_COPY.link}
                    url={`${person.profileUrl}?candidate=${record.candidate.id}`}
                    describedBy={personDescription}
                    accessibilityLabel={`${PERSON_RECORD_COPY.link}, ${person.name}`}
                    onPress={onOpenPerson ? () => onOpenPerson(person.id) : undefined}
                  />
                </View>
              ))}
            </View>
          </View>
        ) : null}
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
                        ? CANDIDATE_PROFILE_COPY.currentService
                        : CANDIDATE_PROFILE_COPY.formerService}
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
                  {CANDIDATE_PROFILE_COPY.legislatorIntro}
                </Text>
                <CandidateLink
                  internal
                  url={leg.profileUrl}
                  label={CANDIDATE_PROFILE_COPY.legislatorLink}
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
                  label={candidateServiceSourceLabel(leg.source.authority)}
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
              paddingBottom: isMobile ? 24 : isDesktop ? 30 : 28,
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
                {CANDIDATE_PROFILE_COPY.heading}
              </Text>
            </View>
            <View style={{ marginTop: 16, flexDirection: isMobile ? 'column' : 'row', gap: 24 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ gap: 3 }}>
                  <Text style={styles.label}>
                    {past
                      ? CANDIDATE_PROFILE_COPY.past
                      : reelection
                        ? CANDIDATE_PROFILE_COPY.reelection
                        : CANDIDATE_PROFILE_COPY.running}
                  </Text>
                  <Text
                    style={[
                      candidateText.strong,
                      { fontSize: isMobile ? 18 : isDesktop ? 20 : 19, lineHeight: 27 },
                    ]}
                  >
                    {candidateOfficeLabel(record.office, record.votingArea)}
                  </Text>
                  {isMobile && showRecordStatus ? (
                    <View style={{ marginTop: 10, marginBottom: 8 }}>
                      <ElectionRecordStatus result={record.result} />
                    </View>
                  ) : null}
                  <Text style={[candidateText.body, bodyStyle]}>
                    {areaLabel(record.votingArea)}
                  </Text>
                  <Text
                    style={[
                      candidateText.body,
                      bodyStyle,
                      { marginTop: 6, fontVariant: ['tabular-nums'] },
                    ]}
                  >
                    {candidateElectionLabel(record.election)} ·{' '}
                    {candidateDate(record.election.date)}
                  </Text>
                </View>
                {record.candidate.party ? (
                  <Text style={[candidateText.party, { marginTop: 12 }]}>
                    {candidatePartyLabel(record.candidate.party)}
                  </Text>
                ) : null}
              </View>
              {!isMobile ? <ElectionRecordStatus result={record.result} /> : null}
            </View>
            {record.website && safeCandidateUrl(record.website) ? (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.label}>{CANDIDATE_PROFILE_COPY.website}</Text>
                <CandidateLink url={record.website} label={candidateWebsiteLabel(record.website)} />
              </View>
            ) : null}
          </View>
          <CandidateRecordSources source={record.source} result={record.result} inset={inset} />
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
