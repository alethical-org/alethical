"""Fail when the migration history and ``models.py`` stop describing the same schema.

Net: this is the recurrence guard for
``docs/operations/production-database-schema-drift.md``. That audit found the repo
and production differing in 39 places with no error anywhere, because
``0001_initial_schema`` used to build the schema with ``Base.metadata.create_all()``
-- a snapshot of whatever ``models.py`` said at the moment it ran. Under a snapshot
baseline, a model edit with no migration is invisible: the fresh database silently
picks the edit up and every check passes. Now that ``0001`` writes explicit DDL, the
two paths can finally disagree, and this script is what notices (#100).

Two modes, both read-only against anything that matters:

``--mode migrations-vs-models`` (default, what CI runs)
    Build two throwaway databases on the same server -- one by ``alembic upgrade
    head``, one by ``Base.metadata.create_all()`` -- then diff their catalogs. A
    difference means someone changed ``models.py`` without writing the migration
    that carries the change to an existing database.

``--mode production-vs-migrations`` (the deploy workflow, or a person)
    Diff live production against a throwaway ``alembic upgrade head`` database, so
    "what production actually is" can be re-measured. Read-only: it opens
    production with a plain ``SELECT`` connection and creates nothing there. Runs
    as its own job in ``.github/workflows/migrate.yml`` after that workflow
    applies migrations to production, and files an issue if it finds anything.
    **Not in ci.yml**: pull-request CI has no production credentials and must
    never be given any, which is why this mode is opt-in rather than the default.

Both modes share one snapshot function, so the two comparisons are the same
comparison pointed at different databases.

Usage::

    uv run python scripts/check_schema_drift.py
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/check_schema_drift.py \\
        --mode production-vs-migrations
    uv run python scripts/check_schema_drift.py --json   # machine-readable diff
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.engine import URL, Engine, make_url

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from alethical.db import models  # noqa: E402
from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    local_database_url,
)

# ---------------------------------------------------------------------------
# What the comparison deliberately ignores, and why each entry is not a defect.
# ---------------------------------------------------------------------------

# The Oban job queue installs its own tables through ``oban install``, on purpose
# outside Alembic -- see docs/product-onboarding/data-ingestion-onboarding.md
# section "Orchestration - Oban job queue + CLI". They exist in production and on
# any developer machine that ran the installer, and in neither case did a
# migration put them there. Finding D5 of the audit.
IGNORED_TABLES = frozenset(
    {
        "alembic_version",
        "oban_jobs",
        "oban_leaders",
        "oban_producers",
    }
)
IGNORED_ENUMS = frozenset({"oban_job_state"})

# Extensions are compared by allowlist rather than by difference. Production runs
# on Supabase, which installs pgcrypto, uuid-ossp, pg_stat_statements and
# supabase_vault as platform furniture; they are not ours to create and not ours
# to drop, so listing what *is* ours is the only stable comparison. Finding D9.
OWNED_EXTENSIONS = frozenset({"vector", "pg_trgm"})

# Indexes a migration creates by hand that no model declares, so ``create_all``
# will never build them. Listed one by one rather than matched by a rule, so a
# newly undeclared index is a difference somebody has to look at rather than
# something the check quietly absorbs. Three groups:
#   * the composite indexes 0001 adds after the tables exist, deliberately absent
#     from models.py -- declaring them there would make create_all build them
#     first and 0001's own create_index fail;
#   * the vector index, where 0001 builds an ivfflat one and 0012 replaces it with
#     HNSW. A column can carry one index declaration, not a before and an after;
#   * the trigram search indexes, three from 0011 and one from 0032. These are the
#     one group that *could* move onto the models (SQLAlchemy can express
#     gin_trgm_ops), which would shorten this list by four. Left where they are:
#     this change is a transcription of the old baseline, and moving them changes
#     what create_all builds.
MIGRATION_ONLY_INDEXES = frozenset(
    {
        "ix_legislator_service_period_legislator_session_current",
        "ix_sponsorship_bill_role_source_order",
        "ix_rag_chunk_embedding_embedding_model",
        "ix_rag_chunk_embedding_embedding_ivfflat",
        "ix_rag_chunk_embedding_embedding_hnsw",
        "ix_bill_title_trgm",
        "ix_bill_description_trgm",
        "ix_bill_short_title_trgm",
        "ix_legislator_full_name_trgm",
    }
)

# Row-level security is on for every production table with zero policies, and off
# everywhere else. That is Supabase's secure default, not a broken permission: the
# app connects as the table owner and bypasses it. Reported by the production mode
# so nobody rediscovers it, never a failure. Finding D10.
RLS_IS_REPORTED_NOT_FAILED = True


# ---------------------------------------------------------------------------
# Snapshot
# ---------------------------------------------------------------------------


@dataclass
class Snapshot:
    """Everything about a schema that two databases can meaningfully disagree on.

    Column *position* is deliberately absent. Postgres appends a column added by
    ``ALTER TABLE``, while ``create_all`` puts it wherever the model declares it,
    so the two orders diverge on the first hand-written migration and stay
    diverged forever. Position carries no meaning here, so comparing it would
    only ever produce a red build for a correct change.
    """

    label: str
    extensions: set[str] = field(default_factory=set)
    enums: dict[str, tuple[str, ...]] = field(default_factory=dict)
    tables: set[str] = field(default_factory=set)
    columns: dict[str, str] = field(default_factory=dict)
    constraints: dict[str, str] = field(default_factory=dict)
    indexes: dict[str, str] = field(default_factory=dict)
    rls_enabled: set[str] = field(default_factory=set)


_EXTENSION_SQL = "SELECT extname FROM pg_extension"

_ENUM_SQL = """
SELECT t.typname, e.enumlabel
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY t.typname, e.enumsortorder
"""

_TABLE_SQL = """
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
"""

# format_type() renders the type exactly as Postgres understands it, so
# `character varying(200)` compares equal however the two sides spelled it.
_COLUMN_SQL = """
SELECT c.relname AS table_name,
       a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull AS not_null,
       pg_get_expr(d.adbin, d.adrelid) AS default_expr
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
"""

# pg_get_constraintdef() normalises whatever SQL created the constraint into one
# canonical form, so a check written two ways still compares equal.
_CONSTRAINT_SQL = """
SELECT c.relname AS table_name,
       con.conname AS constraint_name,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
"""

# Indexes that merely back a constraint are skipped: the constraint pass above
# already compares them, and reporting both turns one difference into two.
_INDEX_SQL = """
SELECT c.relname AS table_name,
       i.relname AS index_name,
       pg_get_indexdef(x.indexrelid) AS definition
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class c ON c.oid = x.indrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT EXISTS (
      SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid
  )
"""


def take_snapshot(engine: Engine, label: str) -> Snapshot:
    """Read one database's public schema out of pg_catalog. Read-only."""
    snap = Snapshot(label=label)
    with engine.connect() as conn:
        snap.extensions = {
            name for (name,) in conn.execute(sa.text(_EXTENSION_SQL))
        } & OWNED_EXTENSIONS

        enums: dict[str, list[str]] = {}
        for typname, label_value in conn.execute(sa.text(_ENUM_SQL)):
            if typname in IGNORED_ENUMS:
                continue
            enums.setdefault(typname, []).append(label_value)
        snap.enums = {k: tuple(v) for k, v in enums.items()}

        for table, rls in conn.execute(sa.text(_TABLE_SQL)):
            if table in IGNORED_TABLES:
                continue
            snap.tables.add(table)
            if rls:
                snap.rls_enabled.add(table)

        for table, column, data_type, not_null, default_expr in conn.execute(
            sa.text(_COLUMN_SQL)
        ):
            if table in IGNORED_TABLES:
                continue
            null_text = "NOT NULL" if not_null else "NULL"
            default_text = f" DEFAULT {default_expr}" if default_expr else ""
            snap.columns[f"{table}.{column}"] = f"{data_type} {null_text}{default_text}"

        for table, name, definition in conn.execute(sa.text(_CONSTRAINT_SQL)):
            if table in IGNORED_TABLES:
                continue
            snap.constraints[f"{table}.{name}"] = definition

        for table, name, definition in conn.execute(sa.text(_INDEX_SQL)):
            if table in IGNORED_TABLES or name in MIGRATION_ONLY_INDEXES:
                continue
            snap.indexes[f"{table}.{name}"] = definition

    return snap


# ---------------------------------------------------------------------------
# Diff
# ---------------------------------------------------------------------------


@dataclass
class Difference:
    category: str
    key: str
    left: str | None
    right: str | None

    def render(self, left_label: str, right_label: str) -> str:
        if self.left is None:
            return f"  [{self.category}] {self.key}: missing from {left_label}"
        if self.right is None:
            return f"  [{self.category}] {self.key}: missing from {right_label}"
        return (
            f"  [{self.category}] {self.key}:\n"
            f"      {left_label}: {self.left}\n"
            f"      {right_label}: {self.right}"
        )


def _diff_mapping(
    category: str, left: dict[str, object], right: dict[str, object]
) -> list[Difference]:
    out: list[Difference] = []
    for key in sorted(set(left) | set(right)):
        lv = left.get(key)
        rv = right.get(key)
        if lv == rv:
            continue
        out.append(
            Difference(
                category=category,
                key=key,
                left=None if lv is None else str(lv),
                right=None if rv is None else str(rv),
            )
        )
    return out


def _diff_set(category: str, left: set[str], right: set[str]) -> list[Difference]:
    out: list[Difference] = []
    for key in sorted(left - right):
        out.append(Difference(category, key, left="present", right=None))
    for key in sorted(right - left):
        out.append(Difference(category, key, left=None, right="present"))
    return out


def diff_snapshots(left: Snapshot, right: Snapshot) -> list[Difference]:
    """Every way two schemas disagree, worst-scoped first (a missing table
    explains the missing columns underneath it, so tables are reported first)."""
    differences: list[Difference] = []
    differences += _diff_set("extension", left.extensions, right.extensions)
    differences += _diff_set("table", left.tables, right.tables)
    differences += _diff_mapping("enum", dict(left.enums), dict(right.enums))

    # A table missing from one side would otherwise report every one of its
    # columns, constraints and indexes as a separate difference -- 33 of the
    # audit's 39 raw differences were that inflation. Compare the contents of
    # tables both sides have; the missing table itself is already reported.
    shared = left.tables & right.tables

    def _shared_only(mapping: dict[str, str]) -> dict[str, object]:
        return {k: v for k, v in mapping.items() if k.split(".", 1)[0] in shared}

    differences += _diff_mapping(
        "column", _shared_only(left.columns), _shared_only(right.columns)
    )
    differences += _diff_mapping(
        "constraint", _shared_only(left.constraints), _shared_only(right.constraints)
    )
    differences += _diff_mapping(
        "index", _shared_only(left.indexes), _shared_only(right.indexes)
    )
    return differences


# ---------------------------------------------------------------------------
# Throwaway databases
# ---------------------------------------------------------------------------


def _admin_engine(url: URL) -> Engine:
    """A connection to the server's own ``postgres`` database, for CREATE DATABASE.

    CREATE DATABASE cannot run inside a transaction, hence AUTOCOMMIT.
    """
    return sa.create_engine(
        url.set(database="postgres"),
        isolation_level="AUTOCOMMIT",
        connect_args=NO_PREPARED_STATEMENTS,
    )


class ScratchDatabase:
    """A database created for one comparison and dropped afterwards.

    Named with a random suffix so two runs on the same server -- two parallel
    sessions on this Mac, or a re-run after a crash -- cannot collide or reuse
    each other's leftovers.
    """

    def __init__(self, base_url: URL, purpose: str) -> None:
        self.base_url = base_url
        self.name = f"drift_{purpose}_{uuid.uuid4().hex[:8]}"
        self.url = base_url.set(database=self.name)

    def __enter__(self) -> ScratchDatabase:
        with _admin_engine(self.base_url).connect() as conn:
            conn.execute(sa.text(f'CREATE DATABASE "{self.name}"'))
        return self

    def __exit__(self, *exc: object) -> None:
        with _admin_engine(self.base_url).connect() as conn:
            # Terminate first: a leaked connection makes DROP DATABASE hang, and
            # a hung teardown is indistinguishable from a hung check.
            conn.execute(
                sa.text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :name AND pid <> pg_backend_pid()"
                ),
                {"name": self.name},
            )
            conn.execute(sa.text(f'DROP DATABASE IF EXISTS "{self.name}"'))

    def engine(self) -> Engine:
        return sa.create_engine(self.url, connect_args=NO_PREPARED_STATEMENTS)


def build_by_migrations(scratch: ScratchDatabase) -> None:
    """Run the real migration history, through the real alembic entry point.

    A subprocess rather than an in-process API call, so this exercises exactly
    what ``migrate.yml`` runs against production. DATABASE_URL is overridden and
    ALETHICAL_DATABASE_TARGET cleared, so no environment left over from a
    production command can point this at the wrong database.
    """
    env = {
        **os.environ,
        "DATABASE_URL": scratch.url.render_as_string(hide_password=False),
    }
    env.pop("ALETHICAL_DATABASE_TARGET", None)
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
        )


def build_by_models(scratch: ScratchDatabase) -> None:
    """Build the schema the way ``models.py`` describes it, with nothing else."""
    engine = scratch.engine()
    with engine.begin() as conn:
        # create_all cannot install an extension, and the Vector column type
        # needs one before any table referencing it can exist.
        conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    models.Base.metadata.create_all(bind=engine)
    engine.dispose()


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------


def _local_base_url() -> URL:
    # local_database_url(), not get_database_url(): the --against-production mode
    # runs with ALETHICAL_DATABASE_TARGET=production set (that is the documented
    # command) and still needs the *local* server here, to build the throwaway
    # databases it compares production against. get_database_url() refuses that
    # combination on purpose (#1090).
    url = make_url(local_database_url())
    if url.host not in {"localhost", "127.0.0.1", "::1", "db"}:
        raise SystemExit(
            "Refusing to create throwaway databases on a non-local server "
            f"({url.host!r}). Point DATABASE_URL at a local Postgres."
        )
    return url


def run_migrations_vs_models() -> tuple[Snapshot, Snapshot, list[Difference]]:
    base = _local_base_url()
    with ScratchDatabase(base, "mig") as mig, ScratchDatabase(base, "mod") as mod:
        build_by_migrations(mig)
        build_by_models(mod)
        mig_engine, mod_engine = mig.engine(), mod.engine()
        try:
            left = take_snapshot(mig_engine, "migrations")
            right = take_snapshot(mod_engine, "models.py")
        finally:
            mig_engine.dispose()
            mod_engine.dispose()
    return left, right, diff_snapshots(left, right)


def run_production_vs_migrations() -> tuple[Snapshot, Snapshot, list[Difference]]:
    production_url = database_url_for_target("production")
    prod_engine = sa.create_engine(
        production_url,
        connect_args=NO_PREPARED_STATEMENTS,
        # Read-only for the length of the connection: a mistake in this script
        # cannot write to production even if someone later adds a stray DDL call.
        execution_options={"postgresql_readonly": True},
    )
    try:
        left = take_snapshot(prod_engine, "production")
    finally:
        prod_engine.dispose()

    base = _local_base_url()
    with ScratchDatabase(base, "mig") as mig:
        build_by_migrations(mig)
        engine = mig.engine()
        try:
            right = take_snapshot(engine, "migrations")
        finally:
            engine.dispose()
    return left, right, diff_snapshots(left, right)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _report(
    left: Snapshot, right: Snapshot, differences: list[Difference], mode: str
) -> None:
    print(f"Schema drift check: {left.label} vs {right.label}")
    print(f"  {left.label}: {len(left.tables)} tables, {len(left.columns)} columns")
    print(f"  {right.label}: {len(right.tables)} tables, {len(right.columns)} columns")

    if mode == "production-vs-migrations" and RLS_IS_REPORTED_NOT_FAILED:
        print(
            f"  row-level security on: {len(left.rls_enabled)} of {len(left.tables)} "
            f"in {left.label}, {len(right.rls_enabled)} of {len(right.tables)} "
            f"in {right.label} (reported, never a failure -- audit finding D10)"
        )

    if not differences:
        print("\nNo drift. The two schemas match.")
        return

    print(f"\n{len(differences)} difference(s):\n")
    for diff in differences:
        print(diff.render(left.label, right.label))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("migrations-vs-models", "production-vs-migrations"),
        default="migrations-vs-models",
        help=(
            "migrations-vs-models (default, CI): does the migration history build "
            "what models.py declares? production-vs-migrations: what does live "
            "production actually have? Read-only against production."
        ),
    )
    parser.add_argument(
        "--against-production",
        action="store_true",
        help="Alias for --mode production-vs-migrations.",
    )
    parser.add_argument(
        "--json", action="store_true", help="Emit the differences as JSON."
    )
    args = parser.parse_args(argv)

    mode = "production-vs-migrations" if args.against_production else args.mode

    if mode == "production-vs-migrations":
        left, right, differences = run_production_vs_migrations()
    else:
        left, right, differences = run_migrations_vs_models()

    if args.json:
        print(
            json.dumps(
                {
                    "mode": mode,
                    "left": left.label,
                    "right": right.label,
                    "differences": [
                        {
                            "category": d.category,
                            "key": d.key,
                            left.label: d.left,
                            right.label: d.right,
                        }
                        for d in differences
                    ],
                },
                indent=2,
            )
        )
    else:
        _report(left, right, differences, mode)

    if not differences:
        return 0

    # The advice below is for a person reading a terminal. Under --json it would
    # be appended after the closing brace, so stdout stops being JSON at exactly
    # the moment there is something to parse -- and the caller that breaks is the
    # post-deploy production check in .github/workflows/migrate.yml, which reads
    # this output to decide whether to file an issue.
    if mode == "production-vs-migrations":
        # Production drift is a finding to read and decide on, not a build to
        # break -- deciding which side is right is a judgement call, and six of
        # the audit's eleven went production's way. Nothing exits non-zero here.
        if not args.json:
            print(
                "\nThese are findings, not failures. Which side is right is a "
                "judgement call -- see docs/operations/production-database-schema-drift.md."
            )
        return 0

    if not args.json:
        print(
            "\nThe migration history and models.py no longer build the same schema.\n"
            "Write the migration that carries your models.py change to an existing\n"
            "database, or correct models.py to match what the migrations build.\n"
            "Background: docs/operations/production-database-schema-drift.md"
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
