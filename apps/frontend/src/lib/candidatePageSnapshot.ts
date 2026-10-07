import type { CandidateProfileRecord } from '../components/candidates/types';
import {
  CANDIDATE_LOOKUP_COPY,
  CANDIDATE_PROFILE_COPY,
  areaLabel,
  candidateDate,
  candidateElectionHasPassed,
  candidateElectionLabel,
  candidateOfficeLabel,
  safeCandidateUrl,
  candidateRecordsSourceLabel,
  candidateCheckedLabel,
  candidateServiceSourceLabel,
  candidateWebsiteLabel,
  candidatePartyLabel,
} from './candidatePublicCopy';
import type { PageSnapshot, SnapshotSection } from './pageSnapshot';

/** Public instructions only. Address searches and their results stay in temporary memory. */
export function candidateLookupPageSnapshot(): PageSnapshot {
  return {
    heading: CANDIDATE_LOOKUP_COPY.heading,
    subheading: CANDIDATE_LOOKUP_COPY.intro,
    bodyHeading: CANDIDATE_LOOKUP_COPY.addressLabel,
    body: [CANDIDATE_LOOKUP_COPY.addressHelp, CANDIDATE_LOOKUP_COPY.privacy],
    bodyIsList: false,
    facts: [],
    links: [],
  };
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function date(value: unknown): value is string {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Do not publish a nameless, mismatched or incomplete identity as a successful page. */
export function validCandidateProfileRecord(
  value: CandidateProfileRecord,
  requestedId: string,
): boolean {
  if (
    !value ||
    value.candidate?.id !== requestedId ||
    !text(value.candidate?.name) ||
    !text(value.office) ||
    !text(value.votingArea) ||
    !text(value.election?.id) ||
    !text(value.election?.label) ||
    !date(value.election?.date) ||
    !['general', 'primary', 'special'].includes(value.election?.type) ||
    !text(value.source?.authority) ||
    !text(value.source?.url) ||
    !safeCandidateUrl(value.source.url) ||
    !date(value.source?.checkedDate) ||
    (value.source.stale !== undefined && typeof value.source.stale !== 'boolean') ||
    (value.candidate.party !== undefined && !text(value.candidate.party)) ||
    (value.website !== undefined && typeof value.website !== 'string')
  )
    return false;
  const legislator = value.legislator;
  return (
    !legislator ||
    (text(legislator.id) &&
      text(legislator.name) &&
      text(legislator.slug) &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(legislator.slug) &&
      legislator.profileUrl === `/legislators/${legislator.slug}` &&
      ['current', 'former', 'unknown'].includes(legislator.serviceStatus) &&
      typeof legislator.isReelection === 'boolean' &&
      (legislator.office === undefined || text(legislator.office)) &&
      (legislator.votingArea === undefined || text(legislator.votingArea)) &&
      (!legislator.source ||
        (text(legislator.source.authority) &&
          text(legislator.source.url) &&
          Boolean(safeCandidateUrl(legislator.source.url)))))
  );
}

/** Pick only the held public facts the screen draws, never private or campaign-authored fields. */
export function candidateProfilePageSnapshot(
  record: CandidateProfileRecord,
  now = new Date(),
): PageSnapshot {
  const leg = record.legislator;
  const past = candidateElectionHasPassed(record.election.date, now);
  const reelection = !past && leg?.serviceStatus === 'current' && leg.isReelection;
  const running = past
    ? CANDIDATE_PROFILE_COPY.past
    : reelection
      ? CANDIDATE_PROFILE_COPY.reelection
      : CANDIDATE_PROFILE_COPY.running;
  const sections: SnapshotSection[] = [];
  if (leg) {
    const showService =
      leg.serviceStatus === 'former' || (leg.serviceStatus === 'current' && !reelection);
    sections.push({
      heading: record.isJointTicket ? leg.name : '',
      body: [
        ...(showService
          ? [
              leg.serviceStatus === 'current'
                ? CANDIDATE_PROFILE_COPY.currentService
                : CANDIDATE_PROFILE_COPY.formerService,
              ...(leg.office ? [leg.office] : []),
              ...(leg.votingArea ? [leg.votingArea] : []),
            ]
          : []),
        CANDIDATE_PROFILE_COPY.legislatorIntro,
      ],
      items: [
        { label: CANDIDATE_PROFILE_COPY.legislatorLink, href: leg.profileUrl },
        ...(leg.source && safeCandidateUrl(leg.source.url)
          ? [{ label: candidateServiceSourceLabel(leg.source.authority), href: leg.source.url }]
          : []),
      ],
    });
  }
  sections.push({
    heading: CANDIDATE_PROFILE_COPY.heading,
    body: [
      running,
      candidateOfficeLabel(record.office, record.votingArea),
      areaLabel(record.votingArea),
      `${candidateElectionLabel(record.election)} · ${candidateDate(record.election.date)}`,
      ...(record.candidate.party ? [candidatePartyLabel(record.candidate.party)!] : []),
      ...(record.website && safeCandidateUrl(record.website)
        ? [CANDIDATE_PROFILE_COPY.website]
        : []),
    ],
    items: [
      ...(record.website && safeCandidateUrl(record.website)
        ? [{ label: candidateWebsiteLabel(record.website), href: record.website }]
        : []),
      { label: candidateRecordsSourceLabel(record.source.authority), href: record.source.url },
    ],
  });
  sections.push({
    heading: '',
    body: [
      candidateCheckedLabel(record.source.checkedDate),
      ...(record.source.stale ? [CANDIDATE_PROFILE_COPY.stale] : []),
    ],
  });
  return {
    backLink: { label: CANDIDATE_LOOKUP_COPY.heading, href: '/candidates' },
    heading: record.candidate.name,
    subheading: '',
    bodyHeading: '',
    body: [],
    bodyIsList: false,
    facts: [],
    sections,
    links: [],
  };
}
