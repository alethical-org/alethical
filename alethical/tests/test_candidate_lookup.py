"""Source acquisition, privacy, exact address matching and durable profile behavior."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from alethical.api.services.candidate_lookup import (
    SOURCE_URL,
    STREETS_URL,
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


def service(*, rows=None, ballot=None, clock=lambda: 0, geocoder=None):
    calls = []

    def fetch(url, params):
        calls.append((url, params))
        if url == STREETS_URL:
            return json.dumps(
                {"Streets": [street()] if rows is None else rows}
            ).encode()
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


def test_unknown_or_expired_election_never_fetches_sources():
    lookup, calls = service()
    assert lookup.lookup(ADDRESS, "9999")[0] == {"kind": "no-elections"}
    lookup.now = lambda: datetime(2026, 11, 4, tzinfo=UTC)
    assert lookup.elections()  # Still election day in Minnesota.
    lookup.now = lambda: datetime(2026, 11, 4, 6, tzinfo=UTC)
    assert lookup.elections() == []
    assert lookup.lookup(ADDRESS, "8334")[0] == {"kind": "no-elections"}
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

    monkeypatch.setattr(requests, "get", get)
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
    import requests

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

    monkeypatch.setattr(requests, "get", get)
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
    # A general building range cannot stand in for an unresolved unit.
    lookup, calls = service(geocoder=Geocoder())
    assert lookup.lookup(original, "8334", suggestion)[0] == {"kind": "no-match"}
    assert all(url != SOURCE_URL for url, _ in calls)
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
    lookup, calls = service(rows=[street(DisplayUnitNbr=True, UnitNumberRange=None)])
    with pytest.raises(CandidateLookupUnavailable):
        lookup.lookup(ADDRESS, "8334")
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

    lookup, _ = service(
        rows=[street(DisplayUnitNbr=True, UnitNumberRange=None)], geocoder=Geocoder()
    )
    with pytest.raises(CandidateLookupUnavailable):
        lookup.suggest("100 EX")
