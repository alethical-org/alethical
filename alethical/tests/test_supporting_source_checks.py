"""Release checks never turn source drift into unreviewed public records."""

from __future__ import annotations

from datetime import date
import hashlib
import io
import json
import zipfile

import pytest

from alethical.pipeline import supporting_source_checks as checks


@pytest.fixture(autouse=True)
def skip_waits(monkeypatch):
    monkeypatch.setattr(checks.time, "sleep", lambda _: None)


def district_zip(chamber, *, missing=False):
    codes = (
        [str(n) for n in range(1, 68)]
        if chamber == "senate"
        else [f"{n}{letter}" for n in range(1, 68) for letter in "AB"]
    )
    if missing:
        codes.pop()
    payload = {
        "type": "FeatureCollection",
        "crs": {"properties": {"name": "EPSG:26915"}},
        "features": [
            {
                "properties": {"DISTRICT": code},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[1, 2], [2, 3], [3, 2], [1, 2]]],
                },
            }
            for code in codes
        ],
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("districts.json", json.dumps(payload))
    return output.getvalue()


def index():
    return b"""<option value="https://gis.lcc.mn.gov/data/geojson/L2012_0hse.zip">old</option>
    <option value="https://gis.lcc.mn.gov/data/geojson/L2023_0hse.zip">house</option>
    <option value="https://gis.lcc.mn.gov/data/geojson/L2023_0sen.zip">senate</option>"""


def test_maps_compare_both_downloads_and_stage_changed_bytes():
    bodies = {"house": district_zip("house"), "senate": district_zip("senate")}

    def fetch(url):
        return (
            index()
            if url == checks.MAP_INDEX
            else bodies["house" if "hse" in url else "senate"]
        )

    approved = {key: hashlib.sha256(body).hexdigest() for key, body in bodies.items()}
    assert [r.status for r in checks.check_maps(approved, fetch)] == [
        "unchanged",
        "unchanged",
    ]
    approved["house"] = "old-reviewed-hash"
    results = checks.check_maps(approved, fetch)
    assert results[0].status == "review_required"
    assert results[0].evidence["districts"] == 134
    assert results[1].evidence["districts"] == 67


def test_missing_map_district_is_failure_not_new_release():
    def fetch(url):
        return (
            index()
            if url == checks.MAP_INDEX
            else district_zip("house" if "hse" in url else "senate", missing=True)
        )

    results = checks.check_maps({"house": "old", "senate": "old"}, fetch)
    assert all(r.status == "unavailable" for r in results)


def test_changed_index_cannot_silently_check_nothing():
    results = checks.check_maps({}, lambda _: b"<html>Loading...</html>")
    assert len(results) == 1 and results[0].status == "unavailable"


def test_ballot_check_uses_no_address_and_warns_before_election_ends():
    seen = []

    def fetch(url):
        seen.append(url)
        if url == checks.BALLOT_HOME:
            return b'<script src="main-ABC123.js"></script>'
        return b"/api/Streets/GetStreets /api/PollingPlaceData/GetPollingPlaceData prodAddressRangeId ElectionId"

    election = {"id": "8334", "date": "2026-11-03"}
    result = checks.check_ballot_contract(election, date(2026, 10, 7), fetch)
    assert result.status == "review_required"
    assert result.evidence["days_until_election"] == 27
    assert all("?" not in url for url in seen)
    assert (
        checks.check_ballot_contract(election, date(2026, 11, 4), fetch).status
        == "review_required"
    )
    assert (
        checks.check_ballot_contract(election, date(2026, 8, 1), fetch).status
        == "unchanged"
    )


def test_ballot_html_shell_is_not_proof_of_working_contract():
    result = checks.check_ballot_contract(
        {"date": "2026-11-03"}, date(2026, 10, 7), lambda _: b"<html>Loading</html>"
    )
    assert result.status == "unavailable"


def test_zip_review_waits_for_huds_published_target_month_and_crosses_year():
    result = checks.check_zip_reference(date(2026, 6, 30), date(2026, 10, 7))
    assert result.status == "not_due"
    assert result.evidence["review_on"] == "2026-10-31"
    result = checks.check_zip_reference(date(2026, 9, 30), date(2027, 1, 31))
    assert result.status == "review_required"
    assert result.evidence["next_quarter_end"] == "2026-12-31"
    assert "availability has not been established" in result.detail


def test_zip_reference_does_not_accept_a_copy_date_as_coverage():
    with pytest.raises(ValueError, match="quarter-end"):
        checks.check_zip_reference(date(2026, 9, 13), date(2026, 10, 7))


def test_source_check_never_follows_an_unapproved_host(monkeypatch):
    monkeypatch.setattr(
        checks.requests,
        "get",
        lambda *args, **kwargs: pytest.fail("unexpected network call"),
    )
    for url in (
        "http://gis.lcc.mn.gov/file",
        "https://evil.example/map.zip",
        "https://user:secret@gis.lcc.mn.gov/file",
    ):
        with pytest.raises(checks.SourceUnavailable):
            checks.fetch_public(url)


def test_map_rejects_duplicate_district_even_when_row_count_matches():
    body = district_zip("senate")
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        payload = json.loads(archive.read("districts.json"))
    payload["features"][-1]["properties"]["DISTRICT"] = "1"
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("districts.json", json.dumps(payload))
    with pytest.raises(checks.SourceUnavailable, match="missing districts or repeats"):
        checks.map_payload(output.getvalue(), "senate")
