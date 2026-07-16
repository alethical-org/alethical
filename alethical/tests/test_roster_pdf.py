from __future__ import annotations

from pathlib import Path

from alethical.pipeline.roster_pdf import (
    name_matches,
    normalize_name_tokens,
    parse_roster_pdf,
)

FIXTURE = Path(__file__).parent / "fixtures" / "roster-pdf-text.txt"


def _members() -> list:
    return parse_roster_pdf(FIXTURE.read_text())


def test_parses_full_roster_to_200_current_members() -> None:
    members = _members()
    house = [m for m in members if m.chamber == "house"]
    senate = [m for m in members if m.chamber == "senate"]
    # 134 House seats with one vacant (21A) + 67 Senate seats.
    assert len(house) == 133
    assert len(senate) == 67
    assert len(members) == 200


def test_no_duplicate_seats_and_no_digits_in_names() -> None:
    # Regression guard: the two-column PDF layout previously let a name capture
    # leap the column gap and swallow the next entry's district number (e.g.
    # senate 35 "Abeler" was lost and senate 29 duplicated with a garbage name
    # "35    Abeler"). Names never contain digits; every seat is unique.
    members = _members()
    seats = [(m.chamber, m.district_code) for m in members]
    assert len(seats) == len(set(seats))
    for member in members:
        assert not any(ch.isdigit() for ch in member.last_name), member
    by_seat = {seat: m for seat, m in zip(seats, members)}
    assert by_seat[("senate", "35")].last_name == "Abeler"


def test_vacant_seat_is_excluded() -> None:
    seats = {(m.chamber, m.district_code) for m in _members()}
    assert ("house", "21A") not in seats


def test_district_codes_are_normalized_to_match_db() -> None:
    by_seat = {(m.chamber, m.district_code): m for m in _members()}
    # Single-digit House district zero-padded, suffix kept.
    assert by_seat[("house", "09A")].last_name == "Backer"
    # Single-digit Senate district zero-padded.
    assert by_seat[("senate", "03")].last_name == "Hauschild"


def test_name_and_party_fields() -> None:
    by_seat = {(m.chamber, m.district_code): m for m in _members()}
    acomb = by_seat[("house", "45B")]
    assert acomb.last_name == "Acomb"
    assert acomb.first_name == "Patty"
    assert acomb.party == "DFL"

    # Multi-word surname split on the comma, not on whitespace.
    js = by_seat[("senate", "45")]
    assert js.last_name == "Johnson Stewart"
    assert js.first_name == "Ann M."

    # Diacritics and hyphens preserved verbatim in the stored name.
    pv = by_seat[("house", "65B")]
    assert pv.last_name == "Pérez-Vega"
    assert pv.first_name == "María Isa"


def test_normalize_name_tokens_folds_accents_apostrophes_hyphens() -> None:
    assert normalize_name_tokens("O’Driscoll") == normalize_name_tokens("O'Driscoll")
    assert normalize_name_tokens("Pérez-Vega") == ["perezvega"]
    assert normalize_name_tokens("Luger-Nikolai") == ["lugernikolai"]
    assert normalize_name_tokens("Ann M. Johnson Stewart") == [
        "ann",
        "m",
        "johnson",
        "stewart",
    ]


def test_name_matches_suffix_semantics() -> None:
    # Middle initial / first name preceding the surname.
    assert name_matches("Skraba", "Roger J. Skraba")
    assert name_matches("Eichorn", "Justin D. Eichorn")
    # Multi-word and hyphenated surnames.
    assert name_matches("Johnson Stewart", "Ann M. Johnson Stewart")
    assert name_matches("Luger-Nikolai", "Meg Luger-Nikolai")
    assert name_matches("Vang Her", "Kaohly Vang Her")
    # Curly vs straight apostrophe.
    assert name_matches("O’Driscoll", "Tim O'Driscoll")
    # Non-matches: different person in the same seat.
    assert not name_matches("Heintzeman", "Justin D. Eichorn")
    assert not name_matches("Lee", "Melissa Hortman")
    # A surname is not matched mid-name (must be a trailing run).
    assert not name_matches("Ann", "Ann M. Johnson Stewart")
