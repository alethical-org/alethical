"""Real source names and failure cases keep paired lobbying releases honest."""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path

import pytest
from sqlalchemy import func, select, text

from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline import lobbying_expenditures as spending
from alethical.pipeline import lobbying_registrations as lob
from alethical.tests.test_lobbying_load import MemoryStore, LOBBYING_ROWS, csv_bytes

FIXTURE = Path(__file__).parent / "fixtures/lobbying/active-list-safe-2026-09-13.json"


def active_body(rows=None):
    rows = rows if rows is not None else json.loads(FIXTURE.read_text())
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=lob.HEADER)
    writer.writeheader()
    for row in rows:
        # Deliberately private-looking fixture values must not survive parsing.
        writer.writerow(
            {
                **{name: "" for name in lob.HEADER},
                **row,
                "Street": "DO NOT STORE STREET",
                "City": "DO NOT STORE CITY",
                "State": "DO NOT STORE STATE",
                "Zip Code": "DO NOT STORE ZIP",
                "Telephone": "DO NOT STORE PHONE",
                "Email Address": "DO NOT STORE EMAIL",
            }
        )
    return output.getvalue().encode()


def test_real_rows_parse_141_and_86_associations_without_contacts():
    parsed = lob.parse_active_list(active_body())
    assert parsed.errors == []
    assert parsed.unparsed_association_count == 0
    assert parsed.row_count == 2
    assert (
        next(row for row in parsed.lobbyists if row["registration_number"] == "141")[
            "name"
        ]
        == "Kozak, Andrew"
    )
    assert (
        len(
            [row for row in parsed.associations if row["registration_number"] == "9865"]
        )
        == 86
    )
    serialized = json.dumps(parsed.safe_json())
    assert "DO NOT STORE" not in serialized
    for field in (
        "Street",
        "City",
        "State",
        "Zip Code",
        "Telephone",
        "Email Address",
        "Suffix",
    ):
        assert f'"{field}":' not in serialized
    assert {c.name for c in models.LobbyistRow.__table__.columns} == {
        "snapshot_id",
        "registration_number",
        "name",
        "formatted_name",
        "first_name",
        "middle_initial",
        "last_name",
    }


@pytest.mark.parametrize(
    "associations, count",
    [
        ("(14) Valid; broken; ", 1),
        ("(14) Valid; ; (60) Another;", 1),
        ("", 1),
        ("(no) Invalid; (0) Invalid;", 2),
    ],
)
def test_malformed_associations_are_counted_and_block_even_with_hash(
    associations, count
):
    row = json.loads(FIXTURE.read_text())[0]
    row["Associations"] = associations
    parsed = lob.parse_active_list(active_body([row]))
    assert parsed.unparsed_association_count == count
    checks = lob.validate_active(parsed, None, parsed.record_set_hash)
    assert next(
        c for c in checks if c.name == "active_associations_parse_completely"
    ).blocks_publication


def test_registration_duplicates_and_empty_file_cannot_be_approved():
    row = json.loads(FIXTURE.read_text())[0]
    parsed = lob.parse_active_list(active_body([row, row]))
    assert parsed.duplicate_registration_count == 1
    assert any(
        c.blocks_publication
        for c in lob.validate_active(parsed, None, parsed.record_set_hash)
    )
    empty = lob.parse_active_list(active_body([]))
    assert any(
        c.blocks_publication
        for c in lob.validate_active(empty, None, empty.record_set_hash)
    )


def test_safe_hash_ignores_order_and_contact_changes():
    rows = json.loads(FIXTURE.read_text())
    first = lob.parse_active_list(active_body(rows))
    second = lob.parse_active_list(
        active_body(rows[::-1]).replace(b"DO NOT STORE EMAIL", b"A DIFFERENT CONTACT")
    )
    assert first.content_hash != second.content_hash
    assert first.record_set_hash == second.record_set_hash


class FakeResponse:
    def __init__(self, body, url, filename=None):
        self.content = body
        self.url = url
        self.status_code = 200
        self.headers = (
            {"Content-Disposition": f'attachment; filename="{filename}"'}
            if filename
            else {"Content-Type": "text/html; charset=utf-8"}
        )
        self.encoding = "utf-8"

    @property
    def text(self):
        return self.content.decode()

    def raise_for_status(self):
        pass

    def close(self):
        pass

    def iter_content(self, chunk_size):
        yield self.content


class PairBoard:
    def __init__(self):
        self.active = active_body()
        self.spending = csv_bytes(LOBBYING_ROWS)
        self.ids = ["-123", "-456"]
        self.requests = []

    def get(self, url, **kwargs):
        self.requests.append(url)
        if url.endswith("/landing"):
            page = (
                "<h1>Lobbyist Information</h1><table><tr><td>Active Lobbyists</td>"
                f'<td><a href="?download={self.ids[0]}">csv</a></td></tr></table>'
                "<h1>Principal expenditures</h1><table><tr><td>Principal expenditures - 2009 - Present</td>"
                f'<td><a href="?download={self.ids[1]}">csv</a></td></tr></table>'
            )
            return FakeResponse(page.encode(), url)
        if url.endswith(self.ids[0]):
            return FakeResponse(
                self.active,
                url,
                "Active Lobbyists - Lobbyist Information - Lobbying.csv",
            )
        if url.endswith(self.ids[1]):
            return FakeResponse(
                self.spending,
                url,
                "Principal Expenditures - 2009 - Present - Lobbying.csv",
            )
        return FakeResponse(b"<html>Not a file</html>", url)


def clear(db):
    db.rollback()
    db.execute(text("DELETE FROM lobbying_current_release"))
    db.execute(text("DELETE FROM lobbying_release"))
    db.execute(text("DELETE FROM lobbyist_snapshot"))
    db.execute(text("UPDATE lobbying_expenditure_current SET snapshot_id = NULL"))
    db.execute(text("DELETE FROM lobbying_fetch_observation"))
    db.execute(text("DELETE FROM lobbying_expenditure_snapshot"))
    db.commit()


@pytest.fixture
def db(seed_database):
    session = get_session_factory()()
    clear(session)
    yield session
    clear(session)
    session.close()


def run(db, board, store, **kwargs):
    return lob.load_lobbying(
        db,
        http=board,
        store=store,
        landing_page="http://board/landing",
        log=lambda _: None,
        **kwargs,
    )


def first_publish(db, board, store):
    preview = run(db, board, store, dry_run=True)
    return run(
        db,
        board,
        store,
        publish_hash=preview.expenditure.measurements.record_set_hash,
        publish_lobbyist_hash=preview.active.record_set_hash,
    )


def test_dry_run_does_not_write_database_or_object_store(db):
    store = MemoryStore()
    report = run(db, PairBoard(), store, dry_run=True)
    assert report.refusal
    assert not report.published
    assert db.scalar(select(func.count()).select_from(models.LobbyingRelease)) == 0
    assert db.scalar(select(func.count()).select_from(models.LobbyistSnapshot)) == 0
    assert (
        db.scalar(select(func.count()).select_from(models.LobbyingExpenditureSnapshot))
        == 0
    )
    assert store.objects == {}


def test_publish_two_copies_then_unchanged_copy_gets_one_new_date(db):
    board, store = PairBoard(), MemoryStore()
    first = first_publish(db, board, store)
    assert first.published
    initial = lob.live_release(db)
    board.ids = ["-999", "-888"]
    second = run(db, board, store)
    current = lob.live_release(db)
    assert second.published
    assert current.id != initial.id
    assert current.copied_at > initial.copied_at
    assert current.expenditure_snapshot_id == initial.expenditure_snapshot_id
    assert current.lobbyist_snapshot_id != initial.lobbyist_snapshot_id
    assert board.requests[-1].endswith("-888")
    assert len(store.objects) == 1  # Only the original spending file is stored.
    assert not any("lobbyist" in key for key in store.objects)
    assert (
        db.scalar(
            select(func.count())
            .select_from(models.LobbyistRow)
            .where(models.LobbyistRow.snapshot_id == current.lobbyist_snapshot_id)
        )
        == 2
    )


def test_bad_active_copy_preserves_both_pointers_and_records_unparsed_count(db):
    board, store = PairBoard(), MemoryStore()
    first = first_publish(db, board, store)
    current = lob.live_release(db)
    board.active = board.active.replace(b"(2263)", b"(bad)")
    failed = run(db, board, store)
    assert failed.refusal and not failed.published
    assert lob.live_release(db).id == first.release_id
    assert spending.live_snapshot(db).id == current.expenditure_snapshot_id
    newest = db.scalars(
        select(models.LobbyistSnapshot).order_by(
            models.LobbyistSnapshot.fetch_completed_at.desc()
        )
    ).first()
    assert newest.unparsed_association_count > 0
    assert newest.status == models.CampaignFinanceSnapshotStatus.quarantined


def test_bad_spending_copy_preserves_both_pointers(db):
    board, store = PairBoard(), MemoryStore()
    first = first_publish(db, board, store)
    board.spending = b"<html>the Board is temporarily unavailable</html>"
    failed = run(db, board, store)
    assert failed.refusal and lob.live_release(db).id == first.release_id


def test_pair_write_failure_rolls_back_expenditure_pointer(db, monkeypatch):
    board, store = PairBoard(), MemoryStore()
    first_publish(db, board, store)
    before = lob.live_release(db)
    board.spending = board.spending.replace(b"38500.0000", b"38501.0000")
    original = db.execute

    def failing(statement, *args, **kwargs):
        if str(statement).startswith("INSERT INTO lobbyist_association"):
            raise RuntimeError("simulated pair write failure")
        return original(statement, *args, **kwargs)

    monkeypatch.setattr(db, "execute", failing)
    with pytest.raises(RuntimeError, match="simulated"):
        run(db, board, store)
    assert lob.live_release(db).id == before.id
    assert spending.live_snapshot(db).id == before.expenditure_snapshot_id


def test_previous_pair_can_be_restored_with_original_date(db):
    board, store = PairBoard(), MemoryStore()
    first_publish(db, board, store)
    before = lob.live_release(db)
    run(db, board, store)
    restored = lob.restore_release(db, before.id)
    assert lob.live_release(db).id == before.id
    assert restored.copied_at == before.copied_at
    assert spending.live_snapshot(db).id == before.expenditure_snapshot_id


def test_first_list_and_row_loss_require_reviewed_hash(db):
    board, store = PairBoard(), MemoryStore()
    initial = run(db, board, store)
    assert initial.refusal and lob.live_release(db) is None
    first_publish(db, board, store)
    board.active = active_body(json.loads(FIXTURE.read_text())[:1])
    lost = run(db, board, store)
    assert lost.refusal
    assert next(
        c for c in lost.checks if c.name == "active_row_count_within_band"
    ).blocks_publication


def test_newer_pair_refuses_older_run_without_moving_either_pointer(db):
    from datetime import UTC, datetime, timedelta

    board, store = PairBoard(), MemoryStore()
    first_publish(db, board, store)
    current = lob.live_release(db)
    current.fetch_started_at = datetime.now(UTC) + timedelta(hours=1)
    db.commit()
    with pytest.raises(spending.LobbyingRefusal, match="newer paired"):
        run(db, board, store)
    assert lob.live_release(db).id == current.id
    assert spending.live_snapshot(db).id == current.expenditure_snapshot_id


def test_pruned_active_pair_cannot_be_restored_and_retained_pair_can(db):
    board, store = PairBoard(), MemoryStore()
    first_publish(db, board, store)
    oldest = lob.live_release(db)
    run(db, board, store)
    previous = lob.live_release(db)
    run(db, board, store)
    current = lob.live_release(db)
    assert (
        db.get(models.LobbyistSnapshot, oldest.lobbyist_snapshot_id).status
        == models.CampaignFinanceSnapshotStatus.pruned
    )
    with pytest.raises(spending.LobbyingRefusal, match="complete row sets"):
        lob.restore_release(db, oldest.id)
    db.rollback()
    assert lob.live_release(db).id == current.id
    assert lob.restore_release(db, previous.id).id == previous.id


def test_legacy_spending_refresh_cannot_prune_public_pair_or_original_bytes(db):
    board, store = PairBoard(), MemoryStore()
    first_publish(db, board, store)
    paired = lob.live_release(db)
    original_keys = set(store.objects)
    for amount in (38501, 38502, 38503, 38504):
        board.spending = csv_bytes(LOBBYING_ROWS).replace(
            b"38500.0000", f"{amount}.0000".encode()
        )
        report = spending.load_lobbying_expenditures(
            db,
            http=board,
            store=store,
            landing_page="http://board/landing",
            log=lambda _: None,
        )
        assert report.published
    assert lob.live_release(db).id == paired.id
    assert spending.live_snapshot(db).id != paired.expenditure_snapshot_id
    assert spending.rows_present(db, paired.expenditure_snapshot_id) == len(
        LOBBYING_ROWS
    )
    assert original_keys <= set(store.objects)


def test_rollback_then_publish_preserves_the_pair_actually_replaced(db):
    board, store = PairBoard(), MemoryStore()
    first_publish(db, board, store)  # A
    board.spending = csv_bytes(LOBBYING_ROWS).replace(b"38500.0000", b"38501.0000")
    run(db, board, store)  # B
    restored = lob.live_release(db)
    before_bytes = dict(store.objects)
    board.spending = csv_bytes(LOBBYING_ROWS).replace(b"38500.0000", b"38502.0000")
    run(db, board, store)  # C
    lob.restore_release(db, restored.id)  # B is now current again.
    board.spending = csv_bytes(LOBBYING_ROWS).replace(b"38500.0000", b"38503.0000")
    run(db, board, store)  # D must preserve B, not newer-by-date C.
    current = lob.live_release(db)
    assert current.previous_release_id == restored.id
    assert (
        db.scalar(
            select(func.count())
            .select_from(models.LobbyistRow)
            .where(models.LobbyistRow.snapshot_id == restored.lobbyist_snapshot_id)
        )
        == 2
    )
    assert (
        db.scalar(
            select(func.count())
            .select_from(models.LobbyistAssociation)
            .where(
                models.LobbyistAssociation.snapshot_id == restored.lobbyist_snapshot_id
            )
        )
        == 99
    )
    assert spending.rows_present(db, restored.expenditure_snapshot_id) == len(
        LOBBYING_ROWS
    )
    assert all(store.objects[key] == body for key, body in before_bytes.items())
    assert lob.restore_release(db, restored.id).id == restored.id
    assert lob.live_release(db).copied_at == restored.copied_at
