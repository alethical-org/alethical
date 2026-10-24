"""Official dated actions supplement, but never replace, full reconciliation."""

from datetime import date
from urllib.parse import parse_qs, urlsplit

import pytest

from alethical.pipeline import minnesota as source


def xml(number, kind="HF"):
    return f"<BILL_RESULT><FILE_TYPE>{kind}</FILE_TYPE><FILE_NUMBER>{number}</FILE_NUMBER><DESCRIPTION>Same wording</DESCRIPTION><STATUS_XML_URI>api.revisor.mn.gov/bills/v1/94/2026/0/{kind}/{number}/</STATUS_XML_URI><LATEST_TEXT_HTML_URI>www.revisor.mn.gov/bills/94/2026/0/{kind}/{number}/versions/latest/</LATEST_TEXT_HTML_URI></BILL_RESULT>"


def body(*rows):
    return (
        "<SEARCH_RESULTS><API_INFO>official</API_INFO>"
        + "".join(rows)
        + "</SEARCH_RESULTS>"
    )


def test_both_chamber_views_are_required_and_dedupe_exact_bill_ids(monkeypatch):
    calls = []

    def fetch(http, url):
        query = parse_qs(urlsplit(url).query)
        calls.append(query)
        return (
            body(xml(1), xml(2, "SF"))
            if query["body"] == ["House"]
            else body(xml(2, "SF"), xml(3, "SF"))
        )

    monkeypatch.setattr(source, "fetch_text", fetch)
    result = source.discover_recent_action_bills(
        None, session_code="0942026", start=date(2026, 5, 1), end=date(2026, 5, 3)
    )
    assert {item.file_type + str(item.file_number) for item in result} == {
        "HF1",
        "SF2",
        "SF3",
    }
    assert {call["body"][0] for call in calls} == {"House", "Senate"}
    assert all(call["biennium[]"] == ["LS94"] for call in calls)


def test_single_day_cap_is_incomplete_even_when_envelope_is_valid(monkeypatch):
    monkeypatch.setattr(
        source, "fetch_text", lambda *a: body(*(xml(n) for n in range(1, 501)))
    )
    with pytest.raises(source.MinnesotaIngestionError, match="single-day cap"):
        source.discover_recent_action_bills(
            None, session_code="0942026", start=date(2026, 5, 1), end=date(2026, 5, 1)
        )


def test_capped_windows_split_dates_without_silently_dropping_a_day(monkeypatch):
    dates = []

    def fetch(http, url):
        query = parse_qs(urlsplit(url).query)
        left, right = query["fromDate"][0], query["toDate"][0]
        if left != right:
            return body(*(xml(n) for n in range(1, 501)))
        dates.append(left)
        return body(xml(int(left.split("/")[1])))

    monkeypatch.setattr(source, "fetch_text", fetch)
    result = source.discover_recent_action_bills(
        None, session_code="0942026", start=date(2026, 5, 1), end=date(2026, 5, 2)
    )
    assert set(dates) == {"05/01/26", "05/02/26"}
    assert len(result) == 2


def test_unknown_session_in_action_response_is_not_filed_under_current_session(
    monkeypatch,
):
    monkeypatch.setattr(
        source,
        "fetch_text",
        lambda *a: body(xml(1).replace("/94/2026/0/", "/94/2026/2/")),
    )
    with pytest.raises(ValueError, match="No legislative session mapped"):
        source.discover_recent_action_bills(
            None, session_code="0942026", start=date(2026, 5, 1), end=date(2026, 5, 1)
        )
