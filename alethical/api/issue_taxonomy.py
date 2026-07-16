"""Canonical issue taxonomy for the Search Bills issue filters and card badges.

The AI enrichment emits uncontrolled free-text ``policy_areas`` — ~7,600
distinct strings with heavy synonym/casing fragmentation ("health",
"healthcare", "health care", "public health" are all really *Health*). This
module maps the common raw values onto a curated set of canonical issues so the
filters and the badges speak the same vocabulary (grounded-answers rule 3:
display/grouping only — the stored ``policy_areas`` are never mutated).

Mapping is deliberately query-time and code-only (no data migration, cleanly
revertable). Aliases are lowercased; matching folds case. Any value not mapped
here falls through to its own Title-Cased form — it still shows as a badge, it
just isn't one of the curated filter chips. Adjust freely; it's a lookup table.

Grounded in the top ~150 policy areas by bill count (2025-2026 session,
Jul 2026). See issue #325.
"""

from __future__ import annotations

# canonical display name -> aliases (lowercased raw values that roll up to it)
CANONICAL_ISSUES: dict[str, tuple[str, ...]] = {
    "Education": (
        "education",
        "higher education",
        "education finance",
        "special education",
    ),
    "Health": (
        "health",
        "public health",
        "healthcare",
        "health care",
        "mental health",
        "health insurance",
        "medical assistance",
        "long-term care",
        "health care regulation",
        "behavioral health",
    ),
    "Public Safety": (
        "public safety",
        "law enforcement",
        "firearms regulation",
        "school safety",
        "emergency management",
        "emergency services",
    ),
    "Justice & Courts": (
        "criminal justice",
        "criminal law",
        "corrections",
        "civil law",
        "family law",
        "judiciary",
    ),
    "Taxation": (
        "taxation",
        "property tax",
        "sales and use tax",
        "individual income tax",
        "income tax",
    ),
    "Government Finance": (
        "funding",
        "finance",
        "state appropriations",
        "appropriations",
        "public finance",
        "local government finance",
        "municipal finance",
        "public funding",
        "grant administration",
        "state finance",
        "grants",
        "budget",
        "budgeting",
        "state budgeting",
        "nonprofit funding",
    ),
    "Capital Investment": (
        "capital investment",
        "state bonding",
        "municipal bonding",
        "bonding",
    ),
    "Transportation": (
        "transportation",
        "transportation infrastructure",
        "motor vehicles",
    ),
    "Infrastructure": (
        "infrastructure",
        "construction",
        "water infrastructure",
        "municipal infrastructure",
        "public facilities",
        "public infrastructure",
        "local infrastructure",
    ),
    "Environment & Natural Resources": (
        "environment",
        "natural resources",
        "natural_resources",
        "water management",
        "land use",
        "water",
        "water quality",
        "wildlife management",
        "waste management",
        "environmental policy",
    ),
    "Energy & Utilities": (
        "energy",
        "utilities",
        "public utilities",
        "renewable energy",
    ),
    "Housing": ("housing",),
    "Economic Development": (
        "economic development",
        "commerce",
        "community development",
        "urban development",
        "business regulation",
    ),
    "Labor & Employment": (
        "workforce development",
        "employment",
        "labor",
        "retirement",
        "employment law",
        "labor and employment",
        "paid leave",
        "public employment",
    ),
    "Agriculture": ("agriculture", "animal welfare"),
    "Local Government": (
        "local government",
        "local governance",
        "local government administration",
        "local government aid",
    ),
    "State Government": (
        "state government",
        "regulation",
        "administrative law",
        "administrative procedure",
        "administrative rulemaking",
        "legislation",
        "government transparency",
        "constitutional law",
        "government",
        "transparency",
        "legislative oversight",
        "administrative enforcement",
        "public administration",
        "government accountability",
        "state government administration",
    ),
    "Elections": ("elections", "campaign finance", "voting", "election administration"),
    "Human Services": (
        "human services",
        "child welfare",
        "child care",
        "disability services",
        "youth services",
        "social services",
        "youth programs",
        "child protection",
        "disability",
        "children",
    ),
    "Consumer Protection": (
        "consumer protection",
        "insurance",
        "data privacy",
        "licensing",
        "privacy",
        "fraud prevention",
        "insurance regulation",
        "professional licensing",
    ),
    "Veterans & Military": ("veterans", "veterans affairs"),
    "Arts & Culture": (
        "arts",
        "cultural heritage",
        "recreation",
        "parks and recreation",
        "culture",
        "historic preservation",
        "sports",
        "heritage",
    ),
    "Civil Rights": ("civil rights",),
    "Immigration": ("immigration",),
    "Cannabis": ("cannabis", "cannabis regulation"),
    "Tribal Affairs": ("tribal affairs",),
}

# alias (folded) -> canonical display, derived once at import.
_ALIAS_TO_CANONICAL: dict[str, str] = {
    alias: canonical
    for canonical, aliases in CANONICAL_ISSUES.items()
    for alias in (*aliases, canonical.lower())
}


def _fold(value: str) -> str:
    return value.strip().lower()


def _title_case(value: str) -> str:
    return " ".join(w[:1].upper() + w[1:] for w in value.split())


def alias_canonical_arrays() -> tuple[list[str], list[str]]:
    """Parallel (alias, canonical) arrays for a SQL ``unnest`` mapping join."""
    aliases = list(_ALIAS_TO_CANONICAL)
    return aliases, [_ALIAS_TO_CANONICAL[a] for a in aliases]


def canonical_for(value: str) -> str | None:
    """Canonical issue for a raw policy-area value, or None if unmapped."""
    return _ALIAS_TO_CANONICAL.get(_fold(value))


def aliases_for(name: str) -> list[str]:
    """Folded raw values that a canonical issue matches.

    Falls back to the folded value itself for an unknown name, so filtering by a
    raw (uncanonicalized) issue still works.
    """
    folded = _fold(name)
    for canonical, aliases in CANONICAL_ISSUES.items():
        if canonical.lower() == folded:
            return sorted({*aliases, folded})
    return [folded]


def canonicalize_areas(values: list[str]) -> list[str]:
    """Map a bill's raw policy areas to display labels for badges: canonical
    where known, Title-Cased passthrough otherwise, de-duplicated in order."""
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if not value or not value.strip():
            continue
        label = canonical_for(value) or _title_case(value.strip())
        if label not in seen:
            seen.add(label)
            out.append(label)
    return out
