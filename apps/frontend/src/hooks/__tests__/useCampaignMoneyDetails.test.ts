import { expect, it } from 'vitest';
import { campaignMoneyHistoryYears } from '../useCampaignMoneyDetails';

it('extends the history through the current calendar year', () => {
  expect(campaignMoneyHistoryYears(new Date('2026-06-01'))).toEqual([
    2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026,
  ]);
  expect(campaignMoneyHistoryYears(new Date('2027-06-01'))).toHaveLength(13);
  expect(campaignMoneyHistoryYears(new Date('2027-06-01')).at(-1)).toBe(2027);
});
