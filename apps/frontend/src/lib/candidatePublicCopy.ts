import type { CandidateElection } from '../components/candidates/types';

export const CANDIDATE_LOOKUP_COPY = {
  heading: 'Find my candidates',
  intro:
    'See who’s running where you live in Minnesota, with candidate profiles linked to official records',
  addressLabel: 'Full street address',
  addressHelp: 'A city or ZIP code alone cannot identify your local races',
  privacy: 'Address lookup uses Minnesota Secretary of State and Minnesota mapping services',
};
export const CANDIDATE_PROFILE_COPY = {
  heading: 'Official candidate record',
  legislatorIntro: 'See their bills, votes, and work in office',
  legislatorLink: 'View legislator profile',
  currentService: 'Currently serving as',
  formerService: 'Formerly served as',
  past: 'Candidate for',
  reelection: 'Running for reelection',
  running: 'Running for',
  website: 'Campaign website',
  stale: 'May be out of date',
};

export const sampleBallotUrl = 'https://www.sos.mn.gov/elections-voting/whats-on-my-ballot/';
export function candidateDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : value;
}
export function safeCandidateUrl(url: string) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
}
export function candidateElectionLabel(election: CandidateElection) {
  const prefix = `${candidateDate(election.date)} `;
  if (!election.label.startsWith(prefix)) return election.label;
  const label = election.label.slice(prefix.length);
  if (!new RegExp(`^(?:state )?${election.type}(?: election)?$`, 'i').test(label))
    return election.label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
export function candidateOfficeLabel(office: string, votingArea?: string) {
  const legislative = office.match(
    /^(State Representative|State Senator),?\s+District\s*(\d+[A-Z]?)$/i,
  );
  if (legislative && votingArea) {
    const chamber = /^State Representative$/i.test(legislative[1]) ? 'House' : 'Senate';
    const district = votingArea.match(new RegExp(`^${chamber} District\\s*(\\d+[A-Z]?)$`, 'i'));
    if (district && district[1].toUpperCase() === legislative[2].toUpperCase())
      return chamber === 'House' ? 'State Representative' : 'State Senator';
  }
  return office
    .replace(/^Governor & Lt Governor$/i, 'Governor and Lieutenant Governor')
    .replace(
      /^(Judge|Associate Justice)\s*-\s*(Supreme Court|Court of Appeals|\d+(?:st|nd|rd|th) District Court)\s+(\d+)$/i,
      '$1, $2, Seat $3',
    );
}
export function areaLabel(area: string) {
  return area.replace(/^Judicial District (\d+(?:st|nd|rd|th))$/i, '$1 Judicial District');
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

export function candidateRecordsSourceLabel(authority: string) {
  return `Candidate records from ${authority}`;
}
export function candidateCheckedLabel(checkedDate: string) {
  return `Checked ${candidateDate(checkedDate)}`;
}
export function candidateServiceSourceLabel(authority: string) {
  return `Service records from ${authority}`;
}
export function candidateWebsiteLabel(website: string) {
  return website.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
export function candidatePartyLabel(party?: string) {
  return party?.toUpperCase() === 'NONPARTISAN' ? 'Nonpartisan' : party;
}
