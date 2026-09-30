import { MONEY_SECTION_NAME } from './moneySectionName';

/** Exact signed-out Home introduction used before and after the app starts. */
export const HOME_PUBLIC_INTRO =
  'We turn scattered public records into clear information you can use. Understand what’s happening, check the evidence, and get practical support to act on what you learn.';

/** Signed-out card wording; signed-in Home keeps its current wording and layout. */
export const HOME_PUBLIC_MONEY_BODY =
  'See who gives, who spends, who gets paid, and who is registered to lobby, using records reported to the state';
export const HOME_PUBLIC_MONEY_CTA = 'Search the money records';
export const HOME_PUBLIC_BILLS_HEADING = 'Bills and votes';
export const HOME_PUBLIC_BILLS_BODY =
  'Read plain-language bill summaries, see where they stand, and find out how legislators voted';
export const HOME_PUBLIC_BILLS_CTA = 'Search bills';
export const HOME_PUBLIC_SERVICES_HEADING = 'Campaign services';
export const HOME_PUBLIC_SERVICES_BODY =
  'Get political intelligence through campaign-finance research, plus websites, marketing, and custom software for your campaign or organization';
export const HOME_PUBLIC_SERVICES_CTA = 'Explore our services';

/** The 2 bill-group exits and the exact Bill Search state they promise. */
export const HOME_BILL_GROUP_CONTINUATIONS = {
  passed: {
    label: 'See more recently passed',
    params: { status: 'signed_into_law', sort: 'action' },
  },
  introduced: {
    label: 'See more recently introduced',
    params: { sort: 'introduced' },
  },
} as const;

/**
 * The homepage money card's copy. Here rather than beside the component because
 * these sentences are the part under a rule, and this module is plain
 * TypeScript the test runner can read.
 *
 * The body line may say records are REPORTED TO the state. It may not say each
 * entry is TIED TO the filing it came from: the itemized-contributions download
 * carries no report reference to join on, matching by date names a different set
 * of donors than any single report does, and the Board's report documents are
 * fetched by form submission rather than by address. That is true at every point
 * on the campaign-money roadmap, not only today.
 *
 * The count line names its register. 1,603 is campaign filers alone — lobbying
 * has its own register and is not in the number — so without "registered" the
 * figure reads as the size of everything the sentence above it promises.
 */
export const MONEY_PROMO_EYEBROW = 'MONEY IN POLITICS';
export const MONEY_PROMO_HEADING = 'Follow the money';
export const MONEY_PROMO_BODY =
  'Explore Minnesota’s campaign finance and lobbying records, as reported to the state.';
export const MONEY_PROMO_COUNT_UNIT = 'registered campaigns, parties, and funds';
export const MONEY_PROMO_CTA = MONEY_SECTION_NAME;
