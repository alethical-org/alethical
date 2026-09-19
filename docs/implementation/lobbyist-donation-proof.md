# Lobbyist donation proof release report

User authorization: build the general missing-amount repair, independently review it,
coordinate other tasks, release safely, and report before/after supported amounts.

## Live result on September 19, 2026

[Pull request 2328](https://github.com/alethical-org/alethical/pull/2328) is live at
[the lobbyist directory](https://www.alethical.com/money/lobbying/lobbyists).
The source-bound evidence is active. Original payment rows, campaign source releases
and lobbying source releases remain unchanged.

| Calendar year | Supported annual amounts before | Newly supported | Newly withheld | Supported annual amounts after | Net gain |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2024 | 131 | 94 | 3 | 222 | 91 |
| 2025 | 136 | 88 | 4 | 220 | 84 |
| Total | 267 | 182 | 7 | 442 | 175 |

The 182 newly supported annual amounts belong to 141 distinct lobbyists. A person
with a newly supported amount in both years contributes 2 amounts and 1 person.
The comparison uses the same 1,665-person roster and the same source rows. The full
live amount map exactly matches the independently reviewed trial.

The 7 withheld amounts had previously passed a committee-wide comparison. New
individual-level evidence exposed missing payments or unresolved identities, so those
amounts are now unavailable. Missing records are never treated as zero.

- Ward Einess: 2024 now shows **$42,300.00**. His 2025 amount remains unavailable:
  Jim Nash's effective report records a $1,000 payment dated October 28, 2025 that is
  absent from the held contribution download.
- Joel Carlson: the supported 2024 amount is **$40,998.30**. The directory displays
  **$40,998** under the existing whole-dollar display rule. His 2025 amount remains unavailable:
  a held $500 payment carries filing year 2025 but payment date January 20, 2026.
  The official report confirms that date. The calculation does not silently move it
  into 2025.
- 4 already-supported 2025 amounts also increased through 5 uniquely matched held
  payments: Nichole Ramalingam $1,000 to $1,500; Justin Emmerich $250 to $500;
  Cap O'Rourke $1,525 to $1,775; Vic Moore $250 to $600. These are existing source
  rows whose missing registration numbers are established by official reports, not
  newly created payments.

## Evidence and source versions

- Code release: `676596c46b56ac65846c92a24fb7c203629dd079`.
- Active proof: `bf96b46f-eb1e-4a26-8de2-cd0b5a84cf07`.
- Audit SHA256: `bda6a2a9a58bb6cd1ec10b87a6db186445d46eb24d16bed602b65a9c82eda6e7`.
- Audit object: `campaign-finance/lobbyist-evidence/bda6a2a9a58bb6cd1ec10b87a6db186445d46eb24d16bed602b65a9c82eda6e7.json.gz`.
- Campaign release: `af236cca-a4f8-4efe-9a3a-025259ea380e`.
- Contribution snapshot: `5b892996-14ce-4992-87ed-b825400beb26`.
- Filing snapshot: `9cd121a0-4fd2-467e-b4a4-5c3c600febfb`.
- Lobbying release: `70f958f3-e559-4b1b-8cc0-1edd60422799`.
- Lobbyist snapshot: `32105d4f-8025-4e3a-943d-71aec83a48da`.

The review reproduced the exact audit from unchanged source rows and 436 retained
report PDFs. It contains 408 checked recipient-years and 10 refused recipient-years;
1,841 donor checks agree and 36 disagree. All 3,699 proof row identities are unique.
The 436 report PDFs and compressed audit are stored and read back from primary
storage. All 437 objects, totaling 19,329,486 compressed bytes, also have hash-checked
Cloudflare R2 copies. The existing backup job discovers the new audit table.

## Publication contract

Proof binds contribution and filing snapshots, effective report versions, coverage
periods, parser version and unchanged source-row identities. Complete known donor
payment sets must match by recipient, date, signed cash/in-kind amount and repeated
row count. Explicit official registration can establish a held row's missing number;
name alone cannot. Contradictory donor evidence overrides a committee-wide pass.
Directory sums and profile records consume the same active proof.

Failed refreshes retain previously known donor relationships as unresolved. A newer
filing snapshot invalidates positive proof and retains those known relationships.
Concurrent publication cannot replace new evidence with an older or narrower result.
An interrupted upload cannot activate partial evidence. The first activation had no
previous active proof; the source rows and releases remain available unchanged.

## Validation and coordination

- Current implementation-head checks: 3,097 backend tests and 3,476 frontend tests
  passed, with formatting, types, schema, security, document and production-build checks.
  The merge queue also passed against the combined main branch.
- Independent reviews covered parsing, full-period coverage, missing-number matching,
  negative evidence, publication races, source changes, original-row preservation and
  the exact proposed result. Findings were repaired before activation.
- Fresh isolated desktop, tablet and phone browser checks passed name search, custom
  year/sort menus, keyboard control, pagination, profile year selection, show-more and
  explanation panels. Slow requests retained dated old results; failed requests kept
  results and offered retry; late responses did not overwrite newer searches. No
  horizontal overflow or browser errors occurred.
- Ordinary unfiltered directory HTML returned the new proof and 220 supported 2025
  amounts at 19:31 UTC after the existing saved copies refreshed. Named searches,
  public API counts and example amounts also matched the reviewed result.
- The task (Money record trust) completed its source-count wording and payment-record
  refinements before this release. Its original-source notice remains intact.
- The task (legislator campaign money) confirmed no overlapping source refresh and
  kept the separate historical replacement on hold.

## Remaining work

[Issue 2329](https://github.com/alethical-org/alethical/issues/2329) records the
remaining missing payments, cross-year records, missing donor headings and a bounded
wrapped-description parser correction. Recommended next steps are a read-only
comparison with the newer official contribution download, an explicit cross-year
policy, then a newly reviewed proof run. Do not promise an amount for every name.

The historical full replacement remains held under
[issue 2142](https://github.com/alethical-org/alethical/issues/2142) and
[issue 2150](https://github.com/alethical-org/alethical/issues/2150). This release
neither activates that replacement nor rewrites published committee comparisons.

After activation, an older API response was briefly carried into a saved HTML copy.
The existing refresh windows remained unchanged.
[Issue 1979](https://github.com/alethical-org/alethical/issues/1979#issuecomment-5744704795)
now also records evidence activation and rollback as events that must clear both
saved API answers and HTML copies.

The collection and publication procedure is maintained in
[lobbyist-donor-evidence.md](../operations/lobbyist-donor-evidence.md).
