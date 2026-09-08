"""Synthetic PostgreSQL evidence for the offline experiment, never speed assertions."""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import replace
from unittest.mock import Mock

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session

from scripts import benchmark_campaign_finance_name_search as bench


@pytest.fixture(scope="session", autouse=True)
def seed_database():
    """This module uses disposable tables, not the suite's migrate-and-empty fixture."""
    yield


@pytest.fixture
def db():
    engine = create_engine(bench.local_url(os.environ["DATABASE_URL"]))
    with Session(engine) as session:
        # CI publishes a disposable Docker database on localhost, but PostgreSQL
        # reports its bridge address. These helper tests are not CLI locality proof.
        assert session.scalar(
            text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_trgm')")
        )
        yield session
        session.rollback()
    engine.dispose()


@pytest.fixture
def corpus(db):
    release = bench.create_synthetic_sources(db, names=205)
    lookup = bench.prepare_lookup(db, release)
    return release, lookup


@pytest.fixture
def collision_db(db):
    """A separate disposable database keeps the collision test off existing tables."""
    database_name = f"alethical_search_boundary_{uuid.uuid4().hex}"
    server = create_engine(db.get_bind().url, isolation_level="AUTOCOMMIT")
    with server.connect() as connection:
        connection.exec_driver_sql(f'CREATE DATABASE "{database_name}"')
    isolated = create_engine(
        server.url.set(database=database_name), hide_parameters=True
    )
    try:
        with Session(isolated) as session:
            session.execute(text("CREATE EXTENSION pg_trgm"))
            yield session
            session.rollback()
    finally:
        isolated.dispose()
        with server.connect() as connection:
            connection.exec_driver_sql(f'DROP DATABASE "{database_name}"')
        server.dispose()


def payment_rows(
    result: bench.current.ResultGroup,
) -> list[bench.current.PaymentNameResult]:
    rows = []
    for row in result.results:
        assert isinstance(row, bench.current.PaymentNameResult)
        rows.append(row)
    return rows


@pytest.mark.parametrize(
    "query",
    [
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
        "    ",
        "école",
    ],
)
@pytest.mark.parametrize("limit", [1, 5, 50])
def test_candidates_preserve_current_answers(db, corpus, query, limit):
    release, lookup = corpus
    for group in bench.GROUPS:
        baseline = bench.search_group(db, release, query, group, "current", limit=limit)
        for variant in ("displayed_counts", "lookup"):
            assert (
                bench.search_group(
                    db, release, query, group, variant, limit=limit, lookup=lookup
                )
                == baseline
            )


@pytest.mark.parametrize("variant", bench.VARIANTS)
def test_exact_spelling_order_duplicate_counts_and_generation(db, corpus, variant):
    release, lookup = corpus
    result = bench.search_group(
        db, release, "smith", bench.GROUPS[0], variant, lookup=lookup
    )
    assert {row.name for row in payment_rows(result)} == {
        "Fixture Smith",
        "Fixture smith",
    }
    assert [row.payment_count for row in payment_rows(result)] == [3, 3]
    assert result.total == 2
    assert not result.has_more
    rare = bench.search_group(
        db, release, "rare", bench.GROUPS[0], variant, lookup=lookup
    )
    assert {row.name for row in payment_rows(rare)} == {
        " Fixture Rare Name ",
        "Fixture Rare Name",
    }
    assert [row.payment_count for row in payment_rows(rare)] == [3, 3]


@pytest.mark.parametrize("variant", bench.VARIANTS)
def test_wildcards_are_literal_and_no_near_spelling_is_added(db, corpus, variant):
    release, lookup = corpus
    for query, expected in [
        ("100%", "Fixture 100% Fund"),
        ("a_b", "Fixture a_b"),
        ("a\\b", "Fixture a\\b"),
        ("O'Name", "Fixture O'Name"),
    ]:
        result = bench.search_group(
            db, release, query, bench.GROUPS[0], variant, lookup=lookup
        )
        assert [row.name for row in payment_rows(result)] == [expected]
        assert payment_rows(result)[0].payment_count == 3
    assert not bench.search_group(
        db, release, "Smth", bench.GROUPS[0], variant, lookup=lookup
    ).results


@pytest.mark.parametrize("count", [0, 199, 200, 201, 202])
def test_exact_and_capped_totals_at_each_boundary(db, count):
    release = bench.create_synthetic_sources(db, names=count)
    lookup = bench.prepare_lookup(db, release)
    for group in bench.GROUPS:
        for variant in bench.VARIANTS:
            result = bench.search_group(
                db, release, "common", group, variant, lookup=lookup
            )
            assert result.total == (count if count <= 200 else None)
            assert result.at_least == (None if count <= 200 else 200)
            assert result.has_more == (count > 5)
            assert len(result.results) == min(count, 5)


def test_each_dataset_keeps_its_own_count(db):
    release = bench.create_synthetic_sources(db, names=0)
    for index, (_, _, dataset, model, column) in enumerate(bench.GROUPS):
        for _ in range(index):
            db.execute(
                text(
                    f"INSERT INTO {model.__tablename__} VALUES (:snapshot, 'Fixture Smith')"
                ),
                {"snapshot": release.file_for(dataset).snapshot_id},
            )
    lookup = bench.prepare_lookup(db, release)
    for index, group in enumerate(bench.GROUPS):
        for variant in bench.VARIANTS:
            result = bench.search_group(
                db, release, "Smith", group, variant, lookup=lookup
            )
            rows = {row.name: row for row in payment_rows(result)}
            assert rows["Fixture Smith"].payment_count == 3 + index
            assert rows["Fixture smith"].payment_count == 3
            assert all(row.role == group[1] for row in rows.values())


def test_missing_release_is_unavailable_not_empty(db):
    for group in bench.GROUPS:
        for variant in bench.VARIANTS:
            result = bench.search_group(db, None, "fixture", group, variant)
            assert result.state == "unavailable"
            assert result.total is None
            assert result.reason == "no_release"


def test_missing_lookup_generation_falls_back_even_if_other_generations_exist(
    db, corpus
):
    release, lookup = corpus
    group = bench.GROUPS[0]
    lookup.ready.remove((release.contributions.snapshot_id, group[2].value))
    db.execute(
        text("DELETE FROM pg_temp.cf_benchmark_name_lookup WHERE dataset=:dataset"),
        {"dataset": group[2].value},
    )
    result = bench.search_group(db, release, "rare", group, "lookup", lookup=lookup)
    assert result == bench.search_group(db, release, "rare", group, "current")
    assert result.total == 2


def test_empty_complete_generation_is_not_missing(db):
    release = bench.create_synthetic_sources(db, names=0)
    empty = replace(release.contributions, snapshot_id=uuid.uuid4(), row_count=0)
    release = replace(release, contributions=empty)
    lookup = bench.prepare_lookup(db, release)
    assert (empty.snapshot_id, bench.GROUPS[0][2].value) in lookup.ready
    result = bench.search_group(
        db, release, "fixture", bench.GROUPS[0], "lookup", lookup=lookup
    )
    assert result.total == 0 and result.state == "not_reported"


def test_incomplete_lookup_never_becomes_ready(db, monkeypatch):
    release = bench.create_synthetic_sources(db, names=0)
    original = db.scalar

    def detect_mismatch(statement, *args, **kwargs):
        if "EXCEPT ALL" in str(statement):
            return True
        return original(statement, *args, **kwargs)

    monkeypatch.setattr(db, "scalar", detect_mismatch)
    with pytest.raises(ValueError, match="lookup_generation_mismatch"):
        bench.prepare_lookup(db, release)


def test_real_count_corruption_is_detected(db):
    release = bench.create_synthetic_sources(db, names=0)
    connection = db.connection()
    changed = False

    def corrupt_after_insert(conn, cursor, statement, parameters, context, executemany):
        nonlocal changed
        if (
            statement.startswith("INSERT INTO pg_temp.cf_benchmark_name_lookup")
            and not changed
        ):
            changed = True
            cursor.execute(
                "UPDATE pg_temp.cf_benchmark_name_lookup SET payments = payments + 1"
            )

    event.listen(connection, "after_cursor_execute", corrupt_after_insert)
    try:
        with pytest.raises(ValueError, match="lookup_generation_mismatch"):
            bench.prepare_lookup(db, release)
    finally:
        event.remove(connection, "after_cursor_execute", corrupt_after_insert)
    assert changed


def test_report_contains_no_names_queries_or_answers(db):
    release = bench.create_synthetic_sources(db, names=0)
    report = bench.compare(db, release, ["Private typed query"], iterations=1)
    printed = json.dumps(report)
    assert "Private typed query" not in printed
    assert "Fixture" not in printed
    assert "results" not in printed
    assert len(report["measurements"]) == 9
    assert report["outputs_equal"]


def test_dry_run_never_connects(monkeypatch, capsys):
    monkeypatch.setattr(
        bench, "create_engine", lambda *args, **kwargs: pytest.fail("connected")
    )
    assert bench.main([]) == 0
    assert json.loads(capsys.readouterr().out)["connects_to_database"] is False


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://remote.example/db",
        "sqlite:///local.db",
        "postgresql://localhost/db?hostaddr=203.0.113.1",
        "postgresql://localhost/db?host=remote.example",
        "postgresql:///db",
    ],
)
def test_remote_or_overridden_connections_are_refused(url):
    with pytest.raises(ValueError):
        bench.local_url(url)


def test_failure_output_does_not_echo_names_or_secrets(monkeypatch, capsys):
    monkeypatch.setenv(bench.DATABASE_ENV, "postgresql://localhost/db")

    def fail(*args, **kwargs):
        raise RuntimeError("Private name and password=secret")

    monkeypatch.setattr(bench, "create_engine", fail)
    assert bench.main(["--execute"]) == 1
    printed = capsys.readouterr().out
    assert "Private" not in printed and "secret" not in printed
    assert json.loads(printed)["completed"] is False


def test_temporary_source_and_lookup_tables_disappear_on_rollback(db):
    release = bench.create_synthetic_sources(db, names=0)
    bench.prepare_lookup(db, release)
    db.rollback()
    for table in [
        "cf_benchmark_name_lookup",
        *(group[3].__tablename__ for group in bench.GROUPS),
    ]:
        assert (
            db.scalar(text("SELECT to_regclass(:name)"), {"name": f"pg_temp.{table}"})
            is None
        )


def test_public_first_path_never_changes_existing_relations(collision_db):
    db = collision_db
    files = []
    for _, _, dataset, model, column in bench.GROUPS:
        table = f"public.{model.__tablename__}"
        db.execute(text(f"CREATE TABLE {table} (snapshot_id uuid, {column.key} text)"))
        snapshot = uuid.uuid4()
        db.execute(
            text(
                f"INSERT INTO {table} VALUES (:snapshot, 'Existing accepted fixture')"
            ),
            {"snapshot": snapshot},
        )
        files.append(
            bench.SourceFile(
                dataset, snapshot, "https://example.invalid/accepted-fixture", 1
            )
        )
    db.execute(text("CREATE TABLE public.cf_benchmark_name_lookup (name text)"))
    db.execute(
        text(
            "INSERT INTO public.cf_benchmark_name_lookup VALUES ('Existing lookup fixture')"
        )
    )
    db.commit()

    def public_state():
        values = [
            db.execute(
                text(
                    "SELECT relname, reltuples FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace "
                    "WHERE n.nspname='public' ORDER BY relname"
                )
            ).all()
        ]
        for _, _, _, model, _ in bench.GROUPS:
            values.append(
                db.execute(text(f"SELECT * FROM public.{model.__tablename__}")).all()
            )
        values.append(
            db.execute(text("SELECT * FROM public.cf_benchmark_name_lookup")).all()
        )
        return values

    original = public_state()
    db.execute(text("SET LOCAL search_path = public, pg_temp"))
    accepted = bench.Release(uuid.uuid4(), bench.datetime.now(bench.UTC), *files)
    lookup = bench.prepare_lookup(db, accepted)
    assert db.scalar(text("SHOW search_path")) == "public, pg_temp"
    for group in bench.GROUPS:
        for variant in bench.VARIANTS:
            answer = bench.search_group(
                db, accepted, "Existing", group, variant, lookup=lookup
            )
            assert [row.name for row in payment_rows(answer)] == [
                "Existing accepted fixture"
            ]
    assert public_state() == original
    db.rollback()

    db.execute(text("SET LOCAL search_path = public, pg_temp"))
    synthetic = bench.create_synthetic_sources(db, names=0)
    lookup = bench.prepare_lookup(db, synthetic)
    for group in bench.GROUPS:
        for variant in bench.VARIANTS:
            answer = bench.search_group(
                db, synthetic, "rare", group, variant, lookup=lookup
            )
            assert {row.name for row in payment_rows(answer)} == {
                " Fixture Rare Name ",
                "Fixture Rare Name",
            }
    assert public_state() == original


def test_short_queries_never_read_payment_rows(db, monkeypatch):
    monkeypatch.setattr(db, "execute", lambda *args, **kwargs: pytest.fail("queried"))
    for variant in bench.VARIANTS:
        answer = bench.search_group(db, None, " ab ", bench.GROUPS[0], variant)
        assert answer.reason == "query_too_short" and not answer.results


def test_accepted_run_requires_private_query_set_before_connecting(monkeypatch, capsys):
    monkeypatch.setattr(
        bench, "create_engine", lambda *args, **kwargs: pytest.fail("connected")
    )
    assert bench.main(["--execute", "--source", "accepted"]) == 1
    assert json.loads(capsys.readouterr().out)["completed"] is False


@pytest.mark.parametrize("contents", [["Private query"], ["x" * 201] * 14, [3] * 14])
def test_bad_query_sets_are_refused_before_connecting(
    monkeypatch, capsys, tmp_path, contents
):
    path = tmp_path / "private-queries.json"
    path.write_text(json.dumps(contents))
    monkeypatch.setattr(
        bench, "create_engine", lambda *args, **kwargs: pytest.fail("connected")
    )
    assert bench.main(["--execute", "--queries-file", str(path)]) == 1
    assert json.loads(capsys.readouterr().out)["completed"] is False


def test_query_file_is_read_with_a_byte_limit(monkeypatch, tmp_path):
    class BoundedFile:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, size):
            assert size == bench.MAX_QUERY_FILE_BYTES + 1
            return b"x" * size

    monkeypatch.setattr(bench.Path, "open", lambda *args, **kwargs: BoundedFile())
    with pytest.raises(ValueError, match="query_file_too_large"):
        bench.read_queries(tmp_path / "private-queries.json")


def test_budget_expires_before_the_next_statement(monkeypatch, capsys):
    monkeypatch.setenv(bench.DATABASE_ENV, os.environ["DATABASE_URL"])
    clock_values = iter([0.0, 2.0])
    monkeypatch.setattr(bench.time, "monotonic", lambda: next(clock_values, 2.0))
    assert bench.main(["--execute", "--seconds", "1"]) == 1
    assert json.loads(capsys.readouterr().out)["error_type"] == "TimeoutError"


@pytest.mark.parametrize("missing", [False, True])
def test_accepted_source_metadata_must_be_complete(
    monkeypatch, capsys, tmp_path, missing
):
    path = tmp_path / "private-queries.json"
    path.write_text(json.dumps(list(bench.SYNTHETIC_QUERIES)))
    monkeypatch.setenv(bench.DATABASE_ENV, os.environ["DATABASE_URL"])
    # Exercise source-completeness handling in CI's disposable Docker database.
    # The real CLI locality guard remains strict and has separate direct tests.
    monkeypatch.setattr(
        bench,
        "check_server",
        lambda db: {"postgres_version": "test adapter", "collation": "C"},
    )
    source_returned = False

    def source(db):
        nonlocal source_returned
        if missing:
            source_returned = True
            return None
        release = bench.create_synthetic_sources(db, names=0)
        source_returned = True
        return replace(
            release, contributions=replace(release.contributions, row_count=999)
        )

    monkeypatch.setattr(bench, "live_release", source)
    monkeypatch.setattr(
        bench,
        "compare",
        lambda *args, **kwargs: pytest.fail("compared incomplete release"),
    )
    assert (
        bench.main(["--execute", "--source", "accepted", "--queries-file", str(path)])
        == 1
    )
    assert source_returned
    report = json.loads(capsys.readouterr().out)
    assert report["completed"] is False and report["error_type"] == "ValueError"


@pytest.mark.parametrize("address", ["127.0.0.1", "127.0.0.1/32", "::1", "::1/128"])
def test_real_cli_server_guard_accepts_loopback(address):
    db = Mock(spec=Session)
    db.execute.return_value.one.return_value = (address, "PostgreSQL fixture", "C")
    db.scalar.return_value = True
    assert bench.check_server(db) == {
        "postgres_version": "PostgreSQL fixture",
        "collation": "C",
    }


@pytest.mark.parametrize("address", ["172.18.0.2/32", "203.0.113.1/32", None])
def test_real_cli_server_guard_refuses_non_loopback(address):
    db = Mock(spec=Session)
    db.execute.return_value.one.return_value = (address, "PostgreSQL fixture", "C")
    with pytest.raises(ValueError, match="loopback_server_required"):
        bench.check_server(db)
    db.scalar.assert_not_called()


def test_real_cli_server_guard_refuses_missing_trigram_extension():
    db = Mock(spec=Session)
    db.execute.return_value.one.return_value = ("127.0.0.1", "PostgreSQL fixture", "C")
    db.scalar.return_value = False
    with pytest.raises(ValueError, match="local_pg_trgm_required"):
        bench.check_server(db)
