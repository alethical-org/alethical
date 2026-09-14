/** The lobbying links used in initial page responses; keep directory wording out of startup. */
export const MONEY_LANE_LOBBYING = {
  title: 'Lobbying',
  body: 'Who is registered to lobby the state, who they represent, and what those organisations report spending each year',
} as const;

export function lobbyistLaneCount(value: number | null | undefined): string | null {
  return value == null ? null : `${value.toLocaleString('en-US')} REGISTERED TODAY`;
}

export function lobbyingNoSpendingRows(year: number | null): string {
  return year == null
    ? "No spending rows in the Board's file, so no page to open"
    : `No spending rows in the Board's file through ${year}, so no page to open`;
}
