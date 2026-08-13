import { formatNiceDate } from './billDetail';

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

export interface OutsideSpendingYear {
  year: number;
  state: OutsideSpendingState;
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
 * Money as the filing states it, with no rounding.
 *
 * Cents are dropped only when they are 0, because dropping real ones would change
 * the number a reader could check against the filing.
 */
export function formatSpendingAmount(value: number): string {
  // Rounded to whole cents FIRST, then split. Rounding the fraction on its own and
  // keeping the whole-dollar part untouched loses the carry: the source column holds
  // 4 decimal places, so a filing of 1.9999 rounds to 100 cents and printed as
  // `$1.100` -- a malformed number, over a figure a reader is meant to be able to
  // check against the filing. Found by an automated review on #1332.
  const roundedCents = Math.round(Math.abs(value) * 100);
  const whole = Math.floor(roundedCents / 100);
  const cents = roundedCents % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = value < 0 ? '-' : '';
  return cents === 0
    ? `${sign}$${grouped}`
    : `${sign}$${grouped}.${String(cents).padStart(2, '0')}`;
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
  if ((year.directionNotRecorded ?? 0) > 0) {
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
  const first = formatNiceDate(year.firstPaymentOn);
  const last = formatNiceDate(year.lastPaymentOn);
  return first === last ? first : `${first} to ${last}`;
}

/**
 * One freshness date for the block, whichever year carries it.
 *
 * One date, not one per year, because both years come out of the same download and
 * two dates on one block would read as two separate fetches.
 */
export function outsideSpendingFetchedOn(years: OutsideSpendingYear[]): string | null {
  const stamped = years.find((year) => year.fetchedAt);
  return stamped?.fetchedAt ? formatNiceDate(stamped.fetchedAt) : null;
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
