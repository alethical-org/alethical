import { formatDay } from '@alethical/shared/moneyFormat';

import {
  CampaignFinance,
  KeyFigures,
  accountsFrom,
  useFinanceYears,
} from '../parts/CampaignFinance';
import { useRecordRead } from '../parts/recordRead';
import { candidateSeat, seatParts } from './seat';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { Refused } from '../ui/controls';
import { Arrow, BackLink, LoadingLine, WithArrow } from '../ui/parts';
import { MediaBuysCard } from './media/MediaBuysCard';
import './people.css';

/** The fields of the public site's candidate profile (`GET /candidates/{id}`,
 * `CandidateProfileRecord` in apps/frontend) this page prints. */
interface CandidateSource {
  authority?: string;
  url?: string;
  checkedDate?: string;
  retained?: boolean;
}

interface ElectionResult {
  status: 'pending' | 'unofficial' | 'certified' | 'recount' | 'tie' | 'unavailable';
  outcome?: 'elected' | 'not-elected' | 'withdrew';
  source?: CandidateSource;
}

export interface CandidateRecord {
  candidate: { id: string; name: string; party?: string | null };
  election: { id: string; label?: string; date: string; type: 'general' | 'primary' | 'special' };
  office: string;
  votingArea: string;
  source: CandidateSource;
  people?: Array<{ id: string; name: string }>;
  result?: ElectionResult;
  electionEnded?: boolean;
  legislator?: {
    slug: string;
    name: string;
    serviceStatus: 'current' | 'former' | 'unknown';
    isReelection: boolean;
    office?: string;
    votingArea?: string;
  };
}

/** The public site's result wording (apps/frontend/src/lib/personRecords.ts). */
export const RESULT_LABELS: Record<ElectionResult['status'], string> = {
  certified: 'Election results',
  unofficial: 'Unofficial election results',
  pending: 'Election results pending',
  recount: 'Election recount in progress',
  tie: 'Election tie unresolved',
  unavailable: 'Election results unavailable',
};

export const OUTCOME_LABELS = {
  elected: 'Elected',
  'not-elected': 'Not elected',
  withdrew: 'Withdrew',
};

/** A vote outcome is stated only once certified; a withdrawal is sourced on its own. */
export function finalOutcome(result?: ElectionResult) {
  return result?.outcome === 'withdrew' || result?.status === 'certified'
    ? result.outcome
    : undefined;
}

/** "Elected · Election results", or the status alone while no outcome is final. */
export function resultLine(result?: ElectionResult): string {
  if (!result) return 'Election results pending';
  const outcome = finalOutcome(result);
  const label = RESULT_LABELS[result.status];
  return outcome ? `${OUTCOME_LABELS[outcome]} · ${label}` : label;
}

function electionYear(record: CandidateRecord): string {
  return record.election.date.slice(0, 4);
}

/** Past: the election day has gone by (served by the record itself). */
export function isPast(record: CandidateRecord): boolean {
  return Boolean(record.electionEnded);
}

/** "Candidate for", "Running for reelection as" or "Running for". */
export function runningPhrase(record: CandidateRecord): string {
  if (isPast(record)) return 'Candidate for';
  const leg = record.legislator;
  return leg && leg.serviceStatus === 'current' && leg.isReelection
    ? 'Running for reelection as'
    : 'Running for';
}

/** The facts stamp: a past election names its results; otherwise the ballot record's check. */
export function sourceStamp(record: CandidateRecord): string {
  const checked = formatDay(record.source.checkedDate) ?? record.source.checkedDate ?? '';
  if (isPast(record) && record.result) {
    const resultChecked = formatDay(record.result.source?.checkedDate) ?? checked;
    return `Checked ${resultChecked} · ${electionYear(record)} ${record.election.type} election results`;
  }
  return `${record.source.retained ? 'Ballot record saved' : 'Checked'} ${checked}`;
}

/** The public site's service wording for the connected legislator record. */
function legislatorNote(leg: NonNullable<CandidateRecord['legislator']>): string | null {
  const seat = candidateSeat(leg.office, leg.votingArea);
  if (leg.serviceStatus === 'current') return seat ? `Serving as ${seat}` : null;
  if (leg.serviceStatus === 'former') return seat ? `Formerly served as ${seat}` : null;
  return 'Current service not confirmed';
}

function NotFound() {
  return (
    <section className="f-card lg2-gone">
      <h1 tabIndex={-1} className="lg2-gone-title">
        This record is no longer available
      </h1>
      <p>
        No candidate record with this reference is in the current copy. Open People to search the
        held records.
      </p>
    </section>
  );
}

/** Candidate profile (Candidate drawing): the held candidacy facts, campaign
 * money, the election and its result, and confirmed related records. The
 * campaign accounts are confirmed for this candidacy’s seat and election,
 * excluding the connected person’s other races. */
export function CandidateProfile({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const read = useRecordRead<CandidateRecord>(`candidates/${encodeURIComponent(match.params.id)}`);
  const record = read.data;
  const legislatorId = record?.legislator?.slug ?? null;
  const candidateId = record?.candidate.id ?? null;
  const years = useFinanceYears(legislatorId, candidateId);
  const accounts = accountsFrom(years.data);
  const year = record ? electionYear(record) : '';
  // Each seat fact once: the served office often repeats the district its voting
  // area also names ("State Representative District 56A", "House District 56A").
  const seat = record ? seatParts(record.office, record.votingArea) : [];
  const facts = record
    ? [
        {
          label: 'Election',
          value: [`${year} ${record.election.type}`, formatDay(record.election.date)]
            .filter(Boolean)
            .join(' · '),
        },
        { label: 'Office', value: seat[0] || record.office },
        { label: 'District', value: seat.slice(1).join(', ') || record.votingArea },
        { label: 'Party', value: record.candidate.party || 'Party not recorded' },
      ]
    : [];
  const sourceUrl = record?.result?.source?.url ?? record?.source.url ?? null;
  const leg = record?.legislator;
  const people = record?.people ?? [];
  const hasRelated =
    Boolean(leg && isBuilt('legislator')) || (people.length > 0 && isBuilt('person'));

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        {read.loading && <LoadingLine>Loading…</LoadingLine>}
        {read.failed && (
          <Refused onRetry={read.retry} retrying={read.pending}>
            We couldn’t load this record
          </Refused>
        )}
        {read.notFound && <NotFound />}
        {record && (
          <>
            <header className="lg2-header">
              <span className="pp-kind">CANDIDATE PROFILE</span>
              <h1 tabIndex={-1} className="f-page-title lg2-title">
                {record.candidate.name}
              </h1>
              {candidateId && (
                <KeyFigures
                  legislatorId={legislatorId}
                  candidateId={candidateId}
                  account={accounts[0] ?? null}
                />
              )}
              <p className="lg2-line">
                Official candidate record · {runningPhrase(record)} {seat[0] || record.office}
              </p>
            </header>
            <div className="lg2-layout">
              <div className="lg2-main">
                <section aria-labelledby="facts-heading" className="f-card cd-facts">
                  <h2 id="facts-heading" className="f-label">
                    HELD CANDIDACY FACTS
                  </h2>
                  <dl className="cd-fact-grid">
                    {facts.map((fact) => (
                      <div key={fact.label} className="cd-fact">
                        <dt>{fact.label}</dt>
                        <dd
                          className="f-num"
                          data-missing={fact.value === 'Party not recorded' || undefined}
                        >
                          {fact.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="cd-stamp f-num">
                    Candidate records from the Minnesota Secretary of State · {sourceStamp(record)}.
                    Party is as filed; Nonpartisan offices show Nonpartisan.
                  </p>
                </section>

                <CampaignFinance
                  legislatorId={legislatorId}
                  candidateId={candidateId}
                  years={years}
                  accounts={accounts}
                  from={here}
                />
                <MediaBuysCard
                  kind="candidate"
                  target={match.params.id}
                  name={record.candidate.name}
                />

                <section aria-labelledby="result-heading" className="lg2-section">
                  <h2 id="result-heading" className="f-section-title">
                    Election
                  </h2>
                  <div className="f-card cd-election">
                    <div className="lg2-strong">
                      {year} {record.election.type} election
                    </div>
                    <div className="lg2-muted f-num">
                      {[...seat, 'Minnesota Secretary of State'].join(' · ')}
                    </div>
                    <div className="cd-result-row">
                      <span
                        className="cd-result"
                        data-final={finalOutcome(record.result) ? true : undefined}
                      >
                        {resultLine(record.result)}
                      </span>
                      {sourceUrl && (
                        <a
                          href={sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="f-dest"
                        >
                          <WithArrow>Official source website</WithArrow>
                          <span className="f-visually-hidden"> (opens in a new tab)</span>
                        </a>
                      )}
                    </div>
                  </div>
                  <p className="lg2-note">
                    A candidacy or an election result does not prove current service. Service is a
                    separate record.
                  </p>
                </section>
              </div>
              <aside className="lg2-aside">
                <section className="f-card lg2-related">
                  <h2 className="f-card-title">Related records</h2>
                  {hasRelated ? (
                    <ul className="f-row-links">
                      {leg && isBuilt('legislator') && (
                        <li>
                          <Link
                            to={withFrom(hrefFor('legislator', { id: leg.slug }), here)}
                            className="f-row-link lg2-related-link"
                          >
                            <span>
                              <span className="f-row-link-name">View legislator profile</span>
                              {legislatorNote(leg) && (
                                <>
                                  <br />
                                  <span className="f-row-link-note">{legislatorNote(leg)}</span>
                                </>
                              )}
                            </span>
                            <Arrow />
                          </Link>
                        </li>
                      )}
                      {isBuilt('person') &&
                        people.map((person) => (
                          <li key={person.id}>
                            <Link
                              to={withFrom(hrefFor('person', { id: person.id }), here)}
                              className="f-row-link lg2-related-link"
                            >
                              <span>
                                <span className="f-row-link-name">View person profile</span>
                                {people.length > 1 && (
                                  <>
                                    <br />
                                    <span className="f-row-link-note">{person.name}</span>
                                  </>
                                )}
                              </span>
                              <Arrow />
                            </Link>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="lg2-muted">
                      No confirmed person or legislator record is connected to this candidacy
                    </p>
                  )}
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
