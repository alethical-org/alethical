# What the retired campaign-finance build got wrong, measured

*Evidence behind [`docs/architecture/campaign-finance-system-design.md`](../architecture/campaign-finance-system-design.md).
A working Minnesota campaign-finance product was built on Base44 at alethicalfinance.com and is
being retired. Everything below was measured on 10–11 August 2026 from its complete data export
(16 tables, 1,002,007 rows) and its complete code export (202 files), not from its screens.*

**Net:** Two failures made every displayed total wrong, and both trace to one root cause:
merging rows one at a time into a growing table, keyed on a fingerprint rebuilt from each
row's own contents. The replacement design removes that root rather than guarding against it.
This is a frozen record; the retired system is not being fixed.

---

## 1. A quarter of the money rows repeat another row

| table | rows | rows repeating another row's fingerprint | share |
|---|---|---|---|
| `FinanceTransaction` | 519,535 | 171,308 | 33% |
| `CandidateTransaction` | 202,615 | 44,119 | 22% |
| `CongressionalTransaction` | 232,038 | 25,831 | 11% |
| **total** | **954,188** | **241,258** | **25%** |

Of those, 236,048 are identical in every business field and 5,210 differ somewhere. Blank
fingerprints are excluded from these figures.

**The cause, read from the importer.** `importItemizedContributions/entry.ts` fetched the
fingerprints already stored, then wrote every incoming row whose fingerprint it did not find.
Two faults:

1. The lookup was capped at 1,000 rows per batch of 50 committee registration numbers. With
   202,615 rows across 710 candidates, 50 candidates hold far more than 1,000 rows between
   them, so most stored rows were invisible to the check.
2. Nothing compared the incoming rows against each other. A file containing the same row twice
   wrote both.

**The code predicts the measurement.** Four importers did deduplicate within their own batch,
three of them handling congressional and federal data. That table sits at 11%. The two tables
fed by importers with neither guard sit at 33% and 22%.

**A caveat that matters for the new design.** Two payments can be legitimately identical: same
donor, same day, same amount. The Republican Party of Minnesota's 2025 filing contains exactly
that, twice. So these figures are an upper bound, and more importantly, no fingerprint built
from a row's contents can ever separate a real repeat payment from a re-imported one.

## 2. Fields the source provides were discarded on the way in

| field | rows missing it | what the state actually publishes |
|---|---|---|
| date | 355,925 of 954,188 | every row dated, 0 blank in 583,152 |
| city and state | 717,721 of 722,150 state rows | zip only, but present |
| affected committee | 405,972 of 519,535 | present for independent expenditures |

Two further date failures were invisible to any format check:

- 184,610 rows hold a raw spreadsheet serial number where a date belongs (`44196`). A
  converter for exactly this existed in the code and was never applied on display.
- 28,210 federal rows hold values like `2026-31-03`: correctly shaped, 31st month.

## 3. Summary lines stored as transactions

The system stored non-itemized report totals as individual payments, which is how a $1.06
"contribution" with no donor exists in its data. A report's summary figure and an individual
payment are different kinds of fact; adding them together double counts.

## 4. Totals computed over truncated queries

Every figure was arithmetic performed in the visitor's browser over whatever rows that page
had fetched, with no server-side aggregation anywhere.

- The vendors page reported "985 vendors · $169,140,078" from the top 2,000 rows of each of 3
  tables.
- The officials page reported "5000 officials" against 8,878 stored. 5,000 was the row limit
  it requested.
- The candidate list header read "705 candidates total". That string was hardcoded in the
  page; 710 records existed.
- One candidate page issued 37 requests, transferred 1.1 MB, and finished 8.7 seconds after
  navigation.

## 5. Amendments beside finals

`FinanceReport` held the state party's 2025 report four times: an original plus three
amendments, each restating the same $4,865,978.57. Stored correctly. The risk is on the query
side, where filtering by year alone counts a preliminary filing and its final replacement
together.

## 6. Identity by exact string

Donors had no record of their own; a donor was the text of their name. "Messinger, Alida" and
"Messinger, Alida R" were two different people. 103,810 rows carried no fingerprint at all and
could not be traced to any official record.

## 7. Repair tools that could not work

Five functions existed to fight duplicates. Of the two that mattered:

- The deduplication page and its background job used different field names in both directions,
  so the page saw zero duplicates and its delete request arrived empty.
- The other matched rows on date and amount alone, ignoring who paid and who was paid.
  Replayed over the exports it would have deleted 549,897 rows, of which 451,162 were
  different donors who happened to share an amount and a date.

## 8. What the state actually publishes

Verified by downloading the files.

- 583,152 itemized contributions covering 2015 to present, free, no key. The count was 583,120
  the previous day; the file grows daily, which is why the replacement design stores dated
  snapshots.
- Every row carries a date. The missing dates above are an import failure, not a source limit.
- No per-transaction identifier, which is why the new design keys on the snapshot rather than
  the row.
- The $200 threshold applies to a donor's cumulative giving, not to each payment: 327,759 of
  583,152 rows are individually under $200.
- Negative amounts do not represent refunds. There is 1 in 583,152. Money returned within 90
  days can drop off a filing entirely, and money returned later appears as an expenditure.
