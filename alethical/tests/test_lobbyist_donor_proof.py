"""Donor proof must account for identity, transaction multiplicity and full periods."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace as Obj

from alethical.pipeline.lobbyist_donor_proof import compare_donors, source_fingerprint


def report(gifts, start=date(2025, 1, 1), end=date(2025, 12, 31)):
    return Obj(
        period_start=start,
        period_end=end,
        document_hash="a" * 64,
        transactions=[
            Obj(
                donor_name=name,
                lobbyist_registration_number=reg,
                receipt_date=day,
                cash=Decimal(cash),
                in_kind=Decimal(kind),
                page=3,
                line=20,
            )
            for name, reg, day, cash, kind in gifts
        ],
    )


def row(number=1, **changes):
    return {
        "row_number": number,
        "recipient_reg_num": "20006",
        "contributor": "Carlson, Joel D",
        "contrib_reg_num": "8692",
        "contrib_type": "Lobbyist",
        "receipt_type": "Contribution",
        "amount": "500",
        "receipt_date": "2025-07-02",
        "year": 2025,
        "in_kind": "No",
        **changes,
    }


def gift(
    amount="500", reg="8692", name="Carlson, Joel D", day=date(2025, 7, 2), kind="0"
):
    return name, reg, day, amount, kind


def status(reports, rows, reg="8692"):
    return compare_donors(reports, rows, 2025)["donors"][reg]["status"]


def test_report_registration_recovers_missing_source_number_without_neighbor():
    reports = [report([gift(), gift("250", None, "Carpenter, Lindsey")])]
    rows = [
        row(contrib_reg_num=None, contrib_type="Individual"),
        row(
            2,
            contrib_reg_num=None,
            contrib_type="Individual",
            contributor="Carpenter, Lindsey",
            amount="250",
        ),
    ]
    proof = compare_donors(reports, rows, 2025)
    assert proof["donors"]["8692"]["row_numbers"] == [1]
    assert proof["donors"]["8692"]["status"] == "agrees"


def test_complete_multiset_requires_repeated_rows_and_does_not_deduplicate():
    reports = [report([gift(), gift()])]
    assert status(reports, [row(), row(2)]) == "agrees"
    assert status(reports, [row()]) == "disagrees"
    assert status(reports, [row(), row(2), row(3)]) == "disagrees"
    assert status([report([gift()])], [row(), row(2)]) == "disagrees"


def test_equal_total_with_different_dates_fails():
    assert status([report([gift()])], [row(receipt_date="2025-07-03")]) == "disagrees"


def test_signed_cash_and_in_kind_stay_separate():
    reports = [report([gift("500", kind="-20")])]
    rows = [row(), row(2, amount="-20", in_kind="Yes")]
    assert status(reports, rows) == "agrees"
    assert status(reports, [row(amount="480")]) == "disagrees"


def test_missing_amount_date_or_kind_cannot_pass():
    for field in ["amount", "receipt_date", "in_kind"]:
        assert status([report([gift()])], [row(**{field: None})]) == "disagrees"


def test_ambiguous_identity_and_conflicting_nonempty_id_do_not_pass():
    reports = [report([gift(), gift(reg="1234")])]
    proof = compare_donors(reports, [row(contrib_reg_num=None)], 2025)
    assert all(v["status"] == "disagrees" for v in proof["donors"].values())
    assert status([report([gift()])], [row(contrib_reg_num="999")]) == "disagrees"


def test_same_name_unmatched_unknown_row_prevents_partial_sum():
    assert (
        status(
            [report([gift()])],
            [row(contrib_reg_num=None), row(2, contrib_reg_num=None, amount="100")],
        )
        == "disagrees"
    )


def test_unregistered_report_block_with_same_name_is_not_guessed():
    assert status([report([gift(), gift("100", reg=None)])], [row()]) == "disagrees"


def test_special_and_regular_periods_must_cover_year_without_gap_or_overlap():
    first = report([gift(day=date(2025, 3, 28))], end=date(2025, 5, 14))
    second = report([], start=date(2025, 5, 15))
    assert status([first, second], [row(receipt_date="2025-03-28")]) == "agrees"
    for start in [date(2025, 5, 14), date(2025, 5, 16)]:
        proof = compare_donors([first, report([], start=start)], [row()], 2025)
        assert proof["state"] == "unavailable"
        assert proof["donors"] == {}


def test_hash_binds_multiplicity_and_values_but_not_input_order():
    assert source_fingerprint([row(), row(2)]) == source_fingerprint([row(2), row()])
    assert source_fingerprint([row()]) != source_fingerprint([row(), row(2)])
    assert source_fingerprint([row()]) != source_fingerprint([row(amount="501")])


def test_cross_year_special_period_contributes_only_selected_calendar_dates():
    regular = report([], end=date(2025, 11, 16))
    special = report(
        [gift(day=date(2025, 12, 1)), gift("100", day=date(2026, 1, 1))],
        start=date(2025, 11, 17),
        end=date(2026, 2, 11),
    )
    assert status([regular, special], [row(receipt_date="2025-12-01")]) == "agrees"
    # A source row labelled 2025 but dated 2026 is a mismatch, not moved to a new year.
    assert (
        status(
            [regular, special],
            [
                row(receipt_date="2025-12-01"),
                row(2, amount="100", receipt_date="2026-01-01"),
            ],
        )
        == "disagrees"
    )


def test_late_start_remains_unavailable_without_explicit_coverage_proof():
    reports = [report([gift()], start=date(2025, 7, 1))]
    assert compare_donors(reports, [row()], 2025)["state"] == "unavailable"
    checked = compare_donors(reports, [row()], 2025, coverage_start=date(2025, 7, 1))
    assert checked["donors"]["8692"]["status"] == "agrees"


def test_late_start_never_drops_a_known_earlier_held_donor_record():
    reports = [report([gift()], start=date(2025, 7, 1))]
    checked = compare_donors(
        reports,
        [row(), row(2, receipt_date="2025-06-01")],
        2025,
        coverage_start=date(2025, 7, 1),
    )
    assert checked["donors"]["8692"]["status"] == "disagrees"


def test_explicit_coverage_does_not_allow_internal_gap_or_shortened_year():
    first = report([gift()], start=date(2025, 7, 1), end=date(2025, 9, 30))
    for second_start in (date(2025, 9, 30), date(2025, 10, 2)):
        second = report([], start=second_start)
        checked = compare_donors(
            [first, second], [row()], 2025, coverage_start=date(2025, 7, 1)
        )
        assert checked["state"] == "unavailable"
    assert (
        compare_donors([first], [row()], 2025, coverage_start=date(2025, 7, 1))["state"]
        == "unavailable"
    )


def test_explicit_late_cross_year_coverage_excludes_next_year_payments():
    reports = [
        report(
            [gift(day=date(2025, 12, 1)), gift("100", day=date(2026, 1, 1))],
            start=date(2025, 11, 17),
            end=date(2026, 2, 11),
        )
    ]
    checked = compare_donors(
        reports,
        [row(receipt_date="2025-12-01")],
        2025,
        coverage_start=date(2025, 11, 17),
    )
    assert checked["donors"]["8692"]["row_numbers"] == [1]
