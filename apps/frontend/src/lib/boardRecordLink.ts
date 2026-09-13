/**
 * The way out of a money page to the record it describes on the Board's own site.
 *
 * Its own file rather than `committeeMoneyShared.ts`, which every page downloads: the
 * address resolver, every page that routes to a committee and every page that builds
 * its own metadata import that module, so anything added there is paid for by a reader
 * who never opens the money section. Nothing outside the money screens needs these, so
 * they travel with those screens instead
 * (`docs/operations/page-load-performance-decisions.md`, the first-load budget).
 */

/**
 * The address of one filer's own record on the Board's site.
 *
 * The Board gives every registered filer a page keyed by the registration number we
 * already print on the card, and the path segment before that number says which of
 * the register's 3 kinds the filer is. One address for everybody sent a party unit
 * and a political fund to the **candidate** name search, which cannot contain either
 * of them ([#2179](https://github.com/alethical-org/alethical/issues/2179)).
 *
 * Read off the Board's own viewers and each rendered in a browser on 13 Sep 2026:
 * `candidates/17868/2026/` shows "Abeler, Jim Senate Committee - 17868",
 * `party-unit/20982/` shows "10th Senate District DFL - 20982", and
 * `political-committee-fund/30706/` shows "ACLU of MN Political Action Fund - 30706".
 * The trailing year picks the Board's own 2-year segment: `candidates/17868/2024/`
 * leaves its year control reading "2023 - 2024 Segment".
 *
 * A kind we do not hold falls back to the page listing all 3 searches. A guessed
 * segment would land in a search that cannot contain the filer, which is the defect
 * this replaces rather than a smaller version of it.
 */
export const BOARD_VIEWER_INDEX = 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/';

const BOARD_VIEWER_SEGMENTS: Record<string, string> = {
  candidate_committee: 'candidates',
  party_unit: 'party-unit',
  political_committee_or_fund: 'political-committee-fund',
};

export function boardRecordUrl(
  registerKind: string | null | undefined,
  registrationNumber: string,
  year: number | string,
): string {
  const segment = BOARD_VIEWER_SEGMENTS[registerKind ?? ''];
  if (!segment) return BOARD_VIEWER_INDEX;
  return `${BOARD_VIEWER_INDEX}${segment}/${registrationNumber}/${year}/`;
}

/**
 * The committee card's name line: the registered name, then the registration number,
 * in the state's own listing format (design handoff of 13 Sep 2026, item 1).
 *
 * The hyphen and the number are 1 unit. The space after the hyphen is a no-break
 * space, and the card draws `committeeNumberSuffix` in a run that forbids a break
 * inside it, because a hyphen is itself a place a browser may break a line: without
 * that run a narrow card ends a line on a dangling `-` and drops the number alone
 * onto the next one. A break at the ordinary space in front of the hyphen stays
 * allowed, which is where a long name should wrap.
 */
export function committeeNumberSuffix(registrationNumber: string): string {
  return `-\u00a0${registrationNumber}`;
}

export function committeeNameWithNumber(
  name: string,
  registrationNumber: string | null | undefined,
): string {
  return registrationNumber ? `${name} ${committeeNumberSuffix(registrationNumber)}` : name;
}

/**
 * The stamp's second sentence, which is 1 wording on all 3 pages that draw the stamp.
 * It is 2 constants rather than 1 because the link stops where the label stops: the
 * words `The Board’s record for this committee` are the link and nothing else in the
 * sentence is.
 */
export const BOARD_RECORD_LINK_LABEL = 'The Board’s record for this committee';
export const BOARD_RECORD_SENTENCE_TAIL = ' lists every report it filed, under Reports and Data.';
