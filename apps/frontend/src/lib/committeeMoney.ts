/**
 * What the committee money screen adds to the shared money presentation:
 * its register and ownership explanations, closed and empty-year states, Filings,
 * spending-by rows, and record coverage (#1442, campaign money phase 2).
 *
 * Framework-free so CommitteeMoneyScreen and its first served HTML use the same
 * words. The browser loads this file with that 1 screen. Shared card and period
 * wording, labels, address readers and read keys live in `committeeMoneyShared.ts`;
 * the standalone payments screen's words and rows live in `committeePaymentsPage.ts`.
 * Neither imports this screen's prose, so unrelated pages do not download it.
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
 * - The record-coverage wording uses the donor-naming threshold for the filer's
 *   kind. Shared card explanations stay in `committeeMoneyShared.ts`.
 * - A verified zero is "0". An absent official money-out total is our data gap,
 *   never a claim that the committee did not report. A closed committee keeps its
 *   own date and final-report explanation.
 */

import {
  formatDay,
  formatMoney,
  isAmountAboveZero,
  type MoneyBlockState,
} from './legislatorCampaignMoney';
import {
  isBallotQuestionFiler,
  registerKindLabel,
  paymentsTabFromParam,
  UNNAMED_PAYMENT_PARTY,
  type PaymentsTab,
} from './committeeMoneyShared';

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

/** The header line for a number our copy of the Board's register does not carry,
 *  while the state's money files still hold rows under it. A fact about our copy
 *  of the register, stated as ours. */
export const NOT_IN_REGISTER_LINE = 'Not in our copy of the Board’s register';

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
export const COMMITTEE_MONEY_SECTION_LABEL = 'Campaign money';

/** The retained spender list spans the file, independently of the cards' year. */
export const OUTSIDE_BY_ALL_YEARS = 'This list shows payments from all years in the state’s file.';

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
