"""Session-parameterization unit tests (no database required)."""

from __future__ import annotations

from alethical.pipeline.minnesota import BillSearchResult
from alethical.pipeline.sessions import (
    DEFAULT_SESSION_CODE,
    parse_session_code,
)


def test_parse_session_code_splits_number_and_year():
    assert parse_session_code("0942025") == (94, 2025)
    assert parse_session_code("0942026") == (94, 2026)


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
