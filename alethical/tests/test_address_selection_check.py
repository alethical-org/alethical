"""A chosen address is settled against current official points before districts.

Covers 2 exposures: rows printing the same address with different official points,
and a capped official answer that cannot prove an address is unique.
"""

from types import SimpleNamespace

import pytest
import requests

from alethical.api.services.representative_lookup import (
    AddressPointsIncomplete,
    DistrictMatch,
    GeocodedAddress,
    MinnesotaAddressPointGeocoder,
    MinnesotaGisLookupClient,
    RepresentativeLookupAmbiguousLocation,
    RepresentativeLookupNotFound,
    RepresentativeLookupService,
    RepresentativeLookupUpstreamError,
)

# Real points on Alethical's stored district maps. The first 2 are 6 metres apart
# in downtown Minneapolis; the third is at the Capitol in Saint Paul.
MINNEAPOLIS = (44.9778, -93.2650)
MINNEAPOLIS_NEARBY = (44.97785, -93.26505)
SAINT_PAUL = (44.9551, -93.1022)


def row(latitude, longitude, *, city="Minneapolis", zip_code="55415"):
    return {
        "attributes": {
            "anumber": 350,
            "st_pre_dir": "South",
            "st_name": "5th",
            "st_pos_typ": "Street",
            "postcomm": city,
            "ctu_name": city,
            "zip": zip_code,
            "state_code": "MN",
            "latitude": latitude,
            "longitude": longitude,
            "status": "Active",
        }
    }


ADDRESS = "350 South 5th Street, Minneapolis, MN 55415"


@pytest.fixture
def source(monkeypatch):
    """Fake Minnesota address-point answers, recording each requested row cap."""
    state = SimpleNamespace(answers=[], counts=[])

    class Response:
        def __init__(self, payload):
            self.payload = payload
            self.status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    def get(url, *, params, timeout):
        state.counts.append(params["resultRecordCount"])
        answer = state.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return Response(answer)

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.public_source_session",
        lambda: SimpleNamespace(get=get),
    )
    return state


class NoCensus:
    def geocode_matches(self, address_text):
        raise RepresentativeLookupNotFound("address could not be geocoded")


class RecordingDistricts(MinnesotaGisLookupClient):
    def __init__(self):
        self.points = []

    def lookup(self, *, latitude, longitude):
        self.points.append((latitude, longitude))
        return (
            DistrictMatch(chamber="house", district_code="60B"),
            DistrictMatch(chamber="senate", district_code="60"),
            "5",
        )


def service(districts=None):
    return RepresentativeLookupService(
        geocoder=NoCensus(),
        address_point_geocoder=MinnesotaAddressPointGeocoder(),
        gis_client=districts or RecordingDistricts(),
    )


def test_same_printed_address_keeps_every_official_point(source):
    source.answers = [{"features": [row(*MINNEAPOLIS), row(*SAINT_PAUL)]}]

    matches = MinnesotaAddressPointGeocoder().geocode_matches(ADDRESS)

    assert [match.matched_address for match in matches] == [
        "350 South 5th Street, Minneapolis, MN 55415"
    ]
    assert matches[0].conflicting_points == (MINNEAPOLIS, SAINT_PAUL)
    assert matches[0].requires_location_check


def test_typed_lookup_refuses_points_in_different_districts(source):
    # Census is unavailable, so Minnesota's points decide. Neither may be guessed.
    source.answers = [{"features": [row(*MINNEAPOLIS), row(*SAINT_PAUL)]}]
    districts = RecordingDistricts()

    with pytest.raises(RepresentativeLookupAmbiguousLocation):
        service(districts).lookup(ADDRESS)

    assert districts.points == []


def test_typed_lookup_continues_when_every_point_shares_districts(source):
    source.answers = [{"features": [row(*MINNEAPOLIS), row(*MINNEAPOLIS_NEARBY)]}]
    districts = RecordingDistricts()

    result = service(districts).lookup(ADDRESS)

    assert districts.points == [MINNEAPOLIS]
    assert result.geocoded_address.matched_address == ADDRESS


def test_district_check_uses_stored_maps():
    client = MinnesotaGisLookupClient()

    assert client.points_share_districts((MINNEAPOLIS, MINNEAPOLIS_NEARBY))
    assert not client.points_share_districts((MINNEAPOLIS, SAINT_PAUL))


# On the stored maps: inside House 59B, on the 59B/43B border, and inside 43B.
INSIDE_59B = (45.0040, -93.3150)
ON_59B_43B_BORDER = (45.006042, -93.31852)
INSIDE_43B = (45.0080, -93.3220)


@pytest.mark.parametrize(
    "points",
    [
        (INSIDE_59B, ON_59B_43B_BORDER),
        (ON_59B_43B_BORDER, INSIDE_59B),
        (INSIDE_59B, INSIDE_43B),
    ],
    ids=["inside-then-border", "border-then-inside", "either-side"],
)
def test_a_point_on_a_shared_border_is_never_a_shared_answer(points):
    # The single-point lookup refuses the border point, so a group holding it
    # cannot claim 1 answer either, whichever point comes first.
    assert not MinnesotaGisLookupClient().points_share_districts(points)


def test_side_by_side_districts_need_1_answer_for_every_point(monkeypatch):
    from shapely.geometry import box

    from alethical.api.services import legislative_districts as maps

    def district(chamber, code, shape):
        return maps.LegislativeDistrictGeometry(chamber, code, {}, shape)

    west, east = box(-94, 45, -93.5, 46), box(-93.5, 45, -93, 46)
    monkeypatch.setattr(
        maps,
        "_legislative_district_geometries",
        lambda: {
            "house": (district("house", "1A", west), district("house", "1B", east)),
            "senate": (district("senate", "1", box(-94, 45, -93, 46)),),
        },
    )
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup._congressional_district_geometries",
        lambda: (("1", box(-94, 45, -93, 46)),),
    )
    client = MinnesotaGisLookupClient()

    assert client.points_share_districts(((45.5, -93.8), (45.6, -93.7)))
    assert not client.points_share_districts(((45.5, -93.8), (45.5, -93.5)))
    assert not client.points_share_districts(((45.5, -93.8), (45.5, -93.2)))
    # Outside every district everywhere is 1 shared answer: none.
    assert client.points_share_districts(((47, -91), (47.1, -91.1)))
    assert not client.points_share_districts(((45.5, -93.8), (47, -91)))


def test_an_unreadable_district_map_is_a_source_failure_not_a_disagreement(
    source, monkeypatch
):
    from alethical.api.services import legislative_districts as maps

    def broken():
        raise maps.LegislativeDistrictDataError(
            "Legislative district map could not be loaded"
        )

    monkeypatch.setattr(maps, "_legislative_district_geometries", broken)
    with pytest.raises(RepresentativeLookupUpstreamError):
        MinnesotaGisLookupClient().points_share_districts((MINNEAPOLIS, SAINT_PAUL))

    source.answers = [{"features": [row(*MINNEAPOLIS), row(*MINNEAPOLIS_NEARBY)]}]
    with pytest.raises(RepresentativeLookupUpstreamError):
        service(RecordingDistricts()).lookup_selected(
            ADDRESS, latitude=MINNEAPOLIS[0], longitude=MINNEAPOLIS[1]
        )


def test_capped_exact_answer_is_retried_with_the_full_cap(source):
    source.answers = [
        {"features": [row(*MINNEAPOLIS)], "exceededTransferLimit": True},
        {
            "features": [
                row(*MINNEAPOLIS),
                row(45.0, -93.3, city="Golden Valley", zip_code="55422"),
            ]
        },
    ]

    matches = MinnesotaAddressPointGeocoder().geocode_matches(
        "350 S 5th St, Somewhere, MN"
    )

    assert source.counts == ["100", "2000"]
    assert len(matches) == 2


def test_still_capped_exact_answer_never_claims_a_unique_location(source):
    source.answers = [
        {"features": [row(*MINNEAPOLIS)], "exceededTransferLimit": True},
        {"features": [row(*MINNEAPOLIS)], "exceededTransferLimit": True},
    ]

    with pytest.raises(AddressPointsIncomplete):
        MinnesotaAddressPointGeocoder().geocode_matches("350 S 5th St, Somewhere, MN")
    assert issubclass(AddressPointsIncomplete, RepresentativeLookupUpstreamError)


def test_selected_address_uses_the_current_point_when_it_moved(source):
    source.answers = [{"features": [row(*MINNEAPOLIS_NEARBY)]}]
    districts = RecordingDistricts()

    result = service(districts).lookup_selected(
        ADDRESS, latitude=MINNEAPOLIS[0], longitude=MINNEAPOLIS[1]
    )

    assert districts.points == [MINNEAPOLIS_NEARBY]
    assert result.geocoded_address.matched_address == ADDRESS
    assert source.counts == ["2000"]


def test_selected_address_prefers_the_nearest_point_that_shares_districts(source):
    source.answers = [{"features": [row(*MINNEAPOLIS), row(*MINNEAPOLIS_NEARBY)]}]
    districts = RecordingDistricts()

    service(districts).lookup_selected(
        ADDRESS, latitude=MINNEAPOLIS_NEARBY[0], longitude=MINNEAPOLIS_NEARBY[1]
    )

    assert districts.points == [MINNEAPOLIS_NEARBY]


def test_selected_address_refuses_current_points_in_different_districts(source):
    source.answers = [{"features": [row(*MINNEAPOLIS), row(*SAINT_PAUL)]}]
    districts = RecordingDistricts()

    with pytest.raises(RepresentativeLookupAmbiguousLocation):
        service(districts).lookup_selected(
            ADDRESS, latitude=MINNEAPOLIS[0], longitude=MINNEAPOLIS[1]
        )
    assert districts.points == []


@pytest.mark.parametrize(
    "check_answer",
    [
        {"features": []},
        {"features": [row(*MINNEAPOLIS)], "exceededTransferLimit": True},
        requests.ConnectionError("source down"),
        {"features": [row(*MINNEAPOLIS, city="Edina", zip_code="55424")]},
    ],
    ids=["no-current-row", "capped", "source-failure", "different-printed-address"],
)
def test_unsettled_check_uses_the_typed_lookup_never_the_submitted_point(
    source, monkeypatch, check_answer
):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.UPSTREAM_RETRY_DELAYS_SECONDS",
        (),
    )
    source.answers = [check_answer, {"features": [row(*MINNEAPOLIS_NEARBY)]}]
    districts = RecordingDistricts()

    # A point the current records do not hold must not decide districts.
    service(districts).lookup_selected(ADDRESS, latitude=46.0, longitude=-94.0)

    assert districts.points == [MINNEAPOLIS_NEARBY]


def test_typed_lookup_after_an_unsettled_check_keeps_refusing_to_guess(source):
    source.answers = [
        {"features": []},
        {"features": [row(*MINNEAPOLIS), row(*SAINT_PAUL)]},
    ]

    with pytest.raises(RepresentativeLookupAmbiguousLocation):
        service().lookup_selected(
            ADDRESS, latitude=MINNEAPOLIS[0], longitude=MINNEAPOLIS[1]
        )


def test_suggestions_offer_a_duplicate_address_once_and_mark_it(source):
    source.answers = [{"features": [row(*MINNEAPOLIS), row(*SAINT_PAUL)]}]

    suggestions = MinnesotaAddressPointGeocoder().suggest_matches("350 S 5")

    assert [item.matched_address for item in suggestions] == [ADDRESS]
    assert suggestions[0].requires_location_check


def test_a_single_point_suggestion_needs_no_check(source):
    source.answers = [{"features": [row(*MINNEAPOLIS)]}]

    suggestions = MinnesotaAddressPointGeocoder().suggest_matches("350 S 5")

    assert not suggestions[0].requires_location_check
    assert suggestions[0] == GeocodedAddress(
        requested_address="350 S 5",
        matched_address=ADDRESS,
        latitude=MINNEAPOLIS[0],
        longitude=MINNEAPOLIS[1],
        state_code="MN",
    )
