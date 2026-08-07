"""The one grounded rule for deciding whether a bill matches an Ask topic.

Ask and the Search page reached from Ask must use this exact select. Keeping the
predicate here prevents the handoff from quietly turning a topic into a literal
keyword search and returning a different count.
"""

from __future__ import annotations

from sqlalchemy import String, cast, or_, select

from alethical.db.schema import load_schema

schema = load_schema()
Bill = schema.Bill
AIEnrichment = schema.AIEnrichment
EnrichmentType = schema.EnrichmentType

MIN_TOPIC_LENGTH = 3


def matched_topic_bill_ids(session_ids, topic_value: str):
    """Bill ids matching ``topic_value`` within the supplied sessions.

    A bill matches on its hidden policy-area labels or on a title/description
    phrase, and only when it has the current summary Ask needs for its cited card.
    """
    pattern = f"%{topic_value}%"
    matching_policy_area_bills = select(AIEnrichment.bill_id).where(
        AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
        AIEnrichment.is_current.is_(True),
        cast(AIEnrichment.content_json["policy_areas"], String).ilike(pattern),
    )
    return select(Bill.id).where(
        Bill.session_id.in_(tuple(session_ids)),
        Bill.has_current_summary.is_(True),
        or_(
            Bill.id.in_(matching_policy_area_bills),
            Bill.title.ilike(pattern),
            Bill.description.ilike(pattern),
        ),
    )
