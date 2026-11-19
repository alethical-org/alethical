# National FCC political files in Finance

<!-- describes: scripts/national_fcc_objects.py, scripts/national_fcc_collect.py, .github/workflows/national-fcc-pdf-census.yml, scripts/national_fcc_db.py, alethical/api/services/finance_national_files.py, alethical/api/services/finance_national_search.py, scripts/national_fcc_search.py, apps/finance/src/pages/media/NationalFile.tsx -->

Finance members search every indexed filing on **Media buys** and open each verified
original. The 3 Minnesota stations keep their existing folders, checks and connections. National files
do not establish payments or add to spending totals. Private researchers can restore the
national index, including entries without an original. The [Finance architecture](../architecture/alethical-finance-architecture.md#6-media-buys)
owns member access and coverage. No ongoing national collection runs as part of this import.

## Import a supplied archive

1. Retain the transfer unchanged. Compare every non-Finder file with the Drive manifest by
   size and digest. Drive can deliver the largest SQLite file separately from its ZIPs.
   On a private copy, place the supplied SQLite transaction journal alongside the matching
   database and open normally so SQLite can roll back an incomplete transaction. Require a
   passing SQLite integrity check. Never import uncommitted pages from the original.
2. Run `python -m scripts.national_fcc_objects stage --help` for the snapshot ID, private
   working directory, recovered index, download and OCR logs, and transfer ZIPs. Staging
   reads nested document archives, reconciles each FCC identity with the download log and
   parses each eligible PDF. An incomplete file or a failed download stays in research
   materials. Several distinct FCC filings can share the same original bytes.
3. Check the destination bucket has public access disabled. Review the actual upload size
   and approved budget. The upload command writes absent content-addressed objects, verifies
   stored objects and issues a local receipt only when every required object passes. Preserve
   the source manifest, supporting data and compressed SQLite index privately.
4. After the database migration, validate and stage the receipt with
   `python -m scripts.national_fcc_db --target production stage --receipt RECEIPT --catalog DOWNLOAD_LOG --index RECOVERED_INDEX`.
   This registers member metadata in batches. Stage leaves the active version alone.
   Use the same inputs to resume. A conflicting snapshot under the same ID is refused.
5. [Provision and verify the member read grant](national-fcc-member-access.md). Check
   membership, object access, representative PDFs and text. Activate with
   `python -m scripts.national_fcc_db --target production activate --snapshot NEW --from-snapshot CURRENT`
   (use `none` for the first release). Check live discovery, page 2, file identity,
   the source hash, text availability and refusal of anonymous access.
6. To withdraw a release, use the same activation command with the prior IDs reversed.
   Members then see the preceding release, or an empty national list on first-release
   withdrawal. Private original bytes and research evidence remain available for recovery.

## Check every indexed filing for its PDF

`scripts/national_fcc_collect.py` checks each indexed filing that has no held original.
`worklist` stores the full index as the first part of a private work list in R2, marking
filings already held in the archive release or the Minnesota collection; those are not
downloaded again. The run's `manifest.json` lists every part in order with its SHA-256,
and each command refuses a part whose bytes do not match. The manifest's top-level
digest keeps describing the first part, `worklist.jsonl.gz`.

`sync --inventory-current` reads the compact national inventory
(`fcc-national/v1/inventory/current.json`, its manifest and its data, digest-checked)
and appends 1 part, `worklist-<n>.jsonl.gz`, holding every inventory filing that no
part holds yet, in a fixed shuffle. Filings already listed keep their part, position
and outcomes. When the inventory gives a listed filing that is still to be checked a
different download id, the part records the newer id and the next attempt uses it.
Added filings carry no held marks: archive-held filings are all in the first part, and
an added filing from the 3 Minnesota stations is checked like any other. Without an
inventory pointer the command does nothing, and an inventory it has already read adds
nothing.

The **Check national FCC filing PDFs** workflow runs every 30 minutes on GitHub's
servers, one run at a time: the sync, then the oversize lane, then the main run for up
to 4 hours 45 minutes. A failed sync leaves the work list unchanged and the checking continues.
The main run takes never-checked filings first, from the oldest part forward, then due
retries. It starts at 4 FCC requests per second, rises toward 8 while the FCC answers
normally and halves after a busy answer.

Each command keeps the run's state in a SQLite scratch database on local disk, under
`$FCC_CENSUS_SCRATCH` or the system temporary folder in `fcc-census/<run>/`, so memory
stays bounded at tens of millions of filings and outcomes. It streams the work-list
parts and outcome files into SQLite and selects due filings, the status tally and the
export with SQL. Parts and outcome files are cached there by name, so the main run
after the oversize lane reads only the outcome files written since. An interrupted
change is rebuilt from the cache by the next command.

Each attempt appends an outcome file under `fcc-national/v1/recovery/<run>/results/`, so a
stopped run loses at most a few minutes of work. A readable PDF is stored once under its
SHA-256 key, and R2 checks that digest before accepting the write. When the download
address refuses a file (401, 404 or 410; the FCC answers 401 for a missing file) or
returns bytes that are not a readable PDF, the run asks the FCC file record for another
download address. A filing becomes confirmed unavailable only after 2 such answers at
least 6 hours apart. A 403 can mean the FCC blocked the client rather than the file, so
it proves nothing about the filing. Neither do timeouts, busy answers, server errors,
other statuses, redirects away from the FCC, web pages served in place of a file,
cut-off downloads or storage failures; all are retried. Files over 512 MiB wait for the oversize lane,
which runs for up to 30 minutes before each main run at most 2 requests per second and
accepts up to 8 GiB. Outcome rows carry a version; unreadable outcomes recorded before the
alternate-address check, and refusals with any other status, are checked again.
Run `python scripts/national_fcc_collect.py status` for the current accounting and
`export --out FILE` for each filing's settled outcome.

## Finance search file

Finance answers Media buys searches from 1 read-only SQLite file that covers every indexed
filing, so the index rows never enter Supabase. Each filing carries 1 PDF state: saved (an
archive release original, a census save or a Minnesota station copy), unavailable (a
confirmed census outcome) or unchecked. Minnesota copies open the existing TV station file
page; other saved originals open the national file reader by their SHA-256.

The filing list comes from the compact inventory that `fcc-national/v1/inventory/current.json`
names in private R2. When no inventory is published, it comes from the active archive
release's recovered index. Both sources give the same filings for the same records.

1. Check the inputs with `python scripts/national_fcc_search.py inputs`. It prints the
   SHA-256 of everything that determines the file: the file format, the inventory data's
   digest (or the archive release's index digest), the key, size and ETag of every census
   object, the active archive release, the Minnesota document identities and the
   index-through date. It also says whether the active release was built from the same
   inputs.
2. Export the census with `python scripts/national_fcc_collect.py export --out CENSUS.jsonl.gz`.
3. Build with `python scripts/national_fcc_search.py build --inventory-current --census-export CENSUS.jsonl.gz --out SEARCH.sqlite`,
   or with `--inventory RECOVERED_INDEX` in place of `--inventory-current` for the archive
   release's index. The builder refuses an inventory whose SHA-256, size or row count
   differs from its manifest, and an index that is not the active release's. It reads the
   active archive release and Minnesota document identities from production, read only,
   and records the inputs and their digest in the file. Its printed counts are the
   release's filing, saved, unavailable and unchecked totals.
4. Publish with `python scripts/national_fcc_search.py publish --database SEARCH.sqlite --release-id ID`.
   It refuses a file that fails SQLite's quick check, stores the compressed file once
   under its SHA-256 with an R2-verified digest, records an inactive release and saves the
   file's inputs at `fcc-national/v1/search/inputs/ID.json`.
5. Activate with `python scripts/national_fcc_search.py activate --release ID --from-release CURRENT`
   (`none` for the first). Each API process reads the active release from Supabase at
   most once per 30 seconds, so an activation reaches every server within 30 seconds. The
   server then copies the file to local disk, checks both digests and switches to it; the
   previous copy serves until the new one is ready, and searches answer "Filings are
   loading" only when no copy is ready. A server reads only the file format it was built
   for and keeps its current copy when the active release has another format. Withdraw by
   activating the previous release the same way.

The **Publish the Finance national FCC search** workflow runs `release` at 05:41 and
17:41 UTC. It computes the inputs digest first and stops, without restoring, downloading,
building or uploading anything, when the digest equals the active release's. Any other
change, including a corrected census outcome that leaves the saved, unavailable and
unchecked totals equal, builds, publishes and activates a new file. While the census runs,
each scheduled release finds new outcome files and publishes.

### How the file is arranged

- Filing numbers follow file year, then upload date (newest first), then source order;
  a second number follows file year, then name, then source order. Each year is 1 range
  of both, so the newest page and the Name A–Z page of any year, at any depth, are
  direct reads.
- A record key (`SERVICE|entity|file ID`) is not stored; it is made from the station and
  the file ID, which is found through 1 index on station and file ID. File and download
  IDs that are lowercase UUIDs are stored as 16 bytes and SHA-256 digests as 32 bytes.
  Each folder path is stored once, in the folder table.
- Each file year has its own word index, and the saved originals have one for the
  national originals list, so a search reads only its own year's words. A word index
  stores which filings hold each word, not where, and keeps every 1- and 2-character
  beginning, so a short word reads 1 list.
- Every folder path starts "Political Files/" and the year. Those 3 words are left out of
  the word index. A typed word that starts "political", "files" or the year matches every
  filing of the year.

### Measurements

Measured on November 19, 2026 on 1 Apple laptop (10 cores, 32 GB), files read from a warm
disk cache, 333 queries of the same mix on each file: the newest, Name A–Z, Has filing PDF
and orders pages of every year; page 20,001 (offset 500,000) of 2026; `invoice`, `2026`
and `spectrum` in 3 years and both sorts; 30 rare words; 30 file ID beginnings; words that
start the folder prefix; the stations and folders tabs; filing details; and the national
originals list. The format 1 and format 2 files gave identical answers to all 333.

| | Format 1, 2.7 million filings | Format 2, 2.7 million filings | Format 2, synthetic 27 million filings |
| --- | ---: | ---: | ---: |
| File | 1,891,909,632 bytes | 735,309,824 bytes | 6,347,714,560 bytes |
| Compressed (gzip level 6) | 493,392,621 bytes | 374,907,083 bytes | 1,488,547,246 bytes |
| Build | 55 seconds | 55 seconds | 511 seconds |
| Query p50 | 2.79 ms | 0.35 ms | 0.39 ms |
| Query p95 | 934 ms | 42 ms | 345 ms |
| Query max | 1,320 ms | 277 ms | 2,950 ms |

The synthetic file repeats each of the 2,704,694 recovered filings 10 times with new file
IDs, so 2026 alone holds 14,686,230 filings. Its repeated names compress better than real
ones; at the 2.7 million file's ratio, 25 million filings would compress to about 3.2 GB.
Its build used 2.3 GB of memory and 24 GB of disk at its peak, including the finished file.
Every query slower than 1 second on it was a common or 1-letter word in 2026 combined with
Has filing PDF, orders or Name A–Z, counting 3 million to 12 million matches. A search
costs in proportion to its own year's filings. Unpacking and checking the 27 million file
took 7.7 seconds and packing it 91 seconds.

## Recover a missing national file

Keep the verified Drive delivery available for recovery. The private R2 namespace
`fcc-national/` holds the serving copy and compact research version. The general
Supabase backup job lists other R2 folders and checks every primary source key. A
national key unexpectedly present in the Supabase source is a storage conflict.
To restore member files, stage the retained transfer again and re-run the verified
upload. Existing objects must match their content hashes. Keep any conflicting
object for investigation. Revalidate the receipt against the catalog and recovered
index before publishing a replacement snapshot.

## Internal research and usage

Run `python -m scripts.national_fcc_db --target production restore-index --snapshot SNAPSHOT --destination NEW_SQLITE_PATH`
with private storage access and a new destination. The command checks the compressed and
restored digests. Query the resulting SQLite file locally. Loading index rows into the member
database would add millions of rows that member screens never use.

The member database holds file metadata and object references. Browse requests transfer
a page of matching rows. Finance serves signed-in PDF reads from private object storage. PDF bytes do not cross
Supabase. While the original is open, the file preview and **Save PDF** share the same downloaded bytes. Closing the preview or leaving the file releases that copy. Text loads only on demand. Distinguish disk space, query rows, response bytes and
billed outgoing data using the [Supabase usage guide](supabase-usage.md). The source includes
facility data, licensing records, file history and OCR progress. Those materials belong to
research and do not count as member files.

### Review archive usage

Member searches on **Media buys** and the national originals list read the server's
local copy of the search file, not Supabase. For them, each API process makes 1 small
Supabase read for the active search release at most once per 30 seconds. The server
reuses the private file read grant for up to 5 minutes, cut short by its expiry; it
needs the grant to copy a new search file and to open a PDF or its text.

The archive release tables (10,797 originals) are a fallback. They answer the national
originals list and the file reader only while that server has no ready copy of the
search file, for example in the first minutes after it starts.

Search previews return up to 5 rows and full pages up to 25. Search waits briefly for
typing to pause, and Finance can reuse an identical answer for the same account for 1
minute. Adding the source version to the current list address does not trigger another
fetch.

When the fallback answers, the member list selects only the fields shown in results,
plus the file identity and version used by the link. The first archive release added
about 8.5 MB across the 3 database tables and their indexes. Across all 10,797 live
records, the largest projected list row was 391 bytes when encoded as a JSON array. That
is under 2 KB of row data for a preview and 10 KB for a full page in the same
representation. The largest complete file metadata row was under 1 KB in JSON. These
sizes exclude protocol overhead and other queries, including the release and grant reads.

Use the [Supabase usage guide](supabase-usage.md#measurement) to check whether
archive queries become material as traffic grows. Compare calls and returned
rows in a representative window that excludes deliberate verification traffic.
Use Supabase's organization usage readings for billed bytes. Supabase bills
provisioned database disk, so table size alone does not show a change in the bill.
Keep the current read limits and access checks unless measurements identify a
specific read worth reducing.

For the November 16, 2026 snapshot, the recovered inventory contains 2,704,694 entries across
23 monthly windows. It includes deletion and purge history. The download log records 10,797
successful originals, 2 errors and 1 unavailable file. The originals cover 7,619 cable, 2,007
TV, 538 FM, 334 AM and 299 satellite TV files. They use 9,923 distinct PDF bodies. The
original collection records 23 of 180 planned date windows; neither the index nor the
available documents establish a complete national history.
