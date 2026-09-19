import { formatMoney } from './moneyFormat';
import type { LobbyingLobbyistListRow } from './lobbyingTypes';

export const LOBBYING_DONATION_SORTS = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'donations_desc', label: 'Recorded amount: highest first' },
  { value: 'donations_asc', label: 'Recorded amount: lowest first' },
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

/**
 * Counts the whole name search, not the visible numbered page, so it follows both
 * controls. A search that matches one lobbyist still prints it, because the reader
 * cannot otherwise tell a missing amount from one we chose not to show.
 */
export function lobbyingEligibleAmountLine(count: number, total: number, year: number): string {
  const noun = total === 1 ? 'lobbyist' : 'lobbyists';
  return `${year} campaign contribution amounts are available for ${count.toLocaleString('en-US')} of the ${total.toLocaleString('en-US')} ${noun} in these results`;
}

export const LOBBYING_DONATION_AMOUNTS_UNAVAILABLE =
  'Donation amounts are unavailable. You can still browse lobbyists by name.';
export const LOBBYING_DONATION_AMOUNT_NOTE =
  'Each amount totals campaign contributions filed under the lobbyist’s registration number for the selected year, including donated goods or services. These are campaign contributions, not lobbying spending by their clients. They are not a complete record of the lobbyist’s giving.';
export const LOBBYING_DONATION_SCOPE_NOTE =
  'This list shows the lobbyists who were registered when the lobbyist list was copied. Only completed calendar years are available.';
export const LOBBYING_DONATION_METHOD_NOTE =
  'We show an amount only when each receiving committee’s matching records pass our checks against that committee’s filings for the full year. Otherwise, the amount is unavailable. Finding no matching records does not mean the lobbyist gave nothing. Lobbyists with missing amounts appear last whether the list is sorted from highest to lowest or lowest to highest.';
export const LOBBYING_DONATION_SOURCE_LABEL = 'View the Board’s campaign contribution file';
export const LOBBYING_DONATION_EXPLANATION_LABEL = 'How these amounts are counted';
export const LOBBYING_DONATION_EXPLANATION_HIDE_LABEL = 'Hide how these amounts are counted';
