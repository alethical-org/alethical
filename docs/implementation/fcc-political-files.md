# FCC political files: archive before the reader feature

<!-- describes: alethical/pipeline/fcc_*.py, scripts/fcc_political_files.py, .github/workflows/fcc-political-files.yml, .github/scripts/fcc-refresh-report*.cjs -->

Net: Preserve and search the complete political-file folders of KSTP-TV, KARE and
KMSP-TV before building a public-facing feature.

## Authorization and owner

The scope approved on 8 October 2026 covers collection, source storage, text and evidence extraction, internal
search, backup, and reviewable links to held campaign expense records through a
working deployed backend and initial collection. Ongoing automatic collection is
also approved for KSTP-TV, KARE and KMSP-TV, across every available year and
political folder. The frontend remains on hold. Additional stations require a
separate scope decision. No paid recurring AI job is authorized.

Owner: Codex chat (FCC media-vendor, 01a11a9b-d455-7d51-9baf-7d821afd0d6f),
branch `codex/fcc-political-file-archive`.
Source-listing corrections shipped from `codex/fcc-source-listing-gaps`; final
collection acceptance is recorded from `codex/fcc-archive-acceptance`.
The recurring collection change uses `codex/fcc-recurring-archive`.
[Issue 2528](https://github.com/alethical-org/alethical/issues/2528) records the
release and production acceptance receipts separately from initial collection.

## Why this collection exists

The collection supports research into media-agency commissions and the invoices
behind reported campaign expenses. The starting example was KSTP's 2026 State folder for Lisa
DeMuth. A reported manual collection contained 41 PDFs; those local copies were not
provided for comparison, so 41 is context, not an acceptance target. Collection
covers every candidate and political folder of the configured stations.

The supplied KARE and KMSP addresses establish the other 2 stations. Coverage
remains limited to these 3 stations. Adding stations requires a reviewed
source-list change;
`--stations all` means these 3 stations, not every US television station.

## Source addresses and identities

| Filing station | FCC facility ID | Political-file starting address |
| --- | --- | --- |
| KSTP-TV | 28010 | <https://publicfiles.fcc.gov/tv-profile/kstp-tv/political-files> |
| KARE | 23079 | <https://publicfiles.fcc.gov/tv-profile/kare/political-files> |
| KMSP-TV | 68883 | <https://publicfiles.fcc.gov/tv-profile/kmsp-tv/political-files> |

The running collector reads the public station web listings and follows their
folder links. It does not currently use the developer change-list API to decide
which folders changed. The [FCC developer reference](https://publicfiles.fcc.gov/developer)
is background for a possible future change, not a dependency of the current run.

Folder addresses follow the station's political path and end in the FCC folder ID.
Download links are taken from the listing, normally
`https://publicfiles.fcc.gov/api/manager/download/<folder-id>/<download-id>.pdf`.
The public distribution address is
`https://files.fcc.gov/download/<download-id>.pdf`. The collector tries that known
public route only for eligible PDF links after an API refusal with status 403 or
a timeout. It does not invent a download for a row with no link or bypass a login.
A file row's own FCC ID can differ from its download ID; preserve both identities.
The saved listing, original address and successful download address retain that
chain of evidence. Remove tracking parameters when recording starting addresses.

## Source evidence and approved handling

- The [FCC developer reference](https://publicfiles.fcc.gov/developer) describes
  folder, file and change-list APIs. Rendered station listings also expose complete
  folder links and document links. A listing is evidence, including an empty one.
- [FCC retention guidance](https://publicfiles.fcc.gov/about) requires political
  files for 2 years. Available older years are collected, but cannot be claimed as
  complete history. Missing records are not zero spending.
- [FCC payment guidance](https://publicfiles.fcc.gov/faq) does not require payment
  checks. Ordered, invoiced, credited and payment-supported amounts stay separate.
- Collect all political subfolders, including local, noncandidate and terms files;
  the state/federal invoice view is a later classification, not a download filter.
- Retain every distinct source version and each source listing. Identical bytes
  may share storage but distinct source identities and observations survive.
- Reuse private Supabase Storage and the Cloudflare R2 mirror, following
  [campaign-finance-system-design.md §4.5 (where downloads live)](../architecture/campaign-finance-system-design.md#45-where-the-downloaded-files-live-and-for-how-long).
- Text and extracted fields are versioned by source hash and extractor version.
  Every draft fact has a page and quotation. OCR failures and absent fields remain
  explicit. No inferred 15%, invented zero, automatic payment claim or agency-profit
  calculation. Draft extraction is not a published financial total.
- Internal text/field search precedes a reader screen. Candidate matching is
  separate from accepted identity and transaction links. Retain finance snapshot
  hash, row and copied evidence so refresh cannot silently change an accepted link.

## Delivery sequence and acceptance

1. Prove ordinary public downloads; build bounded listing/download client and
   offline tests. Record inaccessible files rather than bypassing access controls.
2. Add independent FCC tables and a reversible migration; preserve originals and
   listings before registering evidence. Exercise upgrade/downgrade/upgrade.
3. Add restartable collection, page text/OCR, conservative fact extraction and
   internal search/export/review commands. Repeat runs must not duplicate totals.
4. Test a varied sample and complete all folders of the 3 stations, accounting for
   listed, stored, unreadable, unavailable and failed items separately.
5. Copy FCC objects to R2 and restore a sample; validate source hashes and search.
6. Independent review, current required checks, merge queue, deployment, initial
   production collection and read-back. Preserve any source-access limits honestly.
7. Add the approved daily source refresh, with bounded downloads, backup, local
   text reading and honest reporting of source gaps and unfinished work. Accept
   it only after a production run proves those stages and the saved schedule.
8. Keep the frontend held. Record the measured result and recoverable folder hold
   or native archive after acceptance.

## Shared impact and prevention

The risks are disappearing sources, duplicate/revised orders counted as spend,
OCR changing money, and links to finance rows disappearing on refresh. The archive,
search, commission analysis, expense matching and backup share those risks. Source
identity, immutable bodies, versioned drafts and retained match evidence address
them without changing existing campaign figures. Tests cover repeated collection,
changed files, invalid downloads, failed folders, reused order numbers, credits,
missing values and restoration. The first full collection accounts for every listed file identity across the
saved folder tree. At initial acceptance, remaining limits were 9 unavailable
downloads, 1 unreadable nonblank page and unreviewed draft fields. Coverage beyond
the 3 stations is out of scope.

The original source collector required an operator to start each collection. Daily source discovery removes that dependency. Reusing
recent unchanged files avoids downloading the archive from private storage merely
to observe unchanged listing details. Reserving half the download budget for the
oldest attempts prevents newly added files from indefinitely delaying older
source comparisons; the remaining capacity favors new or changed records. Spare
capacity passes between those groups.

This change affects FCC collection, private source storage, backup and current
text readings. Existing manual `collect`, financial interpretation, expense-link
review and the public frontend hold retain their existing behavior. Focused
checks must cover complete folder discovery with bounded downloads, fair retries,
unchanged metadata observations, changed contents under unchanged names, source
refusals versus operational failures, retained work after failures, backlog
reporting and repeated runs. Independent acceptance must examine those shared
uses and the first production refresh. FCC availability, GitHub scheduling delays
and arrivals beyond the daily budget remain external limits; the run summary and
1 continuing problem issue expose them without claiming complete coverage.
The owner named above carries implementation, live acceptance and documentation
through completion within the approved 3-station scope.

## Progress

- Proposal accepted for backend-first implementation; no frontend work started.
- Independent source, text-reading and acceptance reviews informed the build;
  the owner reviewed source PDFs and exercised the production archive personally.
- Initial proposal listed 4,507 files. This is a changing FCC listing count, not a
  verified count of unique invoices or proof of historical completeness.
- The private backend is released; production applies migration
  `0067_fcc_political_files` with all 7 FCC tables protected from public access.
  Collection and current text reading are complete for accessible files; source
  gaps remain explicit. Backup acceptance has its own completion check.
- Actual listings exposed 2 source shapes: a file row without a download link,
  and a state folder linking to a local folder. The reader retains unavailable
  file metadata without inventing a link, and follows links only within the same
  station's political tree with an exact path match. The actual source category
  survives. A missing download cannot hide its downloadable neighboring records.
  Focused tests cover retained gaps, sibling downloads, later link recovery,
  cross-category links and cycles. A missing FCC link remains a source limit.
- Initial parallel text reading exposed database records expiring after each
  saved result. Workers now receive copied file details; only the coordinating
  thread reads or writes database records. Tests force a save before later workers
  start and cover both successful reads and failures.
- Reader version `fcc-document-text-v2` prefers Poppler's usable page text, which
  retains filled values omitted by the first reader on a completed PB-19 form.
  Disclosure headings take priority over referenced orders, and identifier fields
  require a digit. The old readings remain available as history; progress counts
  and search use the current version. A 6-PDF comparison preserves the previously
  correct financial fields and removes a false contract number of `Station`.
- A wider production sample found the adjacent heading `Original Date / Revision`
  stored as an advertiser on 83 documents. Version `fcc-document-text-v3` rejects
  observed form headings in all name, address and identifier fields, while keeping
  real names with slashes. It leaves ambiguous names unknown instead of guessing
  from neighboring rows. Earlier readings remain retained; current readings are
  rebuilt from the original stored bytes and stay drafts requiring review.
- KMSP sampling exposed a long advertiser joined to the next `Invoice Date`
  heading by only 1 space. Version `fcc-document-text-v4` rejects embedded compound
  headings across text fields, preserving ordinary company words and slash names.
  It also opens PDFs using the empty password when they require no opening
  password; genuinely protected files remain unreadable. Checks cover both cases,
  and 15 source PDFs retain their supported financial and identity facts.
- A KSTP source invoice names its property as `KSTP_KSAX`. The archive station is
  the filing location, not proof that every billed spot aired on that station.
  Source text remains available for later review of grouped station buys.

## Where each part lives

| Saved information | Home | What it preserves |
| --- | --- | --- |
| Original public response bytes | Private Supabase bucket `raw-source-files`; second copy in the configured Cloudflare R2 bucket | PDFs and folder listings, compressed under `fcc/political-files/<sha256>.gz` |
| Source-file details | `fcc_source_body` | Original/compressed sizes and fingerprints, storage key and last successful second-copy proof |
| Collection attempts | `fcc_scan`, `fcc_observation` | Run status, folder/file identities, timestamps, source paths and failures |
| Station file versions | `fcc_document` | Separate FCC records even when their contents are identical; changed versions remain retained |
| Readings and page text | `fcc_extraction`, `fcc_page` | Reader version, draft facts, page quotations, text and incomplete-reading reasons |
| Reviewed expense connections | `fcc_expense_link` | Review status plus the expense's saved version, row and copied evidence |

These 7 tables are private. The migration is `0067_fcc_political_files`.
The [FCC command](../../scripts/fcc_political_files.py) is the entry point;
[source collection](../../alethical/pipeline/fcc_public_files.py),
[archive and search](../../alethical/pipeline/fcc_archive.py),
[PDF reading](../../alethical/pipeline/fcc_document_text.py), and
[expense connections](../../alethical/pipeline/fcc_expense_links.py) own their
respective behavior. Search reads current-version saved text and draft fields in
PostgreSQL. It uses no embeddings, vector service or paid AI call.

## Setup and a repeat collection

Use the repository's locked Python dependencies (`uv sync --frozen`) and the
schema containing migration `0067_fcc_political_files`. PDF reading also needs
Poppler (`pdftotext`, `pdftoppm`) and Tesseract. The GitHub workflow installs those
programs; a local operator must install them before extraction. Source download
and storage do not require OCR software.

The command loads an existing private `.env` from the working directory or its
parents. Production needs the configured Supabase database connection, the 4
`SUPABASE_STORAGE_S3_*` settings, and the Cloudflare mirror settings
`CLOUDFLARE_R2_ENDPOINT`, `CLOUDFLARE_R2_BUCKET`,
`CLOUDFLARE_R2_ACCESS_KEY_ID`, and `CLOUDFLARE_R2_SECRET_ACCESS_KEY`.
The [FCC workflow](../../.github/workflows/fcc-political-files.yml) lists
its exact repository-secret names. Store values privately; never put passwords,
connection strings or signed private download links in GitHub notes.

1. Run `status` and `gaps` to record the starting coverage. Coordinate with any
   active FCC collector before another writer starts. The GitHub workflow queues
   its own runs, but that does not lock an independently started local command.
2. Run `collect --target prod --dry-run` to print the intended scope. This checks
   arguments without contacting the FCC, database or storage. It is not an access
   test. Local collection writes unless `--dry-run` is explicitly supplied.
3. Run collection with a stated station set and file limit, or omit `--max-files`
   for the full configured collection. Retain the output and scan ID. Each run
   traverses the folders; the file limit bounds attempted documents, not listing
   requests. Keep failed and limited run evidence rather than hiding the failure.
4. Run `mirror` in bounded batches until `status` reports
   `bodies_without_second_copy: 0`. A successful batch alone is not proof that all
   saved files have their second copy.
5. Run `extract` in bounded batches until `gaps` reports `unread_documents: 0`.
   Review `reading_gaps` separately. Zero unattempted files does not mean every
   page was readable or every extracted fact was approved.
6. Repeat source-linked searches and export a varied sample to confirm originals
   can be recovered. Record the date, station/year counts, source failures,
   incomplete readings, reader version, remaining backup count and sample results.
   Keep the figures in this file labelled as the dated initial collection.

`gaps` shows source failures from the **latest scan**, with separate current-reader
gaps across the archive. Its lists are capped by `--limit` (maximum 1,000).
Earlier scan observations remain stored; one limited latest run is not a full
archive audit. `pending_review` means a reading exists, not that a person approved
its money figures.

## Ongoing collection and reporting

The approved [GitHub FCC workflow](https://github.com/alethical-org/alethical/actions/workflows/fcc-political-files.yml)
schedule is daily at 06:23 UTC. Scheduled runs write automatically; a manually
started run defaults to `dry_run: true`. Release acceptance requires a production
refresh using the scheduled limits, a saved schedule read-back, and checks of
remaining source, reading and backup gaps. [Issue 2528](https://github.com/alethical-org/alethical/issues/2528)
records initial and recurring acceptance separately; the initial figures below
are not a recurring-run receipt.
Manual runs may select 1–2,000 file attempts, 1–2,000 readings and 1–5,000 second
copies; their defaults match the scheduled limits.

Each `refresh` run follows every available political folder of KSTP-TV, KARE and
KMSP-TV, across all years. The initial tree had 594 distinct listings; discovery
is not limited to the current year, selected candidates or invoice classifications.
It retains folder evidence, then attempts up to 1,000 new, changed or due file
downloads with 3 workers. A file is due after 7 days without a source download,
even when its listed name and date have not changed. Half the capacity is
reserved for the oldest attempts and the rest favors new or changed records,
with unused capacity shared. This is a rolling source comparison, not a promise
that every file is re-downloaded within 7 days while a backlog exists.

A recent unchanged file receives a metadata observation without reading its body
again from private storage. That observation is not a fresh byte-integrity check.
The separate daily [source-file backup workflow](../../.github/workflows/mirror-raw-files.yml)
at 13:00 UTC checks stored copies and renews old fingerprint proofs within its
own read budget. Source comparison and storage-integrity checks answer different
questions and keep separate evidence.

After collection, `refresh` attempts up to 2,500 outstanding second copies and
reads up to 1,000 unread files with local PDF and OCR tools. Backup covers both
files and listings. Retained work proceeds through backup and reading even when
collection reports an operational failure. Remaining download, backup and unread
backlogs stay visible and make the run unhealthy; a successful bounded batch does
not establish that the archive has caught up. Unsupported or unreadable pages
remain separate reading gaps, with their originals and prior evidence retained.
Every incomplete current reading contributes to the summary and keeps the problem
issue open, even after its first reading attempt. Local reader-process failures,
invalid reader output and missing OCR tools also fail job health. These exact
operational failures receive up to 3 automatic retries per body and reader version,
after never-read files. Attempts remain in history; expense-linked readings are
protected. Durable source and document limits are not retried automatically; an
operator can inspect the source and use `extract --retry-failed` when justified.

A listed file without a download link, or a final file download refusal with
HTTP 401, 403, 404 or 410, is a source gap. It keeps source coverage incomplete,
is retained in observations, and is retried on a future run. Folder failures,
transient request errors, database errors and storage failures are operational
failures, not routine source gaps. A healthy collection process can therefore
still have incomplete source coverage. Neither status means the missing records
represent zero spending.

The workflow keeps its sanitized completion report for 14 days and publishes a
summary of counts with a link to its run. A separate reporting job also records
collector setup failures and timeouts when no completion report exists. It opens or
updates 1 continuing GitHub problem issue for source gaps, operational failures
or backlog, rather than adding daily comments. Incomplete readings keep the same
issue open. It closes only when these gaps and failures are absent and the bounded
work has caught up. An unchanged known FCC refusal must not hide a new folder or backup failure.
Private document contents and credentials stay out of workflow summaries and
issue text.

The daily source budget is approximately the number of current folder listings
plus at most 1,000 selected file attempts, with the client's bounded retries and
public-download fallback. The initial compressed archive occupied 861,236,041
bytes per complete copy. Repeated identical contents share stored bodies; new
versions grow the archive. FCC reads and local text extraction use no paid AI.
GitHub runner time, database access, private storage operations and transfers use
existing account allowances; this is not a claim that hosting usage is unlimited
or free at every volume.

[GitHub scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
can be delayed or dropped during heavy load. Treat 06:23 UTC as the requested time,
not a guaranteed delivery time; inspect the last finished run when freshness matters.
GitHub queues scheduled and manual FCC workflow runs together. An independently
started local command is outside that queue: coordinate with an active collector
before starting it. A manual dry run checks scope and limits without source,
database or storage requests. To pause collection, disable the FCC workflow in
GitHub Actions. Re-enable it and run a bounded refresh to resume from saved
observations and outstanding work. Stopping the schedule does not delete source
versions, page text or review history, and does not stop the separate backup job.

## Operator commands and limits

The private command accepts `--target prod` explicitly. Its default, `dev`, only
accepts a database on the operator's machine. No public API or screen is added.
The manual GitHub trigger defaults to a dry run; scheduled refreshes write within
the fixed 3-station scope and the bounds described above.
No command calls an AI service. Local PDF text reading and image recognition use
Python, Poppler and Tesseract; unreadable or unsupported formats remain archived.

```bash
uv run python scripts/fcc_political_files.py refresh --target prod --dry-run
uv run python scripts/fcc_political_files.py refresh --target prod --max-files 1000 --extract-limit 1000 --mirror-limit 2500 --workers 3 --summary /tmp/fcc-refresh-summary.json
uv run python scripts/fcc_political_files.py collect --target prod --dry-run
uv run python scripts/fcc_political_files.py collect --target prod --workers 3
uv run python scripts/fcc_political_files.py mirror --target prod --limit 1000
uv run python scripts/fcc_political_files.py extract --target prod --limit 100 --workers 2
uv run python scripts/fcc_political_files.py status --target prod
uv run python scripts/fcc_political_files.py gaps --target prod
uv run python scripts/fcc_political_files.py search 'Strategic Media' --target prod --year 2026
uv run python scripts/fcc_political_files.py search --target prod --field order_number --value 510114
```

`refresh` runs discovery, bounded source downloads, backup, local text reading and
health reporting together. Its scope is fixed to the 3 stations above. The
`--summary` output contains run counts and health results, not private source text.
The separate commands remain available for targeted recovery.

`collect --max-files N` retains its manual behavior: it prioritizes records never
attempted, then changed or due records, with older attempts first. A permanently failed file cannot trap every
bounded run. Partial runs report `limited` or `incomplete`; only a full traversal
with every listed file retained or checked reports `complete`. The observation
ledger retains failed folder paths and source download reasons. The recorded
scope is the available folders at collection time, not historical completeness.
Unchanged files are read back from storage for up to 7 days; older files are
downloaded again even if their source names and dates did not change. Use
`--refresh-existing` for a full source comparison sooner.
Files listed without a public download link count as `files_unavailable`; their
name, source record ID, listing address, size and upload label remain in the
observation record and `gaps` output. They make the scan `incomplete` even when
every available download succeeds. They are never counted as stored documents.

`extract --retry-failed` retries incomplete readings while preserving their earlier
pages, facts and failure reasons. Readings already used in an expense link cannot
be overwritten. A new extractor version creates new readings and can have separate
expense links. Search returns each retained source version with its observed dates,
page text, draft fields and FCC address. It does not claim every version is still
listed by the FCC. An exact field/value filter applies to the document's draft
facts; each fact carries its own page and quotation.

`export HASH DESTINATION` restores and checks the original public response bytes
before writing a new private local file. Existing files are never overwritten.
The FCC may convert an upload before serving it: these bytes are the publicly
served copy, not a promise of the uploader's original file. Source sizes are
descriptive metadata; fingerprints are calculated from the bytes actually served.

`suggest-links HASH` finds possible matches in the current published Minnesota
expense records. It saves nothing and requires a quoted name plus an amount or
date clue. `link-expense HASH --dataset expenditures --snapshot UUID --row N
--evidence 'reason'` retains a suggestion and copies its original expense evidence.
`review-link UUID --status accepted --reviewer NAME --evidence 'reason'` records
an explicit review. `links` shows those saved links and flags changed finance
sources. Multiple invoices may link to a filed expense and the reverse; no amount
is allocated or added to a total. Federal invoices remain searchable even where
Alethical holds no matching federal expense source.

The existing source-file backup job discovers the FCC body table automatically.
`mirror` also supports an immediate second copy and full read-back, including
decompression and the original fingerprint. Database backups retain the catalogue,
page text and review history; the private file stores retain the response bytes.

## Acceptance evidence

- Initial private-storage proof retained the 154,632-byte DeMuth invoice and the
  58,309-byte order in Supabase and Cloudflare R2. Restoring both from each store
  reproduced their original fingerprints. These are source copies, not financial
  totals or a claim that the campaign paid them.
- Review identified bounded-run starvation, retries losing prior reading evidence,
  mixed scanned/native pages and matching across extractor versions. The build
  adds focused checks for each before the initial production collection.
- The correction release is live at
  [commit 2c044fd266103521ba080a2365d4ca797972e3a3](https://github.com/alethical-org/alethical/commit/2c044fd266103521ba080a2365d4ca797972e3a3).
  At that release acceptance, the production version endpoint returned that commit,
  health reported `ok`, and readiness reported `ready`. The exact merge-group backend checks passed; the
  frontend suite was skipped by its path filter.

## Initial collection: 8 October 2026

The combined saved folder tree contains 594 distinct listings and accounts for
4,507 file identities. Independent review restored and parsed each latest successful
listing, followed its child links, and compared its file identities with the saved
observations. This covers the available 3-station political trees, including local,
noncandidate and terms records. It is not a count of invoices or all historical buys.

| Filing station | Stored file records | Years with stored files |
| --- | ---: | --- |
| KSTP-TV | 2,163 | 2022–2026 |
| KARE | 1,220 | 2022–2026 |
| KMSP-TV | 1,115 | 2024–2026 |
| Total | 4,498 | Available files only |

Those records contain 4,485 distinct byte sequences. Duplicate contents share one
stored body while preserving each FCC identity. The 9 remaining listed identities
are 5 rows without public download links and 4 downloads refused by the FCC.
Their names, source IDs and failure evidence remain searchable through `gaps`.
The 4 refused files returned HTTP 401 from the FCC's official download host after
the public API refused them; a normal browser click reproduced that refusal for
1 sampled file. No login or access bypass was attempted.

Both collection scans retain `incomplete` status. The recovery scan also recorded
1 folder timeout for KARE's 2024 Minnesota Citizens Concerned for Life folder.
A later ordinary public request succeeded; all 6 file IDs, names, download links
and upload labels matched the earlier saved listing. All 6 saved files restored
with matching fingerprints. That later evidence closes the folder-coverage gap
without rewriting the scan's original failure record.

Current reader `fcc-document-text-v4` has attempted all 4,485 distinct files:
4,482 readings await review and 3 remain partial. Of 20,964 pages, 20,961 have
saved text. The remaining pages are:

- KARE, `FCC SNL Nikki Haley Political Appearance 2-3-24`, page 2: blank.
- KARE, `FCC SNL Kamala Harris Political Appearance 11-2-24`, page 2: blank.
- KSTP-TV, `K5-North Star Dawn PAC-NAB-509696`, page 4: a noisy scan of printed
  terms, signatures and handwritten fields. Automatic reading produced no reliable
  text; alternate page-layout settings produced scrambled text. The original page
  remains available for visual review and is not presented as fully indexed.

The current draft classification is 1,151 invoices, 1,126 orders, 359 disclosures
and 1,849 unknown records. There are 2,057 earlier readings retained as history.
The reader found explicit commission rates in 1,084 distinct files and commission
amounts in 1,148. These are field-coverage counts, not verified commission totals.
No payment amount or credit amount was asserted by this extraction pass.

Searches for `Strategic Media` in 2026 and order `510114` return source-linked
pages and draft facts. The DeMuth expense-match sample returned no supported
pairing and reported its search bound; the system did not force a match. Matching
is a reviewable evidence link, not automatic proof of a campaign payment.

The archive holds 5,655 distinct file and listing bodies: 1,070,172,893 original
bytes, stored as 861,236,041 compressed bytes in each complete copy. Each backup
write is read back and checked against both the compressed and original file
fingerprints before being marked complete. The completion record on
[issue 2528](https://github.com/alethical-org/alethical/issues/2528) carries the
final backup count, restoration receipt and independent acceptance. A collection
scan's `incomplete` source status is separate from whether its saved files have
finished copying.


## Recovery and the initial catalogue copy

Source-file backup and database backup protect different things. Restoring a PDF
does not restore its page text, review history or expense connections. Follow
[recovery.md](../operations/recovery.md) for bounded source-copy audits and a safe,
isolated database restoration. A stored `mirrored_at` timestamp is past proof,
not a fresh check that an object still exists.

On 8 October 2026, a one-time consistent, read-only catalogue export retained
56,926 rows across the 7 FCC tables, including older readings. The compressed
export is 33,026,367 bytes; its SHA-256 is
`e90cb1db62b1651c4fd3453c9a70c4979dff815d3373fe1d7581c92c11b25a22`.
Both private stores hold the manifest at:

```text
fcc-catalog-snapshots/manifests/ca52f13feac4cd40f59f00d4dd1864b9927542da73c78640b9a2eaeffb220483.json
```

The manifest identifies 8 ordered pieces under `fcc-catalog-snapshots/chunks/`.
Reassembly from each store reproduced the compressed and expanded fingerprints,
and all 56,926 rows parsed. An independent restore repeated that check from R2.
This proves that saved catalogue copy can be read; it is not a completed database
rebuild or full disaster-recovery drill. It is not an automatically refreshed
catalogue export, and the FCC command does not include a catalogue-import command.

Private scripts, restoration receipts and the manifest are retained on the
operator's Mac under `/Users/eug/.local/state/alethical-fcc/2026-10-08/` with
owner-only access. GitHub records the nonsecret storage key and results so the
cloud copy does not depend on a temporary coding folder. Use a disposable,
isolated database for any future import and follow the recovery checks before
considering a production change.

## Financial interpretation and work still outside this release

- Order amount means booked airtime. Invoice amount means billed airtime. A
  cancellation, changed order, credit or replacement can alter what is owed.
  Never add all versions as separate spending.
- Keep the source's gross amount, commission rate, commission amount and net
  amount separate. Do not fill missing commissions with 15%, or call commission
  an agency's profit. Strategic Media Services in Virginia is a research lead,
  not a blanket identity match for every similar agency name.
- A final invoice supports a billed amount. A reviewed connection can relate it
  to a reported campaign expense, but neither record alone proves payment. Retain
  any reported unpaid amount and require separate payment evidence before calling
  it paid. The initial collection has no accepted expense connections.
- Candidate, committee and agency names are separate identities. One campaign
  expense can cover several station invoices; one invoice may need more than one
  expense connection. The current tools retain reviewed connections but do not
  allocate amounts or calculate a reconciled spend total.
- Additional stations, federal expense sources not already held, a comparison
  with the reported collection of 41 local PDFs, complete human review of money
  fields and the public frontend remain outside this release. Ongoing collection
  is authorized only for KSTP-TV, KARE and KMSP-TV.
