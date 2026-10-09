"""Source acquisition, privacy, exact address matching and durable profile behavior."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from alethical.api.services import candidate_lookup
from alethical.api.services.candidate_lookup import (
    SOURCE_URL,
    STREET_ID_URL,
    STREETS_URL,
    UNIT_RANGES_URL,
    CandidateLookupService,
    CandidateLookupUnavailable,
    get_candidate_lookup_service,
    load_profile,
    official_bytes,
    persist_catalogue,
)
from alethical.db.models import CandidateRecord, CandidateSnapshot
from alethical.db.session import get_session_factory
from alethical.pipeline.candidate_ballot import candidate_ballot_document
from alethical.tests.test_candidate_ballot import candidate, source, street

NOW = datetime(2026, 9, 30, 14, tzinfo=UTC)
ADDRESS = "100 EXAMPLE ST N, EXAMPLE CITY, MN 99999"
EXAMPLE_LISTING = {
    "ProdAddressRangeId": None,
    "FullStreetNameCityNameZipCodeId": 4242,
    "FullStreetName": "EXAMPLE ST N ",
    "CityName": "EXAMPLE CITY",
    "ZipCode": "99999",
}


def service(
    *, rows=None, ballot=None, clock=lambda: 0, geocoder=None, listings=None, units=None
):
    calls = []

    def fetch(url, params):
        calls.append((url, params))
        if url == STREETS_URL:
            return json.dumps(
                {"Streets": [street()] if rows is None else rows}
            ).encode()
        if url == STREET_ID_URL:
            if isinstance(listings, Exception):
                raise listings
            return json.dumps(listings or []).encode()
        if url == UNIT_RANGES_URL:
            if isinstance(units, Exception):
                raise units
            return json.dumps([] if units is None else units).encode()
        assert url == SOURCE_URL
        return json.dumps(source(candidate()) if ballot is None else ballot).encode()

    return CandidateLookupService(
        fetch=fetch, now=lambda: NOW, clock=clock, geocoder=geocoder
    ), calls


def test_fresh_ballots_cached_streets_and_source_free_of_address():
    lookup, calls = service(
        ballot=source(
            candidate(), FullStreetName="PRIVATE SENTINEL", ProdAddressRangeId=123
        )
    )
    result, catalogue = lookup.lookup(ADDRESS, "8334")
    assert result["kind"] == "results"
    assert result["matchedAddress"] == ADDRESS
    assert result["coverage"][0]["kind"] == "coverage-unconfirmed"
    assert result["races"][0]["entries"][0]["candidate"]["name"] == "Example Candidate"
    assert result["races"][0]["seatCount"] == 2
    assert catalogue is not None
    document = json.dumps(candidate_ballot_document(catalogue))
    for private in (
        "PRIVATE SENTINEL",
        "ProdAddressRangeId",
        "PrecinctCode",
        "PrecinctName",
        "SYNTHETIC P-1",
        ADDRESS,
    ):
        assert private not in document
    lookup.lookup(ADDRESS, "8334")
    assert len([call for call in calls if call[0] == STREETS_URL]) == 1
    assert len([call for call in calls if call[0] == SOURCE_URL]) == 2


@pytest.mark.parametrize(
    "address",
    [
        "100 example street north, example city, MN 99999",
        "100 EXAMPLE ST N EXAMPLE CITY MN 99999",
        "100 EXAMPLE ST N, EXAMPLE CITY, Minnesota 99999",
        "100 EXAMPLE ST N MN 99999",
    ],
)
def test_equivalent_exact_official_addresses(address):
    lookup, _ = service()
    assert lookup.lookup(address, "8334")[0]["kind"] == "results"


@pytest.mark.parametrize(
    "address",
    [
        "101 EXAMPLE ST N, EXAMPLE CITY, MN 99999",  # parity
        "99 EXAMPLE ST N, EXAMPLE CITY, MN 99999",  # number range
        "100 EXAMPLE ST S, EXAMPLE CITY, MN 99999",  # different direction
        "100 EXAMPLE ST N, OTHER CITY, MN 99999",  # different postal city
        "100 EXAMPLE ST N UNIT A, EXAMPLE CITY, MN 99999",  # unresolved unit
        "100 EXAMPLE ST N'; DELETE *, EXAMPLE CITY, MN 99999",  # injection is text
    ],
)
def test_unmatched_address_never_calls_ballot(address):
    lookup, calls = service(
        rows=[street(DisplayUnitNbr=True, UnitNumberRange="UNIT B")]
        if "UNIT A" in address
        else None
    )
    result, parsed = lookup.lookup(address, "8334")
    assert result == {"kind": "no-match"}
    assert parsed is None
    assert all(url != SOURCE_URL for url, _ in calls)


def test_confirmed_choice_never_overrides_number_parity_or_range():
    lookup, calls = service()
    valid_choice = lookup.suggest(ADDRESS)[0]
    assert lookup.lookup(ADDRESS, "8334", valid_choice)[0]["kind"] == "results"
    calls.clear()
    assert lookup.lookup(ADDRESS.replace("100", "101"), "8334", valid_choice)[0] == {
        "kind": "no-match"
    }
    assert lookup.lookup(ADDRESS, "8334", {**valid_choice, "id": "123"})[0] == {
        "kind": "no-match"
    }
    assert all(url != SOURCE_URL for url, _ in calls)


def test_overlapping_source_ranges_fail_even_with_confirmed_choice():
    lookup, calls = service(rows=[street(), street(ProdAddressRangeId=124)])
    valid_lookup, _ = service()
    choice = valid_lookup.suggest(ADDRESS)[0]
    assert lookup.suggest(ADDRESS) == []
    assert lookup.lookup(ADDRESS, "8334", choice)[0] == {"kind": "no-match"}
    assert all(url != SOURCE_URL for url, _ in calls)


def test_ambiguous_postal_cities_require_choice_and_revalidation():
    lookup, calls = service(
        rows=[street(), street(CityName="OTHER CITY", ProdAddressRangeId=124)]
    )
    result, _ = lookup.lookup("100 EXAMPLE ST N MN 99999", "8334")
    assert result["kind"] == "ambiguous"
    assert len(result["choices"]) == 2
    result, parsed = lookup.lookup(
        "100 EXAMPLE ST N MN 99999", "8334", result["choices"][1]
    )
    assert result["kind"] == "results"
    assert parsed is not None
    assert calls[-1] == (SOURCE_URL, {"prodAddressRangeId": 124})


def test_empty_source_preserves_coverage_gap_and_does_not_claim_none_running():
    lookup, _ = service(ballot=source())
    result, parsed = lookup.lookup(ADDRESS, "8334")
    assert result["races"] == []
    assert result["coverage"]
    assert parsed is not None


@pytest.mark.parametrize(
    "payload",
    [
        source(candidate(), ElectionId="8333"),
        source(candidate(), ElectionDate="08/11/2026 00:00:00"),
        {},
        {"error": "PRIVATE SENTINEL"},
    ],
)
def test_wrong_election_or_source_failure_raises_safe_error(payload):
    lookup, _ = service(ballot=payload)
    with pytest.raises(CandidateLookupUnavailable) as caught:
        lookup.lookup(ADDRESS, "8334")
    assert "PRIVATE SENTINEL" not in str(caught.value)
    assert caught.value.__cause__ is None


def test_unknown_election_never_fetches_sources_and_known_elections_are_retained():
    lookup, calls = service()
    assert lookup.lookup(ADDRESS, "9999")[0] == {"kind": "no-elections"}
    lookup.now = lambda: datetime(2026, 11, 4, tzinfo=UTC)
    assert lookup.elections()  # Still election day in Minnesota.
    lookup.now = lambda: datetime(2026, 11, 4, 6, tzinfo=UTC)
    assert [item["id"] for item in lookup.elections()] == ["8334", "170"]
    assert lookup.lookup(ADDRESS, "170")[0]["kind"] == "historical-match-unavailable"
    assert calls == []


def test_street_cache_is_bounded_and_short_lived():
    tick = [0]
    lookup, calls = service(rows=[], clock=lambda: tick[0])
    for zip_code in [str(10000 + i) for i in range(40)]:
        lookup.streets(zip_code)
    assert len(lookup._streets) == 32
    lookup.streets("10039")
    assert len(calls) == 40
    tick[0] = 301
    lookup.streets("10039")
    assert len(calls) == 41


def test_official_fetch_allowlist_redirects_timeout_and_safe_error(monkeypatch):
    import requests

    with pytest.raises(CandidateLookupUnavailable):
        official_bytes("https://example.invalid/", {"ZipCode": "99999"})
    with pytest.raises(CandidateLookupUnavailable):
        official_bytes(STREETS_URL, {"ZipCode": "99999", "address": ADDRESS})
    calls = []

    def get(url, **kwargs):
        calls.append((url, kwargs))
        raise requests.Timeout("private range and street details")

    monkeypatch.setattr(
        candidate_lookup, "public_source_session", lambda: SimpleNamespace(get=get)
    )
    with pytest.raises(CandidateLookupUnavailable) as caught:
        official_bytes(STREETS_URL, {"ZipCode": "99999"})
    assert caught.value.__cause__ is None
    assert "private" not in str(caught.value)
    assert calls[0][1]["allow_redirects"] is False
    assert calls[0][1]["timeout"] == (3.05, 12)


def test_no_zip_uses_government_address_source_without_representative_data():
    class Geocoder:
        def geocode_matches(self, text):
            return [SimpleNamespace(matched_address=ADDRESS, state_code="MN")]

        def suggest_matches(self, text):
            return self.geocode_matches(text)

    lookup, _ = service(geocoder=Geocoder())
    assert lookup.suggest("100 EXAMPLE ST")[0]["address"] == ADDRESS
    choice = lookup.suggest("100 EXAMPLE ST")[0]
    assert lookup.lookup("100 EXAMPLE ST", "8334", choice)[0]["kind"] == "results"
    assert lookup.lookup("100 EXAMPLE ST", "8334", {**choice, "address": "malicious"})[
        0
    ] == {"kind": "no-match"}


def test_durable_public_profile_snapshot_late_response_and_staleness(seed_database):
    lookup, _ = service()
    _, catalogue = lookup.lookup(ADDRESS, "8334")
    assert catalogue is not None
    candidate_id = catalogue.races[0].candidates[0].stable_id
    with get_session_factory()() as db:
        persist_catalogue(db, catalogue)
        profile = load_profile(db, candidate_id, now=NOW)
        assert profile["candidate"]["name"] == "Example Candidate"
        assert "stale" not in profile["source"]
        assert (
            load_profile(db, candidate_id, now=NOW + timedelta(hours=25))["source"][
                "stale"
            ]
            is True
        )
        assert load_profile(db, "unknown") is None
        snapshots = db.scalars(
            select(CandidateSnapshot).where(CandidateSnapshot.election_id == "8334")
        ).all()
        assert any(item.source_sha256 == catalogue.source_sha256 for item in snapshots)
        assert ADDRESS not in json.dumps([item.public_payload for item in snapshots])
        lookup.now = lambda: NOW - timedelta(hours=1)
        _, earlier = lookup.lookup(ADDRESS, "8334")
        assert earlier is not None
        persist_catalogue(db, earlier)
        record = db.get(CandidateRecord, candidate_id)
        db.refresh(record)
        assert record.checked_at == NOW
        refreshed = db.scalars(
            select(CandidateSnapshot).where(CandidateSnapshot.election_id == "8334")
        ).all()
        assert len(refreshed) == len(snapshots)
        assert any(item.checked_at == NOW for item in refreshed)
        db.delete(record)
        for item in snapshots:
            db.delete(item)
        db.commit()


def test_api_private_headers_validation_errors_rate_limit_and_direct_profile(client):
    lookup, _ = service()
    client.app.dependency_overrides[get_candidate_lookup_service] = lambda: lookup
    response = client.post(
        "/api/v1/candidates/lookup", json={"address": ADDRESS, "electionId": "8334"}
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    candidate_id = response.json()["races"][0]["entries"][0]["candidate"]["id"]
    profile = client.get(f"/api/v1/candidates/{candidate_id}")
    assert profile.status_code == 200
    assert profile.json()["election"]["date"] == "2026-11-03"
    assert ADDRESS not in profile.text
    assert client.get("/api/v1/candidates/not-a-record").status_code == 404
    assert (
        client.post(
            "/api/v1/candidates/lookup",
            json={"address": ADDRESS + "\x00", "electionId": "8334"},
        ).status_code
        == 422
    )
    assert client.get("/api/v1/candidates/elections").json()[0]["id"] == "8334"
    suggestions = client.post("/api/v1/candidates/suggest", json={"address": ADDRESS})
    assert suggestions.status_code == 200
    assert suggestions.headers["cache-control"] == "private, no-store"
    assert suggestions.json()[0]["address"] == ADDRESS
    for _ in range(12):
        response = client.post(
            "/api/v1/candidates/lookup", json={"address": ADDRESS, "electionId": "8334"}
        )
        if response.status_code == 429:
            break
    assert response.status_code == 429
    assert response.headers["retry-after"]
    client.app.dependency_overrides.pop(get_candidate_lookup_service)


@pytest.mark.parametrize(
    "raw",
    [
        b'{"Streets":[],"error":"failed"}',
        b'{"Streets":[],"Streets":[]}',
        b'"{\\"Streets\\":[]}"',
        b"<html>challenge</html>",
    ],
)
def test_invalid_street_source_fails_instead_of_reporting_no_address(raw):
    lookup = CandidateLookupService(fetch=lambda *_: raw, now=lambda: NOW)
    with pytest.raises(CandidateLookupUnavailable):
        lookup.lookup(ADDRESS, "8334")


def test_official_fetch_requests_plain_json_object_and_rejects_redirect(monkeypatch):

    captured = []

    class Response:
        status_code = 302

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

    def get(*args, **kwargs):
        captured.append(kwargs)
        return Response()

    monkeypatch.setattr(
        candidate_lookup, "public_source_session", lambda: SimpleNamespace(get=get)
    )
    with pytest.raises(CandidateLookupUnavailable):
        official_bytes(STREETS_URL, {"ZipCode": "99999"})
    assert captured[0]["headers"]["Accept"] == "text/plain"
    assert captured[0]["allow_redirects"] is False


def test_source_failure_response_keeps_address_and_service_details_private(client):
    lookup = CandidateLookupService(
        fetch=lambda *_: b"<html>challenge</html>", now=lambda: NOW
    )
    client.app.dependency_overrides[get_candidate_lookup_service] = lambda: lookup
    response = client.post(
        "/api/v1/candidates/lookup", json={"address": ADDRESS, "electionId": "8334"}
    )
    assert response.status_code == 503
    assert response.headers["cache-control"] == "private, no-store"
    assert ADDRESS not in response.text
    assert "challenge" not in response.text
    client.app.dependency_overrides.pop(get_candidate_lookup_service)


def test_street_suffix_is_not_mistaken_for_outside_state_and_real_outside_state_stops():
    lookup, calls = service(rows=[street(FullStreetName="EXAMPLE ST")])
    assert lookup.lookup("100 EXAMPLE ST 99999", "8334")[0]["kind"] == "results"
    calls.clear()
    assert lookup.lookup("100 EXAMPLE ST, EXAMPLE CITY, TX 99999", "8334")[0] == {
        "kind": "outside-minnesota"
    }
    assert calls == []


def test_source_dates_and_judicial_groups_match_minnesota():
    lookup, _ = service(
        ballot=source(candidate(OfficeTitle="Associate Justice - Supreme Court 1"))
    )
    lookup.now = lambda: datetime(2026, 10, 1, 1, tzinfo=UTC)
    result, _ = lookup.lookup(ADDRESS, "8334")
    race = result["races"][0]
    assert race["source"]["checkedDate"] == "2026-09-30"
    assert race["group"] == "state"
    assert race["votingArea"] == "Minnesota"


@pytest.mark.parametrize(
    "original",
    [
        "100 EXAMPLE ST N, WRONG CITY, MN",
        "100 EXAMPL ST N, EXAMPLE CITY, MN",
        "100 EXAMPLE ST N, EXAMPLE CITY, MN",
    ],
)
def test_no_zip_geocoded_answer_requires_explicit_confirmation(original):
    class Geocoder:
        def geocode_matches(self, text):
            return [SimpleNamespace(matched_address=ADDRESS, state_code="MN")]

    lookup, calls = service(geocoder=Geocoder())
    response, catalogue = lookup.lookup(original, "8334")
    assert response["kind"] == "ambiguous"
    assert response["choices"][0]["address"] == ADDRESS
    assert catalogue is None
    assert calls == [(STREETS_URL, {"ZipCode": "99999"})]
    assert (
        lookup.lookup(original, "8334", response["choices"][0])[0]["kind"] == "results"
    )


@pytest.mark.parametrize(
    "unit", ["UNIT B", "APT 2", "APARTMENT 2", "SUITE 3", "STE 4", "#5"]
)
def test_no_zip_units_survive_suggestions_and_confirmation(unit):
    class Geocoder:
        def geocode_matches(self, text):
            return [SimpleNamespace(matched_address=ADDRESS, state_code="MN")]

        def suggest_matches(self, text):
            return self.geocode_matches(text)

    original = f"100 EXAMPLE ST N {unit}, EXAMPLE CITY, MN"
    lookup, calls = service(
        geocoder=Geocoder(), rows=[street(DisplayUnitNbr=True, UnitNumberRange=unit)]
    )
    suggestion = lookup.suggest(original)[0]
    assert f" {unit}," in suggestion["address"]
    response, _ = lookup.lookup(original, "8334")
    assert response["choices"] == [suggestion]
    result, _ = lookup.lookup(original, "8334", suggestion)
    assert result["kind"] == "results"
    assert f" {unit}," in result["matchedAddress"]
    # The browser submits a selected complete suggestion as the new address.
    assert (
        lookup.lookup(suggestion["address"], "8334", suggestion)[0]["kind"] == "results"
    )
    # An unmarked building range holds every unit at that house, as on MyBallot.
    lookup, calls = service(geocoder=Geocoder())
    assert lookup.lookup(original, "8334", suggestion)[0]["kind"] == "results"
    # A caller cannot confirm the geocoder's unitless answer for a unit request.
    unitless_lookup, _ = service()
    unitless_choice = unitless_lookup.suggest(ADDRESS)[0]
    assert lookup.lookup(original, "8334", unitless_choice)[0] == {"kind": "no-match"}


@pytest.mark.parametrize(
    "changes",
    [
        {"HouseNumberLow": "100"},
        {"HouseNumberHigh": 99},
        {"OddEvenInd": "unknown"},
        {"DisplayUnitNbr": "false"},
        {"UnitNumberRange": 123},
        {"ProdAddressRangeId": True},
        {"StateCode": None},
        {"ZipCode": None},
    ],
)
def test_invalid_street_fields_are_source_failure_not_no_match(changes):
    lookup, calls = service(rows=[street(**changes)])
    with pytest.raises(CandidateLookupUnavailable):
        lookup.lookup(ADDRESS, "8334")
    assert all(url != SOURCE_URL for url, _ in calls)
    assert not lookup._streets  # Do not cache broken source records.


def test_unresolved_official_unit_is_source_failure_not_wrong_address():
    # The source flags the range but its official unit list is empty.
    lookup, calls = service(
        rows=[street(DisplayUnitNbr=True, UnitNumberRange=None)],
        listings=[EXAMPLE_LISTING],
    )
    with pytest.raises(CandidateLookupUnavailable):
        lookup.lookup(ADDRESS.replace(",", " APT 3,", 1), "8334")
    assert all(url != SOURCE_URL for url, _ in calls)


def test_house_suffix_suggestion_keeps_an_address_that_can_be_submitted():
    lookup, _ = service(rows=[street(HouseNumberSuffix="A")])
    address = ADDRESS.replace("100 ", "100A ")
    choice = lookup.suggest(address)[0]
    assert choice["address"] == address
    assert lookup.lookup(address, "8334", choice)[0]["kind"] == "results"


def test_geocoded_long_street_words_confirm_against_official_abbreviations(client):
    original = "100 EXAMPLE AVE SE, EXAMPLE CITY, MN"
    expanded = "100 Example Avenue Southeast, Example City, MN 99999"

    class Geocoder:
        def geocode_matches(self, text):
            return [SimpleNamespace(matched_address=expanded, state_code="MN")]

    lookup, _ = service(
        rows=[street(FullStreetName="EXAMPLE AVE SE")], geocoder=Geocoder()
    )
    client.app.dependency_overrides[get_candidate_lookup_service] = lambda: lookup
    try:
        first = client.post(
            "/api/v1/candidates/lookup",
            json={"address": original, "electionId": "8334"},
        )
        assert first.status_code == 200
        assert first.json()["kind"] == "ambiguous"
        choice = first.json()["choices"][0]
        assert choice["address"] == expanded
        # Both original-address confirmation and submitting the complete chosen
        # address preserve all address components and reach the same ballot.
        for address in (original, expanded):
            response = client.post(
                "/api/v1/candidates/lookup",
                json={
                    "address": address,
                    "electionId": "8334",
                    "confirmedChoice": choice,
                },
            )
            assert response.status_code == 200
            assert response.json()["kind"] == "results"
            assert (
                response.json()["matchedAddress"]
                == "100 EXAMPLE AVE SE, EXAMPLE CITY, MN 99999"
            )
        for changed in (
            {**choice, "id": "123"},
            {**choice, "label": "A different place"},
        ):
            assert lookup.lookup(expanded, "8334", changed)[0] == {"kind": "no-match"}
        assert lookup.lookup(expanded.replace("100", "101"), "8334", choice)[0] == {
            "kind": "no-match"
        }
        assert lookup.lookup(
            expanded.replace("Southeast", "Northeast"), "8334", choice
        )[0] == {"kind": "no-match"}
    finally:
        client.app.dependency_overrides.pop(get_candidate_lookup_service)


@pytest.mark.parametrize(
    "ending",
    [
        ", United States",
        " USA",
        "; U.S.A.",
        ". United States of America,",
        ",,u.s.,",
        "\r\nUnited States.",
    ],
)
def test_saved_address_country_uses_same_exact_suggestions_and_lookup(ending):
    from alethical.api.services.representative_lookup import (
        RepresentativeLookupNotFound,
    )

    class NoFallback:
        def geocode_matches(self, text):
            raise RepresentativeLookupNotFound()

        def suggest_matches(self, text):
            return []

    address = "350 S 5th St, Minneapolis, MN 55415"
    lookup, calls = service(
        rows=[
            street(
                HouseNumberLow=350,
                HouseNumberHigh=350,
                FullStreetName="S 5TH ST",
                CityName="MINNEAPOLIS",
                ZipCode="55415",
            )
        ],
        geocoder=NoFallback(),
    )
    choice = lookup.suggest(address)[0]
    entered = address + ending
    assert lookup.suggest(entered) == [choice]
    assert lookup.lookup(entered, "8334")[0]["kind"] == "results"
    assert lookup.lookup(entered, "8334", choice)[0]["kind"] == "results"
    assert all("United States" not in str(params) for _, params in calls)


def test_candidate_request_accepts_multiline_autofill_and_keeps_raw_length_limit():
    from pydantic import ValidationError
    from alethical.api.routers.candidates import AddressRequest

    assert (
        AddressRequest(
            address="350 S 5th St,\r\nMinneapolis, MN\t55415, United States"
        ).address
        == "350 S 5th St, Minneapolis, MN 55415"
    )
    for address in [
        "350 S 5th St\x00 MN 55415",
        "350 S 5th St\x0b MN 55415",
        "350 S 5th St\x7f MN 55415",
        " " * 300 + "350 S 5th St MN 55415",
    ]:
        with pytest.raises(ValidationError):
            AddressRequest(address=address)


def test_country_cleanup_keeps_ambiguity_and_unit_validation():
    lookup, _ = service(
        rows=[street(), street(CityName="OTHER CITY", ProdAddressRangeId=124)]
    )
    entered = "100 EXAMPLE ST N MN 99999, United States"
    result, _ = lookup.lookup(entered, "8334")
    assert result["kind"] == "ambiguous"
    assert len(result["choices"]) == 2
    assert lookup.lookup(entered, "8334", result["choices"][1])[0]["kind"] == "results"
    unit_lookup, _ = service(
        rows=[street(DisplayUnitNbr=True, UnitNumberRange="UNIT B")]
    )
    assert unit_lookup.lookup(
        "100 EXAMPLE ST N UNIT A, EXAMPLE CITY, MN 99999, USA", "8334"
    )[0] == {"kind": "no-match"}
    assert (
        unit_lookup.lookup(
            "100 EXAMPLE ST N UNIT B, EXAMPLE CITY, MN 99999, USA", "8334"
        )[0]["kind"]
        == "results"
    )
    assert lookup.lookup("100 EXAMPLE ST N, EXAMPLE CITY, WI 99999, USA", "8334")[
        0
    ] == {"kind": "outside-minnesota"}


@pytest.mark.parametrize("complete_zip", [False, True])
def test_suggestions_omit_addresses_without_one_exact_ballot_range(complete_zip):
    """A mapped street or an individual range is not enough to offer a choice."""
    labels = [
        ADDRESS.replace("100 ", "99 "),
        ADDRESS.replace("100 ", "101 "),
        ADDRESS.replace("EXAMPLE ST N", "OTHER ST N"),
        ADDRESS,
    ]

    class Geocoder:
        def suggest_matches(self, text):
            return [SimpleNamespace(matched_address=a, state_code="MN") for a in labels]

    lookup, calls = service(geocoder=Geocoder())
    query = ADDRESS if complete_zip else "100 EX"
    choices = lookup.suggest(query)
    assert [choice["address"] for choice in choices] == [ADDRESS]
    for choice in choices:
        assert lookup.resolve(choice["address"], choice)[0].house_number == 100
    assert all(url != SOURCE_URL for url, _ in calls)

    # The same printed address belongs to 2 official ranges: never pick either.
    lookup, _ = service(
        rows=[street(), street(ProdAddressRangeId=124)], geocoder=Geocoder()
    )
    assert lookup.suggest(query) == []


def test_map_choices_validate_each_zip_once_and_keep_source_order():
    from threading import Barrier

    sync = Barrier(2, timeout=3)
    labels = [ADDRESS, ADDRESS.replace("99999", "99998"), ADDRESS]
    calls = []

    class Geocoder:
        def suggest_matches(self, text):
            return [SimpleNamespace(matched_address=a, state_code="MN") for a in labels]

    def fetch(url, params):
        assert url == STREETS_URL
        calls.append(params["ZipCode"])
        sync.wait()  # Both ZIP requests run together, not one after the other.
        return json.dumps({"Streets": [street(ZipCode=params["ZipCode"])]}).encode()

    lookup = CandidateLookupService(fetch=fetch, geocoder=Geocoder())
    assert [choice["address"] for choice in lookup.suggest("100 EX")] == labels[:2]
    assert sorted(calls) == ["99998", "99999"]
    assert [choice["address"] for choice in lookup.suggest("100 EXA")] == labels[:2]
    assert len(calls) == 2  # Only public ZIP tables are reused, not private queries.


def test_no_zip_confirmation_does_not_offer_known_unresolvable_map_choices():
    class Geocoder:
        def geocode_matches(self, text):
            return [
                SimpleNamespace(
                    matched_address=ADDRESS.replace("100", "99"), state_code="MN"
                ),
                SimpleNamespace(matched_address=ADDRESS, state_code="MN"),
            ]

    lookup, calls = service(geocoder=Geocoder())
    response = lookup.resolve("100 EXAMPLE ST N MN")
    assert response["kind"] == "ambiguous"
    assert [choice["address"] for choice in response["choices"]] == [ADDRESS]
    assert all(url != SOURCE_URL for url, _ in calls)


def test_suggestion_validation_source_failure_is_not_empty_success():
    class Geocoder:
        def suggest_matches(self, text):
            return [SimpleNamespace(matched_address=ADDRESS, state_code="MN")]

    lookup, _ = service(rows=[street(OddEvenInd="X")], geocoder=Geocoder())
    with pytest.raises(CandidateLookupUnavailable):
        lookup.suggest("100 EX")


def test_split_building_suggests_unit_addresses_only_and_reads_no_unit_list():
    class Geocoder:
        def suggest_matches(self, text):
            return [SimpleNamespace(matched_address=ADDRESS, state_code="MN")]

    lookup, calls = service(
        rows=[street(DisplayUnitNbr=True, UnitNumberRange=None)], geocoder=Geocoder()
    )
    # Without a unit the address cannot be searched there, so it is not offered.
    assert lookup.suggest("100 EX") == []
    assert [choice["address"] for choice in lookup.suggest("100 EX APT 3")] == [
        "100 EXAMPLE ST N APT 3, EXAMPLE CITY, MN 99999"
    ]
    assert {url for url, _ in calls} == {STREETS_URL}


def test_confirmed_map_choice_does_not_fetch_unselected_zip():
    class Geocoder:
        def geocode_matches(self, text):
            return [
                SimpleNamespace(matched_address=ADDRESS, state_code="MN"),
                SimpleNamespace(
                    matched_address=ADDRESS.replace("99999", "99998"), state_code="MN"
                ),
            ]

    calls = []

    def fetch(url, params):
        assert url == STREETS_URL
        calls.append(params["ZipCode"])
        if params["ZipCode"] == "99998":
            raise CandidateLookupUnavailable("Official street records unavailable")
        return json.dumps({"Streets": [street()]}).encode()

    valid_lookup, _ = service()
    choice = valid_lookup.suggest(ADDRESS)[0]
    lookup = CandidateLookupService(fetch=fetch, geocoder=Geocoder())
    result = lookup.resolve("100 EXAMPLE ST N MN", choice)
    assert not isinstance(result, dict)
    assert result[0].house_number == 100
    assert calls == ["99999"]


UNIT_ROWS = [
    street(DisplayUnitNbr=True, UnitNumberRange="APT 3", ProdAddressRangeId=301),
    street(DisplayUnitNbr=True, UnitNumberRange="#4", ProdAddressRangeId=302),
]


@pytest.mark.parametrize(
    "address",
    [
        "100 EXAMPLE ST N APT 3, EXAMPLE CITY, MN 99999",  # canonical join
        "100 Example St N, Apt 3, Example City, MN 99999",  # comma before the unit
        "100 EXAMPLE ST N EXAMPLE CITY APT 3 MN 99999",  # comma-free, after the city
        "100 EXAMPLE ST N, EXAMPLE CITY APT 3, MN 99999",  # autofill line then unit
        "100 EXAMPLE ST N APT 3 EXAMPLE CITY MN 99999",  # comma-free, canonical place
        "100 EXAMPLE ST N EXAMPLE CITY APT 3, MN 99999",  # unit before a lone comma
        "100 EXAMPLE ST N Apt. 3, EXAMPLE CITY, MN 99999",  # designator with a dot
        "100 EXAMPLE ST N, Apt. 3, EXAMPLE CITY, MN 99999",
    ],
)
def test_unit_joined_in_any_position_resolves_its_own_official_range(address):
    lookup, calls = service(rows=UNIT_ROWS)
    result, _ = lookup.lookup(address, "8334")
    assert result["kind"] == "results"
    assert result["matchedAddress"] == "100 EXAMPLE ST N APT 3, EXAMPLE CITY, MN 99999"
    assert calls[-1] == (SOURCE_URL, {"prodAddressRangeId": 301})


@pytest.mark.parametrize(
    "address",
    [
        # 2 different units are never reconciled into either one.
        "100 EXAMPLE ST N APT 3, #4, EXAMPLE CITY, MN 99999",
        "100 EXAMPLE ST N APT 3 #4, EXAMPLE CITY, MN 99999",
        "100 EXAMPLE ST N, APT 3, EXAMPLE CITY #4, MN 99999",
        # A unit the source does not list never falls back to the building.
        "100 EXAMPLE ST N APT 9, EXAMPLE CITY, MN 99999",
        "100 EXAMPLE ST N, EXAMPLE CITY APT 9, MN 99999",
    ],
)
def test_conflicting_or_unlisted_units_never_force_a_match(address):
    lookup, calls = service(rows=UNIT_ROWS)
    assert lookup.lookup(address, "8334")[0] == {"kind": "no-match"}
    assert all(url != SOURCE_URL for url, _ in calls)


def test_unit_at_an_unmarked_building_reads_its_single_official_range():
    lookup, calls = service()
    result, _ = lookup.lookup("100 EXAMPLE ST N, APT 3, EXAMPLE CITY, MN 99999", "8334")
    assert result["kind"] == "results"
    assert result["matchedAddress"] == "100 EXAMPLE ST N APT 3, EXAMPLE CITY, MN 99999"
    assert calls[-1] == (SOURCE_URL, {"prodAddressRangeId": 123})
    # No unit list is read for a house the source does not mark.
    assert {url for url, _ in calls} == {STREETS_URL, SOURCE_URL}


class NearbyAddresses:
    def __init__(self, nearby=None, error: Exception | None = None):
        self.nearby = nearby or []
        self.error = error
        self.calls = []

    def nearby_addresses(self, latitude, longitude, radius):
        self.calls.append((latitude, longitude, radius))
        if self.error:
            raise self.error
        return self.nearby


def test_location_suggests_only_a_building_its_reading_separates():
    point = (44.95, -93.10)
    clear = NearbyAddresses([(ADDRESS, 4.0), ("102 EXAMPLE ST N", 14.0)])
    lookup, calls = service(geocoder=clear)
    assert lookup.locate(*point, 6) == {"kind": "address", "address": ADDRESS}
    # Reach (6 + 30) plus the separation the rule must check (8).
    assert clear.calls == [(*point, 44)]
    # Neighbours closer together than the reading's own radius are not separable.
    assert lookup.locate(*point, 12) == {"kind": "imprecise"}
    # The minimum separation still applies to a very small reported radius.
    close = NearbyAddresses([(ADDRESS, 1.0), ("102 EXAMPLE ST N", 8.5)])
    assert service(geocoder=close)[0].locate(*point, 1) == {"kind": "imprecise"}
    alone = NearbyAddresses([(ADDRESS, 40.0)])
    assert service(geocoder=alone)[0].locate(*point, 60) == {
        "kind": "address",
        "address": ADDRESS,
    }
    assert service(geocoder=NearbyAddresses())[0].locate(*point, 10) == {
        "kind": "imprecise"
    }
    # A nearer point with no usable address is never skipped for a farther one.
    unlabelled = NearbyAddresses([(None, 2.0), (ADDRESS, 14.0)])
    assert service(geocoder=unlabelled)[0].locate(*point, 5) == {"kind": "imprecise"}
    # The nearest building must lie within reach of the reading itself.
    far = NearbyAddresses([(ADDRESS, 45.0)])
    assert service(geocoder=far)[0].locate(*point, 10) == {"kind": "imprecise"}
    # Suggesting reads only the public street table to print the official spelling.
    assert all(url == STREETS_URL for url, _ in calls)


def test_location_prints_the_election_sources_spelling_of_the_suggestion():
    rows = [street(FullStreetName="OAK RIDGE TER", CityName="ST PAUL")]
    label = "100 Oak Ridge Terrace, SAINT PAUL, MN 99999"
    lookup, _ = service(rows=rows, geocoder=NearbyAddresses([(label, 1.0)]))
    suggestion = lookup.locate(44.95, -93.10, 5)
    assert suggestion == {
        "kind": "address",
        "address": "100 OAK RIDGE TER, ST PAUL, MN 99999",
    }
    assert lookup.lookup(suggestion["address"], "8334")[0]["kind"] == "results"
    # The full street type matches the abbreviation in a typed address too.
    assert (
        lookup.lookup("100 Oak Ridge Terrace, St Paul, MN 99999", "8334")[0]["kind"]
        == "results"
    )
    # Without exactly 1 official street, the state's wording is kept unchanged.
    other, _ = service(geocoder=NearbyAddresses([(label, 1.0)]))
    assert other.locate(44.95, -93.10, 5)["address"] == label


def test_location_capped_answer_is_imprecise_not_unavailable():
    from alethical.api.services.representative_lookup import AddressPointsIncomplete

    capped = NearbyAddresses(error=AddressPointsIncomplete("capped"))
    assert service(geocoder=capped)[0].locate(44.95, -93.10, 50) == {
        "kind": "imprecise"
    }


def test_location_limits_outside_state_and_source_failure_are_distinct():
    nearby = NearbyAddresses([(ADDRESS, 1.0)])
    lookup, _ = service(geocoder=nearby)
    assert lookup.locate(44.95, -93.10, 100.5) == {"kind": "imprecise"}
    assert lookup.locate(41.88, -87.63, 5) == {"kind": "outside-minnesota"}
    assert lookup.locate(44.95, -86.0, 5) == {"kind": "outside-minnesota"}
    assert nearby.calls == []
    failing = NearbyAddresses(error=RuntimeError("44.95,-93.10 upstream text"))
    with pytest.raises(CandidateLookupUnavailable) as raised:
        service(geocoder=failing)[0].locate(44.95, -93.10, 5)
    assert "44.95" not in str(raised.value)
    assert raised.value.__cause__ is None and raised.value.__suppress_context__


def test_locate_api_is_private_validated_and_rate_limited(client):
    lookup, _ = service(geocoder=NearbyAddresses([(ADDRESS, 2.0)]))
    client.app.dependency_overrides[get_candidate_lookup_service] = lambda: lookup
    body = {"latitude": 44.95, "longitude": -93.1, "accuracy": 5}
    response = client.post("/api/v1/candidates/locate", json=body)
    assert response.status_code == 200
    assert response.json() == {"kind": "address", "address": ADDRESS}
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    for invalid in (
        {**body, "latitude": 91},
        {**body, "accuracy": -1},
        {**body, "extra": 1},
        {"latitude": 44.95, "longitude": -93.1},
    ):
        rejected = client.post("/api/v1/candidates/locate", json=invalid)
        assert rejected.status_code == 422
        assert "44.95" not in rejected.text
    # A point never travels in a page address; there is no GET form of this route.
    assert client.get("/api/v1/candidates/locate").status_code == 404
    for _ in range(12):
        response = client.post("/api/v1/candidates/locate", json=body)
        if response.status_code == 429:
            break
    assert response.status_code == 429
    client.app.dependency_overrides.pop(get_candidate_lookup_service)


def test_locate_api_source_failure_is_unavailable_without_the_point(client):
    lookup, _ = service(geocoder=NearbyAddresses(error=RuntimeError("44.9512")))
    client.app.dependency_overrides[get_candidate_lookup_service] = lambda: lookup
    response = client.post(
        "/api/v1/candidates/locate",
        json={"latitude": 44.9512, "longitude": -93.1, "accuracy": 5},
    )
    assert response.status_code == 503
    assert "44.9512" not in response.text
    assert response.headers["cache-control"] == "private, no-store"
    client.app.dependency_overrides.pop(get_candidate_lookup_service)


OFFICIAL_UNITS = json.loads(
    (
        __import__("pathlib").Path(__file__).parent
        / "fixtures"
        / "sos_unit_number_ranges_2026-10-09.json"
    ).read_text()
)
HOPKINS = next(s for s in OFFICIAL_UNITS["streets"] if s["street"] == "8TH AVE S")
HOPKINS_LISTING = {
    "ProdAddressRangeId": None,
    "FullStreetNameCityNameZipCodeId": HOPKINS["FullStreetNameCityNameZipCodeId"],
    "FullStreetName": "8TH AVE S ",
    "CityName": "HOPKINS",
    "ZipCode": "55343",
}


def hopkins(**changes):
    return service(
        rows=HOPKINS["GetStreets_rows"],
        listings=changes.pop("listings", [HOPKINS_LISTING]),
        units=changes.pop("units", HOPKINS["GetUnitNumberRanges"]),
        ballot=source(candidate(), ProdAddressRangeId=313578),
        **changes,
    )


@pytest.mark.parametrize(
    ("address", "range_id"),
    [
        ("100 8th Ave S #250, Hopkins, MN 55343", 313578),
        ("100 8th Ave S, Apt 101, Hopkins, MN 55343", 313576),
        ("100 8th Ave S Hopkins Unit 663 MN 55343", 313577),
        ("100 8th Avenue South Apt. 248, Hopkins, MN 55343", 313576),
    ],
)
def test_split_building_unit_reads_its_official_ballot_range(address, range_id):
    lookup, calls = hopkins()
    result = lookup.resolve(address)
    assert not isinstance(result, dict)
    assert result[1].range_id == range_id
    sent = [params for url, params in calls if url in (STREET_ID_URL, UNIT_RANGES_URL)]
    # Only the official street, city and ZIP leave Alethical: no house or unit.
    assert sent == [
        {"address": "8TH AVE S HOPKINS 55343"},
        {"FullStreetNameCityNameZipCodeId": HOPKINS["FullStreetNameCityNameZipCodeId"]},
    ]


def test_split_building_lookup_fetches_the_chosen_ballot_and_labels_the_unit():
    lookup, calls = hopkins()
    result, _ = lookup.lookup("100 8th Ave S #250, Hopkins, MN 55343", "8334")
    assert result["kind"] == "results"
    assert result["matchedAddress"] == "100 8TH AVE S #250, HOPKINS, MN 55343"
    assert calls[-1] == (SOURCE_URL, {"prodAddressRangeId": 313578})


@pytest.mark.parametrize(
    "address",
    [
        "100 8th Ave S, Hopkins, MN 55343",  # the source needs a unit here
        "100 8th Ave S #249, Hopkins, MN 55343",  # between official ranges
        "100 8th Ave S #664, Hopkins, MN 55343",  # past the last range
        "100 8th Ave S #250A, Hopkins, MN 55343",  # not provably in any range
        "100 8th Ave S Apt 101 #250, Hopkins, MN 55343",  # 2 different units
        "102 8th Ave S #250, Hopkins, MN 55343",  # another house
    ],
)
def test_split_building_refuses_what_its_official_ranges_do_not_prove(address):
    lookup, calls = hopkins()
    assert lookup.lookup(address, "8334")[0] == {"kind": "no-match"}
    assert all(url != SOURCE_URL for url, _ in calls)


@pytest.mark.parametrize(
    "changes",
    [
        {"listings": []},  # the street's listing number cannot be found
        # Same street and city in another ZIP is another listing.
        {"listings": [{**HOPKINS_LISTING, "ZipCode": "55305"}]},
        {
            "listings": [
                HOPKINS_LISTING,
                {**HOPKINS_LISTING, "FullStreetNameCityNameZipCodeId": 9},
            ]
        },
        {"listings": CandidateLookupUnavailable("down")},
        {"units": CandidateLookupUnavailable("down")},
        {"units": [{"ProdAddressRangeId": 313578, "UnitNumberRange": "250 - 250"}]},
    ],
)
def test_unit_list_source_failures_are_unavailable_not_no_match(changes):
    lookup, calls = hopkins(**changes)
    with pytest.raises(CandidateLookupUnavailable):
        lookup.lookup("100 8th Ave S #250, Hopkins, MN 55343", "8334")
    assert all(url != SOURCE_URL for url, _ in calls)


def test_location_suggestion_for_a_unit_building_needs_no_unit_list():
    label = "100 8th Avenue South, Hopkins, MN 55343"

    class Nearby:
        def nearby_addresses(self, latitude, longitude, radius):
            return [(label, 1.0)]

    lookup, calls = hopkins(geocoder=Nearby())
    assert lookup.locate(44.92, -93.41, 5) == {
        "kind": "address",
        "address": "100 8TH AVE S, HOPKINS, MN 55343",
    }
    assert {url for url, _ in calls} == {STREETS_URL}


def test_official_unit_list_fetch_reads_the_sources_not_found_answer(monkeypatch):
    responses = []

    class Response:
        def __init__(self, status, body):
            self.status_code = status
            self.raw = SimpleNamespace(read=lambda *args, **kwargs: body)
            self._body = body

        def iter_content(self, size):
            yield self._body

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def get(url, **kwargs):
        responses.append((url, kwargs["params"]))
        return queue.pop(0)

    monkeypatch.setattr(
        candidate_lookup, "public_source_session", lambda: SimpleNamespace(get=get)
    )
    broken = Response(404, b"")
    broken.raw = SimpleNamespace(
        read=lambda *args, **kwargs: (_ for _ in ()).throw(OSError("read failed"))
    )
    queue = [broken]
    with pytest.raises(CandidateLookupUnavailable):
        official_bytes(UNIT_RANGES_URL, {"FullStreetNameCityNameZipCodeId": 44163})
    queue = [Response(404, b'{"message":"Unit number data not found."}')]
    assert (
        official_bytes(UNIT_RANGES_URL, {"FullStreetNameCityNameZipCodeId": 44163})
        == b"[]"
    )
    for status, body in ((404, b'{"message":"other"}'), (500, b"[]")):
        queue = [Response(status, body)]
        with pytest.raises(CandidateLookupUnavailable):
            official_bytes(UNIT_RANGES_URL, {"FullStreetNameCityNameZipCodeId": 44163})
    # The listing request accepts only official table text: no unit mark, no
    # free typing. Its value is built from the table row, never from the reader.
    for address in ("8TH AVE S #250", "8th ave s", "", "8TH AVE S\nHOPKINS"):
        with pytest.raises(CandidateLookupUnavailable):
            official_bytes(STREET_ID_URL, {"address": address})
    queue = [Response(200, b"[]")]
    assert (
        official_bytes(STREET_ID_URL, {"address": "8TH AVE S HOPKINS 55343"}) == b"[]"
    )
