"""Synthetic records follow the retained official 8.4/8.5 column layouts.

No real donor, candidate, payee, address or filing is retained in these tests.
"""

from copy import deepcopy
import hashlib
import json

import pytest

from alethical.pipeline.election_fec_sources import (
    FecSourceError,
    extract_fec_source,
    parse_filing,
)


def record(width, fields):
    cells = [""] * width
    for column, value in fields.items():
        cells[column - 1] = value
    return "\x1c".join(cells)


def filing(
    cover=None, schedules=(), *, version="8.5", original="", sequence="", newline="\r\n"
):
    if cover is None:
        cover = report()
    header = record(
        8,
        {
            1: "HDR",
            2: "FEC",
            3: version,
            4: "Synthetic",
            5: "1",
            6: original,
            7: sequence,
        },
    )
    return (newline.join([header, cover, *schedules]) + newline).encode()


def report(form="F3", **overrides):
    fields = {1: f"{form}N", 2: "C00123456", 3: "Synthetic Campaign"}
    if form == "F3":
        fields.update(
            {
                12: "Q3",
                16: "20260701",
                17: "20260930",
                23: "20261012",
                39: "00123.40",
                46: "200.00",
                47: "25.00",
                57: "75.00",
                58: "100.00",
                62: "225.00",
                75: "999.00",
                82: "900.00",
                93: "888.00",
            }
        )
        width = 93
    else:
        fields.update(
            {
                10: "Q3",
                14: "20260701",
                15: "20260930",
                22: "20261012",
                23: "100.00",
                27: "225.00",
                35: "123.40",
                45: "200.00",
                46: "190.00",
                50: "25.00",
                66: "75.00",
                67: "70.00",
                71: "20.00",
                75: "2026",
                95: "999.00",
            }
        )
        width = 123
    fields.update({int(key): value for key, value in overrides.items()})
    return record(width, fields)


def spending(schedule="SB17", **overrides):
    fields = {
        1: schedule,
        2: "C00123456",
        3: "SYNTHETIC-T1",
        6: "ORG",
        7: "Synthetic Print Shop",
        13: "Private payee address",
        18: "G2026",
        20: "20260912",
        21: "100.01",
    }
    if schedule == "SE":
        fields.update(
            {
                22: "20260910",
                23: "444.00",
                24: "Print advertising",
                27: "S",
                28: "H6MN01111",
                29: "Example",
                30: "Alex",
                34: "H",
                35: "01",
                36: "MN",
                43: "X",
                44: "Memo item",
            }
        )
    else:
        fields.update(
            {
                23: "Printing",
                25: "C00654321",
                26: "Synthetic Recipient",
                27: "H6MN01111",
                28: "Example",
                29: "Alex",
                33: "H",
                34: "MN",
                35: "01",
                42: "X",
                43: "Memo item",
            }
        )
    fields.update({int(key): value for key, value in overrides.items()})
    return record(44, fields)


def source(body):
    return {
        "authority": "fec",
        "url": "https://docquery.fec.gov/dcdev/posted/1234567.fec",
        "sha256": hashlib.sha256(body).hexdigest(),
        "media_type": "binary/octet-stream",
        "copied_at": "2026-11-11T22:00:00+00:00",
    }


def by_kind(parsed, kind):
    return [row for row in parsed.records if row.locator["kind"] == kind]


@pytest.mark.parametrize("version", ["8.4", "8.5"])
@pytest.mark.parametrize("form", ["F3", "F3X"])
def test_report_period_measures_are_separate_from_cumulative_and_each_other(
    version, form
):
    body = filing(report(form), version=version)
    parsed = parse_filing(body, "1234567")
    cover = by_kind(parsed, "cover")[0]
    figures = {r.facts["measure"]: r for r in by_kind(parsed, "figure")}
    assert parsed.version == version
    assert cover.facts["report_type"] == f"{form}:Q3"
    assert figures["fec_contributions"].facts["value"] == "123.40"
    assert figures["fec_receipts"].facts["value"] == "200.00"
    assert figures["fec_operating_expenditures"].facts["value"] == "25.00"
    assert figures["fec_total_disbursements"].facts["value"] == "75.00"
    assert figures["fec_cash_on_hand_close"].facts["value"] == "225.00"
    assert cover.facts["cumulative_start"] == ("2026-01-01" if form == "F3X" else None)
    assert all(
        r.facts["period_start"] == "2026-07-01"
        for r in figures.values()
        if r.facts["basis"] == "report_period"
    )
    assert all(r.facts["period_end"] == "2026-09-30" for r in figures.values())
    assert all(r.facts["source_report_id"] == "1234567" for r in figures.values())
    assert "999.00" in cover.facts["amounts_by_column"].values()
    assert all(
        r.facts["value"] != "999.00"
        for r in figures.values()
        if r.facts["basis"] == "report_period"
    )
    if form == "F3X":
        ytd = figures["fec_ytd_receipts"]
        assert ytd.facts["value"] == "999.00"
        assert ytd.facts["period_start"] == "2026-01-01"
        assert ytd.facts["source_column"] == 95
        assert ytd.facts["basis"] == "calendar_year_to_date"
        assert any(
            cell["column"] == 75 and cell["raw"] == "2026"
            for cell in json.loads(ytd.quote)["cells"]
        )


def test_explicit_zero_missing_and_negative_are_preserved_without_float():
    body = filing(report(**{"39": "0.00", "46": "", "47": "-99.01"}))
    figures = {
        r.facts["measure"]: r.facts["value"]
        for r in by_kind(parse_filing(body, "1234567"), "figure")
    }
    assert figures["fec_contributions"] == "0.00"
    assert "fec_receipts" not in figures
    assert figures["fec_operating_expenditures"] == "-99.01"


@pytest.mark.parametrize(
    "amount",
    [
        "1.2",
        "1.234",
        "1,000.00",
        "$1.00",
        " 1.00",
        "NaN",
        "1e2",
        "+1.00",
        "1234567890.00",
    ],
)
def test_invalid_money_is_not_silently_repaired(amount):
    with pytest.raises(FecSourceError, match="invalid|amount"):
        parse_filing(filing(report(**{"46": amount})), "1234567")


@pytest.mark.parametrize(
    "column,value",
    [
        (16, "20260230"),
        (16, "2026-701"),
        (16, ""),
        (17, "20260630"),
        (23, "20261312"),
        (2, "CnotanID1"),
    ],
)
def test_bad_cover_identity_or_actual_dates_refuse(column, value):
    with pytest.raises(FecSourceError):
        parse_filing(filing(report(**{str(column): value})), "1234567")


def test_amendment_header_is_retained_without_claiming_an_immediate_predecessor():
    parsed = parse_filing(
        filing(report(**{"1": "F3A"}), original="FEC-7654321", sequence="3"), "1234567"
    )
    assert parsed.original_report_id == "FEC-7654321"
    assert parsed.amendment_number == "3"
    assert "effective" not in by_kind(parsed, "cover")[0].facts
    assert "predecessor_report_key" not in by_kind(parsed, "cover")[0].facts
    checked = extract_fec_source(
        filing(), source(filing()), {"kind": "report", "row": 2}
    )
    assert checked.facts == {
        "authority": "fec",
        "account_id": "C00123456",
        "source_report_id": "1234567",
        "report_type": "F3:Q3",
        "period_start": "2026-07-01",
        "period_end": "2026-09-30",
    }


def test_schedule_b_preserves_refund_and_beneficiary_without_inventing_contribution():
    parsed = parse_filing(
        filing(
            schedules=[
                spending("SB20A", **{"21": "-100.01", "4": "SYNTHETIC-T0", "5": "SB17"})
            ]
        ),
        "1234567",
    )
    payment = by_kind(parsed, "payment")[0]
    assert payment.facts["direction"] == "unknown"
    assert payment.facts["transaction_type"] == "F3:SB20A"
    assert payment.facts["target_source_candidate_id"] == "H6MN01111"
    assert payment.facts["beneficiary_committee_id"] == "C00654321"
    assert payment.facts["amount"] == "-100.01"
    assert payment.facts["memo"]["code"] == "X"
    assert payment.facts["memo"]["back_reference_transaction_id"] == "SYNTHETIC-T0"
    assert payment.locator == {"kind": "payment", "row": 3}


@pytest.mark.parametrize(
    "code,direction",
    [("S", "independent_for"), ("O", "independent_against"), ("", "unknown")],
)
def test_schedule_e_exact_direction_dates_and_cumulative_stay_distinct(code, direction):
    body = filing(report("F3X"), [spending("SE", **{"27": code})])
    payment = by_kind(parse_filing(body, "1234567"), "payment")[0]
    assert payment.facts["direction"] == direction
    assert payment.facts["date"] == "2026-09-12"
    assert payment.facts["disbursement_date"] == "2026-09-10"
    assert payment.facts["calendar_ytd_per_election_office"] == "444.00"
    assert payment.facts["amount"] == "100.01"
    assert payment.facts["transaction_type"] == "F3X:SE"
    checked = extract_fec_source(body, source(body), payment.locator)
    assert "calendar_ytd_per_election_office" not in checked.facts
    assert checked.facts["amount"] == "100.01"


@pytest.mark.parametrize(
    "overrides",
    [
        {"27": "F"},
        {"20": "", "22": ""},
        {"20": "20260230"},
        {"2": "C00654321"},
        {"43": "Y"},
        {"28": "Hbad-ID!!"},
        {"21": ""},
    ],
)
def test_schedule_e_malformed_fields_refuse(overrides):
    body = filing(report("F3X"), [spending("SE", **overrides)])
    with pytest.raises(FecSourceError):
        parse_filing(body, "1234567", strict_schedules=True)
    parsed = parse_filing(body, "1234567")
    assert not by_kind(parsed, "payment")
    assert len(parsed.rejected_rows) == 1
    assert parsed.rejected_rows[0].row == 3
    assert by_kind(parsed, "figure")
    with pytest.raises(FecSourceError, match="Locator"):
        extract_fec_source(body, source(body), {"kind": "payment", "row": 3})


def test_no_candidate_id_remains_unmatched_even_when_name_is_the_same():
    parsed = parse_filing(
        filing(report("F3X"), [spending("SE", **{"28": ""})]), "1234567"
    )
    assert by_kind(parsed, "payment")[0].facts["target_source_candidate_id"] is None


def test_duplicate_transactions_and_unknown_columns_refuse():
    with pytest.raises(FecSourceError, match="Duplicate"):
        parse_filing(
            filing(schedules=[spending(), spending()]), "1234567", strict_schedules=True
        )
    duplicate = parse_filing(filing(schedules=[spending(), spending()]), "1234567")
    assert not by_kind(duplicate, "payment")
    assert [r.row for r in duplicate.rejected_rows] == [3, 4]
    with pytest.raises(FecSourceError, match="unspecified columns"):
        parse_filing(filing(report() + "\x1cunexpected"), "1234567")
    with pytest.raises(FecSourceError, match="unspecified columns"):
        parse_filing(
            filing(schedules=[spending() + "\x1cunexpected"]),
            "1234567",
            strict_schedules=True,
        )


def test_valid_cover_survives_bad_schedule_and_every_nonempty_row_is_accounted_for():
    unsupported = record(46, {1: "SA11AI", 2: "C00123456", 3: "PRIVATE-DONOR"})
    bad = spending(**{"11": "Overlong synthetic prefix"})
    unknown = record(8, {1: "SUNKNOWN", 2: "C00123456"})
    valid = spending(**{"3": "SYNTHETIC-T2"})
    body = filing(schedules=[unsupported, bad, unknown, valid])
    parsed = parse_filing(body, "1234567")
    assert [r.row for r in parsed.unextracted_rows] == [3]
    assert [r.row for r in parsed.rejected_rows] == [4, 5]
    assert [r.locator["row"] for r in by_kind(parsed, "payment")] == [6]
    checked = extract_fec_source(
        body, source(body), {"kind": "figure", "row": 2, "column": 46}
    )
    assert checked.facts["value"] == "200.00"


def organization(**overrides):
    fields = {
        1: "F1N",
        2: "C00123456",
        4: "Synthetic Campaign",
        6: "Private candidate address",
        15: "20250102",
        21: "20250102",
        22: "A",
        23: "H6MN01111",
        24: "Example",
        25: "Alex",
        29: "H",
        30: "MN",
        31: "01",
    }
    fields.update({int(key): value for key, value in overrides.items()})
    return record(101, fields)


def test_f1_designation_never_exports_addresses_or_assumes_account_dates():
    body = filing(organization())
    identity = by_kind(parse_filing(body, "1234567"), "identity")[0]
    assert identity.facts["designation"] == "principal"
    checked = extract_fec_source(body, source(body), {"kind": "account", "row": 2})
    assert checked.facts["source_candidate_id"] == "H6MN01111"
    assert checked.facts["candidate_name"] == "Alex Example"
    assert "period_start" not in checked.facts
    assert "period_end" not in checked.facts
    assert "Private candidate address" not in checked.quote
    body = filing(organization(**{"22": "C"}))
    assert (
        by_kind(parse_filing(body, "1234567"), "identity")[0].facts["designation"]
        == "not_an_authorized_designation"
    )
    with pytest.raises(FecSourceError, match="not an authorized"):
        extract_fec_source(body, source(body), {"kind": "account", "row": 2})


@pytest.mark.parametrize("version", ["8.4", "8.5"])
def test_f1s_version_specific_columns_do_not_shift_candidate_ids(version):
    shift = int(version == "8.5")
    fields = {
        1: "F1S",
        2: "C00123456",
        3: "Synthetic Joint Participant",
        4: "C00654321",
        5 + shift: "C00111111",
        6 + shift: "Synthetic Affiliate",
        7 + shift: "H6MN02222",
        18 + shift: "AFF",
    }
    if shift:
        fields[5] = "N"
    parsed = parse_filing(
        filing(organization(), [record(36 + shift, fields)], version=version), "1234567"
    )
    supplement = by_kind(parsed, "organization_supplement")[0]
    assert supplement.facts["affiliated_candidate_id"] == "H6MN02222"
    assert supplement.facts["affiliated_committee_id"] == "C00111111"
    assert supplement.facts["joint_participant_type"] == ("N" if shift else None)


def test_f2_explicit_designation_and_f2s_do_not_merge_names():
    cover = record(
        43,
        {
            1: "F2N",
            2: "H6MN01111",
            3: "Example",
            4: "Alex",
            14: "Private candidate address",
            19: "IND",
            20: "H",
            21: "MN",
            22: "01",
            23: "2026",
            24: "C00123456",
            25: "Synthetic Campaign",
            31: "C00654321",
            32: "Synthetic Authorized Campaign",
            43: "20250102",
        },
    )
    supplement = record(
        9, {1: "F2S", 2: "H6MN01111", 3: "C00111111", 4: "Synthetic Campaign"}
    )
    parsed = parse_filing(filing(cover, [supplement]), "1234567")
    identity = by_kind(parsed, "identity")[0]
    assert identity.facts["principal_account_id"] == "C00123456"
    assert identity.facts["authorized_account_id"] == "C00654321"
    assert by_kind(parsed, "candidacy_supplement")[0].facts["account_id"] == "C00111111"
    assert "Private candidate address" not in identity.quote

    body = filing(cover, [supplement])
    principal = extract_fec_source(
        body, source(body), {"kind": "account", "row": 2, "designation": "principal"}
    )
    assert principal.facts["account_id"] == "C00123456"
    designation = extract_fec_source(
        body,
        source(body),
        {"kind": "designation", "row": 2, "designation": "authorized"},
    )
    assert designation.facts == {
        "authority": "fec",
        "account_id": "C00654321",
        "source_candidate_id": "H6MN01111",
        "office": "H",
        "state": "MN",
        "district": "01",
        "election_year": 2026,
    }
    extra_account = extract_fec_source(
        body, source(body), {"kind": "account", "row": 3}
    )
    assert extra_account.facts["account_id"] == "C00111111"
    assert extra_account.facts["candidate_name"] == "Alex Example"
    assert {c["row"] for c in json.loads(extra_account.quote)["cells"]} == {2, 3}


def test_f1_designation_proves_exact_office_but_does_not_invent_election_year():
    body = filing(organization())
    checked = extract_fec_source(body, source(body), {"kind": "designation", "row": 2})
    assert checked.facts == {
        "authority": "fec",
        "account_id": "C00123456",
        "source_candidate_id": "H6MN01111",
        "office": "H",
        "state": "MN",
        "district": "01",
    }


def test_publisher_is_fixed_by_official_source_and_header_and_cached_facts_cannot_be_mutated():
    body = filing()
    checked = extract_fec_source(body, source(body), {"kind": "authority", "row": 1})
    assert checked.facts == {
        "key": "fec",
        "name": "Federal Election Commission",
        "jurisdiction": "United States",
        "publisher_url": "https://www.fec.gov/",
    }
    first = extract_fec_source(body, source(body), {"kind": "cover", "row": 2})
    first.facts["amounts_by_column"]["46"] = "99999.00"
    second = extract_fec_source(body, source(body), {"kind": "cover", "row": 2})
    assert second.facts["amounts_by_column"]["46"] == "200.00"


def test_quotes_are_exact_selected_cells_with_reproducible_locators_and_no_donor_data():
    # A Schedule A name/address/employer/occupation remains wholly unextracted.
    donor = record(
        46,
        {
            1: "SA11AI",
            2: "C00123456",
            3: "PRIVATE-DONOR",
            8: "Private donor name",
            13: "Private donor address",
            24: "Private employer",
            25: "Private occupation",
        },
    )
    body = filing(schedules=[donor, spending()])
    parsed = parse_filing(body, "1234567")
    assert parsed.unextracted_forms == ("SA11AI",)
    lines = body.split(b"\r\n")
    for extraction in parsed.records:
        cells = json.loads(extraction.quote)
        assert cells["format"] == "fec-selected-cells-v1"
        for cell in cells["cells"]:
            actual = lines[cell["row"] - 1].split(b"\x1c")[cell["column"] - 1].decode()
            assert actual == cell["raw"]
        checked = extract_fec_source(body, source(body), extraction.locator)
        assert checked.quote == extraction.quote
        assert not any(
            secret in checked.quote
            for secret in [
                "Private donor",
                "Private employer",
                "Private occupation",
                "Private payee address",
            ]
        )
    assert parse_filing(body, "1234567") == parsed


@pytest.mark.parametrize(
    "change",
    [
        {"authority": "mn_cfb"},
        {"url": "https://docquery.fec.gov.evil.test/dcdev/posted/1234567.fec"},
        {"url": "http://docquery.fec.gov/dcdev/posted/1234567.fec"},
        {"url": "https://docquery.fec.gov/pdf/1234567.pdf"},
        {"url": "https://user@docquery.fec.gov/dcdev/posted/1234567.fec"},
        {"url": "https://docquery.fec.gov:8443/dcdev/posted/1234567.fec"},
        {"url": "https://docquery.fec.gov/dcdev/posted/1234567.fec?api_key=secret"},
        {"sha256": "0" * 64},
    ],
)
def test_trusted_adapter_refuses_wrong_publisher_original_and_hash(change):
    body = filing()
    metadata = source(body)
    metadata.update(change)
    with pytest.raises(FecSourceError):
        extract_fec_source(body, metadata, {"kind": "figure", "row": 2, "column": 46})


def test_tampered_or_unknown_locator_cannot_supply_a_claim():
    body = filing()
    with pytest.raises(FecSourceError, match="Locator"):
        extract_fec_source(
            body, source(body), {"kind": "figure", "row": 2, "column": 82}
        )
    with pytest.raises(FecSourceError, match="Locator"):
        extract_fec_source(
            body,
            source(body),
            {"kind": "figure", "row": 2, "column": 46, "value": "999.00"},
        )
    metadata = deepcopy(source(body))
    with pytest.raises(FecSourceError):
        extract_fec_source(body + b"changed", metadata, {"kind": "cover", "row": 2})


def test_unsupported_version_pdf_and_notice_are_not_parsed_as_periodic_reports():
    for body in [
        filing(version="8.3"),
        b"%PDF-1.7\nsynthetic",
        filing(record(16, {1: "F24N", 2: "C00123456", 3: "24"}), [spending("SE")]),
    ]:
        with pytest.raises(FecSourceError):
            parse_filing(body, "1234567")


def test_trailing_unused_fields_and_final_delimiters_are_supported():
    parsed = parse_filing(
        filing(organization().rstrip("\x1c"), newline="\n"), "1234567"
    )
    assert by_kind(parsed, "identity")[0].facts["name"] == "Synthetic Campaign"
    assert parse_filing(filing(report() + "\x1c"), "1234567").version == "8.5"


# Published summary layout includes CAND_ID twice. Both must agree.
SUMMARY_HEADER = "LINK_IMAGE,FEC_ELECTION_YR,CMTE_NM,CMTE_ID,CMTE_TP,CMTE_DSGN,CMTE_FILING_FREQ,ADDRESS,CMTE_CITY,CMTE_ST,CMTE_ZIP,TRES_NM,CAND_ID,CAND_NAME,CAND_ELECTION_YR,FORM_TP_CD,RPT_TP,RPT_YR,RECEIPT_DT,INDV_ITEM_CONTB,INDV_UNITEM_CONTB,INDV_CONTB,INDV_REF,PTY_CMTE_CONTB,OTH_CMTE_CONTB,OTH_CMTE_REF,CAND_CNTB,TTL_CONTB,TTL_CONTB_REF,CAND_LOAN,CAND_LOAN_REPYMNT,OTH_LOANS,OTH_LOAN_REPYMTS,TTL_LOANS,TTL_LOAN_REPYMTS,TRANF_FROM_OTHER_AUTH_CMTE,TRANF_FROM_NONFED_ACCT_PER,TRANF_FROM_NONFED_LEVIN_PER,TTL_NONFED_TRANF_PER,OTHER_RECEIPTS,TTL_RECEIPTS,TTL_FED_RECEIPTS_PER,OP_EXP_PER,SHARED_FED_OP_EXP_PER,SHARED_NONFED_OP_EXP_PER,TTL_OP_EXP_PER,OFFSETS_TO_OP_EXP,SHARED_FED_ACTVY_FED_SHR_PER,SHARED_FED_ACTVY_NONFED_PER,NON_ALLOC_FED_ELECT_ACTVY_PER,TTL_FED_ELECT_ACTVY_PER,FED_CAND_CMTE_CONTB_PER,FED_CAND_CONTB_REF_PER,INDT_EXP_PER,COORD_EXP_BY_PTY_CMTE_PER,LOANS_MADE_PER,LOAN_REPYMTS_RECEIVED_PER,TRANF_TO_OTHER_AUTH_CMTE,FNDRSG_DISB,OFFSETS_TO_FNDRSG,EXEMPT_LEGAL_ACCTG_DISB,OFFSETS_TO_LEGAL_ACCTG,TTL_OFFSETS_TO_OP_EXP,OTHER_DISB_PER,TTL_FED_DISB_PER,TTL_DISB,NET_CONTB,NET_OP_EXP,COH_BOP,COH_COP,DEBTS_OWED_BY_CMTE,DEBTS_OWED_TO_CMTE,CVG_START_DT,TIME_STAMP,CVG_END_DT,POL_PTY_CMTE_CONTB,CAND_ID,COH_BOY,COH_COY,EXP_PRIOR_YRS_SUBJECT_LIM_PER,EXP_SUBJECT_LIMITS_PER,FED_FUNDS_PER,ITEM_CONVN_EXP_DISB_PER,ITEM_OTHER_DISB_PER,ITEM_OTHER_INCOME_PER,ITEM_OTHER_REF_REB_RET_PER,ITEM_REF_REB_RET_PER,OTHER_FED_OP_EXP_PER,SUBTTL_CONVN_EXP_DISB_PER,SUBTTL_OTHER_REF_REB_RET_PER,SUBTTL_REF_REB_RET_PER,TTL_COMMUNICATION_COST,TTL_EXP_SUBJECT_LIMITS,UNITEM_CONVN_EXP_DISB_PER,UNITEM_OTHER_DISB_PER,UNITEM_OTHER_INCOME_PER,UNITEM_OTHER_REF_REB_RET_PER,UNITEM_REF_REB_RET_PER".split(
    ","
)


def summary_source(**overrides):
    import csv
    import io

    values = {
        "CMTE_ID": "C00123456",
        "CMTE_NM": "Synthetic Campaign",
        "CMTE_DSGN": "P",
        "CAND_ID": "H6MN01111",
        "CAND_NAME": "EXAMPLE, ALEX",
        "CAND_ELECTION_YR": "2026",
        "FEC_ELECTION_YR": "2024",
        "RPT_YR": "2025",
        "ADDRESS": "Private address",
        "INDV_CONTB": "123.45",
    }
    values.update(overrides)
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(SUMMARY_HEADER)
    writer.writerow([values.get(key, "") for key in SUMMARY_HEADER])
    body = output.getvalue().encode()
    return body, {
        "authority": "fec",
        "sha256": hashlib.sha256(body).hexdigest(),
        "url": "https://cg-519a459a-0ea3-42c2-b7bc-fa1143481f74.s3-us-gov-west-1.amazonaws.com/bulk-downloads/2026/2026_HOUSE_SENATE_CAMPAIGNS_DOWNLOAD.csv",
    }


def test_bulk_designation_uses_candidate_election_year_and_exact_joins():
    from alethical.pipeline.election_fec_sources import extract_fec_bulk_source

    body, src = summary_source()
    checked = extract_fec_bulk_source(body, src, {"kind": "designation", "record": 1})
    assert checked.facts == {
        "authority": "fec",
        "account_id": "C00123456",
        "source_candidate_id": "H6MN01111",
        "election_year": 2026,
    }
    assert "Private address" not in checked.quote
    assert "123.45" not in checked.quote
    assert "RPT_YR" not in checked.quote
    assert "FEC_ELECTION_YR" not in checked.quote
    assert "CAND_ELECTION_YR" in checked.quote
    checked.facts["election_year"] = 2040
    assert (
        extract_fec_bulk_source(body, src, {"kind": "designation", "record": 1}).facts[
            "election_year"
        ]
        == 2026
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"CAND_ELECTION_YR": ""},
        {"CAND_ELECTION_YR": "2026.0"},
        {"CAND_ELECTION_YR": "not known"},
        {"CAND_ID": ""},
        {"CMTE_ID": "bad"},
        {"CMTE_DSGN": "U"},
    ],
)
def test_bulk_designation_rejects_unproved_identity_and_year(overrides):
    from alethical.pipeline.election_fec_sources import extract_fec_bulk_source

    body, src = summary_source(**overrides)
    with pytest.raises(FecSourceError):
        extract_fec_bulk_source(body, src, {"kind": "designation", "record": 1})


def test_bulk_account_and_designation_have_separate_exact_subsets():
    from alethical.pipeline.election_fec_sources import extract_fec_bulk_source

    body, src = summary_source()
    checked = extract_fec_bulk_source(body, src, {"kind": "account", "record": 1})
    assert checked.facts == {
        "authority": "fec",
        "account_id": "C00123456",
        "source_candidate_id": "H6MN01111",
        "name": "Synthetic Campaign",
        "candidate_name": "EXAMPLE, ALEX",
        "issued_id": True,
        "reviewed_key_basis": None,
        "jurisdiction": "United States",
    }
    with pytest.raises(FecSourceError):
        extract_fec_bulk_source(body, src, {"kind": "designation", "record": True})
    with pytest.raises(FecSourceError):
        extract_fec_bulk_source(
            body, src, {"kind": "designation", "record": 1, "account_id": "C00999999"}
        )


@pytest.mark.parametrize(
    "change", ["publisher", "hash", "path", "duplicate_candidate", "width"]
)
def test_bulk_rejects_changed_source_and_ambiguous_records(change):
    import csv
    import io
    from alethical.pipeline.election_fec_sources import extract_fec_bulk_source

    body, src = summary_source()
    if change == "publisher":
        src["url"] = src["url"].replace("s3-us-gov-west-1.amazonaws.com", "example.org")
    elif change == "hash":
        body += b"\n"
    elif change == "path":
        src["url"] = src["url"].replace("2026_HOUSE_SENATE", "2024_HOUSE_SENATE")
    else:
        rows = list(csv.reader(io.StringIO(body.decode())))
        if change == "duplicate_candidate":
            rows[1][76] = "H6MN02222"
        else:
            rows[1].pop()
        output = io.StringIO(newline="")
        csv.writer(output).writerows(rows)
        body = output.getvalue().encode()
        src["sha256"] = hashlib.sha256(body).hexdigest()
    with pytest.raises(FecSourceError):
        extract_fec_bulk_source(body, src, {"kind": "designation", "record": 1})


def f5_report(**overrides):
    fields = {
        1: "F5N",
        2: "C90012345",
        3: "ORG",
        4: "Synthetic Issue Group",
        18: "Q3",
        21: "20260701",
        22: "20260930",
        23: "0.00",
        24: "123.40",
        25: "Example",
        26: "Alex",
        30: "20261012",
    }
    fields.update({int(k): v for k, v in overrides.items()})
    return record(30, fields)


def f57_payment(**overrides):
    fields = {
        1: "F57",
        2: "C90012345",
        3: "SYNTHETIC-E1",
        4: "ORG",
        5: "Synthetic Print Shop",
        11: "Private payee address",
        16: "G2026",
        18: "20260912",
        19: "123.40",
        20: "456.70",
        21: "Printed mail",
        24: "S",
        25: "H6MN01111",
        26: "Example",
        27: "Alex",
        31: "H",
        32: "MN",
        33: "01",
    }
    fields.update({int(k): v for k, v in overrides.items()})
    return record(33, fields)


@pytest.mark.parametrize("version", ["8.4", "8.5"])
def test_f5_uses_own_columns_and_preserves_zero_and_missing(version):
    body = filing(f5_report(), [f57_payment()], version=version)
    parsed = parse_filing(body, "1234567")
    cover = by_kind(parsed, "cover")[0]
    assert cover.facts["form"] == "F5"
    assert cover.facts["report_type"] == "F5:Q3"
    assert cover.facts["period_start"] == "2026-07-01"
    assert cover.facts["period_end"] == "2026-09-30"
    figures = {x.facts["measure"]: x for x in by_kind(parsed, "figure")}
    assert figures["fec_contributions"].facts["value"] == "0.00"
    assert figures["fec_independent_expenditures"].facts["value"] == "123.40"
    assert figures["fec_independent_expenditures"].locator["column"] == 24
    empty = parse_filing(filing(f5_report(**{"23": ""})), "1234567")
    assert [x.facts["measure"] for x in by_kind(empty, "figure")] == [
        "fec_independent_expenditures"
    ]
    payment = by_kind(parsed, "payment")[0]
    assert payment.facts["amount"] == "123.40"
    assert payment.facts["direction"] == "independent_for"
    assert payment.facts["target_source_candidate_id"] == "H6MN01111"
    assert payment.facts["target_office"] == {
        "office": "H",
        "state": "MN",
        "district": "01",
    }
    assert payment.facts["memo"] == {
        "code": None,
        "text": None,
        "back_reference_transaction_id": None,
        "back_reference_schedule": None,
    }
    assert "Private payee address" not in payment.quote
    assert (
        extract_fec_source(body, source(body), {"kind": "report", "row": 2}).facts[
            "report_type"
        ]
        == "F5:Q3"
    )
    assert (
        extract_fec_source(body, source(body), {"kind": "payment", "row": 3}).facts[
            "amount"
        ]
        == "123.40"
    )


@pytest.mark.parametrize("code", ["24", "48"])
def test_f5_notice_period_and_measures_stay_distinct(code):
    parsed = parse_filing(
        filing(f5_report(**{"18": "", "19": code}), [f57_payment()]), "1234567"
    )
    assert by_kind(parsed, "cover")[0].facts["report_type"] == f"F5:{code}"
    assert by_kind(parsed, "cover")[0].facts["basis"] == "notice_period"
    assert {x.facts["measure"] for x in by_kind(parsed, "figure")} == {
        "fec_notice_contributions",
        "fec_notice_independent_expenditures",
    }
    assert by_kind(parsed, "payment")[0].facts["transaction_type"] == f"F5:{code}:F57"


@pytest.mark.parametrize(
    "overrides",
    [
        {"18": "Q3", "19": "24"},
        {"18": "", "19": ""},
        {"19": "72", "18": ""},
        {"21": "20261001"},
        {"22": "20260230"},
        {"24": ""},
        {"24": "1e3"},
        {"1": "F5A", "20": ""},
        {"3": "PAC"},
        {"2": "C9001234X"},
    ],
)
def test_f5_invalid_cover_fails_closed(overrides):
    with pytest.raises(FecSourceError):
        parse_filing(filing(f5_report(**overrides)), "1234567")


@pytest.mark.parametrize(
    "overrides",
    [
        {"19": ""},
        {"19": "1.234"},
        {"24": "X"},
        {"25": "bad-id"},
        {"18": "20260230"},
        {"2": "C90099999"},
        {"33": "abc"},
    ],
)
def test_f57_bad_payment_never_discards_independent_valid_cover(overrides):
    parsed = parse_filing(filing(f5_report(), [f57_payment(**overrides)]), "1234567")
    assert len(by_kind(parsed, "cover")) == 1
    assert len(parsed.rejected_rows) == 1
    assert by_kind(parsed, "payment") == []


def test_f57_unknown_position_never_infers_from_candidate_and_duplicates_rejected():
    p = parse_filing(filing(f5_report(), [f57_payment(**{"24": ""})]), "1234567")
    assert by_kind(p, "payment")[0].facts["direction"] == "unknown"
    p = parse_filing(filing(f5_report(), [f57_payment(), f57_payment()]), "1234567")
    assert len(p.rejected_rows) == 2
    assert by_kind(p, "payment") == []


def test_f5_donor_schedule_is_unextracted_and_shifted_spending_row_rejected():
    donor = record(
        20, {1: "F56", 2: "C90012345", 3: "DONOR1", 4: "IND", 6: "Private donor"}
    )
    shifted = f57_payment().split("\x1c")
    shifted.insert(3, "unexpected")
    parsed = parse_filing(filing(f5_report(), [donor, "\x1c".join(shifted)]), "1234567")
    assert parsed.unextracted_forms == ("F56",)
    assert len(parsed.rejected_rows) == 1
    assert "Private donor" not in str(parsed.records)


def test_official_h_schedule_codes_remain_unextracted_not_bad_payments():
    rows = [
        record(3, {1: code, 2: "C00123456", 3: "Private unused fields"})
        for code in ("H1", "H3", "H4")
    ]
    parsed = parse_filing(filing(report("F3X"), rows), "1234567")
    assert parsed.rejected_rows == ()
    assert parsed.unextracted_forms == ("H1", "H3", "H4")
    assert len(parsed.unextracted_rows) == 3
    assert "Private unused fields" not in str(parsed.records)


def test_explicit_payment_event_dates_do_not_redefine_legacy_date():
    body = filing(report("F3X"), [spending("SE")])
    raw = by_kind(parse_filing(body, "1234567"), "payment")[0].facts
    dates = extract_fec_source(body, source(body), {"kind": "payment_dates", "row": 3})
    assert dates.facts == {
        "authority": "fec",
        "account_id": "C00123456",
        "source_row_id": "3",
        "source_report_id": "1234567",
        "dissemination_date": raw["dissemination_date"],
        "disbursement_date": raw["disbursement_date"],
    }
    legacy = extract_fec_source(body, source(body), {"kind": "payment", "row": 3})
    assert legacy.facts["date"] == raw["dissemination_date"]
    assert "dissemination_date" not in legacy.facts
    body = filing(f5_report(), [f57_payment()])
    dates = extract_fec_source(body, source(body), {"kind": "payment_dates", "row": 3})
    assert dates.facts["dissemination_date"] == "2026-09-12"
    assert dates.facts["disbursement_date"] is None


@pytest.mark.parametrize("raw_year", ["0", "2027", "WHAT", "0000"])
def test_invalid_optional_cumulative_year_keeps_independent_period_records(raw_year):
    body = filing(report("F3X", **{"75": raw_year}), [spending("SE")])
    parsed = parse_filing(body, "1234567")
    cover = by_kind(parsed, "cover")[0]
    assert cover.facts["period_start"] == "2026-07-01"
    assert cover.facts["cumulative_start"] is None
    assert cover.facts["cumulative_year_raw"] == raw_year
    figures = by_kind(parsed, "figure")
    assert all(x.facts["basis"] == "report_period" for x in figures)
    assert len(figures) > 0 and len(by_kind(parsed, "payment")) == 1
    gaps = by_kind(parsed, "gap")
    assert len(gaps) == 1 and gaps[0].locator == {"kind": "gap", "row": 2, "column": 75}
    assert gaps[0].facts["scope"] == "calendar_year_to_date"
    assert gaps[0].facts["raw_value"] == raw_year
    assert any(
        x["raw"] == raw_year and x["column"] == 75
        for x in json.loads(gaps[0].quote)["cells"]
    )
    src = source(body)
    assert extract_fec_source(body, src, gaps[0].locator).facts == gaps[0].facts
    assert src["sha256"] == hashlib.sha256(body).hexdigest()


def test_padded_version_recognizes_only_one_trailing_ascii_space_and_keeps_quote():
    body = filing(version="8.5 ")
    parsed = parse_filing(body, "1234567")
    header = by_kind(parsed, "header")[0]
    assert parsed.version == "8.5"
    assert header.facts["raw_version"] == "8.5 "
    assert header.facts["format_warnings"] == ["trailing_ascii_space_version_padding"]
    assert (
        next(x["raw"] for x in json.loads(header.quote)["cells"] if x["column"] == 3)
        == "8.5 "
    )
    assert len(by_kind(parsed, "cover")) == 1
    for bad in (" 8.5", "8. 5", "8.50", "8.5  ", "8.5\t", "9.5 "):
        with pytest.raises(FecSourceError):
            parse_filing(filing(version=bad), "1234567")


def test_blank_only_optional_sb_district_is_unknown_only_without_candidate_geo():
    body = filing(
        report("F3X"), [spending(**{"27": "", "33": "", "34": "", "35": " "})]
    )
    parsed = parse_filing(body, "1234567")
    assert parsed.rejected_rows == ()
    payment = by_kind(parsed, "payment")[0]
    assert payment.facts["target_source_candidate_id"] is None
    assert payment.facts["target_office"] == {
        "office": None,
        "state": None,
        "district": None,
    }
    assert any(
        x["column"] == 35 and x["raw"] == " "
        for x in json.loads(payment.quote)["cells"]
    )
    for changed in ({"27": "H6MN01111"}, {"33": "H"}, {"34": "MN"}, {"35": "\u00a0"}):
        values = {"27": "", "33": "", "34": "", "35": " "}
        values.update(changed)
        parsed = parse_filing(filing(report("F3X"), [spending(**values)]), "1234567")
        assert len(parsed.rejected_rows) == 1 and by_kind(parsed, "payment") == []


@pytest.mark.parametrize(
    "cover", [report(), report("F3X"), f5_report(), organization()]
)
def test_filer_account_is_exact_literal_identity_without_candidate_association(cover):
    body = filing(cover)
    src = source(body)
    src.update(name="Caller invented name", account_id="C99999999")
    checked = extract_fec_source(body, src, {"kind": "filer_account", "row": 2})
    expected_name = (
        "Synthetic Issue Group" if cover.startswith("F5") else "Synthetic Campaign"
    )
    expected_id = "C90012345" if cover.startswith("F5") else "C00123456"
    assert checked.facts == {
        "authority": "fec",
        "account_id": expected_id,
        "name": expected_name,
        "source_candidate_id": None,
        "candidate_name": None,
        "issued_id": True,
        "reviewed_key_basis": None,
        "jurisdiction": "United States",
    }
    cells = json.loads(checked.quote)["cells"]
    assert any(x["column"] == 2 and x["raw"] == expected_id for x in cells)
    assert any(x["raw"] == expected_name for x in cells)
    assert "Private candidate address" not in checked.quote
    assert "H6MN01111" not in checked.quote
    assert "Caller invented name" not in checked.quote
    checked.facts["name"] = "Mutation"
    assert (
        extract_fec_source(body, src, {"kind": "filer_account", "row": 2}).facts["name"]
        == expected_name
    )


def test_general_filer_claim_cannot_be_used_as_candidate_designation():
    body = filing(organization())
    src = source(body)
    assert (
        extract_fec_source(body, src, {"kind": "filer_account", "row": 2}).facts[
            "source_candidate_id"
        ]
        is None
    )
    associated = extract_fec_source(body, src, {"kind": "account", "row": 2})
    assert associated.facts["source_candidate_id"] == "H6MN01111"
    assert associated.facts["candidate_name"] == "Alex Example"
    designation = extract_fec_source(body, src, {"kind": "designation", "row": 2})
    assert designation.facts["source_candidate_id"] == "H6MN01111"
    assert "election_year" not in designation.facts
    outside = filing(
        organization(
            **{"22": "C", "23": "", "24": "", "25": "", "29": "", "30": "", "31": ""}
        )
    )
    assert (
        extract_fec_source(
            outside, source(outside), {"kind": "filer_account", "row": 2}
        ).facts["name"]
        == "Synthetic Campaign"
    )
    for kind in ("account", "designation"):
        with pytest.raises(FecSourceError):
            extract_fec_source(outside, source(outside), {"kind": kind, "row": 2})
    for kind in ("account", "designation"):
        with pytest.raises(FecSourceError):
            extract_fec_source(
                filing(f5_report()),
                source(filing(f5_report())),
                {"kind": kind, "row": 2},
            )


@pytest.mark.parametrize(
    "extra",
    [
        {"account_id": "C99999999"},
        {"name": "Invented"},
        {"designation": "principal"},
        {"source_candidate_id": "H6MN01111"},
    ],
)
def test_filer_account_rejects_fabricated_locator_claims(extra):
    body = filing(report("F3X"))
    with pytest.raises(FecSourceError):
        extract_fec_source(
            body, source(body), {"kind": "filer_account", "row": 2, **extra}
        )


@pytest.mark.parametrize(
    "cover",
    [
        report(**{"2": "bad"}),
        report(**{"3": ""}),
        report(**{"3": " "}),
        organization(**{"2": "C12"}),
        organization(**{"4": " "}),
        f5_report(**{"2": "C90012X45"}),
        f5_report(**{"4": " "}),
        f5_report(**{"3": "IND", "4": "", "5": "Example", "6": "Alex"}),
    ],
)
def test_filer_account_rejects_malformed_or_unproved_filer_identity(cover):
    body = filing(cover)
    with pytest.raises(FecSourceError):
        extract_fec_source(body, source(body), {"kind": "filer_account", "row": 2})


def test_filer_account_rejects_stale_hash_and_candidate_statement_as_filer():
    body = filing(report("F3X"))
    src = source(body)
    changed = body.replace(b"Synthetic Campaign", b"Fabricated Name")
    with pytest.raises(FecSourceError):
        extract_fec_source(changed, src, {"kind": "filer_account", "row": 2})
    f2 = record(
        43,
        {
            1: "F2N",
            2: "H6MN01111",
            3: "Example",
            4: "Alex",
            19: "IND",
            20: "H",
            21: "MN",
            22: "01",
            23: "2026",
            24: "C00123456",
            25: "Synthetic Campaign",
            43: "20260101",
        },
    )
    body = filing(f2)
    with pytest.raises(FecSourceError):
        extract_fec_source(body, source(body), {"kind": "filer_account", "row": 2})
    for row in (True, 1, 3):
        body = filing(report("F3X"))
        with pytest.raises(FecSourceError):
            extract_fec_source(
                body, source(body), {"kind": "filer_account", "row": row}
            )


def test_filer_account_rejects_multiple_main_cover_identities():
    body = filing(
        report("F3X"), [report("F3X", **{"2": "C00999999", "3": "Different Filer"})]
    )
    with pytest.raises(FecSourceError, match="Multiple main covers"):
        extract_fec_source(body, source(body), {"kind": "filer_account", "row": 2})


@pytest.mark.parametrize(
    "code",
    [
        "F1MN",
        "F1MA",
        "F24N",
        "F24A",
        "F3PN",
        "F3PA",
        "F3PT",
        "F3LN",
        "F3LA",
        "F4N",
        "F4A",
        "F4T",
        "F6N",
        "F6A",
        "F7N",
        "F7A",
        "F7T",
        "F9N",
        "F9A",
        "F13N",
        "F13A",
        "F99",
    ],
)
@pytest.mark.parametrize("same_id", [False, True])
def test_filer_account_rejects_unsupported_official_main_covers_even_incomplete(
    code, same_id
):
    # Known main-form tokens are ambiguous even if the second row is incomplete.
    extra = record(2, {1: code, 2: "C00123456" if same_id else "C00999999"})
    body = filing(report("F3X"), [extra])
    with pytest.raises(FecSourceError, match="Multiple main covers"):
        extract_fec_source(body, source(body), {"kind": "filer_account", "row": 2})


@pytest.mark.parametrize(
    "code",
    [
        "F56",
        "F57",
        "F65",
        "F1S",
        "F2S",
        "F3S",
        "F3Z1",
        "F3Z2",
        "F3PS",
        "F3P31AL",
        "F3PZ1",
        "F3PZ2",
        "F76",
        "F91",
        "F92",
        "F93",
        "F94",
        "F132",
        "F133",
    ],
)
def test_filer_account_does_not_misidentify_supplement_as_main_cover(code):
    body = filing(report("F3X"), [record(2, {1: code, 2: "C00123456"})])
    assert (
        extract_fec_source(
            body, source(body), {"kind": "filer_account", "row": 2}
        ).facts["account_id"]
        == "C00123456"
    )


def test_filer_main_cover_guard_does_not_change_old_candidate_routes():
    body = filing(organization(), [record(2, {1: "F6N", 2: "C00999999"})])
    assert (
        extract_fec_source(body, source(body), {"kind": "account", "row": 2}).facts[
            "source_candidate_id"
        ]
        == "H6MN01111"
    )
    assert (
        extract_fec_source(body, source(body), {"kind": "designation", "row": 2}).facts[
            "source_candidate_id"
        ]
        == "H6MN01111"
    )
    with pytest.raises(FecSourceError, match="Multiple main covers"):
        extract_fec_source(body, source(body), {"kind": "filer_account", "row": 2})


@pytest.mark.parametrize("code,name_column", [("F6N", 3), ("F99", 4)])
def test_filer_account_single_main_cover_invariant_even_if_id_and_name_repeat(
    code, name_column
):
    fields = {1: code, 2: "C00123456", name_column: "Synthetic Campaign"}
    if code == "F99":
        fields[3] = "ORG"
    body = filing(report("F3X"), [record(name_column, fields)])
    with pytest.raises(FecSourceError, match="Multiple main covers"):
        extract_fec_source(body, source(body), {"kind": "filer_account", "row": 2})


@pytest.mark.parametrize("version", ["8.4", "8.5"])
def test_payment_address_is_separate_literal_binding_without_changing_legacy(version):
    body = filing(
        schedules=[
            spending(
                **{
                    "13": "=Exact street",
                    "14": "Unit 02",
                    "15": "St. Paul",
                    "16": "MN",
                    "17": "05501-0123",
                }
            )
        ],
        version=version,
    )
    old = extract_fec_source(body, source(body), {"kind": "payment", "row": 3})
    address = extract_fec_source(
        body, source(body), {"kind": "payment_address", "row": 3}
    )
    assert address.facts == {
        "authority": "fec",
        "account_id": "C00123456",
        "source_row_id": "3",
        "source_report_id": "1234567",
        "payee_address": {
            "street_1": "=Exact street",
            "street_2": "Unit 02",
            "city": "St. Paul",
            "state": "MN",
            "postal_code": "05501-0123",
        },
    }
    cells = json.loads(address.quote)["cells"]
    assert {c["column"] for c in cells} == {2, 13, 14, 15, 16, 17}
    assert "=Exact street" not in old.quote
    assert extract_fec_source(body, source(body), {"kind": "payment", "row": 3}) == old


def test_payment_address_blank_is_unknown_and_locator_cannot_inject_fields():
    body = filing(schedules=[spending(**{"13": ""})])
    result = extract_fec_source(
        body, source(body), {"kind": "payment_address", "row": 3}
    )
    assert all(v is None for v in result.facts["payee_address"].values())
    for locator in [
        {"kind": "payment_address", "row": 2},
        {"kind": "payment_address", "row": True},
        {"kind": "payment_address", "row": 3, "state": "MN"},
    ]:
        with pytest.raises(FecSourceError):
            extract_fec_source(body, source(body), locator)


def test_address_preserves_observed_horizontal_tab_without_accepting_other_controls():
    body = filing(schedules=[spending(**{"13": "123\tMain Street"})])
    value = extract_fec_source(
        body, source(body), {"kind": "payment_address", "row": 3}
    )
    assert value.facts["payee_address"]["street_1"] == "123\tMain Street"
    assert json.loads(value.quote)["cells"][1]["raw"] == "123\tMain Street"
    for control in ["\x00", "\x0b", "\x1b"]:
        bad = filing(schedules=[spending(**{"13": "123" + control + "Main"})])
        with pytest.raises(FecSourceError):
            extract_fec_source(bad, source(bad), {"kind": "payment_address", "row": 3})


def test_address_reader_bound_precedes_parsing_and_leaves_legacy_contract(monkeypatch):
    from alethical.pipeline import election_fec_sources as parser

    body = filing(schedules=[spending()])
    monkeypatch.setattr(parser, "MAX_ADDRESS_SOURCE_BYTES", len(body) - 1)
    with pytest.raises(FecSourceError, match="bounded"):
        extract_fec_source(body, source(body), {"kind": "payment_address", "row": 3})
    assert (
        extract_fec_source(body, source(body), {"kind": "payment", "row": 3}).facts[
            "amount"
        ]
        == "100.01"
    )


@pytest.mark.parametrize("version", ["8.4", "8.5"])
def test_f57_address_uses_its_own_literal_columns(version):
    body = filing(
        cover=f5_report(),
        schedules=[
            f57_payment(
                **{
                    "11": "1 Literal Road",
                    "12": "Suite 2",
                    "13": "City",
                    "14": "WI",
                    "15": "00501",
                }
            )
        ],
        version=version,
    )
    value = extract_fec_source(
        body, source(body), {"kind": "payment_address", "row": 3}
    )
    assert value.facts["payee_address"] == {
        "street_1": "1 Literal Road",
        "street_2": "Suite 2",
        "city": "City",
        "state": "WI",
        "postal_code": "00501",
    }
    assert {c["column"] for c in json.loads(value.quote)["cells"]} == {
        2,
        11,
        12,
        13,
        14,
        15,
    }
