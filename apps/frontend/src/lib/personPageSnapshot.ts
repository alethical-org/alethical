import type {
  CandidateElection,
  CandidateElectionResult,
  CandidateSource,
  PublicPersonLink,
} from '../components/candidates/types';
import type { PersonRecord, PreciseDate } from '../data/personRecords';
import {
  areaLabel,
  candidateDate,
  candidateElectionLabel,
  candidateOfficeLabel,
  safeCandidateUrl,
} from './candidatePublicCopy';
import {
  PERSON_RECORD_COPY,
  electionOutcomeLabel,
  electionResultLabel,
  preciseDate,
  researchContextLabel,
  researchTypeLabel,
  serviceDateLines,
  serviceStatusLabel,
} from './personRecords';
import type { PageSnapshot, SnapshotSection } from './pageSnapshot';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const candidateId = /^[0-9a-f]{64}$/;
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/** The reciprocal link is optional; never infer it from a name or accept an external target. */
export function validPublicPersonLink(value: unknown): value is PublicPersonLink {
  if (!value || typeof value !== 'object') return false;
  const person = value as Partial<PublicPersonLink>;
  return Boolean(
    text(person.id) &&
    uuid.test(person.id) &&
    text(person.name) &&
    person.profileUrl === `/people/${person.id}`,
  );
}
function date(value: unknown): value is string {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function validPublicSource(source: CandidateSource | undefined): boolean {
  return Boolean(
    source && text(source.authority) && safeCandidateUrl(source.url) && date(source.checkedDate),
  );
}
function validElection(election: CandidateElection): boolean {
  return Boolean(
    election &&
    text(election.id) &&
    text(election.label) &&
    date(election.date) &&
    ['general', 'primary', 'special'].includes(election.type),
  );
}
export function validElectionResult(result: CandidateElectionResult): boolean {
  if (
    !result ||
    !['pending', 'unofficial', 'certified', 'recount', 'tie', 'unavailable'].includes(result.status)
  )
    return false;
  if (result.source && !validPublicSource(result.source)) return false;
  if (result.outcome && !['elected', 'not-elected', 'withdrew'].includes(result.outcome))
    return false;
  if (
    (result.outcome === 'elected' || result.outcome === 'not-elected') &&
    result.status !== 'certified'
  )
    return false;
  const certification = result.certification;
  if (result.status === 'certified' && (!result.source || !certification)) return false;
  return (
    !certification ||
    (result.status === 'certified' &&
      text(certification.authority) &&
      Boolean(safeCandidateUrl(certification.url)) &&
      (certification.date === undefined || date(certification.date)))
  );
}
function validPreciseDate(value: PreciseDate | undefined): boolean {
  if (value === undefined) return true;
  return Boolean(
    value &&
    (value.precision === 'day'
      ? date(value.value)
      : value.precision === 'month'
        ? /^\d{4}-(0[1-9]|1[0-2])$/.test(value.value)
        : value.precision === 'year' && /^\d{4}$/.test(value.value)),
  );
}

/** Reject incomplete identities and unsafe links before publishing public first-response text. */
export function validPersonRecord(record: PersonRecord, requestedId: string): boolean {
  if (
    !record ||
    record.id !== requestedId ||
    !uuid.test(record.id) ||
    !text(record.name) ||
    !Array.isArray(record.service) ||
    !Array.isArray(record.elections) ||
    !Array.isArray(record.research?.items)
  )
    return false;
  if (
    record.legislator &&
    (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.legislator.slug) ||
      record.legislator.profileUrl !== `/legislators/${record.legislator.slug}`)
  )
    return false;
  return (
    record.service.every(
      (item) =>
        item &&
        text(item.id) &&
        text(item.office) &&
        text(item.votingArea) &&
        ['current', 'elected', 'former', 'unknown'].includes(item.status) &&
        (item.source
          ? text(item.source.authority) &&
            Boolean(safeCandidateUrl(item.source.url)) &&
            (item.source.checkedDate === undefined || date(item.source.checkedDate))
          : Boolean(record.legislator && item.profileUrl === record.legislator.profileUrl)) &&
        (item.startDate === undefined || date(item.startDate)) &&
        (item.endDate === undefined || date(item.endDate)) &&
        [item.termStart, item.termEnd, item.expectedStart, item.expectedEnd].every(
          validPreciseDate,
        ) &&
        (!item.expectedDateSource || validPublicSource(item.expectedDateSource)),
    ) &&
    record.elections.every(
      (item) =>
        item &&
        candidateId.test(item.candidateId) &&
        item.profileUrl === `/candidates/${item.candidateId}` &&
        text(item.name) &&
        text(item.office) &&
        text(item.votingArea) &&
        validElection(item.election) &&
        validPublicSource(item.source) &&
        (!item.result || validElectionResult(item.result)),
    ) &&
    record.research.items.every((item) => {
      const context = item?.context;
      return Boolean(
        item &&
        text(item.id) &&
        text(item.title) &&
        text(item.publisher) &&
        ['official-record', 'article', 'debate'].includes(item.type) &&
        ['available', 'corrected', 'withdrawn', 'unavailable'].includes(item.status) &&
        validPublicSource(item.source) &&
        [item.eventDate, item.publishedDate, item.correctionDate].every(
          (value) => value === undefined || date(value),
        ) &&
        context &&
        text(context.office) &&
        (context.kind === 'service'
          ? record.service.some((service) => service.id === context.serviceId)
          : context.kind === 'election' &&
            record.elections.some((election) => election.candidateId === context.candidateId) &&
            validElection(context.election)),
      );
    })
  );
}

export function electionResultSnapshot(
  result: CandidateElectionResult,
  includeSource = true,
): SnapshotSection {
  return {
    heading: '',
    body: [
      ...(result.outcome ? [electionOutcomeLabel(result.outcome)] : []),
      electionResultLabel(result),
      ...(result.status === 'unofficial' ? ['These results have not been certified'] : []),
      ...(result.certification?.date
        ? [`Certified ${candidateDate(result.certification.date)}`]
        : []),
      ...(includeSource && result.source
        ? [`Checked ${candidateDate(result.source.checkedDate)}`]
        : []),
    ],
    items: [
      ...(includeSource && result.source
        ? [{ label: `Results from ${result.source.authority}`, href: result.source.url }]
        : []),
    ],
  };
}

/** Only public sourced fields enter HTML; return journeys and account data never do. */
export function personPageSnapshot(record: PersonRecord): PageSnapshot {
  const sections: SnapshotSection[] = [
    {
      heading: PERSON_RECORD_COPY.service,
      body: record.service.length ? [] : [PERSON_RECORD_COPY.noService],
    },
    ...record.service.map((item) => ({
      heading: candidateOfficeLabel(item.office, item.votingArea),
      body: [
        serviceStatusLabel(item),
        areaLabel(item.votingArea),
        ...serviceDateLines(item),
        ...(item.status === 'elected'
          ? [
              item.expectedStart
                ? `Expected start ${preciseDate(item.expectedStart)}`
                : 'Start date not confirmed',
            ]
          : []),
        ...(item.status === 'elected' && item.expectedStartPassed
          ? ['Current service not confirmed']
          : []),
        ...(item.source?.checkedDate ? [`Checked ${candidateDate(item.source.checkedDate)}`] : []),
      ],
      items: [
        ...(item.profileUrl && record.legislator
          ? [{ label: 'View legislator profile', href: record.legislator.profileUrl }]
          : []),
        ...(item.source
          ? [{ label: `Service records from ${item.source.authority}`, href: item.source.url }]
          : []),
      ],
    })),
    {
      heading: PERSON_RECORD_COPY.elections,
      body: record.elections.length ? [] : [PERSON_RECORD_COPY.noElections],
    },
    ...record.elections.slice(0, 3).map((item) => ({
      heading: `${candidateElectionLabel(item.election)} · ${candidateDate(item.election.date)}`,
      body: [
        candidateOfficeLabel(item.office, item.votingArea),
        areaLabel(item.votingArea),
        ...(item.result ? (electionResultSnapshot(item.result, false).body ?? []) : []),
      ],
      items: [{ label: 'View election record', href: item.profileUrl }],
    })),
    {
      heading: PERSON_RECORD_COPY.research,
      body: record.research.items.length ? [] : [PERSON_RECORD_COPY.noResearch],
    },
    ...record.research.items.map((item) => ({
      heading: item.title,
      body: [
        researchTypeLabel(item.type),
        item.publisher,
        researchContextLabel(item),
        ...(item.eventDate ? [`Event date ${candidateDate(item.eventDate)}`] : []),
        ...(item.publishedDate ? [`Published ${candidateDate(item.publishedDate)}`] : []),
        ...(item.status === 'corrected'
          ? [
              `Source corrected${item.correctionDate ? ` · ${candidateDate(item.correctionDate)}` : ''}`,
              ...(item.correctionNote ? [item.correctionNote] : []),
            ]
          : item.status === 'withdrawn'
            ? ['Withdrawn by the publisher']
            : item.status === 'unavailable'
              ? ['No longer available at the source']
              : []),
        `Checked ${candidateDate(item.source.checkedDate)}`,
      ],
      items: item.status === 'unavailable' ? [] : [{ label: 'View source', href: item.source.url }],
    })),
  ];
  return {
    backLink: { label: 'Find my candidates', href: '/candidates' },
    heading: record.name,
    eyebrow: PERSON_RECORD_COPY.eyebrow,
    profileLabel: true,
    subheading: '',
    bodyHeading: '',
    body: [],
    bodyIsList: false,
    facts: [],
    sections,
    links: [],
  };
}
