/**
 * The Money in card's contribution rules and the 2 sentences only that card and the chart
 * print.
 *
 * Its own file, and small on purpose. `lib/legislatorCampaignMoney.ts` and
 * `lib/committeeMoneyShared.ts` are both inside the program every reader downloads before
 * anything draws, and nothing that reads this rule is: the money cards, the chart, the
 * on-demand wrapper and the text served without JavaScript all arrive later. Putting it
 * here keeps ~200 bytes off every first page load, including every reader who never opens
 * a money page (`apps/frontend/scripts/check-first-load-budget.mjs`).
 */
/**
 * Whether the Non-itemized contributions figure draws at all.
 *
 * One rule, read by the Money in card, by the chart's dek and by the text served without
 * JavaScript, because those 3 must agree: `.claude/rules/grounded-answers.md` rule 12
 * requires a page carrying both contribution figures to say what the difference between
 * them is, and the sentence saying so now lives in the dek. A page that drew the figure
 * from one condition and its explanation from another could show one without the other.
 *
 * A reported zero is its own state with its own sentence, and no split of nothing.
 */
export function unnamedFigureDraws(split: {
  state: string;
  reportedTotal: string | null;
  namedTotal?: string | null;
  unnamedTotal: string | null;
}): boolean {
  if (split.state !== 'shown' || split.unnamedTotal === null) return false;
  const reportedZero = Number(split.reportedTotal) === 0 && (split.namedTotal ?? null) === null;
  return !reportedZero;
}

/** The heading over the receipt rows that are not contributions — a loan, a public
 *  subsidy, interest. Short because the card heading 2 elements above already says
 *  "Money in", and the rows themselves show that each is reported on its own line
 *  (ruled by Eugene, 2 Sep 2026, in the campaign-money design's copy proposals).
 *
 *  "Contribution", not "donation" (#2182). A donated good or service **is** a donation,
 *  and it sits inside the Itemized contributions figure above rather than under this
 *  heading, so a reader who meets the chart's "not counting donated goods and services"
 *  and then this heading was invited to look for those goods here, where they never are.
 *  Nothing under this heading is a contribution at all: a loan is repaid, a public
 *  subsidy comes from the state, interest comes from a bank. It also matches the 3 rows
 *  above it, every one labelled a contribution, so the reader matches 1 word not 2. */
export const NOT_A_DONATION_HEADING = 'Not a contribution';

/**
 * The one sentence naming how much came as goods and services rather than money.
 *
 * One function, drawn identically wherever it appears, because 3 renderers once wrote it
 * 2 different ways and one of the 2 pointed at a figure that was not there. The wording
 * names what the money is rather than where another figure sits, which is what keeps it
 * correct on the chart, on either money card and in the text served without JavaScript,
 * however any of them is laid out later.
 *
 * `more` is doing real work: this money sits outside the reported contributions figure
 * rather than inside it, so a reader must not add it to anything above (#2182).
 */
export function inKindDonationsNote(amount: string): string {
  return (
    `${amount} more came as goods and services rather than money, which Minnesota ` +
    'counts separately'
  );
}

/** Fixed words for the 3 selected-year cards. This module is never a startup import. */
export const donationCardsCopy = {
  headings: [
    'What the committee’s own report says',
    'Where itemized individual contributions came from',
    'Contributor names also listed for other candidates',
  ],
  introduction:
    'Contributions reported by the committee, beside itemized contributions in the state’s list',
  columns: [
    'Total contributions in report',
    'Itemized contributions in state’s list',
    'Non-itemized contributions (calculated)',
  ],
  columnLines: [
    ['Total', 'contributions', 'in report'],
    ['Itemized', 'contributions', 'in state’s list'],
    ['Non-itemized', 'contributions', '(calculated)'],
  ],
  total: 'Total',
  difference: 'Non-itemized contributions = total contributions − itemized contributions',
  chartName: 'Who gave',
  closingAfter: ' counts under Committees & Funds instead',
  closingBefore: (amount: string, payments: number) =>
    payments === 1
      ? `${amount} of this line is 1 payment from a closing candidate committee passing on its balance, which `
      : `${amount} of this line is ${payments.toLocaleString('en-US')} payments in the closing candidate committee category, which `,
  places: ['Minnesota', 'Other states', 'Unknown'],
  contributionLine: 'Contribution line',
  state: 'State',
  names: 'Names',
  amount: 'Amount',
  locationNotes: [
    'Unknown means the state’s file has no usable ZIP code to identify the donor’s state',
  ],
  caveat:
    'Matched by exact spelling in the state’s file. A match does not prove it is the same person; different spellings count separately.',
  connectionsHeadline: (matched: number, names: number) =>
    `${matched.toLocaleString('en-US')} of ${names.toLocaleString('en-US')} names`,
  distributionHeading: 'Other candidate committees',
  highestHeading: 'Names with the most matches',
  otherCandidates: 'Other candidate committees',
  otherCandidateLines: ['Other candidate', 'committees'],
  highestLines: ['Names with the most', 'matches'],
  buckets: ['0', '1', '2', '3', '4 or more'],
  connectionsBar: (
    headline: string,
    distribution: readonly { other_committees: string; names: number }[],
  ) =>
    `${headline} are also listed for at least one other candidate committee. ${distribution.map((row) => `${row.other_committees === '4+' ? '4 or more' : row.other_committees} other candidate ${row.other_committees === '1' ? 'committee' : 'committees'}, ${row.names.toLocaleString('en-US')} ${row.names === 1 ? 'name' : 'names'}`).join('; ')}`,
  held: [
    (year: number) =>
      `This card needs a filed report for ${year} and our own figures checked against it. We do not yet have both, so no figures are drawn here.`,
    (year: number) =>
      `We draw this only from a year whose donations we have checked against a filed report. ${year} is not yet one of them, so there is nothing here.`,
    (year: number) =>
      `No names are matched for ${year}. We match only from a year whose donations we have checked against a filed report, and that is not yet the case here.`,
  ],
  emptyLocations: (year: number) =>
    `The state’s list names no individual contributions for this committee in ${year}`,
  emptyConnections: (year: number) =>
    `With no itemized individual contributions in ${year}, there is no name to match against other candidates`,
  failed: [
    'We couldn’t load this comparison right now.',
    'We couldn’t load where these donations came from right now.',
    'We couldn’t load these matches right now.',
  ],
  retry: 'Please try again in a moment.',
  loading: 'Loading',
};

// Only a 2-letter state value reaches this formatter; never an address or postcode.
export const donorStateNames: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  AS: 'American Samoa',
  GU: 'Guam',
  MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico',
  VI: 'U.S. Virgin Islands',
  AA: 'Armed Forces Americas',
  AE: 'Armed Forces Europe',
  AP: 'Armed Forces Pacific',
};
