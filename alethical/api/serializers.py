from __future__ import annotations

from alethical.api import schemas as api_schemas


def tracking_payload(tracked_rows) -> api_schemas.TrackingState | None:
    if not tracked_rows:
        return api_schemas.TrackingState(is_tracked=False)
    tracked = tracked_rows[0]
    return api_schemas.TrackingState(
        is_tracked=True,
        note=tracked.note,
        alerts_enabled=tracked.alerts_enabled,
    )


def sponsor_payloads(sponsorships) -> list[api_schemas.SponsorSummary]:
    payloads: list[api_schemas.SponsorSummary] = []
    for sponsorship in sponsorships:
        name = sponsorship.legislator.full_name if sponsorship.legislator else "Unknown"
        legislator_id = str(sponsorship.legislator.id) if sponsorship.legislator else None
        payloads.append(
            api_schemas.SponsorSummary(
                name=name,
                role=sponsorship.role.value if hasattr(sponsorship.role, "value") else str(sponsorship.role),
                legislator_id=legislator_id,
            )
        )
    return payloads


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
    enrichment = max(current_enrichments, key=lambda item: item.created_at, default=None)
    if enrichment is None:
        return None
    return enrichment


def ai_analysis_payload_for_enrichment(enrichment) -> api_schemas.AIAnalysisPayload | None:
    if enrichment is None:
        return None
    content = enrichment.content_json or {}
    summary = content.get("summary")
    key_points = content.get("key_points")
    policy_areas = content.get("policy_areas")
    return api_schemas.AIAnalysisPayload(
        summary=summary.strip() if isinstance(summary, str) and summary.strip() else None,
        key_points=(
            [item.strip() for item in key_points if isinstance(item, str) and item.strip()]
            if isinstance(key_points, list)
            else []
        ),
        policy_areas=(
            [item.strip() for item in policy_areas if isinstance(item, str) and item.strip()]
            if isinstance(policy_areas, list)
            else []
        ),
    )


def ai_analysis_payload(enrichments) -> api_schemas.AIAnalysisPayload | None:
    return ai_analysis_payload_for_enrichment(current_bill_summary_enrichment(enrichments))


def bill_list_item(bill, *, include_tracking: bool = False) -> api_schemas.BillListItem:
    return api_schemas.BillListItem(
        id=bill.bill_key,
        file_type=bill.file_type,
        file_number=bill.file_number,
        title=bill.title,
        current_status=bill.current_status,
        latest_action_at=bill.latest_action_at,
        official_url=bill.official_url,
        chief_sponsors=sponsor_payloads(bill.chief_sponsorships),
        stats=bill_stats_payload(bill.stats),
        tracked=tracking_payload(bill.tracked_by) if include_tracking else None,
        ai_analysis=ai_analysis_payload(bill.enrichments),
    )


def district_payload(district) -> api_schemas.DistrictPayload:
    return api_schemas.DistrictPayload(id=str(district.id), code=district.code, label=district.label)


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
    )


def legislator_stats_payload(stats_rows) -> api_schemas.LegislatorStatsPayload | None:
    if not stats_rows:
        return None
    stats = stats_rows[0]
    return api_schemas.LegislatorStatsPayload(
        chief_bill_count=stats.chief_bill_count,
        total_bill_count=stats.total_bill_count,
        vote_record_count=stats.vote_record_count,
        committee_count=stats.committee_count,
    )


def legislator_list_item(legislator) -> api_schemas.LegislatorListItem:
    current_service = next(iter(legislator.service_periods), None)
    return api_schemas.LegislatorListItem(
        id=str(legislator.id),
        slug=legislator.slug,
        full_name=legislator.full_name,
        current_service=current_service_payload(current_service),
        stats=legislator_stats_payload(legislator.stats),
    )


def chat_message_payload(message) -> api_schemas.ChatMessagePayload:
    citations = message.citation_payload.get("citations", []) if message.citation_payload else []
    return api_schemas.ChatMessagePayload(
        id=str(message.id),
        role=message.role.value if hasattr(message.role, "value") else str(message.role),
        content=message.content,
        citations=citations,
        created_at=message.created_at,
    )


def chat_session_payload(session_row, *, subject_bill_id: str | None = None) -> api_schemas.ChatSessionPayload:
    return api_schemas.ChatSessionPayload(
        id=str(session_row.id),
        title=session_row.title,
        subject_bill_id=subject_bill_id,
        last_message_at=session_row.last_message_at,
    )
