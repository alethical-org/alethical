import type { CommitteeRefunds } from '../data/types';

/** Fixed copy for the accepted all-year refund card on a confirmed committee. */
export const refundCopy = {
  heading: "Refunds the state paid to this committee's donors",
  introduction:
    'Minnesota pays a resident back for a gift to a state candidate, up to $75 a year for 1 person and $150 for a married couple filing together. This is money the state returned to donors, not money the committee received.',
  columns: ['Year', 'Contributions refunded', 'Amount refunded'],
  caption: 'Refunds by year',
  notPublished: 'Not published',
  countNotPublished: 'Count not published',
  notPublishedDetail: (year: number) => `The Board published no summary for ${year}`,
  unavailable: 'Not yet copied by Alethical',
  jointFilingNote: 'The Board counts a married couple filing jointly as one contribution',
  sourceMethod:
    "Rows from the Board's yearly refund summary whose candidate name, office and party match this committee's registration exactly",
  copiedOn: (day: string) => `Board summary files last copied ${day}`,
  notMatched:
    "The Board's refund summaries name no row for this committee's candidate, office and party.",
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
