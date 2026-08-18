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
 * 3. **The threshold is on the donor's yearly total, never on one payment.**
 *    327,759 of the 583,152 published donation rows are individually under $200 and
 *    are named anyway, because that donor's yearly total had already passed it. So
 *    no sentence here may say small gifts go unnamed.
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
  'shown' | 'no_reported_total' | 'sources_disagree' | 'periods_differ' | 'no_named_payments';

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
 * under $200 and named anyway. "Candidates" rather than "committees", because a
 * ballot-question committee's threshold is $500.
 *
 * It says the state's file does not name them, **not** that nobody knows who they are.
 * The second is a claim about the world that this source cannot support: the committee
 * knows, and another record may say so. Only the first is what Minnesota published.
 */
export const UNNAMED_MONEY_EXPLANATION =
  'Minnesota only makes candidates name a donor once that donor has given more than ' +
  '$200 in total for the year. Donors who gave $200 or less in total are never named, ' +
  'so their money is counted here and the state’s public file does not say who gave it.';

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
      'Minnesota only publishes payments over $200, and publishes no official total ' +
      'for a committee’s spending, so there is no bigger number to compare this against.'
    );
  }
  if (state === 'unavailable') {
    return 'We could not read this committee’s payments out of our copy of Minnesota’s file.';
  }
  return (
    'Minnesota only publishes a committee’s payments over $200, and it published none ' +
    'for this committee this year. That does not mean the committee spent nothing.'
  );
}

/**
 * Whether the split on screen was checked against the committee's own filed report.
 *
 * Two official sources can be added up correctly and still disagree, and only reading
 * the committee's own report catches the case where its filing itemizes money our copy
 * is missing entirely: that shortfall lands silently in the unnamed figure and becomes a
 * claim that money had no donor. 14 committee-years in the live release fail that check.
 *
 * The comparison costs a document request per filing. It has been run for 2025 and not
 * for 2026, so on the year a reader lands on the answer today is "not checked". The
 * figures are still the best evidence we have and are shown either way; what may not
 * happen is an unchecked figure reading exactly like a checked one.
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
      return (
        'Minnesota publishes these two figures separately, and for this committee and ' +
        'year they do not agree: the donations the state lists add up to more than the ' +
        'committee itself reported raising. We show both and work out neither, because ' +
        'we cannot tell which one is right.'
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
 * The line telling a reader when new money appears, so a July figure under today's
 * date does not read as a fault.
 *
 * Minnesota publishes on a filing schedule rather than continuously: nothing new is
 * published between 21 July and 26 October 2026. A page that says "updated today"
 * over figures that stop in July, with no explanation, teaches a reader that we are
 * broken (`.claude/rules/grounded-answers.md` rules 6 and 7).
 */
export const FILING_SCHEDULE_NOTE =
  'Minnesota publishes campaign money on a filing schedule, not day by day. The 2026 ' +
  'schedule required members on the ballot to file by 27 July for money raised through ' +
  '20 July, and again by 26 October. Members not on the ballot are not required to ' +
  'report their 2026 money until 1 February 2027.';
