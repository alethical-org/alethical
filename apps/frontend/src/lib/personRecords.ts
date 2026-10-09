import type {
  CandidateElection,
  CandidateElectionResult,
  CandidateSource,
} from '../components/candidates/types';
import type { PersonResearchRecord, PersonServiceRecord, PreciseDate } from '../data/personRecords';
import {
  candidateDate,
  candidateElectionLabel,
  candidateElectionHasPassed,
} from './candidatePublicCopy';

export const PERSON_RECORD_COPY = {
  introduction: 'Elections and service over time',
  link: 'View person profile',
  eyebrow: 'Person profile',
  service: 'Service',
  elections: 'Elections',
  research: 'Research',
  noService: 'No service records added',
  noElections: 'No election records added',
  noResearch: 'No research records added',
  researchLoading: 'Loading research records…',
  researchUpdating: 'Updating research records…',
  researchUnavailable: 'Research records are unavailable',
  historicalMatchUnavailable: 'We couldn’t confirm the races for this address and election',
};
export function preciseDate(date: PreciseDate) {
  if (date.precision === 'year') return date.value;
  if (date.precision === 'month')
    return new Date(`${date.value}-01T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  return candidateDate(date.value);
}
export function electionResultLabel(result: CandidateElectionResult) {
  return {
    certified: result.certification?.date ? 'Election results' : 'Certified election results',
    unofficial: 'Unofficial election results',
    pending: 'Election results pending',
    recount: 'Election recount in progress',
    tie: 'Election tie unresolved',
    unavailable: 'Election results unavailable',
  }[result.status];
}
export function electionOutcomeLabel(outcome: CandidateElectionResult['outcome']) {
  return outcome
    ? { elected: 'Elected', 'not-elected': 'Not elected', withdrew: 'Withdrew' }[outcome]
    : '';
}
export function ballotCheckedLabel(source: CandidateSource) {
  return `${source.retained ? 'Ballot record saved' : 'Checked'} ${candidateDate(source.checkedDate)}`;
}
export function serviceStatusLabel(record: PersonServiceRecord) {
  return {
    current: 'Currently serving as',
    elected: 'Elected to',
    former: 'Formerly served as',
    unknown: 'Current service not confirmed',
  }[record.status];
}
export function serviceDateLines(record: PersonServiceRecord) {
  const lines: string[] = [];
  if (record.startDate && record.status !== 'elected')
    lines.push(`Started ${candidateDate(record.startDate)}`);
  if (record.endDate) lines.push(`Ended ${candidateDate(record.endDate)}`);
  if (!record.startDate && record.termStart && record.termEnd)
    lines.push(`Term ${preciseDate(record.termStart)}–${preciseDate(record.termEnd)}`);
  else if (!record.startDate && record.termStart)
    lines.push(`Term starts ${preciseDate(record.termStart)}`);
  else if (!record.endDate && record.termEnd)
    lines.push(`Term ends ${preciseDate(record.termEnd)}`);
  return lines;
}
export function researchTypeLabel(type: PersonResearchRecord['type']) {
  return { 'official-record': 'Official record', article: 'Article', debate: 'Debate' }[type];
}
export function researchContextLabel(record: PersonResearchRecord) {
  const context = record.context;
  return context.kind === 'election'
    ? `${candidateElectionLabel(context.election)} · ${candidateDate(context.election.date)} · ${context.office}`
    : context.office;
}
export function defaultCandidateElection(elections: CandidateElection[], now = new Date()) {
  const sorted = [...elections].sort((a, b) => a.date.localeCompare(b.date));
  return (
    sorted.find((election) => !candidateElectionHasPassed(election.date, now)) ?? sorted.at(-1)
  );
}
