# Money page refinements

## Authorized outcome

Eugene requested implementation of the `/money` review, asked for the model setting,
then gave `go` with a 1-character reply. The work includes tests, browser review,
independent review, a pull request, merge, deployment, and a live check.
Eugene also requested replacing the dotted-zero date font on `/money` with the
Libre Franklin numbers on the legislator money tab, and a lasting handoff rule.
No new drawing is required. Existing layout, destinations, and source data remain.

## Acceptance checks

- Recent reports may cover different periods. The heading does not claim they
  share a period. The separate report count names its own served cutoff.
- Search accepts part of a filed name. The whole visible field focuses the input,
  a short placeholder fits phones, and Enter and Search both reach results.
- The introduction includes lobbying. Cards describe what a reader can find.
  Confirmation wording explicitly identifies campaign committee matches.
- The coverage note distinguishes union political funds from wider union finances.
- The official Board is named and linked. Filer names open committee records by
  their served registration numbers. Missing numbers never produce guessed links.
- Dates and numeric metadata use Libre Franklin with tabular digits. The handoff
  rule overrides dotted/slashed-zero fonts in Design output before implementation.

## Work and proof

1. Current task owns implementation and release.
2. Independent test worker owns focused copy, adapter, rendered font, and focus tests.
3. Documentation worker owns design guidance and the campaign-money section guide.
4. Run focused and full frontend checks, plus document checks.
5. Inspect desktop, tablet, and phone views together; repair demonstrated defects.
6. Obtain independent code review and fresh-context browser review.
7. Push a pull request, wait for current-head and merge-queue checks, then exercise
   the deployed `/money` search, report links, and dates.

## Sources

- [Political Committee and Political Fund Handbook, pages 6 and 7](https://register.cfb.mn.gov/pdf/publications/handbooks/PCF_handbook.pdf):
  political funds track election money within an existing organization; they are
  not separate organizations, and their activity is reported to the Board.
- [Aaron Repinski money tab](https://www.alethical.com/legislators/aaron-repinski?tab=money):
  Libre Franklin with tabular digits is the requested number treatment.
