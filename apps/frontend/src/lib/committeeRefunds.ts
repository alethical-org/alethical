import type { CommitteeRefunds } from '../data/types';

/** Fixed copy for the accepted all-year refund card on a confirmed committee. */
export const refundCopy = {
  heading: "Refunds Minnesota paid to this committee's donors",
  introduction:
    'Minnesota refunds eligible contributions to state candidates, up to $75 per person or $150 per married couple filing jointly each year. Refunds go to donors, not the committee.',
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
  jointFilingNote: 'A married couple filing jointly counts as 1 contribution',
  sourceMethod: "Matched by exact candidate name, office and party in the Board's yearly summary",
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
