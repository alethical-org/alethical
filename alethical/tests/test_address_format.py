"""Saved browser addresses change formatting, never their identifying words."""

import pytest

from alethical.api.services.address_format import normalize_address_format

PUBLIC_ADDRESS = "350 S 5th St, Minneapolis, MN 55415"


@pytest.mark.parametrize(
    "country",
    [
        "United States",
        "United States of America",
        "US",
        "USA",
        "U.S.",
        "U.S.A.",
        "united states",
        "u.s.a.",
    ],
)
@pytest.mark.parametrize(
    "separator", [" ", ", ", ",,", ". ", ";", ": ", " - ", "–", " — ", "\r\n"]
)
@pytest.mark.parametrize("ending", ["", ",", ".", ";"])
def test_terminal_country_formats(country, separator, ending):
    assert (
        normalize_address_format(PUBLIC_ADDRESS + separator + country + ending)
        == PUBLIC_ADDRESS
    )


@pytest.mark.parametrize(
    "ending",
    [
        ", Canada",
        ", United Kingdom",
        "United States",
        "/ United States",
        ", United States extra",
        ", United States, Canada",
        ", United States /",
        ", United States of Mexico",
    ],
)
def test_unknown_or_unseparated_country_is_not_discarded(ending):
    address = PUBLIC_ADDRESS + ending
    assert normalize_address_format(address) == address


@pytest.mark.parametrize(
    "address",
    [
        "Minneapolis, MN 55415, United States",
        "350 S 5th St, Minneapolis, MN, United States",
        "350 S 5th St, Minneapolis, 55415, United States",
        "350 S 5th St, Minneapolis, MN 5541, United States",
        "350 S 5th St, Minneapolis, MN 554150, United States",
    ],
)
def test_incomplete_address_does_not_gain_a_match_by_country_removal(address):
    assert normalize_address_format(address) == address


def test_cleanup_preserves_unit_direction_zip4_and_foreign_state():
    address = "350 S 5th St Unit A, Minneapolis, MN 55415-1234"
    assert normalize_address_format(address + ", USA") == address
    assert normalize_address_format(
        address.replace(" MN ", " WI ") + ", USA"
    ) == address.replace(" MN ", " WI ")
    assert (
        normalize_address_format("350\tS 5th St,\r\nMinneapolis, MN 55415, USA")
        == PUBLIC_ADDRESS
    )
    assert normalize_address_format(PUBLIC_ADDRESS + ",") == PUBLIC_ADDRESS


@pytest.mark.parametrize("control", ["\x00", "\x0b", "\x0c", "\x1f", "\x7f"])
def test_cleanup_does_not_hide_forbidden_controls(control):
    assert control in normalize_address_format(PUBLIC_ADDRESS + control)


def test_unicode_spaces_remain_supported_without_discarding_controls():
    entered = "350\u00a0S 5th St,\t\u2003Minneapolis, MN\u00a055415, United States"
    assert normalize_address_format(entered) == PUBLIC_ADDRESS


@pytest.mark.parametrize(
    "country",
    ["United States", "United States of America", "US", "USA", "U.S.", "U.S.A."],
)
@pytest.mark.parametrize("separator", ["", " ", ", ", ": ", " - ", " – ", " — "])
def test_parenthesized_terminal_country(country, separator):
    assert (
        normalize_address_format(PUBLIC_ADDRESS + separator + "(" + country + ").")
        == PUBLIC_ADDRESS
    )


@pytest.mark.parametrize(
    "suffix",
    [
        ": Canada",
        " - Canada",
        " (Canada)",
        " — United Kingdom",
        " (United States",
        " United States)",
        " (United States))",
        " (United States) Canada",
        " — United States, Canada",
        " (United States / Canada)",
        "-",
        "-123",
        "-12345",
    ],
)
def test_expanded_country_punctuation_does_not_hide_other_input(suffix):
    address = PUBLIC_ADDRESS + suffix
    assert normalize_address_format(address) == address
