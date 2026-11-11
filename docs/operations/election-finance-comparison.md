# Election comparison sources and release

This is the operating contract for the election comparison in Finance. The
[implementation plan](../implementation/election-finance-comparison.md) records
delivery status. These commands do not authorize a refresh or establish that a
particular set of files is complete. Start with the
[source refresh guide](production-ingestion-refresh.md), verify the current
owner and deployed migration, and retain receipts in private task storage.

## Separate records, explicit relationships

- An election key includes date and stage. A race includes the source office and
  jurisdiction. A candidate identifier is scoped to that race; names alone are
  never an identity key.
- Results retain original source bytes, race totals and precinct records in one
  generation. Candidate and write-in rows keep the source's meaning. The highest
  vote count is not proof of a certified winner. Expected canvassing authority and
  a scheduled meeting are not certification evidence.
- Financial collections retain report catalogues, effective amendments, actual
  reporting dates, original PDFs and figure evidence. They have their own release
  pointer and do not replace the global campaign-finance publication.
- A confirmed account relationship requires an explicit review of retained ballot,
  registration and report-cover evidence for an exact candidacy and dated scope.
  Proposals are not confirmations. A changed source identity fails closed until
  reviewed. Withdrawal and replacement append a decision; they never erase history.
- Cash, in-kind amounts and unpaid spending retain their source categories. Unpaid
  spending included in a reported total is not added again. Contributions received,
  campaign expenditures and outside support/opposition are separate measures.
- A reporting calendar year is not a complete election cycle. Preserve every
  figure's actual period. A later filing or amendment can replace a displayed
  report, but earlier versions remain retained and addressable.

## Prepare and stage results

`scripts/election_comparison.py prepare` reads an already retained source folder
and hash manifest. It downloads nothing and writes a new receipt. The receipt path
must not exist. Use `--include-local` for the full Minnesota main-and-local corpus;
without it, only the main result files are in scope.

```sh
uv run python scripts/election_comparison.py prepare \
  --directory "$result_sources" --manifest "$result_manifest" \
  --election-id 201 --election-date 2026-11-03 --stage general \
  --include-local --output "$new_result_receipt"
```

The source election ID and date above identify the initial 2026 general-election
scope, not a default for future imports. Validate the manifest and source status
for each run. Inspect excluded question/response rows, source reconciliation,
unknown authority and precinct-voter discrepancies before accepting the output.
Within-feed reconciliation does not establish independent canvass validation.

Replace `prepare` with `stage` and add `--target production --execute` only for an
authorized release. Staging retains and reads back source bytes before committing
the complete generation. It does not make a generation visible to readers.

## Prepare and stage report collections

`scripts/stage_election_finance.py prepare` rebuilds a collection from the retained
catalogues, directory and PDF bodies. It checks money against the documents, rather
than trusting an edited derived JSON file. The roster folder must contain
`source-manifest.json` and `cand.txt`, plus the retained local roster for full local
coverage. Unlike the results command, it does not accept a separate roster-manifest
filename. This financial importer currently supports the 2026 general election
and source election ID 201; the result command's other stage options do not imply
financial support for those elections.

Use a new output path for each full collection JSON. `--output` writes that JSON
before execution, can overwrite an existing file, and is not a success receipt.
Capture standard output separately; only the post-commit receipt's `executed: true`
establishes successful staging.

```sh
uv run python scripts/stage_election_finance.py prepare \
  --directory "$finance_sources" --roster-directory "$result_sources" \
  --directory-file "$candidate_directory" \
  --directory-metadata "$candidate_directory_metadata" \
  --output "$new_collection_json"
```

Replace `prepare` with `stage` and add `--target production --execute` to retain
and stage the checked collection. Originals may remain retained after a later
staging failure; retry from the same verified files. Do not remove retained
objects to force a retry. Check the resulting collection fingerprint and counts.

Account review requests are separate private JSON files, passed to
`scripts/review_election_account.py --request PATH`. The default validates request
shape offline; it does **not** validate retained evidence. `--target production
--execute` validates evidence, locks the account, checks the expected predecessor
and commits the append-only decision. A repeated request returns its original
decision and whether a newer decision has superseded it. It never reactivates an
old confirmation. Keep reviewer identity and private reasoning out of public copy.

## Publish and restore

Record both current pointers before publishing. Compare-and-swap publication
refuses if another writer changed a pointer since it was inspected. The previous
generations remain available for restoration and historical evidence links.

```sh
uv run python scripts/election_comparison.py publish \
  --snapshot-id "$result_snapshot" --expected-previous "$previous_result" \
  --target production --execute

uv run python scripts/stage_election_finance.py publish \
  --collection "$finance_collection" --expected-current "$previous_collection" \
  --target production --execute
```

For first publication, results use the literal `none` for `--expected-previous`;
finance uses `--expect-empty` instead of `--expected-current`. An older snapshot or
collection requires `--restore`, with the *current* pointer supplied as the
expected value and the retained prior generation supplied as the destination.
Do not guess a current pointer or remove history to make a comparison pass.
For a first publication, there is no prior result to restore; prepare a scoped
pointer-removal transaction and its saved read-back before release if withdrawal
is needed. Removing a current pointer does not erase the first-publication marker
or previously published source access.

## Acceptance before calling the comparison complete

1. Reconcile expected and held races, candidacies, precincts, authorities and filing
   periods. Explain gaps individually where a source can be recovered. A failed
   request or conservative matcher is not proof that no filing exists.
2. Trace a real race from displayed figures to retained source rows and PDF pages.
   Check exact candidacy, office, jurisdiction, stage, dates and account decisions.
3. Account for every outside-spending source row once, including unknown targets,
   missing amounts/dates and legitimate duplicate-looking rows. Keep party units
   separate from political committees/funds and candidate campaign spending.
4. Verify authenticated source access, historical versions, sign-out boundaries,
   independent result/report/outside-source failures, retry and changed-version
   handling. No figure becomes zero because its source is missing or unavailable.
5. Review the rendered comparison and current-head checks, publish only the
   accepted generations, and inspect the live reader journey. Imported counts or
   passing tests alone do not prove complete coverage.

The initial scope has uncollected federal and local campaign reports. Their filing
authorities must remain visible. A Board outside-spending record about a local
candidate does not make the Board the authority for that candidate's own campaign.
The comparison supports descriptive spending/outcome findings. Claims about
spending changing an outcome require a separate method and evidence.
