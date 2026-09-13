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
    { text: 'The filing names who gave for ' },
    { text: 'itemized contributions', bold: true },
    { text: ' and not for ' },
    { text: 'non-itemized contributions', bold: true },
    {
      text: isBallot
        ? '. Minnesota requires naming once a donor’s giving passes $500 for the year, the ' +
          'line for a ballot-question committee, and a committee may name smaller donors.'
        : '. Minnesota requires naming once a donor’s giving passes $200 for the year, and a ' +
          'committee may name smaller donors.',
    },
  ];
}

/** Small labels needed before the donation browser's code arrives. */
export const moneyDetailsPageCopy = {
  chartFailed: 'We could not load the complete donation list, so the chart is withheld.',
  outsideFailed:
    'We could not load this right now. This is a problem at our end and says nothing about what was spent.',
  chartLoading: 'Loading the contribution breakdown…',
  outsideLoading: 'Loading the list of outside spenders…',
  fullRecord: 'Everything we hold on this committee',
  freshnessMismatch:
    'We cannot give these money records one shared download date. Their recorded dates differ or a date is missing.',
  refreshRecords: 'Check these records again',
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
 * ending "…on Sep 1," and read as a date running into the next clause.
 */
export function paymentFilesDownloadedLine(day: string, reportTotalsDay?: string | null): string {
  if (reportTotalsDay) {
    return (
      `We downloaded Minnesota’s payment files on ${day.replace(/,\s/, ',\u00a0')} ` +
      `and its report totals on ${reportTotalsDay.replace(/,\s/, ',\u00a0')}. ` +
      'Neither is the period the money covers.'
    );
  }
  return (
    `We downloaded Minnesota’s payment files on ${day.replace(/,\s/, ',\u00a0')}, ` +
    'which is not the period the money covers. The report totals were copied separately.'
  );
}
