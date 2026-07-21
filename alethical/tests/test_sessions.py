"""Session-parameterization unit tests (no database required)."""

from __future__ import annotations

from alethical.pipeline.minnesota import BillSearchResult
from alethical.pipeline.sessions import (
    CURRENT_SESSION_DEF,
    DEFAULT_SESSION_CODE,
    LEGISLATIVE_SESSIONS,
    parse_session_code,
    session_def_for_number,
    session_defs_to_ensure,
)


def test_parse_session_code_splits_number_and_year():
    assert parse_session_code("0942025") == (94, 2025)
    assert parse_session_code("0942026") == (94, 2026)
    # The two prior bienniums the corpus now covers.
    assert parse_session_code("0932023") == (93, 2023)
    assert parse_session_code("0932024") == (93, 2024)
    assert parse_session_code("0922021") == (92, 2021)
    assert parse_session_code("0922022") == (92, 2022)


def test_legislative_sessions_cover_the_current_and_two_prior_bienniums():
    by_slug = {d.slug: d for d in LEGISLATIVE_SESSIONS}
    assert set(by_slug) == {"94-2025-regular", "93-2023-regular", "92-2021-regular"}
    assert by_slug["94-2025-regular"].session_number == 94
    assert by_slug["93-2023-regular"].session_number == 93
    assert (
        by_slug["93-2023-regular"].year_start,
        by_slug["93-2023-regular"].year_end,
    ) == (
        2023,
        2024,
    )
    assert (
        by_slug["92-2021-regular"].year_start,
        by_slug["92-2021-regular"].year_end,
    ) == (
        2021,
        2022,
    )
    # Exactly one current biennium, and it is the 2025-2026 one.
    current = [d for d in LEGISLATIVE_SESSIONS if d.is_current]
    assert current == [CURRENT_SESSION_DEF]
    assert CURRENT_SESSION_DEF.slug == "94-2025-regular"


def test_session_def_for_number_maps_legislature_number_to_biennium():
    assert session_def_for_number(93).slug == "93-2023-regular"
    assert session_def_for_number(92).slug == "92-2021-regular"
    assert session_def_for_number(1) is None


def test_session_defs_to_ensure_is_current_plus_target_only():
    # A current-session code ensures only the current biennium row.
    assert session_defs_to_ensure("0942025") == [CURRENT_SESSION_DEF]
    # A historical code ensures the current row AND that biennium's row — never
    # the *other* historical rows (so they don't appear as empty dropdown
    # options before they have bills).
    ensured_93 = session_defs_to_ensure("0932023")
    assert {d.slug for d in ensured_93} == {"94-2025-regular", "93-2023-regular"}
    # Either year of the biennium resolves to the same single row.
    assert session_defs_to_ensure("0932024") == ensured_93
    ensured_92 = session_defs_to_ensure("0922022")
    assert {d.slug for d in ensured_92} == {"94-2025-regular", "92-2021-regular"}


def _result(session_code: str) -> BillSearchResult:
    return BillSearchResult(
        chamber="House",
        file_type="HF",
        file_number=4138,
        description="social media accounts for minors",
        status_xml_uri="https://example/status",
        latest_text_html_uri="https://example/text",
        session_code=session_code,
    )


def test_bill_key_defaults_to_2025_for_backward_compatibility():
    assert DEFAULT_SESSION_CODE == "0942025"
    result = BillSearchResult(
        chamber="House",
        file_type="HF",
        file_number=2136,
        description="",
        status_xml_uri="https://example/status",
        latest_text_html_uri="https://example/text",
    )
    assert result.bill_key == "94-2025-HF2136"
    assert result.target.session_code == "0942025"


def test_bill_key_and_target_follow_the_2026_session_code():
    result = _result("0942026")
    # Must match the canonical key parse_bill_xml derives from the bill's own
    # SESSION_YEAR, so full-session discovery dedup lines up for 2026 bills.
    assert result.bill_key == "94-2026-HF4138"
    assert result.target.session_code == "0942026"


def test_bill_key_prefers_the_year_in_the_status_uri():
    """The Revisor search returns the whole biennium regardless of the year in the
    search code, so the status URI — not the search code — identifies the year."""
    carryover = BillSearchResult(
        chamber="House",
        file_type="HF",
        file_number=2136,
        description="a 2025 bill listed by the 0942026 search",
        status_xml_uri="https://api.revisor.mn.gov/bills/v1/94/2025/0/HF/2136/",
        latest_text_html_uri="https://example/text",
        session_code="0942026",
    )
    assert carryover.bill_key == "94-2025-HF2136"

    introduced_2026 = BillSearchResult(
        chamber="House",
        file_type="HF",
        file_number=4138,
        description="a 2026 bill listed by the 0942025 search",
        status_xml_uri="https://api.revisor.mn.gov/bills/v1/94/2026/0/HF/4138/",
        latest_text_html_uri="https://example/text",
        session_code="0942025",
    )
    assert introduced_2026.bill_key == "94-2026-HF4138"
