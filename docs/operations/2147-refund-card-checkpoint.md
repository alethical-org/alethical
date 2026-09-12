# Refund card delivery checkpoint

Net: The refund data contract and source notes are ready; the card itself is not built or live.

## Accepted delivery

This is pull request F in [issue 2140](https://github.com/alethical-org/alethical/issues/2140),
following the live source import in [pull request 2160](https://github.com/alethical-org/alethical/pull/2160)
and published-directory protection in [pull request 2161](https://github.com/alethical-org/alethical/pull/2161).
The accepted design is `Alethical UX (4).zip`, extracted locally beside `support.js`
at `/tmp/2147-refund-design/exports/design_review_money_refunds_to_donors/`.
Eugene's latest 7-decision message overrides the drawing, including omission of
its extra registration line and keeping the year as a row header in gap rows.

Build in `/private/tmp/alethical-2147-refund-card`, branch
`codex/2147-legislator-refund-card`. Completed data work is commit `6ba654ba`, with
the live protection merged afterward. No F pull request has been opened.

## Completed

- Refund source URL, newest actual file-copy date, and nullable source counting
  note are served on each confirmed legislative committee.
- The same all-year refund history is served on confirmed committees outside the
  selected campaign-money year, without changing that year's finance or the
  ownership/office gates.
- Failed source downloads no longer become nonpublication claims. A known year
  whose file is not held can be served as unavailable.
- A metadata-only enrichment command reads and hash-checks held PDFs. It selects
  published candidate summaries only, preserving matches, amounts, states and
  original copy dates.
- Frontend types and API conversion preserve nulls and carry refunds on both
  selected-year and outside-year committees. No refund component exists yet.
- After merging the directory protection, 96 focused backend checks passed.
  The 4 new frontend API checks and frontend type checking pass.

## Production source metadata

The approved metadata enrichment has completed for 12 published candidate
summaries, covering 2013, 2014, 2015 and 2017 through 2025. All carry the Board's
printed joint-filing counting note. The saved copy dates, 3,706 refund rows,
committee matches, and missing-year records are unchanged in the readback.

Local recovery evidence, retained until final delivery:

- `/tmp/2147-refund-enrichment-before.json`: complete read-only backup of selected
  summaries, their rows, and no-file evidence
- `/tmp/2147-refund-enrichment-dry-run.json`: exact proposed before/after metadata
- `/tmp/2147-refund-enrichment-applied.json`: exact committed metadata change
- `/tmp/2147-refund-enrichment-readback.json`: unchanged-facts assertions and final
  source metadata
- `/tmp/2147-refund-enrichment-ops.py`: bounded backup, dry-run, apply and readback
  wrapper, loading credentials in memory without printing them

The current production API ignores the new metadata until the F API code ships.
No PDF was recopied and no figure or candidate match was recomputed.

## Required answers still pending

These were sent to Eugene as questions. No answer has arrived; neither a later
scope addition nor a peer recommendation approves them.

1. The accepted prompt asks for Abeler's 2016 gap but also allows a gap only
   between matched years. His oldest exact match is 2017; 2015 is not matched.
   Recommendation: omit his 2016 row and use the real Dibble committee 15667
   fixture, which has matching 2015 and 2017 rows, to test the 2016 gap.
2. The Board's 2024 file carries an amount but no contribution-count column.
   Recommendation: print `Count not published` in that count cell and retain
   $10,508 in the amount cell. This new string needs Eugene's answer.

Do not decide those answers from silence. Continue independent work meanwhile.

## Remaining build and delivery

1. Build the semantic 3-column card in `components/campaignMoney`, with fixed copy
   in its companion library. Follow the exact latest accepted strings, layout
   bands, colors, font choices, table caption and source-link rules.
2. Put each card directly after its own committee card and above outside
   spending; retain it under the no-money-for-this-year state, using outside-year
   committee refunds. Keep each committee identifiable and separate.
3. Pin real Abeler figures, distinct missing states, gap bracketing, 2-committee
   placement, all-year behavior, and unconfirmed/loading/failed/expired-match
   exclusions. Preserve the existing held-figures behavior on failed rechecks.
4. Finish the reader guide, local browser checks at the 3 existing layout bands,
   full required checks, F pull request, merge queue, production deployment and
   fresh-context live user check.
5. Report F on [issue 2140](https://github.com/alethical-org/alethical/issues/2140).
   The separately approved 4 follow-on jobs cannot start until A through F are
   live and that report is posted.

Docs check: This checkpoint records completed data work, the source metadata
write, outstanding product answers, and the remaining refund-card delivery.
