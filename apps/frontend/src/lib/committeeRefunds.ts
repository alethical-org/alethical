import type { CommitteeRefunds } from '../data/types';

/** Fixed copy for the accepted all-year refund card on a confirmed committee. */
export const refundCopy = {
  // Minnesota is named rather than called "the state", and the refund goes to the
  // donors, so "paid this committee's donors" says the same thing in 2 fewer words.
  heading: "Refunds Minnesota paid this committee's donors",
  // "one person", not "1 person": the numeral put a third figure in a sentence that
  // already carries 2 amounts. "filing jointly" is the Board's own wording and the
  // phrase a reader meets on the refund form, and it is the phrase the note under the
  // table uses, so the card says it one way (#2186). The amounts are the Board's own,
  // read at source on 13 Sep 2026.
  introduction:
    'Minnesota pays a resident back for a gift to a state candidate, up to $75 a year for one person and $150 for a married couple filing jointly. This is money the state returned to donors, not money the committee received.',
  columns: ['Year', 'Contributions refunded', 'Amount refunded'],
  caption: 'Refunds by year',
  notPublished: 'Not published',
  countNotPublished: 'Count not published',
  notPublishedDetail: (year: number) => `The Board published no summary for ${year}`,
  // Its own line rather than the date's, because a link whose words are a date tells a
  // reader in a screen reader's list of links when we copied something and never where
  // it goes. "The Board's" rather than "Minnesota's": 2 other link labels on this tab
  // already open with Minnesota's, and the 2 notes above this one say the Board twice.
  summaries: "The Board's refund summaries",
  unavailable: 'Not yet copied by Alethical',
  jointFilingNote: 'The Board counts a married couple filing jointly as one contribution',
  // 18 words to 11. `exactly` goes with them: a match on 3 fields is exact or it is not
  // a match.
  sourceMethod: "Matched to the Board's yearly summary by candidate name, office and party",
  // `last` goes: a date already says it was the last time, and the note above it and the
  // tab's own freshness line both say `copied` alone for the same act.
  copiedOn: (day: string) => `Board summary files copied ${day}`,
  notMatched:
    "The Board's refund summaries name no row for this committee's candidate, office and party",
} as const;

/** An unpublished year belongs only inside this committee's matched history. */
export function visibleRefundYears(refunds: CommitteeRefunds): CommitteeRefunds['years'] {
  const matched = refunds.years.filter((row) => row.state === 'reported').map((row) => row.year);
  const oldest = Math.min(...matched);
  const newest = Math.max(...matched);
  return refunds.years
    .filter(
      (row) =>
        row.state === 'reported' ||
        row.state === 'unavailable' ||
        (row.state === 'not_published' && row.year > oldest && row.year < newest),
    )
    .sort((a, b) => b.year - a.year);
}
