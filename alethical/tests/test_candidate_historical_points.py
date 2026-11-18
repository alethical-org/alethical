"""The packaged October 8 address points answer like the state's mapping service."""

import hashlib
import json
import struct

from pyproj import Transformer
import pytest

from alethical.api.services import candidate_historical_points as points
from alethical.api.services import candidate_lookup
from alethical.pipeline.candidate_ballot import StreetAddress

# Native UTM zone 15 metres and the WGS 84 longitude and latitude the state's
# service returned for the same points on 2026-11-18 (no addresses involved).
SERVICE_POINTS = [
    ((252897.3085, 5034734.9805), (-96.1585388911681, 45.42245848339018)),
    ((610187.4767, 4878150.6714), (-91.62454443881371, 44.04825022870503)),
    ((487484.0379, 4960807.8763), (-93.15826083437442, 44.80056945259713)),
    ((468336.7176, 5002786.046), (-93.4029967768963, 45.177853278831776)),
]


def row(**overrides):
    return {
        "anumberpre": None,
        "anumber": 500,
        "anumbersuf": None,
        "st_pre_mod": None,
        "st_pre_dir": None,
        "st_pre_typ": None,
        "st_pre_sep": None,
        "st_name": "13th",
        "st_pos_typ": "Ave",
        "st_pos_dir": "S",
        "st_pos_mod": None,
        "postcomm": "South Saint Paul",
        "ctu_name": "South St. Paul",
        "state_code": "MN",
        "status": "Active",
        "eff_date": None,
        "ret_date": None,
        "latitude": 44.881,
        "longitude": -93.05,
        "x": 487484.0379,
        "y": 4960807.8763,
        **overrides,
    }


@pytest.fixture
def packaged(tmp_path, monkeypatch):
    def pack(by_zip):
        path = tmp_path / "points.bin"
        path.write_bytes(points.pack_file(by_zip))
        monkeypatch.setattr(points, "PATH", path)
        points._directory.cache_clear()
        return path

    yield pack
    points._directory.cache_clear()


def test_every_field_survives_packing(packaged):
    rows = [
        row(),
        row(
            anumber=502,
            anumbersuf="1/2",
            status=None,
            postcomm=None,
            eff_date=1_704_067_200_000,
            ret_date=-2_208_988_800_000,
        ),
        row(anumber=502, status=" ", latitude=None, st_pre_dir="N"),
        row(anumber=502, longitude=None, x=None, y=None, st_name="Éclair"),
        row(anumber=502, anumberpre="", status="Retired", ret_date=1_794_096_000_000),
    ]
    packaged({"55075": rows})
    found = points.historical_point_payload("55075", 502)["features"]
    expected = [r for r in rows if r["anumber"] == 502]
    assert len(found) == len(expected)
    for want in expected:
        attributes = next(
            f["attributes"]
            for f in found
            if f["attributes"]["status"] == want["status"]
            and f["attributes"]["st_pre_dir"] == want["st_pre_dir"]
            and f["attributes"]["st_name"] == want["st_name"]
            and f["attributes"]["anumberpre"] == want["anumberpre"]
        )
        for key in (
            "anumbersuf",
            "postcomm",
            "ctu_name",
            "state_code",
            "latitude",
            "longitude",
            "eff_date",
            "ret_date",
            "st_pos_typ",
        ):
            assert attributes[key] == want[key], key
        assert attributes["zip"] == "55075" and attributes["anumber"] == 502


def test_two_coordinate_forms_are_kept_and_missing_ones_stay_missing(packaged):
    packaged({"55075": [row(), row(anumber=7, x=None, y=None)]})
    kept = points.historical_point_payload("55075", 500)
    assert kept["spatialReference"] == {"wkid": 4326, "latestWkid": 4326}
    feature = kept["features"][0]
    assert feature["attributes"]["latitude"] == 44.881
    assert feature["attributes"]["longitude"] == -93.05
    assert set(feature["geometry"]) == {"x", "y"}
    # The map point and the county's own fields are separate, unequal readings.
    assert feature["geometry"]["y"] != feature["attributes"]["latitude"]
    assert "geometry" not in points.historical_point_payload("55075", 7)["features"][0]


@pytest.mark.parametrize("native, service", SERVICE_POINTS)
def test_map_points_match_the_state_service_within_2_centimetres(native, service):
    lon, lat = points.wgs84_point(*native)
    assert abs(lon - service[0]) * 111_320 * 0.7 < 0.02
    assert abs(lat - service[1]) * 111_320 < 0.02
    # The default projection route is about 1 metre away and must not be used.
    default = Transformer.from_crs(26915, 4326, always_xy=True).transform(*native)
    assert abs(default[1] - service[1]) * 111_320 > 0.5


def test_over_2000_matches_flag_the_cut_off_list(packaged, monkeypatch):
    packaged({"55075": [row(latitude=44.0 + i / 1e6) for i in range(2001)]})
    payload = points.historical_point_payload("55075", 500)
    assert payload["exceededTransferLimit"] is True and len(payload["features"]) == 2000
    assert (
        candidate_lookup.historical_address_points(
            StreetAddress("13TH AVE S", "SOUTH ST PAUL", "MN", "55075", 500)
        )
        is None
    )


def test_unknown_zip_and_number_are_empty_not_errors(packaged):
    packaged({"55075": [row()]})
    assert points.historical_point_payload("55075", 501)["features"] == []
    assert points.historical_point_payload("99999", 500)["features"] == []


@pytest.mark.parametrize(
    "zip_code, number",
    [("5507", 500), ("550756", 500), ("55075", "500"), ("55075", True), ("5507a", 1)],
)
def test_only_a_5_digit_zip_and_whole_number_are_read(zip_code, number):
    with pytest.raises(ValueError):
        points.historical_point_payload(zip_code, number)


def test_damaged_or_missing_file_asks_the_official_service(packaged, monkeypatch):
    path = packaged({"55075": [row()]})
    data = bytearray(path.read_bytes())
    data[-8:] = b"\0" * 8
    path.write_bytes(bytes(data))
    points._directory.cache_clear()
    with pytest.raises(ValueError):
        points.historical_point_payload("55075", 500)
    path.unlink()
    points._directory.cache_clear()
    with pytest.raises(OSError):
        points.historical_point_payload("55075", 500)

    asked = []

    class Response:
        status_code = 200

        def json(self):
            return {"features": [{"attributes": {**row(), "zip": "55075"}}]}

    def post(url, **kwargs):
        asked.append(kwargs["data"]["where"])
        return Response()

    monkeypatch.setattr(candidate_lookup.public_source_session(), "post", post)
    found = candidate_lookup.historical_address_points(
        StreetAddress("13TH AVE S", "SOUTH ST PAUL", "MN", "55075", 500)
    )
    assert found == {(44.881, -93.05)}
    assert asked == ["anumber = 500 AND zip = '55075'"]


def test_a_truncated_header_is_refused(packaged):
    path = packaged({"55075": [row()]})
    path.write_bytes(points.MAGIC + struct.pack("<I", 9999))
    points._directory.cache_clear()
    with pytest.raises((ValueError, OSError)):
        points.historical_point_payload("55075", 500)


def test_only_the_file_directory_is_kept_between_readers(packaged):
    packaged({"55075": [row()]})
    points.historical_point_payload("55075", 500)
    points.historical_point_payload("55075", 501)
    assert points._directory.cache_info().currsize == 1
    assert not hasattr(points.historical_point_payload, "cache_info")


def test_the_packaged_file_is_the_pinned_october_8_edition():
    digest = hashlib.sha256(points.PATH.read_bytes()).hexdigest()
    header, _ = points._directory()
    assert digest == (
        "dbcc2ae61f2ad48b0453d43dcd9e70ad7f5b11381351457a29dc6e51489e6c6d"
    )
    assert header["rows"] == 2_219_991
    assert len(header["zips"]) == 767
    assert sum(entry[2] for entry in header["zips"].values()) == header["rows"]


def test_a_public_building_is_found_in_the_packaged_file():
    # South St. Paul City Hall: a public building the state's address file names.
    found = points.historical_point_payload("55075", 125)["features"]
    hall = [
        f["attributes"]
        for f in found
        if f["attributes"]["st_name"] == "3rd"
        and f["attributes"]["postcomm"] == "SOUTH SAINT PAUL"
    ]
    assert hall and hall[0]["state_code"] == "MN"
    for f in found:
        assert 44.8 < f["geometry"]["y"] < 45.0 and -93.1 < f["geometry"]["x"] < -92.9


def test_a_county_missing_from_the_state_file_has_no_building_points():
    # Redwood County has not contributed to the state's address file, so the
    # lookup finds no building and the voting area comes from street ranges.
    assert points.historical_point_payload("56293", 1428)["features"] == []
    assert (
        candidate_lookup.historical_address_points(
            StreetAddress("FRONT ST", "WABASSO", "MN", "56293", 1428)
        )
        == set()
    )


def test_header_is_plain_json_listing_each_zip_block():
    raw = points.PATH.read_bytes()
    assert raw.startswith(points.MAGIC)
    (length,) = struct.unpack("<I", raw[len(points.MAGIC) : len(points.MAGIC) + 4])
    header = json.loads(raw[len(points.MAGIC) + 4 : len(points.MAGIC) + 4 + length])
    assert set(header) == {"rows", "statuses", "zips"}
