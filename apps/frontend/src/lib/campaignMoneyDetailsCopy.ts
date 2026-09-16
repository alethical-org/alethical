/** Fixed reader text for the legislator's contribution details. */
import {
  dekText,
  moneyDetailsPageCopy,
  namedMoneyDefinition,
  type DekSegment,
} from './campaignMoneyDetailsPageCopy';

export { dekText, namedMoneyDefinition, type DekSegment };

export const moneyDetailsCopy = {
  ...moneyDetailsPageCopy,
  chartHeading: (namedOnly: boolean) => `Who gave${namedOnly ? ' (named donations only)' : ''}`,
  chartUnavailable: 'We cannot draw this breakdown from the payment amounts we hold',
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
        ? 'Shares of itemized contributions this year, excluding donated goods and services'
        : 'Shares of the contributions this committee reported, excluding donated goods and ' +
          'services',
    },
    ...(hasUnnamed ? [{ text: '. ' }, ...namedMoneyDefinition(isBallot)] : []),
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
    expenditures ? 'Total itemized expenditures' : 'Total itemized contributions',
  goodsShare: (amount: string | null) => `of which ${amount} goods and services`,
  listedSpendingNote:
    'Minnesota makes a committee name a recipient only once payments to them pass $200 in total for the year. The listed payments may leave out smaller payments whose recipients are not named.',
  noSearchMatch: 'No names in this tab match that',
  emptyTab: (word: string, year: number) =>
    `The state’s file names no ${word} for this committee in ${year}`,
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
  historyHeading: 'How the mix of itemized contributions changed by year',
  historyExplanation:
    'Each bar shows the percentage of dollars from each donor kind, excluding donated goods and services',
  historyEmpty: 'No itemized contributions listed',
  historyShowEarlier: 'Show earlier years',
  historyHideEarlier: 'Hide earlier years',
  historyViewPercentages: 'View percentages',
  historyHidePercentages: 'Hide percentages',
  historyPercentagesLabel: (year: number, expanded: boolean) =>
    `${expanded ? 'Hide' : 'View'} percentages for ${year}`,
  historyPercentagesHeading: (year: number) => `Itemized contribution percentages for ${year}`,
  historyReadoutHint: 'Point to a segment, tap it, or reach it with the keyboard for its share',
  historyLegend: 'Donor kinds',
  historyUnavailable: 'A cash breakdown is unavailable',
  chooseYear: (year: number) => `Choose ${year}`,
} as const;
