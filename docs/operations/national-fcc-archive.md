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
`worklist` stores the full index as a private work list in R2, marking filings already
held in the archive release or the Minnesota collection; those are not downloaded again.
The **Check national FCC filing PDFs** workflow then runs every 30 minutes on GitHub's
servers, one run at a time, each for up to 5.5 hours. It starts at 4 FCC requests per
second, rises toward 8 while the FCC answers normally and halves after a busy answer.

Each attempt appends an outcome file under `fcc-national/v1/recovery/<run>/results/`, so a
stopped run loses at most a few minutes of work. A readable PDF is stored once under its
SHA-256 key, and R2 checks that digest before accepting the write. When the download
address refuses a file (401, 404 or 410; the FCC answers 401 for a missing file) or
returns bytes that are not a readable PDF, the run asks the FCC file record for another
download address. A filing becomes confirmed unavailable only after 2 such answers at
least 6 hours apart. A 403 can mean the FCC blocked the client rather than the file, so it
is retried like timeouts, busy answers, server errors, other statuses, redirects
away from the FCC, web pages served in place of a file, cut-off downloads and storage
failures prove nothing and are retried. Files over 512 MiB wait for the oversize lane,
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

1. Export the census with `python scripts/national_fcc_collect.py export --out CENSUS.jsonl.gz`.
2. Build with `python scripts/national_fcc_search.py build --inventory RECOVERED_INDEX --census-export CENSUS.jsonl.gz --out SEARCH.sqlite`.
   The builder reads the active archive release and Minnesota document identities from
   production, read only. Its printed counts are the release's filing, saved, unavailable
   and unchecked totals.
3. Publish with `python scripts/national_fcc_search.py publish --database SEARCH.sqlite --release-id ID`.
   It refuses a file that fails SQLite's quick check, stores the compressed file once
   under its SHA-256 with an R2-verified digest and records an inactive release.
4. Activate with `python scripts/national_fcc_search.py activate --release ID --from-release CURRENT`
   (`none` for the first). The API copies the file to local disk, checks both digests and
   switches to it; the previous copy serves until the new one is ready, and searches
   answer "Filings are loading" only when no copy is ready. Withdraw by activating the
   previous release the same way.

The **Publish the Finance national FCC search** workflow runs these steps at 05:41 and
17:41 UTC with `release`, which publishes and activates only when the saved, unavailable
or pending counts differ from the active release.

The November 19, 2026 trial build held 2,704,694 filings, 10,090 stations and providers
and 292,043 folders in 1,782,939,648 bytes. On a laptop, a page of the newest filings took
under 1 ms and a search for a word in 1.47 million filings about 0.3 seconds.

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

The member list selects only the fields shown in results, plus the file identity
and version used by the link. Search previews return up to 5 rows and full pages up
to 25. Search waits briefly for typing to pause, and Finance can reuse an identical
answer for the same account for 1 minute. Adding the source version to the current
list address does not trigger another fetch. The server reuses the private file
read grant for up to 5 minutes, cut short by its expiry.

The first live release added about 8.5 MB across the 3 database tables and their
indexes. Across all 10,797 live records, the largest projected list row was 391
bytes when encoded as a JSON array. That is under 2 KB of row data for a preview
and 10 KB for a full page in the same representation. The largest complete file
metadata row was under 1 KB in JSON. These sizes exclude protocol overhead and
other queries, including the release and grant reads.

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
