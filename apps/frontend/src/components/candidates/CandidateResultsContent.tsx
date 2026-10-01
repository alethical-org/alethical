import { StyleSheet, Text, View } from 'react-native';
import { theme as t } from '../../theme/tokens';
import {
  CandidateLink,
  CandidateNotice,
  CandidateSourceLine,
  candidateText,
  sampleBallotUrl,
} from './CandidateControls';
import type {
  CandidateCoverageGap,
  CandidateElection,
  CandidateEntry,
  CandidateOfficeGroup,
  CandidatePerson,
  CandidateRace,
} from './types';

const groups: { key: CandidateOfficeGroup; name: string }[] = [
  { key: 'state', name: 'State offices' },
  { key: 'county', name: 'County offices' },
  { key: 'municipal', name: 'City or township offices' },
  { key: 'school', name: 'School board' },
  { key: 'other', name: 'Other supported local offices' },
];
function entrySortName(entry: CandidateEntry) {
  return entry.kind === 'candidate' ? entry.candidate.sortName : (entry.members[0]?.sortName ?? '');
}
function Person({
  candidate,
  onOpenProfile,
  party = true,
}: {
  candidate: CandidatePerson;
  onOpenProfile(id: string): void;
  party?: boolean;
}) {
  return (
    <View style={styles.person}>
      <View style={styles.personName}>
        <Text style={styles.name}>{candidate.name}</Text>
        {candidate.role ? <Text style={styles.role}>{candidate.role}</Text> : null}
        {party && candidate.party ? (
          <Text style={candidateText.party}>{candidate.party}</Text>
        ) : null}
      </View>
      <CandidateLink
        internal
        url={`/candidates/${encodeURIComponent(candidate.id)}`}
        label="View profile"
        accessibilityLabel={`View profile, ${candidate.name}`}
        onPress={() => onOpenProfile(candidate.id)}
      />
    </View>
  );
}
export function CandidateRaceCard({
  race,
  election,
  onOpenProfile,
}: {
  race: CandidateRace;
  election: CandidateElection;
  onOpenProfile(id: string): void;
}) {
  const entries = [...race.entries].sort((a, b) =>
    entrySortName(a).localeCompare(entrySortName(b), 'en'),
  );
  const tickets = entries.filter((entry) => entry.kind === 'ticket');
  return (
    <View style={styles.card}>
      <View style={styles.raceHeader}>
        <View style={styles.raceWords}>
          <Text accessibilityRole="header" aria-level={3} style={styles.office}>
            {race.office}
          </Text>
          <Text style={styles.area}>{race.votingArea}</Text>
        </View>
        <View style={styles.meta}>
          {election.type !== 'primary' &&
          Number.isInteger(race.seatCount) &&
          (race.seatCount ?? 0) > 0 ? (
            <Text style={styles.metadata}>Elect {race.seatCount}</Text>
          ) : null}
          {tickets.length > 0 ? (
            <Text style={styles.metadata}>
              {tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'} listed
            </Text>
          ) : null}
        </View>
      </View>
      {tickets.length > 0 ? (
        <Text style={styles.ticketHelp}>
          Each ticket includes candidates for governor and lieutenant governor
        </Text>
      ) : null}
      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={candidateText.strong}>No filed candidates listed</Text>
          <Text style={candidateText.body}>
            The available filing records list no candidates for this race
          </Text>
        </View>
      ) : (
        entries.map((entry) => (
          <View
            key={entry.kind === 'candidate' ? entry.candidate.id : entry.id}
            style={styles.entry}
          >
            {entry.kind === 'candidate' ? (
              <Person candidate={entry.candidate} onOpenProfile={onOpenProfile} />
            ) : (
              <View
                accessibilityRole="summary"
                accessibilityLabel={`Ticket: ${entry.members.map((member) => member.name).join(' and ')}`}
                style={styles.ticket}
              >
                {entry.party ? <Text style={candidateText.party}>{entry.party}</Text> : null}
                <View style={styles.ticketMembers}>
                  {entry.members.map((member) => (
                    <Person
                      key={member.id}
                      candidate={member}
                      party={false}
                      onOpenProfile={onOpenProfile}
                    />
                  ))}
                </View>
              </View>
            )}
          </View>
        ))
      )}
      <CandidateSourceLine source={race.source} />
    </View>
  );
}
export function CandidateCoverage({ gaps }: { gaps: CandidateCoverageGap[] }) {
  return (
    <View style={styles.coverage}>
      <Text accessibilityRole="header" aria-level={2} style={styles.coverageHeading}>
        Coverage for this address
      </Text>
      {gaps.map((gap, index) => (
        <View key={`${gap.kind}-${gap.office}-${index}`} style={styles.gap}>
          <Text style={candidateText.strong}>
            {gap.kind === 'coverage-unconfirmed'
              ? gap.office
              : gap.kind === 'district-unconfirmed'
                ? `We couldn’t confirm your district for ${gap.office}`
                : `Candidate records are unavailable for ${gap.office}`}
          </Text>
          <CandidateLink label={`Election information from ${gap.authority}`} url={gap.url} />
        </View>
      ))}
      <View style={styles.ballot}>
        <Text style={[candidateText.body, { fontSize: 14.5, lineHeight: 22 }]}>
          This is a candidate list, not an official sample ballot
        </Text>
        <CandidateLink label="Minnesota sample ballot information" url={sampleBallotUrl} />
      </View>
    </View>
  );
}
export function CandidateRaceGroups({
  races,
  election,
  busy,
  onOpenProfile,
}: {
  races: CandidateRace[];
  election: CandidateElection;
  busy: boolean;
  onOpenProfile(id: string): void;
}) {
  return (
    <View aria-busy={busy || undefined} style={styles.groups}>
      {races.length === 0 ? (
        <CandidateNotice>
          <Text style={candidateText.strong}>
            No candidate records to show for this address and election
          </Text>
        </CandidateNotice>
      ) : null}
      {groups.map((group) => {
        const matched = races.filter((race) => race.group === group.key);
        return matched.length ? (
          <View key={group.key} style={styles.group}>
            <Text accessibilityRole="header" aria-level={2} style={styles.groupHeading}>
              {group.name}
            </Text>
            {matched.map((race) => (
              <CandidateRaceCard
                key={race.id}
                race={race}
                election={election}
                onOpenProfile={onOpenProfile}
              />
            ))}
          </View>
        ) : null;
      })}
    </View>
  );
}
const styles = StyleSheet.create({
  groups: { gap: 32 },
  group: { gap: 12 },
  groupHeading: { ...candidateText.title, fontSize: 24, lineHeight: 30 },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 14,
  },
  raceHeader: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  raceWords: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  office: { ...candidateText.title, fontSize: 18, lineHeight: 24 },
  area: { ...candidateText.body, fontSize: 15, lineHeight: 21, marginTop: 3 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metadata: { ...candidateText.strong, fontSize: 14, lineHeight: 21, color: '#4f5651' },
  ticketHelp: {
    ...candidateText.body,
    fontSize: 14.5,
    lineHeight: 22,
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  entry: { borderTopWidth: 1, borderTopColor: 'rgba(17,21,15,0.08)' },
  person: {
    minHeight: 64,
    paddingHorizontal: 18,
    paddingVertical: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 16,
    rowGap: 4,
  },
  personName: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  name: {
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '700',
    color: '#11150f',
  },
  role: { ...candidateText.body, fontSize: 14, lineHeight: 21 },
  ticket: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8, gap: 6 },
  ticketMembers: { borderLeftWidth: 2, borderLeftColor: '#d4dad6', paddingLeft: 12 },
  empty: { padding: 18, gap: 3, borderTopWidth: 1, borderTopColor: 'rgba(17,21,15,0.08)' },
  coverage: {
    gap: 14,
    padding: 18,
    backgroundColor: '#f2f4f3',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
    borderRadius: 14,
  },
  coverageHeading: { ...candidateText.title, fontSize: 18, lineHeight: 25 },
  gap: {
    backgroundColor: '#fff',
    borderColor: '#efd9a8',
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  ballot: { borderTopWidth: 1, borderTopColor: 'rgba(17,21,15,0.08)', paddingTop: 12, gap: 2 },
});
