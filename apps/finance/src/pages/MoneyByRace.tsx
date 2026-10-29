import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { campaignMoneyHistoryYears } from '@alethical/shared/campaignMoneyYears';
import { formatDay, formatMoney } from '@alethical/shared/moneyFormat';
import {
  committeeFigures,
  contestSeatLabel,
  getCampaignFinanceRacesFromApiPayload,
  MIXED_PERIODS_NOTE,
  RACE_REGISTRATION_NOTE,
  type ApiMoneyByRacePayload,
} from '@alethical/shared/moneyByRace';
import { centralDateLabel } from '@alethical/shared/moneyLanding';
import { paymentCopyLines } from '@alethical/shared/paymentCopyDates';

import { apiGet, apiPath, useRead } from '../api/read';
import { useFinanceSession } from '../auth/session';
import { Link, navigate, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { useBand } from '../ui/band';
import { Refused } from '../ui/controls';
import { BackLink, LoadingLine, SourcesAndUpdates, type SourceGroup } from '../ui/parts';
import { DATE_MISSING, sumAmounts, TOTAL_WITHHELD } from './committee/data';
import './raceAndRecipients.css';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';

/**
 * The register's offices (OFFICE_ORDER in alethical/api/services/campaign_finance_races.py).
 * Only used to guess which office an address names, so the page can read that one
 * office's contests; an office not listed here is found by reading every office.
 */
const KNOWN_OFFICES = [
  'House',
  'Senate',
  'Governor',
  'Attorney General',
  'Secretary of State',
  'State Auditor',
  'Supreme Court',
  'Appellate Court',
  'District Court',
];

/** The server's own anchor rule (`contest_anchor`): `house-12a`, `governor`. */
export function contestAnchor(office: string, district: string | null): string {
  const raw = district === null ? office : `${office} ${district}`;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The office a race address names: the longest office whose anchor the address
 * is, or starts. Null when it names none we know. */
export function officeOfAnchor(anchor: string, offices: readonly string[]): string | null {
  let best: string | null = null;
  for (const office of offices) {
    const slug = contestAnchor(office, null);
    if (anchor === slug || anchor.startsWith(`${slug}-`)) {
      if (!best || slug.length > contestAnchor(best, null).length) best = office;
    }
  }
  return best;
}

/**
 * The address of one contest for one year: `/money/races/house-34a?year=2026`.
 * The id is the server's own contest anchor (the same one the public site and the
 * TV records link with), and the year rides in the query like every in-page choice.
 */
export function moneyByRaceHref(
  office: string,
  district: string | null,
  year: number | string,
): string {
  return hrefFor('money-by-race', { id: contestAnchor(office, district) }, { year: String(year) });
}

/** A district menu option's words: the seat label without its office. */
export function seatPart(contest: { office: string; district: string | null }): string {
  const label = contestSeatLabel(contest);
  return label.slice(contest.office.length).replace(/^\s*·?\s*/, '');
}

function chosenYear(raw: string, years: readonly number[]): number {
  const year = Number(raw);
  return Number.isInteger(year) && years.includes(year) ? year : years[0];
}

// --- Outside spending ------------------------------------------------------------

/** One row of `/campaign-finance/outside-spending`, as this page reads it. */
export interface OutsideRow {
  spender: string | null;
  spender_registration_number: string | null;
  spender_linkable: boolean;
  about_committee_name: string | null;
  about_committee_registration_number: string | null;
  direction: string | null;
  paid_on: string | null;
  amount: string | null;
  record_number: number;
}

export interface OutsidePage {
  state: 'reported' | 'not_reported' | 'unavailable' | string;
  rows: OutsideRow[];
  page: { number: number; size: number; has_more: boolean; total_rows: number | null };
  release_id: string | null;
  fetched_at: string | null;
}

/** One spender's payments about one committee in one direction, as filed. */
export interface OutsideGroup {
  key: string;
  aboutRegistration: string;
  aboutName: string;
  spender: string;
  spenderRegistration: string | null;
  linkable: boolean;
  direction: string | null;
  /** The exact sum of this group's own payments, or null when one lacks an amount. */
  amount: string | null;
  dates: string | null;
}

/** "Oct 2, 2025 to Oct 9, 2025", 1 date alone, or the missing-date words. */
export function paymentDates(dates: ReadonlyArray<string | null>): string {
  const held = dates.filter((day): day is string => Boolean(day)).sort();
  if (held.length === 0) return DATE_MISSING;
  const first = formatDay(held[0]) ?? held[0];
  const last = formatDay(held[held.length - 1]) ?? held[held.length - 1];
  const keep = (day: string) => day.replace(/ /g, ' ');
  return first === last ? keep(first) : `${keep(first)} to ${keep(last)}`;
}

/** "For {committee}" as filed; the filing's direction is the spender's statement. */
export function positionAsFiled(direction: string | null, aboutName: string): string {
  if (direction === 'For' || direction === 'Against') return `${direction} ${aboutName}`;
  return `Position not stated · ${aboutName}`;
}

/**
 * Each spender's payments about each committee, kept apart: 1 group per committee
 * the filing names, spender and direction. Nothing is added across committees or
 * spenders; a group's amount is the sum of its own payments only. Ordered by the
 * contest's committee order, then spender name, never by amount.
 */
export function outsideGroups(
  rows: readonly OutsideRow[],
  committeeOrder: readonly string[],
): OutsideGroup[] {
  const groups = new Map<
    string,
    Omit<OutsideGroup, 'amount' | 'dates'> & { amounts: (string | null)[]; days: (string | null)[] }
  >();
  for (const row of rows) {
    const about = row.about_committee_registration_number ?? '';
    const spender = row.spender ?? '';
    const identity = row.spender_registration_number
      ? `reg:${row.spender_registration_number}`
      : `name:${spender}`;
    const key = JSON.stringify([about, identity, row.direction]);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        aboutRegistration: about,
        aboutName: row.about_committee_name ?? about,
        spender,
        spenderRegistration: row.spender_registration_number,
        linkable: row.spender_linkable,
        direction: row.direction,
        amounts: [],
        days: [],
      };
      groups.set(key, group);
    }
    group.linkable &&= row.spender_linkable;
    group.amounts.push(row.amount);
    group.days.push(row.paid_on);
  }
  const place = (registration: string) => {
    const index = committeeOrder.indexOf(registration);
    return index < 0 ? committeeOrder.length : index;
  };
  return [...groups.values()]
    .map(({ amounts, days, ...group }) => ({
      ...group,
      amount: sumAmounts(amounts),
      dates: paymentDates(days),
    }))
    .sort(
      (a, b) =>
        place(a.aboutRegistration) - place(b.aboutRegistration) ||
        a.spender.localeCompare(b.spender) ||
        String(a.direction).localeCompare(String(b.direction)),
    );
}

/** Pages of 50 at most this many per committee before the read gives up. */
const MAX_PAGES = 100;
const CACHE_MS = 60_000;

interface OutsideAnswer {
  rows: OutsideRow[];
  fetchedAt: string | null;
}

const outsideCache = new Map<string, { at: number; value: OutsideAnswer }>();

export function clearOutsideSpending() {
  outsideCache.clear();
}

/** Every outside-spending row filed about 1 committee for 1 year, or null on failure. */
async function rowsAbout(
  apiBaseUrl: string,
  registration: string,
  year: number,
  token: string | null,
  signal: AbortSignal,
): Promise<OutsidePage[] | null> {
  const pages: OutsidePage[] = [];
  for (let number = 1; number <= MAX_PAGES; number += 1) {
    const answer = await apiGet<OutsidePage>(
      apiBaseUrl,
      apiPath(['campaign-finance', 'outside-spending'], {
        about: registration,
        year,
        sort: 'newest',
        page: number,
      }),
      token,
      fetch,
      signal,
    );
    // A committee neither the register nor the file holds has no rows filed about it.
    if (answer.state === 'not-found') return [];
    if (answer.state !== 'ok') return null;
    const page = answer.data;
    if (page.state === 'not_reported') return pages;
    if (page.state !== 'reported') return null;
    if (pages.length > 0 && page.release_id !== pages[0].release_id) return null;
    pages.push(page);
    if (!page.page.has_more) {
      const count = pages.reduce((sum, item) => sum + item.rows.length, 0);
      const total = page.page.total_rows;
      return total === null || total === count ? pages : null;
    }
  }
  return null;
}

async function loadOutside(
  apiBaseUrl: string,
  registrations: readonly string[],
  year: number,
  token: string | null,
  signal: AbortSignal,
): Promise<OutsideAnswer | null> {
  const answers = await Promise.all(
    registrations.map((registration) => rowsAbout(apiBaseUrl, registration, year, token, signal)),
  );
  if (answers.some((answer) => answer === null)) return null;
  const pages = answers.flatMap((answer) => answer ?? []);
  // Pages from 2 different copies of the file would mix 2 downloads.
  if (new Set(pages.map((page) => page.release_id)).size > 1) return null;
  return {
    rows: pages.flatMap((page) => page.rows),
    fetchedAt: pages[0]?.fetched_at ?? null,
  };
}

interface OutsideRead {
  data: OutsideAnswer | null;
  loading: boolean;
  failed: boolean;
  pending: boolean;
  retry: () => void;
}

/** The outside-spending rows about every committee in the contest, read whole. */
export function useOutsideSpending(
  registrations: readonly string[] | null,
  year: number,
): OutsideRead {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const list = registrations ? registrations.join(',') : null;
  const key = list !== null ? `${accessToken}|${year}|${list}` : null;
  const [answer, setAnswer] = useState<{
    key: string;
    value: OutsideAnswer | null;
    failed: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!key || list === null) return;
    const held = outsideCache.get(key);
    if (held && Date.now() - held.at < CACHE_MS && attempt === 0) {
      setAnswer({ key, value: held.value, failed: false });
      setPending(false);
      return;
    }
    const request = ++latest.current;
    const controller = new AbortController();
    setPending(true);
    const numbers = list ? list.split(',') : [];
    void loadOutside(apiBaseUrl, numbers, year, accessToken, controller.signal).then((value) => {
      if (request !== latest.current) return;
      setPending(false);
      if (value) {
        outsideCache.set(key, { at: Date.now(), value });
        setAnswer({ key, value, failed: false });
      } else {
        setAnswer({ key, value: null, failed: true });
      }
    });
    return () => {
      // A superseded or abandoned read must never write its answer, including the
      // failure its own abort produces.
      latest.current += 1;
      controller.abort();
    };
  }, [apiBaseUrl, accessToken, key, list, year, attempt]);

  useEffect(() => setAttempt(0), [key]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current = answer && answer.key === key ? answer : null;
  return {
    data: current?.value ?? null,
    loading: key !== null && (current === null || (pending && current.value === null)),
    failed: current?.failed === true && !pending,
    pending,
    retry,
  };
}

// --- Sources -----------------------------------------------------------------------

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

/** The payment files' and report totals' copy dates, in the shared wording; a date
 * the server did not serve is left out, never borrowed. */
export function raceSources(
  summary: MoneySummary | null,
  registerAsOf: string | null,
): SourceGroup[] {
  const fetched = summary?.freshness?.register_fetched_at;
  const registerDay = fetched ? centralDateLabel(fetched) : formatDay(registerAsOf);
  const copied = summary?.freshness?.payment_copied_at;
  if (!copied) return [];
  const items = paymentCopyLines(
    {
      contributions: copied.contributions ?? null,
      expenditures: copied.expenditures ?? null,
      independentExpenditures: copied.independent_expenditures ?? null,
    },
    registerDay,
  );
  return items.length > 0 ? [{ source: BOARD, items }] : [];
}

// --- The labelled field menu (Money by race drawing) --------------------------------

interface MenuOption {
  value: string;
  label: string;
}

function Caret({ up }: { up: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={up ? 'f-caret-up mr-caret' : 'mr-caret'}
    >
      <path
        d="M6 9 L12 15 L18 9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The drawing's field menu: the field's name above a full-width button showing the
 * current choice; options as 44px rows with a check on the chosen one, drawn over
 * the content below. Escape, a press outside, Tab or a choice closes it; arrow keys
 * move between options. The shared Dropdown puts the name inside its button, which
 * this drawing does not.
 */
export function FieldMenu({
  name,
  value,
  current,
  options,
  onChange,
}: {
  name: string;
  value: string | null;
  current: string;
  options: readonly MenuOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const chosen = list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"] button');
    (chosen ?? list.current?.querySelector<HTMLButtonElement>('button'))?.focus();
  }, [open]);

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, at + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, at - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'Tab') setOpen(false);
    if (next >= 0) {
      event.preventDefault();
      buttons[next]?.focus();
    }
  }

  return (
    <div className="mr-field" ref={wrapper} data-open={open || undefined}>
      <span id={`${id}-name`} className="mr-field-name">
        {name}
      </span>
      <button
        ref={button}
        id={`${id}-button`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-labelledby={`${id}-name ${id}-button`}
        className="mr-field-button f-num"
        data-open={open || undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="mr-field-current">{current}</span>
        <Caret up={open} />
      </button>
      {open && (
        <ul
          id={`${id}-list`}
          ref={list}
          role="listbox"
          aria-label={name}
          className="mr-field-list"
          onKeyDown={onListKey}
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <li key={option.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className="f-dropdown-option"
                  data-selected={selected || undefined}
                  onClick={() => {
                    setOpen(false);
                    button.current?.focus();
                    if (!selected) onChange(option.value);
                  }}
                >
                  {selected && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                      className="f-check"
                    >
                      <path
                        d="M5 12.5 L9.5 17 L19 7.5"
                        stroke="#0E6A82"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// --- The page ---------------------------------------------------------------------

const FAILED =
  'We couldn’t load this race. This is a problem on our side and says nothing about what was filed.';
/** Not in the drawing: the outside-spending read failing on its own. */
const OUTSIDE_FAILED =
  'We couldn’t load spending by outside groups. This is a problem on our side and says nothing about what was filed.';
/** The drawing's "not held" wording for a choice the records do not hold. */
const NOT_HELD = 'Not held';

/**
 * Money by race (Money by Race drawing): the candidate committees registered for
 * 1 office and district, each with its own 2 figures and their dates, and what
 * outside groups reported spending about those committees, in a separate table.
 * Nothing is added across committees. Keyed on the server's contest anchor
 * (`house-34a`) with the year in the query.
 */
export function MoneyByRace({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const band = useBand();
  const anchor = (match.params.id ?? '').toLowerCase();
  const years = useMemo(() => campaignMoneyHistoryYears(), []);
  const [address, setAddress] = useAddressState({ year: String(years[0]) });
  const year = chosenYear(address.year, years);

  const guessed = officeOfAnchor(anchor, KNOWN_OFFICES);
  // A result view for its menus: while another year or office loads, the menus keep
  // the last answer's choices; the figures never show another view's answer.
  const read = useRead<ApiMoneyByRacePayload>(
    apiPath(['campaign-finance', 'races'], { year, office: guessed }),
    { keepPrevious: true },
  );
  const summary = useRead<MoneySummary>('campaign-finance/summary');
  const shown = useMemo(
    () => (read.data ? getCampaignFinanceRacesFromApiPayload(read.data, year) : null),
    [read.data, year],
  );
  const page = read.updating || read.failed ? null : shown;
  const unavailable = page !== null && page.state !== 'reported';
  const offices = shown ? shown.offices.map((entry) => entry.office) : [];
  const office = shown ? (officeOfAnchor(anchor, offices) ?? guessed) : guessed;
  const menuContests = shown ? shown.contests.filter((item) => item.office === office) : [];
  const officeContests = page ? page.contests.filter((item) => item.office === office) : [];
  const contest = officeContests.find((item) => item.anchor === anchor) ?? null;

  // An office chosen from the menu opens its first district.
  const officeOnly = office !== null && anchor === contestAnchor(office, null);
  const firstContest = officeContests[0] ?? null;
  useEffect(() => {
    if (!contest && officeOnly && firstContest && firstContest.anchor !== anchor) {
      navigate(hrefFor('money-by-race', { id: firstContest.anchor }) + window.location.search, {
        replace: true,
      });
    }
  }, [contest, officeOnly, firstContest, anchor]);

  const registrations = useMemo(
    () => (contest ? contest.committees.map((item) => item.registrationNumber) : null),
    [contest],
  );
  const outside = useOutsideSpending(registrations, year);
  const groups = useMemo(
    () => (outside.data && registrations ? outsideGroups(outside.data.rows, registrations) : []),
    [outside.data, registrations],
  );

  function openContest(id: string) {
    navigate(hrefFor('money-by-race', { id }) + window.location.search, { replace: true });
  }

  const loaded = page !== null && !unavailable;
  const failed = read.failed || unavailable || read.notFound;
  const redirecting = !contest && officeOnly && firstContest !== null;
  const loading = !failed && (read.loading || read.updating || redirecting);
  const isPhone = band === 'phone';

  const district = menuContests.find((item) => item.anchor === anchor) ?? null;
  const officeOptions = offices.map((name) => ({ value: name, label: name }));
  const districtOptions = menuContests.map((item) => ({
    value: item.anchor,
    label: seatPart(item),
  }));
  const yearOptions = years.map((item) => ({ value: String(item), label: String(item) }));

  const committeeHref = (registration: string, query: Record<string, string>) =>
    isBuilt('committee') ? withFrom(hrefFor('committee', { id: registration }, query), here) : null;

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && (
          <div className="mr-back">
            <BackLink to={back.to} name={back.name} />
          </div>
        )}
        <header className="mr-header">
          <h1 tabIndex={-1} className="f-page-title">
            Money by race
          </h1>
          <p className="mr-dek">
            One office, district and year. Candidate committees’ own filings sit apart from what
            outside groups reported spending about the race.
          </p>
        </header>

        {shown && (
          <div className="mr-fields">
            <FieldMenu
              name="Office"
              value={office && offices.includes(office) ? office : null}
              current={office && offices.includes(office) ? office : NOT_HELD}
              options={officeOptions}
              onChange={(next) => openContest(contestAnchor(next, null))}
            />
            <FieldMenu
              name="District"
              value={district?.anchor ?? null}
              current={district ? seatPart(district) : NOT_HELD}
              options={districtOptions}
              onChange={openContest}
            />
            <FieldMenu
              name="Year"
              value={String(year)}
              current={String(year)}
              options={yearOptions}
              onChange={(next) => setAddress({ year: next })}
            />
          </div>
        )}

        {loading && (
          <div className="mr-status">
            <LoadingLine>Loading…</LoadingLine>
          </div>
        )}
        {failed && (
          <div className="mr-status mr-alert">
            <Refused onRetry={read.retry} retrying={read.pending}>
              {FAILED}
            </Refused>
          </div>
        )}

        {loaded && !loading && !contest && (
          <div className="mr-status">
            <div className="f-empty-box">
              No registered candidate committee is held for this contest
            </div>
          </div>
        )}

        {loaded && contest && (
          <>
            <div className="mr-contest">
              <h2 className="mr-contest-title f-num">
                {contestSeatLabel(contest)} · {year}
              </h2>
            </div>

            <section aria-labelledby="mr-cc-heading" className="mr-section">
              <div className="mr-section-head">
                <h3 id="mr-cc-heading">Candidate committees</h3>
                <span className="mr-section-meta">{RACE_REGISTRATION_NOTE}</span>
              </div>
              {contest.periodsDiffer && <p className="mr-mixed">{MIXED_PERIODS_NOTE}</p>}
              {contest.committees.length === 0 ? (
                <div className="mr-table-gap f-empty-box">
                  No registered candidate committee is held for this contest
                </div>
              ) : (
                <>
                  <div role="table" aria-label="Candidate committees" className="mr-table">
                    {!isPhone && (
                      <div role="row" className="mr-cc-row mr-head">
                        <span role="columnheader">COMMITTEE</span>
                        <span role="columnheader" className="mr-fig">
                          TOTAL CONTRIBUTIONS
                        </span>
                        <span role="columnheader" className="mr-fig">
                          ITEMIZED CONTRIBUTIONS
                        </span>
                      </div>
                    )}
                    {contest.committees.map((committee) => {
                      const figures = committeeFigures(committee, year);
                      const href = committeeHref(committee.registrationNumber, {
                        year: String(year),
                      });
                      return (
                        <div role="row" key={committee.registrationNumber} className="mr-cc-row">
                          <span role="cell" className="mr-cc-name">
                            {href ? (
                              <Link to={href} className="mr-link">
                                {committee.name}
                              </Link>
                            ) : (
                              <span className="mr-plain">{committee.name}</span>
                            )}
                            <span className="mr-sub f-num">
                              Registration {committee.registrationNumber}
                            </span>
                          </span>
                          {figures.map((figure) => (
                            <span role="cell" key={figure.label} className="mr-fig">
                              {isPhone && <span className="mr-fig-label">{figure.label}</span>}
                              <span
                                className="mr-fig-value f-num"
                                data-missing={!figure.isFigure || undefined}
                              >
                                {figure.text}
                              </span>
                              {figure.isFigure && figure.period && (
                                <span className="mr-fig-dates f-num">{figure.period}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mr-note">
                    Total contributions are what the committee reported to the state; itemized
                    contributions are the donations with named givers in our contribution records.
                    Totals are not added across committees.
                  </p>
                </>
              )}
            </section>

            <section aria-labelledby="mr-os-heading" className="mr-section mr-outside">
              <div className="mr-section-head">
                <h3 id="mr-os-heading">Spending by outside groups</h3>
                <span className="mr-section-meta f-num">
                  Independent expenditures file · {year}
                </span>
              </div>
              {outside.loading && !outside.failed && (
                <div className="mr-table-gap">
                  <LoadingLine>Loading…</LoadingLine>
                </div>
              )}
              {outside.failed && (
                <div className="mr-table-gap">
                  <Refused onRetry={outside.retry} retrying={outside.pending}>
                    {OUTSIDE_FAILED}
                  </Refused>
                </div>
              )}
              {outside.data && !outside.failed && groups.length === 0 && (
                <div className="mr-table-gap f-empty-box">
                  No independent expenditure names this contest in the file for {year}. This does
                  not mean none was made.
                </div>
              )}
              {outside.data && !outside.failed && groups.length > 0 && (
                <>
                  <div role="table" aria-label="Spending by outside groups" className="mr-table">
                    {!isPhone && (
                      <div role="row" className="mr-os-row mr-head">
                        <span role="columnheader">SPENDER</span>
                        <span role="columnheader">POSITION AS FILED</span>
                        <span role="columnheader" className="mr-fig">
                          AMOUNT
                        </span>
                        <span role="columnheader" className="mr-fig">
                          PAYMENT DATES
                        </span>
                      </div>
                    )}
                    {groups.map((group) => {
                      const href =
                        group.linkable && group.spenderRegistration
                          ? committeeHref(group.spenderRegistration, {
                              year: String(year),
                              tab: 'independent',
                            })
                          : null;
                      const spender = href ? (
                        <Link to={href} className="mr-link">
                          {group.spender}
                        </Link>
                      ) : (
                        <span className="mr-plain">{group.spender}</span>
                      );
                      const amount =
                        group.amount === null ? TOTAL_WITHHELD : formatMoney(group.amount);
                      const position = positionAsFiled(group.direction, group.aboutName);
                      if (isPhone) {
                        return (
                          <div role="row" key={group.key} className="mr-os-phone">
                            <div className="mr-os-phone-top">
                              <span role="cell" className="mr-os-name">
                                {spender}
                              </span>
                              <span
                                role="cell"
                                className="mr-os-amount f-num"
                                data-missing={group.amount === null || undefined}
                              >
                                {amount}
                              </span>
                            </div>
                            <div role="cell" className="mr-os-phone-line f-num">
                              {position} · {group.dates}
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div role="row" key={group.key} className="mr-os-row">
                          <span role="cell" className="mr-os-name">
                            {spender}
                          </span>
                          <span role="cell" className="mr-os-position">
                            {position}
                          </span>
                          <span
                            role="cell"
                            className="mr-fig mr-os-amount f-num"
                            data-missing={group.amount === null || undefined}
                          >
                            {amount}
                          </span>
                          <span role="cell" className="mr-fig mr-os-dates f-num">
                            {group.dates}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mr-note">
                    Independent expenditures are reported by the spender, never by the candidate,
                    and do not appear in a candidate committee’s filing. A position as filed is the
                    spender’s statement.
                  </p>
                </>
              )}
            </section>
          </>
        )}
      </div>
      <SourcesAndUpdates groups={loaded ? raceSources(summary.data, page?.asOf ?? null) : []} />
    </main>
  );
}
