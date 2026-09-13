/** Fixed reader text for the legislator's contribution details. */
import { moneyDetailsPageCopy } from './campaignMoneyDetailsPageCopy';

export const moneyDetailsCopy = {
  ...moneyDetailsPageCopy,
  chartHeading: (namedOnly: boolean) =>
    `Who gave, by kind of donor${namedOnly ? ' (named donations only)' : ''}`,
  chartUnavailable: 'We cannot draw this breakdown from the payment amounts we hold.',
  chartExplanation: (namedOnly: boolean, hasUnnamed: boolean) =>
    `${
      namedOnly
        ? 'Each slice is a share of the named cash donations in this year.'
        : 'Each slice is a share of the cash contributions this committee reported for the period above.'
    } Named donations use the same categories as the tabs below, with other candidate committees included in Committees & Funds.${hasUnnamed ? ' The last slice is money whose givers the state’s public file does not name.' : ''}`,
  baseLabel: (namedOnly: boolean) => (namedOnly ? 'named' : 'reported'),
  kindMissing: 'Kind not given',
  names: (count: number) => `${count} ${count === 1 ? 'name' : 'names'}`,
  payments: (count: number) => `${count} ${count === 1 ? 'payment' : 'payments'}`,
  sliceAction: (kind: string, count: number, amount: string | null, percent: number) =>
    `${kind}, ${count} ${count === 1 ? 'name' : 'names'}, ${amount}, ${percent} percent. Open this contribution tab`,
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
