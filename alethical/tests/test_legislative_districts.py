import pytest

from alethical.api.services.legislative_districts import (
    LegislativeDistrictDataError,
    _legislative_district_geometries,
    legislative_districts_for_point,
)


def test_local_legislative_map_has_every_current_house_and_senate_district():
    districts = _legislative_district_geometries()

    assert {district.district_code for district in districts["house"]} == {
        f"{number}{suffix}" for number in range(1, 68) for suffix in ("A", "B")
    }
    assert {district.district_code for district in districts["senate"]} == {
        str(number) for number in range(1, 68)
    }


def test_local_legislative_map_finds_both_districts_without_a_network_call():
    house, senate = legislative_districts_for_point(
        longitude=-93.1022,
        latitude=44.9551,
    )

    assert house and house.district_code == "65B"
    assert senate and senate.district_code == "65"
    assert house.geometry["type"] in {"Polygon", "MultiPolygon"}
    assert senate.geometry["type"] in {"Polygon", "MultiPolygon"}


def test_local_legislative_map_returns_no_match_outside_minnesota():
    assert legislative_districts_for_point(longitude=0, latitude=0) == (None, None)


def test_local_legislative_map_rejects_an_incomplete_copy(monkeypatch, tmp_path):
    incomplete = tmp_path / "legislative-districts.geojson.gz"
    incomplete.write_bytes(b"not a valid compressed district map")
    monkeypatch.setattr(
        "alethical.api.services.legislative_districts.LEGISLATIVE_DISTRICTS_PATH",
        incomplete,
    )
    _legislative_district_geometries.cache_clear()

    with pytest.raises(LegislativeDistrictDataError, match="could not be loaded"):
        _legislative_district_geometries()

    _legislative_district_geometries.cache_clear()
