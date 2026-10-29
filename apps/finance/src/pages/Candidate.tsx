import { formatDay } from '@alethical/shared/moneyFormat';

import { CampaignFinance } from '../parts/CampaignFinance';
import { useRecordRead } from '../parts/recordRead';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { Refused } from '../ui/controls';
import { Arrow, BackLink, LoadingLine, WithArrow } from '../ui/parts';
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
const RESULT_LABELS: Record<ElectionResult['status'], string> = {
  certified: 'Election results',
  unofficial: 'Unofficial election results',
  pending: 'Election results pending',
  recount: 'Election recount in progress',
  tie: 'Election tie unresolved',
  unavailable: 'Election results unavailable',
};

const OUTCOME_LABELS = { elected: 'Elected', 'not-elected': 'Not elected', withdrew: 'Withdrew' };

/** A vote outcome is stated only once certified; a withdrawal is sourced on its own. */
function finalOutcome(result?: ElectionResult) {
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
  const seat = [leg.office, leg.votingArea].filter(Boolean).join(', ');
  if (leg.serviceStatus === 'current') return seat ? `Currently serving as ${seat}` : null;
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
 * money, the election and its result, and confirmed related records. */
export function CandidateProfile({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const read = useRecordRead<CandidateRecord>(`candidates/${encodeURIComponent(match.params.id)}`);
  const record = read.data;
  const year = record ? electionYear(record) : '';
  const facts = record
    ? [
        {
          label: 'Election',
          value: [`${year} ${record.election.type}`, formatDay(record.election.date)]
            .filter(Boolean)
            .join(' · '),
        },
        { label: 'Office', value: record.office },
        { label: 'District', value: record.votingArea },
        { label: 'Party', value: record.candidate.party || 'Party not recorded' },
      ]
    : [];
  const sourceUrl = record?.result?.source?.url ?? record?.source.url ?? null;
  const leg = record?.legislator;
  const people = record?.people ?? [];
  const hasRelated = Boolean(leg) || people.length > 0;

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        {read.loading && <LoadingLine>Loading…</LoadingLine>}
        {read.failed && (
          <Refused onRetry={read.retry} retrying={read.pending}>
            We couldn’t load this record. This is a problem on our side.
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
              <p className="lg2-line">
                Official candidate record · {runningPhrase(record)} {record.office}
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

                <CampaignFinance accounts={[]} from={here} />

                <section aria-labelledby="result-heading" className="lg2-section">
                  <h2 id="result-heading" className="f-section-title">
                    Election
                  </h2>
                  <div className="f-card cd-election">
                    <div className="lg2-strong">
                      {year} {record.election.type} election
                    </div>
                    <div className="lg2-muted f-num">
                      {record.office} · {record.votingArea} · Minnesota Secretary of State
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
                    <ul className="lg2-related-list">
                      {leg && isBuilt('legislator') && (
                        <li>
                          <Link
                            to={withFrom(hrefFor('legislator', { id: leg.slug }), here)}
                            className="lg2-related-link"
                          >
                            <span>
                              <span className="lg2-related-label">View legislator profile</span>
                              {legislatorNote(leg) && (
                                <span className="lg2-related-note">{legislatorNote(leg)}</span>
                              )}
                            </span>
                            <Arrow />
                          </Link>
                        </li>
                      )}
                      {people.map((person) => (
                        <li key={person.id}>
                          <Link
                            to={withFrom(hrefFor('person', { id: person.id }), here)}
                            className="lg2-related-link"
                          >
                            <span>
                              <span className="lg2-related-label">View person profile</span>
                              <span className="lg2-related-note">{person.name}</span>
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
