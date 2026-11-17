# National FCC political files in Finance

<!-- describes: scripts/national_fcc_objects.py, scripts/national_fcc_db.py, alethical/api/services/finance_national_files.py, apps/finance/src/pages/media/NationalFile.tsx -->

Finance members browse and open original documents under **Media buys → National FCC files**.
The 3 Minnesota stations keep their existing folders, checks and connections. National files
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
5. Check membership, object access, representative PDFs and text. Activate with
   `python -m scripts.national_fcc_db --target production activate --snapshot NEW --from-snapshot CURRENT`
   (use `none` for the first release). Check live discovery, page 2, file identity,
   the source hash, text availability and refusal of anonymous access.
6. To withdraw a release, use the same activation command with the prior IDs reversed.
   Members then see the preceding release, or an empty national list on first-release
   withdrawal. Private original bytes and research evidence remain available for recovery.

## Internal research and usage

Run `python -m scripts.national_fcc_db --target production restore-index --snapshot SNAPSHOT --destination NEW_SQLITE_PATH`
with private storage access and a new destination. The command checks the compressed and
restored digests. Query the resulting SQLite file locally. Loading index rows into the member
database would add millions of rows that member screens never use.

The member database holds file metadata and object references. Browse requests transfer
a page of matching rows. PDF reads go directly to private object storage after a signed-in
request. Text loads only on demand. Distinguish disk space, query rows, response bytes and
billed outgoing data using the [Supabase usage guide](supabase-usage.md). The source includes
facility data, licensing records, file history and OCR progress. Those materials belong to
research and do not count as member files.

For the November 16, 2026 snapshot, the recovered inventory contains 2,704,694 entries across
23 monthly windows. It includes deletion and purge history. The download log records 10,797
successful originals, 2 errors and 1 unavailable file. The originals cover 7,619 cable, 2,007
TV, 538 FM, 334 AM and 299 satellite TV files. They use 9,923 distinct PDF bodies. The
original collection records 23 of 180 planned date windows; neither the index nor the
available documents establish a complete national history.
