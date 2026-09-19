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
  share: 'Share of dollars',
  locationsIntro: 'Shares of dollars by state, excluding donated goods and services',
  /** One line, whatever the table holds. The clause naming the subtotal relationship is
   *  gone: the indent, the lighter divider inside the group and `locationsToggle`, whose
   *  accessible name counts the states inside Other states, each state it already. A
   *  screen-reader user now gets it from the control. */
  locationsCaption: (year: number) => `Itemized individual contributions by state, ${year}`,
  /** The control's accessible name carries both the count and the relationship, because
   *  an indent is invisible to a screen reader. */
  locationsToggle: (open: boolean, states: number) =>
    `${open ? 'Hide' : 'Show'} the ${states === 1 ? 'state' : `${states} states`} in Other states`,
  locationNotes: [
    'States are identified from ZIP codes in the state’s file',
    'Unknown means the state’s file has no usable ZIP code to identify the donor’s state',
    'Names count distinct spellings within each row, including contributions of goods and services',
    'The same name can appear in more than 1 state',
  ],
  /** Rows exist and none of them carries cash, which is not the same as no rows at all:
   *  an unnamed donation of goods with an unusable ZIP produces exactly 0 names and $0. */
  locationsNoCash: (year: number) =>
    `No itemized individual contribution dollars listed for ${year}`,
  /** The bar's own text alternative. Every figure it names is also in the table below
   *  it, so colour and width carry nothing on their own. */
  locationsBar: (parts: readonly string[]) =>
    `Shares of itemized individual contribution dollars: ${parts.join('; ')}`,
  locationsBarPart: (place: string, amount: string, share: string) =>
    `${place} ${amount}, ${share}`,
  /** One payment's own filed location. Per payment rather than per grouped spelling,
   *  because payments filed under one name can carry different ZIPs. The ZIP prints as
   *  the state's file holds it: a short value is the record, not our error. */
  paymentLocation: (state: string | null, zip: string | null) =>
    `State: ${state ?? 'Unknown'} · ZIP code as filed: ${zip === null || zip === '' ? 'Not reported' : zip}`,
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
      `We cannot show this breakdown for ${year} because the contributions have not passed our check against a filed report`,
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

/**
 * How big the location card's own pieces are on a phone, given the text size the browser
 * is really rendering at.
 *
 * A reader can enlarge text below this card without our asking: a browser minimum font
 * size, or a text-only zoom, raises what 15px actually draws as. Design's answer is that
 * the card grows with it rather than keeping a 14px square and an 18px arrow beside a
 * 30px word, where both read as stray marks. These are Design's own numbers from the
 * 19 September 2026 drawing, which shows 15, 20 and 30px text.
 *
 * `size` is the size measured off the page, never a size we asked for. 15 is the floor
 * the money section keeps on phones, so nothing here can shrink below today's card.
 */
export type PhoneScale = {
  heading: number;
  body: number;
  columnHeader: number;
  bar: number;
  cellPadding: number;
  swatch: number;
  chevron: number;
  /** Negative, so the 44px control keeps the row exactly as tall as the rows without one. */
  toggleMargin: number;
};

export function phoneScale(size: number): PhoneScale {
  const body = Math.max(15, Math.round(size));
  return {
    heading: Math.round(body * 1.33),
    body,
    columnHeader: body <= 15 ? 11 : Math.round(body * 0.7),
    bar: body <= 15 ? 20 : Math.round(body * 1.2),
    cellPadding: body <= 15 ? 9 : body < 30 ? 11 : 13,
    swatch: body < 24 ? 14 : Math.round(body * 0.67),
    chevron: body < 24 ? 18 : Math.round(body * 0.86),
    toggleMargin: -Math.max(0, Math.round((44 - body * 1.35) / 2)),
  };
}

/**
 * Which of Design's 3 phone arrangements the table takes.
 *
 * `columns` puts the state name on its own line with its 3 figures aligned beneath it.
 * `beside` gives each figure its own line, label left and figure right. `above` puts the
 * label on the line over its figure, both left-aligned, and always fits, because a label
 * and a figure never have to share a line.
 *
 * Chosen from measured width rather than from a pixel breakpoint, so one rule answers a
 * narrow screen and enlarged text together, and chosen once for the whole table so a
 * reader never meets 2 arrangements in one list. Every widths figure is measured with
 * the real font at the real size, including the rows the Other states control is
 * currently hiding: a group that reopens must not find the arrangement no longer fits.
 */
export type FigureArrangement = 'columns' | 'beside' | 'above';

export function figureArrangement(width: {
  /** The card's own inner width. 0 before anything has been measured. */
  available: number;
  /** The 3 shared figure columns, their gaps included. */
  columns: number;
  /** The shared label column, its gap, the shared figure column, and the deepest indent. */
  beside: number;
}): FigureArrangement {
  // Nothing measured yet, so keep the arrangement the card is drawn in. It is the one
  // that fits at the phone floor of 15px text, which is what almost every reader has.
  if (!(width.available > 0)) return 'columns';
  if (width.columns <= width.available) return 'columns';
  if (width.beside <= width.available) return 'beside';
  return 'above';
}

/**
 * One category's share of every itemized individual contribution dollar, as it prints.
 *
 * Both figures arrive as exact units from `moneyUnits` in `lib/campaignMoneyDetails.ts`,
 * so the division happens on the full stored amounts rather than on the whole dollars
 * the table displays. Rounding a figure before dividing it is how a share comes out
 * wrong on a committee whose filings carry cents.
 *
 * The denominator is always **all** itemized individual contribution cash for this
 * committee and year, Unknown included, and never the Other states subtotal. So an
 * individual state's percentage means its share of the whole, which is the only reading
 * that stays true when a reader compares 2 states on different cards.
 *
 * Four printed forms, and the difference between the first 2 is the whole point:
 *
 * - `Not applicable` when there is no money to take a share of. A share of nothing is
 *   not zero per cent, and printing `0%` there would state a measurement nobody made.
 * - `0%` for a category that really holds none of a positive total. That is a measured
 *   zero and `.claude/rules/grounded-answers.md` rule 12 requires it to read as one.
 * - `<0.1%` for a positive share too small to print at 1 decimal place, so money that
 *   exists is never shown as nothing.
 * - 1 decimal place otherwise, rounded half up, **independently per row**. Printed
 *   shares may therefore not add to exactly 100%, and no row is ever nudged to make
 *   them: the rounding is honest and the adjustment would not be.
 *
 * A negative figure returns `null`, which the card treats as a refusal rather than
 * drawing it. Nothing here clamps a malformed amount into a plausible percentage.
 */
export function shareOfDollars(numerator: bigint, denominator: bigint): string | null {
  if (numerator < 0n || denominator < 0n) return null;
  if (denominator === 0n) return 'Not applicable';
  if (numerator === 0n) return '0%';
  // Below a tenth of a per cent: numerator / denominator < 0.001.
  if (numerator * 1000n < denominator) return '<0.1%';
  // Tenths of a per cent, rounded half up, entirely in integers so no binary floating
  // point can move the last digit: floor((2 * 1000 * numerator + denominator) / (2 * denominator)).
  const tenths = (2000n * numerator + denominator) / (2n * denominator);
  return `${tenths / 10n}.${tenths % 10n}%`;
}

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
