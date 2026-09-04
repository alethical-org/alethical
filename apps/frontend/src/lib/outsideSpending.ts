import { formatDay, formatMoney } from './legislatorCampaignMoney';
import { centralDateLabel, formatCount } from './moneyLanding';

// Wording and figures for the outside-spending block on a legislator's profile
// ([#1332](https://github.com/alethical-org/alethical/issues/1332)). Pure functions,
// unit-tested, shared by the web and mobile profile layouts so the two cannot drift
// into saying different things about the same money.
//
// Outside spending is money a group that is not the candidate's campaign spends to
// support or oppose them. Minnesota calls it an independent expenditure. It never
// passes through the campaign and appears in no filing the campaign makes, so a
// reader who reads only the candidate's own report is missing part of the picture
// and has no way to know it.
//
// Three rules from `.claude/rules/grounded-answers.md` rule 12 bind everything here,
// and each one is a way the block could be wrong while every number on it was right:
//
// * **A missing figure and a real zero are different facts.** No outside group
//   spending on a race is ordinary and reads as 0. No confirmed committee link, a
//   stale release, and rows we hold but cannot total each read as "not available",
//   and never as 0.
// * **Never say what the money meant.** That a group spent $50,000 opposing a
//   lawmaker is a fact with a filing behind it. That it changed anything is not, so
//   no label here says received, raised, backed, allied, welcomed or coordinated,
//   and the two sides are never subtracted from one another to imply a net position.
// * **Never chain transfers.** Nothing here follows money from one account into
//   another, because money is fungible and no filing says which dollar went out.

/**
 * Which answer this year carries. Read it before any figure.
 *
 * The first 3 are the server's own. `load_failed` never comes from the server: it is
 * what a year gets when its request did not arrive, so one year failing cannot delete
 * the other year's real figures. Its own sentence, because a request that failed is a
 * different fact from a download of ours that is stale, and telling a reader the
 * filings are out of date when the network dropped would be a claim we cannot support.
 */
export type OutsideSpendingState = 'reported' | 'link_unconfirmed' | 'unavailable' | 'load_failed';

export interface OutsideSpendingCommittee {
  registrationNumber: string;
  name: string;
  /** The office the reviewer recorded, when they recorded one. */
  office: string | null;
}

export interface OutsideSpendingYear {
  year: number;
  state: OutsideSpendingState;
  /** Which download answered, so 2 years can be checked for agreeing on one. */
  snapshotId: string | null;
  /**
   * The committees these figures cover, named. A member can hold several at once, and
   * the figures are a sum across every one a person has confirmed -- so a page that
   * does not name them says "spent about this legislator" over a total that may cover
   * one committee out of several, or 2 races at once.
   */
  committees: OutsideSpendingCommittee[];
  /** Null in every state but `reported`, where a 0 is a measured 0. */
  supporting: number | null;
  opposing: number | null;
  /**
   * Money whose "For" or "Against" the filing does not record. 0 for every
   * committee in the current release, so the block shows it only when it is not.
   */
  directionNotRecorded: number | null;
  /**
   * Each figure's own payment count. Kept apart rather than shared, because one
   * count printed under 2 figures says the same payments produced each of them.
   */
  supportingPayments: number | null;
  opposingPayments: number | null;
  directionNotRecordedPayments: number | null;
  firstPaymentOn: string | null;
  lastPaymentOn: string | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
}

export interface OutsideSpendingFigure {
  key: 'supporting' | 'opposing' | 'directionNotRecorded';
  label: string;
  amount: number;
  payments: number;
}

/**
 * The figures to draw, in order, for one year.
 *
 * `supporting` and `opposing` always appear when the state is `reported`, because a
 * measured 0 is a finding worth printing. The third appears only when it is not 0:
 * every one of the 41,130 rows in the current release records For or Against, so a
 * permanently-visible empty figure would tell a reader Minnesota leaves the question
 * open when it does not.
 */
export function outsideSpendingFigures(year: OutsideSpendingYear): OutsideSpendingFigure[] {
  if (year.state !== 'reported') return [];
  const figures: OutsideSpendingFigure[] = [
    {
      key: 'supporting',
      label: 'Spent supporting them',
      amount: year.supporting ?? 0,
      payments: year.supportingPayments ?? 0,
    },
    {
      key: 'opposing',
      label: 'Spent opposing them',
      amount: year.opposing ?? 0,
      payments: year.opposingPayments ?? 0,
    },
  ];
  // Gated on the payment count, not the amount. A row can be held and total 0 or less
  // -- 2 unreadable rows that cancel out, or a negative correction -- and gating on the
  // money would then keep the payments in the page while the figure vanished, which is
  // the same disappearance #1454 exists to stop. 0 of the live release's rows are
  // negative (measured 13 Aug 2026), so this is the cheaper guard rather than a fix for
  // something happening now.
  if ((year.directionNotRecordedPayments ?? 0) > 0) {
    figures.push({
      key: 'directionNotRecorded',
      label: 'Spent where the filing does not say which',
      amount: year.directionNotRecorded ?? 0,
      payments: year.directionNotRecordedPayments ?? 0,
    });
  }
  return figures;
}

/**
 * How many payments the year's figures are built from, or null when there is no
 * figure to build them from.
 *
 * The 3 counts the server keeps apart are added here and only here, because this is
 * the one sentence where the whole is what a reader needs. A figure's own label
 * never borrows this number.
 */
export function outsideSpendingPaymentCount(year: OutsideSpendingYear): number | null {
  if (year.state !== 'reported') return null;
  return (
    (year.supportingPayments ?? 0) +
    (year.opposingPayments ?? 0) +
    (year.directionNotRecordedPayments ?? 0)
  );
}

/**
 * Whether this year is the checked, published finding that nobody spent anything.
 *
 * Only ever true for a `reported` year, which is what keeps it apart from the empty
 * states below: those are facts about our records and must never read as a 0.
 */
export function isMeasuredZero(year: OutsideSpendingYear): boolean {
  return outsideSpendingPaymentCount(year) === 0;
}

/**
 * Why there is no figure, in the reader's words, or null when there is one.
 *
 * Each sentence says what is missing and whose fact it is. Neither ever suggests
 * the amount was small, or 0, or that the legislator had no outside spending.
 */
export function outsideSpendingUnavailableReason(year: OutsideSpendingYear): string | null {
  if (year.state === 'reported') return null;
  if (year.state === 'load_failed') {
    return (
      'We could not load this year. That is a problem at our end and says nothing ' +
      'about what was spent.'
    );
  }
  if (year.state === 'link_unconfirmed') {
    return (
      'Minnesota records this spending against a campaign committee and never against ' +
      'a person, so someone has to confirm by hand which committee is this ' +
      "legislator's. Nobody has confirmed theirs yet, so we cannot say what was spent " +
      'about them. This is a gap in our records, not a sign that no money was spent.'
    );
  }
  return (
    'We cannot show a figure right now, because our copy of the state filings is ' +
    'either out of date or holds a payment we cannot add up. This is a gap in our ' +
    'records, not a sign that no money was spent.'
  );
}

/**
 * One reason covering every year, or null when the years differ.
 *
 * Today every legislator has no confirmed committee link, so both years carry the
 * same sentence and printing it twice under 2 year headings says nothing the first
 * one did not. It is also misleading in shape: 2 headings imply the answer is about
 * the years, when the reason is about the person and holds for every year there will
 * ever be. Null the moment the years disagree, so a year that really is different
 * keeps its own line.
 */
export function outsideSpendingSharedReason(years: OutsideSpendingYear[]): string | null {
  if (years.length === 0) return null;
  const reasons = years.map((year) => outsideSpendingUnavailableReason(year));
  if (reasons.some((reason) => reason === null)) return null;
  return reasons.every((reason) => reason === reasons[0]) ? reasons[0] : null;
}

/**
 * The span the year's payments fall in, e.g. `Feb 3, 2025 to Oct 28, 2025`.
 *
 * Rule 12 asks every total to state the period it covers, and this is the filing's
 * own answer rather than an assumption that a year runs from 1 January. Null when no
 * payment carries a date, so nothing invents a range.
 */
export function outsideSpendingPeriod(year: OutsideSpendingYear): string | null {
  if (year.state !== 'reported') return null;
  if (!year.firstPaymentOn || !year.lastPaymentOn) return null;
  const first = formatDay(year.firstPaymentOn);
  const last = formatDay(year.lastPaymentOn);
  if (!first || !last) return null;
  return first === last ? first : `${first} to ${last}`;
}

/**
 * One freshness date for the block, whichever year carries it.
 *
 * One date, not one per year, because both years come out of the same download and
 * two dates on one block would read as two separate fetches.
 */
export function outsideSpendingFetchedOn(years: OutsideSpendingYear[]): string | null {
  if (!yearsShareOneDownload(years)) return null;
  const stamped = years.find((year) => year.fetchedAt);
  return stamped?.fetchedAt ? centralDateLabel(stamped.fetchedAt) : null;
}

/**
 * Whether every year that answered came from the same download.
 *
 * Each year is its own request and each resolves the live download on its own, so a
 * publish landing between them pairs one year's money with another year's freshness
 * date. Rather than print a date that is true of only one of the figures beneath it,
 * the block prints none. Rare -- publishing is a person running an import -- and
 * cheap to be right about.
 */
export function yearsShareOneDownload(years: OutsideSpendingYear[]): boolean {
  const seen = years.map((year) => year.snapshotId).filter((id): id is string => Boolean(id));
  return new Set(seen).size <= 1;
}

/**
 * The placeholder for a year whose request did not arrive.
 *
 * Every figure null, so nothing can be printed for it, and its own state so its
 * sentence says what actually happened. Exists because the 2 years are 2 requests: with
 * one combined promise, either year failing threw away the other year's real figures
 * and replaced them with a whole-card error. Found by an automated review on #1332.
 */
export function outsideSpendingLoadFailure(year: number): OutsideSpendingYear {
  return {
    year,
    state: 'load_failed',
    snapshotId: null,
    committees: [],
    supporting: null,
    opposing: null,
    directionNotRecorded: null,
    supportingPayments: null,
    opposingPayments: null,
    directionNotRecordedPayments: null,
    firstPaymentOn: null,
    lastPaymentOn: null,
    sourceUrl: null,
    fetchedAt: null,
  };
}

/**
 * The sentence naming which committees a year's figures cover, or null.
 *
 * Required, not decoration. The figures are a sum across every committee a person has
 * confirmed, and 2 things follow that a bare total hides. A member can hold several
 * committees while only 1 has been reviewed, so the total may cover a fraction of their
 * money; and a member can hold committees for different offices, which the sum combines.
 * Naming them makes the figures speak for exactly what they cover -- the same division of
 * labour rule 11 sets, where the model describes records and the layout owns the scope.
 *
 * §7 of the campaign-finance design asks for this directly: a figure must say which
 * committee it belongs to rather than only which year.
 */
export function outsideSpendingCoverage(year: OutsideSpendingYear): string | null {
  if (year.state !== 'reported' || year.committees.length === 0) return null;
  const named = year.committees.map((committee) =>
    committee.office ? `${committee.name} (${committee.office})` : committee.name,
  );
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return named.length === 1
    ? `Covers the one committee somebody has confirmed is theirs: ${list}. Any committee of theirs nobody has checked yet is not in these figures.`
    : `Covers the ${named.length} committees somebody has confirmed are theirs, added together: ${list}. Any committee of theirs nobody has checked yet is not in these figures.`;
}

/**
 * The 2 calendar years the block asks about: this one and the one before.
 *
 * Derived rather than written down, because a hardcoded pair goes stale in silence.
 * The downloads reach 2015 to the present, so on 1 January the newer year is one the
 * files do not hold yet — which the server answers as a gap rather than as a zero, so
 * the honest answer arrives on its own instead of needing a rule here.
 */
export function outsideSpendingYears(today: Date): number[] {
  const year = today.getFullYear();
  return [year, year - 1];
}

/** The source link, whichever year carries it. */
export function outsideSpendingSourceUrl(years: OutsideSpendingYear[]): string | null {
  return years.find((year) => year.sourceUrl)?.sourceUrl ?? null;
}

// ---------------------------------------------------------------------------
// The outside-spending record page at /money/outside-spending (#1945).
//
// Three views over one record, chosen in the address: the whole record (no
// parameter), one group that spent (`?spender=<registration number>`), and one
// committee the spending was about (`?about=<registration number>`). Every
// sentence the page prints lives here so a test can pin it, and so the drawing's
// words are never retyped inside a screen.
//
// The same 3 rules as the profile block above bind this page, plus one the page
// adds: one subject per figure. A total is the sum over the record as a whole, one
// group, or one committee, and nothing sets 2 subjects side by side, because the
// state publishes no date telling us when any report arrived.
// ---------------------------------------------------------------------------

export type OutsideSpendingRecordState = 'reported' | 'not_reported' | 'unavailable';

export type OutsideSpendingView = 'record' | 'spender' | 'about';

export type OutsideSpendingSort = 'newest' | 'largest';

export interface OutsideSpendingRecordRow {
  spender: string | null;
  spenderRegistrationNumber: string | null;
  spenderInRegister: boolean;
  spenderLinkable: boolean;
  aboutCommitteeName: string | null;
  aboutCommitteeRegistrationNumber: string | null;
  aboutCommitteeInRegister: boolean;
  aboutCommitteeLinkable: boolean;
  /** The server's own 3 values: "For", "Against", or "not recorded". */
  direction: string;
  directionAsFiled: string | null;
  purpose: string | null;
  vendorName: string | null;
  expenditureType: string | null;
  inKind: boolean;
  paidOn: string | null;
  year: number | null;
  amount: string | null;
  unpaidAmount: string | null;
}

export interface OutsideSpendingRecordFigures {
  rowCount: number;
  rowsMissingAnAmount: number;
  amountTotal: string | null;
  supportingCount: number;
  supportingAmount: string | null;
  opposingCount: number;
  opposingAmount: string | null;
  directionNotRecordedCount: number;
  directionNotRecordedAmount: string | null;
  inKindCount: number;
  firstYear: number | null;
  lastYear: number | null;
  committeeCount: number;
  spenderCount: number;
  committeesNotLinkable: number | null;
}

export interface OutsideSpendingSubject {
  registrationNumber: string;
  name: string | null;
  inRegister: boolean;
  linkable: boolean;
  kind: string | null;
  office: string | null;
  district: string | null;
  confirmedMember: { slug: string; fullName: string } | null;
}

export interface OutsideSpendingRecordPage {
  state: OutsideSpendingRecordState;
  about: OutsideSpendingSubject | null;
  spender: OutsideSpendingSubject | null;
  year: number | null;
  sort: OutsideSpendingSort;
  rows: OutsideSpendingRecordRow[];
  pageNumber: number;
  pageSize: number;
  totalRows: number | null;
  hasMore: boolean;
  figures: OutsideSpendingRecordFigures | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
}

/** The address's own parameters, as the screen receives them. */
export interface OutsideSpendingAddress {
  spender?: string;
  about?: string;
  year?: string;
  sort?: string;
  page?: string;
}

/** Which of the 3 views an address asks for. A spender wins where both are given,
 *  because the rows are then that group's own record narrowed by one committee. */
export function outsideSpendingView(address: OutsideSpendingAddress): OutsideSpendingView {
  if (address.spender) return 'spender';
  if (address.about) return 'about';
  return 'record';
}

/** The sort an address asks for; anything but "largest" is the newest-first default. */
export function outsideSpendingSort(raw: string | null | undefined): OutsideSpendingSort {
  return raw === 'largest' ? 'largest' : 'newest';
}

/** The 1-based page an address asks for; anything unreadable is page 1. */
export function outsideSpendingPageNumber(raw: string | null | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** The filing year an address asks for, or null for every year the file holds. */
export function outsideSpendingYear(raw: string | null | undefined): number | null {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 2015 ? parsed : null;
}

export const OUTSIDE_SPENDING_PATH = '/money/outside-spending';

// --- The page's own words, from the drawing (Money outside spending.dc.html) ---

export const OUTSIDE_SPENDING_EYEBROW = 'Campaign money';
export const OUTSIDE_SPENDING_HEADING = 'Spending by groups that are not the campaign';
export const OUTSIDE_SPENDING_STANDFIRST =
  'Minnesota law requires this spending to be made without the candidate’s cooperation. ' +
  'So the record shows what a group spent — not what a campaign received, and not what ' +
  'any of it achieved.';

/** The 3 view buttons. The whole-record button reads "The whole record"; the word
 *  "explorer" is retired and never printed. */
export const OUTSIDE_SPENDING_VIEW_LABELS: Record<OutsideSpendingView, string> = {
  record: 'The whole record',
  spender: 'One group',
  about: 'One committee',
};

export const BACK_TO_OUTSIDE_SPENDING = 'Outside spending';

export const WHAT_THE_RECORD_HOLDS = 'What the record holds';
export const DIRECTION_AS_FILED = 'Direction, as the filing states it';
export const IN_KIND_LABEL = 'In kind';

/** "across 41,130 payments, 2015 through 2026". Payments, not expenditures: the
 *  ruled count line for these rows uses that word (1 Sep 2026). */
export function recordSpanLine(figures: OutsideSpendingRecordFigures): string {
  const payments = `${formatCount(figures.rowCount)} ${figures.rowCount === 1 ? 'payment' : 'payments'}`;
  if (figures.firstYear === null || figures.lastYear === null) return `across ${payments}`;
  if (figures.firstYear === figures.lastYear) return `across ${payments}, ${figures.firstYear}`;
  return `across ${payments}, ${figures.firstYear} through ${figures.lastYear}`;
}

/** "31,718 supporting", counted rows, for the whole record's direction line. */
export function directionCountLine(count: number, direction: 'supporting' | 'opposing'): string {
  return `${formatCount(count)} ${direction}`;
}

export function inKindCountLine(count: number): string {
  return `${formatCount(count)} in goods or services`;
}

/** The sentence under the whole record's direction figures. Printed only while
 *  every row states a direction, which is what it claims; the moment a row does
 *  not, the third figure appears instead and this sentence goes. */
export const EVERY_ROW_STATES_A_DIRECTION =
  'Every row states a direction, so nothing here is filed without one. In-kind rows are ' +
  'counted in both figures above, not beside them.';

export function directionNotRecordedLine(count: number): string {
  return `${formatCount(count)} where the filing does not say which`;
}

export const IN_KIND_COUNTED_INSIDE =
  'In-kind rows are counted inside the figures above, not beside them.';

export const LANE_BY_SPENDER = {
  title: 'By the group that spent',
  body:
    'Independent-expenditure committees and funds, and the ordinary political committees ' +
    'that also report this spending.',
};

export const LANE_BY_COMMITTEE_TITLE = 'By the committee it was about';

/**
 * The committee lane's sentence. The count is served, never pasted: it is the
 * committees spent about whose number resolves to no page of ours, and it is
 * omitted while we hold no register to ask.
 */
export function laneByCommitteeBody(committeesNotLinkable: number | null): string {
  const first = 'Every row names a committee, never a person.';
  if (committeesNotLinkable === null) return first;
  return (
    `${first} ${formatCount(committeesNotLinkable)} of those names are not in the Board’s ` +
    'register we hold and have no filing of their own, so they can only be printed as filed.'
  );
}

export const SEARCH_A_GROUP_OR_COMMITTEE = 'Search a group or a committee';

export const HOW_TO_READ_IT = {
  heading: 'How to read it',
  body:
    'A row is one expenditure: who spent, the committee it was about, the direction stated ' +
    'on the filing, and the date it was paid. Figures are shown one subject at a time. Two ' +
    'groups are never totalled together and never placed side by side, because the state ' +
    'publishes no date telling us when any report arrived — so we cannot tell whether one ' +
    'group’s year is finished and another’s has barely started.',
};

export const NOT_IN_THIS_RECORD = {
  heading: 'Not in this record',
  body:
    'Anything before 2015. Spending by a group that files with a body other than this Board. ' +
    'Any connection between an expenditure and a vote, a position, or an outcome — the ' +
    'filings record spending, and nothing about what it did. No list here is offered as ' +
    'complete.',
};

export const READ_FROM_THE_BOARDS_FILE = 'Read from the Board’s file';

/** "Checked Aug 19, 2026". The one freshness date on the page (rule 12). */
export function checkedLine(checkedOn: string | null): string | null {
  return checkedOn ? `Checked ${checkedOn}` : null;
}

// --- One subject -----------------------------------------------------------

export function registrationLine(registrationNumber: string): string {
  return `Registration ${registrationNumber}`;
}

/** The name a subject view prints. The register's where it lists the number, else
 *  the file's own, and never a blank. */
export function subjectName(subject: OutsideSpendingSubject): string {
  return subject.name ?? `Committee ${subject.registrationNumber}`;
}

/**
 * The spender view's intro. The drawing's second sentence pointed at another tab
 * of the same page; here the group's own money is its own page, so the sentence
 * says that and links there only where that page exists.
 */
export const SPENDER_INTRO = 'Registered with the Board to make independent expenditures.';
export const SPENDER_OWN_MONEY_LINK = 'What it raised and paid out';
export const SPENDER_OWN_MONEY_TAIL = ' is on its own page.';

export const WHOSE_COMMITTEE_THIS_IS = 'Whose committee this is';

/**
 * The unconfirmed sentence. Names the committee only, and says the figures are
 * about it rather than about a person. The register's seat is printed where the
 * register carries one (a candidate committee); a party unit or fund has none.
 */
export function whoseCommitteeUnconfirmed(subject: OutsideSpendingSubject): string {
  const seat = seatLine(subject);
  const opening = seat
    ? `The register records this committee for ${seat}. We have not confirmed which person it belongs to, so this page names the committee only.`
    : 'We have not confirmed which person this committee belongs to, so this page names the committee only.';
  return `${opening} Every figure below is spending about this committee — not about a candidate we have identified.`;
}

/**
 * The one sentence a confirmation adds. It names the person a reviewer confirmed,
 * in the reviewer's own terms rather than the register's, because the register
 * names candidates and our link is a person's checked decision (§5.1). It changes
 * no figure.
 */
export function whoseCommitteeConfirmed(subject: OutsideSpendingSubject): string {
  const member = subject.confirmedMember;
  if (!member) return whoseCommitteeUnconfirmed(subject);
  const seat = seatLine(subject);
  const named = seat
    ? `Someone at Alethical confirmed this committee is ${member.fullName}’s, registered for ${seat}.`
    : `Someone at Alethical confirmed this committee is ${member.fullName}’s.`;
  return `${named} The figures below remain spending about the committee; the filings never name a person.`;
}

/** "House District 35A"-style seat from the register's own office and district. The
 *  register's office values are the chamber's or office's short name ("House",
 *  "Senate", "Governor"), so the seat reads as Minnesota writes it. */
export function seatLine(
  subject: Pick<OutsideSpendingSubject, 'office' | 'district'>,
): string | null {
  if (subject.office && subject.district) return `${subject.office} District ${subject.district}`;
  if (subject.office) return subject.office;
  if (subject.district) return `District ${subject.district}`;
  return null;
}

export const FILING_YEAR_LABEL = 'Filing year';
export const ALL_YEARS = 'All years';

/** "OUTSIDE SPENDING · 2026" or "OUTSIDE SPENDING · 2015–2026". */
export function subjectScopeLine(
  year: number | null,
  figures: OutsideSpendingRecordFigures | null,
): string {
  if (year !== null) return `Outside spending · ${year}`;
  if (figures && figures.firstYear !== null && figures.lastYear !== null) {
    return figures.firstYear === figures.lastYear
      ? `Outside spending · ${figures.firstYear}`
      : `Outside spending · ${figures.firstYear}–${figures.lastYear}`;
  }
  return 'Outside spending';
}

/**
 * The ruled count line under a subject's total (1 Sep 2026): "12 payments about
 * 5 committees" on a spender's view, "12 payments by 5 groups" on a committee's,
 * singular "1 payment about 1 committee", and never "payments named".
 */
export function subjectCountLine(
  view: OutsideSpendingView,
  figures: OutsideSpendingRecordFigures,
): string {
  const payments = `${formatCount(figures.rowCount)} ${figures.rowCount === 1 ? 'payment' : 'payments'}`;
  if (view === 'about') {
    const groups = `${formatCount(figures.spenderCount)} ${figures.spenderCount === 1 ? 'group' : 'groups'}`;
    return `${payments} by ${groups}`;
  }
  const committees = `${formatCount(figures.committeeCount)} ${figures.committeeCount === 1 ? 'committee' : 'committees'}`;
  return `${payments} about ${committees}`;
}

/** "$234,650 supporting", in money, for a subject's direction line. */
export function directionAmountLine(
  amount: string | null,
  direction: 'supporting' | 'opposing',
): string | null {
  const money = formatMoney(amount);
  return money ? `${money} ${direction}` : null;
}

/** The share of a bar each direction takes, from the 2 amounts. Both 0 is an empty bar. */
export function directionShares(
  supporting: string | null,
  opposing: string | null,
): { supporting: number; opposing: number } {
  const forAmount = Math.max(0, Number(supporting ?? 0) || 0);
  const againstAmount = Math.max(0, Number(opposing ?? 0) || 0);
  const whole = forAmount + againstAmount;
  if (whole === 0) return { supporting: 0, opposing: 0 };
  return { supporting: forAmount / whole, opposing: againstAmount / whole };
}

/** The period note under a subject's figures. One year, or every year on record. */
export function periodNote(year: number | null, figures: OutsideSpendingRecordFigures): string {
  if (year !== null) {
    return (
      `Each figure is the sum of every row filed for ${year}, and every row states its own date. ` +
      'Minnesota publishes no date telling us when a report arrived, so we cannot say whether ' +
      'one is still to come.'
    );
  }
  const span =
    figures.firstYear !== null &&
    figures.lastYear !== null &&
    figures.firstYear !== figures.lastYear
      ? `every year on record, ${figures.firstYear} through ${figures.lastYear}`
      : 'every year on record';
  return `Figures span ${span}, and each row states its own date. No list here is offered as complete.`;
}

/** Withheld figures: a row with a blank amount means the sums would be short. */
export const FIGURES_WITHHELD =
  'We hold a payment here whose amount the filing leaves blank, so no total is shown: a ' +
  'sum would be short by an unknown amount. Every row still lists with its own amount or ' +
  'none.';

/** The rows' heading on a subject's view. The whole record lists no rows: a list
 *  across every group would set one group's payment beside another's. */
export function rowsHeading(view: OutsideSpendingView): string {
  if (view === 'about') return 'The groups that spent';
  return 'The committees this spending was about';
}

export const ROWS_DEK =
  'Ordering rows inside one subject is a fact about that subject; the figures on this page ' +
  'are never set against another group’s.';

/** The 2 sort labels, printed in the page's mono small capitals. */
export const SORT_LABELS: Record<OutsideSpendingSort, string> = {
  newest: 'NEWEST FIRST',
  largest: 'LARGEST FIRST',
};

/**
 * The line above the rows. Uncapped: the ruled count line. Capped: "Showing 50 of
 * 1,284 payments", no closing dot, never "payments named".
 */
export function rowsCountLine(
  view: OutsideSpendingView,
  page: OutsideSpendingRecordPage,
): string | null {
  if (!page.figures || page.totalRows === null) return null;
  if (page.totalRows > page.pageSize) {
    return `Showing ${formatCount(page.rows.length)} of ${formatCount(page.totalRows)} payments`;
  }
  return subjectCountLine(view, page.figures);
}

/** "Page 2 of 26", or null on a single page. */
export function pageLine(page: OutsideSpendingRecordPage): string | null {
  if (page.totalRows === null || page.totalRows <= page.pageSize) return null;
  return `Page ${formatCount(page.pageNumber)} of ${formatCount(Math.ceil(page.totalRows / page.pageSize))}`;
}

export const NEXT_PAGE = 'Next';
export const PREVIOUS_PAGE = 'Previous';

export const EVERY_ROW_SHOWN_NOTE =
  'Every row on record for this subject and year is shown. Where there are more than 50, the ' +
  'rest are on their own pages — this list is never a sample of a longer one without saying so.';

// --- One row -----------------------------------------------------------------

export const NOT_IN_REGISTER_ROW_NOTE = 'Not in the register — printed as the filing names it';
export const SUPPORTING_CHIP = 'Supporting';
export const OPPOSING_CHIP = 'Opposing';
export const DIRECTION_NOT_STATED = 'Direction not stated in the filing';

export const NO_PURPOSE_GIVEN = 'No purpose given in the filing';
export const NO_VENDOR_NAMED = 'no vendor named in the filing';
export const GIVEN_IN_KIND = 'given in kind';

/** "REG 30622", the number beside a linked name. */
export function registrationChip(registrationNumber: string): string {
  return `REG ${registrationNumber}`;
}

/** "paid to Great North Media LLC", or the deliberate empty state. */
export function vendorText(vendorName: string | null): { text: string; isMissing: boolean } {
  return vendorName
    ? { text: `paid to ${vendorName}`, isMissing: false }
    : { text: NO_VENDOR_NAMED, isMissing: true };
}

export function purposeText(purpose: string | null): { text: string; isMissing: boolean } {
  return purpose
    ? { text: purpose, isMissing: false }
    : { text: NO_PURPOSE_GIVEN, isMissing: true };
}

/** In-kind is the row's type text, never a chip: one fact in one place. */
export function typeText(
  row: Pick<OutsideSpendingRecordRow, 'inKind' | 'expenditureType'>,
): string {
  if (row.inKind) return GIVEN_IN_KIND;
  return (row.expenditureType ?? 'independent expenditure').toLowerCase();
}

/** "$1,500 of it unpaid", or null when nothing is unpaid. */
export function unpaidNote(unpaidAmount: string | null): string | null {
  const amount = Number(unpaidAmount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const money = formatMoney(unpaidAmount);
  return money ? `${money} of it unpaid` : null;
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "PAID AUG 3, 2026": month-first, short month, as the money section prints dates
 *  (ruled 2 Sep 2026). Null when the row carries no date. */
export function paidLine(paidOn: string | null): string | null {
  if (!paidOn) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(paidOn);
  if (!match) return null;
  const month = SHORT_MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return `PAID ${month.toUpperCase()} ${Number(match[3])}, ${match[1]}`;
}

/** Which side of a row the view's counterparty is on. A spender's view lists the
 *  committees it spent about; a committee's view and the whole record list the
 *  spender. */
export function rowCounterparty(
  view: OutsideSpendingView,
  row: OutsideSpendingRecordRow,
): { name: string; registrationNumber: string | null; linkable: boolean } {
  if (view === 'spender') {
    return {
      name: row.aboutCommitteeName ?? 'Committee not named in the filing',
      registrationNumber: row.aboutCommitteeRegistrationNumber,
      linkable: row.aboutCommitteeLinkable,
    };
  }
  return {
    name: row.spender ?? 'Group not named in the filing',
    registrationNumber: row.spenderRegistrationNumber,
    linkable: row.spenderLinkable,
  };
}

// --- States -------------------------------------------------------------------

export const NOTHING_ON_RECORD = 'Nothing on record';

/** Absence is never a zero: the reason, in the reader's words. */
export function nothingOnRecordWhy(view: OutsideSpendingView): string {
  const subject =
    view === 'about' ? 'about this committee' : view === 'spender' ? 'by this group' : 'at all';
  return (
    `No independent expenditure ${subject} appears in the file we hold for the period above. ` +
    'Minnesota publishes no date telling us when a report arrived, so we cannot tell you ' +
    'whether one is still to come. This is not a reported zero, and no group has reported ' +
    'spending nothing.'
  );
}

export const SEE_ALL_YEARS = 'See all years';
export const SEE_OWN_MONEY = 'See this committee’s own contributions and payments';
export const SEE_OWN_MONEY_SPENDER = 'See this group’s own contributions and payments';

export const RECORD_UNAVAILABLE_TITLE = 'We could not read this part of our records just now';
export const RECORD_UNAVAILABLE_WHY =
  'Our copy of the state’s independent-expenditure file did not answer, or does not reach the ' +
  'year asked for. That is a gap in our records, not a sign that nothing was spent.';

export const FIGURES_AS_ACCEPTED = 'Figures as accepted';

/** The service-down sentence, printed over the last figures the page accepted. */
export function figuresAsAcceptedNote(takenOn: string | null): string {
  const taken = takenOn ? `, taken ${takenOn}` : '';
  return (
    `We could not reach our own data service just now, so these are the last figures we ` +
    `accepted${taken} — held until it answers rather than expiring on a timer.`
  );
}

export const SERVICE_NOT_ANSWERING_TITLE = 'We could not reach our own data service';
export const SERVICE_NOT_ANSWERING_WHY =
  'Nothing loaded, so there is nothing to show. That is a problem at our end and says nothing ' +
  'about what was spent.';

export const SUBJECT_NOT_FOUND_TITLE = 'We hold nothing under this registration number';
export const SUBJECT_NOT_FOUND_WHY =
  'It is in neither our copy of the Board’s register nor the independent-expenditure file we ' +
  'hold. That is a statement about our records, not about Minnesota’s.';

// --- Reading the service's own JSON --------------------------------------------
//
// These sit here rather than in `data/api.ts` so `api/page.ts` can shape the very
// payload it already read into the page a reader gets (issue #1966). The page
// function runs in Node and cannot load `data/api.ts`, which imports
// `react-native` (pinned by `lib/__tests__/pageFunctionImports.test.ts`).
//
// One shaper, used by both sides, is the point: a seeded figure and a fetched
// figure come out of the same code, so they cannot differ.

/** The record page's payload, exactly as `/campaign-finance/outside-spending` sends it. */
export interface ApiOutsideSpendingRecordPagePayload {
  state?: string;
  about?: Record<string, unknown> | null;
  spender?: Record<string, unknown> | null;
  year?: number | null;
  sort?: string;
  rows?: Record<string, unknown>[] | null;
  page?: { number: number; size: number; has_more: boolean; total_rows?: number | null } | null;
  figures?: Record<string, unknown> | null;
  source_url?: string | null;
  fetched_at?: string | null;
}

const asBool = (value: unknown): boolean => value === true;
const asInt = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function recordState(state: string | undefined): OutsideSpendingRecordState {
  if (state === 'reported') return 'reported';
  if (state === 'not_reported') return 'not_reported';
  return 'unavailable';
}

function outsideSpendingRecordSubject(
  raw: Record<string, unknown> | null | undefined,
): OutsideSpendingSubject | null {
  if (!raw) return null;
  const member = raw.confirmed_member as Record<string, unknown> | null | undefined;
  return {
    registrationNumber: String(raw.registration_number ?? ''),
    name: asText(raw.name),
    inRegister: asBool(raw.in_register),
    linkable: asBool(raw.linkable),
    kind: asText(raw.kind),
    office: asText(raw.office),
    district: asText(raw.district),
    confirmedMember:
      member && typeof member.slug === 'string' && typeof member.full_name === 'string'
        ? { slug: member.slug, fullName: member.full_name }
        : null,
  };
}

function outsideSpendingRecordRow(raw: Record<string, unknown>): OutsideSpendingRecordRow {
  return {
    spender: asText(raw.spender),
    spenderRegistrationNumber: asText(raw.spender_registration_number),
    spenderInRegister: asBool(raw.spender_in_register),
    spenderLinkable: asBool(raw.spender_linkable),
    aboutCommitteeName: asText(raw.about_committee_name),
    aboutCommitteeRegistrationNumber: asText(raw.about_committee_registration_number),
    aboutCommitteeInRegister: asBool(raw.about_committee_in_register),
    aboutCommitteeLinkable: asBool(raw.about_committee_linkable),
    direction: asText(raw.direction) ?? 'not recorded',
    directionAsFiled: asText(raw.direction_as_filed),
    purpose: asText(raw.purpose),
    vendorName: asText(raw.vendor_name),
    expenditureType: asText(raw.expenditure_type),
    inKind: asBool(raw.in_kind),
    paidOn: asText(raw.paid_on),
    year: asInt(raw.year),
    amount: asText(raw.amount),
    unpaidAmount: asText(raw.unpaid_amount),
  };
}

function outsideSpendingRecordFigures(
  raw: Record<string, unknown> | null | undefined,
): OutsideSpendingRecordFigures | null {
  if (!raw) return null;
  return {
    rowCount: asInt(raw.row_count) ?? 0,
    rowsMissingAnAmount: asInt(raw.rows_missing_an_amount) ?? 0,
    amountTotal: asText(raw.amount_total),
    supportingCount: asInt(raw.supporting_count) ?? 0,
    supportingAmount: asText(raw.supporting_amount),
    opposingCount: asInt(raw.opposing_count) ?? 0,
    opposingAmount: asText(raw.opposing_amount),
    directionNotRecordedCount: asInt(raw.direction_not_recorded_count) ?? 0,
    directionNotRecordedAmount: asText(raw.direction_not_recorded_amount),
    inKindCount: asInt(raw.in_kind_count) ?? 0,
    firstYear: asInt(raw.first_year),
    lastYear: asInt(raw.last_year),
    committeeCount: asInt(raw.committee_count) ?? 0,
    spenderCount: asInt(raw.spender_count) ?? 0,
    committeesNotLinkable: asInt(raw.committees_not_linkable),
  };
}

/** One page of the record, from the payload the service sent. Figures only where
 *  the service says `reported`, so a gap never renders as a zero. */
export function outsideSpendingRecordPageFromPayload(
  payload: ApiOutsideSpendingRecordPagePayload,
): OutsideSpendingRecordPage {
  const state = recordState(payload.state);
  return {
    state,
    about: outsideSpendingRecordSubject(payload.about),
    spender: outsideSpendingRecordSubject(payload.spender),
    year: payload.year ?? null,
    sort: payload.sort === 'largest' ? 'largest' : 'newest',
    rows: state === 'reported' ? (payload.rows ?? []).map(outsideSpendingRecordRow) : [],
    pageNumber: payload.page?.number ?? 1,
    pageSize: payload.page?.size ?? 50,
    totalRows: payload.page?.total_rows ?? null,
    hasMore: payload.page?.has_more ?? false,
    figures: state === 'reported' ? outsideSpendingRecordFigures(payload.figures) : null,
    sourceUrl: payload.source_url ?? null,
    fetchedAt: payload.fetched_at ?? null,
  };
}

/**
 * The React Query key one page of the record answers. Shared with `api/page.ts`
 * so the payload it already read is labelled with the key the app asks for
 * (issue #1966).
 */
export function outsideSpendingRecordQueryKey(options: {
  about?: string;
  spender?: string;
  year: number | null;
  sort: OutsideSpendingSort;
  page: number;
}): readonly unknown[] {
  return [
    'outside-spending-record',
    options.about ?? null,
    options.spender ?? null,
    options.year,
    options.sort,
    options.page,
  ];
}
