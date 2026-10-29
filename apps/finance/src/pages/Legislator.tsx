import { useRef } from 'react';

import { statusLabel } from '@alethical/shared/billStatus';
import {
  currentChamber,
  legislativeServiceFromHistory,
  legislatorDistrictLine,
  servesNow,
  type LegislatorServiceHistorySource,
} from '@alethical/shared/legislatorProfile';
import { formatDay } from '@alethical/shared/moneyFormat';
import { centralDateLabel } from '@alethical/shared/moneyLanding';
import { formatLegislativeYearRange } from '@alethical/shared/sessionLabel';

import { apiPath, useRead } from '../api/read';
import { copyDate, type ServedCounts } from '../landing/counts';
import {
  CampaignFinance,
  KeyFigures,
  accountsFrom,
  useFinanceYears,
} from '../parts/CampaignFinance';
import { useRecordRead } from '../parts/recordRead';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { LoadingRows, Refused } from '../ui/controls';
import {
  Arrow,
  BackLink,
  LoadingLine,
  SourcesAndUpdates,
  WithArrow,
  type SourceGroup,
} from '../ui/parts';
import './people.css';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
const LEGISLATURE = 'Minnesota Legislature';
const BILLS_PER_PAGE = 20;

interface CurrentService {
  chamber?: string | null;
  party?: string | null;
  district?: { code?: string | null; label?: string | null } | null;
  profile_url?: string | null;
}

export interface LegislatorRecord {
  id: string;
  slug: string;
  full_name: string;
  current_service?: CurrentService | null;
  committees?: Array<{ name: string; role?: string | null }>;
  service_history?: LegislatorServiceHistorySource | null;
  campaign_committees?: Array<{ registration_number: string; committee_name: string }>;
  stats?: { chief_bill_count?: number } | null;
}

interface LegislativeCommittee {
  id: string;
  name: string;
  chamber: string | null;
  session: string | null;
}

interface BillRow {
  id: string;
  file_type: string;
  file_number: number;
  title?: string | null;
  current_status?: string | null;
  status_key?: string | null;
  latest_action_at?: string | null;
  ai_analysis?: { short_title?: string | null } | null;
}

interface Session {
  slug: string;
  is_current: boolean;
  year_start: number;
  year_end: number;
}

interface PersonRecord {
  elections?: Array<{
    candidateId: string;
    office?: string | null;
    votingArea?: string | null;
    election?: { label?: string | null; date?: string | null } | null;
  }>;
}

/** "State Representative" / "State Senator", the drawing's titles for a seat. */
export function seatTitle(chamber: 'House' | 'Senate' | ''): string {
  return chamber === 'House' ? 'State Representative' : chamber === 'Senate' ? 'State Senator' : '';
}

/**
 * The header's service line. Only a current service record may make a current
 * claim (title, district, party); a former legislator inherits none of them.
 */
export function serviceLine(record: LegislatorRecord): string | null {
  const chamber = currentChamber(record.current_service?.chamber);
  if (!servesNow(chamber)) return null;
  const district = legislatorDistrictLine(chamber, record.current_service?.district?.code);
  const party = record.current_service?.party;
  return [`Currently serving as ${seatTitle(chamber)}`, district, party]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A legislative committee's own record id, matched on its exact name in the
 * legislator's own chamber among the sitting Legislature's committees. Two
 * matches (one name held in 2 sessions) prefer the regular session; anything
 * still ambiguous links nowhere rather than to a guess.
 */
export function committeeIdFor(
  name: string,
  chamber: 'House' | 'Senate' | '',
  committees: LegislativeCommittee[],
): string | null {
  const word = chamber === 'House' ? 'House' : chamber === 'Senate' ? 'Senate' : null;
  if (!word) return null;
  const matches = committees.filter(
    (item) => item.name === name && (item.chamber ?? '').includes(word),
  );
  if (matches.length === 1) return matches[0].id;
  const regular = matches.filter((item) => (item.session ?? '').endsWith('-regular'));
  return regular.length === 1 ? regular[0].id : null;
}

export function billNumber(row: BillRow): string {
  return `${row.file_type} ${row.file_number}`;
}

function NotFound() {
  return (
    <section className="f-card lg2-gone">
      <h1 tabIndex={-1} className="lg2-gone-title">
        This record is no longer available
      </h1>
      <p>
        No legislator record with this reference is in the current copy. Open People to search the
        held records.
      </p>
    </section>
  );
}

function Committees({ record, from }: { record: LegislatorRecord; from: string }) {
  const chamber = currentChamber(record.current_service?.chamber);
  const current = servesNow(chamber);
  const list = useRead<LegislativeCommittee[]>(
    current && isBuilt('committee-members') ? 'finance/legislative-committees' : null,
  );
  const committees = record.committees ?? [];
  return (
    <section aria-labelledby="committees-heading" className="lg2-section">
      <h2 id="committees-heading" className="f-section-title">
        Committees
      </h2>
      {!current ? (
        <div className="f-empty-box">Committee assignments are held for current service only</div>
      ) : (
        committees.length > 0 && (
          <ul className="lg2-list">
            {committees.map((committee) => {
              const id = list.data ? committeeIdFor(committee.name, chamber, list.data) : null;
              return (
                <li key={committee.name} className="lg2-committee">
                  <span className="lg2-committee-text">
                    <span className="lg2-strong">{committee.name}</span>
                    <span className="lg2-muted">{committee.role || 'Member'}</span>
                  </span>
                  {id && (
                    <Link
                      to={withFrom(hrefFor('committee-members', { id }), from)}
                      aria-label={`Members’ campaign accounts, ${committee.name}`}
                      className="f-dest lg2-committee-link"
                    >
                      <WithArrow>Members’ campaign accounts</WithArrow>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}
    </section>
  );
}

function Bills({ record, from }: { record: LegislatorRecord; from: string }) {
  const [address, setAddress] = useAddressState({ bills: '1' });
  const sessions = useRead<Session[]>('sessions');
  const current = sessions.data?.find((item) => item.is_current) ?? null;
  const total = record.stats?.chief_bill_count ?? null;
  const pages = total ? Math.max(1, Math.ceil(total / BILLS_PER_PAGE)) : 1;
  const page = Math.min(Math.max(1, Number(address.bills) || 1), pages);
  const read = useRead<BillRow[]>(
    apiPath(['legislators', record.slug, 'bills'], {
      role: 'chief_author',
      limit: BILLS_PER_PAGE,
      offset: (page - 1) * BILLS_PER_PAGE,
    }),
    { keepPrevious: true },
  );
  const list = useRef<HTMLDivElement>(null);
  const go = (next: number) => {
    setAddress({ bills: String(next) });
    window.setTimeout(() => {
      list.current?.scrollIntoView?.({ block: 'start' });
      list.current?.querySelector<HTMLAnchorElement>('li a')?.focus({ preventScroll: true });
    }, 0);
  };
  const rows = read.data ?? [];
  return (
    <section aria-labelledby="bills-heading" className="lg2-section">
      <div className="lg2-bills-head">
        <h2 id="bills-heading" className="f-section-title">
          Chief-authored bills
        </h2>
        {current && (
          <span className="lg2-muted">
            {formatLegislativeYearRange(current.year_start, current.year_end)} session
          </span>
        )}
      </div>
      <div ref={list}>
        {read.loading && <LoadingRows />}
        {read.failed && !read.data && (
          <Refused onRetry={read.retry} retrying={read.pending}>
            We couldn’t load these bills. This is a problem on our side.
          </Refused>
        )}
        {read.data && !read.loading && rows.length === 0 && !read.updating && (
          <div className="f-empty-box">No chief-authored bills are held for this service</div>
        )}
        {rows.length > 0 && (
          <>
            {read.failed && (
              <Refused onRetry={read.retry} retrying={read.pending}>
                We couldn’t load these bills. This is a problem on our side.
              </Refused>
            )}
            <ul className="lg2-list">
              {rows.map((bill) => {
                const date = formatDay(bill.latest_action_at);
                const href = isBuilt('bill')
                  ? withFrom(hrefFor('bill', { id: bill.id }), from)
                  : null;
                const body = (
                  <>
                    <span className="f-code">{billNumber(bill)}</span>
                    <span className="lg2-bill-text">
                      <span className="lg2-bill-title">
                        {bill.ai_analysis?.short_title || billNumber(bill)}
                      </span>
                      <span className="lg2-muted f-num">
                        {[statusLabel(bill.status_key, bill.current_status), date]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {href && <Arrow />}
                  </>
                );
                return (
                  <li key={bill.id}>
                    {href ? (
                      <Link to={href} className="lg2-bill">
                        {body}
                      </Link>
                    ) : (
                      <div className="lg2-bill">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            {pages > 1 && (
              <nav aria-label="Pages" className="pp-pages">
                <button
                  type="button"
                  className="f-btn f-btn-secondary pp-page-btn"
                  aria-disabled={page <= 1 || undefined}
                  onClick={() => page > 1 && go(page - 1)}
                >
                  Previous
                </button>
                <span aria-live="polite" className="pp-page-line f-num">
                  Page {page} of {pages}
                </span>
                <button
                  type="button"
                  className="f-btn f-btn-secondary pp-page-btn"
                  aria-disabled={page >= pages || undefined}
                  onClick={() => page < pages && go(page + 1)}
                >
                  Next
                </button>
              </nav>
            )}
            <p className="lg2-note">
              Minnesota bills name a chief author and co-authors. Co-authored bills are listed on
              each bill’s page.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function Related({ record, from }: { record: LegislatorRecord; from: string }) {
  const person = useRecordRead<{ id: string; name: string }>(
    `people/for-legislator/${encodeURIComponent(record.slug)}`,
  );
  const detail = useRecordRead<PersonRecord>(
    person.data ? `people/${encodeURIComponent(person.data.id)}` : null,
  );
  const official = servesNow(currentChamber(record.current_service?.chamber))
    ? record.current_service?.profile_url
    : null;
  const candidacies = isBuilt('candidate') ? (detail.data?.elections ?? []) : [];
  const connectedPerson = person.data;
  // Nothing held to relate: no card rather than an empty one.
  if (!connectedPerson && candidacies.length === 0 && !official) return null;
  return (
    <section className="f-card lg2-related">
      <h2 className="f-card-title">Related records</h2>
      <ul className="lg2-related-list">
        {connectedPerson && (
          <li>
            <Link
              to={withFrom(hrefFor('person', { id: connectedPerson.id }), from)}
              className="lg2-related-link"
            >
              <span>
                <span className="lg2-related-label">View person profile</span>
                <span className="lg2-related-note">{connectedPerson.name}</span>
              </span>
              <Arrow />
            </Link>
          </li>
        )}
        {candidacies.map((item) => (
          <li key={item.candidateId}>
            <Link
              to={withFrom(hrefFor('candidate', { id: item.candidateId }), from)}
              className="lg2-related-link"
            >
              <span>
                <span className="lg2-related-label">View candidate profile</span>
                <span className="lg2-related-note">
                  {[item.election?.label, [item.office, item.votingArea].filter(Boolean).join(', ')]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <Arrow />
            </Link>
          </li>
        ))}
        {official && (
          <li>
            <a
              href={official}
              target="_blank"
              rel="noopener noreferrer"
              className="lg2-related-link"
            >
              <span>
                Official source website
                <span className="f-visually-hidden"> (opens in a new tab)</span>
              </span>
              <Arrow />
            </a>
          </li>
        )}
      </ul>
    </section>
  );
}

/** Legislator profile (Legislator drawing): service, committees, chief-authored
 * bills and campaign money for 1 service record. */
export function LegislatorProfile({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const id = match.params.id;
  const read = useRead<LegislatorRecord>(
    `legislators/${encodeURIComponent(id)}?include=current_service,committees,service_history,campaign_committees,stats`,
  );
  const record = read.data;
  const years = useFinanceYears(record ? record.slug : null);
  const accounts = accountsFrom(years.data, record?.campaign_committees ?? []);
  const counts = useRead<ServedCounts>('finance/landing/counts');

  const groups: SourceGroup[] = [];
  const billsDate = counts.data ? copyDate(counts.data, 'current_legislature_bills') : null;
  groups.push({
    source: LEGISLATURE,
    items: [billsDate ? `Bills updated ${billsDate}` : 'Bills'],
  });
  const copied = years.data?.payment_copied_at?.contributions;
  if (accounts.length > 0 && copied) {
    groups.push({ source: BOARD, items: [`Payment files copied ${centralDateLabel(copied)}`] });
  }

  const chamber = record ? currentChamber(record.current_service?.chamber) : '';
  const current = servesNow(chamber);
  const history = record ? legislativeServiceFromHistory(record.service_history) : null;
  const line = record ? serviceLine(record) : null;

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
              <span className="pp-kind">LEGISLATOR PROFILE</span>
              <h1 tabIndex={-1} className="f-page-title lg2-title">
                {record.full_name}
              </h1>
              {line && <p className="lg2-line f-num">{line}</p>}
              <KeyFigures legislatorId={record.slug} account={accounts[0] ?? null} />
            </header>
            <div className="lg2-layout">
              <div className="lg2-main">
                <CampaignFinance
                  legislatorId={record.slug}
                  years={years}
                  accounts={accounts}
                  emptyLine="No campaign committee is confirmed for this service record"
                  from={here}
                />
                {(current || (history && history.lines.length > 0)) && (
                  <section aria-labelledby="service-heading" className="lg2-section">
                    <h2 id="service-heading" className="f-section-title">
                      Legislative service
                    </h2>
                    <ul className="lg2-list">
                      {current && (
                        <li className="lg2-service">
                          <span className="lg2-service-dates">Current</span>
                          <span>
                            <span className="lg2-strong">
                              {[
                                seatTitle(chamber),
                                legislatorDistrictLine(
                                  chamber,
                                  record.current_service?.district?.code,
                                ),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                            {record.current_service?.party && (
                              <span className="lg2-muted">
                                Party as recorded: {record.current_service.party}
                              </span>
                            )}
                          </span>
                        </li>
                      )}
                      {history?.lines.map((item) => (
                        <li key={item.chamber} className="lg2-service">
                          <span className="lg2-service-dates f-num">{item.elected}</span>
                          <span className="lg2-strong">{item.label}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <Committees record={record} from={here} />
                <Bills record={record} from={here} />
              </div>
              <aside className="lg2-aside">
                <Related record={record} from={here} />
              </aside>
            </div>
          </>
        )}
      </div>
      {record && <SourcesAndUpdates groups={groups} />}
    </main>
  );
}
