"""The shared rule for deciding whether a bill belongs to an Issue filter.

Ask issue answers and Search issue chips both call this select. The stored
``policy_areas`` come from bill enrichment; the public issue taxonomy folds
their synonyms into one visible Issue name.
"""

from __future__ import annotations

from sqlalchemy import func, select

from alethical.api.issue_taxonomy import aliases_for, canonical_for
from alethical.db.schema import load_schema

schema = load_schema()
AIEnrichment = schema.AIEnrichment
EnrichmentType = schema.EnrichmentType

MIN_ISSUE_LENGTH = 3


def public_issue_name(value: str) -> str:
    """The public Issue name for a canonical name, alias, or raw label."""
    stripped = value.strip()
    return canonical_for(stripped) or stripped


def matched_issue_bill_ids(issue_names: list[str] | tuple[str, ...]):
    """Bill ids carrying any selected canonical or raw issue label."""
    aliases = sorted(
        {
            alias
            for issue in issue_names
            for alias in aliases_for(public_issue_name(issue))
            if alias
        }
    )
    if not aliases:
        return select(AIEnrichment.bill_id).where(AIEnrichment.bill_id.is_(None))

    element = func.jsonb_array_elements_text(
        AIEnrichment.content_json["policy_areas"]
    ).table_valued("value")
    element_matches = (
        select(1)
        .select_from(element)
        .where(func.lower(func.btrim(element.c.value)).in_(aliases))
        .exists()
    )
    return select(AIEnrichment.bill_id).where(
        AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
        AIEnrichment.is_current.is_(True),
        element_matches,
    )
