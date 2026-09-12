# Refund card delivery checkpoint

Net: The refund data contract and source notes are ready; the accepted card is built locally and its checks are in progress.

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
  selected-year and outside-year committees. The refund component now uses those inputs.
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
- The local browser relay reads public production data; it adds only the already
  enriched source metadata so the not-yet-deployed API fields can be previewed.
  Final checks must use the actual production response after F deploys.
- Full backend run: 2,546 passed; 3 script-inventory tests exposed the newly added
  metadata command missing from the inventory. The inventory is corrected and
  all 16 inventory checks now pass. No application behavior failed.

## Remaining release

1. Save and upload the completed card, tests and documentation. Run exact-upload
   checks and open the F pull request.
2. Complete current-head and merge-queue checks, deploy, then read the actual live
   refund block and cards, including a fresh-context user-flow check.
3. Report F on [issue 2140](https://github.com/alethical-org/alethical/issues/2140).
   Keep the historical replacement explicitly held and its old published data
   unchanged. The later follow-on queues remain recorded in the parent delivery plan.

Docs check: This checkpoint records the completed card, source metadata enrichment,
approved source corrections, local validation and remaining release checks.
