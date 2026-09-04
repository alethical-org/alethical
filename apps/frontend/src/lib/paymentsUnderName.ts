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
 *   (rule 12). There is no total, no subtotal, no average and no largest-payment
 *   figure anywhere on this page — only each row's own amount.
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
} from './committeeMoney';
import { formatDay, formatMoney } from './legislatorCampaignMoney';
import { formatCount } from './moneyLanding';

/**
 * The 3 roles this page answers for. They are the server's own `role` values,
 * verbatim, and they are exactly the 3 the name search emits on its rows, so a
 * result row opens its payments without translating anything.
 *
 * The server serves a 4th, `employer` — payments whose donor typed this string in
 * the employer box. Nothing links to it and this page does not accept it: that
 * column is free text holding statuses and occupations as much as employers (its
 * commonest values are "Not Employed" and "Retired"), so it needs wording of its
 * own that says it is never a company's giving, and no surface asks for it yet.
 */
export const PAYMENT_NAME_ROLES = ['contributor', 'vendor', 'independent_vendor'] as const;

export type PaymentNameRole = (typeof PAYMENT_NAME_ROLES)[number];

/** The role out of an address, or null when it is one we do not serve. A role we
 *  do not answer for is a page that does not exist, never a silent fallback to a
 *  different question. */
export function paymentNameRole(value: string | null | undefined): PaymentNameRole | null {
  return PAYMENT_NAME_ROLES.includes(value as PaymentNameRole) ? (value as PaymentNameRole) : null;
}

// --- The page's own wording ---------------------------------------------------

const EYEBROWS: Record<PaymentNameRole, string> = {
  contributor: 'GAVE',
  vendor: 'GOT PAID',
  independent_vendor: 'PAID BY INDEPENDENT SPENDING',
};

export function paymentsUnderNameEyebrow(role: PaymentNameRole): string {
  return EYEBROWS[role];
}

/**
 * The heading. The spelling is quoted and the words in front of it say what the
 * page is, so neither a reader nor a screen reader can take the page for a
 * profile of whoever or whatever carries that name — the same discipline the
 * search page's own heading follows.
 */
export function paymentsUnderNameHeading(name: string, role: PaymentNameRole): string {
  const quoted = `“${name}”`;
  if (role === 'contributor') return `Money given under the name ${quoted}`;
  if (role === 'vendor') return `Money paid under the name ${quoted}`;
  return `Independent spending paid under the name ${quoted}`;
}

/**
 * The sentence under the heading. Three things it has to carry, because a reader
 * who is not told will infer, and every inference available here is wrong: the
 * match is exact, other spellings are elsewhere, and a name is all this is.
 */
export function paymentsUnderNameStandfirst(role: PaymentNameRole): string {
  const side = role === 'contributor' ? 'gave' : 'got paid';
  const what =
    role === 'independent_vendor'
      ? 'Every independent-spending payment filed under this name'
      : 'Every payment filed under this name';
  return (
    `${what}, exactly as it was spelled. Spellings vary between filings, so this may not be ` +
    `everything — and a name is all this is: nothing here says who or what ${side}.`
  );
}

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
  return checkedOn ? `${ALL_YEARS_LABEL} · files last copied ${checkedOn}` : ALL_YEARS_LABEL;
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
export function paymentsShowingLine(shown: number, committees: number, hasMore: boolean): string {
  if (hasMore) {
    return `Showing the first ${formatCount(shown)} ${shown === 1 ? 'payment' : 'payments'}, newest first`;
  }
  const payments = `${formatCount(shown)} ${shown === 1 ? 'payment' : 'payments'}`;
  const filers = `${formatCount(committees)} ${committees === 1 ? 'committee' : 'committees'}`;
  return `${payments}, from ${filers}`;
}

/** What the rows are ordered by, said where a reader can see it. The server
 *  serves this order and no other on a name-keyed lookup. */
export const ORDERED_NEWEST_FIRST = 'NEWEST FIRST';

/**
 * How many rows one request asks for. 250 is the server's own maximum for a page
 * of payments, so one press of the cap button is one request.
 */
export const PAYMENTS_UNDER_NAME_PAGE_SIZE = 250;

/** More rows are filed than we loaded. The cap is ours, and the card says so in
 *  those words — and never how many are left, which we are not told. */
export const CAP_HEADING = 'THIS PAGE IS CAPPED';

export const CAP_NOTE =
  'We load 250 at a time, newest first — the cap is ours, not the filings’. The reports ' +
  'these payments come from list every one of them, and they are public.';

export const CAP_NEXT_LABEL = 'Show more payments';

/**
 * The note under the list. It carries the 2 things a reader would otherwise
 * guess, and the first of them is the acceptance criterion this whole page turns
 * on: there is no total, and the reason is the filing calendars.
 */
export const LIST_NOTE =
  'Every row is one committee’s own filing, and it opens that committee’s page where our ' +
  'records hold that committee as a filer. There is no total: these payments come from ' +
  'committees on different filing calendars, so adding them would set one period against ' +
  'another. Whether the same business is behind 2 spellings is a question the filings do ' +
  'not answer, so we do not merge them.';

/** Nothing carries this spelling. A fact about the spelling and our records, and
 *  never about anybody's giving — which is why it names neither a person nor a
 *  reason. */
export function nothingFiledTitle(name: string): string {
  return `Nothing is filed under “${name}” as spelled`;
}

export const NOTHING_FILED_WHY =
  'Spellings vary between filings, so a name that does appear in the records may be filed a ' +
  'little differently — try a shorter part of it. We do not offer a nearest match: names ' +
  'here differ from each other by a single character often enough that a guess would put ' +
  'you on the wrong one.';

export const SEARCH_ANOTHER_NAME = 'Search another name';

/** Our copy of that download did not answer. Never "nothing is filed": that would
 *  be a claim we did not establish. */
export const RECORDS_UNAVAILABLE_TITLE = 'We could not read this part of our records just now';

export const RECORDS_UNAVAILABLE_WHY =
  'Our copy of Minnesota’s file behind this list did not answer, so an empty page here is ' +
  'not a statement that nothing is filed under that name. This is a gap on our side. Try ' +
  'again in a moment.';

export const LOAD_ERROR =
  'We couldn’t load these payments just now. This is a problem on our side and says nothing ' +
  'about anyone’s giving. Please try again in a moment.';

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
      parts.push(`${payment.receiptType} — reported on its own schedule, not a donation`);
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

/**
 * How many committees the loaded rows come from, counted by registration number
 * where a row carries one and by the filed name where it does not. Only ever
 * printed when nothing is held back, so it is a count of what we hold rather than
 * a claim about how many committees filed under this name.
 */
export function committeesInRows(payments: readonly PaymentUnderName[]): number {
  const seen = new Set<string>();
  for (const payment of payments) {
    const key = payment.filerRegistrationNumber ?? payment.filerName;
    if (key) seen.add(key);
  }
  return seen.size;
}
