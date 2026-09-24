/** One run of the chart's dek. `bold` marks the 2 words a reader matches against the
 *  labels on the money cards, so the emphasis and the labels can never drift apart. */
export type DekSegment = { text: string; bold?: boolean };

/** The dek run as one string: what a text-only surface prints, and what a test pins. */
export function dekText(segments: readonly DekSegment[]): string {
  return segments.map((segment) => segment.text).join('');
}

/**
 * What separates the 2 contribution figures, and Minnesota's rule behind the split.
 *
 * The one place both terms are explained (#2182). It used to be 2 grey paragraphs under
 * the figures on the Money in card (`itemizedContributionsNote`, `unnamedMoneyExplanation`),
 * which still draw wherever the chart is absent; where the chart draws, its dek carries
 * them instead and the card is figures only.
 *
 * `.claude/rules/grounded-answers.md` rule 12 decides both halves of the naming sentence:
 * it states when a name is **required**, never that a smaller donor goes unnamed, and it
 * keeps the clause saying a committee may name smaller donors, because filer 18135's 2026
 * pre-general itemizes 215 donors at or under $200 and a reader meeting a named $50
 * donation would otherwise read our page as wrong. A ballot-question filer's line is $500,
 * from Minnesota Statutes 10A.20 subd. 3(c) and the Board's own handbook for those filers.
 */
export function namedMoneyDefinition(isBallot: boolean): DekSegment[] {
  return [
    { text: 'Itemized contributions', bold: true },
    { text: ' list donor names and amounts; ' },
    { text: 'non-itemized contributions', bold: true },
    {
      text:
        ' are reported as a combined total without names. ' +
        (isBallot
          ? 'Minnesota requires donors to be named when their total giving to this committee exceeds $500 in a year, ' +
            'the threshold for a ballot-question committee; committees may also name donors who give $500 or less.'
          : 'Minnesota requires donors to be named when their total giving to this committee exceeds $200 in a year; ' +
            'committees may also name donors who give $200 or less.'),
    },
  ];
}

/** Small labels needed before the donation browser's code arrives. */
export const moneyDetailsPageCopy = {
  chartFailed: 'We could not load the complete donation list, so the chart is withheld',
  /** Every read succeeded, but the totals and the lists came from copies of the Board's
   *  records taken at different times, so they are not shown together (#2363). */
  chartMixedCopies:
    'Our totals and the donation list were copied at different times, so the chart is held back until they match',
  outsideFailed:
    'We could not load this right now. This is a problem on our side and says nothing about what was spent.',
  chartLoading: 'Loading the contribution breakdown…',
  outsideLoading: 'Loading the list of outside spenders…',
  fullRecord: 'Committee details and filings',
  freshnessMismatch:
    'We cannot give these money records one shared download date. Their recorded dates differ or a date is missing.',
  refreshRecords: 'Try again',
} as const;

/**
 * The date under every money surface: the day we downloaded Minnesota's bulk payment
 * files, and what that date is not.
 *
 * It lives here rather than in `committeeMoneyShared.ts` because that module is read by
 * the startup program, so every reader of every page downloads its words before anything
 * can draw, and this sentence is only ever printed on a money surface
 * ([issue 2184](https://github.com/alethical-org/alethical/issues/2184)).
 *
 * Report totals carry their own source-copy date. An older response without that
 * date retains the honest one-date fallback (issue 2192).
 *
 * The date keeps a no-break space inside it, so a narrow column cannot leave a line
 * ending "…Sep 1," and read as a date running into the next clause.
 */
export function paymentFilesDownloadedLine(day: string, reportTotalsDay?: string | null): string {
  if (reportTotalsDay) {
    return (
      `Minnesota’s payment files copied ${day.replace(/,\s/, ',\u00a0')}; ` +
      `report totals copied ${reportTotalsDay.replace(/,\s/, ',\u00a0')}. ` +
      'These are copy dates, not reporting periods.'
    );
  }
  return (
    `Minnesota’s payment files copied ${day.replace(/,\s/, ',\u00a0')}. ` +
    'This is a copy date, not a reporting period. The report totals were copied separately.'
  );
}
