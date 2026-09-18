import { formatMoney } from './moneyFormat';
import type { LobbyingLobbyistListRow } from './lobbyingTypes';

export const LOBBYING_DONATION_SORTS = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'donations_desc', label: 'Donations: highest first' },
  { value: 'donations_asc', label: 'Donations: lowest first' },
] as const;

export function lobbyingDonationAmountLabel(row: LobbyingLobbyistListRow, year?: number | null) {
  if (row.donation_state === 'reported' && row.donation_amount != null && year != null) {
    return `${formatMoney(row.donation_amount)} recorded in ${year}`;
  }
  return row.donation_state === 'no_records'
    ? 'No matching donation records'
    : 'Amount unavailable';
}

export const LOBBYING_DONATION_AMOUNT_NOTE =
  'Amounts add campaign donations filed under each lobbyist’s registration number for the selected year, including donated goods or services. They are not complete giving totals.';
export const LOBBYING_DONATION_SCOPE_NOTE =
  'The list covers lobbyists registered on the lobbyist-list copy date. Amounts use matching campaign donation records, not lobbying spending by their clients. Only completed calendar years are offered.';
export const LOBBYING_DONATION_METHOD_NOTE =
  'An amount is shown only when every receiving committee’s matching records pass our full-year checks against its filings. Otherwise, the amount is unavailable. No matching records does not mean the lobbyist gave nothing. Missing amounts appear last in either dollar order.';
