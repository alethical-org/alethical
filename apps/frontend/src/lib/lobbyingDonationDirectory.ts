import { formatMoney } from './moneyFormat';
import type { LobbyingLobbyistListRow } from './lobbyingTypes';

export const LOBBYING_DONATION_SORTS = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'donations_desc', label: 'Donations: highest first' },
  { value: 'donations_asc', label: 'Donations: lowest first' },
] as const;

export type LobbyingDonationAmountParts =
  | { figure: string; tail: string; message?: undefined }
  | { figure?: undefined; tail?: undefined; message: string };

/**
 * The row amount as its own dollar figure and quieter tail, so a directory row can
 * set the two in different weights without losing the space between them, and a
 * plain-text surface can join them back into one string.
 */
export function lobbyingDonationAmountParts(
  row: LobbyingLobbyistListRow,
  year?: number | null,
): LobbyingDonationAmountParts {
  const figure =
    row.donation_state === 'reported' && row.donation_amount != null && year != null
      ? formatMoney(row.donation_amount)
      : null;
  if (figure) return { figure, tail: `recorded in ${year}` };
  return {
    message:
      row.donation_state === 'no_records' ? 'No matching donation records' : 'Amount unavailable',
  };
}

export function lobbyingDonationAmountLabel(row: LobbyingLobbyistListRow, year?: number | null) {
  const parts = lobbyingDonationAmountParts(row, year);
  return parts.figure ? `${parts.figure} ${parts.tail}` : parts.message;
}

export function lobbyingCampaignFileDate(date: string): string {
  return `Campaign contribution file copied ${date}`;
}

/** Counts the whole name search, not the visible page, so it follows both controls. */
export function lobbyingEligibleAmountLine(count: number, year: number): string {
  const subject = count === 1 ? 'lobbyist in these results has' : 'lobbyists in these results have';
  return `${count.toLocaleString('en-US')} ${subject} an amount available for ${year}`;
}

export const LOBBYING_DONATION_AMOUNTS_UNAVAILABLE =
  'Donation amounts are unavailable. You can still browse lobbyists by name.';
export const LOBBYING_DONATION_AMOUNT_NOTE =
  'Amounts add campaign donations filed under each lobbyist’s registration number for the selected year, including donated goods or services. They are not complete giving totals.';
export const LOBBYING_DONATION_SCOPE_NOTE =
  'The list covers lobbyists registered on the lobbyist-list copy date. Amounts use matching campaign donation records, not lobbying spending by their clients. Only completed calendar years are offered.';
export const LOBBYING_DONATION_METHOD_NOTE =
  'An amount is shown only when every receiving committee’s matching records pass our full-year checks against its filings. Otherwise, the amount is unavailable. No matching records does not mean the lobbyist gave nothing. Missing amounts appear last in either dollar order.';
export const LOBBYING_DONATION_SOURCE_LABEL = 'View the Board’s campaign contribution file';
export const LOBBYING_DONATION_EXPLANATION_LABEL = 'How these amounts are counted';
export const LOBBYING_DONATION_EXPLANATION_HIDE_LABEL = 'Hide how these amounts are counted';
