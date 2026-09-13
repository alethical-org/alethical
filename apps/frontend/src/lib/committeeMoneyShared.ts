/** Shared committee labels, record formatting and read keys. Route-only prose stays with its screen. */
import { formatDay, formatMoney, reportedThroughLabel } from './legislatorCampaignMoney';

/** The two Board sub-type codes that mark a ballot-question filer on its own money
 *  rows (data census #1661: 28 `BC` and 6 `BF` filers carry one). The register
 *  itself distinguishes only 3 kinds, so this is the one grounded ballot signal. */
export function isBallotQuestionFiler(entitySubType: string | null | undefined): boolean {
  return entitySubType === 'BC' || entitySubType === 'BF';
}

/** The register's 3 kinds, as served, to the label a page prints. The label is the
 *  register list's own vocabulary — never an invented finer kind. */
const REGISTER_KIND_LABELS: Record<string, string> = {
  candidate_committee: 'Candidate committee',
  party_unit: 'Party unit',
  political_committee_or_fund: 'Political committee or fund',
};

export function registerKindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return REGISTER_KIND_LABELS[kind] ?? null;
}

/**
 * The register kind a money row's entity-type code corresponds to, for the case
 * where our copy of the register cannot speak (its own state says so) and the
 * download still names the filer's kind. The codes are the Board's own: PCC a
 * principal campaign committee, PTU a party unit, PCF a political committee or
 * fund. An unknown code is nothing, never a guess.
 */
export function registerKindFromEntityType(entityType: string | null | undefined): string | null {
  if (entityType === 'PCC') return 'candidate_committee';
  if (entityType === 'PTU') return 'party_unit';
  if (entityType === 'PCF') return 'political_committee_or_fund';
  return null;
}

/** The Board's 6 codes for a finer kind of committee or fund, to the words the Board
 *  itself uses for them, defined in
 *  `docs/product-onboarding/campaign-finance-entities-guide.md`. None of these labels is
 *  ours, which is what the earlier restraint was guarding against (#1694).
 *
 *  Measured on production across all 526 registered committees and funds, 20 Aug 2026:
 *  163 `PF`, 155 `PC`, 58 `IEC`, 27 `IEF`, 14 `BC`, 3 `BF`, and 106 carrying no
 *  documented code. So 403 filers carried a documented code that read as the register's
 *  broad 3-way kind, against 17 that were spelled out.
 *
 *  `PCN`, `PFN` and `BCN` are deliberately absent: the Board documents them nowhere and
 *  the API withholds them, so nothing reaches this map to expand (#1661). Do not add a
 *  guess. `CAU` and `SPU` are party-unit LAYERS rather than kinds, handled below.
 */
const FINER_KIND_LABELS: Record<string, string> = {
  PC: 'Political committee',
  PF: 'Political fund',
  IEC: 'Independent-expenditure committee',
  IEF: 'Independent-expenditure fund',
  BC: 'Ballot question committee',
  BF: 'Ballot question fund',
};

/**
 * The header's eyebrow. The register kind, except where a Board sub-type code names
 * a finer kind the register itself publishes — the 2 ballot-question codes, and the
 * 2 party layers `CAU` and `SPU` (#1661 §2, served since #1768). Every label here is
 * the Board's own wording; an unknown kind prints nothing rather than a guess.
 *
 * Why the party layers belong here: `whoseCommitteeText` in `committeeMoney.ts`
 * already tells a reader a `CAU` filer is a caucus committee, so an eyebrow reading
 * "Party unit" above that sentence printed a coarser kind than the page's own body,
 * and than the register.
 */
export function committeeEyebrow(
  registerKind: string | null | undefined,
  entitySubType: string | null | undefined,
): string | null {
  const finer = FINER_KIND_LABELS[entitySubType ?? ''];
  if (finer) return finer;
  if (registerKind === 'party_unit') {
    if (entitySubType === 'CAU') return 'Legislative caucus';
    if (entitySubType === 'SPU') return 'State party committee';
  }
  return registerKindLabel(registerKind);
}

/** "CLOSED JUL 28, 2026" — the chip beside a terminated committee's name, drawn on
 *  every year's view because the termination is registration-level, not a year's. */
export function closedChipLabel(terminationDate: string | null | undefined): string | null {
  const day = formatDay(terminationDate);
  return day ? `Closed ${day}` : null;
}

/**
 * The sentence directly under the Itemized contributions figure, on both surfaces
 * (ruled by Eugene, 11 Sep 2026, word for word). It is the one place on the card that
 * states the naming rule, and it states it as rule 12 frames it: a test on a donor's
 * yearly total, and a floor on who a committee MUST name rather than a ban on naming
 * anyone smaller. The statute's own words are that a contributor "must then be listed"
 * once the aggregate exceeds the threshold, and nothing in it forbids naming a smaller
 * one; filer 18135's 2026 pre-general itemizes 215 donors at or under $200 and
 * reconciles to the cent (`docs/architecture/campaign-finance-system-design.md` §2.3),
 * so "are never named" was a false absolute (#1755).
 *
 * A ballot-question filer's page carries **$500** rather than the $200 a candidate's
 * committee carries, because that is what both sources covering these filers say:
 * Minnesota Statutes 10A.20 subd. 3(c), and the Board's own *Independent Expenditure and
 * Ballot Question Political Committee and Fund Handbook* (revised 08/27/2026, its
 * newest), in its itemization passage and a worked example. Both read at source
 * 31 Aug 2026. An earlier sentence told readers "official sources disagree about that
 * threshold for ballot-question committees", which was false and was live on filer
 * 60083's 2025 page: the $200 reading it rested on came from the *Political Committee
 * and Political Fund Handbook*, written for a different kind of filer.
 */
export function itemizedContributionsNote(isBallot: boolean): string {
  const who =
    'Donations where the filing names who gave. Named donors include people, lobbyists, ' +
    'other campaigns, political committees and funds, and party organisations. ';
  if (isBallot) {
    return (
      who +
      'Minnesota requires a ballot-question committee to name a donor once that donor ' +
      'has given more than $500 in total for the year, which is a higher line than the ' +
      '$200 a candidate’s committee carries; a committee may name a smaller donor but ' +
      'does not have to.'
    );
  }
  return (
    who +
    'Minnesota requires a committee to name a donor once that donor has given more ' +
    'than $200 in total for the year; a committee may name a smaller donor but does ' +
    'not have to.'
  );
}

/**
 * The sentence under the Non-itemized contributions figure. One sentence, the same for
 * every filer kind (ruled by Eugene, 11 Sep 2026): the naming rule is stated once on
 * the card, under the itemized figure above, so this says only what this money is. It
 * says the state's file does not name the givers, **not** that nobody knows who they
 * are: the second is a claim about the world this source cannot support. The `isBallot`
 * parameter stays so callers do not change.
 */
export function unnamedMoneyExplanation(isBallot: boolean): string {
  void isBallot;
  return (
    'Donations inside the committee’s reported total whose givers the state’s public ' +
    'file does not name.'
  );
}

// --- The address ---------------------------------------------------------------

/**
 * The address part for one committee: the name in plain letters, then the
 * registration number. Only the number resolves — names collide and registration
 * numbers do not — so an old or misspelled name part still lands on the page.
 */
export function committeeSlug(name: string | null | undefined, registrationNumber: string): string {
  const namePart = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return namePart ? `${namePart}-${registrationNumber}` : registrationNumber;
}

/**
 * The registration number out of an address part, or null when it carries none.
 * The trailing run of digits is the identity; everything before it is a name part
 * a reader may have mistyped, shortened, or copied from an old name. A committee
 * with a negative internal number has no addressable form here on purpose — those
 * exist only as targets of someone else's spending and are absent from the
 * register (phase 2 scope).
 */
export function registrationNumberFromSlug(segment: string | null | undefined): string | null {
  if (!segment) return null;
  const match = /(\d+)$/.exec(segment);
  return match ? match[1] : null;
}

// --- The reads these pages make -------------------------------------------------

/**
 * The keys the committee pages' reads are stored under, written once so the page
 * function can hand a record on under the very key the app then asks for
 * (`lib/pageData.ts`, issue 2024). A key spelled out twice is a key that drifts,
 * and a drifted key does not fail: the app quietly fetches again and the second
 * wait comes back unnoticed.
 */
export function committeeMoneyQueryKey(
  registrationNumber: string | null,
  year: number,
): readonly unknown[] {
  return ['committee-money', registrationNumber, year];
}

/** The full payments view's accumulating list, in one direction. */
export function committeePaymentsListQueryKey(options: {
  registrationNumber: string | null;
  direction: 'received' | 'made';
  year: number;
}): readonly unknown[] {
  const { registrationNumber, direction, year } = options;
  return ['committee-payments-list', registrationNumber, direction, year];
}

// --- The period stamp ------------------------------------------------------------

/**
 * The stamp's headline when figures cover the selected year. The end is read off
 * the filing; the start appears only when the Board's own transcribed disclosure
 * calendars print one against that end — never an assumed 1 January (§7). With no
 * printed start the honest headline is "through" alone.
 */
export function coveredPeriodLine(
  reportedThrough: string | null | undefined,
  reportedPeriodStart?: string | null,
): string | null {
  const day = formatDay(reportedThrough);
  if (!day) return null;
  const start = formatDay(reportedPeriodStart);
  return start ? `Figures for ${start} – ${day}` : `Figures through ${day}`;
}

/** The stamp's detail sentence under a covered period. `checkedOn` is the day we
 *  copied the Board's files, already printed as a Minnesota (Central-time) day. */
export function coveredPeriodDetail(
  reportedThrough: string | null | undefined,
  checkedOn: string | null,
  options: { isPartyUnit?: boolean; reportedPeriodStart?: string | null } = {},
): string {
  const day = formatDay(reportedThrough);
  const start = formatDay(options.reportedPeriodStart);
  const coverage = day
    ? start
      ? `The committee’s own report to the state covers ${start} through ${day}. The end is read off the filing and the start off the Board’s own published filing calendar — nothing is assumed.`
      : `The committee’s own report to the state covers through ${day}. The coverage end is read off the filing — no start is assumed.`
    : 'The dates on this page are read off the filings themselves.';
  const checked = checkedOn
    ? ` Checked against our copy of the Board’s files, taken ${checkedOn}.`
    : '';
  const calendar = options.isPartyUnit
    ? ' Party units file on their own calendar, so these dates are the party-unit series’, not a candidate committee’s.'
    : '';
  return coverage + checked + calendar;
}

/** The stamp when no figures cover the selected year. */
export function uncoveredPeriodLine(year: number): string {
  return `No figures cover ${year}`;
}

export function uncoveredPeriodDetail(year: number, checkedOn: string | null): string {
  return (
    `The state’s files we hold carry no report figures covering ${year} for this ` +
    `committee, and we do not carry an earlier year’s money forward under a ${year} ` +
    `heading.` +
    (checkedOn ? ` Checked against our copy of the Board’s files, taken ${checkedOn}.` : '')
  );
}

/**
 * The extra sentence when our own service could not answer and the page is holding
 * the figures it already had. Held until it answers, never expiring on a timer:
 * older and labelled beats blank, and both beat a number we cannot stand behind.
 */
export function staleHoldNote(checkedOn: string | null): string {
  return (
    'We could not reach our own data service just now, so these are the last ' +
    `figures we accepted${checkedOn ? `, taken ${checkedOn}` : ''} — held until it ` +
    'answers rather than expiring on a timer.'
  );
}

/** The bulk-payment copy has its own date, separate from the filing totals. */
export function paymentFilesDownloadedLine(day: string): string {
  return (
    `We last downloaded Minnesota’s payment files on ${day}. ` +
    'The report totals are copied separately. This is a download date, not the period the money covers.'
  );
}

/** A committee whose own report totals zero: a verified zero, drawn as the number
 *  it is, with the sentence that stops it reading as a gap (rule 12). */
export const ZERO_REPORTED_NOTE =
  'The committee’s own report to the state says it raised nothing in this period, ' +
  'and the state’s file names no donor for it. That is the filing’s own zero, not ' +
  'a gap in our records.';

// --- The not-found state ------------------------------------------------------------

export function notFoundTitle(): string {
  return 'This number isn’t in the register we hold';
}

export function notFoundBody(registrationNumber: string): string {
  return (
    `Nothing is registered under ${registrationNumber} in our copy of the Board’s ` +
    'register, and none of the state’s money files we hold carries it. That is a ' +
    'fact about our records, not about the committee — the number may be newer ' +
    'than our copy, or mistyped by a digit.'
  );
}

// --- The 2 money cards' fixed labels ---------------------------------------------------
//
// Both surfaces that draw a committee's money — its own page and the Campaign money
// tab on a confirmed legislator's profile — draw the cards from one component
// (`components/campaignMoney/MoneyCards.tsx`), and that component reads every label
// from here, so a label can only ever be changed in one place and a test can pin it.

export const MONEY_IN_HEADING = 'Money in';
export const MONEY_OUT_HEADING = 'Money out';

/** The filing's own total, in the filing's own words (ruled by Eugene, 11 Sep 2026).
 *  Never "Raised in total": the 2 are the same only when the report covers the whole
 *  year, and a report that stops in March makes the second false while the first stays
 *  true beside its own coverage date. */
export const MONEY_IN_REPORTED_LABEL = 'Total contributions';

/** The named figure, in the filing's own word for it (ruled by Eugene, 11 Sep 2026).
 *  Always drawn: a real amount or the words "Not reported", never a blank, because a
 *  card with a hole where a figure should be reads as broken. The sentence under it
 *  (`itemizedContributionsNote`) says what the word means. */
export const MONEY_IN_NAMED_LABEL = 'Itemized contributions';

/** The filing's own word for money reported as a lump with no donor listed (ruled by
 *  Eugene, 11 Sep 2026). The sentence under it says what the word means. */
export const MONEY_IN_UNNAMED_LABEL = 'Non-itemized contributions';

/** The heading over the receipt rows that are not donations — a loan, a public
 *  subsidy, interest. Short because the card heading 2 elements above already says
 *  "Money in", and the rows themselves show that each is reported on its own line
 *  (ruled by Eugene, 2 Sep 2026, in the campaign-money design's copy proposals). */
export const NOT_A_DONATION_HEADING = 'Not a donation';

/**
 * The receipt kind the cards do not draw (ruled by Eugene, 11 Sep 2026). Matched against
 * the served value exactly: `Miscellaneous` is the Board's own kind on the contributions
 * file, and a page that hides it draws no `Not a donation` heading when no row is left.
 * Every other kind (a public subsidy, interest, a loan) still draws with its own label.
 */
export const HIDDEN_RECEIPT_KIND = 'Miscellaneous';

/** The receipt rows a card draws: every served row except the hidden kind. Generic over
 *  the row shape because the app's mapped rows carry `receiptType` and the first
 *  response's raw rows carry `receipt_type`, and one filter has to serve both. */
export function shownReceiptRows<T>(
  rows: readonly T[] | null | undefined,
  kindOf: (row: T) => string,
): T[] {
  return (rows ?? []).filter((row) => kindOf(row) !== HIDDEN_RECEIPT_KIND);
}

/** The link to the Board's own viewer, where a reader looks the filing up by its
 *  registration number. Drawn once per page, in the filing stamp above both cards,
 *  never inside one: one filing produces both cards, so a link inside money in alone
 *  makes that card look like it owns the filing. */
export const FILED_REPORTS_LINK_LABEL = 'This committee’s filed reports, on the state’s own site';

/**
 * The source link at the foot of the money-in card, to the Board's downloads page.
 *
 * The server sends the address of the bulk download itself
 * (`.../data-downloads/campaign-finance/?download=<id>`), which streams a 9 MB statewide
 * spreadsheet with no page behind it, so in a browser nothing readable opens. The card
 * links to the page that download lives on instead (ruled by Eugene, 11 Sep 2026), and
 * derives it here from the served address rather than hard-coding it, so a future release
 * id cannot break it and the served field stays untouched.
 */
export const NAMED_DONATIONS_LINK_LABEL = 'Minnesota’s campaign-finance downloads';

/** The page a Board bulk-download address lives on: the same address with its
 *  `?download=<id>` query removed. An address with no query comes back as it is. */
export function downloadsPageUrl(sourceUrl: string): string {
  const cut = sourceUrl.indexOf('?');
  return cut === -1 ? sourceUrl : sourceUrl.slice(0, cut);
}

/**
 * The period note under a reported figure, or null when the stamp above the cards
 * already states it.
 *
 * Rule 12 wants every total to state the period it covers, and the stamp is where
 * that lives — stating it again under the figure would print one fact twice. The
 * note comes back only where a figure's own coverage date differs from the stamp's,
 * which is the one case where the stamp's date would be wrong about this figure.
 */
export function reportedThroughNote(
  figureThrough: string | null | undefined,
  stampThrough: string | null,
): string | null {
  if (!figureThrough || figureThrough === stampThrough) return null;
  return reportedThroughLabel(figureThrough);
}

// --- Money out labels ----------------------------------------------------------------

/** The filing's own total. A missing official total never borrows this label. */
export const MONEY_OUT_REPORTED_LABEL = 'Expenditures';
export const MONEY_OUT_OFFICIAL_MISSING =
  'We do not hold an official spending total for this committee for this year.';
export const MONEY_OUT_ZERO_NOTE =
  'The committee’s own report states $0 in expenditures. That is the filing’s own zero, not a gap in our records.';

/** Summary cards print the filing's own total. A calculated payment sum belongs
 *  beside its rows, never in the missing official figure's place. Shared by both
 *  cards and the first HTML response. */
export function moneyOutSummary(moneyOut: { reportedTotal: string | null } | null) {
  const official = formatMoney(moneyOut?.reportedTotal);
  if (official !== null) {
    return {
      label: MONEY_OUT_REPORTED_LABEL,
      amount: official,
      notes: official === '$0' ? [MONEY_OUT_ZERO_NOTE] : [],
      isOfficial: true,
    };
  }
  return {
    label: null,
    amount: null,
    notes: [MONEY_OUT_OFFICIAL_MISSING],
    isOfficial: false,
  };
}

// --- The two lists and the payments view ----------------------------------------------

export type PaymentsTab = 'gave' | 'spent';

export function paymentsTabFromParam(raw: string | undefined | null): PaymentsTab {
  return raw === 'spent' ? 'spent' : 'gave';
}

// --- The 2 outside-spending tabs' rows and lines ---------------------------------------

/** The lead on "Spent about them", above the never-added sentence. */
export const OUTSIDE_ABOUT_INTRO =
  'What other groups spent about this committee, filed independently of it. This ' +
  'committee neither received nor controlled any of it.';

/**
 * Above the rows on both tabs, verbatim: this file is never added to the ordinary
 * expenditures file. 491 rows share a spender, name, amount and date with an
 * expenditure row, and whether that is one payment filed twice or 2 that coincide
 * is not established — so no figure here is ever summed with money out.
 */
export const OUTSIDE_NEVER_ADDED =
  'This is the independent-spending file, and it is never added to the ordinary ' +
  'expenditures file: 491 rows share a spender, name, amount and date with an ' +
  'expenditure row, and whether that is one payment filed twice or 2 that coincide ' +
  'is not established.';

export const FIRST_PAYMENTS_LIMIT = 50;
export const PAGE_CAP = 250;

// --- Payment rows -------------------------------------------------------------------

/** The marker on a donated-goods-or-services row. It stays inside the totals,
 *  because that is how the state accounts for it. */
export const IN_KIND_CHIP = 'Donated goods or services';

/**
 * The one sentence naming how much of the named donations was goods and services.
 *
 * **One function because 3 renderers were writing it 2 different ways, and one of the 2
 * was wrong.** The committee page and the server-rendered first response both said "The
 * state counts those separately from the reported total"; the legislator profile said
 * "separately from the total below". On the profile the reported total draws ABOVE this
 * line, and the figure that draws below it is "Donations with nobody's name on them",
 * which is a different figure derived from the reported total rather than the total
 * itself. Worse, that lower figure only draws when the split is shown, so on a profile
 * with a withheld split the sentence pointed at nothing at all.
 *
 * So the wording names the figure rather than its position, which is what makes it
 * correct on both surfaces however either one is laid out later.
 *
 * `namesTheChip` exists because 2 of the 3 places name the marker a row carries
 * (`IN_KIND_CHIP`) and the profile does not, and closing that gap would change what a
 * reader sees rather than fixing what is wrong. Presentation stays where it was; only
 * the claim is unified.
 */
export function inKindDonationsNote(amount: string, namesTheChip: boolean): string {
  const marker = namesTheChip ? ` (${IN_KIND_CHIP.toLowerCase()})` : '';
  return (
    `${amount} of the donations above were goods and services rather than money${marker}. ` +
    'The state counts those separately from the reported total.'
  );
}

export function isInKind(inKind: string | null | undefined): boolean {
  return inKind === 'Yes';
}

/** A filing that names no counterparty says so, rather than showing a blank. */
export const UNNAMED_PAYMENT_PARTY = 'Name not given in the filing';

// --- Shared formatting shortcuts ------------------------------------------------------

/** Re-exported so the screens import one module for these pages' rules. */
export { formatDay, formatMoney };
