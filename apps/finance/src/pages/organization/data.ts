import { campaignMoneyHistoryYears } from '@alethical/shared/campaignMoneyYears';
import {
  committeeEyebrow,
  isInKind,
  UNNAMED_PAYMENT_PARTY,
} from '@alethical/shared/committeeMoneyShared';
import { formatDay, formatMoney } from '@alethical/shared/moneyFormat';
import { centralDateLabel } from '@alethical/shared/moneyLanding';
import { PAYMENT_FILE_LABELS, paymentFileCopyLine } from '@alethical/shared/paymentCopyDates';

import { apiPath } from '../../api/read';
import { withFrom } from '../../returnContext';
import { hrefFor, isBuilt } from '../../routes';
import type { Evidence } from '../../ui/controls';
import { AMOUNT_MISSING, DATE_MISSING, madeKind, sumAmounts, tabOfKind } from '../committee/data';
import type { MadePayment } from '../committee/types';
import type {
  CommitteeRegister,
  GivenPayment,
  Identity,
  IdentityConfirmation,
  NamePage,
  PaidPayment,
  Principal,
  RecordsListing,
} from './types';
import type { Get, Loader } from './useLoad';

export const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
/** A group total with a missing amount (Organization drawing, finance-data INCOMPLETE). */
export const INCOMPLETE = 'Incomplete: a payment amount is missing';
export const EMPTY_SECTION = 'No confirmed records are held for this section';
export const SECTION_FAILED = 'We couldn’t load these records. This is a problem on our side.';
export const PRINCIPAL_NOT_HELD =
  'This principal is not in the current copy of the lobbying records';
/** The server's largest page of payments (MAX_PAYMENTS in campaign_finance_payments.py). */
const PAGE = 250;
/** Printed-name kinds whose records are this organization's own money. A donor's
 * employer (`employer_name`) is never the organization's giving (build notes Round 20). */
export type GivingKind = 'donor_name';
export type ReceivedKind = 'payee_name' | 'independent_payee_name';
type SpellingKind = GivingKind | ReceivedKind;

const ROLE: Record<SpellingKind, string> = {
  donor_name: 'contributor',
  payee_name: 'vendor',
  independent_payee_name: 'independent_vendor',
};
const DATE_FIELD: Record<SpellingKind, string> = {
  donor_name: 'receipt_date',
  payee_name: 'transaction_date',
  independent_payee_name: 'transaction_date',
};

/** The words for each kind of saved evidence a confirmation can cite. */
const EVIDENCE_SOURCES: Record<string, string> = {
  cf_contribution_row: PAYMENT_FILE_LABELS.contributions,
  cf_expenditure_row: PAYMENT_FILE_LABELS.expenditures,
  cf_independent_expenditure_row: PAYMENT_FILE_LABELS.independentExpenditures,
  cf_filer: 'Committee registrations',
  lobbyist_row: 'Lobbyist registration list',
  lobbying_expenditure_row: 'Lobbying spending reports',
  official_page: 'Official page',
};

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Confirmations ----------------------------------------------------------------

/** Only standing confirmations count; a withdrawn one leaves every page that read it. */
export function activeConfirmations(identity: Identity): IdentityConfirmation[] {
  return (identity.confirmations ?? []).filter((item) => item.status === 'confirmed');
}

export function confirmationsOf(identity: Identity, kind: string): IdentityConfirmation[] {
  return activeConfirmations(identity).filter((item) => item.record_kind === kind);
}

export interface Spelling<K extends SpellingKind = SpellingKind> {
  kind: K;
  key: string;
}

/** Each confirmed printed spelling once, whatever number of confirmations cover it. */
export function spellings<K extends SpellingKind>(
  identity: Identity,
  kinds: readonly K[],
): Spelling<K>[] {
  const seen = new Map<string, Spelling<K>>();
  for (const item of activeConfirmations(identity)) {
    if (!(kinds as readonly string[]).includes(item.record_kind)) continue;
    seen.set(`${item.record_kind}|${item.record_key}`, {
      kind: item.record_kind as K,
      key: item.record_key,
    });
  }
  return [...seen.values()].sort((a, b) =>
    a.kind === b.kind ? a.key.localeCompare(b.key) : a.kind.localeCompare(b.kind),
  );
}

// --- Loading the confirmed records ----------------------------------------------------

export interface SpellingLoad<T> {
  kind: SpellingKind;
  key: string;
  payments: T[];
  linkable: string[];
  sourceUrl: string | null;
  fetchedAt: string | null;
}

function sameAmount(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a == b;
  return sumAmounts([a]) === sumAmounts([b]);
}

/**
 * The records under 1 spelling that a confirmation holds for this identity, and no
 * others: the identity routes name each confirmed record by its row in the Board's
 * current file, and the payments read under the same spelling supplies the
 * committee and the filed type. Every confirmed row must be found with the same
 * date and amount, or the file moved between the 2 reads and the load fails.
 */
export async function loadSpelling<T extends GivenPayment | PaidPayment>(
  get: Get,
  identityId: string,
  spelling: Spelling,
): Promise<SpellingLoad<T> | null> {
  const listing = await get<RecordsListing>(
    apiPath(['finance', 'identities', 'records'], {
      record_kind: spelling.kind,
      record_key: spelling.key,
      page_size: 500,
    }),
  );
  if (listing.state !== 'ok') return null;
  const wanted = new Map<number, Record<string, string | null>>();
  const fingerprints = [...(listing.data.fingerprints ?? [])];
  for (let page = 2; page <= (listing.data.pages ?? 1); page += 1) {
    if (!listing.data.snapshot_id) return null;
    const next = await get<RecordsListing>(
      apiPath(['finance', 'identities', 'records'], {
        record_kind: spelling.kind,
        record_key: spelling.key,
        page_size: 500,
        page,
        snapshot_id: listing.data.snapshot_id,
      }),
    );
    if (
      next.state !== 'ok' ||
      next.data.snapshot_id !== listing.data.snapshot_id ||
      next.data.page !== page
    )
      return null;
    fingerprints.push(...next.data.fingerprints);
  }
  for (const print of fingerprints) {
    if (print.confirmation?.identity.id !== identityId) continue;
    for (const row of print.rows) wanted.set(row.row_number, print.fields ?? {});
  }
  const empty: SpellingLoad<T> = {
    kind: spelling.kind,
    key: spelling.key,
    payments: [],
    linkable: [],
    sourceUrl: null,
    fetchedAt: null,
  };
  if (wanted.size === 0) return empty;

  const pages: NamePage<T>[] = [];
  for (let offset = 0; ;) {
    const answer = await get<NamePage<T>>(
      apiPath(['campaign-finance', 'payments-under-name'], {
        name: spelling.key,
        role: ROLE[spelling.kind],
        limit: PAGE,
        offset,
      }),
    );
    if (answer.state !== 'ok' || answer.data.state !== 'reported') return null;
    // A page from another release would mix 2 copies of the file.
    if (pages.length > 0 && answer.data.release_id !== pages[0].release_id) return null;
    pages.push(answer.data);
    if (!answer.data.page.has_more) break;
    if (answer.data.payments.length === 0) return null;
    offset += answer.data.payments.length;
  }

  const dateField = DATE_FIELD[spelling.kind];
  const payments: T[] = [];
  for (const payment of pages.flatMap((page) => page.payments)) {
    const fields = wanted.get(payment.record_number);
    if (!fields) continue;
    const served = 'received_on' in payment ? payment.received_on : payment.paid_on;
    if ((fields[dateField] ?? null) !== (served ?? null)) return null;
    if (!sameAmount(fields.amount, payment.amount)) return null;
    payments.push(payment);
  }
  if (payments.length !== wanted.size) return null;
  return {
    ...empty,
    payments,
    linkable: [...new Set(pages.flatMap((page) => page.linkable_registration_numbers ?? []))],
    sourceUrl: pages[0].source_url,
    fetchedAt: pages[0].fetched_at,
  };
}

export function loadSpellings<T extends GivenPayment | PaidPayment>(
  identityId: string,
  list: readonly Spelling[],
): Loader<SpellingLoad<T>[]> {
  return async (get) => {
    const loads = await Promise.all(list.map((item) => loadSpelling<T>(get, identityId, item)));
    return loads.some((load) => load === null) ? null : (loads as SpellingLoad<T>[]);
  };
}

export interface Held<T> {
  key: string;
  /** Null when the server holds no such record. */
  record: T | null;
}

/** Each confirmed principal's lobbying record, read by its entity id. */
export function loadPrincipals(keys: readonly string[]): Loader<Held<Principal>[]> {
  return async (get) => {
    const answers = await Promise.all(
      keys.map(async (key): Promise<Held<Principal> | null> => {
        if (!/^\d+$/.test(key)) return { key, record: null };
        const answer = await get<Principal>(apiPath(['lobbying', 'principals', key]));
        if (answer.state === 'failed') return null;
        return { key, record: answer.state === 'ok' ? answer.data : null };
      }),
    );
    return answers.some((item) => item === null) ? null : (answers as Held<Principal>[]);
  };
}

/** Each confirmed committee's register entry, by registration number. */
export function loadCommittees(keys: readonly string[]): Loader<Held<CommitteeRegister>[]> {
  const year = campaignMoneyHistoryYears()[0];
  return async (get) => {
    const answers = await Promise.all(
      keys.map(async (key): Promise<Held<CommitteeRegister> | null> => {
        const answer = await get<CommitteeRegister>(
          apiPath(['committees', key, 'finance'], { year, include_confirmation: 'false' }),
        );
        if (answer.state === 'failed') return null;
        return { key, record: answer.state === 'ok' ? answer.data : null };
      }),
    );
    return answers.some((item) => item === null) ? null : (answers as Held<CommitteeRegister>[]);
  };
}

// --- Rows ------------------------------------------------------------------------

export interface RowLink {
  label: string;
  href: string;
}

export interface ProfileRow {
  key: string;
  title: string;
  note: string;
  /** The figure as printed, or '' for a row with no amount. */
  amount: string;
  missing: boolean;
  links: RowLink[];
  evidence: Evidence | null;
  /** For ordering: the row's latest ISO date. */
  latest: string | null;
}

/** "Jan 9, 2025 to Jun 3, 2026", 1 date when they agree, null with none. */
export function periodOf(dates: ReadonlyArray<string | null | undefined>): string | null {
  const known = dates.filter((day): day is string => Boolean(day && formatDay(day))).sort();
  if (known.length === 0) return null;
  const first = formatDay(known[0])!;
  const last = formatDay(known[known.length - 1])!;
  return first === last ? first : `${first} to ${last}`;
}

function paymentEvidence(
  title: string,
  file: string,
  fetchedAt: string | null,
  recordNumbers: number[],
  sourceUrl: string | null,
): Evidence {
  return {
    title,
    authority: BOARD,
    rows: [
      { label: 'Saved source', value: file },
      ...(fetchedAt
        ? [{ label: 'Source version', value: `Copy of ${centralDateLabel(fetchedAt)}` }]
        : []),
      {
        label: recordNumbers.length === 1 ? 'Record number' : 'Record numbers',
        value: recordNumbers.join(', '),
      },
    ],
    quote: 'No saved source excerpt is held for this record',
    quoteLabel: 'SOURCE TEXT',
    checked: 'Not checked',
    ...(sourceUrl ? { sourceHref: sourceUrl, sourceLabel: 'View source' } : {}),
  };
}

/** The evidence a confirmation names: the saved row or official page it quotes. */
export function confirmationEvidence(title: string, item: IdentityConfirmation): Evidence {
  const evidence = item.evidence;
  const source = evidence ? (EVIDENCE_SOURCES[evidence.source] ?? evidence.source) : null;
  const rows = [
    ...(source ? [{ label: 'Saved source', value: source }] : []),
    ...(evidence?.locator
      ? [
          {
            label: evidence.source === 'cf_filer' ? 'Registration' : 'Row',
            value: evidence.locator,
          },
        ]
      : []),
    { label: 'Evidence reference', value: item.id },
  ];
  const checked = item.checked_at ? centralDateLabel(item.checked_at) : null;
  return {
    title,
    authority: BOARD,
    rows,
    ...(evidence?.quote ? { quote: evidence.quote, quoteLabel: 'SOURCE TEXT' } : {}),
    checked: checked ? `Checked on ${checked}` : 'Not checked',
    ...(evidence?.url ? { sourceHref: evidence.url, sourceLabel: 'View source' } : {}),
  };
}

function committeeHref(
  registration: string | null | undefined,
  linkable: ReadonlySet<string>,
  query: Record<string, string>,
  here: string,
): RowLink | null {
  if (!registration || !linkable.has(registration) || !isBuilt('committee')) return null;
  return {
    label: 'Open committee',
    href: withFrom(hrefFor('committee', { id: registration }, query), here),
  };
}

/** Political giving: each contribution this organization made, 1 row each, never added. */
export function givingRows(loads: ReadonlyArray<SpellingLoad<GivenPayment>>, here: string) {
  const rows: ProfileRow[] = [];
  for (const load of loads) {
    const linkable = new Set(load.linkable);
    for (const payment of load.payments) {
      const committee =
        payment.recipient_name ||
        (payment.recipient_registration_number
          ? `Registration ${payment.recipient_registration_number}`
          : UNNAMED_PAYMENT_PARTY);
      const amount = formatMoney(payment.amount);
      const link = committeeHref(
        payment.recipient_registration_number,
        linkable,
        {
          ...(payment.year ? { year: String(payment.year) } : {}),
          tab: tabOfKind(payment.contributor_type),
        },
        here,
      );
      rows.push({
        key: `give|${load.key}|${payment.record_number}`,
        title: committee,
        note: [
          formatDay(payment.received_on) ?? DATE_MISSING,
          payment.receipt_type,
          isInKind(payment.in_kind) ? 'In-kind' : null,
        ]
          .filter(Boolean)
          .join(' · '),
        amount: amount ?? AMOUNT_MISSING,
        missing: amount === null,
        links: link ? [link] : [],
        evidence: paymentEvidence(
          `${payment.contributor ?? load.key} to ${committee}`,
          PAYMENT_FILE_LABELS.contributions,
          load.fetchedAt,
          [payment.record_number],
          load.sourceUrl,
        ),
        latest: payment.received_on,
      });
    }
  }
  return newestFirst(rows);
}

function newestFirst(rows: ProfileRow[]): ProfileRow[] {
  return rows.sort((a, b) => {
    if (a.latest === b.latest) return a.title.localeCompare(b.title);
    if (!a.latest) return 1;
    if (!b.latest) return -1;
    return a.latest < b.latest ? 1 : -1;
  });
}

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/**
 * Payments received, grouped by paying committee, file and printed spelling. A
 * group's total adds only that committee's payments to that spelling in that file,
 * with its period; refunds keep their filed sign; a missing amount withholds it.
 */
export function receivedRows(loads: ReadonlyArray<SpellingLoad<PaidPayment>>, here: string) {
  const rows: ProfileRow[] = [];
  for (const load of loads) {
    const independent = load.kind === 'independent_payee_name';
    const linkable = new Set(load.linkable);
    const groups = new Map<string, PaidPayment[]>();
    for (const payment of load.payments) {
      const payer = independent
        ? payment.spender_registration_number
        : payment.committee_registration_number;
      const name = independent ? payment.spender : payment.committee_name;
      const key = `${payer ?? ''}|${payer ? '' : (name ?? '')}`;
      groups.set(key, [...(groups.get(key) ?? []), payment]);
    }
    for (const [key, payments] of groups) {
      const first = payments[0];
      const registration = independent
        ? first.spender_registration_number
        : first.committee_registration_number;
      const payer =
        (independent ? first.spender : first.committee_name) ||
        (registration ? `Registration ${registration}` : UNNAMED_PAYMENT_PARTY);
      const total = sumAmounts(payments.map((payment) => payment.amount));
      const types = [
        ...new Set(
          payments
            .map((payment) =>
              independent
                ? (payment.purpose ?? payment.expenditure_type ?? '')
                : madeKind(payment as unknown as MadePayment),
            )
            .filter(Boolean),
        ),
      ];
      const stances = [
        ...new Set(payments.map((payment) => payment.stance).filter(Boolean) as string[]),
      ];
      const dates = payments.map((payment) => payment.paid_on);
      const period = periodOf(dates);
      const years = payments.map((payment) => payment.year ?? 0);
      const year = Math.max(...years);
      const open = committeeHref(
        registration,
        linkable,
        {
          tab: independent ? 'independent' : 'expenditures',
          ...(year > 0 ? { year: String(year) } : {}),
        },
        here,
      );
      const links: RowLink[] = open ? [open] : [];
      if (isBuilt('payments-under-name')) {
        links.push({
          label: 'View payments',
          href: withFrom(
            hrefFor('payments-under-name', { query: load.key }, { role: 'payee' }),
            here,
          ),
        });
      }
      const amount = total === null ? null : formatMoney(total);
      rows.push({
        key: `recd|${load.kind}|${load.key}|${key}`,
        title: payer,
        note: [
          count(payments.length, 'payment record', 'payment records'),
          period,
          types.join('; ') || null,
          stances.length > 0 ? `Position as filed: ${stances.join('; ')}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        amount: amount ?? INCOMPLETE,
        missing: amount === null,
        links,
        evidence: paymentEvidence(
          `${payer} to ${load.key}`,
          independent
            ? PAYMENT_FILE_LABELS.independentExpenditures
            : PAYMENT_FILE_LABELS.expenditures,
          load.fetchedAt,
          payments.map((payment) => payment.record_number),
          load.sourceUrl,
        ),
        latest: [...dates].filter(Boolean).sort().pop() ?? null,
      });
    }
  }
  return newestFirst(rows);
}

/** The year a principal's latest reported spending covers, with that year's total. */
function latestSpending(principal: Principal): { year: number; total: string | null } | null {
  if (principal.spending?.state !== 'reported') return null;
  const rows = [...(principal.spending.rows ?? [])].sort((a, b) => b.year - a.year);
  const row = rows.find((item) => item.year === principal.latest_reported_year) ?? rows[0] ?? null;
  return row ? { year: row.year, total: row.total_spent } : null;
}

/** Lobbying: the principal record a confirmation names, with its lobbyists as listed. */
export function lobbyingRow(
  item: IdentityConfirmation,
  principal: Principal | null,
  fallbackName: string,
  here: string,
): ProfileRow {
  const id = principal ? String(principal.entity_id) : item.record_key;
  const spending = principal ? latestSpending(principal) : null;
  const lobbyists = principal?.lobbyists?.state === 'reported' ? principal.lobbyists : null;
  const names = (lobbyists?.rows ?? []).map((row) => row.name).filter(Boolean);
  const listed = lobbyists
    ? `${count(lobbyists.total ?? lobbyists.rows.length, 'lobbyist', 'lobbyists')} listed${
        names.length > 0 ? `: ${names.join('; ')}` : ''
      }`
    : null;
  const amount = spending ? formatMoney(spending.total) : null;
  return {
    key: `lob|${item.id}`,
    title: `Principal · Entity ID ${id}`,
    note: principal
      ? [spending ? `Reported spending ${spending.year}` : null, listed].filter(Boolean).join(' · ')
      : PRINCIPAL_NOT_HELD,
    amount: principal ? (amount ?? 'Not reported') : '',
    missing: principal !== null && amount === null,
    links:
      principal && isBuilt('principal')
        ? [
            {
              label: 'Open lobbying record',
              href: withFrom(hrefFor('principal', { id }), here),
            },
          ]
        : [],
    evidence: confirmationEvidence(principal?.name || fallbackName, item),
    latest: null,
  };
}

/** Related committees and funds: separate filers with a recorded relationship. */
export function relatedRow(
  item: IdentityConfirmation,
  committee: CommitteeRegister | null,
  here: string,
): ProfileRow {
  const registration = item.record_key;
  const name = committee?.register?.name || committee?.committee_name || null;
  const kind = committee
    ? committeeEyebrow(committee.register?.kind, committee.entity_sub_type)
    : null;
  const title = name ?? `Registration ${registration}`;
  return {
    key: `rel|${item.id}`,
    title,
    note: [kind, name ? `Registration ${registration}` : null, item.relation]
      .filter(Boolean)
      .join(' · '),
    amount: '',
    missing: false,
    links:
      committee && isBuilt('committee')
        ? [
            {
              label: 'Open committee',
              href: withFrom(hrefFor('committee', { id: registration }), here),
            },
          ]
        : [],
    evidence: confirmationEvidence(title, item),
    latest: null,
  };
}

/** The roles the held records support, in the drawing's words; vendor is never inferred (D22). */
export function rolesOf(lobbying: boolean, giving: boolean, received: boolean): string[] {
  return [
    ...(lobbying ? ['Lobbying principal'] : []),
    ...(giving ? ['Political donor'] : []),
    ...(received ? ['Payment recipient'] : []),
  ];
}

type CopyKey = keyof typeof PAYMENT_FILE_LABELS;

/** 1 line when every file used shares its copy day, else each file with its own. */
export function paymentCopyItems(copies: Partial<Record<CopyKey, string | null>>): string[] {
  const keys = Object.keys(copies) as CopyKey[];
  if (keys.length === 0) return [];
  const days = keys.map((key) => (copies[key] ? centralDateLabel(copies[key]!) : null));
  if (days[0] && days.every((day) => day === days[0])) {
    return [`Campaign payment files copied ${days[0]}`];
  }
  return keys.map((key) => paymentFileCopyLine(key, copies[key]));
}
