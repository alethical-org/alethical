# Campaign-finance history refresh

Net: extend the ordinary filings snapshot to 2022 through 2026 while keeping each
comparison attached to the exact source copies it checked.

Owner: [historical totals task](https://github.com/alethical-org/alethical/issues/2142),
part of [the campaign-money build](https://github.com/alethical-org/alethical/issues/2140).
This replaces the rejected protected-history approach. The rejected code remains
outside the repository in its saved recovery checkpoint.

## Approved boundaries

- Use the existing whole-snapshot replacement, with no separate historical store.
- Use all 1,603 filers from the held directory. The ordinary missing-record and
  coverage-end checks remain mandatory. Do not publish with `--only-filers`.
- Copy the saved directory unchanged. Its original dates remain in the response
  archive. Record the changed termination dates for registrations 18452, 19090 and
  41173 for the next ordinary directory refresh.
- Fetch every catalogue and all 3 financial segments anew: 6,412 filer requests
  before retries or report downloads. The source-fetch budget is 40 to 60 minutes.
- A valid official total remains visible independently of either PDF comparison.
  The contribution check controls the derived split; the spending check controls
  its comparison note. Neither requires the other to pass.
- Both comparisons match the current filings snapshot and their respective bulk
  snapshot. Replacing either source retires its earlier result.
- Run both comparisons for 2022, 2023, 2024, 2025 and 2026 after publication. During
  that interval the existing unchecked state appears.
- Carry known receipt dates forward by exact report version with `--limit 0` before
  another replacement can prune the previous generation.
- Update filing freshness only. Named payments keep their own download date.

## Delivery sequence

1. Ship the saved-directory input, source-copy checks and necessary legacy PDF
   layout support. Test damaged archives, preserved filer-years, retired verdicts,
   independent results and legacy schedules. Complete current-head checks and live
   backend deployment. Keep the directory capture time in the existing snapshot
   measurements and use it for register dates, including retained-archive replay.
2. Wait for the parent build owner to confirm the approved Money out card
   correction and source-specific freshness wording are live. The historical
   refresh must not start before those corrections.
3. Refresh the read-only recovery backup. Check archive fingerprints, current
   source identities and absence of competing publication. Prove rollback against
   a local copy and run a scoped source dry run.
4. Run the ordinary loader once for all 5 years with the saved directory. Keep
   request counts and final validation. Investigate a refused run without bypassing
   missing-record or coverage checks.
5. Carry forward known receipt dates. Run both independent comparisons for all
   5 years. Keep the outcome for every committee-year and reason.
6. Check live committee and legislator responses, unchanged bulk identity and its
   download date, source references, and the 2022/2023 split and spending states.
7. Report each year's pass/withhold counts by check and reason, actual requests,
   elapsed time, and handling of the 3 changed directory records on the historical
   totals task and campaign-money build task. Update this checkpoint with the live
   result.

## Current checkpoint

- The server changes are in [pull request 2156](https://github.com/alethical-org/alethical/pull/2156).
  All 2,470 server tests, lint, formatting and database type checks passed before
  upload. No production replacement has begun.
- The rejected extension checkpoint's SHA256 is
  `7a1635d93747f24f1aa8620c50c414736f704fa6d819ac51b2eaa9b60a211efd`.
- The recovery copy captured on 12 September 2026 at 17:54:23 UTC contains
  1,603 filers, 3,630 committee-years, 36,655 catalogue rows, 55,845 figure rows,
  both comparison tables and 3,735 known receipt dates. The retained archive and
  every exported table have saved SHA256 fingerprints.
- A disposable database rehearsal restored the original source pointer and
  current-copy comparison rows from that actual recovery copy. Source rows
  matched every saved fingerprint. The production restore refuses a changed
  bulk release, an unexpected current filing copy or changed prior-generation
  source rows.
- Scoped and full Board requests wait for the card, source-date wording and
  server checks to be live. Money in runs before money out so the latter can
  read any newly kept report documents.

- Keep the existing cache policy for this run. The canonical API answers have a
  60-second fresh window plus 300 seconds for background refresh; page HTML has
  300 plus 300 seconds. Read back current answers after those windows. This is
  bounded refresh, not a global cache purge; the separate clearing-key work remains
  [issue 1979](https://github.com/alethical-org/alethical/issues/1979).
