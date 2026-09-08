"""Compare exact-name query shapes offline, without changing the live reader.

Net: this experiment compares the current search with 2 alternatives and refuses
different answers. Temporary tables disappear on rollback. Printed reports contain
query numbers and timings, never names, queries, database URLs, or query plans.
See docs/operations/name-search-offline-benchmark.md for the evidence limits.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict

from sqlalchemy import Column, MetaData, Table, Text, BigInteger, Uuid
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alethical.api.services import campaign_finance_search as current
from alethical.api.services.campaign_finance_register import name_contains
from alethical.pipeline.campaign_finance_reader import Release, SourceFile, live_release

GROUPS = current._NAME_GROUPS
VARIANTS = ("current", "displayed_counts", "lookup")
DATABASE_ENV = "ALETHICAL_SEARCH_BENCHMARK_DATABASE_URL"
# These are synthetic exercise cases, not the unrecovered original 14-query set.
SYNTHETIC_QUERIES = (
    "a",
    "ab",
    "fixture",
    "common",
    "rare",
    "absent",
    "EDUCATION",
    "Smith",
    "100%",
    "a_b",
    "a\\b",
    "O'Name",
    "mar",
    "   rare   ",
)
LOOKUP = Table(
    "cf_benchmark_name_lookup",
    MetaData(),
    Column("snapshot_id", Uuid, primary_key=True),
    Column("dataset", Text, primary_key=True),
    Column("name", Text, primary_key=True),
    Column("payments", BigInteger, nullable=False),
    schema="pg_temp",
)


@dataclass
class Lookup:
    # An empty completed generation differs from one that was never built.
    ready: set[tuple[uuid.UUID, str]] = field(default_factory=set)
    build_ms: dict[str, float] = field(default_factory=dict)


class Measurement(TypedDict):
    query_number: int
    dataset: str
    variant: str
    samples_ms: list[float]
    median_ms: float
    worst_ms: float


def local_url(value: str) -> str:
    """Require an explicit loopback URL; forbid driver options overriding its host."""
    url = make_url(value)
    if (
        url.drivername not in {"postgresql", "postgresql+psycopg"}
        or url.host not in {"localhost", "127.0.0.1", "::1"}
        or not url.database
        or url.query
    ):
        raise ValueError("local_database_required")
    return url.set(drivername="postgresql+psycopg").render_as_string(
        hide_password=False
    )


def check_server(db: Session) -> dict:
    row = db.execute(
        text(
            "SELECT inet_server_addr()::text, version(), datcollate "
            "FROM pg_database WHERE datname = current_database()"
        )
    ).one()
    if row[0] not in {"127.0.0.1/32", "127.0.0.1", "::1/128", "::1"}:
        raise ValueError("loopback_server_required")
    if not db.scalar(
        text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_trgm')")
    ):
        raise ValueError("local_pg_trgm_required")
    return {"postgres_version": row[1], "collation": row[2]}


def create_synthetic_sources(db: Session, *, names: int = 450) -> Release:
    """Shadow source tables with synthetic rows in this connection only."""
    files = []
    fixtures = [
        "Fixture Rare Name",
        "Fixture Smith",
        "Fixture smith",
        "Fixture Education",
        "Fixture 100% Fund",
        "Fixture a_b",
        "Fixture axb",
        "Fixture a\\b",
        "Fixture O'Name",
        " Fixture Rare Name ",
        None,
    ]
    for _, _, dataset, model, column in GROUPS:
        table, name = model.__tablename__, column.key
        db.execute(
            text(
                f"CREATE TEMP TABLE {table} (snapshot_id uuid, {name} text) ON COMMIT DROP"
            )
        )
        snapshot = uuid.uuid4()
        values = fixtures + [
            f"Fixture Common mar {index:06d}" for index in range(names)
        ]
        rows = [
            {"snapshot": snapshot, "name": name_value}
            for name_value in values
            for _ in range(3)
        ]
        # Another generation must never contaminate either count or name discovery.
        rows.append({"snapshot": uuid.uuid4(), "name": "Fixture Rare Other Generation"})
        db.execute(text(f"INSERT INTO {table} VALUES (:snapshot, :name)"), rows)
        if dataset != current.Dataset.independent_expenditures:
            db.execute(text(f"CREATE INDEX ON {table} (snapshot_id, {name})"))
            db.execute(text(f"CREATE INDEX ON {table} USING gin ({name} gin_trgm_ops)"))
        db.execute(text(f"ANALYZE {table}"))
        files.append(
            SourceFile(
                dataset, snapshot, "https://example.invalid/synthetic", len(rows) - 1
            )
        )
    return Release(uuid.uuid4(), datetime.now(UTC), *files)


def prepare_lookup(db: Session, release: Release) -> Lookup:
    """Build and independently compare complete generations before marking them ready."""
    db.execute(
        text("""
        CREATE TEMP TABLE cf_benchmark_name_lookup (
            snapshot_id uuid NOT NULL, dataset text NOT NULL, name text NOT NULL,
            payments bigint NOT NULL, PRIMARY KEY (snapshot_id, dataset, name)
        ) ON COMMIT DROP
    """)
    )
    result = Lookup()
    for _, _, dataset, model, column in GROUPS:
        snapshot = release.file_for(dataset).snapshot_id
        started = time.perf_counter()
        db.execute(
            LOOKUP.insert().from_select(
                ["snapshot_id", "dataset", "name", "payments"],
                select(model.snapshot_id, text(":dataset"), column, func.count())
                .where(model.snapshot_id == snapshot, column.is_not(None))
                .group_by(model.snapshot_id, column),
            ),
            {"dataset": dataset.value},
        )
        result.build_ms[dataset.value] = (time.perf_counter() - started) * 1000
        # Separate SQL grouping and bidirectional EXCEPT compare every name/count.
        source = f"SELECT {column.key} AS name, count(*) AS payments FROM {model.__tablename__} WHERE snapshot_id=:snapshot AND {column.key} IS NOT NULL GROUP BY {column.key}"
        derived = "SELECT name, payments FROM pg_temp.cf_benchmark_name_lookup WHERE snapshot_id=:snapshot AND dataset=:dataset"
        differs = db.scalar(
            text(
                f"SELECT EXISTS (({source} EXCEPT ALL {derived}) UNION ALL ({derived} EXCEPT ALL {source}))"
            ),
            {"snapshot": snapshot, "dataset": dataset.value},
        )
        if differs:
            raise ValueError("lookup_generation_mismatch")
        result.ready.add((snapshot, dataset.value))
    started = time.perf_counter()
    db.execute(
        text("CREATE INDEX ON cf_benchmark_name_lookup USING gin (name gin_trgm_ops)")
    )
    db.execute(text("ANALYZE cf_benchmark_name_lookup"))
    result.build_ms["index_and_statistics"] = (time.perf_counter() - started) * 1000
    return result


def _answer(kind: str, role: str, rows) -> current.ResultGroup:
    counted = int(rows[0].counted) if rows else 0
    capped = counted > current.COUNTED_UP_TO
    return current.ResultGroup(
        kind=kind,
        state=current.REPORTED if rows else current.NOT_REPORTED,
        results=tuple(
            current.PaymentNameResult(row.name, role, row.payments) for row in rows
        ),
        total=None if capped else counted,
        at_least=current.COUNTED_UP_TO if capped else None,
        has_more=False,
        reason=None,
    )


def search_group(
    db: Session,
    release: Release | None,
    query: str,
    group: tuple,
    variant: str,
    *,
    limit: int = 5,
    lookup: Lookup | None = None,
) -> current.ResultGroup:
    """Compare the payment-name groups; people/register search stays outside scope."""
    kind, role, dataset, model, column = group
    typed = query.strip()
    if not 1 <= limit <= current.MAX_PER_GROUP or variant not in VARIANTS:
        raise ValueError("invalid_search_parameters")
    if len(typed) < current.MIN_QUERY_LENGTH:
        return current._empty_group(
            kind, state=current.UNAVAILABLE, reason=current.QUERY_TOO_SHORT
        )
    if (
        release is None
        or variant == "current"
        or (
            variant == "lookup"
            and (
                lookup is None
                or (release.file_for(dataset).snapshot_id, dataset.value)
                not in lookup.ready
            )
        )
    ):
        return current._name_group(
            db,
            release,
            typed,
            limit=limit,
            kind=kind,
            role=role,
            dataset=dataset,
            model=model,
            column=column,
        )
    snapshot = release.file_for(dataset).snapshot_id
    if variant == "displayed_counts":
        names = (
            select(column.label("name"))
            .where(
                model.snapshot_id == snapshot,
                column.is_not(None),
                name_contains(column, typed),
            )
            .distinct()
            .order_by(column)
            .limit(current.COUNTED_UP_TO + 1)
            .cte("candidate_names")
        )
        counted = select(func.count()).select_from(names).scalar_subquery()
        shown = select(names.c.name).order_by(names.c.name).limit(limit).cte("shown")
        payments = (
            select(func.count())
            .where(model.snapshot_id == snapshot, column == shown.c.name)
            .correlate(shown)
            .scalar_subquery()
        )
        stmt = select(
            shown.c.name, payments.label("payments"), counted.label("counted")
        ).order_by(shown.c.name)
    else:
        names = (
            select(LOOKUP.c.name, LOOKUP.c.payments)
            .where(
                LOOKUP.c.snapshot_id == snapshot,
                LOOKUP.c.dataset == dataset.value,
                name_contains(LOOKUP.c.name, typed),
            )
            .order_by(LOOKUP.c.name)
            .limit(current.COUNTED_UP_TO + 1)
            .cte("candidate_names")
        )
        counted = select(func.count()).select_from(names).scalar_subquery()
        stmt = (
            select(names.c.name, names.c.payments, counted.label("counted"))
            .order_by(names.c.name)
            .limit(limit)
        )
    rows = db.execute(stmt).all()
    answer = _answer(kind, role, rows)
    return current.ResultGroup(
        kind=answer.kind,
        state=answer.state,
        results=answer.results[:limit],
        total=answer.total,
        at_least=answer.at_least,
        has_more=bool(rows) and int(rows[0].counted) > limit,
        reason=answer.reason,
    )


def compare(
    db: Session,
    release: Release,
    queries: list[str],
    *,
    iterations: int = 5,
    limit: int = 5,
) -> dict:
    started = time.perf_counter()
    lookup = prepare_lookup(db, release)
    preparation_ms = (time.perf_counter() - started) * 1000
    measurements: list[Measurement] = []
    for query_number, query in enumerate(queries, 1):
        for group in GROUPS:
            baseline = search_group(db, release, query, group, "current", limit=limit)
            timings: dict[str, list[float]] = {variant: [] for variant in VARIANTS}
            # 1 warmup per shape; rotate order on every repetition to reduce order bias.
            for repetition in range(iterations + 1):
                order = VARIANTS[repetition % 3 :] + VARIANTS[: repetition % 3]
                for variant in order:
                    before = time.perf_counter()
                    answer = search_group(
                        db, release, query, group, variant, limit=limit, lookup=lookup
                    )
                    elapsed = (time.perf_counter() - before) * 1000
                    if answer != baseline:
                        # Do not print the mismatch: either side can contain private names.
                        raise ValueError("search_answer_mismatch")
                    if repetition:
                        timings[variant].append(elapsed)
            for variant, samples in timings.items():
                measurements.append(
                    {
                        "query_number": query_number,
                        "dataset": group[2].value,
                        "variant": variant,
                        "samples_ms": samples,
                        "median_ms": statistics.median(samples),
                        "worst_ms": max(samples),
                    }
                )
    return {
        "outputs_equal": True,
        "lookup_preparation_ms": preparation_ms,
        "lookup_build_ms": lookup.build_ms,
        "measurements": measurements,
        "summary": {
            variant: {
                "sum_of_case_medians_ms": sum(
                    row["median_ms"]
                    for row in measurements
                    if row["variant"] == variant
                ),
                "worst_case_median_ms": max(
                    row["median_ms"]
                    for row in measurements
                    if row["variant"] == variant
                ),
                "worst_observation_ms": max(
                    row["worst_ms"] for row in measurements if row["variant"] == variant
                ),
            }
            for variant in VARIANTS
        },
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument(
        "--execute",
        action="store_true",
        help="Run on an explicit local database; default prints the plan",
    )
    result.add_argument(
        "--source", choices=("synthetic", "accepted"), default="synthetic"
    )
    result.add_argument(
        "--queries-file",
        type=Path,
        help="Local JSON array of 14 strings; strings are never reported",
    )
    result.add_argument("--iterations", type=int, choices=range(1, 21), default=5)
    result.add_argument("--seconds", type=int, choices=range(1, 301), default=60)
    result.add_argument(
        "--limit", type=int, choices=range(1, current.MAX_PER_GROUP + 1), default=5
    )
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if not args.execute:
        print(
            json.dumps(
                {
                    "mode": "dry_run",
                    "connects_to_database": False,
                    "source": args.source,
                    "variants": VARIANTS,
                    "query_count": 14,
                    "iterations": args.iterations,
                    "deadline_seconds": args.seconds,
                    "database_environment_variable": DATABASE_ENV,
                    "production_changes": False,
                }
            )
        )
        return 0
    try:
        queries = (
            json.loads(args.queries_file.read_text())
            if args.queries_file
            else list(SYNTHETIC_QUERIES)
        )
        if args.source == "accepted" and not args.queries_file:
            raise ValueError("original_query_set_required")
        if (
            not isinstance(queries, list)
            or len(queries) != 14
            or any(
                not isinstance(query, str) or not 1 <= len(query) <= 200
                for query in queries
            )
        ):
            raise ValueError("fourteen_bounded_queries_required")
        url = local_url(os.environ.get(DATABASE_ENV, ""))
        engine = create_engine(
            url,
            isolation_level="REPEATABLE READ",
            hide_parameters=True,
            connect_args={"connect_timeout": 5},
        )
        deadline = time.monotonic() + args.seconds

        @event.listens_for(engine, "before_cursor_execute")
        def bound_statement(conn, cursor, statement, parameters, context, executemany):
            remaining = int((deadline - time.monotonic()) * 1000)
            if remaining <= 0:
                raise TimeoutError("benchmark_deadline")
            cursor.execute(f"SET LOCAL statement_timeout = {min(remaining, 10000)}")
            cursor.execute("SET LOCAL lock_timeout = 1000")

        try:
            with Session(engine) as db:
                metadata = check_server(db)
                release = (
                    create_synthetic_sources(db)
                    if args.source == "synthetic"
                    else live_release(db)
                )
                if release is None:
                    raise ValueError("accepted_release_required")
                source_rows = {}
                for _, _, dataset, model, _ in GROUPS:
                    source = release.file_for(dataset)
                    count = db.scalar(
                        select(func.count())
                        .select_from(model)
                        .where(model.snapshot_id == source.snapshot_id)
                    )
                    if count != source.row_count:
                        raise ValueError("source_generation_incomplete")
                    source_rows[dataset.value] = count
                report = compare(
                    db, release, queries, iterations=args.iterations, limit=args.limit
                )
                report.update(
                    metadata,
                    source=args.source,
                    source_rows=source_rows,
                    release_id=str(release.id),
                    snapshots={
                        dataset.value: str(release.file_for(dataset).snapshot_id)
                        for _, _, dataset, _, _ in GROUPS
                    },
                    evidence="synthetic_correctness_only"
                    if args.source == "synthetic"
                    else "local_copy_warm_query_comparison",
                    live_speed_gain_established=False,
                    iterations=args.iterations,
                    query_count=len(queries),
                    limit=args.limit,
                )
                db.rollback()
        finally:
            engine.dispose()
        print(json.dumps(report, sort_keys=True))
        return 0
    except Exception as exc:
        # SQL exceptions can echo bind parameters and real filed names. No traceback.
        print(
            json.dumps(
                {
                    "completed": False,
                    "error_type": type(exc).__name__,
                    "detail": "No result published; inspect local prerequisites and bounds.",
                }
            )
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
