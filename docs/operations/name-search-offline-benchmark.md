# Offline name-search comparison

Net: compare 3 ways to answer the same name search before choosing a production
change. This tool uses a local PostgreSQL database, prints no names, and rolls
back all temporary work. It does not change the website.

<!-- describes: scripts/benchmark_campaign_finance_name_search.py, alethical/tests/test_name_search_offline_benchmark.py -->

The work belongs to [issue 2026](https://github.com/alethical-org/alethical/issues/2026).
The live query and reported production measurements are in
[campaign_finance_search.py](../../alethical/api/services/campaign_finance_search.py).
The identity and source-generation requirements remain in
[campaign-finance-system-design.md §4 and §5](../architecture/campaign-finance-system-design.md).

## What the experiment compares

1. The current payment-name query, imported directly from the reader.
2. Find up to 201 distinct matching names, then count payment rows for the displayed
   names. The distinct-name count also tells us whether more results exist.
3. Build a temporary exact-name/count list per source snapshot and dataset, then
   search that smaller list. Compare every derived name/count against a separate
   SQL grouping before making the generation available. Missing generations use
   the current query; completed empty generations remain empty.

Every candidate retains exact printed strings, the shared escaped substring match,
alphabetical ordering, separate dataset counts, duplicate payment rows, and the
200-name counting ceiling. No person identities, amounts, or cross-dataset totals
are created. The sitting-member and committee-register groups are outside this
experiment and keep their current implementation.

## Run without connecting

From the repository root:

```bash
uv run python -m scripts.benchmark_campaign_finance_name_search
```

The default reports the plan only. `--execute` requires an explicit loopback
PostgreSQL URL in `ALETHICAL_SEARCH_BENCHMARK_DATABASE_URL`. It never reads the
application's database setting. Host overrides in URL query options are refused.
The database must already have `pg_trgm` installed; the tool creates no extension.
The server must also report a loopback address. This strict check refuses a normal
Docker bridge connection even when its published port is local. Use a native local
PostgreSQL server for the CLI, never a tunnel or forwarded production connection.
Neither address check proves physical locality through every possible tunnel;
confirming a known local copy remains a prerequisite.

## Synthetic correctness exercise

Use a disposable local database with `pg_trgm` installed:

```bash
ALETHICAL_SEARCH_BENCHMARK_DATABASE_URL=postgresql://localhost/search_experiment \
uv run python -m scripts.benchmark_campaign_finance_name_search \
  --execute --source synthetic --iterations 5 --seconds 60
```

Synthetic rows shadow the source tables in this connection only. Every temporary
write names `pg_temp` explicitly, and synthetic reads put temporary tables first
even when the inherited search order puts `public` first. They include
repeated payments, different case, punctuation, rare and common fragments, null
names, and another source generation. The 14 synthetic query cases are **not the
original production comparison's 14 strings**. Timings from these rows prove
nothing about production speed.

The focused tests use PostgreSQL temporary tables and override the normal suite's
database-seeding fixture. They do not empty any existing tables:

```bash
ALETHICAL_TEST_DATABASE_URL=postgresql+psycopg://localhost/search_experiment \
uv run pytest alethical/tests/test_name_search_offline_benchmark.py
```

The name-collision regression creates and removes its own randomly named local
database. Its connection needs permission to create a database. That isolated
database contains made-up permanent and temporary rows with identical table names;
the test checks that both accepted-source and synthetic runs leave the permanent
rows, indexes and statistics unchanged. Other tests use temporary tables only.
CI's disposable Docker database is admitted by the test fixture's loopback-URL and
`pg_trgm` checks, not by relaxing the CLI guard. Only the source-completeness CLI
tests replace that guard with a test-local metadata adapter. Separate fake-session
tests cover the real guard's accepted and refused addresses and missing extension;
a successful CI run is not evidence of a full CLI run on Docker.

## Compare already accepted local records

Use a local copy of a published Alethical database, preserving its source snapshot
identifiers, rows, metadata, collation, and existing indexes. The tool resolves
1 published release and refuses an incomplete source row count. It creates only
temporary derived rows, uses 1 consistent transaction, and rolls back on success
or failure. It does not download or import records and cannot target a remote host.

Keep the original 14 queries in a private local JSON array of strings. Do not
commit that file or paste it into an issue. The output identifies queries by their
position, without their text or a reversible fingerprint.

```bash
ALETHICAL_SEARCH_BENCHMARK_DATABASE_URL=postgresql://localhost/accepted_copy \
uv run python -m scripts.benchmark_campaign_finance_name_search \
  --execute --source accepted --queries-file /private/tmp/private-search-queries.json \
  --iterations 10 --seconds 300
```

The private query file is read only up to 32 KiB plus 1 byte and refused if larger.
Limits are 14 queries, 1 to 20 measured repetitions, 1 warmup per variant, 3
datasets, and at most 300 seconds. Each statement has a maximum 10-second timeout
and a 1-second lock timeout, shortened by the remaining run budget. Variant order
rotates between repetitions. Exceptions print a type and fixed message, without
SQL parameters, names, connection strings, or query plans.

The report includes each sample, case median and worst observation, sum of case
medians, worst case median, source row counts and snapshot identifiers, database
version/collation, and the derived-list preparation cost. Every timed result must
equal the current query's complete result in memory before a report prints.

## Remaining measurement gates

- Obtain the accepted full-scale local records and the original 14-query set.
  The tool's synthetic exercise cannot complete that acceptance criterion.
- Compare current and candidate answers on those records, including all 3 datasets.
  Retain the private query-number mapping locally so measurements are repeatable.
- Match production database version, collation, indexes, and planner settings before
  interpreting the local comparison. A local warm-query comparison does not measure
  production response time, cold storage, concurrency, or browser usability.
- Measure generation building during a representative local source load. Temporary
  table build time excludes durable writes, replication, publication integration,
  and retirement. No production table is authorized by this experiment.
- Count real search starts, completions and selections without retaining typed names.
  That separate reader-measurement work is outside this script.
- Choose a live change only after correctness holds and measured reader benefit
  justifies it. A passing synthetic suite does not select a winner.
