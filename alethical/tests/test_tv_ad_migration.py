"""Real migration and account erasure preserve TV evidence without actor identity."""

from datetime import datetime, timezone
import uuid
from types import SimpleNamespace

import pytest
from fastapi import Request
from sqlalchemy.exc import OperationalError

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.api.routers import tv_ads as router
from alethical.tests.test_candidates_migration import migrate
from alethical.tests import test_tv_ad_review as fixtures
from scripts.check_schema_drift import ScratchDatabase, _local_base_url


@pytest.mark.parametrize("delete_account", [False, True])
def test_tv_migration_erases_deleted_identity_and_retains_decisions(
    delete_account, monkeypatch
):
    with ScratchDatabase(_local_base_url(), "tv_privacy") as scratch:
        result = migrate(scratch.url, "upgrade", "0070_tv_ad_records")
        assert result.returncode == 0, result.stderr
        engine = scratch.engine()
        try:
            with Session(engine) as db:
                source = fixtures.source.__wrapped__(db)
                copy = fixtures.approved(db, source)
                other = "other-tv-reviewer"
                account = m.UserAccount(primary_email="tv-delete@example.invalid")
                db.add(account)
                db.flush()
                identity = m.AuthIdentity(
                    user_id=account.id,
                    provider="supabase",
                    provider_subject=fixtures.ACTOR,
                )
                db.add(identity)
                fact = m.TVAdFact(
                    publication_id=copy.id,
                    field="agency_name",
                    value="Example Media",
                    page=1,
                    quote="Agency: Example Media.",
                    status="checked",
                    evidence="Retained proof",
                    reviewed_by=fixtures.ACTOR,
                    checked_at=datetime.now(timezone.utc),
                    publication_approved=True,
                )
                connection = m.TVAdConnection(
                    scope="file",
                    publication_id=copy.id,
                    facility_id=copy.facility_id,
                    folder_id="folder-1",
                    kind="issue",
                    target_id="schools",
                    target_snapshot={"label": "Schools"},
                    page=1,
                    quote="Schools",
                    status="checked",
                    evidence="Retained connection proof",
                    reviewed_by=fixtures.ACTOR,
                    checked_at=datetime.now(timezone.utc),
                    publication_approved=True,
                )
                folder = m.TVAdFolderApproval(
                    facility_id=copy.facility_id,
                    folder_id="folder-1",
                    content_hash=copy.content_hash,
                    safe_label="Reviewed folder",
                    safe_path="political-files/2026/state",
                    category="State",
                    fingerprint="a" * 64,
                    status="approved",
                    created_by=fixtures.ACTOR,
                    reviewed_by=fixtures.ACTOR,
                    reviewed_at=datetime.now(timezone.utc),
                )
                db.add(
                    m.FCCExtraction(
                        content_hash=copy.content_hash,
                        version="synthetic",
                        document_kind="invoice",
                        status="checked",
                        facts=[],
                        errors=[],
                    )
                )
                db.flush()
                history = (
                    "Retained source proof\n\n"
                    f"Review 2026-10-13T12:00:00+00:00: accepted by {fixtures.ACTOR}; current_source_evidence\n"
                    "First decision proof\n\n"
                    f"Review 2026-10-13T13:00:00+00:00: rejected by {other}; current_source_evidence\n"
                    "Later decision proof"
                )
                expense = m.FCCExpenseLink(
                    content_hash=copy.content_hash,
                    extraction_version="synthetic",
                    source_dataset="expenditures",
                    source_snapshot_id=uuid.uuid4(),
                    source_content_hash="b" * 64,
                    source_row_number=1,
                    source_row={"amount": "10.00"},
                    status="rejected",
                    evidence=history,
                    reviewed_by=other,
                )
                db.add(expense)
                db.add_all([fact, connection, folder])
                db.add(
                    m.TVAdReviewEvent(
                        entity_type="fact",
                        entity_id=uuid.uuid4(),
                        action="checked",
                        actor=other,
                        evidence="Other reviewer",
                        snapshot={"unchanged": True},
                    )
                )
                db.flush()
                ids = (copy.id, fact.id, connection.id, folder.id, account.id)
                db.commit()
                # Exercise the route's actual lock, not a hand-written equivalent.
                monkeypatch.setattr(router, "administrator_access", lambda *args: True)
                principal = SimpleNamespace(
                    provider="supabase",
                    provider_subject=fixtures.ACTOR,
                    email="tv-delete@example.invalid",
                    email_verified=True,
                )
                assert (
                    router.tv_administrator(
                        Request({"type": "http", "method": "POST", "headers": []}),
                        "Bearer synthetic",
                        SimpleNamespace(authenticate=lambda token: principal),
                        db,
                    )
                    == fixtures.ACTOR
                )
                with Session(engine) as deleting:
                    deleting.execute(text("SET LOCAL lock_timeout = '100ms'"))
                    with pytest.raises(OperationalError, match="lock timeout"):
                        deleting.execute(
                            text(
                                "DELETE FROM auth_identity WHERE provider_subject=:subject"
                            ),
                            {"subject": fixtures.ACTOR},
                        )
                    deleting.rollback()
                db.commit()
                # Existing account deletion requires deleting identity rows first.
                db.delete(identity)
                db.flush()
                if delete_account:
                    db.execute(
                        text("DELETE FROM user_account WHERE id=:id"), {"id": ids[4]}
                    )
                db.commit()
                db.expire_all()
                copy = db.get(m.TVAdPublication, ids[0])
                fact = db.get(m.TVAdFact, ids[1])
                connection = db.get(m.TVAdConnection, ids[2])
                folder = db.get(m.TVAdFolderApproval, ids[3])
                assert copy.status == "approved"
                assert (
                    copy.created_by,
                    copy.reviewed_by,
                    copy.metadata_reviewed_by,
                ) == ("deleted-account",) * 3
                assert (
                    fact.reviewed_by
                    == connection.reviewed_by
                    == folder.created_by
                    == folder.reviewed_by
                    == "deleted-account"
                )
                assert (
                    fact.value == "Example Media" and fact.evidence == "Retained proof"
                )
                assert connection.target_snapshot == {"label": "Schools"}
                db.refresh(expense)
                assert expense.reviewed_by == other
                assert expense.evidence == history.replace(
                    f" by {fixtures.ACTOR}; ", "; "
                )
                assert expense.source_row == {"amount": "10.00"}

                assert (
                    db.scalar(
                        text(
                            "SELECT count(*) FROM tv_ad_review_event WHERE actor=:actor"
                        ),
                        {"actor": fixtures.ACTOR},
                    )
                    == 0
                )
                assert (
                    db.scalar(
                        text(
                            "SELECT count(*) FROM tv_ad_review_event WHERE actor=:actor"
                        ),
                        {"actor": other},
                    )
                    == 1
                )
                if not delete_account:
                    db.delete(db.get(m.UserAccount, ids[4]))
                    db.commit()
                assert db.get(m.TVAdPublication, ids[0]).status == "approved"
            # Recovery removes only the new TV structures and their own triggers.
            result = migrate(scratch.url, "downgrade", "0069_candidate_person_records")
            assert result.returncode == 0, result.stderr
            result = migrate(scratch.url, "upgrade", "0070_tv_ad_records")
            assert result.returncode == 0, result.stderr
            with engine.connect() as db:
                assert (
                    db.scalar(
                        text(
                            "SELECT count(*) FROM pg_class WHERE relname LIKE 'tv_ad_%' AND relkind='r' AND relrowsecurity"
                        )
                    )
                    == 5
                )
                assert (
                    db.scalar(
                        text(
                            "SELECT count(*) FROM pg_trigger WHERE tgname IN ('clear_deleted_tv_review_account','clear_deleted_tv_review_identity')"
                        )
                    )
                    == 2
                )
        finally:
            engine.dispose()
