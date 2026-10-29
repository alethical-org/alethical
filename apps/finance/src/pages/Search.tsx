import { useEffect, useRef, useState, type FormEvent } from 'react';

import { registerKindLabel } from '@alethical/shared/committeeMoneyShared';
import { formatCount } from '@alethical/shared/moneyLanding';
import { tooShortTitle } from '@alethical/shared/moneyNameSearch';

import { useRead, type Read } from '../api/read';
import { Link, navigate, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch, type RouteName } from '../routes';
import { billSession } from '../search/suggestions';
import { LoadingRows, Updating } from '../ui/controls';
import { RecordMark, type RecordKind } from '../ui/marks';
import { BackLink } from '../ui/parts';
import './search.css';

/**
 * Search results (Finance Search drawing): the record families of the suggestion
 * panel, uncapped, each loading and failing on its own.
 *
 * 2 reads, so the families do not share 1 failure: the shared API's money search
 * (`/campaign-finance/search`), whose 7 groups each carry their own state, for
 * People, Organizations, Committees and Payments under a name; and its bill search
 * (`/search?types=bills`) for Bills. Finance's `/finance/suggestions` joins both
 * into 1 request and caps each group at 10, so 1 failure would blank every family.
 */

/** The money search's own ceiling per group, and the bill search's. */
export const MONEY_LIMIT = 50;
export const BILL_LIMIT = 20;
/** The money search's own floor (its served `min_query_length`): a trigram index
 * holds no whole trigram for a shorter query. Bills use the same floor, as the
 * suggestion endpoint does, so every family answers the same query. */
export const MIN_QUERY_LENGTH = 3;
/** Rows a family shows before View all. */
const FOLDED = 3;

export type FamilyId = 'people' | 'orgs' | 'committees' | 'bills' | 'printed';

const TITLES: Record<FamilyId, string> = {
  people: 'People',
  orgs: 'Organizations',
  committees: 'Committees',
  bills: 'Bills',
  printed: 'Payments under a name',
};
const ORDER: FamilyId[] = ['people', 'orgs', 'committees', 'bills', 'printed'];
const MARKS: Partial<Record<FamilyId, RecordKind>> = {
  people: 'person',
  orgs: 'organization',
  committees: 'committee',
  printed: 'printed',
};
const PRINTED_NOTE = 'A printed name is not a confirmed person or business';

export interface MoneyResult {
  kind: string;
  id?: string;
  full_name?: string;
  chamber?: string | null;
  district_code?: string | null;
  name?: string;
  role?: string;
  registration_number?: string | number | null;
  entity_id?: string | number | null;
  filer_kind?: string | null;
}

export interface MoneyGroup {
  kind: string;
  state: string;
  results: MoneyResult[];
  total: number | null;
  at_least: number | null;
  has_more: boolean;
  reason: string | null;
}

export interface MoneySearch {
  state: string;
  q: string;
  min_query_length: number | null;
  groups: MoneyGroup[];
}

export interface BillRow {
  id: string;
  file_type?: string | null;
  file_number?: number | null;
  ai_analysis?: { short_title?: string | null } | null;
}

export interface Row {
  key: string;
  name: string;
  note: string;
  /** Null when the record's page is not built yet: the row is plain text. */
  href: string | null;
  code?: string;
}

/** A family's count: exact, or a proven floor. Never a capped number as a total. */
export interface Count {
  value: number;
  exact: boolean;
}

export type FamilyState =
  | { state: 'rows'; rows: Row[]; count: Count }
  | { state: 'empty' }
  | { state: 'failed' }
  | { state: 'too-short'; floor: number | null };

function seat(chamber: string | null | undefined, district: string | null | undefined): string {
  const name = chamber === 'house' ? 'House' : chamber === 'senate' ? 'Senate' : null;
  if (name && district) return `${name} District ${district}`;
  return name ?? (district ? `District ${district}` : '');
}

function join(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' · ');
}

function linked(
  route: RouteName,
  params: Record<string, string>,
  query: Record<string, string> = {},
): string | null {
  return isBuilt(route) ? hrefFor(route, params, query) : null;
}

/** A group's own count: its exact total, or how far the server counted. */
function groupCount(group: MoneyGroup | undefined): Count {
  if (!group) return { value: 0, exact: true };
  if (group.total !== null) return { value: group.total, exact: true };
  return { value: group.at_least ?? group.results.length, exact: false };
}

function sum(...counts: Count[]): Count {
  return {
    value: counts.reduce((total, count) => total + count.value, 0),
    exact: counts.every((count) => count.exact),
  };
}

/** "12", or "At least 50" when the count is a floor. */
export function countLabel(count: Count): string {
  return count.exact ? formatCount(count.value) : `At least ${formatCount(count.value)}`;
}

const PAYEE_GROUPS = ['got_paid', 'got_paid_independent'];

/**
 * The money search's groups as the drawing's 4 money families. A family whose
 * records could not be searched fails on its own; a query under the index's floor
 * says so rather than claiming nothing matched.
 */
export function moneyFamilies(
  answer: MoneySearch,
): Record<Exclude<FamilyId, 'bills'>, FamilyState> {
  const group = (kind: string) => answer.groups.find((item) => item.kind === kind);
  const tooShort = answer.groups.some((item) => item.reason === 'query_too_short');
  const family = (kinds: string[], rows: Row[], count: Count): FamilyState => {
    if (tooShort) return { state: 'too-short', floor: answer.min_query_length };
    if (kinds.some((kind) => group(kind)?.state === 'unavailable' || !group(kind))) {
      return { state: 'failed' };
    }
    return rows.length === 0 ? { state: 'empty' } : { state: 'rows', rows, count };
  };

  const people: Row[] = [];
  for (const result of [
    ...(group('people')?.results ?? []),
    ...(group('lobbyists')?.results ?? []),
  ]) {
    const reg = result.registration_number != null ? String(result.registration_number) : null;
    if (result.kind === 'person' && result.id) {
      people.push({
        key: `person-${result.id}`,
        name: result.full_name ?? '',
        note: join('Legislator', seat(result.chamber, result.district_code)),
        href: linked('legislator', { id: result.id }),
      });
    } else if (result.kind === 'lobbyist' && reg) {
      people.push({
        key: `lobbyist-${reg}`,
        name: result.name ?? '',
        note: `Lobbyist · Registration ${reg}`,
        href: linked('lobbyist', { id: reg }),
      });
    }
  }

  const orgs: Row[] = [];
  for (const result of group('principals')?.results ?? []) {
    const reg = result.registration_number != null ? String(result.registration_number) : null;
    orgs.push({
      key: `principal-${result.entity_id ?? reg ?? result.name}`,
      name: result.name ?? '',
      note: join('Principal', reg && `Registration ${reg}`),
      href: result.entity_id != null ? linked('principal', { id: String(result.entity_id) }) : null,
    });
  }

  const committees: Row[] = [];
  for (const result of group('committees')?.results ?? []) {
    const reg = result.registration_number != null ? String(result.registration_number) : null;
    if (!reg) continue;
    committees.push({
      key: `committee-${reg}`,
      name: result.name ?? '',
      note: join(registerKindLabel(result.filer_kind), `Registration ${reg}`),
      href: linked('committee', { id: reg }),
    });
  }

  // 1 printed spelling is 1 row per role. The 2 payee files overlap, so a name
  // in both is listed once and their counts are never added.
  const printed: Row[] = [];
  const seen = new Set<string>();
  for (const kind of ['gave', ...PAYEE_GROUPS]) {
    for (const result of group(kind)?.results ?? []) {
      if (!result.name) continue;
      const role = kind === 'gave' ? 'donor' : 'payee';
      const key = `${role}|${result.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      printed.push({
        key,
        name: result.name,
        note: role === 'donor' ? 'Printed donor name' : 'Printed payee name',
        href: linked('payments-under-name', { query: result.name }, { role }),
      });
    }
  }
  const payees = PAYEE_GROUPS.map(group);
  const payeesComplete = payees.every((item) => item && !item.has_more && item.total !== null);
  const payeeCount: Count = payeesComplete
    ? { value: printed.filter((row) => row.key.startsWith('payee|')).length, exact: true }
    : {
        value: Math.max(...payees.map((item) => groupCount(item).value)),
        exact: false,
      };

  return {
    people: family(
      ['people', 'lobbyists'],
      people,
      sum(groupCount(group('people')), groupCount(group('lobbyists'))),
    ),
    orgs: family(['principals'], orgs, groupCount(group('principals'))),
    committees: family(['committees'], committees, groupCount(group('committees'))),
    printed: family(['gave', ...PAYEE_GROUPS], printed, sum(groupCount(group('gave')), payeeCount)),
  };
}

const CHAMBERS: Record<string, string> = { HF: 'House', SF: 'Senate' };

/** The bill search's rows. It serves no total, so a full page is a floor. */
export function billFamily(bills: BillRow[]): FamilyState {
  if (bills.length === 0) return { state: 'empty' };
  const rows = bills.map((bill) => {
    const code =
      bill.file_type && bill.file_number != null
        ? `${bill.file_type} ${bill.file_number}`
        : undefined;
    return {
      key: `bill-${bill.id}`,
      name: bill.ai_analysis?.short_title || code || bill.id,
      note: join(billSession(bill.id), bill.file_type ? CHAMBERS[bill.file_type] : null),
      code,
      href: linked('bill', { id: bill.id }),
    };
  });
  return { state: 'rows', rows, count: { value: rows.length, exact: rows.length < BILL_LIMIT } };
}

type Shown = FamilyState | { state: 'loading' };

/** What a read gives a family: loading, failed, or its answer. A failed read
 * never shows the previous query's results. */
function fromRead<T>(read: Read<T>, retrying: boolean, map: (data: T) => FamilyState): Shown {
  if (read.failed) return { state: 'failed' };
  if (read.loading || (retrying && read.pending) || !read.data) return { state: 'loading' };
  return map(read.data);
}

export function SearchResults(_props: { match: RouteMatch }) {
  const location = useLocation();
  const params = location.searchParams;
  const submitted = (params.get('q') ?? '').trim();
  const expanded = params.get('family');
  const from = params.get('from');
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);

  const [draft, setDraft] = useState(submitted);
  // Back and Forward restore the earlier query into the field.
  useEffect(() => setDraft(submitted), [submitted]);

  const searchable = submitted.length >= MIN_QUERY_LENGTH ? submitted : null;
  const encoded = searchable ? encodeURIComponent(searchable) : null;
  const money = useRead<MoneySearch>(
    encoded ? `campaign-finance/search?q=${encoded}&limit=${MONEY_LIMIT}` : null,
    { keepPrevious: true },
  );
  const bills = useRead<{ bills: BillRow[] }>(
    encoded ? `search?q=${encoded}&types=bills&limit=${BILL_LIMIT}` : null,
    { keepPrevious: true },
  );
  const [retrying, setRetrying] = useState<FamilyId | null>(null);
  useEffect(() => setRetrying(null), [submitted]);

  const families: Record<FamilyId, Shown> | null = !submitted
    ? null
    : !searchable
      ? (Object.fromEntries(
          ORDER.map((id) => [id, { state: 'too-short', floor: MIN_QUERY_LENGTH } as FamilyState]),
        ) as Record<FamilyId, Shown>)
      : (() => {
          const moneyShown = (id: Exclude<FamilyId, 'bills'>): Shown =>
            fromRead(money, retrying === id, (data) => moneyFamilies(data)[id]);
          return {
            people: moneyShown('people'),
            orgs: moneyShown('orgs'),
            committees: moneyShown('committees'),
            bills: fromRead(bills, retrying === 'bills', (data) => billFamily(data.bills ?? [])),
            printed: moneyShown('printed'),
          };
        })();

  const all = families ? ORDER.map((id) => families[id]) : [];
  const anyLoading = all.some((family) => family.state === 'loading');
  const allEmpty = all.length > 0 && all.every((family) => family.state === 'empty');
  const updating = money.updating || bills.updating;

  const statusLine = !submitted
    ? 'Enter a name or bill number'
    : anyLoading || updating
      ? `Searching for “${submitted}”`
      : `Results for “${submitted}” · each record family is counted on its own`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    navigate(withFrom(hrefFor('search', {}, { q: next }), from));
  }

  function retry(id: FamilyId) {
    setRetrying(id);
    if (id === 'bills') bills.retry();
    else money.retry();
  }

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        <header className="sr-head">
          <h1 tabIndex={-1} className="f-page-title">
            Search results
          </h1>
          <form role="search" onSubmit={submit} className="sr-form">
            <label htmlFor="search-field" className="f-visually-hidden">
              Search records
            </label>
            <input
              id="search-field"
              type="search"
              className="f-field sr-field"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search records"
              autoComplete="off"
            />
            <button type="submit" className="f-btn sr-submit">
              Search
            </button>
          </form>
          <p aria-live="polite" className="sr-status">
            {statusLine}
          </p>
        </header>
        {updating && !anyLoading && (
          <div className="sr-updating">
            <Updating />
          </div>
        )}
        {allEmpty ? (
          <div className="f-empty-box sr-all-empty">
            No matching records
            <div className="f-empty-next">Try another name or bill number</div>
          </div>
        ) : (
          families && (
            <div className="sr-families">
              {ORDER.map((id) => (
                <Family
                  key={id}
                  id={id}
                  shown={families[id]}
                  open={expanded === id}
                  here={here}
                  onExpand={() => {
                    const query = new URLSearchParams(location.search);
                    query.set('family', id);
                    navigate(`${location.pathname}?${query.toString()}`, { replace: true });
                  }}
                  onRetry={() => retry(id)}
                />
              ))}
            </div>
          )
        )}
      </div>
    </main>
  );
}

function Family({
  id,
  shown,
  open,
  here,
  onExpand,
  onRetry,
}: {
  id: FamilyId;
  shown: Shown;
  open: boolean;
  here: string;
  onExpand: () => void;
  onRetry: () => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const focusAfterExpand = useRef(false);
  const rows = shown.state === 'rows' ? shown.rows : [];
  const visible = open ? rows : rows.slice(0, FOLDED);
  const hasMore = shown.state === 'rows' && !open && rows.length > FOLDED;
  const headingId = `sr-${id}`;
  const listId = `sr-${id}-list`;
  const mark = MARKS[id];

  // View all moves focus to the first row it revealed.
  useEffect(() => {
    if (!open || !focusAfterExpand.current) return;
    focusAfterExpand.current = false;
    list.current?.querySelectorAll<HTMLElement>('li > .sr-row')[FOLDED]?.focus();
  }, [open]);

  return (
    <section aria-labelledby={headingId} className="sr-family">
      <div className="sr-family-head">
        <h2 id={headingId} className="sr-family-title">
          {TITLES[id]}
          {shown.state === 'rows' && <span className="sr-count">{countLabel(shown.count)}</span>}
          {shown.state === 'empty' && <span className="sr-count">0</span>}
        </h2>
        {hasMore && (
          <button
            type="button"
            className="sr-more"
            aria-expanded="false"
            aria-controls={listId}
            onClick={() => {
              focusAfterExpand.current = true;
              onExpand();
            }}
          >
            View all
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 9 L12 15 L18 9"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
      {shown.state === 'loading' && <LoadingRows />}
      {shown.state === 'failed' && (
        <div role="alert" className="f-alert sr-failed">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="#c0392b" strokeWidth="2" />
            <path
              d="M12 7.5 V13 M12 16 V16.5"
              stroke="#c0392b"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
          <div>
            We couldn’t load these results
            <div className="f-alert-action">
              <button type="button" className="f-btn f-btn-secondary f-btn-small" onClick={onRetry}>
                Try again
              </button>
            </div>
          </div>
        </div>
      )}
      {shown.state === 'empty' && <div className="sr-empty">No matching records</div>}
      {shown.state === 'too-short' && <div className="sr-empty">{tooShortTitle(shown.floor)}</div>}
      {shown.state === 'rows' && (
        <>
          <ul id={listId} ref={list} className="sr-list">
            {visible.map((row) => {
              const body = (
                <>
                  <span className={mark ? 'f-marked sr-text' : 'sr-text'}>
                    {mark && <RecordMark kind={mark} />}
                    <span className="sr-name">{row.name}</span>
                    <span className="sr-note">{row.note}</span>
                  </span>
                  {row.code && <span className="f-code">{row.code}</span>}
                </>
              );
              return (
                <li key={row.key}>
                  {row.href ? (
                    <Link to={withFrom(row.href, here)} className="sr-row sr-link">
                      {body}
                    </Link>
                  ) : (
                    <div className="sr-row" tabIndex={-1}>
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {id === 'printed' && <p className="sr-family-note">{PRINTED_NOTE}</p>}
        </>
      )}
    </section>
  );
}
