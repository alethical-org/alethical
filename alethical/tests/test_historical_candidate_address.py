"""A historical match needs every exact official point for the selected building."""

import pytest

from alethical.api.services import candidate_lookup
from alethical.pipeline.candidate_ballot import StreetAddress

ADDRESS = StreetAddress("13TH AVE S", "SOUTH ST PAUL", "MN", "55075", 500)


def feature(**overrides):
    return {
        "attributes": {
            "anumber": 500,
            "st_name": "13TH",
            "st_pos_typ": "AVE",
            "st_pos_dir": "S",
            "postcomm": "South Saint Paul",
            "state_code": "MN",
            "zip": "55075",
            "status": "ACTIVE",
            "latitude": 44.881,
            "longitude": -93.05,
            **overrides,
        }
    }


def reply(monkeypatch, features, **flags):
    monkeypatch.setattr(
        candidate_lookup,
        "historical_point_payload",
        lambda zip_code, house_number: {"features": features, **flags},
    )


def test_exact_points_keep_all_locations_without_fuzzy_or_partial_matches(monkeypatch):
    reply(
        monkeypatch,
        [
            feature(),
            feature(latitude=44.882),
            feature(st_name="13"),
            feature(st_pos_dir="N"),
            feature(zip="55076"),
            feature(anumber=502),
            feature(status="RETIRED"),
            feature(postcomm="Saint Paul"),
            feature(state_code="WI"),
        ],
    )
    assert candidate_lookup.historical_address_points(ADDRESS) == {
        (44.881, -93.05),
        (44.882, -93.05),
    }


@pytest.mark.parametrize(
    "features,flags",
    [
        ([feature()], {"exceededTransferLimit": True}),
        ([feature(), feature(latitude=None)], {}),
        ([feature(), feature(longitude="nan")], {}),
        ([feature(st_name="13")], {}),
    ],
)
def test_cannot_choose_an_unproven_location(monkeypatch, features, flags):
    reply(monkeypatch, features, **flags)
    assert not candidate_lookup.historical_address_points(ADDRESS)


def test_finder_uses_minnesota_election_day_until_local_midnight():
    from datetime import UTC, datetime
    from alethical.api.services.candidate_lookup import CandidateLookupService

    service = CandidateLookupService(
        now=lambda: datetime(2026, 11, 4, 5, 59, tzinfo=UTC)
    )
    assert service.elections()[0]["capabilities"]["addressLookup"] == "current-ballot"
    service.now = lambda: datetime(2026, 11, 4, 6, tzinfo=UTC)
    elections = service.elections()
    assert elections[0]["capabilities"]["addressLookup"] == "historical-ballot"
    assert elections[1]["capabilities"]["addressLookup"] == "unavailable"


def test_historical_lookup_keeps_exact_range_checks_and_skips_live_ballots(
    client, monkeypatch
):
    from datetime import UTC, datetime

    from alethical.api.services import candidate_historical_races
    from alethical.tests.test_candidate_lookup import ADDRESS as EXAMPLE, service

    lookup, calls = service()
    lookup.now = lambda: datetime(2026, 11, 18, tzinfo=UTC)
    # This is an official public test point in South St. Paul precinct 3.
    monkeypatch.setattr(
        candidate_lookup,
        "historical_address_points",
        lambda _: {(44.883362, -93.050364)},
    )
    seen = []

    def saved(db, *, address, geography):
        seen.append((address, geography.precinct_code))
        return {
            "kind": "results",
            "electionId": "8334",
            "matchedAddress": address,
            "races": [],
            "coverage": [],
            "electionEnded": True,
        }

    monkeypatch.setattr(
        candidate_historical_races, "historical_candidate_results", saved
    )
    client.app.dependency_overrides[candidate_lookup.get_candidate_lookup_service] = (
        lambda: lookup
    )
    try:
        for addr, expected in [
            (EXAMPLE, "results"),
            (EXAMPLE.replace("100", "9999999"), "no-match"),
        ]:
            response = client.post(
                "/api/v1/candidates/lookup",
                json={"address": addr, "electionId": "8334"},
            )
            assert response.status_code == 200
            assert response.headers["cache-control"] == "private, no-store"
            assert response.json()["kind"] == expected
        assert seen == [(EXAMPLE, "4430")]
        assert all(url == candidate_lookup.STREETS_URL for url, _ in calls)
    finally:
        client.app.dependency_overrides.pop(
            candidate_lookup.get_candidate_lookup_service
        )


def test_building_point_cannot_decide_a_unit_specific_ballot(client, monkeypatch):
    from datetime import UTC, datetime
    from alethical.tests.test_candidate_lookup import (
        ADDRESS as EXAMPLE,
        service,
        street,
    )

    lookup, _ = service(rows=[street(DisplayUnitNbr=True, UnitNumberRange="1 - 10")])
    lookup.now = lambda: datetime(2026, 11, 18, tzinfo=UTC)
    monkeypatch.setattr(
        candidate_lookup,
        "historical_address_points",
        lambda _: pytest.fail("unit-specific ballot looked up by building point"),
    )
    client.app.dependency_overrides[candidate_lookup.get_candidate_lookup_service] = (
        lambda: lookup
    )
    try:
        response = client.post(
            "/api/v1/candidates/lookup",
            json={"address": EXAMPLE.replace(",", " Apt 2,", 1), "electionId": "8334"},
        )
        assert response.json()["kind"] == "historical-match-unavailable"
    finally:
        client.app.dependency_overrides.pop(
            candidate_lookup.get_candidate_lookup_service
        )


@pytest.mark.parametrize("status", [None, "", "  ", "Current", "ACTIVE"])
def test_optional_county_status_and_official_point_geometry(monkeypatch, status):
    source = feature(status=status, latitude=None, longitude=None)
    source["geometry"] = {"x": -93.05, "y": 44.881}
    reply(monkeypatch, [source], spatialReference={"wkid": 4326})
    assert candidate_lookup.historical_address_points(ADDRESS) == {(44.881, -93.05)}


@pytest.mark.parametrize(
    "status", ["Inactive", "Proposed", "Pending", "Vacant", "Retired", "Unknown"]
)
def test_noncurrent_county_points_cannot_assign_a_ballot(monkeypatch, status):
    reply(monkeypatch, [feature(status=status)])
    assert not candidate_lookup.historical_address_points(ADDRESS)


def test_omitted_status_cannot_override_a_real_retirement_date(monkeypatch):
    reply(monkeypatch, [feature(status=None, ret_date=1704067200000)])
    assert not candidate_lookup.historical_address_points(ADDRESS)


def test_wrong_geometry_projection_cannot_be_used_as_lon_lat(monkeypatch):
    source = feature(latitude=None, longitude=None)
    source["geometry"] = {"x": -93.05, "y": 44.881}
    reply(monkeypatch, [source], spatialReference={"wkid": 26915})
    assert not candidate_lookup.historical_address_points(ADDRESS)


def test_post_election_retirement_preserves_a_second_election_day_point(monkeypatch):
    reply(
        monkeypatch,
        [
            feature(),
            feature(
                status="Retired",
                latitude=44.912,
                eff_date=1714521600000,
                ret_date=1794096000000,
            ),
        ],
    )
    assert candidate_lookup.historical_address_points(ADDRESS) == {
        (44.881, -93.05),
        (44.912, -93.05),
    }


def test_undated_retired_point_cannot_hide_a_different_location(monkeypatch):
    reply(monkeypatch, [feature(), feature(status="Retired", latitude=44.912)])
    assert candidate_lookup.historical_address_points(ADDRESS) is None


def test_conflicting_coordinate_fields_preserve_both_for_map_check(monkeypatch):
    source = feature()
    source["geometry"] = {"x": -93.05, "y": 44.9}
    reply(monkeypatch, [source], spatialReference={"wkid": 4326})
    assert candidate_lookup.historical_address_points(ADDRESS) == {
        (44.881, -93.05),
        (44.9, -93.05),
    }


def test_malformed_success_body_cannot_fall_back_to_another_location_source(
    monkeypatch,
):
    import requests

    def missing_map(zip_code, house_number):
        raise FileNotFoundError

    monkeypatch.setattr(candidate_lookup, "historical_point_payload", missing_map)
    response = requests.Response()
    response.status_code = 200
    response._content = b'{"features": ['

    def post(url, **kwargs):
        assert url == candidate_lookup.MINNESOTA_ADDRESS_POINTS_URL
        assert kwargs["allow_redirects"] is False and "params" not in kwargs
        assert kwargs["data"]["where"] == "anumber = 500 AND zip = '55075'"
        return response

    monkeypatch.setattr(candidate_lookup.public_source_session(), "post", post)
    with pytest.raises(
        candidate_lookup.CandidateLookupUnavailable,
        match="Invalid Minnesota address points",
    ):
        candidate_lookup.historical_address_points(ADDRESS)


def test_historical_building_lookup_reads_the_public_map_locally(monkeypatch):
    calls = []

    def packaged(zip_code, house_number):
        calls.append((zip_code, house_number))
        return {"features": [feature()]}

    monkeypatch.setattr(candidate_lookup, "historical_point_payload", packaged)
    monkeypatch.setattr(
        candidate_lookup.public_source_session(),
        "post",
        lambda *a, **kw: pytest.fail(
            "a packaged building lookup made a network request"
        ),
    )
    assert candidate_lookup.historical_address_points(ADDRESS) == {(44.881, -93.05)}
    assert calls == [("55075", 500)]
