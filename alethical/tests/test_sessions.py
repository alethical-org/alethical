"""Session-parameterization unit tests (no database required)."""

from __future__ import annotations

from alethical.pipeline.minnesota import BillSearchResult, parse_bill_xml
from alethical.pipeline.sessions import (
    DEFAULT_SESSION_CODE,
    build_bill_key,
    parse_session_code,
    special_session_number,
)


def test_parse_session_code_splits_number_and_year():
    assert parse_session_code("0942025") == (94, 2025)
    assert parse_session_code("0942026") == (94, 2026)
    # The leading digit is the special-session number, not a zero-pad, so a
    # special-session code must still read as the 94th Legislature — not the 194th.
    assert parse_session_code("1942025") == (94, 2025)
    assert parse_session_code("7912020") == (91, 2020)


def test_special_session_number_reads_the_leading_digit():
    """Codes taken verbatim from the Revisor's own search form (#746)."""
    assert special_session_number("0942025") == 0  # 94th Legislature, 2025-2026
    assert special_session_number("1942025") == 1  # 2025 1st Special Session
    assert special_session_number("1922021") == 1  # 2021 1st Special Session
    assert special_session_number("7912020") == 7  # 2020 7th Special Session


def test_build_bill_key_leaves_every_regular_session_key_unchanged():
    """The suffix appears only for a special session.

    This is the compatibility guarantee the whole change rests on: `bill_key` is
    unique and drives ingestion dedup, so if a regular-session key changed shape,
    a re-ingest would orphan all 10,471 production bills instead of updating them.
    """
    assert build_bill_key(94, 2025, "HF", 5) == "94-2025-HF5"
    assert build_bill_key(94, 2025, "HF", 5, 0) == "94-2025-HF5"
    assert build_bill_key("94", "2026", "SF", "1599", "0") == "94-2026-SF1599"
    # Same Legislature, same year, same file number — a DIFFERENT bill.
    assert build_bill_key(94, 2025, "HF", 5, 1) == "94-2025s1-HF5"
    assert build_bill_key(94, 2025, "HF", 5, 1) != build_bill_key(94, 2025, "HF", 5)


def test_bill_key_from_status_uri_carries_the_special_session():
    """The status URI's third segment is the special-session number. Verified live:
    /94/2025/0/HF/5/ is a tax bill and /94/2025/1/HF/5/ is a K12 education bill, so
    collapsing them onto one key would merge two unrelated bills."""

    def result(uri: str) -> BillSearchResult:
        return BillSearchResult(
            chamber="House",
            file_type="HF",
            file_number=5,
            description="",
            status_xml_uri=uri,
            latest_text_html_uri="https://example/text",
        )

    regular = result("https://api.revisor.mn.gov/bills/v1/94/2025/0/HF/5/")
    special = result("https://api.revisor.mn.gov/bills/v1/94/2025/1/HF/5/")
    assert regular.bill_key == "94-2025-HF5"
    assert special.bill_key == "94-2025s1-HF5"

    # A URI that does not match falls back to the search code, which must read the
    # special session from its leading digit rather than mangling the Legislature.
    fallback = BillSearchResult(
        chamber="House",
        file_type="HF",
        file_number=5,
        description="",
        status_xml_uri="https://example/no-session-segment",
        latest_text_html_uri="https://example/text",
        session_code="1942025",
    )
    assert fallback.bill_key == "94-2025s1-HF5"


def test_parse_bill_xml_keys_a_special_session_bill_apart():
    """SESSION_TYPE in the canonical XML is the special-session number."""

    def xml(session_type: str) -> str:
        return f"""<BILL>
            <FILE_TYPE>HF</FILE_TYPE><FILE_NUMBER>5</FILE_NUMBER>
            <SESSION_NUMBER>94</SESSION_NUMBER><SESSION_YEAR>2025</SESSION_YEAR>
            <SESSION_TYPE>{session_type}</SESSION_TYPE>
            <DESCRIPTION>x</DESCRIPTION>
        </BILL>"""

    assert parse_bill_xml(xml("0"))["bill_key"] == "94-2025-HF5"
    assert parse_bill_xml(xml("1"))["bill_key"] == "94-2025s1-HF5"


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
