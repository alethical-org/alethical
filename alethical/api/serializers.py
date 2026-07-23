from __future__ import annotations

from alethical.api import schemas as api_schemas
from alethical.api.issue_taxonomy import canonicalize_areas


def tracking_payload(tracked_rows) -> api_schemas.TrackingState | None:
    if not tracked_rows:
        return api_schemas.TrackingState(is_tracked=False)
    tracked = tracked_rows[0]
    return api_schemas.TrackingState(
        is_tracked=True,
        note=tracked.note,
        alerts_enabled=tracked.alerts_enabled,
    )


def sponsor_payloads(
    sponsorships, *, session_id=None
) -> list[api_schemas.SponsorSummary]:
    """Serialize bill sponsors.

    Party + district come from the sponsor's own current service period for the
    bill's session. Since #302 merged each bill-author row into its roster row,
    the sponsor row *is* the canonical row, so its own service period carries the
    real party + district — no suffix resolution to a separate roster row needed.
    Callers without a ``session_id`` (e.g. bill_list_item) get no service period,
    so party/district stay null.
    """
    payloads: list[api_schemas.SponsorSummary] = []
    for sponsorship in sponsorships:
        name = sponsorship.legislator.full_name if sponsorship.legislator else "Unknown"
        legislator_id = (
            str(sponsorship.legislator.id) if sponsorship.legislator else None
        )
        service_period = None
        if sponsorship.legislator and session_id is not None:
            service_period = next(
                (
                    period
                    for period in sponsorship.legislator.service_periods
                    if period.session_id == session_id and period.is_current
                ),
                None,
            )
        district = None
        if service_period:
            district = service_period.district.label or service_period.district.code
        payloads.append(
            api_schemas.SponsorSummary(
                name=name,
                role=sponsorship.role.value
                if hasattr(sponsorship.role, "value")
                else str(sponsorship.role),
                legislator_id=legislator_id,
                source_order=sponsorship.source_order,
                source_chamber=sponsorship.source_chamber,
                chamber=service_period.chamber.slug
                if service_period
                else sponsorship.source_chamber,
                party=service_period.party if service_period else None,
                district=district,
                represented_city=service_period.represented_city
                if service_period
                else None,
            )
        )
    return payloads


def bill_progress_payload(bill) -> list[api_schemas.BillProgressStep]:
    """Linear progress stepper for the bill detail page, read from the
    precomputed ``status_key`` column (the single source of truth — the DB
    triggers classify it from the chamber-stamped action history, #607).

    The stepper is a five-station line (Introduced -> In Committee -> Passed
    House -> Passed Senate -> Signed Into Law). ``passed_both_chambers`` maps to
    the Passed-Senate station so both passage stations read as reached; ``vetoed``
    (off the enactment path) sits at Introduced, as before.
    """
    status_key = bill.status_key or "proposed"
    if status_key == "vetoed":
        status_key = "proposed"
    if status_key == "passed_both_chambers":
        status_key = "passed_senate"
    status_steps = {
        "proposed": 1,
        "in_committee": 2,
        "passed_house": 3,
        "passed_senate": 4,
        "signed_into_law": 5,
    }
    current_step = status_steps.get(status_key, 1)
    steps = [
        ("proposed", "Introduced"),
        ("in_committee", "In Committee"),
        ("passed_house", "Passed House"),
        ("passed_senate", "Passed Senate"),
        ("signed_into_law", "Signed Into Law"),
    ]
    return [
        api_schemas.BillProgressStep(
            key=key,
            label=label,
            reached=status_steps[key] <= current_step,
            current=key == status_key,
        )
        for key, label in steps
    ]


def bill_stats_payload(stats) -> api_schemas.BillStatsPayload | None:
    if stats is None:
        return None
    return api_schemas.BillStatsPayload(
        sponsor_count=stats.sponsor_count,
        action_count=stats.action_count,
        version_count=stats.version_count,
        vote_event_count=stats.vote_event_count,
    )


def current_bill_summary_enrichment(enrichments):
    current_enrichments = [
        item
        for item in enrichments
        if (
            item.enrichment_type.value == "bill_summary"
            and item.is_current
            and isinstance((item.content_json or {}).get("summary"), str)
            and item.content_json["summary"].strip()
        )
    ]
    enrichment = max(
        current_enrichments, key=lambda item: item.created_at, default=None
    )
    if enrichment is None:
        return None
    return enrichment


def ai_citation_payloads(content, official_url) -> list[api_schemas.AICitationPayload]:
    """Build resolvable per-key-point citations (#377) from the enrichment's
    already-grounded `key_point_citations`. Each targets the bill's official
    source URL (grounded-answers rule 5 — the location must resolve); a bill
    without an official URL yields no citations rather than a dead link."""
    raw = content.get("key_point_citations")
    if not isinstance(raw, list) or not official_url:
        return []
    citations: list[api_schemas.AICitationPayload] = []
    for index, entry in enumerate(raw):
        if not isinstance(entry, dict):
            continue
        section_id = entry.get("section_id")
        label = entry.get("label")
        quote = entry.get("quote")
        if not (
            isinstance(section_id, str)
            and isinstance(label, str)
            and isinstance(quote, str)
            and section_id.strip()
            and label.strip()
            and quote.strip()
        ):
            continue
        citations.append(
            api_schemas.AICitationPayload(
                id=f"{section_id.strip()}-{index}",
                label=label.strip(),
                url=official_url,
                excerpt=quote.strip(),
                section_id=section_id.strip(),
            )
        )
    return citations


def ai_analysis_payload_for_enrichment(
    enrichment, official_url=None
) -> api_schemas.AIAnalysisPayload | None:
    if enrichment is None:
        return None
    content = enrichment.content_json or {}
    short_title = content.get("short_title")
    summary = content.get("summary")
    key_points = content.get("key_points")
    policy_areas = content.get("policy_areas")
    question_prompts = content.get("question_prompts")
    return api_schemas.AIAnalysisPayload(
        short_title=short_title.strip()
        if isinstance(short_title, str) and short_title.strip()
        else None,
        summary=summary.strip()
        if isinstance(summary, str) and summary.strip()
        else None,
        key_points=(
            [
                item.strip()
                for item in key_points
                if isinstance(item, str) and item.strip()
            ]
            if isinstance(key_points, list)
            else []
        ),
        # Badges display canonical issues (issue_taxonomy) so a card's tags match
        # the Search Bills filter chips; unmapped rare values fall through
        # Title-Cased. De-duped, display only — stored data is untouched.
        policy_areas=(
            canonicalize_areas([item for item in policy_areas if isinstance(item, str)])
            if isinstance(policy_areas, list)
            else []
        ),
        citations=ai_citation_payloads(content, official_url),
        # Bill-specific Ask chips (#550), served as-is; empty for un-re-enriched
        # summaries so the frontend keeps its safe generic fallback.
        question_prompts=(
            [
                item.strip()
                for item in question_prompts
                if isinstance(item, str) and item.strip()
            ]
            if isinstance(question_prompts, list)
            else []
        ),
    )


def ai_analysis_payload(
    enrichments, official_url=None
) -> api_schemas.AIAnalysisPayload | None:
    return ai_analysis_payload_for_enrichment(
        current_bill_summary_enrichment(enrichments), official_url
    )


def bill_list_item(
    bill,
    *,
    include_tracking: bool = False,
    co_author_count: int = 0,
    include_companion: bool = False,
    effective_date: str | None = None,
) -> api_schemas.BillListItem:
    return api_schemas.BillListItem(
        id=bill.bill_key,
        file_type=bill.file_type,
        file_number=bill.file_number,
        title=bill.title,
        current_status=bill.current_status,
        status_key=bill.status_key,
        latest_action_at=bill.latest_action_at,
        official_url=bill.official_url,
        is_omnibus=bill.is_omnibus,
        effective_date=effective_date,
        chief_sponsors=sponsor_payloads(bill.chief_sponsorships),
        co_author_count=co_author_count,
        companion=companion_payload(bill) if include_companion else None,
        stats=bill_stats_payload(bill.stats),
        tracked=tracking_payload(bill.tracked_by) if include_tracking else None,
        ai_analysis=ai_analysis_payload(bill.enrichments),
        actions=[bill_action_payload(action) for action in bill.actions],
    )


def bill_action_payload(action) -> api_schemas.BillActionPayload:
    return api_schemas.BillActionPayload(
        action_number=action.action_number,
        action_text=action.action_text,
        action_group=action.action_group,
        action_description=action.action_description,
        committee_name=action.committee_name,
        action_at=action.action_at,
        journal_page=action.journal_page,
        roll_call_text=action.roll_call_text,
    )


def companion_payload(bill) -> api_schemas.CompanionBillPayload | None:
    """Serialize a bill's House/Senate companion, or None if unlinked. `id` is
    the companion's bill_key so the frontend can link to /bills/{id} (#293)."""
    companion = getattr(bill, "companion_bill", None)
    if companion is None:
        return None
    return api_schemas.CompanionBillPayload(
        id=companion.bill_key,
        code=f"{companion.file_type} {companion.file_number}",
        status=companion.current_status,
        status_key=companion.status_key,
    )


def district_payload(district) -> api_schemas.DistrictPayload:
    return api_schemas.DistrictPayload(
        id=str(district.id), code=district.code, label=district.label
    )


def current_service_payload(service_period) -> api_schemas.CurrentServicePayload | None:
    if service_period is None:
        return None
    return api_schemas.CurrentServicePayload(
        chamber=service_period.chamber.slug,
        party=service_period.party,
        district=district_payload(service_period.district),
        email=service_period.email,
        phone=service_period.phone,
        office_address=service_period.office_address,
        profile_url=service_period.profile_url,
        photo_url=service_period.photo_url,
        elected=service_period.elected,
        term=service_period.term,
    )


def service_history_payload(
    election_history,
) -> api_schemas.ServiceHistoryPayload | None:
    """Serialize a member's ordered Legislative Service history (issue #486).
    ``election_history`` rows arrive ordered by ``period_sequence`` (the
    relationship's order_by). The term counts the current chamber only, so it is
    read from the single ``is_current_chamber`` row."""
    if not election_history:
        return None
    term = next(
        (row.term_number for row in election_history if row.is_current_chamber),
        None,
    )
    return api_schemas.ServiceHistoryPayload(
        term=term,
        periods=[
            api_schemas.ElectionPeriodPayload(
                chamber=row.chamber.chamber_type.value
                if hasattr(row.chamber.chamber_type, "value")
                else str(row.chamber.chamber_type),
                initial_year=row.initial_year,
                reelection_years=list(row.reelection_years or []),
            )
            for row in election_history
        ],
    )


def legislator_stats_payload(
    stats_rows,
    *,
    total_bill_count: int | None = None,
    chief_bill_count: int | None = None,
) -> api_schemas.LegislatorStatsPayload | None:
    """Serialize a legislator's stats. Authorship counts (total/chief bill
    counts) may be supplied live from a Sponsorship join to override the stored
    LegislatorStats, which can be stale or attributed to a shadow author-keyed
    row rather than the directory row (#291); vote/committee counts still come
    from the stored stats row."""
    stats = stats_rows[0] if stats_rows else None
    if stats is None and total_bill_count is None and chief_bill_count is None:
        return None
    return api_schemas.LegislatorStatsPayload(
        chief_bill_count=chief_bill_count
        if chief_bill_count is not None
        else (stats.chief_bill_count if stats else 0),
        total_bill_count=total_bill_count
        if total_bill_count is not None
        else (stats.total_bill_count if stats else 0),
        vote_record_count=stats.vote_record_count if stats else 0,
        committee_count=stats.committee_count if stats else 0,
    )


def legislator_list_item(
    legislator,
    *,
    total_bill_count: int | None = None,
    chief_bill_count: int | None = None,
    committee_names: list[str] | None = None,
) -> api_schemas.LegislatorListItem:
    current_service = next(iter(legislator.service_periods), None)
    committees = (
        [api_schemas.CommitteePayload(name=name) for name in committee_names]
        if committee_names
        else None
    )
    return api_schemas.LegislatorListItem(
        id=str(legislator.id),
        slug=legislator.slug,
        full_name=legislator.full_name,
        current_service=current_service_payload(current_service),
        committees=committees,
        stats=legislator_stats_payload(
            legislator.stats,
            total_bill_count=total_bill_count,
            chief_bill_count=chief_bill_count,
        ),
    )


def chat_message_payload(message) -> api_schemas.ChatMessagePayload:
    citations = (
        message.citation_payload.get("citations", [])
        if message.citation_payload
        else []
    )
    return api_schemas.ChatMessagePayload(
        id=str(message.id),
        role=message.role.value
        if hasattr(message.role, "value")
        else str(message.role),
        content=message.content,
        citations=citations,
        created_at=message.created_at,
    )


def chat_session_payload(
    session_row, *, subject_bill_id: str | None = None
) -> api_schemas.ChatSessionPayload:
    return api_schemas.ChatSessionPayload(
        id=str(session_row.id),
        title=session_row.title,
        subject_bill_id=subject_bill_id,
        last_message_at=session_row.last_message_at,
    )
