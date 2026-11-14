import { useCallback, useEffect, useState } from 'react';

import { registerKindLabel } from '@alethical/shared/committeeMoneyShared';
import {
  moneyFigure,
  paymentCountLabel,
  splitExplanation,
  type MoneyBlockState,
  type SplitState,
} from '@alethical/shared/legislatorCampaignMoney';
import { RECORD_DOES_NOT_COVER } from '@alethical/shared/moneyLanding';
import { formatDay, formatMoney } from '../ui/money';

import { apiPath, useRead, type Read } from '../api/read';
import { Link } from '../router';
import { withFrom } from '../returnContext';
import { hrefFor, isBuilt } from '../routes';
import { useAddressState } from '../ui/addressState';
import { LoadingRows, Refused } from '../ui/controls';
import { WithArrow } from '../ui/parts';
import '../pages/people.css';

/**
 * The shared "Campaign finance" section (Campaign Finance drawing), used by the
 * Candidate and Legislator profiles now and by Person later. Each confirmed
 * campaign account is its own card with its own Year chips and its own
 * figures, each figure with its own period; accounts are never added together
 * (grounded-answers rule 12). Spending by outside groups follows, by contest,
 * as filed, never summed with the candidate's own money.
 *
 * Every figure comes from the shared Alethical API's own routes for one legislator:
 * `/legislators/{id}/campaign-finance/years` (which accounts hold which
 * years), `/legislators/{id}/campaign-finance?year=` (one year's figures) and
 * `/campaign-finance/outside-spending?about=&year=&group_by=spender`.
 */

/** Money records start in 2015 (`RECORD_DOES_NOT_COVER`). */
export const FIRST_MONEY_YEAR = 2015;

/** Minnesota names a donor once their yearly total passes $200; rule 12's sentence. */
export const DONOR_THRESHOLD_SENTENCE = RECORD_DOES_NOT_COVER[2];

/** A year the record does not hold for this account (drawing: "Not held"). */
export const NOT_HELD = 'Not held';

/** Rule 12: a missing official report total. */
export const REPORT_TOTAL_UNAVAILABLE = 'Report total unavailable';

/** A total withheld for a missing payment amount, where no amount heading
 * names the value (Design Round 34): under an amount heading it reads "Incomplete". */
export const INCOMPLETE = 'Missing payment amount';

/** No outside-spending rows for the selected years (Design Round 34, fewest words). */
export const NO_OUTSIDE = 'No confirmed records held';

interface RegisterContest {
  office: string;
  district: string;
  year: number;
  anchor: string;
}

export interface FinanceYears {
  register_contest?: RegisterContest | null;
  link_state: 'unconfirmed' | 'reviewed_none_confirmed' | 'confirmed';
  payment_copied_at?: {
    contributions?: string | null;
    expenditures?: string | null;
    independent_expenditures?: string | null;
  } | null;
  years: Array<{ year: number; committees: Array<{ registration_number: string }> }>;
}

interface Split {
  state: SplitState;
  reported_total?: string | null;
  reported_through?: string | null;
  first_payment_on?: string | null;
  last_payment_on?: string | null;
}

export interface CommitteeYear {
  registration_number: string;
  committee_name?: string | null;
  committee_name_as_reviewed?: string | null;
  register_kind?: string | null;
  checked?: { checked_on?: string | null } | null;
  split?: Split | null;
  money_in?: {
    state: MoneyBlockState;
    itemized_contribution_total?: string | null;
    itemized_contribution_payments?: number | null;
    reported_period_start?: string | null;
  } | null;
  money_out?: {
    state: MoneyBlockState;
    itemized_payment_total?: string | null;
    itemized_payments?: number | null;
  } | null;
}

export interface FinanceYear {
  year: number;
  committees: CommitteeYear[];
}

interface OutsideGroup {
  spender: string;
  spender_registration_number?: string | null;
  spender_linkable?: boolean;
  direction?: string | null;
  amount?: string | null;
  row_count?: number | null;
  amount_state?: 'reported' | 'incomplete' | 'incomplete_period';
  first_paid_on?: string | null;
  last_paid_on?: string | null;
  undated_count?: number;
  first_year?: number | null;
  last_year?: number | null;
}

interface OutsideAnswer {
  state: MoneyBlockState;
  about?: { office?: string | null; district?: string | null } | null;
  year: number;
  figures?: { first_paid_on?: string | null; last_paid_on?: string | null } | null;
  groups?: OutsideGroup[];
}

export interface Account {
  registrationNumber: string;
  name: string;
  /** Years this account holds figures in, newest first. */
  years: number[];
}

/** Held years for the displayed legislator or candidacy, from 2015 to this year. */
export function useFinanceYears(
  legislatorId: string | null,
  candidateId?: string | null,
): Read<FinanceYears> {
  const to = new Date().getFullYear();
  const id = candidateId ?? legislatorId;
  return useRead<FinanceYears>(
    id
      ? apiPath(
          [
            ...(candidateId ? ['finance', 'candidates'] : ['legislators']),
            id,
            'campaign-finance',
            'years',
          ],
          {
            from: FIRST_MONEY_YEAR,
            to,
          },
        )
      : null,
  );
}

/** Each confirmed account the figures route lists, with the years it holds, in
 * the order the profile names them. */
export function accountsFrom(
  years: FinanceYears | null,
  names: ReadonlyArray<{ registration_number: string; committee_name: string }> = [],
): Account[] {
  if (!years || years.link_state !== 'confirmed') return [];
  const held = new Map<string, number[]>();
  for (const entry of years.years) {
    for (const committee of entry.committees) {
      const list = held.get(committee.registration_number) ?? [];
      list.push(entry.year);
      held.set(committee.registration_number, list);
    }
  }
  const order = names.map((item) => item.registration_number);
  return [...held.entries()]
    .map(([registrationNumber, list]) => ({
      registrationNumber,
      name:
        names.find((item) => item.registration_number === registrationNumber)?.committee_name ??
        registrationNumber,
      years: [...list].sort((a, b) => b - a),
    }))
    .sort((a, b) => {
      const ia = order.indexOf(a.registrationNumber);
      const ib = order.indexOf(b.registrationNumber);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.name.localeCompare(b.name);
    });
}

function period(first: string | null | undefined, last: string | null | undefined) {
  const a = formatDay(first);
  const b = formatDay(last);
  if (!a && !b) return null;
  if (!a || !b || a === b) return a ?? b;
  return `${a} to ${b}`;
}

export interface Figure {
  label: string;
  value: string;
  /** False for a stand-in sentence ("Not reported"), so it is never set as an amount. */
  isFigure: boolean;
  basis: string;
}

/**
 * The 3 figures of one account-year, each with its own basis. The official
 * report total and the sum of listed payments are separate figures (rule 12);
 * a missing value is never $0.
 */
export function accountFigures(committee: CommitteeYear | null): Figure[] {
  if (!committee) {
    return ['Reported contributions', 'Itemized contributions', 'Itemized expenditures'].map(
      (label) => ({ label, value: NOT_HELD, isFigure: false, basis: '' }),
    );
  }
  const split = committee.split ?? null;
  const reported = formatMoney(split?.reported_total ?? null);
  const start = formatDay(committee.money_in?.reported_period_start);
  const through = formatDay(split?.reported_through);
  const reportBasis = reported
    ? start && through
      ? `Report period ${start} to ${through}`
      : through
        ? `Report period through ${through}`
        : ''
    : '';
  const moneyIn = committee.money_in;
  const contributions = moneyFigure(
    moneyIn?.state ?? 'not_reported',
    moneyIn?.itemized_contribution_total,
  );
  const inCount = paymentCountLabel(moneyIn?.itemized_contribution_payments);
  const inPeriod = period(split?.first_payment_on, split?.last_payment_on);
  const moneyOut = committee.money_out;
  const expenditures = moneyFigure(
    moneyOut?.state ?? 'not_reported',
    moneyOut?.itemized_payment_total,
  );
  const outCount = paymentCountLabel(moneyOut?.itemized_payments);
  return [
    {
      label: 'Reported contributions',
      value: reported ?? REPORT_TOTAL_UNAVAILABLE,
      isFigure: reported !== null,
      basis: reportBasis,
    },
    {
      label: 'Itemized contributions',
      value: contributions.text,
      isFigure: contributions.isFigure,
      basis: contributions.isFigure
        ? [inPeriod && `Payment period ${inPeriod}`, inCount].filter(Boolean).join(' · ')
        : '',
    },
    {
      label: 'Itemized expenditures',
      value: expenditures.text,
      isFigure: expenditures.isFigure,
      basis: expenditures.isFigure ? (outCount ?? '') : '',
    },
  ];
}

/** "State Representative · District 45B · 2024", the contest an outside group filed about. */
export function contestLabel(
  office: string | null | undefined,
  district: string | null | undefined,
  year: number,
): string {
  const title =
    office === 'House' ? 'State Representative' : office === 'Senate' ? 'State Senator' : office;
  // "District 99A · 2026" stays together (Design Round 34): no-break spaces.
  const tail = [district ? `District\u00a0${district}` : null, String(year)]
    .filter(Boolean)
    .join('\u00a0·\u00a0');
  return [title, tail].filter(Boolean).join(' · ');
}

/** One account's figures for one year, within the displayed profile's scope. */
export function useAccountYear(
  legislatorId: string | null,
  registrationNumber: string | null,
  year: number | null,
  candidateId?: string | null,
): { committee: CommitteeYear | null; read: Read<FinanceYear> } {
  const id = candidateId ?? legislatorId;
  const read = useRead<FinanceYear>(
    id && registrationNumber && year
      ? apiPath(
          [...(candidateId ? ['finance', 'candidates'] : ['legislators']), id, 'campaign-finance'],
          { year },
        )
      : null,
    { sharePending: true },
  );
  const committee =
    read.data?.committees.find((item) => item.registration_number === registrationNumber) ?? null;
  return { committee, read };
}

function FigureList({ figures, className }: { figures: Figure[]; className: string }) {
  return (
    <dl className={className}>
      {figures.map((figure) => (
        <div key={figure.label} className="cf-fig">
          <dt>{figure.label}</dt>
          <dd className="cf-fig-value" data-missing={!figure.isFigure || undefined}>
            {figure.value}
          </dd>
          {figure.basis && <dd className="cf-fig-basis">{figure.basis}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** Key figures under a profile's name: the newest held year of the first
 * confirmed account, from the same answer the Campaign finance card reads. */
export function KeyFigures({
  legislatorId,
  candidateId,
  account,
}: {
  legislatorId: string | null;
  candidateId?: string | null;
  account: Account | null;
}) {
  const year = account?.years[0] ?? null;
  const { committee, read } = useAccountYear(
    legislatorId,
    account?.registrationNumber ?? null,
    year,
    candidateId,
  );
  if (!account || !year || !read.data || !committee) return null;
  return (
    <div className="cf-key">
      <FigureList figures={accountFigures(committee)} className="cf-key-grid" />
      <div className="cf-key-note f-num">
        {committee.committee_name ?? account.name} · Year {year}
      </div>
    </div>
  );
}

function AccountCard({
  legislatorId,
  candidateId,
  account,
  year,
  onYear,
  from,
}: {
  legislatorId: string | null;
  candidateId?: string | null;
  account: Account;
  year: number;
  onYear: (year: number) => void;
  from: string;
}) {
  const held = account.years.includes(year);
  const { committee, read } = useAccountYear(
    legislatorId,
    account.registrationNumber,
    held ? year : null,
    candidateId,
  );
  const chips = held ? account.years : [...account.years, year].sort((a, b) => b - a);
  const name = committee?.committee_name ?? account.name;
  const kind = registerKindLabel(committee?.register_kind);
  const checkedOn = formatDay(committee?.checked?.checked_on);
  const split = committee?.split?.state ? splitExplanation(committee.split.state) : null;
  // The link carries the exact report whose figures the card shows (Round 37
  // item 4): Committee reads `report` as that report's period end.
  const href = isBuilt('committee')
    ? withFrom(
        hrefFor(
          'committee',
          { id: account.registrationNumber },
          {
            year: String(year),
            report: committee?.split?.reported_total
              ? (committee.split.reported_through ?? '')
              : '',
          },
        ),
        from,
      )
    : null;
  return (
    <article className="cf-account">
      <div className="cf-account-head">
        <div className="cf-account-id">
          <div className="cf-account-name">{name}</div>
          <div className="cf-account-kind f-num">
            {kind && <>{kind} · </>}
            <span className="f-nowrap">Registration number {account.registrationNumber}</span>
          </div>
          {checkedOn && <div className="cf-account-basis">Checked on {checkedOn}</div>}
        </div>
        {href && (
          <Link to={href} className="f-dest cf-account-open">
            <WithArrow>Open campaign account</WithArrow>
          </Link>
        )}
      </div>
      <div role="group" aria-label={`Year for ${name}`} className="f-labeled-chips cf-years">
        <span className="f-labeled-chips-label" aria-hidden="true">
          Year
        </span>
        <div className="f-chips">
          {chips.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === year}
              className="f-chip cf-year"
              onClick={() => option !== year && onYear(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {held && read.loading && <LoadingRows />}
      {held && (read.failed || read.notFound) && (
        <Refused onRetry={read.retry} retrying={read.pending}>
          Couldn’t load accounts
        </Refused>
      )}
      {(!held || (read.data && !read.loading)) && (
        <>
          <FigureList figures={accountFigures(held ? committee : null)} className="cf-figs" />
          {held && committee && (
            <div className="cf-notes">
              {/* One group (eug-31): when the 2-sentence split note shows, every line ends with a period. */}
              <p>
                {DONOR_THRESHOLD_SENTENCE}
                {split && /\.\s/.test(split) ? '.' : ''}
              </p>
              {split && <p>{split}</p>}
            </div>
          )}
        </>
      )}
    </article>
  );
}

function OutsideContest({
  registerContest,
  registrationNumber,
  year,
  from,
  onSettled,
}: {
  registerContest?: RegisterContest | null;
  registrationNumber: string;
  year: number;
  from: string;
  /** Whether this contest drew rows, once it answered; null while unsettled or failed. */
  onSettled: (key: string, hasRows: boolean | null) => void;
}) {
  const read = useRead<OutsideAnswer>(
    `campaign-finance/outside-spending?about=${encodeURIComponent(registrationNumber)}&year=${year}&group_by=spender`,
  );
  const answer = read.data;
  const failed = read.failed || answer?.state === 'unavailable';
  const groups = answer?.state === 'reported' ? (answer.groups ?? []) : [];
  const key = `${registrationNumber}-${year}`;
  const settled = read.loading || failed ? null : groups.length > 0;
  useEffect(() => onSettled(key, settled), [key, settled, onSettled]);
  if (read.loading) return <LoadingRows />;
  if (failed) {
    return (
      <Refused onRetry={read.retry} retrying={read.pending}>
        Couldn’t load results
      </Refused>
    );
  }
  if (groups.length === 0) return null;
  const raceHref =
    registerContest &&
    registerContest.year === year &&
    registerContest.office === answer?.about?.office &&
    registerContest.district === answer?.about?.district &&
    isBuilt('money-by-race')
      ? withFrom(
          hrefFor('money-by-race', { id: registerContest.anchor }, { year: String(year) }),
          from,
        )
      : null;
  return (
    <article className="cf-contest">
      <div className="cf-contest-head">
        <span className="cf-contest-label f-num">
          {contestLabel(answer?.about?.office, answer?.about?.district, year)}
        </span>
        {raceHref && (
          <Link to={raceHref} className="f-dest">
            <WithArrow>Open race</WithArrow>
          </Link>
        )}
      </div>
      <ul className="cf-outside">
        {groups.map((group, index) => {
          const linkable =
            isBuilt('committee') && group.spender_linkable && group.spender_registration_number;
          const amount =
            group.amount_state === 'incomplete_period' || group.amount_state === 'incomplete'
              ? null
              : formatMoney(group.amount ?? null)?.replace(/^-/, '−');
          const missing =
            group.amount_state === 'incomplete_period' ? 'Reporting period incomplete' : INCOMPLETE;
          const dated = period(group.first_paid_on, group.last_paid_on);
          const filingYears =
            group.first_year != null && group.last_year != null
              ? group.first_year === group.last_year
                ? `Filing year ${group.first_year}`
                : `Filing years ${group.first_year}–${group.last_year}`
              : null;
          const ownPeriod =
            (group.undated_count ?? 0) > 0 ? filingYears : dated ? `Payments dated ${dated}` : null;
          return (
            <li
              key={`${group.spender_registration_number ?? group.spender}-${group.direction}-${index}`}
            >
              <span className="cf-spender">
                {linkable ? (
                  <Link
                    to={withFrom(
                      hrefFor(
                        'committee',
                        { id: group.spender_registration_number as string },
                        { tab: 'independent', year: String(year) },
                      ),
                      from,
                    )}
                  >
                    {group.spender}
                  </Link>
                ) : (
                  <span>{group.spender}</span>
                )}
              </span>
              {group.direction && <span className="cf-position">{group.direction}</span>}
              <span className="cf-amount f-num" data-missing={amount ? undefined : true}>
                {amount ?? missing}
              </span>
              <span className="cf-count f-num">{paymentCountLabel(group.row_count) ?? ''}</span>
              {ownPeriod && <span className="cf-group-period f-num">{ownPeriod}</span>}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function OutsideSpending({
  registerContest,
  accounts,
  years,
  from,
}: {
  registerContest?: RegisterContest | null;
  accounts: Account[];
  years: Record<string, number>;
  from: string;
}) {
  const asked = accounts.filter((account) =>
    account.years.includes(years[account.registrationNumber]),
  );
  const keys = asked.map(
    (account) => `${account.registrationNumber}-${years[account.registrationNumber]}`,
  );
  const [settled, setSettled] = useState<Record<string, boolean | null>>({});
  const onSettled = useCallback(
    (key: string, hasRows: boolean | null) =>
      setSettled((current) =>
        current[key] === hasRows ? current : { ...current, [key]: hasRows },
      ),
    [],
  );
  // Empty only once every asked contest answered with no rows, never while one
  // is loading or failed (a failure is never shown as empty).
  const none = keys.every((key) => settled[key] === false);
  return (
    <div className="cf-block">
      <h3 className="cf-sub">Spending by outside groups</h3>
      {asked.map((account) => (
        <OutsideContest
          key={`${account.registrationNumber}-${years[account.registrationNumber]}`}
          registrationNumber={account.registrationNumber}
          year={years[account.registrationNumber]}
          from={from}
          onSettled={onSettled}
          registerContest={registerContest}
        />
      ))}
      {none && <div className="f-empty-box">{NO_OUTSIDE}</div>}
    </div>
  );
}

/**
 * The Campaign finance section. Candidate profiles use candidacy-scoped reads;
 * other profiles use the confirmed legislator. No confirmed accounts means no outside records.
 */
export function CampaignFinance({
  legislatorId,
  candidateId,
  years,
  accounts,
  emptyLine = 'No campaign committee is confirmed for this candidacy',
  from,
}: {
  legislatorId?: string | null;
  candidateId?: string | null;
  years?: Read<FinanceYears> | null;
  accounts: Account[];
  emptyLine?: string;
  from: string;
}) {
  const [address, setAddress] = useAddressState({ year: '' });
  const wanted = Number(address.year) || null;
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const selected: Record<string, number> = {};
  for (const account of accounts) {
    selected[account.registrationNumber] =
      chosen[account.registrationNumber] ?? wanted ?? account.years[0];
  }
  const profileId = candidateId ?? legislatorId;
  const loading = Boolean(profileId && years?.loading);
  const failed = Boolean(profileId && (years?.failed || years?.notFound));
  return (
    <section aria-labelledby="cf-h" className="cf">
      <h2 id="cf-h" className="f-section-title">
        Campaign finance
      </h2>
      <div className="cf-block">
        <h3 className="cf-sub">Campaign accounts</h3>
        {loading && <LoadingRows />}
        {failed && years && (
          <Refused onRetry={years.retry} retrying={years.pending}>
            Couldn’t load accounts
          </Refused>
        )}
        {!loading && !failed && accounts.length === 0 && (
          <div className="f-empty-box">{emptyLine}</div>
        )}
        {profileId &&
          accounts.map((account) => (
            <AccountCard
              key={account.registrationNumber}
              legislatorId={legislatorId ?? null}
              candidateId={candidateId}
              account={account}
              year={selected[account.registrationNumber]}
              from={from}
              onYear={(year) => {
                setChosen((current) => ({ ...current, [account.registrationNumber]: year }));
                setAddress({ year: String(year) });
              }}
            />
          ))}
      </div>
      {!loading && !failed && (
        <OutsideSpending
          accounts={accounts}
          years={selected}
          from={from}
          registerContest={candidateId ? years?.data?.register_contest : null}
        />
      )}
    </section>
  );
}
