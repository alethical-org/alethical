"""Source-checked organization evidence for automatic mail disclosure matching.

Records identify organizations only, never a campaign account or the source of
funds for a particular piece. Comparison uses the disclosure itself, not a
recipient address or a nearby candidate's name. Add records only with checked
primary-source evidence; preserve the original quote separately.
"""

from __future__ import annotations

import re

SOURCES = (
    {
        "name": "Republican Party of Minnesota",
        "source_url": "https://www.sos.mn.gov/elections-voting/how-elections-work/political-parties",
        "source_title": "Minnesota Secretary of State political parties",
        "checked_on": "2026-11-09",
        "address": "7400 Metro Blvd Suite 424, Edina MN 55439",
        "address_tokens": ("7400", "metro", "blvd", "424", "edina", "55439"),
    },
)


def words(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def corroborate(
    payer_text: str, quote: str, *, edge_warning: bool, confidence: float
) -> dict | None:
    """A clipped/low-quality read never becomes a confirmed organization."""
    if edge_warning or confidence < 80:
        return None
    name = words(payer_text).removeprefix("the ")
    text_words = set(words(quote).split())
    for source in SOURCES:
        if name == words(source["name"]) and set(source["address_tokens"]).issubset(
            text_words
        ):
            return {
                key: value for key, value in source.items() if key != "address_tokens"
            } | {
                "basis": "printed_name_and_address",
                "scope": "organization",
            }
    return None
