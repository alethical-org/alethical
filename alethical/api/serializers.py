from __future__ import annotations

import re

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


def sponsor_payloads(
    sponsorships, *, session_id=None
) -> list[api_schemas.SponsorSummary]:
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
                district=service_period.district.code if service_period else None,
            )
        )
    return payloads


def _roll_call_chamber(roll_call_text: str | None) -> str | None:
    if not roll_call_text:
        return None
    match = re.search(r"(\d+)\s*-\s*(\d+)", roll_call_text)
    if match is None:
        return None
    total = int(match.group(1)) + int(match.group(2))
    if total > 100:
        return "house"
    if total > 0:
        return "senate"
    return None


def bill_status_key(bill) -> str:
    actions = list(bill.actions or [])
    text_values = [
        " ".join(
            item
            for item in [
                action.action_text,
                action.action_description,
                action.roll_call_text,
            ]
            if item
        ).lower()
        for action in actions
    ]
    status_text = (bill.current_status or "").lower()
    all_text = [status_text, *text_values]
    if any("veto" in text for text in all_text):
        return "vetoed"
    if any(
        "governor approval" in text
        or "governor's action approval" in text
        or "chapter number" in text
        or "secretary of state" in text
        or "effective date" in text
        for text in all_text
    ):
        return "signed_into_law"
    passed_chambers: set[str] = set()
    for action in actions:
        action_text = (action.action_text or "").lower()
        combined = " ".join(
            item
            for item in [
                action.action_text,
                action.action_description,
                action.roll_call_text,
            ]
            if item
        ).lower()
        if "not passed" in combined:
            continue
        if not (
            "bill was passed" in action_text
            or "third reading passed" in action_text
            or "repassed" in action_text
        ):
            continue
        explicit_chamber = None
        if "senate" in combined:
            explicit_chamber = "senate"
        elif "house" in combined:
            explicit_chamber = "house"
        passed_chambers.add(
            explicit_chamber or _roll_call_chamber(action.roll_call_text) or ""
        )
    passed_chambers.discard("")
    if "senate" in passed_chambers:
        return "passed_senate"
    if "house" in passed_chambers:
        return "passed_house"
    if any("passed senate" in text or "senate passed" in text for text in all_text):
        return "passed_senate"
    if any(
        "passed house" in text
        or "house passed" in text
        or "bill was passed" in text
        or "third reading passed" in text
        for text in all_text
    ):
        return "passed_house"
    if any(
        "referred" in text
        or "committee report" in text
        or "comm report" in text
        or "second reading" in text
        for text in all_text
    ):
        return "in_committee"
    return "proposed"


def bill_progress_payload(bill) -> list[api_schemas.BillProgressStep]:
    status_key = bill_status_key(bill)
    if status_key == "vetoed":
        status_key = "proposed"
    status_steps = {
        "proposed": 1,
        "in_committee": 2,
        "passed_house": 3,
        "passed_senate": 4,
        "signed_into_law": 5,
    }
    current_step = status_steps.get(status_key, 1)
    steps = [
        ("proposed", "Proposed"),
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


def bill_status_key_from_summary(bill) -> str:
    status_text = (bill.current_status or "").lower()
    if "veto" in status_text:
        return "vetoed"
    if (
        "governor" in status_text
        or "chapter number" in status_text
        or "secretary of state" in status_text
        or "effective date" in status_text
    ):
        return "signed_into_law"
    if "senate" in status_text and "pass" in status_text:
        return "passed_senate"
    if "pass" in status_text:
        return "passed_house"
    if (
        "referred" in status_text
        or "committee" in status_text
        or "second reading" in status_text
    ):
        return "in_committee"
    return "proposed"


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


def ai_analysis_payload_for_enrichment(
    enrichment,
) -> api_schemas.AIAnalysisPayload | None:
    if enrichment is None:
        return None
    content = enrichment.content_json or {}
    summary = content.get("summary")
    key_points = content.get("key_points")
    policy_areas = content.get("policy_areas")
    return api_schemas.AIAnalysisPayload(
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
        policy_areas=(
            [
                item.strip()
                for item in policy_areas
                if isinstance(item, str) and item.strip()
            ]
            if isinstance(policy_areas, list)
            else []
        ),
    )


def ai_analysis_payload(enrichments) -> api_schemas.AIAnalysisPayload | None:
    return ai_analysis_payload_for_enrichment(
        current_bill_summary_enrichment(enrichments)
    )


def bill_list_item(bill, *, include_tracking: bool = False) -> api_schemas.BillListItem:
    return api_schemas.BillListItem(
        id=bill.bill_key,
        file_type=bill.file_type,
        file_number=bill.file_number,
        title=bill.title,
        current_status=bill.current_status,
        status_key=bill_status_key_from_summary(bill),
        latest_action_at=bill.latest_action_at,
        official_url=bill.official_url,
        chief_sponsors=sponsor_payloads(bill.chief_sponsorships),
        stats=bill_stats_payload(bill.stats),
        tracked=tracking_payload(bill.tracked_by) if include_tracking else None,
        ai_analysis=ai_analysis_payload(bill.enrichments),
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
