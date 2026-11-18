"""Minnesota's October 8, 2026 public address points, read from a packaged file.

The November candidate lookup used to ask the state's mapping service for every
building with a house number and ZIP, which took 0.8 to 1.8 seconds. This module
answers the same question from a compact copy of the state's published address
file, in about 5 milliseconds, and returns the same shape of data the service
returns so the caller keeps one matching path. Nothing a reader types is kept:
only the packaged public records are read, and nothing is cached by address.

File layout (little-endian): the 6-byte magic, a 4-byte JSON header length, the
JSON header, then one zlib block per ZIP code. The header lists each ZIP's block
offset, length and row count, plus the shared status words. A block holds a
string table and one column per field. Whole numbers that move gradually
(coordinates) are stored as differences from the previous row, with their bytes
regrouped by position so they compress well.
"""

from __future__ import annotations

from array import array
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from itertools import accumulate
import json
import os
from pathlib import Path
import re
import struct
import sys
import threading
import zlib

from pyproj import Transformer

PATH = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "candidate_address_points_20261008.bin"
)
MAGIC = b"ALAP1\n"
# The live service returns at most this many rows and sets exceededTransferLimit.
ROW_LIMIT = 2000
# The service stores native coordinates (NAD83 UTM zone 15, metres) to 0.1 mm.
UTM_UNITS = 10_000
# Attribute latitude and longitude are county-supplied; 1e-9 degree is 0.1 mm.
DEGREE_UNITS = 1_000_000_000
NULL_INT = -(2**63)
STRING_COLUMNS = (
    "anumberpre",
    "anumbersuf",
    "st_pre_mod",
    "st_pre_dir",
    "st_pre_typ",
    "st_pre_sep",
    "st_name",
    "st_pos_typ",
    "st_pos_dir",
    "st_pos_mod",
    "postcomm",
    "ctu_name",
    "state_code",
)
# Rows are ordered by these, so neighbouring rows are neighbouring buildings.
STREET_COLUMNS = STRING_COLUMNS[2:10]
FLAG_GEOMETRY, FLAG_LATITUDE, FLAG_LONGITUDE = 1, 2, 4
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)

# The service reprojects its native UTM zone 15 points to WGS 84 with Esri's
# NAD_1983_To_WGS_1984_5 transformation, a 7-parameter shift of about 1 metre
# that the default pyproj route (NAD83 treated as identical to WGS 84) lacks.
# Checked against 1,481 statewide service points: the largest difference is
# 1.2 centimetres, against 0.96 metres for the default route.
_UTM_TO_WGS84 = (
    "+proj=pipeline "
    "+step +inv +proj=utm +zone=15 +ellps=GRS80 "
    "+step +proj=unitconvert +xy_in=rad +xy_out=deg "
    "+step +proj=unitconvert +xy_in=deg +xy_out=rad "
    "+step +proj=cart +ellps=GRS80 "
    "+step +proj=helmert +x=-0.991 +y=1.9072 +z=0.5129 "
    "+rx=-0.0257899 +ry=-0.00965 +rz=-0.0116599 +s=0 "
    "+convention=coordinate_frame "
    "+step +inv +proj=cart +ellps=WGS84 "
    "+step +proj=unitconvert +xy_in=rad +xy_out=deg"
)


_THREAD = threading.local()


def _transformer() -> Transformer:
    # A projection object is not shared between request threads.
    if not hasattr(_THREAD, "transformer"):
        _THREAD.transformer = Transformer.from_pipeline(_UTM_TO_WGS84)
    return _THREAD.transformer


def wgs84_point(easting: float, northing: float) -> tuple[float, float]:
    """Return (longitude, latitude) for a native UTM zone 15 point, like the service."""
    lon, lat, _ = _transformer().transform(easting, northing, 0.0)
    return lon, lat


def epoch_ms(text: str | None) -> int | None:
    """A source timestamp (UTC, as the service reports it) in epoch milliseconds."""
    if text is None:
        return None
    moment = datetime.fromisoformat(text).replace(tzinfo=UTC)
    return (moment - _EPOCH) // timedelta(milliseconds=1)


def _little(values: array) -> array:
    if sys.byteorder == "big":
        values.byteswap()
    return values


def _planes(values: array) -> bytes:
    raw = _little(array(values.typecode, values)).tobytes()
    width = values.itemsize
    return b"".join(raw[k::width] for k in range(width))


def _unplane(blob: memoryview, typecode: str, count: int) -> array:
    width = array(typecode).itemsize
    raw = bytearray(count * width)
    for k in range(width):
        raw[k::width] = blob[k * count : (k + 1) * count]
    return _little(array(typecode, bytes(raw)))


def _deltas(values: list[int]) -> array:
    previous = 0
    out = []
    for value in values:
        out.append(value - previous)
        previous = value
    return array("q", out)


def _none_if_null(value: int) -> int | None:
    return None if value == NULL_INT else value


def encode_block(rows: list[dict], statuses: list[str | None]) -> bytes:
    """Pack the rows of 1 ZIP code. Each row holds the fields read by the lookup."""
    ordered = sorted(
        enumerate(rows),
        key=lambda item: (
            tuple(item[1].get(c) or "" for c in STREET_COLUMNS),
            item[1]["anumber"],
            item[0],
        ),
    )
    table: dict[str | None, int] = {None: 0}
    strings: list[str] = []

    def word(value: str | None) -> int:
        if value is None:
            return 0
        if value not in table:
            strings.append(value)
            table[value] = len(strings)
        return table[value]

    string_columns = {c: array("H") for c in STRING_COLUMNS}
    anumber, status, flags = array("i"), array("B"), array("B")
    eff, ret = [], []
    easting, northing, latitude, longitude = [], [], [], []
    status_index = {s: i for i, s in enumerate(statuses)}
    for _, row in ordered:
        for column, values in string_columns.items():
            values.append(word(row.get(column)))
        anumber.append(row["anumber"])
        status.append(status_index[row.get("status")])
        eff.append(NULL_INT if row.get("eff_date") is None else row["eff_date"])
        ret.append(NULL_INT if row.get("ret_date") is None else row["ret_date"])
        flag = 0
        # Missing values repeat the previous row's number so the difference is 0.
        for source, target, bit, units in (
            ("x", easting, FLAG_GEOMETRY, UTM_UNITS),
            ("latitude", latitude, FLAG_LATITUDE, DEGREE_UNITS),
            ("longitude", longitude, FLAG_LONGITUDE, DEGREE_UNITS),
        ):
            value = row.get(source)
            if value is None:
                target.append(target[-1] if target else 0)
            else:
                flag |= bit
                target.append(round(value * units))
        if row.get("y") is None:
            northing.append(northing[-1] if northing else 0)
        else:
            northing.append(round(row["y"] * UTM_UNITS))
        flags.append(flag)
    blob = json.dumps(strings, ensure_ascii=False, separators=(",", ":")).encode()
    parts = [struct.pack("<II", len(rows), len(blob)), blob]
    parts += [_planes(string_columns[c]) for c in STRING_COLUMNS]
    parts += [bytes(status), bytes(flags), _planes(anumber)]
    for column in (eff, ret):
        parts.append(_planes(array("q", column)))
    for column in (easting, northing, latitude, longitude):
        parts.append(_planes(_deltas(column)))
    return zlib.compress(b"".join(parts), 9)


def pack_file(by_zip: dict[str, list[dict]]) -> bytes:
    """The whole packaged file for rows grouped by ZIP code."""
    statuses = sorted(
        {row.get("status") for rows in by_zip.values() for row in rows},
        key=lambda value: (value is not None, value or ""),
    )
    blocks, directory, offset = [], {}, 0
    for zip_code in sorted(by_zip):
        block = encode_block(by_zip[zip_code], statuses)
        directory[zip_code] = [offset, len(block), len(by_zip[zip_code])]
        blocks.append(block)
        offset += len(block)
    header = json.dumps(
        {
            "rows": sum(len(rows) for rows in by_zip.values()),
            "statuses": statuses,
            "zips": directory,
        },
        separators=(",", ":"),
    ).encode()
    return b"".join([MAGIC, struct.pack("<I", len(header)), header, *blocks])


def decode_block(block: bytes, statuses: list[str | None]) -> dict:
    """Return the block's columns, ready for searching by house number."""
    data = memoryview(zlib.decompress(block))
    count, length = struct.unpack_from("<II", data)
    position = 8
    strings = [None, *json.loads(bytes(data[position : position + length]))]
    position += length

    def take(typecode: str) -> array:
        nonlocal position
        width = array(typecode).itemsize * count
        values = _unplane(data[position : position + width], typecode, count)
        position += width
        return values

    columns: dict = {c: take("H") for c in STRING_COLUMNS}
    columns["status"] = bytes(data[position : position + count])
    position += count
    columns["flags"] = bytes(data[position : position + count])
    position += count
    columns["anumber"] = take("i")
    columns["eff_date"] = take("q")
    columns["ret_date"] = take("q")
    for name in ("x", "y", "latitude", "longitude"):
        columns[name] = array("q", accumulate(take("q")))
    if position != len(data):
        raise ValueError("Address point block has unexpected length")
    columns["strings"] = strings
    columns["statuses"] = statuses
    columns["count"] = count
    return columns


def block_features(columns: dict, zip_code: str, house_number: int) -> list[dict]:
    """Every row with this house number, shaped like the service's features."""
    strings, statuses = columns["strings"], columns["statuses"]
    features = []
    anumbers = columns["anumber"]
    for i in (i for i, value in enumerate(anumbers) if value == house_number):
        attributes = {c: strings[columns[c][i]] for c in STRING_COLUMNS}
        attributes["anumber"] = house_number
        attributes["zip"] = zip_code
        attributes["status"] = statuses[columns["status"][i]]
        flag = columns["flags"][i]
        attributes["latitude"] = (
            columns["latitude"][i] / DEGREE_UNITS if flag & FLAG_LATITUDE else None
        )
        attributes["longitude"] = (
            columns["longitude"][i] / DEGREE_UNITS if flag & FLAG_LONGITUDE else None
        )
        attributes["eff_date"] = _none_if_null(columns["eff_date"][i])
        attributes["ret_date"] = _none_if_null(columns["ret_date"][i])
        feature = {"attributes": attributes}
        if flag & FLAG_GEOMETRY:
            lon, lat = wgs84_point(
                columns["x"][i] / UTM_UNITS, columns["y"][i] / UTM_UNITS
            )
            feature["geometry"] = {"x": lon, "y": lat}
        features.append(feature)
    return features


@lru_cache(maxsize=1)
def _directory() -> tuple[dict, int]:
    """The packaged file's list of ZIP blocks; static public data, not per reader."""
    with PATH.open("rb") as archive:
        head = archive.read(len(MAGIC) + 4)
        if head[: len(MAGIC)] != MAGIC:
            raise ValueError("Unrecognized address point file")
        (length,) = struct.unpack("<I", head[len(MAGIC) :])
        header = json.loads(archive.read(length))
    base = len(MAGIC) + 4 + length
    if not isinstance(header.get("zips"), dict) or not isinstance(
        header.get("statuses"), list
    ):
        raise ValueError("Invalid address point file header")
    return header, base


def historical_point_payload(zip_code: str, house_number: int) -> dict:
    """Same data as the state's address service for this ZIP and house number.

    Raises OSError or ValueError when the packaged file cannot be used, so the
    caller can ask the official service instead.
    """
    if type(house_number) is not int or not re.fullmatch(r"[0-9]{5}", zip_code):
        raise ValueError("Invalid address point request")
    try:
        header, base = _directory()
        entry = header["zips"].get(zip_code)
        features: list[dict] = []
        if entry is not None:
            offset, length, _rows = entry
            fd = os.open(PATH, os.O_RDONLY)
            try:
                block = os.pread(fd, length, base + offset)
            finally:
                os.close(fd)
            if len(block) != length:
                raise ValueError("Address point file is incomplete")
            columns = decode_block(block, header["statuses"])
            features = block_features(columns, zip_code, house_number)
    except (zlib.error, struct.error, KeyError, IndexError, TypeError) as error:
        raise ValueError("Address point file is damaged") from error
    payload: dict = {"spatialReference": {"wkid": 4326, "latestWkid": 4326}}
    if len(features) > ROW_LIMIT:
        features = features[:ROW_LIMIT]
        payload["exceededTransferLimit"] = True
    payload["features"] = features
    return payload
