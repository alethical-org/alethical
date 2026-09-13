# Board source comparison, 13 September 2026

Net: The next payment refresh is not safe to publish yet. The Board's 2024 spending file has 905 fewer rows, which fails the existing past-year check. All 3 downloads still parse with the expected columns; all 20 sampled report documents are unchanged.

Docs check: This is the dated evidence for [issue 1662](https://github.com/alethical-org/alethical/issues/1662). It records no product change and changes no production data. Findings for [campaign-finance-system-design.md §4.3 (validation before publication) and §9.4 (report documents)](https://github.com/alethical-org/alethical/blob/main/docs/architecture/campaign-finance-system-design.md) stay on that issue. The missing-row investigation is [issue 2171](https://github.com/alethical-org/alethical/issues/2171).

## What was compared

The held bulk baseline is published release `af236cca-a4f8-4efe-9a3a-025259ea380e`, copied on 1 September 2026. The comparison read that release and its 3 snapshot records in a read-only production transaction. It downloaded each saved compressed object, checked its compressed hash and size, decompressed it, and checked the original hash and size. The original records also reproduce each snapshot's recorded order-independent hash.

The run resolved each **All** link from the heading and row labels on the [Board's campaign-finance downloads](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/). It used the existing fetcher and parser from [campaign_finance.py](https://github.com/alethical-org/alethical/blob/main/alethical/pipeline/campaign_finance.py). Fresh files completed at 05:29:01, 05:29:54 and 05:30:05 UTC on 13 September. This was a local comparison, not an ingestion run: no fetch observation, snapshot, release, report document or check verdict was written to production.

## The 3 complete bulk files

All figures below are the sum of the file's **Amount** column over 2015 through 2026. They describe file changes, not an official total for a committee. Unpaid amount is a separate column and is not added to Amount.

| File | Columns, held and new | Held rows | New rows | Row change | Held Amount sum | New Amount sum | Amount change |
|---|---:|---:|---:|---:|---:|---:|---:|
| Contributions received | 15 | 583,222 | 584,814 | +1,592 | $800,677,413.1700 | $803,107,984.7700 | +$2,430,571.60 |
| Expenditures and contributions made | 18 | 377,974 | 377,857 | -117 | $712,450,334.8498 | $712,319,689.6598 | -$130,645.19 |
| Independent expenditures | 19 | 41,130 | 41,141 | +11 | $178,579,449.6700 | $180,173,400.09 | +$1,593,950.42 |

Every header matches the exact pinned column names and order. Every record parses with the existing types. There are no new blank dates or amounts. The malformed-quote record counts are 18 to 18, 17 to 18, and 0 to 0 respectively; the added expenditure record remains readable by the existing default CSV parser. The columns carrying ZIP codes and vendor city/state remain present. Some blank counts change with the changed records; [bulk-comparison.json](bulk-comparison.json) records each one.

Both byte hashes and record-set hashes change for all 3 files. These are not merely shuffled copies. Exact field-by-field comparison, preserving the number of occurrences of identical rows, finds:

| File | Old row occurrences absent from the new file | New row occurrences absent from the held file |
|---|---:|---:|
| Contributions received | 8,405 | 9,997 |
| Expenditures and contributions made | 4,917 | 4,800 |
| Independent expenditures | 210 | 221 |

The source has no payment identifier or amendment field. These are differences between sets of row occurrences, not a claim that a particular old payment became a particular new payment. Repeated rows are counted, never discarded.

Some changes can be localized to 1 field: after matching every other field, 4,463 contribution-row occurrences differ from `Miscellaneous` to `Miscellaneous Income`, and 443 from `Miscellaneous` to `Loan Payable`. Another 12 groups in this comparison have more than 1 possible value on a side, so no individual transition is assigned to them. The file also changes names, employer text, ZIP values and descriptions. Single-field match counts can overlap and must not be added as a partition of all changed rows. These observations do not identify the cause as redaction or as an amendment.

## The refresh-stopping difference

The 2024 part of the expenditures file changes from **44,505 rows to 43,600**, a loss of **905 rows, 2.03%**. Its Amount sum changes from **$90,546,118.4500 to $89,671,529.2100**, down **$874,589.24**. There are 4,662 absent old row occurrences and 3,757 new ones within that year. Of 356 filer-years with changed rows, 38 have a net row loss.

| Largest net decreases in 2024 | Registration | Old occurrences absent | New occurrences | Net rows | Net Amount |
|---|---:|---:|---:|---:|---:|
| Senate Victory Fund (SVF) | 20013 | 590 | 81 | -509 | -$488,405.62 |
| Bristol, John House Committee | 18852 | 104 | 41 | -63 | -$23,754.80 |
| Moller, Kelly House Committee | 18157 | 41 | 0 | -41 | -$7,894.35 |
| Conservation Minnesota Voter Project | 41243 | 30 | 1 | -29 | -$19,636.29 |

779 removed 2024 occurrences are copies of a row that still appears at least once in the new file. That does **not** establish that the old copies were erroneous: the source can contain separate, identical payments. All changed filer-years and their arithmetic are in [changed-records-by-filer-year.json](changed-records-by-filer-year.json).

The existing `no_published_year_lost_rows` check fails with `2024 fell from 44,505 rows to 43,600`. The other structural and movement checks pass. The audit deliberately supplies no filings context or split verdicts to its local check, so those checks are recorded as `not_run`; that does not mean production lacks a filings snapshot. No reported-total reconciliation or document verdict is being claimed here.

[Issue 2171](https://github.com/alethical-org/alethical/issues/2171) requires comparison with the affected committees' reports before judging whether the loss is an explained correction or missing money. Keep the current release in place. A new refresh must retain the existing checks, and no exception is authorized by this audit. The separate held historical replacement in [issue 2142](https://github.com/alethical-org/alethical/issues/2142) also remains held; Action 4 Liberty 41173 received no individual request in this job.

## 20 held report documents

The production inventory contains 5,672 held documents from 2022 through 2026 after excluding registration 41173: 982, 1,007, 1,124, 1,307 and 1,252 by year. Kinds were joined to the published filings snapshot `9cd121a0-4fd2-467e-b4a4-5c3c600febfb`.

Select 4 per year before inspecting fresh responses: 1 original and 1 amended candidate report, 1 party report and 1 committee/fund report. The party selection is original in even years and amended in odd years; the committee/fund selection is the reverse. Within each group, select the smallest SHA256 of `alethical-1662-2026-09-13|` followed by the pipe-joined year, kind, registration, report type, amendment index, special-election flag and document hash. This gives 10 candidate, 5 party and 5 committee/fund reports; 10 original and 10 amended; 16 year-end and 4 pre-primary reports. This is a diagnostic sample across kinds and years, not a population estimate.

Between 05:29:19 and 05:29:40 UTC, each exact held version was requested through [campaign_finance_report_documents.py](https://github.com/alethical-org/alethical/blob/main/alethical/pipeline/campaign_finance_report_documents.py), retaining its registration, year, report type, amendment index and special-election flag. The existing route requires a POST form and its empty `PHPSESSID` cookie. Requests used the existing 0.25-second minimum spacing after each completed comparison. Stored compressed and decompressed hashes and sizes had to pass before a fresh body was compared.

**20 of 20 returned HTTP 200 PDFs and matched their held bodies byte for byte.** Both sets total **1,984,516 bytes**. Extracted text, amount sequences and report identifiers also match. Exact forms, source URLs, hashes, sizes and per-document outcomes are in [report-documents.json](report-documents.json). No raw PDF, donor address, extracted text or credential is committed.

No selected document shows a new route, redaction or amendment-handling problem. The sample contains no special-election report and no same-filing original/amended pair; the held inventory contains no such pair for these years. Unsampled documents may differ or be unavailable. The Board's reposting progress and the cause of the bulk changes cannot be inferred from 20 unchanged PDFs.

## Reproducing the comparison

Use the named published release as the baseline, not whichever release happens to be current later. Read its `cf_snapshot` and `cf_snapshot_body` metadata in a read-only transaction and fetch the content-addressed saved objects. Check both compressed and decompressed hashes and sizes. For each source file, use `resolve_downloads`, `fetch_download` and `parse_and_measure` from the linked loader; write the parser's intermediate file only to a temporary directory.

For the record comparison, apply the loader's `_record_fingerprint` to every raw parsed row. It hashes each UTF-8 field with its byte length, so embedded separators cannot collapse different fields. Build a counter of fingerprints for each copy. Counter subtraction supplies absent old and new occurrences, preserving duplicate multiplicity; sorted fingerprints reproduce the loader's record-set hash. Accumulate exact Decimal amounts and counts by filer and year without attempting to pair revisions. Run the existing structural/band validation with no operator override, and state separately any checks not executed.

Use the sample method above against the held report inventory, then the saved form for each selected document. Read the stored version with `read_document` and the new version with `fetch_document`; do not substitute the latest amendment. Compare original bytes first. If bytes differ, distinguish unchanged money from changed money before deciding what the difference means.
