"""Printed form-cell spacing changes no date digits or source evidence."""

import pytest

from alethical.pipeline import election_source_readings as r
from alethical.pipeline.election_comparison import ComparisonImportError


@pytest.mark.parametrize(
    ("literal", "expected"),
    [
        ("03 / 18 / 26", "2026-03-18"),
        ("07 / 31 / 2026", "2026-07-31"),
        ("1/ 16 /26", "2026-01-16"),
        ("2 /16/ 2026", "2026-02-16"),
        ("2  /  29  /  24", "2024-02-29"),
    ],
)
def test_spaced_form_date_preserves_literal_and_calendar_value(literal, expected):
    field = r.field_proposal(
        "cover.period_start",
        page=1,
        bounds=[10, 10, 120, 30],
        label="From",
        literal=literal,
        value_type="date",
    )
    assert field["literal"] == literal
    assert field["normalized"] == expected
    assert field["state"] == "value"
    assert "decision" not in field


@pytest.mark.parametrize(
    "literal",
    [
        "4/ / 13 / 26",
        "07/ / 30 / 26",
        "02 / 17 / 202",
        "02 / 17 / 6",
        "02 / 17",
        "02 / 29 / 26",
        "13 / 1 / 2026",
        "0 / 10 / 26",
        "6 / 32 / 26",
        "1 0 / 3 / 26",
        "1 / 2 / 2 6",
        "1 \t/ 2 / 26",
        "1 /\n2 / 26",
        "1\u00a0/ 2 / 26",
        "１ / 2 / 26",
        "1 / 2 / 202\n6",
        " 1 / 2 / 26",
        "1 / 2 / 26 ",
        "1 / 2 / 26, 1 / 3 / 26",
        "Various",
    ],
)
def test_spaced_form_date_does_not_repair_missing_or_ambiguous_digits(literal):
    with pytest.raises(ComparisonImportError):
        r.normalize_field(literal, "date", "value")


@pytest.mark.parametrize(
    "state", ["blank", "ambiguous", "unreadable", "not_checked", "redacted"]
)
def test_spaced_form_date_does_not_fill_uncertain_values(state):
    assert r.normalize_field("03 / 18 / 26", "date", state) is None
