"""Synthetic notice fixtures follow the retained official 8.5 workbook."""

import hashlib
import json

import pytest

from alethical.pipeline.election_fec_notices import (
    CatalogueSource,
    NoticeSourceError,
    assess_notice_versions,
    parse_fec_notice,
)


def record(width, values):
    cells = [""] * width
    for column, value in values.items():
        cells[column - 1] = value
    return "\x1c".join(cells)


def source(*, amendment=False, schedules=None, form="F6N", version="8.5"):
    if amendment:
        form = "F6A"
    header = record(
        8,
        {
            1: "HDR",
            2: "FEC",
            3: version,
            6: "FEC-100" if amendment else "",
            7: "1" if amendment else "",
        },
    )
    if form == "F99":
        cover = record(
            17,
            {
                1: form,
                2: "C00123456",
                3: "Synthetic committee",
                9: "Reader",
                10: "Pat",
                14: "20261101",
                15: "MST",
            },
        )
        tail = (
            ["[BEGINTEXT]", "Refund $100 mentioned in prose", "", "[ENDTEXT]"]
            if schedules is None
            else schedules
        )
    else:
        cover = record(
            24,
            {
                1: form,
                2: "C00123456",
                3: "20261030" if amendment else "",
                4: "Synthetic committee",
                10: "H6MN01111",
                11: "Example",
                12: "Pat",
                16: "H",
                17: "MN",
                18: "01",
                19: "Reader",
                20: "Robin",
                24: "20261101",
            },
        )
        tail = (
            [
                record(
                    20,
                    {
                        1: "F65",
                        2: "C00123456",
                        3: "TX1",
                        4: "PAC",
                        5: '"Synthetic PAC"',
                        15: "12345    ",
                        16: "C00654321",
                        17: "20261030",
                        18: "01000.00",
                    },
                )
            ]
            if schedules is None
            else schedules
        )
    return ("\r\n".join([header, cover, *tail]) + "\r\n").encode()


def parse(body, number="101"):
    return parse_fec_notice(
        body, number, expected_sha256=hashlib.sha256(body).hexdigest()
    )


def catalogue(rows):
    body = json.dumps({"results": rows}).encode()
    return CatalogueSource(body, hashlib.sha256(body).hexdigest())


def metadata(number=101, *, amendment=False, **changes):
    value = {
        "sub_id": str(number + 1000),
        "file_number": number,
        "committee_id": "C00123456",
        "form_type": "F6",
        "receipt_date": "2026-11-01T00:00:00",
        "amendment_chain": [100, number] if amendment else [number],
        "amendment_version": 1 if amendment else 0,
        "previous_file_number": 100 if amendment else number,
        "most_recent_file_number": number,
        "most_recent": None,
        "amendment_indicator": None,
    }
    value.update(changes)
    return value


def test_notice_is_nonadditive_preserves_literal_cells_and_physical_rows():
    result = parse(source())
    assert result.form == "F6N"
    row = result.contributions[0]
    assert row.kind == "contribution_notice"
    assert row.row == 3
    assert row.facts["amount_literal"] == "01000.00"
    assert row.facts["amount_decimal"] == "1000.00"
    assert row.facts["organization_name"] == '"Synthetic PAC"'
    assert row.facts["postal_code"] == "12345    "
    assert row.facts["additive"] is False
    assert result.cover.facts["candidate_claim"]["source_candidate_id"] == "H6MN01111"
    assert "period_start" not in result.cover.facts
    assert "effective" not in result.cover.facts
    assert json.loads(row.quote)["cells"][17]["raw"] == "01000.00"


def test_correspondence_never_extracts_money_and_keeps_blank_lines():
    result = parse(source(form="F99"))
    assert result.contributions == ()
    assert result.correspondence.facts["text"] == "Refund $100 mentioned in prose\n"
    assert result.correspondence.row == 3
    assert result.correspondence.facts["additive"] is False


@pytest.mark.parametrize(
    "mutation",
    [
        lambda b: b.replace(b"C00123456\x1cTX1", b"C00999999\x1cTX1"),
        lambda b: b.replace(b"01000.00", b"NaN"),
        lambda b: b.replace(b"01000.00", b"1e3"),
        lambda b: b.replace(b"20261030\x1c01000", b"20260230\x1c01000"),
        lambda b: b.replace(b"\x1cPAC\x1c", b"\x1cBAD\x1c"),
        lambda b: b.replace(b"H6MN01111", b"C00123456"),
        lambda b: b.replace(b"\x1cH\x1cMN\x1c01", b"\x1cQ\x1cMN\x1c01"),
        lambda b: b.replace(b"\x1cTX1\x1c", b"\x1c\x1c"),
        lambda b: b + b"F6N\x1cC00123456\n",
        lambda b: b + b"SB17\x1cC00123456\n",
        lambda b: b.replace(b"8.5", b"8.4", 1),
        lambda b: b.replace(b"\r\n", b"\x1cEXTRA\r\n", 1),
        lambda b: b + b.split(b"\r\n")[2] + b"\n",
    ],
)
def test_malformed_notice_fails_closed(mutation):
    with pytest.raises(NoticeSourceError):
        parse(mutation(source()))


def test_original_hash_required_and_changed_source_rejected():
    with pytest.raises(NoticeSourceError):
        parse_fec_notice(source(), "101", expected_sha256="0" * 64)
    with pytest.raises(NoticeSourceError):
        parse(source(), "0101")


@pytest.mark.parametrize(
    "tail",
    [
        ["hello"],
        ["[ENDTEXT]", "x", "[BEGINTEXT]"],
        ["[BEGINTEXT]", "x", "[BEGINTEXT]", "[ENDTEXT]"],
        ["[BEGINTEXT]", "x", "[ENDTEXT]", "extra"],
        ["[BEGINTEXT]", "x" * 20001, "[ENDTEXT]"],
        ["[BEGINTEXT]", "bad\x00text", "[ENDTEXT]"],
    ],
)
def test_text_boundaries_are_strict(tail):
    with pytest.raises(NoticeSourceError):
        parse(source(form="F99", schedules=tail))


def test_notice_text_is_evidence_not_refund():
    text = record(
        6, {1: "TEXT", 2: "C00123456", 3: "X1", 5: "F6N", 6: "Returned on 10/30/2026"}
    )
    result = parse(source(schedules=[text]))
    assert result.contributions == ()
    assert result.text_attachments[0].facts["text"] == "Returned on 10/30/2026"
    assert result.text_attachments[0].facts["additive"] is False
    with pytest.raises(NoticeSourceError):
        parse(source(schedules=[text.replace("C00123456", "C00999999")]))


def test_missing_catalogue_is_explicit_and_no_latest_inference():
    result = assess_notice_versions((parse(source()),), ())
    assert result[0].holds == ("catalogue_missing",)
    assert result[0].latest_file_number is None


def test_amendment_keeps_conflicting_date_without_changing_chain():
    first, amended = parse(source(), "100"), parse(source(amendment=True), "101")
    cat = catalogue(
        [
            metadata(
                100, receipt_date="2026-10-29T00:00:00", most_recent_file_number=101
            ),
            metadata(101, amendment=True),
        ]
    )
    result = assess_notice_versions((first, amended), (cat,))
    assert result[1].chain == ("100", "101")
    assert "original_amendment_date_conflict" in result[1].holds
    assert result[1].source_most_recent is None
    assert result[1].latest_file_number == "101"


@pytest.mark.parametrize(
    "changes",
    [
        {"committee_id": "C00999999"},
        {"amendment_chain": [101, 101]},
        {"amendment_chain": [99, 101]},
        {"previous_file_number": 99},
        {"most_recent": True, "most_recent_file_number": 999},
        {"amendment_version": 2},
        {"form_type": "F3"},
    ],
)
def test_conflicting_catalogue_is_rejected(changes):
    with pytest.raises(NoticeSourceError):
        assess_notice_versions(
            (parse(source(amendment=True)),),
            (catalogue([metadata(amendment=True, **changes)]),),
        )


def test_catalogue_original_hash_and_duplicate_rows_rejected():
    filing = parse(source())
    bad = catalogue([metadata()])
    with pytest.raises(NoticeSourceError):
        assess_notice_versions((filing,), (CatalogueSource(bad.body, "0" * 64),))
    with pytest.raises(NoticeSourceError):
        assess_notice_versions((filing,), (catalogue([metadata(), metadata()]),))


def test_missing_predecessor_does_not_approve_amendment():
    result = assess_notice_versions(
        (parse(source(amendment=True)),), (catalogue([metadata(amendment=True)]),)
    )
    assert "original_notice_not_retained" in result[0].holds


def test_valid_quoted_text_length_counts_decoded_field_but_preserves_original():
    original = source()
    cells = original.split(b"\r\n")
    row = cells[2].split(b"\x1c")
    row[18] = b'"' + b"E" * 38 + b'"'
    cells[2] = b"\x1c".join(row)
    result = parse(b"\r\n".join(cells))
    assert result.contributions[0].facts["employer"] == '"' + "E" * 38 + '"'
    row[18] = b'"' + b"E" * 39 + b'"'
    cells[2] = b"\x1c".join(row)
    with pytest.raises(NoticeSourceError):
        parse(b"\r\n".join(cells))


def test_new_notice_zero_header_sequence_is_literal_not_amendment():
    lines = source().split(b"\r\n")
    header = lines[0].split(b"\x1c")
    header[6] = b"0"
    lines[0] = b"\x1c".join(header)
    result = parse(b"\r\n".join(lines))
    assert result.amendment_number is None
    assert result.header.facts["amendment_number_literal"] == "0"


def test_identical_catalogue_row_across_pages_keeps_both_sources():
    first = catalogue([metadata()])
    second = catalogue([metadata(), metadata(999)])
    result = assess_notice_versions((parse(source()),), (first, second))
    assert result[0].catalogue_copies == (
        (first.sha256, "1101"),
        (second.sha256, "1101"),
    )
    with pytest.raises(NoticeSourceError):
        assess_notice_versions(
            (parse(source()),),
            (
                first,
                catalogue([metadata(receipt_date="2026-11-02T00:00:00")]),
            ),
        )


def test_omitted_trailing_fields_are_distinct_from_explicit_blank_quotes():
    lines = source().split(b"\r\n")
    lines[0] = b"\x1c".join(lines[0].split(b"\x1c")[:5])
    result = parse(b"\r\n".join(lines))
    cells = json.loads(result.header.quote)["cells"]
    assert cells[4]["present"] is True
    assert cells[5]["present"] is False
    assert json.loads(parse(source()).header.quote)["cells"][5]["present"] is True


def test_latest_notice_cannot_be_another_series_of_same_filer():
    notices = (parse(source(), "101"), parse(source(), "999"))
    with pytest.raises(NoticeSourceError):
        assess_notice_versions(
            notices,
            (catalogue([metadata(most_recent_file_number=999), metadata(999)]),),
        )


def test_quoted_text_invalid_escaping_and_extra_schedule_columns_rejected():
    lines = source().split(b"\r\n")
    line = lines[2].split(b"\x1c")
    line[4] = b'"unfinished'
    lines[2] = b"\x1c".join(line)
    with pytest.raises(NoticeSourceError):
        parse(b"\r\n".join(lines))
    with pytest.raises(NoticeSourceError):
        parse(source().replace(b"\x1c\r\n", b"\x1cEXTRA\x1cFIELD\r\n"))


def test_exact_record_lookup_rechecks_original_and_rejects_wrong_locator():
    from alethical.pipeline.election_fec_notices import extract_fec_notice_record

    body = source()
    digest = hashlib.sha256(body).hexdigest()
    record = extract_fec_notice_record(
        body, "101", {"kind": "contribution_notice", "row": 3}, expected_sha256=digest
    )
    assert record.facts["transaction_id"] == "TX1"
    for locator in (
        {"kind": "contribution_notice", "row": 4},
        {"kind": "payment", "row": 3},
        {"kind": "contribution_notice", "row": True},
        {"kind": "contribution_notice", "row": 3, "page": 1},
    ):
        with pytest.raises(NoticeSourceError):
            extract_fec_notice_record(body, "101", locator, expected_sha256=digest)
    with pytest.raises(NoticeSourceError):
        extract_fec_notice_record(
            body.replace(b"01000.00", b"02000.00"),
            "101",
            {"kind": "contribution_notice", "row": 3},
            expected_sha256=digest,
        )
