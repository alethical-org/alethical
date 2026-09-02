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
 * - Missing is "Not reported"; a verified zero is "0"; a closed committee is its
 *   own state with its own date, because "not reported" and "nothing is due" are
 *   both false for it.
 */

import { formatDay, formatMoney, isAmountAboveZero } from './legislatorCampaignMoney';

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

/** "CLOSED 28 JUL 2026" — the chip beside a terminated committee's name, drawn on
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
 * Why some donations carry nobody's name, worded per filer kind. The ordinary
 * sentence states the $200 test on a donor's yearly total (rule 12's exact
 * framing), as a floor on who a committee MUST name rather than a ban on naming
 * anyone smaller: the statute's own words are that a contributor "must then be
 * listed" once the aggregate exceeds the threshold, and nothing in it forbids
 * naming a smaller one. Filer 18135's 2026 pre-general itemizes 215 donors at or
 * under $200 and reconciles to the cent
 * (`docs/architecture/campaign-finance-system-design.md` §2.3), so "are never
 * named" was a false absolute (#1755). A ballot-question filer's page carries a
 * threshold of **$500** rather than the $200 a candidate's committee carries, because
 * that is what both sources covering these filers say: Minnesota Statutes 10A.20
 * subd. 3(c), and the Board's own *Independent Expenditure and Ballot Question Political
 * Committee and Fund Handbook* (revised 08/27/2026, its newest), in its itemization
 * passage and a worked example. Both read at source 31 Aug 2026.
 *
 * **Two earlier versions of this sentence were wrong, in opposite directions, and both
 * are worth remembering.** It first told readers "official sources disagree about that
 * threshold for ballot-question committees", which was false and was live on filer
 * 60083's 2025 page beside $8,459.00 of unnamed money. The $200 reading it rested on
 * came from the *Political Committee and Political Fund Handbook*, whose reporting
 * instructions are written for the general-purpose kind of filer: a handbook for
 * different filers, not a source that contradicts. It then stated no figure at all,
 * which was honest but told a reader less than Minnesota publishes. Eugene lifted the
 * ban on 31 Aug 2026.
 */
export function unnamedMoneyExplanation(isBallot: boolean): string {
  if (isBallot) {
    return (
      'These donations are inside the committee’s own reported total, and the ' +
      'state’s public file does not say who gave them. Minnesota only makes a ' +
      'ballot-question committee name a donor once that donor has given more than ' +
      '$500 in total for the year, which is a higher line than the $200 a ' +
      'candidate’s committee carries. A committee may name a smaller donor but ' +
      'does not have to.'
    );
  }
  return (
    'Minnesota only makes a committee name a donor once that donor has given more ' +
    'than $200 in total for the year. A committee may name a smaller donor but does ' +
    'not have to, and for this money the state’s public file does not say who gave it.'
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

export const CLOSED_MONEY_OUT_WHY =
  'Payments out are reported in that same final report, so they are unavailable here for the same reason.';

export function emptyYearMoneyInWhy(year: number): string {
  return (
    `No report figures covering ${year} are in the state’s files we hold for this ` +
    `committee. Earlier years’ figures stay under their own years — we do not carry ` +
    `them forward.`
  );
}

export const EMPTY_YEAR_MONEY_OUT_WHY =
  'Payments out are reported in the same filings as contributions, so they are unavailable for this year for the same reason.';

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

// --- Money out labels ----------------------------------------------------------------

/**
 * The plain label for a money-out kind. `Contribution` on the expenditures file is
 * money given to another committee — statewide, $270M of $712M money-out — and for
 * a caucus that share is the point, so it gets the plain words. Every other label
 * is the source's own, verbatim.
 */
export function moneyOutKindLabel(expenditureType: string): string {
  return expenditureType === 'Contribution' ? 'Given to other campaigns' : expenditureType;
}

/** Money out is never called "spent": 38% of it statewide is money given to other
 *  committees, so the neutral heading is fixed here where a test can hold it. */
export const MONEY_OUT_FIGURE_LABEL = 'Payments we can list';

/** The filing's own money-out total — rule 12's second number for this card,
 *  labelled as the filing's claim, never as "spent". */
export const MONEY_OUT_REPORTED_LABEL = 'Payments out this committee reported to the state';

/**
 * Whether our listable payments total is larger than the committee's own reported total.
 *
 * The one comparison the money-out note has to make, and it is a comparison rather than a
 * subtraction: the 2 figures are never subtracted, only asked which is bigger, because
 * which is bigger decides which sentence is true. Blank or unreadable on either side is
 * false, so a missing figure never produces a claim about a gap.
 */
export function listedExceedsReported(
  reportedTotal: string | number | null | undefined,
  listedTotal: string | number | null | undefined,
): boolean {
  // Blank before numeric, and this order is the whole guard. `Number(null)` and
  // `Number('')` are both 0, so a missing reported total would read as 0 and every
  // listable figure would look like a gap. A non-numeric string needs no check: it
  // becomes NaN and every comparison against NaN is already false.
  if (reportedTotal === null || reportedTotal === undefined || reportedTotal === '') return false;
  if (listedTotal === null || listedTotal === undefined || listedTotal === '') return false;
  return Number(listedTotal) > Number(reportedTotal);
}

/**
 * The sentence under the money-out figure, per served state. A ballot-question filer's
 * page names the payments threshold without a figure: the $500 the statute and the
 * Board's handbook set is the donor-itemization threshold, and no source we hold sets a
 * ballot-question figure for the payments file.
 */
export function moneyOutNote(
  state: 'reported' | 'not_reported' | 'unavailable',
  isBallot: boolean,
  hasReportedTotal = false,
  reportedTotalIsZero = false,
  ourListExceedsReportedTotal = false,
): string {
  if (state === 'unavailable') {
    return 'We could not read this committee’s payments out of our copy of Minnesota’s file.';
  }
  if (state === 'not_reported') {
    if (hasReportedTotal && reportedTotalIsZero) {
      // The filing's own zero: "that does not mean it paid out nothing" would
      // contradict the committee's own report sitting right above it.
      return (
        'The committee’s own report to the state says it paid out nothing in this ' +
        'period, and the state’s payments file names no payment for it. That is the ' +
        'filing’s own zero, not a gap in our records.'
      );
    }
    if (hasReportedTotal) {
      return (
        'The total above is the filing’s own figure. The state’s payments file names ' +
        'none of its payments for this year' +
        (isBallot ? '' : ' — it names only recipients paid more than $200 in total for the year') +
        ', so we cannot list any of them.'
      );
    }
    return isBallot
      ? 'Minnesota’s public file names only payments above a naming threshold, and it names none for this committee this year. That does not mean the committee paid out nothing.'
      : 'Minnesota only names a recipient once payments to them pass $200 in total for the year, and it named none for this committee this year. That does not mean the committee paid out nothing.';
  }
  if (hasReportedTotal) {
    // **The naming threshold cannot explain a list that is BIGGER than the filing's own
    // total, and saying it does is a false claim on a named politician's page.** The
    // threshold only ever holds payments back, so it can only make our list smaller. On
    // Lisa Demuth's Governor committee for 2025 our list is $60,286.21 against the
    // filing's $41,331.05 — $18,955.16 larger — and the sentence below used to blame the
    // threshold for it. Measured across every filer-year where a reader can see both
    // figures: 389 of 3,613 have our list larger, $17,267,605.45 in total, and 25 of
    // those sit on a committee a person has confirmed for a sitting legislator, so they
    // render inside a legislator profile as well as on a committee page.
    //
    // What actually causes it, measured to the cent on that committee: the filing's total
    // counts cash, and the state's payments file also carries goods and services. In-kind
    // fully accounts for the excess on 254 of the 389, which is most of them and not all
    // of them, so this sentence names the mechanism WITHOUT claiming it explains this
    // committee's gap. Naming a cause that is right 254 times out of 389 on a named
    // person's page is the same failure in a new coat.
    //
    // This sentence stays general on purpose, and that is no longer because the figure
    // is missing. Since
    // [#1894](https://github.com/alethical-org/alethical/issues/1894) the server sends
    // an in-kind money-out total and `inKindOutNote` below prints it as its own line,
    // the same shape the money-IN card uses for `named_in_kind_total`. The 2 lines do
    // different jobs: that one states an amount we hold, this one says the 2 figures
    // count different things and refuses to name a cause for the gap. Folding the
    // amount into this sentence would turn a fact into an explanation, which is the
    // 254-of-389 guess the paragraph above is about.
    if (ourListExceedsReportedTotal) {
      return (
        'These are 2 different figures from Minnesota and we never subtract one from the ' +
        'other. They can disagree in either direction because they count different ' +
        'things: the committee’s own report counts money it paid, while the state’s ' +
        'payments file also carries goods and services given to it, and the file names a ' +
        'recipient only once payments to them pass $200 in total for the year. ' +
        'Money out is not all spending: some of it is money given to other campaigns, ' +
        'listed below.'
      );
    }
    return isBallot
      ? 'The total above is the filing’s own figure for the period it names. The payments we can list come from the state’s payments file, which names only payments above a naming threshold, so the two are different figures and we do not subtract one from the other. Money out is not all spending: some of it is money given to other campaigns, listed below.'
      : 'The total above is the filing’s own figure for the period it names. The payments we can list come from the state’s payments file, which names a recipient only once payments to them pass $200 in total for the year, so the two are different figures and we do not subtract one from the other. Money out is not all spending: some of it is money given to other campaigns, listed below.';
  }
  return isBallot
    ? 'Our copy of the state’s figures holds no reported total for this year’s money out, so there is no bigger number to compare this against. Money out is not all spending: some of it is money given to other campaigns, listed below.'
    : 'Our copy of the state’s figures holds no reported total for this year’s money out, so there is no bigger number to compare this against. Minnesota only names a recipient once payments to them pass $200 in total for the year. Money out is not all spending: some of it is money given to other campaigns, listed below.';
}

/**
 * What the money-out card says about whether anyone checked it, or null when the
 * ordinary case needs no decoration.
 *
 * The money-out twin of `statedSplitNote` in `legislatorCampaignMoney.ts`, and it
 * exists because until [#1650](https://github.com/alethical-org/alethical/issues/1650)
 * a spending figure nobody had compared against the committee's own filed report was
 * drawn exactly like one that had been. Measured on the live release, 1 Sep 2026,
 * across all 4,124 committee-years of 2024, 2025 and 2026 that the check reaches:
 * 3,313 agree, 208 disagree, 481 the Board serves us no document for, and 122 our own
 * reader could not prove itself on.
 *
 * **`disagrees` gets its own sentence, and it is the reason this function is not just
 * a caveat.** 40 of the 208 are the direction that publishes silently: the committee's
 * own filing itemizes $495,305.39 of payments our copy does not hold, 17 of those
 * committee-years holding not one row while the filing names money out. On those pages
 * "Payments we can list" is short, and the card's ordinary note offers 2 benign reasons
 * for a gap — the $200 naming threshold and goods and services — neither of which
 * applies to a figure the filing's own itemized subtotal contradicts. Leaving that
 * explanation standing alone would hand a reader a reassurance the check has already
 * disproved.
 *
 * **It never says which figure is the larger one.** The 208 run in both directions,
 * 168 of them ours being larger, so any wording that picks a side is wrong about a
 * third of the time — the same trap `splitExplanation` fell into on the money-in side.
 *
 * **No figure is withheld, and that is Eugene's ruling of 12 Aug 2026 rather than a
 * softer reading of it**: where 2 of Minnesota's own publications disagree and we
 * cannot derive the truth, we show both and say plainly that they disagree. Money out
 * prints no derived third number, so unlike the money-in split there is nothing a
 * disagreement could make false by subtraction.
 */
export function statedSpendingNote(state: string | null | undefined): string | null {
  if (state === 'agrees') return null;
  if (state === 'disagrees') {
    return (
      'We compared this against the report the committee filed, and the two do not ' +
      'agree: its own filing itemizes a different amount of money out from the one ' +
      'the state’s payments file holds for it. We show what each says and work out ' +
      'neither, because we cannot tell which is right.'
    );
  }
  return (
    'We have not yet compared this against the report the committee filed, so we ' +
    'cannot rule out that its filing names payments our copy is missing.'
  );
}

/**
 * The money-out card's goods-and-services line, or null when there is nothing to say.
 *
 * Minnesota's payments file carries goods and services given to a committee as a
 * payment out marked in kind, so an itemized money-out figure is not all cash, and a
 * reader shown only the total will read all of it as cash spent. The money-in card has
 * said exactly how much was goods and services since #1332; money out could only name
 * the mechanism until the server started sending this figure
 * ([#1894](https://github.com/alethical-org/alethical/issues/1894)).
 *
 * **States an amount and explains nothing.** It does not say this is why the 2 money-out
 * figures differ, because on 254 of the 389 committee-years where our list is the larger
 * figure in-kind fully accounts for the gap and on the other 135 it does not, and naming
 * a cause that is right two-thirds of the time under a named politician's photograph is
 * the failure `.claude/rules/grounded-answers.md` rule 3 forbids.
 *
 * Null covers 2 different facts and prints nothing for both, which is deliberate: a
 * committee-year we hold no payment rows for sends no figure at all, and one whose rows
 * are all cash sends a measured 0. Rule 12 forbids printing "$0.00" for the first, and
 * the second is a sentence with no information in it.
 */
export function inKindOutNote(inKindTotal: string | null | undefined): string | null {
  if (!isAmountAboveZero(inKindTotal)) return null;
  return (
    `${formatMoney(inKindTotal ?? null)} of the payments above were goods and services ` +
    'rather than money. The state counts those separately from the total the committee ' +
    'reported.'
  );
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

/** The committee page's three tabs. The full-payments view keeps `PaymentsTab`:
 *  filings have no "see every payment" page behind them. */
export type CommitteeTab = PaymentsTab | 'filings';

export function committeeTabFromParam(raw: string | undefined | null): CommitteeTab {
  if (raw === 'filings') return 'filings';
  return paymentsTabFromParam(raw);
}

export const COMMITTEE_TAB_LABELS: Record<CommitteeTab, string> = {
  gave: 'Who gave',
  spent: 'Where it went',
  filings: 'Filings',
};

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
 * "Filed 24 Jul 2026", or null on a row the Board states no filing date for.
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
  'We load 250 at a time, largest first — the cap is ours, not the filing’s. The ' +
  'reports these payments come from list every one of them, and they are public.';

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
  /** "20 Jul 2026", or null when the filing carries no date for the payment. */
  date: string | null;
  /** "$1,250.00", or null when the filing carries no readable amount. */
  amount: string | null;
  inKind: boolean;
  /** Set only when the other side is a filer whose own page we can open. */
  linkNumber: string | null;
  linkName: string | null;
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
