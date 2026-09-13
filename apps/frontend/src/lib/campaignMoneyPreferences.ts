export type MoneyDetailsTab =
  'individuals' | 'lobbyists' | 'committees' | 'partyUnits' | 'expenditures' | 'other';
export type MoneyDetailsSort = 'largest' | 'smallest' | 'name' | 'newest' | 'oldest';
export interface MoneyDetailsPreferences {
  tab: MoneyDetailsTab;
  sort: MoneyDetailsSort;
}
export const DEFAULT_MONEY_DETAILS_PREFERENCES: MoneyDetailsPreferences = {
  tab: 'individuals',
  sort: 'largest',
};
