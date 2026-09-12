# Refund card delivery checkpoint

Net: The refund-history card and its source fields are live. Each confirmed committee keeps its own all-years history, including when the selected campaign year has nothing reported.

## Accepted delivery

This is pull request F in [issue 2140](https://github.com/alethical-org/alethical/issues/2140),
following the live source import in [pull request 2160](https://github.com/alethical-org/alethical/pull/2160)
and published-directory protection in [pull request 2161](https://github.com/alethical-org/alethical/pull/2161).
The accepted design is `Alethical UX (4).zip`, extracted locally beside `support.js`
at `/tmp/2147-refund-design/exports/design_review_money_refunds_to_donors/`.
Eugene's latest 7-decision message overrides the drawing, including omission of
its extra registration line and keeping the year as a row header in gap rows.

The build worktree is `/private/tmp/alethical-2147-refund-card`, branch
`codex/2147-legislator-refund-card`. [Pull request 2162](https://github.com/alethical-org/alethical/pull/2162)
is live at [commit 71280542](https://github.com/alethical-org/alethical/commit/71280542096c1869f3663c9f9348134f66fd32e9).
The website and API both serve that release.

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
  selected-year and outside-year committees. The refund component now uses those inputs.
- All 2,608 frontend tests and 2,549 backend tests pass, including 28 new rendered
  refund cases. Type checking, lint, production build, current-head checks and
  the combined merge-queue checks pass.

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

The production API serves the stored metadata. No PDF was recopied and no figure
or candidate match was recomputed.

## Approved source corrections

Eugene approved these on 12 September 2026:

1. Abeler's oldest matching refund year is 2017. His card omits 2016. The real
   Dibble Senate committee (15667) has matching 2015 and 2017 rows for the gap test.
2. Abeler's 2024 count prints `Count not published`, while the amount remains
   $10,508. The state belongs to the individual row; the renderer handles any non-null
   count normally. The public 2024 PDF matches the held bytes: 334 candidate rows have blank
   counts; 5 additional rows are totals. The count column is blank on all 12 pages.

The historical replacement separately remains held after 3 spaced retries for
Action 4 Liberty PAC (41173), 2026. No preservation exception is approved.

## Local validation

- 2,608 frontend tests passed, including 28 new rendered refund tests.
- Type checking, lint, production web build and existing first-load limit passed.
- Phone (375), tablet (900) and desktop (1280) browser reads showed the correct
  fonts, fixed 3-column table, source link and no horizontal overflow. Keyboard
  focus on the source link has the tab's violet outline.
- Switching Abeler from 2025 to 2021 kept all refund rows. Dibble's phone table
  shows a 2016 year header and one 2-column missing cell between matched years.
- The local browser relay used public production data plus the already enriched
  source metadata. The final checks below use the actual production responses.
- The runnable-job inventory includes the metadata helper. Its 16 focused checks
  and all 2,549 backend tests pass.

## Live release checks

- Public production responses for Abeler in 2025 and 2021, Dibble in 2025, and
  Gottfried in 2024 and 2015 pass the all-years and separate-committee assertions.
  Evidence is saved in `/tmp/2147-live-api/`, with the bounded checker at
  `/tmp/2147-refund-live-api-check.py`.
- An independent live browser reader checked Abeler's figures and absent 2016,
  Dibble's real 2016 gap, and Gottfried's 2 separate cards. Both Gottfried refund
  cards stay visible under the empty 2015 campaign-year state.
- Phone (390), tablet (834) and desktop (1280) reads keep all 3 columns without
  horizontal overflow. Table headings, year headers, gap-cell spans, source
  destination and keyboard focus pass. New-tab activation is not observed by the
  in-app browser; the destination itself loads.
- The [A–F live report](https://github.com/alethical-org/alethical/issues/2140#issuecomment-5649295250)
  records this release and keeps the historical replacement explicitly held.
  The old published campaign-finance data remains unchanged by that held run.

Docs check: This checkpoint records the live card, source metadata enrichment,
approved source corrections, complete test results and live checks with their limits.
