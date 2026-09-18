/**
 * The campaign-money years and the legislator money read key, apart from the tab's
 * wording.
 *
 * `hooks/useAppQueries.ts` is in the program every page downloads before anything
 * draws, and it needs only `campaignMoneyYear` and `legislatorCampaignMoneyQueryKey`
 * from a legislator's money tab. Importing them from
 * `lib/legislatorCampaignMoney.ts` put every sentence that tab can print into that
 * first download. This module imports nothing. `lib/legislatorCampaignMoney.ts`
 * re-exports every name here, so screens and `api/page.ts` import them from where
 * they always did.
 */

/** The first year Minnesota's campaign-finance downloads reach. */
export const EARLIEST_CAMPAIGN_MONEY_YEAR = 2015;

export type CampaignMoneyYear = number;

/**
 * The React Query key for one member's money in one year. Defined here, in a
 * module both sides already load, so the page function can hand the answer it
 * read to the app under the exact key the app's hook asks for (`lib/pageData.ts`).
 */
export function legislatorCampaignMoneyQueryKey(legislatorId: string, year: number) {
  return ['legislator-campaign-money', legislatorId, year] as const;
}

/**
 * The recent years offered by the existing committee record controls, newest first.
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
  return current > EARLIEST_CAMPAIGN_MONEY_YEAR ? [current, current - 1] : [current];
}

/** The profile's full calendar-year selection, following the download boundary. */
export function campaignMoneyHistoryYears(today: Date = new Date()): CampaignMoneyYear[] {
  const current = Math.max(today.getFullYear(), EARLIEST_CAMPAIGN_MONEY_YEAR);
  return Array.from(
    { length: current - EARLIEST_CAMPAIGN_MONEY_YEAR + 1 },
    (_, index) => current - index,
  );
}

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
  const years = campaignMoneyHistoryYears(today);
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  const match = years.find((year) => year === parsed);
  return match ?? years[0];
}
