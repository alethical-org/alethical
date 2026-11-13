"""Official catalogue identity and lineage, independently of raw report figures."""

from copy import deepcopy
import hashlib
import json

import pytest

from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.pipeline.election_fec_catalogue import extract_catalogue, report_key


def filing(**changes):
    return {
        "sub_id": "4110520261630865006",
        "committee_id": "C00123456",
        "file_number": 200003,
        "form_type": "F3",
        "report_type": "Q3",
        "coverage_start_date": "2026-07-01",
        "coverage_end_date": "2026-09-30",
        "receipt_date": "2026-10-15T12:05:00",
        "amendment_chain": [200001, 200002, 200003],
        "amendment_version": 2,
        "previous_file_number": 200002,
        "most_recent_file_number": 200003,
        "most_recent": True,
        "is_amended": False,
        "amendment_indicator": "A",
        "treasurer_name": "PRIVATE VALUE MUST NOT ESCAPE",
        **changes,
    }


def prepare(*rows):
    body = json.dumps({"results": list(rows), "pagination": {"count": 900}}).encode()
    source = {
        "authority": "fec",
        "sha256": hashlib.sha256(body).hexdigest(),
        "url": "https://api.open.fec.gov/v1/filings/?cycle=2026",
    }
    return body, source, {"kind": "filing", "sub_id": rows[0]["sub_id"]}


def test_actual_chain_and_received_metadata_keep_exact_report_join():
    result = extract_catalogue(*prepare(filing()))
    assert result.facts == {
        "authority": "fec",
        "account_id": "C00123456",
        "source_report_id": "200003",
        "series_id": "fec:C00123456:200001",
        "report_type": "F3:Q3",
        "period_start": "2026-07-01",
        "period_end": "2026-09-30",
        "received_date": "2026-10-15",
        "effective": True,
        "predecessor_report_key": report_key("C00123456", "200002"),
    }
    quoted = json.loads(result.quote)
    assert quoted["receipt_date"] == "2026-10-15T12:05:00"
    assert quoted["amendment_chain"] == [200001, 200002, 200003]
    assert "PRIVATE" not in result.quote
    assert "complete" not in result.facts
    assert "amount" not in result.facts


def test_original_and_superseded_report_keep_their_own_identity():
    original = filing(
        file_number=200001,
        amendment_chain=[200001],
        amendment_version=0,
        previous_file_number=200001,
        most_recent=False,
        is_amended=True,
        amendment_indicator="N",
    )
    result = extract_catalogue(*prepare(original))
    assert result.facts["predecessor_report_key"] is None
    assert result.facts["effective"] is False
    assert result.facts["series_id"] == "fec:C00123456:200001"
    other = extract_catalogue(*prepare(filing(committee_id="C00987654")))
    assert other.facts["series_id"] != result.facts["series_id"]
    assert other.facts["predecessor_report_key"] != report_key("C00123456", "200002")


@pytest.mark.parametrize(
    "change",
    [
        {"amendment_chain": None},
        {"amendment_chain": [200001, 200003, 200003]},
        {"amendment_chain": [200001, 200002]},
        {"previous_file_number": 200001},
        {"most_recent_file_number": 200004},
        {"is_amended": True},
        {"most_recent": 1},
        {"amendment_version": 1},
        {"amendment_indicator": "N"},
        {"coverage_start_date": "2026-10-01"},
        {"coverage_end_date": "2026-09-31"},
        {"coverage_start_date": None},
        {"receipt_date": None},
        {"form_type": "F6"},
        {"file_number": 200003.0},
        {"file_number": True},
        {"report_type": ""},
    ],
)
def test_conflicting_or_unsupported_metadata_cannot_be_checked(change):
    with pytest.raises(ComparisonImportError):
        extract_catalogue(*prepare(filing(**change)))


@pytest.mark.parametrize(
    "url",
    [
        "https://api.open.fec.gov.attacker.test/v1/filings/",
        "https://api.open.fec.gov/v1/schedules/schedule_e/",
        "http://api.open.fec.gov/v1/filings/",
        "https://user@api.open.fec.gov/v1/filings/",
        "https://api.open.fec.gov:444/v1/filings/",
        "https://api.open.fec.gov/v1/filings/?api_key=private",
    ],
)
def test_wrong_publisher_path_and_credentials_rejected(url):
    body, source, locator = prepare(filing())
    source["url"] = url
    with pytest.raises(ComparisonImportError):
        extract_catalogue(body, source, locator)


def test_duplicate_or_missing_source_row_and_changed_bytes_rejected():
    with pytest.raises(ComparisonImportError, match="duplicated"):
        extract_catalogue(*prepare(filing(), deepcopy(filing())))
    body, source, locator = prepare(filing())
    with pytest.raises(ComparisonImportError, match="retained"):
        extract_catalogue(body + b" ", source, locator)
    locator["sub_id"] = "1"
    with pytest.raises(ComparisonImportError, match="missing"):
        extract_catalogue(body, source, locator)


def test_duplicate_json_keys_cannot_override_source_fields():
    body, source, locator = prepare(filing())
    body = body.replace(
        b'"file_number": 200003', b'"file_number": 200004, "file_number": 200003'
    )
    source["sha256"] = hashlib.sha256(body).hexdigest()
    with pytest.raises(ComparisonImportError, match="Duplicate field"):
        extract_catalogue(body, source, locator)
