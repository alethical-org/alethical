# FCC political files: archive before the reader feature

<!-- describes: alethical/pipeline/fcc_*.py, scripts/fcc_political_files.py, .github/workflows/fcc-political-files.yml -->

Net: Preserve and search the complete political-file folders of KSTP-TV, KARE and
KMSP-TV before building a public-facing feature.

## Authorization and owner

Eugene requested a proposal on 8 October 2026, then instructed: “lets
build/index/store/etc everything first bf building the front end feature for it?”
This authorizes collection, source storage, text and evidence extraction, internal
search, backup, and reviewable links to held campaign expense records through a
working deployed backend and initial collection. The frontend remains on hold.
The first collection is the 3 supplied stations; expansion beyond them awaits a
defined station list. No paid recurring AI job is authorized.

Owner: Codex chat (FCC media-vendor, 01a11a9b-d455-7d51-9baf-7d821afd0d6f),
branch `codex/fcc-political-file-archive`.
Source-listing corrections continue on `codex/fcc-source-listing-gaps`.

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
7. Keep the frontend held. Record the measured result and recoverable folder hold
   or native archive after acceptance.

## Shared impact and prevention

The risks are disappearing sources, duplicate/revised orders counted as spend,
OCR changing money, and links to finance rows disappearing on refresh. The archive,
search, commission analysis, expense matching and backup share those risks. Source
identity, immutable bodies, versioned drafts and retained match evidence address
them without changing existing campaign figures. Tests cover repeated collection,
changed files, invalid downloads, failed folders, reused order numbers, credits,
missing values and restoration. Remaining uncertainty: download availability at
scale, varied PDF layouts and station scope beyond the initial 3.

## Progress

- Proposal accepted for backend-first implementation; no frontend work started.
- Source client and PDF extraction are assigned to separate helpers; the owner
  integrates database, storage, commands and release, then personally reviews both.
- Initial proposal listed 4,507 files. This is a changing FCC listing count, not a
  verified count of unique invoices or proof of historical completeness.
- The private backend is released; production applies migration
  `0067_fcc_political_files` with all 7 FCC tables protected from public access.
  The initial 3-station collection, text reading and backup are running.
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
- A KSTP source invoice names its property as `KSTP_KSAX`. The archive station is
  the filing location, not proof that every billed spot aired on that station.
  Source text remains available for later review of grouped station buys.

## Operator commands and limits

The private command accepts `--target prod` explicitly. Its default, `dev`, only
accepts a database on the operator's machine. No public API or screen is added.
The manual GitHub workflow defaults to a dry run and has no recurring schedule.
No command calls an AI service. Local PDF text reading and image recognition use
Python, Poppler and Tesseract; unreadable or unsupported formats remain archived.

```bash
uv run python scripts/fcc_political_files.py collect --target prod --dry-run
uv run python scripts/fcc_political_files.py collect --target prod --workers 3
uv run python scripts/fcc_political_files.py mirror --target prod --limit 1000
uv run python scripts/fcc_political_files.py extract --target prod --limit 100 --workers 2
uv run python scripts/fcc_political_files.py status --target prod
uv run python scripts/fcc_political_files.py gaps --target prod
uv run python scripts/fcc_political_files.py search 'Strategic Media' --target prod --year 2026
uv run python scripts/fcc_political_files.py search --target prod --field order_number --value 510114
```

`collect --max-files N` prioritizes records never attempted, then changed or due
records, with older attempts first. A permanently failed file cannot trap every
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
- The backend release is live at commit
  `b982aa7a2e8abd6e794a37f235bd043960eeec63`. Initial station coverage, correction
  release, text reading, full backup and final independent acceptance remain pending.
