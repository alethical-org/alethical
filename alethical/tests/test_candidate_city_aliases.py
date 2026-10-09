"""The map source and election source may spell Saint differently."""

from types import SimpleNamespace

import pytest

from alethical.api.services.candidate_lookup import _parse_with_rows
from alethical.tests.test_candidate_ballot import street
from alethical.tests.test_candidate_lookup import service


@pytest.mark.parametrize("source_city", ["ST PAUL", "SAINT PAUL"])
@pytest.mark.parametrize("typed_city", ["ST PAUL", "ST. PAUL", "SAINT PAUL"])
def test_saint_city_spellings_keep_one_exact_election_range(source_city, typed_city):
    rows = [street(CityName=source_city)]
    matches = _parse_with_rows(f"100 EXAMPLE ST N, {typed_city}, MN 99999", rows)
    assert len(matches) == 1
    assert matches[0].city == source_city


@pytest.mark.parametrize(
    "city", ["SAINT CLOUD", "PAUL", "EAST SAINT PAUL", "ST PAUL EXTRA"]
)
def test_city_alias_does_not_discard_unknown_or_different_place(city):
    rows = [street(CityName="ST PAUL")]
    assert _parse_with_rows(f"100 EXAMPLE ST N, {city}, MN 99999", rows) == []


def test_map_saint_city_survives_candidate_suggestion_and_submit_checks():
    class Geocoder:
        def suggest_matches(self, text):
            return [
                SimpleNamespace(
                    matched_address="100 EXAMPLE ST N, SAINT PAUL, MN 99999",
                    state_code="MN",
                )
            ]

    lookup, _ = service(rows=[street(CityName="ST PAUL")], geocoder=Geocoder())
    choices = lookup.suggest("100 EX")
    assert len(choices) == 1
    assert lookup.resolve(choices[0]["address"], choices[0])[0].city == "ST PAUL"

    lookup, _ = service(
        rows=[
            street(CityName="ST PAUL"),
            street(CityName="ST PAUL", ProdAddressRangeId=124),
        ],
        geocoder=Geocoder(),
    )
    assert lookup.suggest("100 EX") == []


@pytest.mark.parametrize(
    "change",
    [
        {"HouseNumberLow": 102},
        {"FullStreetName": "OTHER ST N"},
        {"ZipCode": "99998"},
        {"DisplayUnitNbr": True, "UnitNumberRange": "UNIT B"},
    ],
)
def test_saint_city_alias_cannot_bypass_other_address_checks(change):
    lookup, _ = service(rows=[street(CityName="ST PAUL", **change)])
    assert lookup.suggest("100 EXAMPLE ST N, SAINT PAUL, MN 99999") == []


@pytest.mark.parametrize(
    "confirmed_address",
    [
        "102 EXAMPLE ST N, SAINT PAUL, MN 99999",
        "100 EXAMPLE ST S, SAINT PAUL, MN 99999",
        "100 EXAMPLE ST N UNIT A, SAINT PAUL, MN 99999",
        "100 EXAMPLE ST N, SAINT CLOUD, MN 99999",
        "100 EXAMPLE ST N, SAINT PAUL, MN 99998",
    ],
)
def test_city_alias_confirmation_must_keep_every_address_identity_field(
    confirmed_address,
):
    from alethical.api.services.candidate_lookup import _choice

    lookup, _ = service(rows=[street(CityName="ST PAUL")])
    assert lookup.resolve(
        "100 EXAMPLE ST N, ST PAUL, MN 99999", _choice(confirmed_address)
    ) == {"kind": "no-match"}


@pytest.mark.parametrize("typed_city", ["ST PAUL", "SAINT PAUL", "ST. PAUL"])
@pytest.mark.parametrize("confirmed_city", [None, "ST PAUL", "SAINT PAUL"])
@pytest.mark.parametrize("source_street", ["EXAMPLE ST N", "EXAMPLE STREET NORTH"])
@pytest.mark.parametrize("source_city", ["SAINT PAUL", "SAINT  PAUL", "ST. PAUL"])
def test_mixed_city_spellings_cannot_select_an_overlapping_range(
    typed_city, confirmed_city, source_street, source_city
):
    from alethical.api.services.candidate_lookup import _choice

    lookup, _ = service(
        rows=[
            street(CityName="ST PAUL"),
            street(
                FullStreetName=source_street,
                CityName=source_city,
                ProdAddressRangeId=124,
            ),
        ]
    )
    address = f"100 EXAMPLE ST N, {typed_city}, MN 99999"
    confirmed = (
        _choice(f"100 EXAMPLE ST N, {confirmed_city}, MN 99999")
        if confirmed_city
        else None
    )
    assert lookup.suggest(address) == []
    assert lookup.resolve(address, confirmed) == {"kind": "no-match"}
