/** Coverage wording for the 4 campaign-money list surfaces. */
export const MONEY_LIST_COVERAGE_HEADING = 'Limits of the campaign records';

export const MONEY_LIST_COVERAGE = [
  'Campaign payment records before 2015 are not included',
  'These records cover campaign finances, not the wider finances of organizations with political committees or funds',
  'Some donations are reported together without donor names as non-itemized contributions. This is allowed when a donor gives $200 or less to the same committee, party unit or fund in a calendar year. For ballot-question committees and funds, the limit is $500',
] as const;
