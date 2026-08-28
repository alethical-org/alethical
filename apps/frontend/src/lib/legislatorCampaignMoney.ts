/**
 * What a legislator's campaign money tab is allowed to say (#1329).
 *
 * Framework-free on purpose, in the same style as `lib/billDetail.ts`: every
 * sentence and every figure on that tab is decided here, so each one can be pinned
 * by a test rather than read off a screenshot. The components below this file
 * choose layout and nothing else.
 *
 * The rules these functions exist to keep are `.claude/rules/grounded-answers.md`
 * rule 12 and `docs/architecture/campaign-finance-system-design.md` §7. Three of
 * them shape almost everything here:
 *
 * 1. **Two numbers, both correct.** Minnesota names a donor only once their giving
 *    passes $200 in aggregate within a calendar year, so the donations we can list
 *    never add up to what a campaign raised. Measured across sitting legislators'
 *    committees, the unnamed share is 36.5% of the 2024 total and 41.3% of 2025.
 *    Showing either number alone understates or overstates while looking
 *    authoritative, so both appear and the gap between them is explained.
 * 2. **A missing figure and a real zero are different facts.** "Not reported" and
 *    "$0" are never interchangeable, because a member who genuinely raised nothing
 *    is not a member whose filing we do not hold.
 * 3. **The threshold is on the donor's yearly total, never on one payment, and it
 *    is a floor rather than a ban.** 327,759 of the 583,152 published donation rows
 *    are individually under $200 and are named anyway, because that donor's yearly
 *    total had already passed it. And a committee may name a donor whose yearly
 *    total never passes it: filer 18135's 2026 pre-general itemizes 215 such donors
 *    and reconciles to the cent. So no sentence here may say small gifts go
 *    unnamed, and none may say a small donor is never named either (#1755).
 */

/** The first year Minnesota's campaign-finance downloads reach. */
export const EARLIEST_CAMPAIGN_MONEY_YEAR = 2015;

export type CampaignMoneyYear = number;

/**
 * The years this tab offers, newest first: this calendar year and the one before.
 *
 * Read off the calendar rather than written down, and that is the whole point. A
 * hardcoded pair goes stale in silence: on 1 January 2027 a list saying 2026 and 2025
 * would hide 2027 from every reader forever, and nothing would fail to announce it.
 * Derived, the tab follows the calendar on its own.
 *
 * A year the downloads do not reach yet is safe to offer, because the server answers
 * it as "we do not hold this" rather than as a zero. So in the first weeks of a year
 * the newest option can be genuinely empty, and it says so, which beats a reader
 * never being able to ask.
 *
 * `today` is a parameter so a test can pin the answer instead of moving with the
 * clock.
 */
export function campaignMoneyYears(today: Date = new Date()): CampaignMoneyYear[] {
  const current = Math.max(today.getFullYear(), EARLIEST_CAMPAIGN_MONEY_YEAR);
  const previous = current - 1;
  return previous >= EARLIEST_CAMPAIGN_MONEY_YEAR ? [current, previous] : [current];
}

/** Whether a block of figures may be read at all, from the server's own vocabulary. */
export type MoneyBlockState = 'reported' | 'not_reported' | 'unavailable';

/** Why a split may or may not be drawn, from the server's own vocabulary. */
export type SplitState =
  | 'shown'
  | 'no_reported_total'
  | 'sources_disagree'
  | 'periods_differ'
  | 'no_named_payments'
  | 'named_payments_not_in_our_copy'
  | 'reported_total_predates_a_correction'
  | 'figures_do_not_line_up';

/** Whether anyone has confirmed which committees belong to this legislator. */
export type LinkState = 'unconfirmed' | 'reviewed_none_confirmed' | 'confirmed';

/**
 * The year a reader asked for, or this tab's default.
 *
 * Anything unparseable falls back rather than erroring: a URL is something people
 * type and edit, and a mistyped year should land on a real page.
 */
export function campaignMoneyYear(
  raw: string | number | undefined,
  today: Date = new Date(),
): CampaignMoneyYear {
  const years = campaignMoneyYears(today);
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  const match = years.find((year) => year === parsed);
  return match ?? years[0];
}

/**
 * A money amount as a reader would check it against the filing.
 *
 * Cents are always shown, including on figures in the millions. The whole promise
 * of this tab is that any number on it can be traced to Minnesota's own publication,
 * and $1,747,196.69 rounded to $1.7M cannot be. Returns `null` for a value that is
 * absent, so a caller has to decide what absence means rather than being handed a
 * "$0" it did not ask for.
 */
export function formatMoney(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return null;
  const negative = amount < 0;
  const body = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? '-' : ''}$${body}`;
}

/** "1 payment" / "272 payments", with the count spelled out rather than bare. */
export function paymentCountLabel(count: number | null | undefined): string | null {
  if (count === null || count === undefined || !Number.isFinite(count)) return null;
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'payment' : 'payments'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * An ISO date as "20 Jul 2026", or `null` if it is not one.
 *
 * Split on the string rather than parsed through `Date`, because `new Date('2026-07-20')`
 * is UTC midnight and prints as the 19th anywhere west of Greenwich — which is
 * everywhere this product is read. A date that is off by one on a filing period is
 * the kind of wrong number nobody notices.
 */
export function formatDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

/**
 * The dates of the payments we hold, never a coverage period.
 *
 * §7 forbids any surface hardcoding 1 January as a period start, and no source we
 * store states a filing's own start, so this says what it can stand behind: when the
 * payments on this page were made. The wording deliberately reads "payments dated"
 * rather than "covering", because a reader who takes the second one has been told
 * something we did not check.
 */
export function paymentDateRangeLabel(
  firstOn: string | null | undefined,
  lastOn: string | null | undefined,
): string | null {
  const first = formatDay(firstOn);
  const last = formatDay(lastOn);
  if (!first && !last) return null;
  if (!first || !last) return `Payments dated ${first ?? last}`;
  if (first === last) return `Payment dated ${first}`;
  return `Payments dated ${first} to ${last}`;
}

/** "The committee's own report, covering through 31 Dec 2025". */
export function reportedThroughLabel(through: string | null | undefined): string | null {
  const day = formatDay(through);
  return day ? `The committee's own report to the state, covering through ${day}` : null;
}

/**
 * How much of the money had no donor's name, as a share, when there is one to state.
 *
 * Honest here in a way a share of a *listed* set would not be, because both inputs
 * are complete official figures rather than samples: the committee's own reported
 * total, and the state's own published list of the donations that had to be named.
 * Rounded to whole percent, because the precision a reader needs is "about 4 dollars
 * in 10", and the exact dollars are on the same card.
 *
 * **Of the donations reported, never of "the money raised".** The reported figure sums
 * the filing's contribution lines only and deliberately excludes public subsidy, loan
 * income and miscellaneous income, so a share "of the money raised" would be a share of
 * a larger number than the one it was taken from.
 */
export function unnamedShareLabel(
  unnamed: number | string | null | undefined,
  reported: number | string | null | undefined,
): string | null {
  const top = typeof unnamed === 'string' ? Number(unnamed) : unnamed;
  const bottom = typeof reported === 'string' ? Number(reported) : reported;
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  if (!bottom || (bottom as number) <= 0) return null;
  const share = Math.round(((top as number) / (bottom as number)) * 100);
  if (share < 0 || share > 100) return null;
  return `${share}% of the donations the committee reported`;
}

/**
 * The sentence explaining why the two figures differ.
 *
 * The wording is fixed here and never assembled from a figure, because rule 12 is
 * specific about it: the threshold is a test on the donor's yearly total and never on
 * the size of a gift, and 327,759 of the 583,152 published rows are individually
 * under $200 and named anyway. It says a committee MAY name a smaller donor rather
 * than that such a donor is never named, because the statute sets a floor on who must
 * be named and at least one filer names more (#1755). "Candidates" rather than
 * "committees", because a ballot-question committee's threshold is $500.
 *
 * It says the state's file does not name them, **not** that nobody knows who they are.
 * The second is a claim about the world that this source cannot support: the committee
 * knows, and another record may say so. Only the first is what Minnesota published.
 */
export const UNNAMED_MONEY_EXPLANATION =
  'Minnesota only makes candidates name a donor once that donor has given more than ' +
  '$200 in total for the year. A campaign may name a smaller donor but does not have ' +
  'to, and for this money the state’s public file does not say who gave it.';

/**
 * What the spending figure means, which is a different sentence when there is none.
 *
 * Minnesota publishes no official total for a committee's spending, so unlike money
 * in there is no second number here and no split. Under "Not reported" the
 * no-bigger-number sentence would explain a figure that is not on the screen, and a
 * reader would take the absence as a spending of zero, which is the exact
 * missing-versus-zero failure rule 12 exists to stop.
 */
export function spendingNote(state: MoneyBlockState): string {
  if (state === 'reported') {
    return (
      'Minnesota only names a recipient once payments to them pass $200 in total for ' +
      'the year, and publishes no official total for a committee’s spending, so there ' +
      'is no bigger number to compare this against.'
    );
  }
  if (state === 'unavailable') {
    return 'We could not read this committee’s payments out of our copy of Minnesota’s file.';
  }
  return (
    'Minnesota only names a recipient once payments to them pass $200 in total for the ' +
    'year, and it named none for this committee this year. That does not mean the ' +
    'committee spent nothing.'
  );
}

/**
 * Whether the split on screen was checked against the committee's own filed report.
 *
 * Two official sources can be added up correctly and still disagree, and only reading
 * the committee's own report catches the case where its filing itemizes money our copy
 * is missing entirely: that shortfall lands silently in the unnamed figure and becomes a
 * claim that money had no donor. **76 committee-years in the live release fail that
 * check**, measured 18 Aug 2026 (#1496): 33 where the filing names more than we hold and
 * 43 where we hold more than it names. The count read 14 here until then, from a run that
 * covered 2025 alone.
 *
 * The comparison costs a document request per filing. It has now been run for 2024, 2025
 * and 2026, so "not checked" on those years means the Board served no document rather
 * than that nobody looked. The figures are still the best evidence we have and are shown
 * either way; what may not happen is an unchecked figure reading exactly like a checked
 * one.
 *
 * `null` when checked, because a page should not decorate the ordinary case.
 */
export function statedSplitNote(state: string | null | undefined): string | null {
  if (state === 'agrees') return null;
  return (
    'We have not yet compared this against the report the committee filed, so we cannot ' +
    'rule out that its filing names donations our copy is missing.'
  );
}

/** What the page says instead of a figure, per state, and why. */
export type FigureText = { text: string; isFigure: boolean };

/**
 * A money figure, or the words that stand in for it.
 *
 * `isFigure` lets a component style a real number differently from a stand-in
 * sentence without re-deciding which it got, and stops "Not reported" from ever
 * being set in the size reserved for an amount.
 */
export function moneyFigure(
  state: MoneyBlockState,
  value: number | string | null | undefined,
): FigureText {
  if (state === 'unavailable') {
    return { text: "We couldn't load this", isFigure: false };
  }
  if (state === 'not_reported') {
    return { text: 'Not reported', isFigure: false };
  }
  const money = formatMoney(value);
  return money ? { text: money, isFigure: true } : { text: 'Not reported', isFigure: false };
}

/**
 * Why this committee-year shows no split, in words a reader learns something from.
 *
 * `null` for `shown`, which is the state that draws figures instead of a sentence.
 * Every one of these says what we do not know and whose gap it is, because the
 * failure rule 12 exists to prevent is a page that quietly fills a gap with a number.
 */
export function splitExplanation(state: SplitState): string | null {
  switch (state) {
    case 'shown':
      return null;
    case 'no_reported_total':
      return (
        'We do not have an official total for this committee covering this year that we ' +
        'can stand behind, so there is nothing to compare these donations against. What ' +
        'is listed here is only the donations Minnesota required this committee to name.'
      );
    case 'sources_disagree':
      // No direction, deliberately. This state is reached from both of them, and the
      // sentence that stood here named only one: "the donations the state lists add up
      // to more than the committee itself reported raising". Measured on the live
      // release (#1496), 33 of the 76 disagreeing committee-years run the other way —
      // the committee's own filed report names money the state's donation list does not
      // hold — so that clause stated the opposite of the truth for 33 committee-years.
      //
      // **No reader had seen it**, and the first version of this comment wrongly said
      // they had. Nothing reaches this sentence until a committee is confirmed as a
      // member's, and `legislator_campaign_committee` holds **0 rows** in production, so
      // every profile draws `UnconfirmedPanel` instead (#1354 is the confirmations).
      // It was a defect waiting for the first confirmation, which is the cheapest moment
      // to have caught it and not a reason to have understated it either.
      //
      // Which figure is larger is never stated here.
      return (
        'Minnesota publishes these two figures separately, and for this committee and ' +
        'year they do not agree. We show both and work out neither, because we cannot ' +
        'tell which one is right.'
      );
    case 'periods_differ':
      return (
        'These two figures cover different stretches of time. The committee’s own ' +
        'report stops earlier than the donation list does, so subtracting one from the ' +
        'other would not tell you anything about donors.'
      );
    case 'no_named_payments':
      return (
        'This committee reported raising money, and the state’s donation list names ' +
        'none of it for this year. We cannot tell whether every donor stayed under the ' +
        'naming threshold or whether donations are missing from the list, so we do not ' +
        'say either.'
      );
    case 'named_payments_not_in_our_copy':
      // The sibling above is a shrug: we hold nothing and cannot tell why. Here the
      // committee's own filed report has been read and it names donors, so the
      // emptiness is provably on our side. 14 committee-years in the live release,
      // measured 19 Aug 2026 (#1682, #1642) — Kristin Robbins's governor committee is
      // the largest, its own 2025 report naming $533,295.01 against no rows at all.
      //
      // What this must never reach for is a sentence about the filing calendar. The
      // report was filed on time and the deadline was met; a deadline sentence would
      // be true about the calendar and false about the money.
      return (
        'This committee’s own report for this year names its donors. The state’s ' +
        'separate list of donations, which is where every name on this page comes from, ' +
        'holds none of them for this year — so the names are missing from what we can ' +
        'show you, not from what the committee filed. The report itself is public on the ' +
        'Board’s site.'
      );
    case 'reported_total_predates_a_correction':
      // A committee may file a report and then file it again with different figures.
      // The Board's own totals service can go on serving the first version's numbers
      // afterwards: Wynfred Russell's House committee (19086) corrected its 2026
      // pre-primary report on 10 August to name $20,750.00, our donation rows hold
      // exactly that, and the totals service was still serving $0.00 on 18 August.
      //
      // So this is our refresh gap, and it fixes itself when the Board's service
      // catches up. It is never Minnesota contradicting itself (#1648).
      return (
        'This committee filed its report for this year and then corrected it. The ' +
        'official total here comes from a separate state service that had not picked ' +
        'the correction up when we last copied it, so it does not line up with the ' +
        'donations listed beside it. We show both and change neither.'
      );
    case 'figures_do_not_line_up':
      // The quiet one, and deliberately weaker than `sources_disagree`. Reached when a
      // subtraction refuses to run and nothing we hold says why — which proves these 2
      // numbers cannot be subtracted and proves nothing about whether Minnesota's 2
      // publications disagree. 0 committee-years are in it on the live release; it
      // exists so the other 2 states never have to cover a case they cannot support.
      return (
        'These two figures will not line up, and we cannot tell why. We show both and ' +
        'work out neither, rather than print a number that would read as a fact about ' +
        'donors.'
      );
    default:
      return null;
  }
}

/**
 * What the page says when nobody has confirmed which committee is this member's.
 *
 * The state every one of the 200 sitting members is in on the day this ships, so it
 * is the tab rather than an edge case. Three things §7 pins about this wording, all
 * of which a shorter sentence gets wrong:
 *
 * - It never says no committee is registered for them. All 200 sitting members appear
 *   in the Board's own list of registered filers, so that sentence is false for every
 *   one of them.
 * - It says whose job is unfinished, because it is ours and not theirs.
 * - It says nothing about the other 199. "No figures are on any profile" is true today
 *   and false the moment the first confirmation lands, and a sentence with an expiry
 *   date built into it is one somebody has to remember to change.
 */
export const LINK_UNCONFIRMED_EXPLANATION =
  'Minnesota registers campaign committees by number and never records which person ' +
  'each one belongs to. This member’s committees are on file with the state, and we ' +
  'have not yet confirmed which of them is theirs, so we are not showing figures here ' +
  'yet. Matching a committee to the wrong person is the worst mistake this page could ' +
  'make, so a person checks every match by hand.';

/**
 * What the page says about committees it deliberately left out.
 *
 * A member may have a confirmed committee for a run at something other than their
 * legislative seat, and §7 forbids that race's money appearing here: putting a run for
 * Attorney General under a state senator's name says something about their legislative
 * work that no filing supports. Leaving it out in silence would be its own small lie
 * though, because a reader who knows about that campaign concludes we missed it. So the
 * page names that the money exists and reports not a dollar of it.
 *
 * `null` for the ordinary case of nothing left out.
 */
export function otherOfficeNote(count: number | null | undefined): string | null {
  if (!count || !Number.isFinite(count) || count < 1) return null;
  const committees = count === 1 ? 'one other committee' : `${count} other committees`;
  return (
    `This member also has ${committees} registered with the state for a different ` +
    'race, not for their seat in the Legislature. Those records are public and are not ' +
    'shown here, because they are not about the job this page is about.'
  );
}

/**
 * The sentence a member with more than one committee gets, above their cards.
 *
 * A candidate can register more than one campaign committee, usually after moving
 * between offices or starting a new run. When they close one and open another, the
 * leftover money moves across, and Minnesota records that move exactly as it records a
 * donation: a contribution from the old committee to the new one. So the same dollars
 * are reported by both committees, correctly, and adding the two together would count
 * them twice.
 *
 * Measured on the live release and recorded on
 * [#1663](https://github.com/alethical-org/alethical/issues/1663): 9 candidates, 30
 * payments, $121,241.64 moved between committees the same person controls, and for
 * Diane Napper in 2026 and Frank Pafko in 2026 **every dollar** a combined figure would
 * show is the same money counted twice.
 *
 * So the sentence does 2 things and no more. It tells the reader these are separate
 * accounts each reporting on its own, and it says we do not add them and why. It never
 * subtracts the moved money from either committee's own figure: the money really did
 * arrive, the filing says so, and netting it out would put our figure at odds with the
 * Board's own (rule 12).
 *
 * `null` for the ordinary case of one committee, where there is nothing to explain.
 */
export function severalCommitteesNote(count: number | null | undefined): string | null {
  if (!count || !Number.isFinite(count) || count < 2) return null;
  return (
    `This member has ${count} campaign committees for their seat in the Legislature, ` +
    'and each one reports to the state separately. Each is shown on its own below and ' +
    'we never add them together: when a candidate closes one committee and opens ' +
    'another, the money left over moves across, and the state records that move as a ' +
    'donation to the new committee. So the same money is in both reports, and one ' +
    'combined figure would count it twice.'
  );
}

/**
 * Whether a served money figure is a real amount above zero.
 *
 * The only place a committee's amount is turned into a number, deliberately. Two of
 * them turned into numbers is the first step of the combined figure #1663 forbids, so
 * `scripts/check_no_cross_committee_total.py` fails any other conversion of these
 * fields anywhere in the app, and this helper is what a surface uses instead.
 *
 * A missing figure is `false` rather than zero, because "not reported" and "$0.00" are
 * different facts (rule 12) and neither of them is an amount to show a line for.
 */
export function isAmountAboveZero(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return false;
  const amount = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(amount) && amount > 0;
}

/**
 * Which empty state the tab is in, when it has no committee to draw.
 *
 * `'unconfirmed'` and `'confirmed-elsewhere'` are different facts and an earlier version
 * collapsed them, so a member whose committee is checked and whose reviewed period simply
 * does not reach the year on screen was told nobody had looked at them. That is the
 * missing-versus-zero failure moved into the navigation: it blames our unfinished work
 * for something that is finished.
 *
 * `null` means there are committees to draw and no empty state at all.
 */
export function emptyStateFor(
  state: LinkState,
  committeeCount: number,
): 'unconfirmed' | 'confirmed-elsewhere' | null {
  if (committeeCount > 0) return null;
  return state === 'confirmed' ? 'confirmed-elsewhere' : 'unconfirmed';
}

/**
 * What the page says when the match is checked and covers a different year.
 *
 * Takes the year so the sentence names it. A reader who switched to 2026 and found
 * nothing needs to be told which year they are looking at, not a general statement.
 */
export function confirmedElsewhereExplanation(year: number): string {
  return (
    `We have confirmed which committee is this member's, and the years it covers do ` +
    `not include ${year}. Try another year. This is not a gap in the record: a ` +
    `committee is registered for a particular race and does not run forever.`
  );
}

/**
 * Which of the 6 ways a committee-year can have nothing to show it is in.
 *
 * Served, never worked out here: the states come from
 * `alethical/api/services/committee_filing_schedule.py`, which reads the Board's own
 * transcribed calendars and its own filer record.
 *
 * **The split down the middle is the point.** `on_the_ballot`, `not_on_the_ballot`
 * and `registration_closed` are facts about the committee. The other 3 are all "we
 * cannot say", and every one of them is our unfinished work rather than the
 * committee's, which `.claude/rules/grounded-answers.md` rule 12 says may never read
 * the same way (#1642).
 */
export type FilingScheduleState =
  | 'on_the_ballot'
  | 'not_on_the_ballot'
  | 'registration_closed'
  | 'special_election_filer'
  | 'calendar_not_transcribed'
  | 'filings_cannot_answer';

/** One committee-year's filing schedule, exactly as the server sends it. */
export type FilingSchedule = {
  state: FilingScheduleState;
  /** The Board's own name for the report, e.g. "Pre-general report of receipts and
   *  expenditures". Printed in quotes so a reader can find that document by name. */
  nextReportName: string | null;
  nextReportDueOn: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** The exemption the Board prints on that report, verbatim. Never separated from
   *  the due date: the 2026 pre-general date is right for every candidate who got
   *  past the primary and wrong for every candidate who did not, and the printed
   *  sentence is the only thing that tells the two apart. */
  condition: string | null;
  /** The day the registration closed. Read off the filer record, never off a
   *  report: the Board copies a termination date onto every one of that
   *  committee's report rows, including ones filed years earlier. */
  terminatedOn: string | null;
};

/**
 * The closing sentence on all 3 states where we are the ones who cannot answer.
 *
 * Repeated on purpose rather than varied. The 3 gaps have different causes and the
 * same meaning for a reader, and a shared closing line is what makes them legible as
 * one class beside the 3 states that are about the committee. Without it, "we have
 * not typed in that calendar" drifts towards reading like "nothing is due", which is
 * the rule 12 failure this whole function exists to prevent.
 */
const OUR_GAP_CLOSER =
  'That gap is on our side and says nothing about this committee’s own filing.';

/**
 * Minnesota publishes on a schedule, and this says which schedule THIS committee is
 * on and what it owes next (#1642).
 *
 * Returns one paragraph per sentence group, so a printed exemption sits on its own
 * line under the date it qualifies rather than trailing it in the same block.
 *
 * **Two things this may never do**, and both have their own test:
 *
 * 1. **Never say a report is late.** The signal that marks an unfiled report is only
 *    readable in the current year, so the claim cannot be supported — and telling a
 *    reader that a named politician missed a deadline they may not even have is the
 *    worst thing this tab could produce.
 * 2. **Never print a due date without the exemption the Board prints beside it.** The
 *    2026 pre-general is the live case: everyone who advanced past the primary owes
 *    it, everyone who lost does not, and no record we hold says which happened.
 *
 * **No year is written into any sentence here.** The year and every date arrive from
 * the server, which reads them off the Board's own calendars. That is the failure this
 * replaces: the fixed paragraph that shipped before spelled 2026's dates out in its own
 * words, so on 1 January 2027 it would have quietly described a finished election year.
 */
export function filingScheduleNote(
  schedule: FilingSchedule | null | undefined,
  year: number,
): string[] {
  // A response with no schedule block is our gap like any other, and reads as one.
  if (!schedule) return cannotSayBecause(ourFilingsCannotAnswer(year));

  switch (schedule.state) {
    case 'on_the_ballot': {
      const timing = nextReportSentence(schedule);
      return [
        `This committee is on the ${year} ballot, so Minnesota puts it on the ` +
          'election-year filing schedule.' +
          (timing ? ` ${timing}` : '') +
          ' Minnesota publishes this money when a report is filed, not day by day.',
        ...conditionParagraph(schedule),
      ];
    }
    case 'not_on_the_ballot': {
      const timing = nextReportSentence(schedule);
      return [
        `This committee is not on the ${year} ballot, so Minnesota puts it on the ` +
          'schedule for candidates who are not running, which asks for a report once a ' +
          'year rather than around each election.' +
          (timing ? ` ${timing}` : '') +
          ' A long stretch with nothing new here is that schedule working as written, ' +
          'not money going unreported.',
        ...conditionParagraph(schedule),
      ];
    }
    case 'registration_closed': {
      const closedOn = formatDay(schedule.terminatedOn);
      return [
        (closedOn
          ? `This committee closed its registration with the state on ${closedOn}, so no `
          : 'This committee has closed its registration with the state, so no ') +
          `further report is due from it. Nothing more is expected for ${year} than what ` +
          'it had already filed.',
      ];
    }
    case 'special_election_filer':
      return cannotSayBecause(
        `It has a ${year} special-election report, and special elections run on their ` +
          'own set of filing periods that we have not written down.',
      );
    case 'calendar_not_transcribed':
      return cannotSayBecause(
        'Minnesota publishes a separate filing calendar for each kind of candidate and ' +
          `each year, and we have not yet copied in the one covering this committee for ` +
          `${year}.`,
      );
    case 'filings_cannot_answer':
      return cannotSayBecause(ourFilingsCannotAnswer(year));
    default:
      return cannotSayBecause(ourFilingsCannotAnswer(year));
  }
}

/** The middle sentence of the state where our copy of the filings is what falls short. */
function ourFilingsCannotAnswer(year: number): string {
  return (
    `Our copy of the state’s own list of filings cannot answer it for ${year}: it ` +
    'either does not carry this committee yet or was taken too early to settle the ' +
    'question.'
  );
}

/** One of the 3 states that are about us, in the shape all 3 share. */
function cannotSayBecause(middle: string): string[] {
  return [`We cannot say when this committee’s next report is due. ${middle} ${OUR_GAP_CLOSER}`];
}

/**
 * The next report, its due date and the period it covers, or nothing.
 *
 * Every part is dropped rather than guessed. A schedule that named a report and no
 * date would otherwise print "due", followed by nothing.
 */
function nextReportSentence(schedule: FilingSchedule): string | null {
  const due = formatDay(schedule.nextReportDueOn);
  if (!schedule.nextReportName || !due) return null;
  const start = formatDay(schedule.periodStart);
  const end = formatDay(schedule.periodEnd);
  const covering = start && end ? `, covering ${start} to ${end}` : '';
  return `Its next report to the state is the “${schedule.nextReportName}”, due ${due}${covering}.`;
}

/**
 * The Board's printed exemption, quoted, when the next report carries one.
 *
 * Its own paragraph rather than a clause, because it changes who the date above
 * applies to and a reader who skims a long sentence must not miss it.
 */
function conditionParagraph(schedule: FilingSchedule): string[] {
  if (!schedule.condition || !formatDay(schedule.nextReportDueOn)) return [];
  return [`The state prints one exemption on that report: “${schedule.condition}”`];
}
