/**
 * What a committee's money page and its full-payments view are allowed to say
 * (#1442, campaign money phase 2).
 *
 * Framework-free, in the style of `lib/legislatorCampaignMoney.ts`, which this
 * deliberately reuses rather than restates: the split sentences, money formatting
 * and year handling are the same product rules on a different page, and 2 copies of
 * a sentence is how one gets fixed and the other does not. What lives here is only
 * what the committee page adds: the address, the register-driven header, the
 * closed / empty-year / not-found / stale states, and the payments list's labels.
 *
 * The rules doing the most work (`.claude/rules/grounded-answers.md` rule 12;
 * `docs/architecture/campaign-finance-system-design.md` §7):
 *
 * - The registration number is the identity. Names collide (the census found 178
 *   register names one character apart, every pair a different organisation), so
 *   only the trailing number in the address resolves, and a page never keys on a
 *   spelling.
 * - The register's own kind is the only kind label a page may print. A ballot
 *   question filer is known by the Board's own sub-type code on its money rows
 *   (`BC` / `BF`), never by its name.
 * - A ballot-question page prints $500 as the donor-naming threshold, and every other
 *   page prints $200. The statute (10A.20 subd. 3(c)) and the Board's own handbook for
 *   those filers both set $500. The payments side is a different threshold and no
 *   source we hold sets a ballot-question figure for it, so the money-out sentence
 *   names that threshold without a figure.
 * - A verified zero is "0". An absent official money-out total is our data gap,
 *   never a claim that the committee did not report. A closed committee keeps its
 *   own date and final-report explanation.
 */

import {
  formatDay,
  formatMoney,
  isAmountAboveZero,
  reportedThroughLabel,
  type MoneyBlockState,
} from './legislatorCampaignMoney';

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
 * Why the party layers belong here: `whoseCommitteeText` below already tells a reader
 * a `CAU` filer is a caucus committee, so an eyebrow reading "Party unit" above that
 * sentence printed a coarser kind than the page's own body, and than the register.
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

/**
 * The line beside the registration chip. For a candidate committee the register
 * carries the office and district it registered for; for everyone else the
 * register's own kind is all it states, and the line says exactly that — an
 * expansion would be ours, not the register's.
 */
export function registeredForLine(register: {
  kind: string | null;
  office: string | null;
  district: string | null;
}): string | null {
  if (register.kind === 'candidate_committee' && register.office) {
    if (register.district && (register.office === 'House' || register.office === 'Senate')) {
      return `Registered for ${register.office} District ${register.district}`;
    }
    return register.district
      ? `Registered for ${register.office} · District ${register.district}`
      : `Registered for ${register.office}`;
  }
  const label = registerKindLabel(register.kind);
  return label ? `Kind as registered: ${label.toLowerCase()}` : null;
}

/** "CLOSED JUL 28, 2026" — the chip beside a terminated committee's name, drawn on
 *  every year's view because the termination is registration-level, not a year's. */
export function closedChipLabel(terminationDate: string | null | undefined): string | null {
  const day = formatDay(terminationDate);
  return day ? `Closed ${day}` : null;
}

/** The one legislator a person has confirmed a committee belongs to, as served.
 *  Null on every committee nobody has confirmed, which is the ordinary answer. */
export interface ConfirmedCommitteeMember {
  slug: string;
  fullName: string;
}

/**
 * Whose committee this is. A committee page is complete where a profile is empty —
 * the money is filed BY committee — and the only thing missing is the link to a
 * person. The filed name is not that link: it is the filer's own wording, not a
 * confirmation by anyone (design doc §5.1). Party units, funds and ballot-question
 * committees are nobody's, so their sentence must not imply a person is missing.
 *
 * `confirmedMember` is the one case where the missing link is present, and it comes
 * first because a person's checked decision outranks anything read off a name or a
 * kind code. Three things the confirmed sentence has to do, each of them a rule
 * rather than a preference:
 *
 * - **Say a person did it, not that it is "confirmed".** §5.1's whole point is that
 *   no score, threshold or agreement between rules ever produces a link, because if
 *   a name match is wrong nothing downstream would ever notice. A bare "Confirmed"
 *   reads as our software having matched a name, which is the one thing this is not.
 * - **Never imply this is the member's only committee.** Minnesota registers a
 *   committee per office, 17 sitting members hold more than one, and 20 candidates
 *   currently do (#1663). "The committee of X" would state something no filing
 *   supports, so the sentence says the money here is this committee's own and that a
 *   candidate can register more than one. The arithmetic guard against ever adding
 *   two of them together is #1663's; this is only the sentence.
 * - **Change nothing when nobody has confirmed.** A rejection is a decision about our
 *   own proposal, never a reader-facing claim about the committee (§7), so it arrives
 *   here as no confirmation at all and the page keeps its existing words.
 */
export function whoseCommitteeText(
  registerKind: string | null | undefined,
  entitySubType: string | null | undefined,
  confirmedMember: ConfirmedCommitteeMember | null,
): string {
  if (confirmedMember) {
    return (
      'Someone at Alethical read Minnesota’s own records and confirmed this ' +
      `committee is ${confirmedMember.fullName}’s. We never attach a committee to a ` +
      'person on the strength of its filed name, so this is a decision a person made ' +
      'and signed. The money on this page is this committee’s own record, and a ' +
      'candidate can register more than one committee.'
    );
  }
  if (isBallotQuestionFiler(entitySubType)) {
    return (
      'A ballot-question committee raises and spends about a question on the ' +
      'ballot, not a candidate, so there is no person to attach it to.'
    );
  }
  if (registerKind === 'party_unit') {
    if (entitySubType === 'CAU') {
      return (
        'A caucus committee is not a candidate’s committee. It raises and spends ' +
        'for a party’s members in one chamber of the Legislature, so there is no ' +
        'one person to attach it to.'
      );
    }
    return (
      'A party unit is not a candidate’s committee. It raises and spends for a ' +
      'party organisation, so there is no person to attach it to.'
    );
  }
  if (registerKind === 'political_committee_or_fund') {
    return (
      'The register carries this filer as a political committee or fund. A fund ' +
      'is not a candidate’s committee, so there is no person to attach it to.'
    );
  }
  return (
    'The name a committee files under is the filer’s own wording, not a ' +
    'confirmation by anyone, so we do not put these figures under a person’s name ' +
    'on the strength of it. The money on this page is the committee’s own record.'
  );
}

/** The link out of the confirmed sentence, to the member's own money.
 *  Worded so it is true whichever committees that tab ends up showing. */
export function confirmedMemberLinkLabel(fullName: string): string {
  return `See ${fullName}’s campaign money`;
}

/**
 * Where that link goes: the member's profile, opened on its money tab, because the
 * money is what a reader following it from a money page is after.
 *
 * Spelled here rather than in the screen so the first server response and the running
 * app carry the same address, and pinned against the router's own builder by a test
 * (`navigation/__tests__/links.test.ts`) so the 2 spellings cannot drift.
 */
export function confirmedMemberMoneyPath(slug: string): string {
  return `/legislators/${encodeURIComponent(slug)}?tab=money`;
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

/** One page of a committee's short payments list, in one direction. */
export function committeePaymentsQueryKey(options: {
  registrationNumber: string | null;
  direction: 'received' | 'made';
  year: number;
  limit: number;
  offset: number;
}): readonly unknown[] {
  const { registrationNumber, direction, year, limit, offset } = options;
  return ['committee-payments', registrationNumber, direction, year, limit, offset];
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

/** Which direction of the payments file a tab reads. */
export function paymentsDirection(tab: PaymentsTab): 'received' | 'made' {
  return tab === 'gave' ? 'received' : 'made';
}

/** How many rows the committee page's short list asks for. */
export const SHORT_PAYMENTS_LIMIT = 6;

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

/** The stamp for a closed committee's empty year. */
export function closedPeriodLine(terminationDate: string | null | undefined): string {
  const day = formatDay(terminationDate);
  return day ? `Committee closed ${day}` : 'Committee closed';
}

export function closedPeriodDetail(
  terminationDate: string | null | undefined,
  checkedOn: string | null,
): string {
  const day = formatDay(terminationDate);
  return (
    `The Board’s register records this committee as terminated${day ? ` on ${day}` : ''}. ` +
    'A terminating committee files a final report at termination, and no report will follow it.' +
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

/**
 * Which display state a whole committee-year is in, decided once so the period
 * stamp, the 2 cards, the lists and the first server response cannot disagree
 * about it.
 *
 * Structurally typed rather than tied to the app's mapped record, because the
 * page function builds the same state straight off the API payload for the text
 * it serves before any script runs (#1812). One rule, 2 callers.
 */
export function yearDisplayState(money: {
  register: { terminationDate: string | null };
  split: { reportedTotal: string | null };
  moneyIn: { state: string; otherReceipts: readonly unknown[] };
  moneyOut: { state: string; reportedTotal: string | null; byType: readonly unknown[] };
}): 'closed-empty' | 'empty-year' | 'figures' {
  const hasFigures =
    money.split.reportedTotal !== null ||
    money.moneyOut.reportedTotal !== null ||
    money.moneyIn.state === 'reported' ||
    money.moneyOut.state === 'reported' ||
    money.moneyIn.otherReceipts.length > 0 ||
    money.moneyOut.byType.length > 0;
  if (hasFigures) return 'figures';
  return money.register.terminationDate ? 'closed-empty' : 'empty-year';
}

// --- The empty and closed money cards ---------------------------------------------

export const CLOSED_MONEY_IN_WHY =
  'This committee closed and filed a final report at termination. That filing is ' +
  'public and you can read it on the Board’s site, but our copy of the state’s ' +
  'figures does not include it, so there is no total to show here.';

export function emptyYearMoneyInWhy(year: number): string {
  return (
    `No report figures covering ${year} are in the state’s files we hold for this ` +
    `committee. Earlier years’ figures stay under their own years — we do not carry ` +
    `them forward.`
  );
}

/** What the big-figure slot reads in each empty case. Never set in the size money
 *  is set in — the screens use the stand-in style for these. */
export const CLOSED_EMPTY_VALUE = 'Not available';
export const EMPTY_YEAR_VALUE = 'Not reported';

/** A committee whose own report totals zero: a verified zero, drawn as the number
 *  it is, with the sentence that stops it reading as a gap (rule 12). */
export const ZERO_REPORTED_NOTE =
  'The committee’s own report to the state says it raised nothing in this period, ' +
  'and the state’s file names no donor for it. That is the filing’s own zero, not ' +
  'a gap in our records.';

/** The header line for a number our copy of the Board's register does not carry,
 *  while the state's money files still hold rows under it. A fact about our copy
 *  of the register, stated as ours. */
export const NOT_IN_REGISTER_LINE = 'Not in our copy of the Board’s register';

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
 * The one coverage date the filing stamp above both cards states, or null when no
 * filing total is on the page. Money in's reported total is the usual source; a
 * committee-year whose split withholds its total but whose money-out total is held
 * still has a filing to date, so the stamp falls back to that.
 */
export function stampThroughDate(
  split: { reportedThrough: string | null },
  moneyOut: { reportedThrough: string | null } | null | undefined,
): string | null {
  return split.reportedThrough ?? moneyOut?.reportedThrough ?? null;
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

export function paymentsTitle(tab: PaymentsTab): string {
  return tab === 'gave' ? 'Who gave to this committee' : 'Where this committee’s money went';
}

export function paymentsEyebrow(tab: PaymentsTab): string {
  return tab === 'gave' ? 'Every donor named' : 'Every payment named';
}

export const PAYMENTS_TAB_LABELS: Record<PaymentsTab, string> = {
  gave: 'Who gave',
  spent: 'Where it went',
};

// --- The Filings tab -------------------------------------------------------------------

/**
 * The committee page's tabs. The full-payments view keeps `PaymentsTab`: filings
 * have no "see every payment" page behind them, and the 2 outside-spending tabs
 * read a different file altogether (`OutsideSpendingTab`).
 */
export type CommitteeTab = PaymentsTab | 'filings' | OutsideSpendingTab;

/**
 * The 2 directions of the outside-spending file, as a committee page reads them:
 * `about` is what other groups spent about this committee, `by` is what this filer
 * spent about others. Ruled labels: "Spent about them" and "Spent by them" — the one
 * place money is called "spent" in this section, because it IS spending, by others,
 * and on a candidate's own page a large figure that is not their money is the most
 * misreadable thing on the screen, so the direction belongs in the label.
 */
export type OutsideSpendingTab = 'about' | 'by';

export function committeeTabFromParam(raw: string | undefined | null): CommitteeTab {
  if (raw === 'filings') return 'filings';
  if (raw === 'about' || raw === 'by') return raw;
  return paymentsTabFromParam(raw);
}

export const COMMITTEE_TAB_LABELS: Record<CommitteeTab, string> = {
  gave: 'Who gave',
  spent: 'Where it went',
  filings: 'Filings',
  about: 'Spent about them',
  by: 'Spent by them',
};

/**
 * Which tabs a committee's page carries, in strip order.
 *
 * The first 3 always. Each outside-spending tab follows THIS filer's own rows in
 * that direction, never its kind (ruled 2 Sep 2026): no rows means we cannot tell
 * "spent nothing" from "we hold nothing", so there is no empty state to draw and no
 * tab either. A caucus committee that spends independently carries "Spent by them";
 * a candidate committee nobody spent about carries no "Spent about them"; a
 * ballot-question filer carries whichever direction its rows support, which today is
 * neither.
 */
export function committeeTabs(presence: { spentAbout: boolean; spentBy: boolean }): CommitteeTab[] {
  const tabs: CommitteeTab[] = ['gave', 'spent', 'filings'];
  if (presence.spentAbout) tabs.push('about');
  if (presence.spentBy) tabs.push('by');
  return tabs;
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

export type OutsideSpendingSort = 'newest' | 'largest';

/** The 2 sort controls, newest by default. The screen sets them in small capitals. */
export const OUTSIDE_SORT_LABELS: Record<OutsideSpendingSort, string> = {
  newest: 'Newest first',
  largest: 'Largest first',
};

export function outsideSortFromParam(raw: string | undefined | null): OutsideSpendingSort {
  return raw === 'largest' ? 'largest' : 'newest';
}

/**
 * The count line over the rows. "12 payments about 5 committees" on the spender's
 * tab, "12 payments by 5 groups" on the spent-about tab, singular where the count
 * is 1, and "Showing 6 of 12 payments" while the list is cut. No closing dot, and
 * never "payments named": every row in this file is itemised, so "named" would imply
 * a filter that is not there.
 */
export function outsideCountLine(
  tab: OutsideSpendingTab,
  shown: number,
  total: number | null,
  distinct: number | null,
): string | null {
  if (total === null) return null;
  const payments = `${total.toLocaleString('en-US')} ${total === 1 ? 'payment' : 'payments'}`;
  if (shown < total) {
    return `Showing ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} payments`;
  }
  if (distinct === null) return payments;
  if (tab === 'by') {
    return `${payments} about ${distinct.toLocaleString('en-US')} ${distinct === 1 ? 'committee' : 'committees'}`;
  }
  return `${payments} by ${distinct.toLocaleString('en-US')} ${distinct === 1 ? 'group' : 'groups'}`;
}

/** The filing's own For or Against, as the chip prints it. Filled on every row of
 *  the live file, so the third case is a guard rather than a state a reader meets. */
export function outsideStanceLabel(direction: string | null | undefined): string {
  if (direction === 'For') return 'Supporting';
  if (direction === 'Against') return 'Opposing';
  return 'Direction not recorded';
}

/**
 * The 2 empty states a row can carry, as designed strings rather than dashes. Blanks
 * clump on short pages (2 of 50, 3 of 11, 2 of 7 in a real sample), so a missing
 * value has to look deliberate rather than broken. Purpose is filled on 98.1% of
 * rows and vendor on 95.9%.
 */
export const NO_PURPOSE_GIVEN = 'No purpose given in the filing';
export const NO_VENDOR_NAMED = 'No vendor named in the filing';

/** One row of the outside-spending file as the page reads it, either direction. */
export interface OutsideSpendingRowLike {
  spender: string | null;
  spenderRegistrationNumber: string | null;
  spenderInRegister: boolean;
  spenderLinkable: boolean;
  aboutCommitteeName: string | null;
  aboutCommitteeRegistrationNumber: string | null;
  aboutCommitteeInRegister: boolean;
  aboutCommitteeLinkable: boolean;
  direction: string | null;
  purpose: string | null;
  vendorName: string | null;
  expenditureType: string | null;
  inKind: boolean;
  paidOn: string | null;
  amount: string | null;
  unpaidAmount: string | null;
}

/** The side of the row that is not this page's committee. */
export interface OutsideSpendingCounterparty {
  name: string;
  registrationNumber: string | null;
  /** This release holds a page for the number, so the name links to it. */
  linkable: boolean;
  /** Our copy of the Board's register lists the number. False prints
   *  `NOT_IN_REGISTER_LINE` in the number's place rather than a bare number. */
  inRegister: boolean;
}

export function outsideCounterparty(
  tab: OutsideSpendingTab,
  row: OutsideSpendingRowLike,
): OutsideSpendingCounterparty {
  return tab === 'about'
    ? {
        name: row.spender ?? UNNAMED_PAYMENT_PARTY,
        registrationNumber: row.spenderRegistrationNumber,
        linkable: row.spenderLinkable,
        inRegister: row.spenderInRegister,
      }
    : {
        name: row.aboutCommitteeName ?? UNNAMED_PAYMENT_PARTY,
        registrationNumber: row.aboutCommitteeRegistrationNumber,
        linkable: row.aboutCommitteeLinkable,
        inRegister: row.aboutCommitteeInRegister,
      };
}

/** "REG 41207", or the register line where our copy of the register lacks the number. */
export function outsideRegistrationLine(party: OutsideSpendingCounterparty): string {
  if (!party.registrationNumber || !party.inRegister) return NOT_IN_REGISTER_LINE;
  return `REG ${party.registrationNumber}`;
}

/**
 * The grey line under the name: the filing's own purpose, who was paid, and the
 * filing's own type, each in its own position with its own empty state.
 */
export function outsideRowMeta(row: OutsideSpendingRowLike): string {
  // The file carries trailing spaces on some names ("Nuntius Borealis "), which would
  // print a double gap before the separator.
  const purpose = row.purpose?.trim() || null;
  const vendor = row.vendorName?.trim() || null;
  const type = row.expenditureType?.trim() || null;
  const parts = [purpose ?? NO_PURPOSE_GIVEN, vendor ? `paid to ${vendor}` : NO_VENDOR_NAMED];
  if (type) parts.push(type);
  return parts.join(' · ');
}

/** "Paid Aug 3, 2026", or null on a row the filing dates nowhere. */
export function outsidePaidLine(paidOn: string | null | undefined): string | null {
  const day = formatDay(paidOn);
  return day ? `Paid ${day}` : null;
}

/** "$2,000 of it unpaid", directly under the amount it qualifies; nothing when the
 *  whole payment is settled or the filing states no unpaid part. */
export function outsideUnpaidNote(unpaid: string | null | undefined): string | null {
  if (!isAmountAboveZero(unpaid)) return null;
  return `${formatMoney(unpaid ?? null)} of it unpaid`;
}

/** Not "every report" — the Board's catalogue carries no filing record for most
 *  pre-2008 rows, so a completeness claim would be one we cannot check. The rows
 *  themselves are each a filed report; `unlistedReportsLine` says the boundary. */
export const FILINGS_HEADLINE = 'REPORTS THIS COMMITTEE HAS FILED';

/**
 * The printed ordering sentence, derived from the served `ordered_by` through this
 * one mapping so the words and the order can never drift apart.
 *
 * The drawn design says "by the date filed", and that sentence still does not ship
 * even now that we hold filing dates (issue #1670), because it would be false about
 * the rows that carry none: the Board serves no readable report document for most
 * of a committee's history before 2023, so a list is normally a mix. The mixed
 * sentence says which rows are which, so a reader never takes an undated row's
 * position for an arrival date. An `ordered_by` this mapping does not know prints no
 * sentence rather than a guess.
 */
export function filingsOrderingLine(orderedBy: string): string | null {
  if (orderedBy === 'period_end') {
    return 'Newest first, by the period each report covers — never by amount';
  }
  if (orderedBy === 'filed_date_then_period_end') {
    return (
      'Newest first — by the day the Board received a report where its filing says so, ' +
      'and by the period it covers where it does not. Never by amount'
    );
  }
  return null;
}

/**
 * "Filed Jul 24, 2026", or null on a row the Board states no filing date for.
 *
 * Null is the ordinary answer and it prints nothing at all: the alternative a reader
 * would never notice is this line falling back to the period end, which is the
 * fabricated fact issue #1670 exists to prevent. The row still shows its period, so
 * nothing is hidden — only the one claim we cannot make.
 */
export function filedDateLine(filedDate: string | null | undefined): string | null {
  const day = formatDay(filedDate);
  return day ? `Filed ${day}` : null;
}

/**
 * The period a filing covers, both ends read off the Board's own records — never
 * an assumed January. Start unresolved → "Covers through {end}". No end at all →
 * null, and the row carries the report name with no period line.
 */
export function filingRowPeriodLine(filing: {
  periodStart: string | null;
  periodEnd: string | null;
}): string | null {
  const end = formatDay(filing.periodEnd);
  if (!end) return null;
  const start = formatDay(filing.periodStart);
  if (!start) return `Covers through ${end}`;
  return `Covers ${start} – ${end}`;
}

/** The neutral marker on a report whose effective version is an amendment. It
 *  carries no date: the catalogue's amendment record is version indexes only, and
 *  a dated chip would be a fabricated fact about a named committee. Never amber —
 *  amber is reserved for bill identity. */
export const AMENDED_CHIP = 'AMENDED';

/** Index 0 is the original; 1 and up mean the report on file is an amendment. A
 *  missing prior figure never suppresses this — the record of the versions is
 *  reliable even where old documents are not. */
export function filingIsAmended(effectiveAmendmentIndex: number | null): boolean {
  return effectiveAmendmentIndex !== null && effectiveAmendmentIndex >= 1;
}

/** "16 reports filed" / "Showing 100 of 120 reports filed". */
export function filingsCountLine(shown: number, total: number | null): string | null {
  if (total === null) return null;
  if (shown < total) {
    return `Showing ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} reports filed`;
  }
  return `${total.toLocaleString('en-US')} ${total === 1 ? 'report' : 'reports'} filed`;
}

/**
 * The list's honest boundary, printed only when it exists: the catalogue lists
 * some reports without saying whether they were filed — a report whose filing
 * period has opened but which nobody has filed, or one so old the Board serves no
 * record either way (ordinary before 2008). Left out rather than shown as filed,
 * and said out loud rather than implied away.
 */
export function unlistedReportsLine(count: number | null): string | null {
  if (!count) return null;
  const reports = count === 1 ? 'report' : 'reports';
  return (
    `The Board's catalogue lists ${count.toLocaleString('en-US')} ${reports} for this ` +
    `committee without saying whether ${count === 1 ? 'it was' : 'they were'} filed — a report ` +
    `can be listed before anyone files it, and for the oldest reports the Board keeps no ` +
    `record either way. ${count === 1 ? 'It is' : 'They are'} left out rather than shown as filed.`
  );
}

/** Under the list, on every non-empty view. The Board's own calendars are the only
 *  source of a period start (design doc §7). */
export const FILINGS_PERIOD_NOTE =
  'The end of every period is read off the filing itself. A start is shown only where one of ' +
  'the Board’s own filing calendars prints it — never an assumed January 1, because not every ' +
  'filer’s year opens then. Where no start resolves, the row reads “covers through” its end date.';

export const FILINGS_EMPTY_TITLE = 'No filed reports in our copy';

/** An empty list is a fact about the Board's catalogue as we hold it, never a
 *  claim that the committee did something wrong — and never a lateness claim,
 *  which no page may make (#1642). */
export const FILINGS_EMPTY_WHY =
  'The Board’s report catalogue, as we last copied it, records no filed report for this ' +
  'committee. That is a fact about the catalogue and our copy of it, not a statement about ' +
  'the committee.';

export const FILINGS_UNAVAILABLE =
  'We could not read this committee’s filings out of our copy of the Board’s catalogue. This ' +
  'is a gap on our side, not a statement about the committee.';

/** A failed read is our gap, never evidence that the filing names nobody. */
export const PAYMENTS_LOAD_ERROR =
  'We couldn’t load these payments right now. This is a problem on our side and ' +
  'says nothing about the committee. Please try again in a moment.';

export function paymentsUnavailable(state: string | null | undefined): boolean {
  return state !== 'reported' && state !== 'not_reported';
}

/** "Showing 250 of 1,284 payments named" / "41 payments named in this period". */
export function showingLine(shown: number, total: number | null): string | null {
  if (total === null) return null;
  if (shown < total) {
    return `Showing ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} payments named`;
  }
  return `${total.toLocaleString('en-US')} ${total === 1 ? 'payment' : 'payments'} named in this period`;
}

/** The cap is ours, not the filing's, and the card says so in those words. */
export const CAP_NOTE =
  'We load 50 first, then up to 250 at a time, largest first — the cap is ours, not the filing’s. The ' +
  'reports these payments come from list every one of them, and they are public.';

export const FIRST_PAYMENTS_LIMIT = 50;
export const PAGE_CAP = 250;

export function capNextLabel(shown: number, total: number): string {
  const next = Math.min(PAGE_CAP, total - shown);
  return `Show the next ${next.toLocaleString('en-US')}`;
}

/**
 * The sentence under a list saying which names open a page. Only a name carrying a
 * registration number this release holds as a filer opens — a private donor is not
 * a profile, and a business has no number at all. The threshold clause is left off
 * a ballot-question committee's page entirely (rule 12, as amended).
 */
export function listLinkNote(tab: PaymentsTab, isBallot: boolean): string {
  const opens =
    tab === 'gave'
      ? 'Committees, party units and funds open a page — they carry a registration number we can identify them by. A private donor’s name is not a profile, and never becomes one here.'
      : 'Committees and party units open a page — they carry a registration number we can identify them by. A business or person that only got paid has none, so its name stays plain text.';
  if (isBallot) return opens;
  const threshold =
    tab === 'gave'
      ? ' Minnesota makes a committee name a donor only once that donor has given more than $200 in total for the year, so these payments never sum to the total on the committee’s page.'
      : ' Minnesota makes a committee name a recipient only once payments to them pass $200 in total for the year, so these payments never sum to the total on the committee’s page.';
  return opens + threshold;
}

/** The empty payments list for a year nothing covers. */
export function emptyListTitle(tab: PaymentsTab, year: number): string {
  return tab === 'gave' ? `No donors named for ${year}` : `No payments named for ${year}`;
}

export function emptyListWhy(year: number): string {
  return (
    `Payments are listed from the reports that cover them, and the state’s files we ` +
    `hold name none for ${year} for this committee. Earlier years’ payments are on ` +
    `their own year’s view — we do not show them under a ${year} heading.`
  );
}

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

export type ReceivedPaymentLike = {
  contributorType: string | null;
  receiptType: string | null;
  inKind: string | null;
};

export type MadePaymentLike = {
  expenditureType: string | null;
  purpose: string | null;
  vendorCity: string | null;
  vendorState: string | null;
  inKind: string | null;
};

/**
 * The grey line under a donor's name: the filing's own type, plus the schedule
 * label when the money is not a donation — a loan listed under "who gave" without
 * its label would read as a gift. The download carries no city or occupation for a
 * donor, so the row states only what the filing states.
 */
export function receivedRowMeta(payment: ReceivedPaymentLike): string {
  const parts: string[] = [];
  if (payment.contributorType) parts.push(payment.contributorType);
  if (payment.receiptType && payment.receiptType !== 'Contribution') {
    parts.push(`${payment.receiptType} — reported on its own schedule, not a donation`);
  }
  return parts.join(' · ');
}

/** The grey line under a payee's name: the plain transfer label for money given to
 *  another campaign, otherwise the filing's own purpose and the vendor's city. */
export function madeRowMeta(payment: MadePaymentLike): string {
  const parts: string[] = [];
  if (payment.expenditureType === 'Contribution') {
    parts.push('Money given to another campaign');
  }
  if (payment.purpose) parts.push(payment.purpose);
  const place = [payment.vendorCity, payment.vendorState].filter(Boolean).join(', ');
  if (place) parts.push(place);
  return parts.join(' · ');
}

export function isInKind(inKind: string | null | undefined): boolean {
  return inKind === 'Yes';
}

/** What a payments row shows, whichever direction it came from. */
export interface PaymentRow {
  /** The filing's own name for the other side, or the plain stand-in below. */
  name: string;
  meta: string;
  /** "Jul 20, 2026", or null when the filing carries no date for the payment. */
  date: string | null;
  /** "$1,250.00", or null when the filing carries no readable amount. */
  amount: string | null;
  inKind: boolean;
  /** Set only when the other side is a filer whose own page we can open. */
  linkNumber: string | null;
  linkName: string | null;
  /**
   * Set only when the other side is NOT a registered filer but IS a printed name
   * we can look up under that exact spelling (#1331). A registered filer takes
   * ``linkNumber`` instead, because a registration number identifies a committee
   * and a name does not.
   */
  nameLink: PaymentNameLink | null;
}

/**
 * Where a printed name links to, and it is a SPELLING rather than a person.
 *
 * Minnesota's filings carry no identifier for a person, an employer or a vendor,
 * so the printed string is the whole of the key. Eugene ruled on 1 Sep 2026 that
 * 2 spellings are joined only when they are identical, character for character
 * ([#1331](https://github.com/alethical-org/alethical/issues/1331)): "Messinger,
 * Alida" and "Messinger, Alida R" stay 2 keys. The rule can only under-report,
 * and it can never invent a link between 2 real people, which is the failure
 * `.claude/rules/grounded-answers.md` rule 3 forbids.
 *
 * The destination already carries that limit in its own words: the name page
 * quotes the string it searched for and says nothing is joined, so it cannot be
 * read as a profile. This type only decides which rows reach it.
 */
export interface PaymentNameLink {
  /** Which column the name was printed in, which is what the lookup keys on. */
  role: 'contributor' | 'vendor';
  /** The filing's own spelling, passed through untouched. */
  name: string;
}

/**
 * The printed name a row can be looked up under, or null when it cannot.
 *
 * Three rows deliberately do not link, and each would be a false claim rather
 * than a missing convenience:
 *
 * - **A registered filer.** It links by registration number instead, so a name
 *   match can never attribute money to the wrong committee (#1331's first
 *   acceptance criterion).
 * - **A filing that names nobody.** The row displays ``UNNAMED_PAYMENT_PARTY``,
 *   our own sentence rather than anything a filing printed, but this function is
 *   handed the filing's raw field, so a nameless payment arrives here as null or
 *   blank and the emptiness check below is what stops it. Comparing against the
 *   placeholder string as well was tried and removed: no caller can produce it,
 *   so a mutation test could not falsify it, and an unfalsifiable line in a
 *   correctness guard reads as protection that is not there.
 * - **A committee named on a transfer out.** Where a payment out is a transfer,
 *   the row shows the receiving committee's name rather than the vendor field,
 *   so looking that string up in the VENDOR column asks the wrong question.
 */
/**
 * One payment row's destination, or nothing, as an address.
 *
 * Lives here rather than in the screen or the snapshot because those 2 must
 * offer the SAME destinations: the interactive page and the first response a
 * search engine reads are the same page, and a link present in one and absent
 * from the other is a page that changes under the reader (#1812).
 */
export function paymentRowHref(row: PaymentRow): string | undefined {
  if (row.linkNumber && row.linkName) {
    return `/money/committees/${encodeURIComponent(committeeSlug(row.linkName, row.linkNumber))}`;
  }
  if (row.nameLink) {
    // Built to match `pathForRoute`'s own output for PaymentsUnderName rather
    // than imported from it, because the navigation module imports from here and
    // the snapshot already hand-builds the committee address the same way. The
    // test below pins the 2 against each other so a change to either fails.
    const params = new URLSearchParams({
      name: row.nameLink.name,
      role: row.nameLink.role,
    });
    return `/money/payments?${params.toString()}`;
  }
  return undefined;
}

function nameLinkFor(
  role: PaymentNameLink['role'],
  printed: string | null,
  registrationNumber: string | null,
): PaymentNameLink | null {
  if (registrationNumber) return null;
  const name = printed?.trim() ?? '';
  if (!name) return null;
  return { role, name };
}

/** A filing that names no counterparty says so, rather than showing a blank. */
export const UNNAMED_PAYMENT_PARTY = 'Name not given in the filing';

/**
 * One donation as a row. Shared by the full-payments screen and by the text the
 * first server response carries (#1812), so the served line and the drawn line
 * are the same characters rather than 2 similar sentences.
 */
export function receivedPaymentRow(
  payment: {
    contributor: string | null;
    contributorRegistrationNumber: string | null;
    contributorType: string | null;
    amount: string | null;
    receivedOn: string | null;
    receiptType: string | null;
    inKind: string | null;
  },
  linkable: ReadonlySet<string>,
): PaymentRow {
  return {
    name: payment.contributor ?? UNNAMED_PAYMENT_PARTY,
    meta: receivedRowMeta(payment),
    date: formatDay(payment.receivedOn),
    amount: formatMoney(payment.amount),
    inKind: isInKind(payment.inKind),
    linkNumber:
      payment.contributorRegistrationNumber && linkable.has(payment.contributorRegistrationNumber)
        ? payment.contributorRegistrationNumber
        : null,
    linkName: payment.contributor,
    // Keyed on the registration number rather than on `linkable`: a donor the
    // register knows is a filer whose own page is the honest destination, even
    // where we hold no page for it yet, so it must not fall through to a
    // spelling lookup.
    nameLink: nameLinkFor(
      'contributor',
      payment.contributor,
      payment.contributorRegistrationNumber,
    ),
  };
}

/**
 * One payment out as a row. Money given to another campaign is named by the
 * committee it reached rather than by the vendor field, because that is the fact
 * the filing records; everything else keeps the vendor's own name.
 */
export function madePaymentRow(
  payment: {
    vendorName: string | null;
    vendorCity: string | null;
    vendorState: string | null;
    affectedCommitteeName: string | null;
    affectedCommitteeRegistrationNumber: string | null;
    amount: string | null;
    paidOn: string | null;
    expenditureType: string | null;
    purpose: string | null;
    inKind: string | null;
  },
  linkable: ReadonlySet<string>,
): PaymentRow {
  const isTransfer = payment.expenditureType === 'Contribution';
  return {
    name:
      (isTransfer ? (payment.affectedCommitteeName ?? payment.vendorName) : payment.vendorName) ??
      UNNAMED_PAYMENT_PARTY,
    meta: madeRowMeta(payment),
    date: formatDay(payment.paidOn),
    amount: formatMoney(payment.amount),
    inKind: isInKind(payment.inKind),
    linkNumber:
      payment.affectedCommitteeRegistrationNumber &&
      linkable.has(payment.affectedCommitteeRegistrationNumber)
        ? payment.affectedCommitteeRegistrationNumber
        : null,
    linkName: payment.affectedCommitteeName,
    // A transfer shows the RECEIVING COMMITTEE's name, not the vendor field, so
    // that string must never reach a vendor-column lookup: passing null keeps it
    // plain text. Everything else is a real vendor and links under its spelling.
    nameLink: isTransfer
      ? null
      : nameLinkFor('vendor', payment.vendorName, payment.affectedCommitteeRegistrationNumber),
  };
}

// --- The record-coverage block ---------------------------------------------------------

/**
 * What this record covers, for the page's foot.
 *
 * **A ballot-question filer gets its own threshold line, and the figure is $500.**
 * Minnesota Statutes 10A.20 subd. 3(c) attaches its figures to what the money is FOR,
 * a candidate or a ballot question, rather than to who files, and sets $500 for a
 * ballot question. The Board's own *Independent Expenditure and Ballot Question
 * Political Committee and Fund Handbook*, its newest at 08/27/2026, says $500 for these
 * filers as well, in its itemization passage and in a worked example.
 *
 * This line used to be omitted, on a recorded belief that the 2 sources disagreed. They
 * do not: the $200 reading came from the *Political Committee and Political Fund
 * Handbook*, whose reporting instructions are written for the general-purpose kind of
 * filer. Both read at source 31 Aug 2026; Eugene lifted the ban the same day.
 */
export const RECORD_COVERS_HEADING = 'What this record covers';

/**
 * No terminal full stop on any of these (ruled 1 Sep 2026, #1924). Each renders on its
 * own line, and a stack of standalone lines takes no closing mark: the full stop makes a
 * line read as the opening of a paragraph that never arrives. The rule reaches captions,
 * labels and one-line descriptions, never the explaining paragraphs inside a money card,
 * which keep every full stop they have.
 */
export function recordCoverageLines(isBallot: boolean): string[] {
  const lines = [
    'Money filed with the Minnesota Campaign Finance and Public Disclosure Board',
    'Nothing before 2015',
    'Unions don’t report to this board at all',
  ];
  // Same shape as the $200 sentence, and it respects the same 2 rules: the test is on
  // the donor's total for the YEAR rather than on the size of a gift, and it is a floor
  // on who must be named rather than a bar on naming anyone smaller (#1755).
  lines.push(
    isBallot
      ? 'Donors who gave $500 or less in total for the year need not be named'
      : 'Donors who gave $200 or less in total for the year need not be named',
  );
  return lines;
}

// --- Shared formatting shortcuts ------------------------------------------------------

/** Re-exported so the screens import one module for these pages' rules. */
export { formatDay, formatMoney };

/**
 * The sentence a page prints where a confirmed member is withheld. It says what
 * happened and does not pretend the confirmation was withdrawn: those are
 * different facts, and `null` from the API already means "nobody has confirmed
 * one", so a withheld claim needs its own words rather than that state's.
 */
export const CONFIRMED_MEMBER_WITHHELD_LINE =
  'We are not naming whose committee this is right now. Someone at Alethical ' +
  'confirmed a member for it, but a confirmation can be taken back, and we have ' +
  'not been able to check that recently enough to repeat it here. The money on ' +
  'this page is the committee’s own filed record and is unaffected. Reload to ' +
  'try again.';
