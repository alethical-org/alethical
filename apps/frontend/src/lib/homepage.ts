/** Exact signed-out Home introduction used before and after the app starts. */
export const HOME_PUBLIC_INTRO =
  'We read every bill so you don’t have to — what it says, where it stands, and how legislators voted. And the money: who gives, who spends, who gets paid, and who lobbies. Plain language, with every claim linked to the official record.';

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
 * The body line may say figures are READ FROM the filings. It may not say each
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
  'Minnesota’s campaign and lobbying records — every figure read from the filings sent to the state, never a total we assembled.';
export const MONEY_PROMO_COUNT_UNIT = 'registered campaigns, parties, and funds';
/** Kept on the card, not only on the money landing: this is where a reader
 *  decides whether to click, and the destination's notice only reaches them
 *  after they already have. */
export const MONEY_PROMO_CAVEAT = 'Parts of this are still being built.';
export const MONEY_PROMO_CTA = 'Search the money records';
