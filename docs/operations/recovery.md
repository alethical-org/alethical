# Recovering Alethical after a database or source-file failure

<!-- describes: alethical/pipeline/raw_file_mirror.py, scripts/mirror_raw_files.py, railway.json -->

Net: A current second copy is protection against losing a source file. A timed restore is the proof that the database, saved sources, settings, and job state can work together again. These are separate checks.

## Safety boundaries

- Restore into a newly created, isolated database. Never restore over production or another task's database.
- Keep database backups and restored reader records private. Use a private directory, restrict file permissions, and delete throwaway copies after the drill. Never put backup files, reader rows, tokens, passwords, or callback addresses into Git, a report, or an issue.
- Keep mail delivery, paid generation, and background workers disabled. Reading a restored record does not authorize sending its queued messages or replaying its jobs.
- Reserve source-database reads with the active ingestion owner. Use 1 dump connection and a short lock-wait limit; do not stop another task or change production settings to make a drill faster.
- Record the exact backup timestamp, source revision, schema version, and result. A fresh logical dump proves that dump's recovery path. It does not prove Supabase's automatic backups, their retention, or recovery during a complete Supabase outage.

## Source files: current presence and bounded hash proof

The daily mirror lists both Supabase Storage and Cloudflare R2. Every object in either store is part of the check, including objects no production database row names. Every database row naming a stored body is also part of the check, so a missing primary object cannot silently disappear from the work list.

A missing Cloudflare copy is uploaded from the primary only after the primary bytes match any recorded hash. Both copies are read back for new or repaired objects. Observed size or hash conflicts fail without writing either copy. A missing primary fails and preserves any second copy for recovery.

A saved `mirrored_at` value means the last successful hash proof. It never substitutes for current presence. Each daily run renews confirmations older than 7 days, oldest first, within 256 MiB of combined old-object reads across both stores. Objects too large for the remaining budget are deferred visibly. This is a read budget, not a promise that every hash is renewed within 7 days. Unrecorded objects have no saved confirmation time, so their routine hash checks are spread over 28 days by their object key, with the first key rotating on each cycle to avoid repeatedly deferring the same tail. A full audit includes them all.

At the maximum daily old-object budget, 31 runs read at most 7.75 GiB combined, including at most 3.875 GiB from Supabase. New and missing objects are additional, as in the existing copy job. Review remaining included service allowances before increasing the budget; no paid AI is involved. The report distinguishes current presence, hashes read during this run, and hashes deferred by the budget.

### Read without changing anything

The commands use the existing scoped database and storage settings. They print object identities and aggregate results, never document contents. Run from an isolated worktree with the required environment already loaded privately.

```bash
# Presence and size inventory, with no object reads or writes.
PYTHONPATH=. uv run python scripts/mirror_raw_files.py --target production --dry-run

# Read-only hash audit, capped at 16 MiB across both stores.
PYTHONPATH=. uv run python scripts/mirror_raw_files.py --target production --audit --verify-all --verify-max-mib 16

# Full audit after reserving the download window and sizing both stores.
PYTHONPATH=. uv run python scripts/mirror_raw_files.py --target production --audit --verify-all --verify-max-mib 4096
```

The audit uses a read-only database transaction and never calls the upload method. With `--verify-all`, any deferred hash makes the command exit with failure: a small sample must never look like a complete audit. Increase the budget only after counting the total bytes. All temporary file contents are removed after each comparison, including failed reads.

### Repair a missing second copy

```bash
PYTHONPATH=. uv run python scripts/mirror_raw_files.py --target production
```

Reserve any production repair window first. The mirror adds missing copies and records successful proof; it never deletes an object or deliberately overwrites an observed conflict. The inherited upload checks for absence before uploading, rather than using an atomic create-only write. A concurrent writer can race that check, so this is not a guarantee against concurrent overwrites. If a primary object is missing, preserve Cloudflare's copy, compare its bytes with the database's recorded hash, and restore the exact named object through a separately reviewed recovery step. A changed object needs investigation, not an overwrite that destroys the remaining evidence.

## Database restoration drill

1. Read the actual backup inventory in Supabase. Record completed backup times, the earliest and latest restorable time, retention settings, and whether point-in-time recovery is enabled. Do not infer account settings from a pricing page.
2. Record the database's schema revision and size, active jobs, and active connections without printing record contents. Choose a consistent completed backup. If only a fresh logical export is available, label that limit explicitly.
3. Create a disposable PostgreSQL instance or database on an isolated local port. Record its empty state and allow connections only from the local machine. Install the PostgreSQL and vector-extension versions the backup requires.
4. Restore schema and data from the chosen backup. Time these separately from the search-index build. A successful command alone is not the end of the drill.
5. Compare table counts and schema state against the same backup snapshot. Check constraints, representative bill records, source links, saved account relationships, and a real search query. Test sign-in only with a designated test account in the isolated environment. Do not print private rows.
6. Read stored source bytes from the recovered manifest, check their hashes, and show how the restored record reaches them. Source buckets are separate from Supabase database backups.
7. Prove the job state is safe before enabling any worker. Completed work must stay complete, uncertain work must be identified, and every mail or paid call must remain disabled. Use controlled local examples to prove restart behavior.
8. Rebuild API and web services from the recorded reviewed revision, restore settings without copying secret values into notes, and test the alternate hostname before any real traffic switch. Coordinate live DNS or hosting changes separately.
9. Record hours of possible data loss, total recovery time, search-index time, missing pieces, and the exact remaining prerequisite. Remove the private disposable data after the proof. Repeat after material changes to storage or recovery machinery.

## Completion record

A complete drill records the source backup time, restore start and finish, search-index finish, compared counts and hashes, exercised reader paths, safe job-restart result, and operator. A second operator should be able to follow this procedure from the recorded inputs.

The acceptable loss and outage limits, plus any investment in another region, remain decisions made from measured results. An additional replica by itself does not prove database recovery.

The full drill is tracked in [issue 802](https://github.com/alethical-org/alethical/issues/802). Exact Supabase backup retention is tracked in [issue 1047](https://github.com/alethical-org/alethical/issues/1047). [deployment.md](deployment.md) owns ordinary release and traffic recovery; [repo-and-service-settings.md](repo-and-service-settings.md) owns hosted settings.

The current drill records its production census and private restore measurements separately. Publish only sanitized completion outcomes after confirming the intended destination.
