import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  COMMITTEE_PAGE_SIZE,
  committeeEmptyWhy,
  kindFilterNoun,
  type CommitteeKindFilter,
} from '@alethical/shared/committeeList';
import { committeeEyebrow, formatDay } from '@alethical/shared/committeeMoneyShared';
import { centralDateLabel, formatCount } from '@alethical/shared/moneyLanding';
import { paymentCopyLines } from '@alethical/shared/paymentCopyDates';

import { useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { ClearAll, Dropdown, Empty, LoadingRows, Refused, Tabs, Updating } from '../ui/controls';
import { RecordMark } from '../ui/marks';
import { Arrow, BackLink, SourcesAndUpdates, type SourceGroup } from '../ui/parts';
import './campaignMoney.css';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
/** The register endpoint refuses a longer name (q max_length 200). */
const MAX_QUERY = 200;

/** The 3 directory tabs, in the drawing's order, and the register kind each reads.
 * The register holds exactly these 3 kinds, so no finer tab exists (#1661). */
export type DirectoryTab = 'candidates' | 'committees' | 'party';

const TABS: ReadonlyArray<{ value: DirectoryTab; label: string; kind: CommitteeKindFilter }> = [
  { value: 'candidates', label: 'Candidate committees', kind: 'candidate_committee' },
  { value: 'committees', label: 'Committees and funds', kind: 'political_committee_or_fund' },
  { value: 'party', label: 'Party units', kind: 'party_unit' },
];

export function tabFromParam(raw: string): DirectoryTab {
  return TABS.find((tab) => tab.value === raw)?.value ?? 'candidates';
}

export function pageFromParam(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 1 ? parsed : 1;
}

/** One register row as `/campaign-finance/committees` serves it. */
export interface CommitteeRow {
  registration_number: string;
  name: string;
  kind: string | null;
  sub_type: string | null;
  office: string | null;
  district: string | null;
  is_closed: boolean | null;
  termination_date: string | null;
}

export interface CommitteeRegister {
  state: 'reported' | 'unavailable' | string;
  committees: CommitteeRow[];
  page: { limit: number; offset: number; has_more: boolean; total: number | null };
  register_total: number | null;
  by_kind: Partial<Record<string, number>> | null;
  as_of: string | null;
  reason: string | null;
}

interface MoneySummary {
  freshness?: {
    payment_copied_at?: {
      contributions?: string | null;
      expenditures?: string | null;
      independent_expenditures?: string | null;
    } | null;
    register_fetched_at?: string | null;
  } | null;
}

/** The register read for one view: the server pages and searches, never the browser. */
export function registerPath(
  tab: DirectoryTab,
  query: string,
  page: number,
  sort = 'name',
): string {
  const kind = TABS.find((item) => item.value === tab)?.kind ?? 'candidate_committee';
  const params = new URLSearchParams({
    kind,
    limit: String(COMMITTEE_PAGE_SIZE),
    offset: String((page - 1) * COMMITTEE_PAGE_SIZE),
  });
  if (query) params.set('q', query);
  if (sort === 'registration') params.set('sort', sort);
  return `campaign-finance/committees?${params.toString()}`;
}

/** "762 candidate committees": the served count for this tab and search. */
export function countLine(tab: DirectoryTab, total: number | null): string | null {
  if (total === null || total === undefined) return null;
  const kind = TABS.find((item) => item.value === tab)?.kind ?? 'candidate_committee';
  return `${formatCount(total)} ${kindFilterNoun(kind, total)}`;
}

export function pageCount(total: number | null): number {
  return Math.max(1, Math.ceil((total ?? 0) / COMMITTEE_PAGE_SIZE));
}

/**
 * The bottom section's lines: the register's copy date, then the payment files'
 * and report totals' dates in the shared wording. The register and report totals
 * are copied together (the public money page's "Committee register and report totals last
 * copied"); a date the server did not serve is left out, never borrowed.
 */
export function sourceGroups(
  register: CommitteeRegister | null,
  summary: MoneySummary | null,
): SourceGroup[] {
  const fetched = summary?.freshness?.register_fetched_at;
  const registerDay = fetched ? centralDateLabel(fetched) : formatDay(register?.as_of ?? null);
  const items: string[] = [];
  if (registerDay) items.push(`Register copied ${registerDay}`);
  const copied = summary?.freshness?.payment_copied_at;
  if (copied) {
    items.push(
      ...paymentCopyLines(
        {
          contributions: copied.contributions ?? null,
          expenditures: copied.expenditures ?? null,
          independentExpenditures: copied.independent_expenditures ?? null,
        },
        registerDay,
      ),
    );
  }
  return items.length > 0 ? [{ source: BOARD, items }] : [];
}

/** The side cards whose pages exist. Payments under a name and Money by race
 * open only with a name or a contest, so neither has a plain entrance here. */
const SIDE_CARDS = [
  {
    route: 'recipients' as const,
    title: 'Vendors and payees',
    body: 'Find recipients named in payment records',
  },
];

const LIMITS = [
  'Campaign payment records before 2015 are not included',
  'These records cover campaign finances, not the wider finances of organizations with political committees or funds',
  'Some donations are reported together without donor names as non-itemized contributions. This is allowed when a donor gives $200 or less to the same committee, party unit or fund in a calendar year. For ballot-question committees and funds, the limit is $500',
];

/**
 * Campaign money (Campaign Money drawing): the committee register in 3 tabs,
 * a name search over registered names kept apart from payments under a name,
 * paged on the server, with the limits of the records beside it.
 */
export function CampaignMoney(_props: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const [address, setAddress] = useAddressState({
    tab: 'candidates',
    q: '',
    page: '1',
    sort: 'name',
  });
  const tab = tabFromParam(address.tab);
  const submitted = address.q.trim().slice(0, MAX_QUERY);
  const page = pageFromParam(address.page);

  const [typed, setTyped] = useState(submitted);
  // Back, Forward or a new link changes the address: the field follows it.
  useEffect(() => setTyped(submitted), [submitted]);

  const read = useRead<CommitteeRegister>(registerPath(tab, submitted, page, address.sort), {
    keepPrevious: true,
  });
  const summary = useRead<MoneySummary>('campaign-finance/summary');
  const register = read.data;
  const unavailable = register !== null && register.state !== 'reported';
  const rows = register && !unavailable ? register.committees : [];
  const total = register && !unavailable ? (register.page.total ?? null) : null;
  const pages = pageCount(total);

  // A page past the end (a stale link, or a search that now matches fewer)
  // opens the last page that exists rather than an empty list.
  useEffect(() => {
    const own = register?.page.offset === (page - 1) * COMMITTEE_PAGE_SIZE;
    if (own && !read.updating && !read.failed && total !== null && page > pages) {
      setAddress({ page: String(pages) });
    }
  }, [register, read.updating, read.failed, total, page, pages, setAddress]);

  const list = useRef<HTMLDivElement>(null);
  function goPage(next: number) {
    setAddress({ page: String(next) });
    const element = list.current;
    if (!element) return;
    const top = element.getBoundingClientRect().top + window.scrollY - 20;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    element.focus({ preventScroll: true });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddress({ q: typed.trim().slice(0, MAX_QUERY), page: '1' });
  }

  const byKind = register?.by_kind ?? null;
  const tabs = TABS.map((item) => {
    const count = byKind?.[item.kind];
    return {
      value: item.value,
      label: item.label,
      count: typeof count === 'number' ? formatCount(count) : null,
    };
  });
  const tabLabel = TABS.find((item) => item.value === tab)?.label ?? '';

  const freshFailure = (read.failed && register === null) || (unavailable && !read.updating);
  const retainedFailure = read.failed && register !== null && !unavailable;
  const showList = register !== null && !unavailable;
  const count = countLine(tab, total);
  const groups = sourceGroups(unavailable ? null : register, summary.data);
  const cards = SIDE_CARDS.filter((card) => isBuilt(card.route));

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && (
          <div className="cm-back">
            <BackLink to={back.to} name={back.name} />
          </div>
        )}
        <header className="cm-header">
          <div className="cm-intro">
            <h1 tabIndex={-1} className="f-page-title">
              Campaign money
            </h1>
            <p className="cm-dek">
              Candidate committees, committees and funds, and party units registered in Minnesota,
              with their official report figures and itemized payments.
            </p>
          </div>
          {isBuilt('money-connections') && (
            <Link
              to={withFrom(hrefFor('money-connections'), here)}
              className="f-btn f-action cm-connections"
            >
              <span>Explore money connections</span>
              <Arrow stroke="#FFFFFF" />
            </Link>
          )}
        </header>

        <form role="search" onSubmit={submit} className="cm-search">
          <label htmlFor="money-name" className="f-visually-hidden">
            Search by name
          </label>
          <input
            id="money-name"
            type="search"
            className="f-field cm-field"
            value={typed}
            maxLength={MAX_QUERY}
            autoComplete="off"
            placeholder="Search by name"
            onChange={(event) => setTyped(event.target.value)}
          />
          <button type="submit" className="f-btn cm-submit">
            Search
          </button>
        </form>

        {submitted && (
          <section aria-label="Name search" className="cm-name-search">
            {isBuilt('payments-under-name') ? (
              <>
                <p>
                  Registered names matching “{submitted}” are listed below. Payments recorded under
                  that spelling are a separate search:
                </p>
                <Link
                  to={withFrom(hrefFor('payments-under-name', { query: submitted }), here)}
                  className="cm-card cm-payments"
                >
                  <span className="cm-payments-text">
                    <span className="cm-card-title">Payments under a name</span>
                    <span className="cm-payments-note">
                      Every campaign and outside-spending payment printed under “{submitted}”,
                      grouped by exact spelling
                    </span>
                  </span>
                  <Arrow />
                </Link>
              </>
            ) : (
              <p>Registered names matching “{submitted}” are listed below.</p>
            )}
          </section>
        )}

        <div className="cm-layout">
          <section aria-label={tabLabel} className="cm-directory">
            <div className="cm-tabs">
              <Tabs
                label="Directory"
                value={tab}
                tabs={tabs}
                onChange={(next) => setAddress({ tab: next, page: '1' })}
              />
            </div>

            <div className="mb-filters">
              <Dropdown
                name="Sort by"
                value={address.sort === 'registration' ? 'registration' : 'name'}
                options={[
                  { value: 'name', label: 'Name A–Z' },
                  { value: 'registration', label: 'Registration' },
                ]}
                onChange={(sort) => setAddress({ sort, page: '1' })}
              />
              {address.sort === 'registration' && (
                <ClearAll onClick={() => setAddress({ sort: 'name', page: '1' })} />
              )}
            </div>
            <div ref={list} tabIndex={-1} className="cm-list">
              {read.loading && <LoadingRows />}
              {freshFailure && (
                <Refused onRetry={read.retry} retrying={read.pending}>
                  We couldn’t load these results. This is a problem on our side and says nothing
                  about who is registered.
                </Refused>
              )}
              {showList && (
                <>
                  {read.updating && (
                    <div className="cm-notice">
                      <Updating />
                    </div>
                  )}
                  {retainedFailure && (
                    <div className="cm-notice">
                      <Refused onRetry={read.retry} retrying={read.pending}>
                        We couldn’t update these results. Previous results are shown.
                      </Refused>
                    </div>
                  )}
                  <div aria-live="polite" className="cm-count f-num">
                    {count}
                  </div>
                  {rows.length === 0 ? (
                    <Empty title="No matching records" next={committeeEmptyWhy('all', submitted)} />
                  ) : (
                    <>
                      <div role="table" aria-label="Directory" className="cm-table">
                        <div role="row" className="cm-row cm-head">
                          <span role="columnheader">NAME</span>
                          <span role="columnheader">TYPE</span>
                          <span role="columnheader" className="cm-reg">
                            REGISTRATION
                          </span>
                        </div>
                        {rows.map((row) => (
                          <div role="row" key={row.registration_number} className="cm-row">
                            <span role="cell" className="cm-name f-marked">
                              <RecordMark kind="committee" />
                              {isBuilt('committee') ? (
                                <Link
                                  to={withFrom(
                                    hrefFor('committee', { id: row.registration_number }),
                                    here,
                                  )}
                                  className="cm-name-link"
                                >
                                  {row.name}
                                </Link>
                              ) : (
                                <span>{row.name}</span>
                              )}
                            </span>
                            <span role="cell" className="cm-kind">
                              {committeeEyebrow(row.kind, row.sub_type) ?? ''}
                            </span>
                            <span role="cell" className="cm-reg f-num">
                              <span className="cm-reg-word">Registration </span>
                              {row.registration_number}
                            </span>
                          </div>
                        ))}
                      </div>
                      <nav aria-label="Pages" className="cm-pager">
                        <button
                          type="button"
                          className="f-btn f-btn-secondary cm-page-btn"
                          aria-disabled={page <= 1 || undefined}
                          onClick={() => page > 1 && goPage(page - 1)}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M15 5 L8 12 L15 19"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          Previous
                        </button>
                        <span aria-live="polite" className="cm-page-line f-num">
                          Page {formatCount(Math.min(page, pages))} of {formatCount(pages)}
                        </span>
                        <button
                          type="button"
                          className="f-btn f-btn-secondary cm-page-btn"
                          aria-disabled={page >= pages || undefined}
                          onClick={() => page < pages && goPage(page + 1)}
                        >
                          Next
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M9 5 L16 12 L9 19"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </nav>
                    </>
                  )}
                </>
              )}
            </div>
          </section>

          <aside aria-label="Other ways in" className="cm-aside">
            {cards.map((card) => (
              <Link
                key={card.route}
                to={withFrom(hrefFor(card.route), here)}
                className="cm-card cm-side-card"
              >
                <span className="cm-side-head">
                  <span className="cm-card-title">{card.title}</span>
                  <Arrow />
                </span>
                <span className="cm-side-body">{card.body}</span>
              </Link>
            ))}
            <section aria-labelledby="cm-limits" className="cm-card cm-limits">
              <h2 id="cm-limits" className="f-label">
                Limits of the campaign records
              </h2>
              <ul>
                {LIMITS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </div>
      <SourcesAndUpdates groups={groups} />
    </main>
  );
}
