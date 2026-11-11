"""Explicit account review for one candidacy, without manufacturing a legislator.

Matching proposes; this module records an accountable decision after source review.
It never imports a matcher score or turns a unique name into a confirmation.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline.election_comparison import ComparisonImportError, digest


def candidate_identity(race: m.ElectionComparisonRace, candidate: dict) -> dict:
    """Vote totals and source copy dates are not part of a person's identity."""
    return {
        "candidate_source_id": candidate["candidate_id"],
        "name": candidate["name"],
        "party": candidate["party"],
        "office_id": race.office_id,
        "office_name": race.payload["office_name"],
        "district": race.payload.get("district"),
        "jurisdiction": race.jurisdiction,
    }


def _candidate(race: m.ElectionComparisonRace, candidate_id: str) -> dict:
    found = [c for c in race.payload["candidates"] if c["candidate_id"] == candidate_id]
    if len(found) != 1 or found[0]["is_write_in_aggregate"]:
        raise ComparisonImportError("A review must identify one named candidacy")
    return found[0]


def record_decision(
    db: Session,
    *,
    snapshot_id: str,
    race_id: str,
    candidate_id: str,
    registration_number: str,
    decision: str,
    identity: dict,
    period_start: date,
    period_end: date,
    evidence: list[dict],
    reason: str,
    reviewed_by: str,
    expected_previous_id: int | None,
    authority: str = "mn_cfb",
    compatible_decision_ids: list[int] | None = None,
) -> m.ElectionCampaignAccountDecision:
    """Append one explicit decision; a repeat/stale review cannot overwrite another."""
    snapshot = db.get(m.ElectionComparisonSnapshot, snapshot_id)
    race = db.get(m.ElectionComparisonRace, (snapshot_id, race_id))
    if snapshot is None or race is None:
        raise ComparisonImportError("Review needs a retained election and race")
    if authority != "mn_cfb":
        raise ComparisonImportError(
            "This review adapter supports Minnesota Board accounts"
        )
    compatible = sorted(set(compatible_decision_ids or []))
    if any(type(value) is not int or value < 1 for value in compatible):
        raise ComparisonImportError(
            "Compatibility must identify exact review decisions"
        )
    candidate = _candidate(race, candidate_id)
    if identity != candidate_identity(race, candidate):
        raise ComparisonImportError("Review identity differs from the source candidacy")
    if decision not in {"confirmed", "rejected", "withdrawn"}:
        raise ComparisonImportError("A proposal is not a review decision")
    if (
        not registration_number
        or len(registration_number) > 20
        or registration_number.strip() != registration_number
    ):
        raise ComparisonImportError("An exact source registration number is required")
    if not reason.strip() or not reviewed_by.strip():
        raise ComparisonImportError("Record the review reason and accountable reviewer")
    if not period_start <= period_end or {period_start.year, period_end.year} != {
        snapshot.election_date.year
    }:
        raise ComparisonImportError(
            "Attribution dates must describe the selected calendar year"
        )
    if not evidence or not all(isinstance(e, dict) for e in evidence):
        raise ComparisonImportError("Retained review evidence is required")
    # A cited ballot, register and cover must actually be retained. The record
    # preserves the review judgment separately from these existence checks.
    kinds = {e.get("kind") for e in evidence}
    if (
        decision == "confirmed"
        and not {"ballot", "committee_register", "report_cover"} <= kinds
    ):
        raise ComparisonImportError(
            "Confirmation needs ballot, register and report-cover evidence"
        )
    for item in evidence:
        fingerprint = item.get("sha256")
        if item.get("kind") == "report_cover":
            document = db.get(m.CampaignFinanceReportDocument, fingerprint)
            if document is None or document.registration_number != registration_number:
                raise ComparisonImportError(
                    "Report cover is not retained for this account"
                )
            if type(item.get("page")) is not int or item["page"] < 1:
                raise ComparisonImportError("Report-cover evidence needs a page")
        elif db.get(m.ElectionResultSource, fingerprint) is None:
            raise ComparisonImportError("Review source is not retained")
        if item.get("kind") == "committee_register":
            collection = db.get(m.ElectionFinanceCollection, item.get("collection_id"))
            if collection is None or not any(
                source.get("sha256") == fingerprint
                and source.get("kind") == "candidate_directory"
                and source.get("url") == "https://cfb.mn.gov/reports/api/"
                for source in collection.sources
            ):
                raise ComparisonImportError(
                    "Committee register evidence needs the retained Board directory in a retained collection"
                )
        if (
            item.get("kind") == "ballot"
            and fingerprint != race.payload["candidate_source_sha256"]
        ):
            raise ComparisonImportError(
                "Ballot evidence is for another candidate register"
            )
    # Serialize the account across all candidacies and elections, so parallel
    # reviews cannot each miss an overlapping claim made by the other.
    key = f"{authority}:{registration_number}"
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"election-account:{key}"},
    )
    request_key = digest(
        {
            "snapshot_id": snapshot_id,
            "race_id": race_id,
            "candidate_id": candidate_id,
            "authority": authority,
            "registration_number": registration_number,
            "decision": decision,
            "identity": identity,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "evidence": evidence,
            "reason": reason.strip(),
            "reviewed_by": reviewed_by.strip(),
            "previous_decision_id": expected_previous_id,
            "compatible_decision_ids": compatible,
        }
    )
    repeated = db.scalar(
        select(m.ElectionCampaignAccountDecision).where(
            m.ElectionCampaignAccountDecision.request_key == request_key
        )
    )
    if repeated is not None:
        # Returning the old receipt never makes it the current decision again.
        return repeated
    previous = db.scalar(
        select(m.ElectionCampaignAccountDecision)
        .where(
            m.ElectionCampaignAccountDecision.election_key == snapshot.election_key,
            m.ElectionCampaignAccountDecision.authority == authority,
            m.ElectionCampaignAccountDecision.race_id == race_id,
            m.ElectionCampaignAccountDecision.candidate_id == candidate_id,
            m.ElectionCampaignAccountDecision.registration_number
            == registration_number,
        )
        .order_by(m.ElectionCampaignAccountDecision.id.desc())
        .limit(1)
    )
    if (previous.id if previous else None) != expected_previous_id:
        raise ComparisonImportError("Account review changed; read the latest decision")
    if decision == "withdrawn" and (
        previous is None or previous.decision != "confirmed"
    ):
        raise ComparisonImportError("Only an existing confirmation can be withdrawn")
    if decision == "confirmed":
        all_account_decisions = db.scalars(
            select(m.ElectionCampaignAccountDecision)
            .where(
                m.ElectionCampaignAccountDecision.authority == authority,
                m.ElectionCampaignAccountDecision.registration_number
                == registration_number,
            )
            .order_by(m.ElectionCampaignAccountDecision.id.desc())
        )
        seen = set()
        conflicts = set()
        for other in all_account_decisions:
            candidacy = (other.election_key, other.race_id, other.candidate_id)
            if candidacy in seen:
                continue
            seen.add(candidacy)
            if candidacy == (snapshot.election_key, race_id, candidate_id):
                continue
            if other.decision == "confirmed" and max(
                period_start, other.period_start
            ) <= min(period_end, other.period_end):
                if (other.election_key, other.race_id) == (
                    snapshot.election_key,
                    race_id,
                ):
                    raise ComparisonImportError(
                        "One account cannot identify two candidates in the same race"
                    )
                conflicts.add(other.id)
        if conflicts != set(compatible):
            raise ComparisonImportError(
                "Overlapping account claims require the exact current compatible decisions"
            )
        if compatible and not any(
            item.get("kind") == "same_person"
            and set(item.get("decision_ids", [])) == set(compatible)
            for item in evidence
        ):
            raise ComparisonImportError(
                "Compatible claims require retained same-person evidence"
            )
    elif compatible:
        raise ComparisonImportError("Compatibility belongs to a confirmation")
    row = m.ElectionCampaignAccountDecision(
        request_key=request_key,
        previous_decision_id=expected_previous_id,
        compatible_decision_ids=compatible,
        authority=authority,
        election_key=snapshot.election_key,
        race_id=race_id,
        candidate_id=candidate_id,
        registration_number=registration_number,
        decision=decision,
        period_start=period_start,
        period_end=period_end,
        identity=identity,
        evidence=evidence,
        reason=reason.strip(),
        reviewed_by=reviewed_by.strip(),
        reviewed_at=datetime.now(UTC),
    )
    db.add(row)
    db.flush()
    return row


def applicable_accounts(
    db: Session,
    *,
    election_key: str,
    race: m.ElectionComparisonRace,
    candidate: dict,
    period_start: date | None = None,
    period_end: date | None = None,
    authority: str = "mn_cfb",
) -> dict:
    """Return current exact scopes, optionally requiring one whole report period.

    With no period, callers receive the reviewed bounds and must apply them to
    each dated read. This does not turn a partial period into a calendar year.
    """
    if (period_start is None) != (period_end is None):
        raise ComparisonImportError("A period needs both dates")
    decisions = db.scalars(
        select(m.ElectionCampaignAccountDecision)
        .where(
            m.ElectionCampaignAccountDecision.election_key == election_key,
            m.ElectionCampaignAccountDecision.authority == authority,
            m.ElectionCampaignAccountDecision.race_id == race.id,
            m.ElectionCampaignAccountDecision.candidate_id == candidate["candidate_id"],
        )
        .order_by(m.ElectionCampaignAccountDecision.id.desc())
    )
    seen, accounts, gaps = set(), [], []
    for row in decisions:
        if row.registration_number in seen:
            continue
        seen.add(row.registration_number)
        if row.decision != "confirmed":
            gaps.append(
                {"registration_number": row.registration_number, "state": row.decision}
            )
        elif row.identity != candidate_identity(race, candidate):
            gaps.append(
                {
                    "registration_number": row.registration_number,
                    "authority": row.authority,
                    "state": "identity_changed",
                }
            )
        elif any(
            db.get(
                m.CampaignFinanceReportDocument
                if item.get("kind") == "report_cover"
                else m.ElectionResultSource,
                item.get("sha256"),
            )
            is None
            for item in row.evidence
        ):
            gaps.append(
                {
                    "registration_number": row.registration_number,
                    "state": "sources_unavailable",
                }
            )
        elif (
            period_start is not None
            and period_end is not None
            and not row.period_start <= period_start <= period_end <= row.period_end
        ):
            gaps.append(
                {
                    "registration_number": row.registration_number,
                    "state": "period_not_covered",
                }
            )
        else:
            accounts.append(
                {
                    "registration_number": row.registration_number,
                    "authority": row.authority,
                    "decision_id": row.id,
                    "period_start": row.period_start.isoformat(),
                    "period_end": row.period_end.isoformat(),
                    "checked_on": row.reviewed_at.date().isoformat(),
                    "evidence": row.evidence,
                }
            )
    return {
        "state": (
            "partial"
            if accounts and gaps
            else "checked"
            if accounts
            else "unavailable"
            if any(gap["state"] == "sources_unavailable" for gap in gaps)
            else "no_confirmed_link"
        ),
        "accounts": accounts,
        "gaps": gaps,
    }
