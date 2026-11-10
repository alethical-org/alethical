"""Source-checked organization evidence for automatic mail disclosure matching.

Records identify organizations only, never a campaign account or the source of
funds for a particular piece. Comparison uses the disclosure itself, not a
recipient address or a nearby candidate's name. Add records only with checked
primary-source evidence; preserve the original quote separately.
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit

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


RELATED_RECORDS = (
    {
        "name": "Our America Minnesota Political Fund",
        "registration_number": "30807",
        "domain": "joinouramerica.org",
        "source_url": "https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/political-committee-fund/30807/2026/",
        "checked_on": "2026-11-09",
        "basis": "same_website",
        "scope": "related_record",
        "roles": [{"name": "Ed Molchany", "role": "Treasurer"}],
    },
)


def related_records(quote: str, payer_text: str | None = None) -> list[dict]:
    """A website printed beside this payer supports a related record only.

    A URL elsewhere in a crop is not that payer's website. Retain the complete
    disclosure separately; compare only a URL immediately after the known printed
    payer name, including a wrapped line break.
    """
    match = re.search(
        r"\bpaid\s+for\s+by\s+(Our\s+America)\s*,?\s+(https?://[^\s<>\"']+|(?:www\.)?joinouramerica\.org[^\s<>\"']*)",
        quote,
        re.I,
    )
    if match is None or (payer_text is not None and words(payer_text) != "our america"):
        return []
    token = match.group(2).rstrip(".,;:)")
    try:
        parsed = urlsplit(token if "://" in token else "//" + token)
        host = (parsed.hostname or "").removeprefix("www.").lower()
    except ValueError:
        return []
    if parsed.username is not None or parsed.password is not None:
        return []
    return [dict(record) for record in RELATED_RECORDS if record["domain"] == host]


CANDIDATE_RECORDS = (
    {
        "printed_alias": "restore sanity",
        "name": "Restore Sanity",
        "registration_number": "41412",
        "source_url": "https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/political-committee-fund/41412/2026/",
        "checked_on": "2026-11-09",
        "basis": "same_committee_name",
        "scope": "candidate_record",
        "roles": [
            {"name": "Tyler Carlson", "role": "Chair"},
            {"name": "Charles Gantt", "role": "Treasurer"},
        ],
    },
    {
        "printed_alias": "heintzeman for senate",
        "name": "Heintzeman (Keri) for Senate",
        "registration_number": "19205",
        "source_url": "https://register.cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/19205/2026/",
        "checked_on": "2026-11-09",
        "basis": "similar_committee_name",
        "scope": "candidate_record",
        "person": "Keri Heintzeman",
        "office": "Senate District 6",
    },
)


def sourced_candidates(payer_text: str) -> list[dict]:
    """Checked official alternatives retain an explicit unconfirmed scope."""
    return [
        {key: value for key, value in record.items() if key != "printed_alias"}
        for record in CANDIDATE_RECORDS
        if words(payer_text) == record["printed_alias"]
    ]
