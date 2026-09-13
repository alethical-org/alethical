/** Fixed reader text for the legislator's contribution details. */
import { moneyDetailsPageCopy } from './campaignMoneyDetailsPageCopy';

/** One run of the chart's dek. `bold` marks the 2 words a reader matches against the
 *  labels on the money cards, so the emphasis and the labels can never drift apart. */
export type DekSegment = { text: string; bold?: boolean };

/** The dek run as one string: what a text-only surface prints, and what a test pins. */
export function dekText(segments: readonly DekSegment[]): string {
  return segments.map((segment) => segment.text).join('');
}

/**
 * What separates the 2 contribution figures, and Minnesota's rule behind the split.
 *
 * The one place both terms are explained (#2182). It used to be 2 grey paragraphs under
 * the figures on the Money in card (`itemizedContributionsNote`, `unnamedMoneyExplanation`),
 * which still draw wherever the chart is absent; where the chart draws, its dek carries
 * them instead and the card is figures only.
 *
 * `.claude/rules/grounded-answers.md` rule 12 decides both halves of the naming sentence:
 * it states when a name is **required**, never that a smaller donor goes unnamed, and it
 * keeps the clause saying a committee may name smaller donors, because filer 18135's 2026
 * pre-general itemizes 215 donors at or under $200 and a reader meeting a named $50
 * donation would otherwise read our page as wrong. A ballot-question filer's line is $500,
 * from Minnesota Statutes 10A.20 subd. 3(c) and the Board's own handbook for those filers.
 */
export function namedMoneyDefinition(isBallot: boolean): DekSegment[] {
  return [
    { text: 'The filing names who gave for ' },
    { text: 'itemized contributions', bold: true },
    { text: ' and not for ' },
    { text: 'non-itemized contributions', bold: true },
    {
      text: isBallot
        ? '. Minnesota requires naming once a donor’s giving passes $500 for the year, the ' +
          'line for a ballot-question committee, and a committee may name smaller donors.'
        : '. Minnesota requires naming once a donor’s giving passes $200 for the year, and a ' +
          'committee may name smaller donors.',
    },
  ];
}

export const moneyDetailsCopy = {
  ...moneyDetailsPageCopy,
  chartHeading: (namedOnly: boolean) => `Who gave${namedOnly ? ' (named donations only)' : ''}`,
  chartUnavailable: 'We cannot draw this breakdown from the payment amounts we hold.',
  /**
   * The dek above the donut (#2182).
   *
   * The opening sentence names what the slices are shares of and what they leave out.
   * `cash` left it: the Board's own word is fair for a card payment or a cheque and a
   * reader can read it as notes and coins, while the exclusion the chart really makes is
   * donated goods and services, which the sentence now states outright.
   *
   * `hasUnnamed` is the card's own non-itemized figure, not the chart's last slice, so the
   * sentences defining the 2 labels draw wherever both labelled figures do. That is rule
   * 12's requirement that a page say what the difference between its 2 numbers is.
   */
  chartExplanation: (namedOnly: boolean, hasUnnamed: boolean, isBallot: boolean): DekSegment[] => [
    {
      text: namedOnly
        ? 'Shares of the named donations this year, not counting donated goods and services.'
        : 'Shares of the contributions this committee reported, not counting donated goods and ' +
          'services.',
    },
    ...(hasUnnamed ? [{ text: ' ' }, ...namedMoneyDefinition(isBallot)] : []),
  ],
  kindMissing: 'Kind not given',
  names: (count: number) => `${count} ${count === 1 ? 'name' : 'names'}`,
  payments: (count: number) => `${count} ${count === 1 ? 'payment' : 'payments'}`,
  /** The donut's own text alternative, one kind and its share per entry. The legend
   *  beside it is a list rather than a set of controls (#2182), so nothing in it carries
   *  a label of its own and this is what a screen reader is given for the picture. */
  chartAlternative: (parts: readonly string[]) => `Who gave: ${parts.join(', ')}`,
  tabsLabel: 'Contribution kinds and expenditures',
  listLoading: 'Loading the complete payment list…',
  listFailed:
    'We could not load the complete payment list. Totals and name counts are withheld until every page loads.',
  retry: 'Try again',
  search: 'Search names in this tab',
  counts: (names: number, payments: number) =>
    `${names} ${names === 1 ? 'name' : 'names'} · ${payments} ${payments === 1 ? 'payment' : 'payments'}`,
  tabTotal: (expenditures: boolean) =>
    expenditures ? 'Total of listed payments in this tab: ' : 'Named total in this tab: ',
  goodsShare: (amount: string | null) => `, of which ${amount} goods and services`,
  listedSpendingNote:
    'Minnesota makes a committee name a recipient only once payments to them pass $200 in total for the year. The listed payments may leave out smaller payments whose recipients are not named.',
  noSearchMatch: 'No names in this tab match that.',
  emptyTab: (word: string, year: number) =>
    `The state’s file names no ${word} for this committee in ${year}.`,
  showRemaining: (count: number, expenditures: boolean) =>
    `Show the other ${count} ${expenditures ? (count === 1 ? 'payee' : 'payees') : count === 1 ? 'name' : 'names'}`,
  candidateCommittee: 'Candidate committee',
  expandPayments: (expanded: boolean, count: number, name: string) =>
    `${expanded ? 'Hide' : 'Show'} the ${count} ${count === 1 ? 'payment' : 'payments'} from ${name}`,
  amountMissing: 'Amount not given',
  totalMissing: 'Unavailable because a payment amount is missing',
  dateMissing: 'Date not given in the public file',
  inKindMarker: 'DONATED GOODS OR SERVICES',
  sort: 'Sort names',
  currentSort: (label: string) => `Sort names, currently ${label}`,
  sortOption: (label: string, selected: boolean) => `${label}${selected ? ', selected' : ''}`,
  historyHeading: 'How the mix of named donors changed by year',
  historyExplanation:
    'Named donations only. Money the state’s file does not name cannot be split by kind.',
  historyEmpty: 'No named rows',
  historyUnavailable: 'A cash breakdown is unavailable',
  chooseYear: (year: number) => `Choose ${year}`,
} as const;
