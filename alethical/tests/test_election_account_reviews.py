"""Account review history cannot silently relink a candidate or widen a period."""

# Imported fixtures are deliberately rebound by pytest arguments.
# ruff: noqa: F811, F401

from datetime import date
import hashlib

import pytest
from sqlalchemy import func, select

from alethical.db import models as m
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline import election_comparison as storage
from alethical.tests.test_election_comparison_storage import (
    archive,
    db,
    prepared,
    source_set,
)  # noqa: F401


@pytest.fixture
def review_context(db, prepared, request):
    store = archive(db, prepared)
    generation = prepared[0]
    storage.stage_generation(db, generation)
    race = db.scalar(select(m.ElectionComparisonRace))
    candidate = next(
        c for c in race.payload["candidates"] if not c["is_write_in_aggregate"]
    )
    fingerprint = hashlib.sha256(b"synthetic report").hexdigest()
    db.add(
        m.CampaignFinanceReportDocument(
            document_hash=fingerprint,
            object_key="test/account-review.pdf.gz",
            byte_size=16,
            compressed_hash="b" * 64,
            compressed_byte_size=30,
            registration_number="19399",
            filing_year=2026,
            report_type="E",
            amendment_index=0,
        )
    )
    db.flush()
    register_hash = storage.archive_source(
        db, store, b'{"synthetic":"committee directory"}'
    )
    sources = [
        {
            "sha256": register_hash,
            "kind": "candidate_directory",
            "url": "https://cfb.mn.gov/reports/api/",
        }
    ]
    # The complete source membership must precede the immutable parent INSERT.
    supplemental = getattr(request, "param", None)
    if supplemental:
        source_hash = (
            storage.archive_source(db, store, supplemental["body"])
            if "body" in supplemental
            else register_hash
        )
        sources.append({"sha256": source_hash, **supplemental["metadata"]})
    db.add(
        m.ElectionFinanceCollection(
            id="c" * 64,
            election_key=generation["election_key"],
            copied_at=db.get(m.ElectionComparisonSnapshot, generation["id"]).fetched_at,
            sources=sources,
            coverage={},
        )
    )
    db.flush()
    source_hash = race.payload["candidate_source_sha256"]
    args = dict(
        snapshot_id=generation["id"],
        race_id=race.id,
        candidate_id=candidate["candidate_id"],
        registration_number="19399",
        decision="confirmed",
        identity=reviews.candidate_identity(race, candidate),
        period_start=date(2026, 1, 1),
        period_end=date(2026, 12, 31),
        evidence=[
            {"kind": "ballot", "sha256": source_hash},
            {
                "kind": "committee_register",
                "sha256": register_hash,
                "collection_id": "c" * 64,
            },
            {"kind": "report_cover", "sha256": fingerprint, "page": 1},
        ],
        reason="Synthetic evidence checked for this exact candidacy",
        reviewed_by="private-test-reviewer",
        expected_previous_id=None,
    )
    return generation, race, candidate, args


def applicable(db, ctx, **kwargs):
    generation, race, candidate, _ = ctx
    return reviews.applicable_accounts(
        db,
        election_key=generation["election_key"],
        race=race,
        candidate=candidate,
        period_start=date(2026, 1, 1),
        period_end=kwargs.pop("period_end", date(2026, 10, 19)),
        **kwargs,
    )


def test_retry_withdrawal_and_reconfirmation_do_not_reactivate_old_decisions(
    db, review_context
):
    args = review_context[3]
    original = reviews.record_decision(db, **args)
    assert reviews.record_decision(db, **args).id == original.id
    assert applicable(db, review_context)["accounts"][0]["decision_id"] == original.id
    assert "reviewed_by" not in applicable(db, review_context)["accounts"][0]
    withdrawn = reviews.record_decision(
        db,
        **{
            **args,
            "decision": "withdrawn",
            "reason": "The evidence no longer establishes this relationship",
            "expected_previous_id": original.id,
        },
    )
    assert withdrawn.previous_decision_id == original.id
    assert applicable(db, review_context)["accounts"] == []
    assert reviews.record_decision(db, **args).id == original.id
    assert applicable(db, review_context)["accounts"] == []
    restored = reviews.record_decision(
        db,
        **{
            **args,
            "expected_previous_id": withdrawn.id,
            "reason": "Explicit source recheck confirms this relationship",
        },
    )
    assert applicable(db, review_context)["accounts"][0]["decision_id"] == restored.id
    assert (
        db.scalar(select(func.count()).select_from(m.ElectionCampaignAccountDecision))
        == 3
    )


def test_stale_decision_cannot_fork_the_history(db, review_context):
    args = review_context[3]
    reviews.record_decision(db, **args)
    with pytest.raises(storage.ComparisonImportError, match="changed"):
        reviews.record_decision(
            db, **{**args, "reason": "Different review on stale state"}
        )


@pytest.mark.parametrize(
    "mismatch,review_context",
    [
        (
            mismatch,
            {
                "metadata": {
                    "kind": "catalogue" if mismatch == "kind" else "candidate_identity",
                    "registration_number": "other"
                    if mismatch == "registration"
                    else "19399",
                    "url": "https://cfb.mn.gov/reports/api/",
                }
            },
        )
        for mismatch in ["kind", "registration", "collection", None]
    ],
    indirect=["review_context"],
    ids=["kind", "registration", "collection", "None"],
)
def test_supplemental_identity_evidence_belongs_to_exact_account(
    db, review_context, mismatch
):
    args = review_context[3]
    fingerprint = args["evidence"][1]["sha256"]
    evidence = [
        *args["evidence"],
        {
            "kind": "candidate_identity",
            "sha256": fingerprint,
            "collection_id": "missing" if mismatch == "collection" else "c" * 64,
            "locator": "CandidateFullName",
        },
    ]
    if mismatch:
        with pytest.raises(storage.ComparisonImportError, match="identity evidence"):
            reviews.record_decision(db, **{**args, "evidence": evidence})
    else:
        decision = reviews.record_decision(db, **{**args, "evidence": evidence})
        assert decision.evidence[-1]["kind"] == "candidate_identity"


def test_identity_changes_block_attribution_but_vote_changes_do_not(db, review_context):
    reviews.record_decision(db, **review_context[3])
    candidate = review_context[2]
    candidate["votes"] += 9
    assert applicable(db, review_context)["accounts"]
    candidate["name"] = "Different named candidate"
    assert applicable(db, review_context)["accounts"] == []
    assert applicable(db, review_context)["gaps"][0]["state"] == "identity_changed"


def test_exact_period_does_not_expand_to_calendar_year(db, review_context):
    reviews.record_decision(
        db, **{**review_context[3], "period_end": date(2026, 10, 19)}
    )
    assert applicable(db, review_context)["accounts"]
    wider = applicable(db, review_context, period_end=date(2026, 12, 31))
    assert wider["accounts"] == []
    assert wider["gaps"][0]["state"] == "period_not_covered"


def test_overlapping_candidacies_need_explicit_same_person_evidence(db, review_context):
    args = review_context[3]
    first = reviews.record_decision(db, **args)
    race = review_context[1]
    other = next(
        c
        for c in race.payload["candidates"]
        if not c["is_write_in_aggregate"] and c["candidate_id"] != args["candidate_id"]
    )
    other_args = {
        **args,
        "candidate_id": other["candidate_id"],
        "identity": reviews.candidate_identity(race, other),
    }
    with pytest.raises(storage.ComparisonImportError, match="same race"):
        reviews.record_decision(db, **other_args)
    original = db.get(m.ElectionComparisonSnapshot, args["snapshot_id"])
    primary = m.ElectionComparisonSnapshot(
        id="d" * 64,
        election_key="synthetic-primary",
        election_date=date(2026, 8, 11),
        stage="primary",
        fetched_at=original.fetched_at,
        sources=original.sources,
        coverage=original.coverage,
    )
    db.add(primary)
    db.flush()
    db.add(
        m.ElectionComparisonRace(
            snapshot_id=primary.id,
            id=race.id,
            label=race.label,
            office_id=race.office_id,
            jurisdiction=race.jurisdiction,
            result_status=race.result_status,
            payload=race.payload,
        )
    )
    db.flush()
    other_args = {**args, "snapshot_id": primary.id}
    with pytest.raises(storage.ComparisonImportError, match="Overlapping"):
        reviews.record_decision(db, **other_args)
    with pytest.raises(storage.ComparisonImportError, match="same-person"):
        reviews.record_decision(db, **other_args, compatible_decision_ids=[first.id])
    # A real same-person primary/general decision would cite retained corroboration;
    # the synthetic fixture checks that explicit evidence is required and recorded.
    second = reviews.record_decision(
        db,
        **{
            **other_args,
            "evidence": args["evidence"]
            + [
                {
                    "kind": "same_person",
                    "sha256": args["evidence"][0]["sha256"],
                    "decision_ids": [first.id],
                }
            ],
        },
        compatible_decision_ids=[first.id],
    )
    assert second.compatible_decision_ids == [first.id]


@pytest.mark.parametrize(
    "override",
    [
        {"decision": "proposal"},
        {"identity": {}},
        {"registration_number": " 19399"},
        {"evidence": []},
        {"authority": "fec"},
        {"reviewed_by": ""},
        {"period_start": date(2025, 1, 1)},
        {"evidence": [{"kind": "ballot", "sha256": "f" * 64}]},
    ],
)
def test_bad_or_unconfirmed_evidence_never_creates_a_link(db, review_context, override):
    with pytest.raises(storage.ComparisonImportError):
        reviews.record_decision(db, **{**review_context[3], **override})
    assert applicable(db, review_context)["accounts"] == []


def test_no_period_returns_exact_review_bounds(db, review_context):
    reviews.record_decision(
        db, **{**review_context[3], "period_end": date(2026, 10, 19)}
    )
    generation, race, candidate, _ = review_context
    result = reviews.applicable_accounts(
        db, election_key=generation["election_key"], race=race, candidate=candidate
    )
    assert result["accounts"][0]["period_end"] == "2026-10-19"
    with pytest.raises(storage.ComparisonImportError, match="both dates"):
        reviews.applicable_accounts(
            db,
            election_key=generation["election_key"],
            race=race,
            candidate=candidate,
            period_start=date(2026, 1, 1),
        )


def test_database_preserves_review_history(db, review_context):
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    row = reviews.record_decision(db, **review_context[3])
    for sql in (
        "UPDATE election_campaign_account_decision SET decision='rejected' WHERE id=:id",
        "DELETE FROM election_campaign_account_decision WHERE id=:id",
    ):
        with pytest.raises(DBAPIError, match="append-only"):
            with db.begin_nested():
                db.execute(text(sql), {"id": row.id})
    assert applicable(db, review_context)["accounts"][0]["decision_id"] == row.id


def test_missing_retained_review_source_is_not_an_unchecked_link(db, review_context):
    from sqlalchemy import delete

    reviews.record_decision(db, **review_context[3])
    fingerprint = review_context[3]["evidence"][0]["sha256"]
    db.execute(
        delete(m.ElectionResultSource).where(
            m.ElectionResultSource.content_hash == fingerprint
        )
    )
    result = applicable(db, review_context)
    assert result["state"] == "unavailable"
    assert result["accounts"] == []
    assert result["gaps"][0]["state"] == "sources_unavailable"


def test_ballot_source_cannot_substitute_for_committee_register(db, review_context):
    args = review_context[3]
    evidence = [dict(item) for item in args["evidence"]]
    evidence[1]["sha256"] = evidence[0]["sha256"]
    with pytest.raises(storage.ComparisonImportError, match="Board directory"):
        reviews.record_decision(db, **{**args, "evidence": evidence})
