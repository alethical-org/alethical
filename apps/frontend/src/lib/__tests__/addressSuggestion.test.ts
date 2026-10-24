import { expect, it } from 'vitest';
import { preserveSuggestedUnit } from '../addressSuggestion';
const suggestion = '100 N Main St, Minneapolis, MN 55415';
it('carries a unit and ZIP+4 into both the suggestion display and submitted value', () => {
  expect(
    preserveSuggestedUnit(
      '100 North Main Street Apt 4, Minneapolis, MN 55415-1234, United States',
      suggestion,
    ),
  ).toBe('100 N Main St, Apt 4, Minneapolis, MN 55415-1234');
});
it.each([
  '200 N Main St Apt 4, Minneapolis, MN 55415',
  '100 S Main St Apt 4, Minneapolis, MN 55415',
  '100 N Maine St Apt 4, Minneapolis, MN 55415',
  '100 N Main St Apt 4, St Paul, MN 55415',
  '100 N Main St Apt 4, Minneapolis, WI 55415',
  '100 N Main St Apt 4, Minneapolis, MN 55416',
  '100 N Ma Apt 4',
  '100 N Main St Floor 2',
])('does not attach detail to an unconfirmed base: %s', (draft) => {
  expect(preserveSuggestedUnit(draft, suggestion)).toBeNull();
});
it('lets a reader explicitly choose a different unit supplied by the service', () => {
  const other = '100 N Main St Apt 5, Minneapolis, MN 55415';
  expect(preserveSuggestedUnit('100 N Main St Apt 4', other)).toBe(other);
});
