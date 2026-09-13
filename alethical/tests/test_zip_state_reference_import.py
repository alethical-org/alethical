"""Refuse to turn ZIP routing hints or partial files into donor geography."""

from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys

from openpyxl import Workbook
import pytest

from scripts.build_zip_state_reference import parse_rows, read_reference, STATE_CODES


def test_multiple_counties_in_one_state_are_not_multiple_states():
    result, count = parse_rows(
        [
            ("ZIP", "COUNTY", "USPS_ZIP_PREF_STATE"),
            ("03870", "33015", "NH"),
            ("03870", "33017", "NH"),
        ]
    )
    assert count == 2
    assert result == {"03870": "NH"}


def test_a_cross_state_zip_stays_unknown_even_with_a_preferred_state():
    result, count = parse_rows(
        [
            ("ZIP", "COUNTY", "USPS_ZIP_PREF_STATE", "TOT_RATIO"),
            ("12345", "27001", "MN", "0.9999"),
            ("12345", "55001", "MN", "0.0001"),
        ]
    )
    assert count == 2
    assert result == {"12345": None}


def test_a_territory_is_not_printed_as_an_ordinary_state():
    result, _ = parse_rows([("ZIP", "COUNTY"), ("00901", "72127")])
    assert result == {"00901": None}


@pytest.mark.parametrize(
    "rows",
    [
        [("DELIVERY ZIPCODE", "PHYSICAL STATE"), ("09012", "NJ")],
        [("ZIP", "COUNTY", "ZIP"), ("10001", "36061", "10001")],
        [("ZIP", "COUNTY"), ("10001",)],
        [("ZIP", "COUNTY"), ("10001", "99001")],
        [("ZIP", "COUNTY"), ("1001", "36061")],
        [("ZIP", "COUNTY")],
    ],
)
def test_wrong_source_or_unreadable_rows_refuse_the_reference(rows):
    with pytest.raises(ValueError):
        parse_rows(rows)


def test_excel_reference_numeric_codes_preserve_their_defined_five_digits(tmp_path):
    source = tmp_path / "hud.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(("ZIP", "COUNTY"))
    sheet.append((1001, 25013))
    sheet.append((22031, 51059))
    workbook.save(source)
    assert read_reference(source) == ({"01001": "MA", "22031": "VA"}, 2)


def _build(tmp_path, rows, *, copied="2026-09-13T00:00:00+00:00"):
    source = tmp_path / "hud.csv"
    source.write_text("ZIP,COUNTY\n" + "\n".join(rows) + "\n")
    output = tmp_path / "reference.json"
    result = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).parents[2] / "scripts/build_zip_state_reference.py"),
            "--input",
            str(source),
            "--as-of",
            "2026-06-30",
            "--copied-at",
            copied,
            "--output",
            str(output),
        ],
        capture_output=True,
        text=True,
    )
    return result, output


def test_a_filtered_state_extract_cannot_replace_the_national_reference(tmp_path):
    result, output = _build(tmp_path, ["55101,27123"])
    assert result.returncode != 0
    assert "all 50 states and DC" in result.stderr
    assert not output.exists()


def test_manual_build_records_source_and_copy_date_without_extra_columns(tmp_path):
    # Constructed national coverage, not real HUD rows or a real ZIP allocation.
    rows = [
        f"{index:05d},{fips}001"
        for index, fips in enumerate(STATE_CODES, 1)
        if int(fips) <= 56
    ]
    result, output = _build(tmp_path, rows)
    assert result.returncode == 0, result.stderr
    value = json.loads(output.read_text())
    assert set(value) == {"source_url", "as_of", "copied_at", "content_hash", "states"}
    assert (
        value["source_url"]
        == "https://www.huduser.gov/portal/datasets/usps_crosswalk.html"
    )
    assert value["as_of"] == "2026-06-30"
    assert datetime.fromisoformat(value["copied_at"]).utcoffset().total_seconds() == 0
    assert len(value["content_hash"]) == 64
    assert len(value["states"]) == 51
    report = json.loads(result.stdout)
    assert report["source_rows"] == report["distinct_zips"] == 51


def test_manual_build_needs_an_unambiguous_copy_time(tmp_path):
    result, output = _build(tmp_path, ["55101,27123"], copied="2026-09-13T00:00:00")
    assert result.returncode != 0
    assert "UTC offset" in result.stderr
    assert not output.exists()
