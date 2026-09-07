/**
 * The big number above a list of results, and the unit noun beside it.
 *
 * A screen that has not been told its count yet passes `null`, and this is what
 * keeps that case from printing `0`. `/bills` printed "0 bills" for about a
 * second of every visit while the list was still being read, which is a
 * statement about Minnesota's records that is not true — the current Legislature
 * has 10,491 (issue #1996). A verified zero still prints `0`; only the figure
 * nobody has yet is blank.
 *
 * Blank rather than a placeholder bar on purpose. The line holds its height
 * because the same text element in the same style prints a non-breaking space,
 * so nothing below it can move. A bar would have to be given a height, and
 * guessing a height is the defect this issue is about.
 */
export const UNKNOWN_RESULT_COUNT = '\u00a0';

export function resultCountLine(
  count: number | null,
  noun: string,
): { figure: string; unit: string | null } {
  if (count === null) return { figure: UNKNOWN_RESULT_COUNT, unit: null };
  return {
    figure: count.toLocaleString('en-US'),
    unit: count === 1 ? noun : `${noun}s`,
  };
}
