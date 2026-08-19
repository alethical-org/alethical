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
 * - A ballot-question page asserts no donor-naming threshold anywhere: the statute
 *   says $500 for ballot questions, the Board's own handbook for those filers says
 *   $200, and we print neither.
 * - Missing is "Not reported"; a verified zero is "0"; a closed committee is its
 *   own state with its own date, because "not reported" and "nothing is due" are
 *   both false for it.
 */

import { formatDay, formatMoney } from './legislatorCampaignMoney';

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

/**
 * The header's eyebrow. The register kind, except for the two Board sub-type codes
 * that say "ballot question" — those name the finer kind the code itself states.
 * An unknown kind prints nothing rather than a guess.
 */
export function committeeEyebrow(
  registerKind: string | null | undefined,
  entitySubType: string | null | undefined,
): string | null {
  if (entitySubType === 'BC') return 'Ballot question committee';
  if (entitySubType === 'BF') return 'Ballot question fund';
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

/**
 * Whose committee this is. A committee page is complete where a profile is empty —
 * the money is filed BY committee — and the only thing missing is the link to a
 * person. The filed name is not that link: it is the filer's own wording, not a
 * confirmation by anyone (design doc §5.1). Party units, funds and ballot-question
 * committees are nobody's, so their sentence must not imply a person is missing.
 */
export function whoseCommitteeText(
  registerKind: string | null | undefined,
  entitySubType: string | null | undefined,
): string {
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

/**
 * Why some donations carry nobody's name, worded per filer kind. The ordinary
 * sentence states the $200 test on a donor's yearly total (rule 12's exact
 * framing). A ballot-question filer's page states no threshold at all — the
 * statute says $500 for ballot questions and the Board's own handbook for those
 * filers says $200, so we assert neither — and says only what the file shows.
 */
export function unnamedMoneyExplanation(isBallot: boolean): string {
  if (isBallot) {
    return (
      'These donations are inside the committee’s own reported total, and the ' +
      'state’s public file does not say who gave them. Minnesota names a donor ' +
      'only once their giving passes a yearly threshold; official sources disagree ' +
      'about that threshold for ballot-question committees, so we do not state it.'
    );
  }
  return (
    'Minnesota only makes a committee name a donor once that donor has given more ' +
    'than $200 in total for the year. Donors who gave $200 or less in total are ' +
    'never named, so their money is counted here and the state’s public file does ' +
    'not say who gave it.'
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
 * The sentence under the money-out figure, per served state. A ballot-question
 * filer's page prints no threshold figure in it — the same silence rule 12 sets
 * for the donor side, because the statute's ballot-question figures and the
 * Board's own handbook disagree and we assert neither.
 */
export function moneyOutNote(
  state: 'reported' | 'not_reported' | 'unavailable',
  isBallot: boolean,
  hasReportedTotal = false,
  reportedTotalIsZero = false,
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
        (isBallot
          ? ''
          : ' — it names only recipients paid more than $200 in total for the year') +
        ', so we cannot list any of them.'
      );
    }
    return isBallot
      ? 'Minnesota’s public file names only payments above a naming threshold, and it names none for this committee this year. That does not mean the committee paid out nothing.'
      : 'Minnesota only publishes a committee’s payments over $200, and it published none for this committee this year. That does not mean the committee paid out nothing.';
  }
  if (hasReportedTotal) {
    // Two numbers, both correct, never subtracted — the same rule as money in.
    return isBallot
      ? 'The total above is the filing’s own figure for the period it names. The payments we can list come from the state’s payments file, which names only payments above a naming threshold, so the two are different figures and we do not subtract one from the other. Money out is not all spending: some of it is money given to other campaigns, listed below.'
      : 'The total above is the filing’s own figure for the period it names. The payments we can list come from the state’s payments file, which names only payments over $200, so the two are different figures and we do not subtract one from the other. Money out is not all spending: some of it is money given to other campaigns, listed below.';
  }
  return isBallot
    ? 'Our copy of the state’s figures holds no reported total for this year’s money out, so there is no bigger number to compare this against. Money out is not all spending: some of it is money given to other campaigns, listed below.'
    : 'Our copy of the state’s figures holds no reported total for this year’s money out, so there is no bigger number to compare this against. Minnesota only publishes payments over $200. Money out is not all spending: some of it is money given to other campaigns, listed below.';
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
      ? ' Donors who gave $200 or less in total for the year are never named in the filing, so these payments never sum to the total on the committee’s page.'
      : ' Recipients paid $200 or less in total for the year are never named in the filing, so these payments never sum to the total on the committee’s page.';
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

// --- The record-coverage block ---------------------------------------------------------

/**
 * What this record covers, for the page's foot. The donor-threshold line is left
 * off a ballot-question filer's page: the statute and the Board's own handbook
 * disagree about that threshold, and we assert neither (rule 12, as amended).
 */
export function recordCoverageLines(isBallot: boolean): string[] {
  const lines = [
    'Money filed with the Minnesota Campaign Finance and Public Disclosure Board.',
    'Nothing before 2015.',
    'Unions don’t report to this board at all.',
  ];
  if (!isBallot) {
    lines.push('Donors who gave $200 or less in total for the year are never named.');
  }
  return lines;
}

// --- Shared formatting shortcuts ------------------------------------------------------

/** Re-exported so the screens import one module for these pages' rules. */
export { formatDay, formatMoney };
