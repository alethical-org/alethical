import json

import pytest
import requests

from alethical.api.services.representative_lookup import (
    CensusGeocoder,
    DistrictMatch,
    GeocodedAddress,
    MinnesotaAddressPointGeocoder,
    MinnesotaGisLookupClient,
    RepresentativeLookupChoices,
    RepresentativeLookupNotFound,
    RepresentativeLookupOutsideMinnesota,
    RepresentativeLookupService,
    congressional_district_for_point,
    geometry_covers_point,
    prepare_district_geometry,
    validate_district_containment,
)


class FakeResponse:
    def __init__(self, payload, *, status_code=200):
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            response = requests.Response()
            response.status_code = self.status_code
            raise requests.HTTPError(response=response)
        return None

    def json(self):
        return self.payload


def census_payload(*matches):
    return {"result": {"addressMatches": list(matches)}}


def census_match(address, *, state="MN", latitude=44.98, longitude=-93.27):
    return {
        "matchedAddress": address,
        "coordinates": {"x": longitude, "y": latitude},
        "addressComponents": {"state": state},
    }


def address_point_feature(**attributes):
    return {"attributes": attributes}


def test_state_address_suggestions_complete_a_partial_active_address(monkeypatch):
    seen_params = {}

    def get(url, *, params, timeout):
        seen_params.update(params)
        return FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=3040,
                        anumberpre=None,
                        anumbersuf=None,
                        st_pre_mod=None,
                        st_pre_dir=None,
                        st_pre_typ=None,
                        st_pre_sep=None,
                        st_name="Excelsior",
                        st_pos_typ="Boulevard",
                        st_pos_dir=None,
                        st_pos_mod=None,
                        postcomm=None,
                        ctu_name="Minneapolis",
                        zip="55416",
                        state_code="MN",
                        longitude=-93.3212,
                        latitude=44.9475,
                        status="Active",
                    ),
                    address_point_feature(
                        anumber=3040,
                        anumberpre=None,
                        anumbersuf=None,
                        st_pre_mod=None,
                        st_pre_dir=None,
                        st_pre_typ=None,
                        st_pre_sep=None,
                        st_name="Exchange",
                        st_pos_typ="Street",
                        st_pos_dir=None,
                        st_pos_mod=None,
                        postcomm="Saint Paul",
                        ctu_name="Saint Paul",
                        zip="55101",
                        state_code="MN",
                        longitude=-93.09,
                        latitude=44.95,
                        status="Retired",
                    ),
                ]
            }
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    matches = MinnesotaAddressPointGeocoder().suggest_matches("3040 Ex")

    assert seen_params["where"] == (
        "anumber = 3040 AND (UPPER(st_name) LIKE 'EX%') AND "
        "(state_code IS NULL OR UPPER(state_code) = 'MN') AND "
        "UPPER(status) = 'ACTIVE'"
    )
    assert seen_params["resultRecordCount"] == "200"
    assert [match.matched_address for match in matches] == [
        "3040 Excelsior Boulevard, Minneapolis, MN 55416"
    ]


def test_state_address_suggestions_wait_for_two_street_letters(monkeypatch):
    calls = []
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: calls.append((args, kwargs)),
    )

    assert MinnesotaAddressPointGeocoder().suggest_matches("3040 E") == []
    assert MinnesotaAddressPointGeocoder().suggest_matches("Excelsior") == []
    assert calls == []


@pytest.mark.parametrize(
    (
        "address_text",
        "house_number",
        "street_name",
        "direction",
        "wrong_direction",
        "city",
        "zip_code",
    ),
    [
        ("350 S 5", 350, "5th", "South", "North", "Minneapolis", "55415"),
        ("100 NW 1", 100, "1st", "Northwest", "Southeast", "Adams", "55909"),
    ],
)
def test_state_address_suggestions_match_numbered_streets_when_the_official_direction_is_trailing(
    monkeypatch,
    address_text,
    house_number,
    street_name,
    direction,
    wrong_direction,
    city,
    zip_code,
):
    seen_params = {}

    def get(url, *, params, timeout):
        seen_params.update(params)
        return FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=house_number,
                        anumberpre=None,
                        anumbersuf=None,
                        st_pre_mod=None,
                        st_pre_dir=None,
                        st_pre_typ=None,
                        st_pre_sep=None,
                        st_name=street_name,
                        st_pos_typ="Street",
                        st_pos_dir=direction,
                        st_pos_mod=None,
                        postcomm=None,
                        ctu_name=city,
                        zip=zip_code,
                        state_code="MN",
                        longitude=-93.2657,
                        latitude=44.9774,
                        status="Active",
                    ),
                    address_point_feature(
                        anumber=house_number,
                        anumberpre=None,
                        anumbersuf=None,
                        st_pre_mod=None,
                        st_pre_dir=None,
                        st_pre_typ=None,
                        st_pre_sep=None,
                        st_name=street_name,
                        st_pos_typ="Street",
                        st_pos_dir=wrong_direction,
                        st_pos_mod=None,
                        postcomm=None,
                        ctu_name="Wrong direction",
                        zip="00000",
                        state_code="MN",
                        longitude=-93.2657,
                        latitude=44.9774,
                        status="Active",
                    ),
                ]
            }
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    matches = MinnesotaAddressPointGeocoder().suggest_matches(address_text)

    assert [match.matched_address for match in matches] == [
        f"{house_number} {street_name} Street {direction}, {city}, MN {zip_code}"
    ]
    assert f"UPPER(st_name) LIKE '{street_name[0]}%'" in seen_params["where"]


def test_state_address_suggestions_rank_a_typed_city_and_zip_locally(monkeypatch):
    seen_params = {}

    def feature(city, zip_code, latitude, longitude):
        return address_point_feature(
            anumber=100,
            anumberpre=None,
            anumbersuf=None,
            st_pre_mod=None,
            st_pre_dir=None,
            st_pre_typ=None,
            st_pre_sep=None,
            st_name="Main",
            st_pos_typ="Street",
            st_pos_dir=None,
            st_pos_mod=None,
            postcomm=city,
            ctu_name=city,
            zip=zip_code,
            state_code="MN",
            longitude=longitude,
            latitude=latitude,
            status="Active",
        )

    def get(url, *, params, timeout):
        seen_params.update(params)
        return FakeResponse(
            {
                "features": [
                    feature("Marshall", "56258", 44.45, -95.79),
                    feature("Minneapolis", "55413", 44.99, -93.25),
                ]
            }
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    matches = MinnesotaAddressPointGeocoder().suggest_matches(
        "100 Ma, Minneapolis, MN 55413"
    )

    assert "MINNEAPOLIS" not in seen_params["where"]
    assert "55413" not in seen_params["where"]
    assert [match.matched_address for match in matches] == [
        "100 Main Street, Minneapolis, MN 55413",
        "100 Main Street, Marshall, MN 56258",
    ]


def test_census_returns_no_match_without_silently_choosing(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(census_payload()),
    )

    with pytest.raises(
        RepresentativeLookupNotFound, match="address could not be geocoded"
    ):
        CensusGeocoder().geocode_matches("1428 Nonesuch Ave")


def test_census_retries_a_brief_source_failure(monkeypatch):
    calls = []
    waits = []

    def get(*args, **kwargs):
        calls.append((args, kwargs))
        if len(calls) == 1:
            raise requests.Timeout("brief timeout")
        return FakeResponse(
            census_payload(census_match("350 S 5TH ST, MINNEAPOLIS, MN 55415"))
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.time.sleep", waits.append
    )

    matches = CensusGeocoder().geocode_matches("350 S 5th St, Minneapolis, MN 55415")

    assert len(calls) == 2
    assert waits == [0.2]
    assert matches[0].matched_address == "350 S 5TH ST, MINNEAPOLIS, MN 55415"


def test_census_does_not_retry_a_permanent_bad_request(monkeypatch):
    calls = []

    def get(*args, **kwargs):
        calls.append((args, kwargs))
        return FakeResponse({}, status_code=400)

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    with pytest.raises(requests.HTTPError):
        CensusGeocoder().geocode_matches("not an address")

    assert len(calls) == 1


def test_census_retries_a_minnesota_street_without_the_wrong_locality(monkeypatch):
    requested = "4255 215th St E, Farmington, MN 55024"
    matched = census_match(
        "4255 215TH ST E, HAMPTON, MN 55031",
        latitude=44.637605981025,
        longitude=-93.020281271416,
    )
    requests = []

    def get(url, *, params, timeout):
        requests.append(params["address"])
        if params["address"] == requested:
            return FakeResponse(census_payload())
        assert params["address"] == "4255 215th St E, MN"
        return FakeResponse(census_payload(matched))

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    matches = CensusGeocoder().geocode_matches(requested)

    assert requests == [requested, "4255 215th St E, MN"]
    assert matches[0].requested_address == requested
    assert matches[0].matched_address == "4255 215TH ST E, HAMPTON, MN 55031"


@pytest.mark.parametrize(
    ("requested", "relaxed"),
    [
        (
            "4255 215th St E Farmington MN 55024",
            "4255 215th St E, MN",
        ),
        (
            "4255   215th Street East   Farmington Minnesota 55024",
            "4255 215th Street East, MN",
        ),
        (
            "4255 215th St. E. Farmington MN 55024",
            "4255 215th St E, MN",
        ),
        (
            "4255 215th St. E. Farmington MN. 55024.",
            "4255 215th St E, MN",
        ),
    ],
)
def test_census_address_input_eval_accepts_punctuation_free_forms(
    monkeypatch, requested, relaxed
):
    matched = census_match(
        "4255 215TH ST E, HAMPTON, MN 55031",
        latitude=44.637605981025,
        longitude=-93.020281271416,
    )
    requests = []

    def get(url, *, params, timeout):
        requests.append(params["address"])
        return FakeResponse(
            census_payload(matched)
            if params["address"] == relaxed
            else census_payload()
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    matches = CensusGeocoder().geocode_matches(requested)

    assert requests[0] == requested
    assert requests[-1] == relaxed
    assert matches[0].matched_address == "4255 215TH ST E, HAMPTON, MN 55031"


def test_census_address_input_eval_keeps_saint_paul_out_of_the_street(monkeypatch):
    requested = "350 S 5th St St Paul MN 55102"
    relaxed = "350 S 5th St, MN"
    requests = []

    def get(url, *, params, timeout):
        requests.append(params["address"])
        return FakeResponse(
            census_payload(census_match("350 S 5TH ST, SAINT PAUL, MN 55102"))
            if params["address"] == relaxed
            else census_payload()
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    matches = CensusGeocoder().geocode_matches(requested)

    assert relaxed in requests
    assert matches[0].matched_address == "350 S 5TH ST, SAINT PAUL, MN 55102"


def test_census_does_not_relax_an_address_without_a_minnesota_locality(monkeypatch):
    requests = []

    def get(url, *, params, timeout):
        requests.append(params["address"])
        return FakeResponse(census_payload())

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    with pytest.raises(RepresentativeLookupNotFound):
        CensusGeocoder().geocode_matches("4255 215th St E")

    assert requests == ["4255 215th St E"]


def test_state_address_fallback_sends_only_house_number_and_street(monkeypatch):
    requested = "4255 215th St E, Farmington, MN 55024"
    seen_params = {}

    def get(url, *, params, timeout):
        seen_params.update(params)
        return FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=4255,
                        anumberpre=None,
                        anumbersuf=None,
                        st_pre_mod=None,
                        st_pre_dir=None,
                        st_pre_typ=None,
                        st_pre_sep=None,
                        st_name="215th",
                        st_pos_typ="Street",
                        st_pos_dir="East",
                        st_pos_mod=None,
                        postcomm="Hampton",
                        ctu_name="Vermillion Township",
                        zip="55031",
                        state_code="MN",
                        longitude=-93.02000538,
                        latitude=44.64011409,
                        status="Active",
                    )
                ]
            }
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    matches = MinnesotaAddressPointGeocoder().geocode_matches(requested)

    assert "4255" in seen_params["where"]
    assert "215TH" in seen_params["where"]
    assert "Farmington" not in str(seen_params)
    assert "55024" not in str(seen_params)
    assert matches == [
        GeocodedAddress(
            requested_address=requested,
            matched_address="4255 215th Street East, Hampton, MN 55031",
            latitude=44.64011409,
            longitude=-93.02000538,
            state_code="MN",
        )
    ]


def test_state_address_input_eval_accepts_no_commas_without_sharing_locality(
    monkeypatch,
):
    requested = "4255 215th St E Farmington MN 55024"
    seen_params = {}

    def get(url, *, params, timeout):
        seen_params.update(params)
        return FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=4255,
                        st_name="215th",
                        st_pos_typ="Street",
                        st_pos_dir="East",
                        postcomm="Hampton",
                        ctu_name="Vermillion Township",
                        zip="55031",
                        state_code="MN",
                        longitude=-93.02000538,
                        latitude=44.64011409,
                        status="Active",
                    )
                ]
            }
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    matches = MinnesotaAddressPointGeocoder().geocode_matches(requested)

    assert "anumber = 4255" in seen_params["where"]
    assert "215TH" in seen_params["where"]
    assert "Farmington" not in str(seen_params)
    assert "55024" not in str(seen_params)
    assert matches[0].matched_address == "4255 215th Street East, Hampton, MN 55031"


def test_state_address_input_eval_uses_one_small_street_typo(monkeypatch):
    requested = "4255 215ht St E Farmington MN 55024"
    seen_where = []

    def get(url, *, params, timeout):
        seen_where.append(params["where"])
        if "LIKE" not in params["where"]:
            return FakeResponse({"features": []})
        return FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=4255,
                        st_name="215th",
                        st_pos_typ="Street",
                        st_pos_dir="East",
                        postcomm="Hampton",
                        zip="55031",
                        state_code="MN",
                        longitude=-93.02000538,
                        latitude=44.64011409,
                        status="Active",
                    )
                ]
            }
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    matches = MinnesotaAddressPointGeocoder().geocode_matches(requested)

    assert len(seen_where) == 2
    assert all("anumber = 4255" in where for where in seen_where)
    assert all(
        "FARMINGTON" not in where and "55024" not in where for where in seen_where
    )
    assert matches[0].matched_address == "4255 215th Street East, Hampton, MN 55031"


@pytest.mark.parametrize(
    "requested",
    [
        "10 Pine Cv Bemidji MN 56601",
        "10 Pine Cove Bemidji Minnesota 56601",
        "10 Pine Stret Bemidji MN 56601",
    ],
)
def test_state_address_input_eval_accepts_official_types_and_a_long_type_typo(
    monkeypatch, requested
):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=10,
                        st_name="Pine",
                        st_pos_typ="Cove" if "Stret" not in requested else "Street",
                        postcomm="Bemidji",
                        zip="56601",
                        state_code="MN",
                        longitude=-94.88,
                        latitude=47.47,
                        status="Active",
                    )
                ]
            }
        ),
    )

    matches = MinnesotaAddressPointGeocoder().geocode_matches(requested)

    assert matches[0].matched_address.startswith("10 Pine ")


def test_state_address_input_eval_does_not_fuzzy_match_a_short_street(monkeypatch):
    requests = []

    def get(url, *, params, timeout):
        requests.append(params)
        return FakeResponse({"features": []})

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    with pytest.raises(RepresentativeLookupNotFound):
        MinnesotaAddressPointGeocoder().geocode_matches("10 Mian St Ada MN 56510")

    assert len(requests) == 1
    assert "LIKE" not in requests[0]["where"]


def test_state_address_input_eval_does_not_hide_a_short_typo_in_a_long_street(
    monkeypatch,
):
    calls = 0

    def get(url, *, params, timeout):
        nonlocal calls
        calls += 1
        if calls == 1:
            return FakeResponse({"features": []})
        return FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=10,
                        st_name="Old Main",
                        st_pos_typ="Street",
                        postcomm="Ada",
                        zip="56510",
                        state_code="MN",
                        longitude=-96.5,
                        latitude=47.3,
                        status="Active",
                    )
                ]
            }
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    with pytest.raises(RepresentativeLookupNotFound):
        MinnesotaAddressPointGeocoder().geocode_matches(
            "10 Old Mian Street Ada Minnesota 56510"
        )


def test_state_address_input_eval_never_changes_the_house_number(monkeypatch):
    seen_where = []

    def get(url, *, params, timeout):
        seen_where.append(params["where"])
        return FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=4255,
                        st_name="215th",
                        st_pos_typ="Street",
                        st_pos_dir="East",
                        postcomm="Hampton",
                        zip="55031",
                        state_code="MN",
                        longitude=-93.02000538,
                        latitude=44.64011409,
                        status="Active",
                    )
                ]
            }
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        get,
    )

    with pytest.raises(RepresentativeLookupNotFound):
        MinnesotaAddressPointGeocoder().geocode_matches(
            "4256 215th St E Farmington MN 55024"
        )

    assert seen_where
    assert all("anumber = 4256" in where for where in seen_where)


def test_state_address_input_eval_rejects_a_materially_different_long_street(
    monkeypatch,
):
    calls = 0

    def get(url, *, params, timeout):
        nonlocal calls
        calls += 1
        if calls == 1:
            return FakeResponse({"features": []})
        return FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=10,
                        st_name="Lakeside",
                        st_pos_typ="Road",
                        postcomm="Ada",
                        zip="56510",
                        state_code="MN",
                        longitude=-96.5,
                        latitude=47.3,
                        status="Active",
                    )
                ]
            }
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    with pytest.raises(RepresentativeLookupNotFound):
        MinnesotaAddressPointGeocoder().geocode_matches(
            "10 Riverside Road Ada Minnesota 56510"
        )


def test_state_address_input_eval_refuses_an_incomplete_close_match_set(monkeypatch):
    calls = 0

    def get(url, *, params, timeout):
        nonlocal calls
        calls += 1
        if calls == 1:
            return FakeResponse({"features": []})
        return FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=4255,
                        st_name="215th",
                        st_pos_typ="Street",
                        st_pos_dir="East",
                        postcomm="Hampton",
                        zip="55031",
                        state_code="MN",
                        longitude=-93.02000538,
                        latitude=44.64011409,
                        status="Active",
                    )
                ],
                "exceededTransferLimit": True,
            }
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    with pytest.raises(RepresentativeLookupNotFound):
        MinnesotaAddressPointGeocoder().geocode_matches(
            "4255 215ht St E Farmington MN 55024"
        )


def test_state_address_input_eval_uses_a_supplied_direction_to_remove_a_false_choice(
    monkeypatch,
):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=4255,
                        st_name="215th",
                        st_pos_typ="Street",
                        st_pos_dir=direction,
                        postcomm="Hampton",
                        zip="55031",
                        state_code="MN",
                        longitude=longitude,
                        latitude=44.64,
                        status="Active",
                    )
                    for direction, longitude in (
                        ("East", -93.02),
                        ("West", -93.03),
                    )
                ]
            }
        ),
    )

    matches = MinnesotaAddressPointGeocoder().geocode_matches(
        "4255 215th St E Hampton Minnesota 55031"
    )

    assert [match.matched_address for match in matches] == [
        "4255 215th Street East, Hampton, MN 55031"
    ]


def test_state_address_input_eval_prefers_a_close_locality_without_guessing_street(
    monkeypatch,
):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=10,
                        st_name="Main",
                        st_pos_typ="Street",
                        postcomm=city,
                        zip=zip_code,
                        state_code="MN",
                        longitude=longitude,
                        latitude=45.0,
                        status="Active",
                    )
                    for city, zip_code, longitude in (
                        ("Minneapolis", "55401", -93.27),
                        ("Anoka", "55303", -93.39),
                    )
                ]
            }
        ),
    )

    matches = MinnesotaAddressPointGeocoder().geocode_matches(
        "10 Main Street Minneaplis Minnesota"
    )

    assert [match.matched_address for match in matches] == [
        "10 Main Street, Minneapolis, MN 55401"
    ]


def test_state_address_input_eval_returns_equally_close_streets_as_choices(monkeypatch):
    calls = 0

    def get(url, *, params, timeout):
        nonlocal calls
        calls += 1
        if calls == 1:
            return FakeResponse({"features": []})
        return FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=10,
                        st_name=street,
                        st_pos_typ="Road",
                        postcomm=city,
                        zip=zip_code,
                        state_code="MN",
                        longitude=longitude,
                        latitude=45.0,
                        status="Active",
                    )
                    for street, city, zip_code, longitude in (
                        ("Northern", "Ada", "56510", -96.5),
                        ("Norten", "Anoka", "55303", -93.4),
                    )
                ]
            }
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    matches = MinnesotaAddressPointGeocoder().geocode_matches(
        "10 Nortern Road Somewhere Minnesota"
    )

    assert [match.matched_address for match in matches] == [
        "10 Northern Road, Ada, MN 56510",
        "10 Norten Road, Anoka, MN 55303",
    ]


def test_state_address_fallback_returns_choices_instead_of_guessing(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=10,
                        st_name="Main",
                        st_pos_typ="Street",
                        postcomm=city,
                        ctu_name=city,
                        zip=zip_code,
                        state_code="MN",
                        longitude=longitude,
                        latitude=45.0,
                        status="Active",
                    )
                    for city, zip_code, longitude in (
                        ("Ada", "56510", -96.5),
                        ("Anoka", "55303", -93.4),
                    )
                ]
            }
        ),
    )

    matches = MinnesotaAddressPointGeocoder().geocode_matches(
        "10 Main St, Somewhere, MN"
    )

    assert [match.matched_address for match in matches] == [
        "10 Main Street, Ada, MN 56510",
        "10 Main Street, Anoka, MN 55303",
    ]


def test_state_address_fallback_accepts_an_uncommon_street_type(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=10,
                        st_name="Pine",
                        st_pos_typ="Cove",
                        postcomm="Bemidji",
                        ctu_name="Bemidji",
                        zip="56601",
                        state_code="MN",
                        longitude=-94.88,
                        latitude=47.47,
                        status="Active",
                    )
                ]
            }
        ),
    )

    matches = MinnesotaAddressPointGeocoder().geocode_matches(
        "10 Pine Cv, Bemidji, MN 56601"
    )

    assert matches[0].matched_address == "10 Pine Cove, Bemidji, MN 56601"


def test_state_address_fallback_rejects_non_minnesota_without_a_request(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: pytest.fail("state address service was called"),
    )

    with pytest.raises(RepresentativeLookupNotFound):
        MinnesotaAddressPointGeocoder().geocode_matches("10 Main St, Fargo, ND 58103")


def test_lookup_uses_state_addresses_only_after_census_has_no_match():
    matched = GeocodedAddress(
        requested_address="10 Main St, Ada, MN",
        matched_address="10 Main Street, Ada, MN 56510",
        latitude=47.3,
        longitude=-96.5,
        state_code="MN",
    )

    class Census:
        def geocode_matches(self, address_text):
            raise RepresentativeLookupNotFound("address could not be geocoded")

    class AddressPoints:
        def geocode_matches(self, address_text):
            return [matched]

    class Gis:
        def lookup(self, *, latitude, longitude):
            assert (latitude, longitude) == (47.3, -96.5)
            return (None, None, "7")

    with pytest.raises(
        RepresentativeLookupNotFound, match="no Minnesota legislative districts"
    ):
        RepresentativeLookupService(
            geocoder=Census(),
            address_point_geocoder=AddressPoints(),
            gis_client=Gis(),
        ).lookup("10 Main St, Ada, MN")


def test_census_filters_minnesota_before_limiting_choices(monkeypatch):
    out_of_state = [
        census_match(f"{number} TEST ST, FARGO, ND", state="ND")
        for number in range(1, 7)
    ]
    minnesota = [
        census_match(f"350 {direction} 5TH ST, MINNEAPOLIS, MN 55401")
        for direction in ("N", "NE", "SE", "S", "SW", "W")
    ]
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(census_payload(*out_of_state, *minnesota)),
    )

    matches = CensusGeocoder().geocode_matches("350 5th St, Minneapolis, MN")

    assert len(matches) == 5
    assert all(match.state_code == "MN" for match in matches)
    assert matches[0].matched_address.startswith("350 N 5TH")


def test_census_reports_outside_minnesota_when_only_other_states_match(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(
            census_payload(
                census_match("1600 PENNSYLVANIA AVE, WASHINGTON, DC", state="DC")
            )
        ),
    )

    with pytest.raises(RepresentativeLookupOutsideMinnesota):
        CensusGeocoder().geocode_matches("1600 Pennsylvania Ave NW")


def test_single_minnesota_match_continues_to_district_lookup(monkeypatch):
    match = census_match("350 S 5TH ST, MINNEAPOLIS, MN 55415")
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(census_payload(match)),
    )

    class Gis:
        def lookup(self, *, latitude, longitude):
            assert (latitude, longitude) == (44.98, -93.27)
            return (None, None, "5")

    with pytest.raises(
        RepresentativeLookupNotFound, match="no Minnesota legislative districts"
    ):
        RepresentativeLookupService(geocoder=CensusGeocoder(), gis_client=Gis()).lookup(
            "350 S 5th St"
        )


def test_lookup_uses_minnesota_addresses_when_census_stays_unavailable():
    address = "350 S 5th St, Minneapolis, MN 55415"
    match = GeocodedAddress(
        requested_address=address,
        matched_address="350 S 5th St, Minneapolis, MN 55415",
        latitude=44.98,
        longitude=-93.27,
        state_code="MN",
    )

    class UnavailableCensus:
        def geocode_matches(self, address_text):
            assert address_text == address
            raise requests.Timeout("Census stayed unavailable")

    class MinnesotaAddresses:
        def geocode_matches(self, address_text):
            assert address_text == address
            return [match]

    class Districts:
        def lookup(self, *, latitude, longitude):
            assert (latitude, longitude) == (44.98, -93.27)
            return (
                DistrictMatch(chamber="house", district_code="62A"),
                DistrictMatch(chamber="senate", district_code="62"),
                "5",
            )

    result = RepresentativeLookupService(
        geocoder=UnavailableCensus(),
        address_point_geocoder=MinnesotaAddresses(),
        gis_client=Districts(),
    ).lookup(address)

    assert result.geocoded_address == match
    assert result.house_district and result.house_district.district_code == "62A"


def test_multiple_minnesota_matches_are_returned_as_choices(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(
            census_payload(
                census_match("350 5TH ST N, MINNEAPOLIS, MN 55401"),
                census_match("350 S 5TH ST, MINNEAPOLIS, MN 55415"),
            )
        ),
    )

    with pytest.raises(RepresentativeLookupChoices) as raised:
        RepresentativeLookupService(geocoder=CensusGeocoder()).lookup("350 5th St")

    assert [choice.matched_address for choice in raised.value.choices] == [
        "350 5TH ST N, MINNEAPOLIS, MN 55401",
        "350 S 5TH ST, MINNEAPOLIS, MN 55415",
    ]


def test_geometry_supports_multipolygons_holes_and_boundary_points():
    geometry = {
        "type": "MultiPolygon",
        "coordinates": [
            [
                [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
                [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
            ],
            [[[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]]],
        ],
    }

    assert geometry_covers_point(geometry, longitude=0, latitude=5)
    assert geometry_covers_point(geometry, longitude=21, latitude=21)
    assert not geometry_covers_point(geometry, longitude=5, latitude=5)


def test_geometry_reduction_keeps_selected_point_and_reduces_large_fixture():
    outer = [[0, 0]]
    for index in range(1, 500):
        outer.append([index / 100, 0.00001 * (index % 2)])
    outer += [[5, 5], [0, 5], [0, 0]]
    geometry = {"type": "Polygon", "coordinates": [outer]}

    prepared = prepare_district_geometry(geometry, longitude=1, latitude=1)

    assert geometry_covers_point(prepared, longitude=1, latitude=1)
    assert len(json.dumps(prepared)) < len(json.dumps(geometry))


def test_gis_uses_local_legislative_and_congressional_maps(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: pytest.fail(
            "district lookup must not call the network"
        ),
    )

    house, senate, congress = MinnesotaGisLookupClient().lookup(
        latitude=44.9551, longitude=-93.1022
    )

    assert house and house.district_code == "65B" and house.geometry
    assert senate and senate.district_code == "65" and senate.geometry
    assert congress == "4"


def test_local_congressional_map_covers_cold_spring_without_sharing_the_point():
    assert congressional_district_for_point(longitude=-94.4289, latitude=45.4558) == "7"
    assert congressional_district_for_point(longitude=0, latitude=0) is None


def test_rural_codes_and_source_shared_edge_sliver_are_handled():
    house = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [10.001, 0], [10.001, 10], [0, 10], [0, 0]]],
    }
    senate = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    }
    validate_district_containment(house, senate, house_code="1A", senate_code="1")


def test_matching_districts_accept_independently_drawn_api_boundaries():
    house = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [10.06, 0], [10.06, 10], [0, 10], [0, 0]]],
    }
    senate = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    }

    validate_district_containment(house, senate, house_code="18B", senate_code="18")


def test_containment_rejects_wrong_parent_code():
    house = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    }
    senate = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    }

    with pytest.raises(Exception, match="codes do not nest"):
        validate_district_containment(house, senate, house_code="1A", senate_code="2")
