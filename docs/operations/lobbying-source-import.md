# Copying the Board's lobbying files

<!-- describes: alethical/pipeline/lobbying_registrations.py, alethical/pipeline/lobbying_expenditures.py, scripts/load_lobbying.py, scripts/load_lobbying_expenditures.py, alethical/alembic/versions/0054_lobbying_registrations.py -->

The lobbying lookups read 1 published pair: the current active-lobbyist list and
the principal-expenditures file. They are copied in 1 job and carry 1 copy date.
The contribution file is separate and keeps its own older date.

## Source and privacy

Each run resolves 2 links from the Board's
[lobbying downloads](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/):

- Under **Lobbyist Information**, the row **Active Lobbyists**.
- Under **Principal expenditures**, the row **Principal expenditures - 2009 - Present**.

Download numbers are observations, not saved routing constants. Changed labels,
an unexpected filename or a changed header stop publication rather than guessing.

The active-list CSV is read in memory. Parsing immediately selects registration
number, filed name, formatted name, first/middle/last name parts and associations.
Street, city, state, ZIP, telephone and email are never stored. Neither the raw
CSV nor a raw record is saved or logged. Safe evidence contains only selected
fields, source metadata and hashes. Each association preserves its integer entity
ID, printed name and position in the source list.

The existing principal-expenditures file storage remains intact, including copies
used by published research. Its 6 amount columns preserve blanks as null and
source zeroes as zero. No new amount calculation changes those rows.

## Running the copy

`just load-lobbying production true` fetches and validates both files without
writing to the database or file store. The equivalent command is:

```bash
uv run python scripts/load_lobbying.py --target production --dry-run
```

The active list must have unique positive registration numbers, complete names,
at least 1 row, and associations that all parse. Unparsed entries are counted and
block publication. The operational row-count band permits a 2% decrease or 10%
increase against the prior published active list; this is a guard we chose, not
a claim made by Minnesota. Existing spending checks still apply independently.

A first active-list import has no baseline. After reviewing the safe records,
name their exact hash using `--publish-lobbyist-hash`. That can waive the count
comparison, never a structural check. `--publish-hash` belongs to the existing
spending comparison checks and is not needed when they pass. A changed file
requires a fresh review; neither switch is a permanent approval.

```bash
uv run python scripts/load_lobbying.py --target production --dry-run \
  --publish-lobbyist-hash <reviewed-safe-record-hash> \
  --safe-evidence /tmp/lobbyists-safe.json
```

After a passing dry run, removing `--dry-run` publishes the checked pair. No
scheduled paid run is created. The existing expenditures-only command remains
available for compatibility, but cannot alter the pair the public lobbying
lookups read.

## Publication and recovery

The same database lock protects spending publication, paired publication and
pruning. Both current pointers move in 1 transaction, after both checks pass.
A failed transaction keeps the old pair. A slower run cannot replace a newer
published pair. A new run advances the pair's copy date even if the spending
file's contents did not change; the spending snapshot may be reused.

The current pair and its previous published pair retain complete rows for
rollback. Restoring an older pair does not make its copy date newer. A later
publication must still preserve the pair it just replaced, even after rollback.
Historical metadata remains; old active-list rows outside retention may be
pruned. Spending copies pinned by published research are protected separately.

`restore_release(db, release_id)` in the paired loader restores a specifically
reviewed, retained pair and both pointers. It refuses a missing or pruned pair,
or any pair whose held row counts do not match its source metadata. Tests cover
upgrade, downgrade, upgrade; rollback on a partial failure; repeated copies;
stale runs; and restoration across later copies. For the first release, saving
the previous spending pointer also permits returning to the pre-lobbying state
without deleting any source records.

## Link evidence before publication

The checks on [issue 2163](https://github.com/alethical-org/alethical/issues/2163)
measure 2 separate relationships:

1. Active-list entity IDs against spending-file Entity IDs, plus exact printed
   name agreement. An unresolved principal ID never gets a spending-page link.
2. Every Lobbyist-kind Contribution row's contributor registration number against
   the active list, including unresolved numbers and different typed names.

The 13 September preflight found 1,665 lobbyists and 5,395 associations, with 0
unparsed entries. Of 1,832 distinct associated principal IDs, 1,573 had spending
rows and 259 did not. Of the 1,573 resolved ID/name pairs, 1,562 printed names
agreed and 11 differed. Across 22,352 Lobbyist-kind Contribution rows, 16,394
registration numbers resolved and 5,958 did not; 3,473 resolved rows had a
different typed name. These are source relationships, not claims about identity
from name spelling.

The fresh spending file held the same 17,842 rows and byte hash as the published
copy. Its rows cover 2014 through 2025 despite the download's 2009 label. The
latest year has 1,748 principals with any reported amount. Counts must be repeated
against the published pair and reported on
[issue 2163](https://github.com/alethical-org/alethical/issues/2163).
