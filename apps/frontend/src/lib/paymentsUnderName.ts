/**
 * What the payments-under-a-name page at /money/payments is allowed to say
 * ("Money lists web.dc.html" screen D; issue #1780;
 * `.claude/rules/grounded-answers.md` rules 3, 5, 11 and 12).
 *
 * Framework-free, in the style of lib/moneyNameSearch.ts, so every sentence and
 * every row is decided in one place a test can pin.
 *
 * The rules doing the most work, each because the alternative is a false claim
 * rather than because it is tidier:
 *
 * - **A string, never an entity.** The name is matched character for character
 *   and is the whole of the key: a person, an employer and a vendor carry no
 *   identifier in Minnesota's data
 *   (`docs/architecture/campaign-finance-system-design.md` §5). The release holds
 *   "Messinger, Alida", "Messinger, Alida R" and "Messinger, Alida Rockefelle" as
 *   3 separate strings, and the same file holds "Messinger, William Frye" beside
 *   "Messinger, Wiiiam Frey", so any rule loose enough to join the first 3 joins
 *   those 2 as well. Every heading here quotes the spelling and no sentence says
 *   this is everything a person or business received.
 * - **No total across committees, in any form.** The rows come from committees on
 *   different filing calendars, so a sum would set one period against another
 *   (rule 12). Only payments filed by the same numbered filer in the same
 *   filing year earn a subtotal, and only when that group has at least 2 rows.
 *   There is no page total, year total, average or largest-payment figure.
 * - **The 3 roles are 3 answers, never 1.** 491 rows of the independent-spending
 *   file share a spender, name, amount and date with an ordinary expenditure row,
 *   and whether that is one payment filed twice or 2 that coincide is not
 *   established. So a page answers for exactly one role and never offers to add
 *   another to it.
 * - **A capped list says only what it is showing.** The server serves no count on
 *   a name-keyed lookup, so this page never prints "of N": it says how many rows
 *   are on it and that more are filed (rule 11).
 */

import {
  isInKind,
  registerKindFromEntityType,
  registerKindLabel,
  UNNAMED_PAYMENT_PARTY,
} from './committeeMoneyShared';
import { formatDay, formatMoney } from './moneyFormat';
import { formatCount } from './moneyLanding';
import { MONEY_LIST_COVERAGE } from './moneyListCopy';
import {
  CONTRIBUTION_RECORD_LIMIT,
  FILE_COPY_MEANING,
  MATCHED_NAME_LIMIT,
  OFFICIAL_TOTAL_RECORD_LIMIT,
} from './moneyRecordTrust';
import type { PaymentNameRole } from './paymentNameRoute';
export {
  PAYMENT_NAME_ROLES,
  PAYMENTS_UNDER_NAME_PAGE_SIZE,
  paymentNameRole,
  paymentUnderName,
  paymentsUnderNameHeading,
  type PaymentNameRole,
} from './paymentNameRoute';

// --- The page's own wording ---------------------------------------------------

/**
 * The sentence under the heading. Three things it has to carry, because a reader
 * who is not told will infer, and every inference available here is wrong: the
 * match is exact, other spellings are elsewhere, and a name is all this is.
 */
export function paymentsUnderNameStandfirst(role: PaymentNameRole): string {
  const what =
    role === 'independent_vendor'
      ? 'Independent-spending payment records filed under this name'
      : role === 'contributor'
        ? 'Incoming payment records filed under this name'
        : 'Ordinary spending records filed under this name';
  return `${what}, exactly as it was spelled. ${MATCHED_NAME_LIMIT}`;
}

export const RECEIVED_PAYMENT_TYPES_NOTE =
  'The incoming payment file includes contributions, loans, and other receipt types received by committees. Each row that is not a contribution is labelled with its filed receipt type. Contribution reporting limits apply only to contribution rows.';

/**
 * The independent-spending page's extra sentence. The 2 vendor files overlap and
 * are never added, so the page that shows one says out loud that the other exists
 * and is a separate answer.
 */
export const INDEPENDENT_IS_A_SEPARATE_FILING =
  'This is the independent-spending file, and it is never added to the ordinary ' +
  'expenditures file: 491 rows share a spender, name, amount and date with an expenditure ' +
  'row, and whether that is one payment filed twice or 2 that coincide is not established.';

/** The label over the freshness date. The day we copied the Board's files, never
 *  the period any money covers (rule 12). */
export const ALL_YEARS_LABEL = 'All years we hold';

export function filesLastCopiedLine(checkedOn: string | null): string {
  return checkedOn
    ? `${ALL_YEARS_LABEL} · files last copied ${checkedOn}. ${FILE_COPY_MEANING}`
    : ALL_YEARS_LABEL;
}

/**
 * The line above the rows. Two shapes, and the difference between them is the
 * whole of rule 11 on this page.
 *
 * Nothing held back: the count of rows is a count of every row filed under this
 * spelling in the release we read, and the committees behind them can be counted
 * too, because we are holding all of them.
 *
 * Something held back: the server serves no total on a name-keyed lookup, so the
 * page says how many it is showing and nothing about how many exist. No "of N",
 * and no count of committees either — a committee count over a capped list would
 * read as the number of committees that filed.
 */
export function paymentsShowingLine(
  shown: number,
  committees: number | null,
  hasMore: boolean,
  role: PaymentNameRole = 'vendor',
): string {
  if (hasMore) {
    return `Showing the first ${formatCount(shown)} payment ${shown === 1 ? 'record' : 'records'}, newest first`;
  }
  const payments = `${formatCount(shown)} payment ${shown === 1 ? 'record' : 'records'}`;
  if (committees === null) return payments;
  const unit = role === 'independent_vendor' ? 'spender' : 'committee';
  const filers = `${formatCount(committees)} ${unit}${committees === 1 ? '' : 's'}`;
  return `${payments} ${role === 'contributor' ? 'to' : 'from'} ${filers}`;
}

/** What the rows are ordered by, said where a reader can see it. The server
 *  serves this order and no other on a name-keyed lookup. */
export const ORDERED_NEWEST_FIRST = 'NEWEST FIRST';

/** More rows are filed than we loaded. The cap is ours, and the card says so in
 *  those words — and never how many are left, which we are not told. */
export const CAP_HEADING = 'THIS PAGE IS CAPPED';

export const CAP_NOTE = 'We load up to 250 payment records at a time. More records may remain.';

export const CAP_NEXT_LABEL = 'Show more payments';

/**
 * The note under the list. It carries the 2 things a reader would otherwise
 * guess, and the first of them is the acceptance criterion this whole page turns
 * on: there is no total, and the reason is the filing calendars.
 */
const LIST_NOTE_BASE =
  'Payment records are grouped by filing year and committee. Any subtotal covers only the records ' +
  'shown for that committee in that filing year. Committees report on different schedules, ' +
  'so we do not add amounts across committees or years.';

export function paymentsUnderNameListNote(role: PaymentNameRole): string {
  return role === 'contributor'
    ? `${LIST_NOTE_BASE} ${CONTRIBUTION_RECORD_LIMIT} ${OFFICIAL_TOTAL_RECORD_LIMIT}`
    : LIST_NOTE_BASE;
}

/** Compatibility for callers that explicitly read received payments. */
export const LIST_NOTE = paymentsUnderNameListNote('contributor');

export function paymentsUnderNameCoverage(role: PaymentNameRole): readonly string[] {
  return role === 'contributor'
    ? MONEY_LIST_COVERAGE
    : [MONEY_LIST_COVERAGE[0], MONEY_LIST_COVERAGE[1]];
}

/** Nothing carries this spelling. A fact about the spelling and our records, and
 *  never about anybody's giving — which is why it names neither a person nor a
 *  reason. */
export function nothingFiledTitle(name: string): string {
  return `No matching payment records under “${name}”`;
}

export function nothingFiledWhy(role: PaymentNameRole): string {
  const records = {
    contributor: 'incoming payment',
    vendor: 'ordinary spending',
    independent_vendor: 'independent-spending',
  }[role];
  return `Our copy of the ${records} records contains no rows under this exact spelling. This does not mean there was no giving or spending.`;
}

/** Compatibility for callers that explicitly read received payments. */
export const NOTHING_FILED_WHY = nothingFiledWhy('contributor');

export const SEARCH_ANOTHER_NAME = 'Search another name';

/** Our copy of that download did not answer. Never "nothing is filed": that would
 *  be a claim we did not establish. */
export const RECORDS_UNAVAILABLE_TITLE = 'We could not read this part of our records just now';

export const RECORDS_UNAVAILABLE_WHY =
  'This is a problem with our copy of the records. It does not mean nothing was filed under this name.';

export const LOAD_ERROR = 'We couldn’t load these payments just now';
export const LOAD_ERROR_WHY = 'This is a problem on our side. Please try again.';
export const LOAD_MORE_ERROR =
  'We couldn’t load more payments. The payments already loaded are still shown.';
export const REFRESH_ERROR =
  'We couldn’t refresh these payments. The payments already loaded are still shown.';

export const BACK_TO_RESULTS = 'Search results';

// --- Rows ---------------------------------------------------------------------

/** What one row shows. The name is always the committee whose filing carries the
 *  row, never the searched name — the searched name is the page. */
export interface PaymentUnderNameRow {
  /** The committee that filed this row, in the filing's own words. */
  name: string;
  meta: string;
  /** "Jul 20, 2026", or null where the filing carries no date. */
  date: string | null;
  /** "$1,250.00", or null where the filing carries no readable amount. */
  amount: string | null;
  inKind: boolean;
  /** Set only where this release holds that number as a filer, so the row opens a
   *  page that exists. */
  linkNumber: string | null;
  linkName: string | null;
}

/** One payment as the 3 downloads serve it, already flattened by the API client
 *  to the fields this page draws. */
export interface PaymentUnderName {
  /** The filing year, never inferred from the payment date. */
  year?: number | null;
  employer?: string | null;
  /** Held filer register kind, served for the two payee roles. */
  filerKind?: string | null;
  recordNumber?: number | null;
  /** The committee that filed the row: the recipient of a donation, the committee
   *  that made an expenditure, or the spender behind independent spending. */
  filerName: string | null;
  filerRegistrationNumber: string | null;
  /** The Board's entity-type code for the recipient, on a contributions row only. */
  filerEntityType: string | null;
  /** The schedule a contributions row was filed on ("Contribution", "Loan", …). */
  receiptType: string | null;
  /** An expenditures or independent row's own purpose, in the filing's words. */
  purpose: string | null;
  expenditureType: string | null;
  /** Independent spending only: who it was about, and whether it was for or
   *  against them, both as the filing records them. */
  affectedCommitteeName: string | null;
  stance: string | null;
  amount: string | null;
  paidOn: string | null;
  inKind: string | null;
}

/**
 * The grey line under a filer's name. Each role prints the filing's own words for
 * what the payment was, and nothing that would read as a judgement about it.
 *
 * A contributions row leads with the kind of committee that received the money,
 * because that is the fact the row adds beyond the name, and follows with the
 * schedule label whenever the money is not a plain donation — a loan listed under
 * "money given" without its label would read as a gift.
 */
export function paymentUnderNameMeta(payment: PaymentUnderName, role: PaymentNameRole): string {
  const parts: string[] = [];
  if (role === 'contributor') {
    const kind = registerKindLabel(registerKindFromEntityType(payment.filerEntityType));
    if (kind) parts.push(kind);
    if (payment.receiptType && payment.receiptType !== 'Contribution') {
      parts.push(nonContributionReceiptLabel(payment.receiptType)!);
    }
    return parts.join(' · ');
  }
  if (role === 'independent_vendor' && payment.affectedCommitteeName) {
    // "For" and "Against" are the filing's own column, and the product already
    // reads them as supporting and opposing (lib/outsideSpending.ts). A row whose
    // filing records neither says so rather than picking one.
    const about = payment.affectedCommitteeName;
    if (payment.stance === 'For') parts.push(`Spent supporting ${about}`);
    else if (payment.stance === 'Against') parts.push(`Spent opposing ${about}`);
    else parts.push(`Spent about ${about}, where the filing does not say which way`);
  }
  if (payment.expenditureType === 'Contribution') {
    parts.push('Money given to another campaign');
  }
  if (payment.purpose) parts.push(payment.purpose);
  return parts.join(' · ');
}

/** One payment as a row, so the line this page draws is decided here rather than
 *  inside the screen. */
export function paymentUnderNameRow(
  payment: PaymentUnderName,
  role: PaymentNameRole,
  linkable: ReadonlySet<string>,
): PaymentUnderNameRow {
  return {
    name: payment.filerName ?? UNNAMED_PAYMENT_PARTY,
    meta: paymentUnderNameMeta(payment, role),
    date: formatDay(payment.paidOn),
    amount: formatMoney(payment.amount),
    inKind: isInKind(payment.inKind),
    linkNumber:
      payment.filerRegistrationNumber && linkable.has(payment.filerRegistrationNumber)
        ? payment.filerRegistrationNumber
        : null,
    linkName: payment.filerName,
  };
}

/** A filer count needs a registration on every row. A spelling cannot identify
 * an unnumbered filer, so any missing registration withholds the whole count. */
export function committeesInRows(payments: readonly PaymentUnderName[]): number | null {
  if (payments.some((payment) => !payment.filerRegistrationNumber)) return null;
  return new Set(payments.map((payment) => payment.filerRegistrationNumber)).size;
}

export const YEAR_MAY_CONTINUE = 'This year may continue below the cap';
export const UNKNOWN_FILING_YEAR = 'Year not given in the filing';

export function filerRegistrationLabel(registration: string): string {
  return `Registration ${registration}`;
}

export function groupPaymentCount(count: number): string {
  return `${formatCount(count)} payment ${count === 1 ? 'record' : 'records'}`;
}

export function nonContributionReceiptLabel(receiptType: string | null): string | null {
  return receiptType && receiptType !== 'Contribution'
    ? `${receiptType} — reported on its own schedule, not a donation`
    : null;
}

export interface PaymentsUnderNameGroup {
  key: string;
  newest: PaymentUnderName;
  payments: readonly PaymentUnderName[];
  /** Computed only inside one numbered filer and one filing year. */
  subtotal: string | null;
}

export interface PaymentsUnderNameYear {
  year: number | null;
  groups: PaymentsUnderNameGroup[];
  paymentCount: number;
  mayContinue: boolean;
}

/** Source amounts have four decimal places. Missing or malformed money withholds
 * this group's subtotal, never treating an unreadable amount as zero. */
function filerYearSubtotal(payments: readonly PaymentUnderName[]): string | null {
  if (payments.length < 2) return null;
  const first = payments[0];
  if (!first.filerRegistrationNumber || first.year == null) return null;
  let units = 0n;
  for (const payment of payments) {
    if (
      payment.filerRegistrationNumber !== first.filerRegistrationNumber ||
      payment.year !== first.year
    )
      return null;
    const match = payment.amount?.match(/^(-?)(\d+)(?:\.(\d{1,4}))?$/);
    if (!match) return null;
    const magnitude = BigInt(match[2]) * 10000n + BigInt((match[3] ?? '').padEnd(4, '0'));
    units += match[1] ? -magnitude : magnitude;
  }
  const magnitude = units < 0n ? -units : units;
  return `${units < 0n ? '-' : ''}${magnitude / 10000n}.${String(magnitude % 10000n).padStart(4, '0')}`;
}

/** Newest filing years first. Stable sorting preserves the server's record-number
 * tie break and every repeated payment. Unknown filers cannot earn a subtotal. */
export function paymentsUnderNameYears(
  payments: readonly PaymentUnderName[],
  hasMore: boolean,
): PaymentsUnderNameYear[] {
  const byYear = new Map<number | null, Map<string, PaymentUnderName[]>>();
  const ordered = [...payments].sort((a, b) => (b.paidOn ?? '').localeCompare(a.paidOn ?? ''));
  for (const [index, payment] of ordered.entries()) {
    const year = payment.year ?? null;
    const groups = byYear.get(year) ?? new Map<string, PaymentUnderName[]>();
    const key = payment.filerRegistrationNumber
      ? `registration:${payment.filerRegistrationNumber}`
      : `unidentified-row:${index}`;
    const group = groups.get(key) ?? [];
    group.push(payment);
    groups.set(key, group);
    byYear.set(year, groups);
  }
  const years = [...byYear.keys()].sort((a, b) => (b ?? -Infinity) - (a ?? -Infinity));
  return years.map((year, index) => {
    const groups = [...byYear.get(year)!.entries()].map(([key, rows]) => ({
      key,
      newest: rows[0],
      payments: rows,
      subtotal: filerYearSubtotal(rows),
    }));
    return {
      year,
      groups,
      paymentCount: groups.reduce((count, group) => count + group.payments.length, 0),
      mayContinue: hasMore && year !== null && index === years.length - 1,
    };
  });
}

export function paymentsUnderNameYearCount(
  year: PaymentsUnderNameYear,
  role: PaymentNameRole,
): string {
  const payments = groupPaymentCount(year.paymentCount);
  if (year.mayContinue) return `${payments} so far`;
  if (year.groups.some((group) => !group.newest.filerRegistrationNumber)) return payments;
  const count = year.groups.length;
  const unit = role === 'independent_vendor' ? 'spender' : 'committee';
  return `${payments} ${role === 'contributor' ? 'to' : 'from'} ${formatCount(count)} ${unit}${count === 1 ? '' : 's'}`;
}

export function paymentsUnderNameFilerKind(
  payment: PaymentUnderName,
  role: PaymentNameRole,
): string | null {
  return registerKindLabel(
    role === 'contributor'
      ? registerKindFromEntityType(payment.filerEntityType)
      : payment.filerKind,
  );
}
