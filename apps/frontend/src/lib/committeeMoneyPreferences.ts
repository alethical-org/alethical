import {
  DEFAULT_MONEY_DETAILS_PREFERENCES,
  type MoneyDetailsPreferences,
} from './campaignMoneyPreferences';

/** The donor browser's address state, separate from the page's existing section tab. */
export function committeeMoneyPreferences(params: {
  category?: string;
  sort?: string;
  tab?: string;
}): MoneyDetailsPreferences {
  return {
    tab: ['individuals', 'lobbyists', 'committees', 'partyUnits', 'expenditures', 'other'].includes(
      params.category ?? '',
    )
      ? (params.category as MoneyDetailsPreferences['tab'])
      : params.tab === 'spent'
        ? 'expenditures'
        : DEFAULT_MONEY_DETAILS_PREFERENCES.tab,
    sort: ['largest', 'smallest', 'name', 'newest', 'oldest'].includes(params.sort ?? '')
      ? (params.sort as MoneyDetailsPreferences['sort'])
      : DEFAULT_MONEY_DETAILS_PREFERENCES.sort,
  };
}

export function committeeMoneyPreferenceParams(preferences: MoneyDetailsPreferences) {
  return {
    category: preferences.tab === 'individuals' ? undefined : preferences.tab,
    sort: preferences.sort === 'largest' ? undefined : preferences.sort,
  };
}
