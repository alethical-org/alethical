"""Suggestion-only optimizations preserve submitted-address matching."""

import pytest

from alethical.api.services.representative_lookup import (
    MinnesotaAddressPointGeocoder,
)
from alethical.tests.test_representative_lookup_service import suggestion_feature


@pytest.mark.parametrize("street", ["Summit", "Park", "Lake", "Ridge", "Avenue"])
def test_suggestion_keeps_a_lone_street_name_that_is_also_a_type(street):
    query = MinnesotaAddressPointGeocoder._parse_suggestion_query(f"1006 {street}")
    assert query is not None
    assert query.street_names == (street.upper(),)
    assert query.street_type is None


def test_complete_suggestion_still_parses_its_street_type():
    query = MinnesotaAddressPointGeocoder._parse_suggestion_query("1006 Summit Ave")
    assert query is not None
    assert query.street_names == ("SUMMIT",)
    assert query.street_type == "AVENUE"


def test_summit_remains_selectable_while_its_name_is_being_typed(monkeypatch):
    geocoder = MinnesotaAddressPointGeocoder()
    calls = []

    def source(where, *, result_record_count):
        calls.append(where)
        return [
            suggestion_feature(
                anumber=1006,
                st_name="Summit",
                st_pos_typ="Avenue",
                st_pos_dir=None,
                ctu_name="Saint Paul",
                zip="55105",
            )
        ], False

    monkeypatch.setattr(geocoder, "_request_features", source)
    for text in ("1006 Sum", "1006 Summit", "1006 Summit Ave"):
        assert [match.matched_address for match in geocoder.suggest_matches(text)] == [
            "1006 Summit Avenue, Saint Paul, MN 55105"
        ]
    assert len(calls) == 3
    # Submitted-address interpretation has not been relaxed by the typing fix.
    assert geocoder._parse_query("1006 Summit") is None
