import { describe, expect, it } from 'vitest';
import {
  committeeMoneyPreferences,
  committeeMoneyPreferenceParams,
} from '../committeeMoneyPreferences';

describe('committee donor choices in the address', () => {
  it.each(['individuals', 'lobbyists', 'committees', 'partyUnits', 'expenditures', 'other'])(
    'accepts the existing %s category',
    (category) => {
      expect(committeeMoneyPreferences({ category }).tab).toBe(category);
    },
  );
  it.each(['largest', 'smallest', 'name', 'newest', 'oldest'])(
    'accepts the existing %s sort',
    (sort) => {
      expect(committeeMoneyPreferences({ sort }).sort).toBe(sort);
    },
  );
  it('uses ordinary defaults for missing or invalid choices', () => {
    expect(committeeMoneyPreferences({})).toEqual({ tab: 'individuals', sort: 'largest' });
    expect(committeeMoneyPreferences({ category: 'unknown', sort: 'unknown' })).toEqual({
      tab: 'individuals',
      sort: 'largest',
    });
  });
  it('honors a legacy expenditure address unless a valid explicit category is present', () => {
    expect(committeeMoneyPreferences({ tab: 'spent' }).tab).toBe('expenditures');
    expect(committeeMoneyPreferences({ tab: 'spent', category: 'unknown' }).tab).toBe(
      'expenditures',
    );
    expect(committeeMoneyPreferences({ tab: 'spent', category: 'individuals' }).tab).toBe(
      'individuals',
    );
  });
  it('removes default values from a changed address and keeps nondefault choices', () => {
    expect(committeeMoneyPreferenceParams({ tab: 'individuals', sort: 'largest' })).toEqual({
      category: undefined,
      sort: undefined,
    });
    expect(committeeMoneyPreferenceParams({ tab: 'committees', sort: 'smallest' })).toEqual({
      category: 'committees',
      sort: 'smallest',
    });
  });
});
