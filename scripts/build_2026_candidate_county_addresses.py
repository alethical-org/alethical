"""Build the exact-address supplement for the November 3, 2026 candidate lookup.

Run from the repository root with uv run python -m scripts.build_2026_candidate_county_addresses.
The county source is pinned: a revised layer needs separate historical evidence.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass, replace
import csv
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import re
from zipfile import ZipFile

import requests
from pyproj import Transformer
import shapefile
from shapely.geometry import Point, shape
from shapely.ops import transform

from alethical.api.services.candidate_historical_county_addresses import (
    INDEX,
    address_key,
)
from alethical.api.services.candidate_lookup import _DIRECTIONS, _city_words, _normal
from alethical.pipeline.candidate_ballot import StreetAddress

SIBLEY = "https://services1.arcgis.com/ca9pZxSKQMiPIqAL/arcgis/rest/services/Address_Points_DDL/FeatureServer/0"
EDITION = 1789662108272
STREET_FIELDS = (
    "ST_PRE_DIR",
    "ST_PRE_TYP",
    "ST_NAME",
    "ST_POS_TYP",
    "ST_POS_DIR",
    "ST_POS_MOD",
)
FIELDS = (
    "FID",
    "ADDRESS",
    "ANUMBERPRE",
    "ANUMBER",
    "ANUMBERSUF",
    *STREET_FIELDS,
    "STATE_CODE",
    "ZIP",
    "MSAG_C",
)


def get(url, **params):
    response = requests.get(url, params={"f": "json", **params}, timeout=(5, 40))
    response.raise_for_status()
    result = response.json()
    if "error" in result:
        raise ValueError("County address source returned an error")
    return result


def check_edition():
    layer = get(SIBLEY)
    if layer.get("editingInfo", {}).get("dataLastEditDate") != EDITION:
        raise ValueError("Sibley address-point edition changed")
    if layer.get("serviceItemId") != "83bff03683ca46359043534b14ebb10b":
        raise ValueError("Unexpected Sibley address source")


def download_sibley():
    check_edition()
    count = get(SIBLEY + "/query", where="1=1", returnCountOnly="true")["count"]
    if count != 7270:
        raise ValueError("Sibley source count changed")
    rows = []
    for start in range(0, count, 2000):
        result = get(
            SIBLEY + "/query",
            where="1=1",
            outFields=",".join(FIELDS),
            orderByFields="FID",
            resultOffset=start,
            resultRecordCount=2000,
            outSR=4326,
            returnGeometry="true",
        )
        if result.get("spatialReference", {}).get("wkid") != 4326:
            raise ValueError("Unexpected county coordinate system")
        rows.extend(result["features"])
    check_edition()
    if len(rows) != count or len({r["attributes"]["FID"] for r in rows}) != count:
        raise ValueError("Incomplete county address source")
    return rows


def sibley_record(row):
    a = {
        key: str(value).strip() if value is not None else ""
        for key, value in row["attributes"].items()
    }
    # Sibley supplies no separate apartment field. Do not accept a building
    # record whose complete address introduces another qualifier or street.
    street = " ".join(a[key] for key in STREET_FIELDS if a[key])
    number, suffix = a["ANUMBER"], a["ANUMBERSUF"].upper()
    if (
        a["STATE_CODE"] != "MN"
        or not a["MSAG_C"]
        or not a["ST_NAME"]
        or not re.fullmatch(r"\d{5}", a["ZIP"])
        or a["ANUMBERPRE"]
        or not re.fullmatch(r"[1-9]\d*", number)
        or not re.fullmatch(r"(?:[A-Z]|1/2)?", suffix)
    ):
        return None
    names = {
        _normal(" ".join(v for v in (number, suffix, street) if v)),
        _normal(f"{number}{suffix} {street}"),
    }
    names |= {f"{name} {_normal(a['MSAG_C'])}" for name in names}
    if _normal(a["ADDRESS"]) not in names:
        return None
    point = row.get("geometry") or {}
    lat, lon = point.get("y"), point.get("x")
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (lat, lon)):
        raise ValueError("Missing Sibley address geometry")
    if not (43.499 <= lat <= 49.385 and -97.24 <= lon <= -89.48):
        raise ValueError("Sibley point outside Minnesota")
    address = StreetAddress(street, a["MSAG_C"], "MN", a["ZIP"], int(number), suffix)
    return address, (lat, lon)


TRAVERSE = (
    "https://gis.co.traverse.mn.us/arcgis/rest/services/GIS_Data_Layers/MapServer/0"
)
TRAVERSE_ARCHIVE = "https://data.openaddresses.io/runs/1198403/us/mn/traverse.zip"
TRAVERSE_ARCHIVE_HASH = (
    "cc2135d952d97084c4b7b0a4adf68548940714cc9f4d5586e513d9428a1c1155"
)
TRAVERSE_FIELDS = (
    "OBJECTID",
    "DLVRY_ADD",
    "STR_NUM",
    "STR_NAME",
    "STR_TYPE",
    "PRE_DIR",
    "POST_DIR",
    "CITY",
    "STATE",
    "ZIP_CODE",
    "UNIT_TYPE",
    "UNIT_NUM",
)


def download_traverse():
    response = requests.get(TRAVERSE_ARCHIVE, timeout=(5, 40))
    response.raise_for_status()
    archived = response.content
    if hashlib.sha256(archived).hexdigest() != TRAVERSE_ARCHIVE_HASH:
        raise ValueError("Traverse historical edition changed")
    with ZipFile(io.BytesIO(archived)) as files:
        with files.open("us/mn/traverse.csv") as source:
            old = list(csv.DictReader(io.TextIOWrapper(source, encoding="utf-8")))
    ids = sorted(
        get(TRAVERSE + "/query", where="1=1", returnIdsOnly="true")["objectIds"]
    )
    current = []
    for offset in range(0, len(ids), 100):
        page_ids = ids[offset : offset + 100]
        data = get(
            TRAVERSE + "/query",
            objectIds=",".join(map(str, page_ids)),
            outFields=",".join(TRAVERSE_FIELDS),
            outSR=4326,
        )
        if data.get("spatialReference", {}).get("wkid") != 4326:
            raise ValueError("Unexpected Traverse coordinate system")
        rows = data["features"]
        if sorted(row["attributes"]["OBJECTID"] for row in rows) != page_ids:
            raise ValueError("Incomplete Traverse address page")
        current.extend(rows)
    return old, current


def traverse_key(number, street, city, state, zipcode):
    if not (
        state == "MN"
        and city
        and street
        and re.fullmatch(r"[1-9][0-9]*", number)
        and re.fullmatch(r"[0-9]{5}", zipcode)
    ):
        return None
    return StreetAddress(
        _normal(street), " ".join(_city_words(city)), state, zipcode, int(number)
    )


def traverse_points(old, current):
    before, after = defaultdict(set), defaultdict(set)
    conflicting = set()
    for record in old:
        key = traverse_key(
            record["NUMBER"],
            record["STREET"],
            record["CITY"],
            record["REGION"],
            record["POSTCODE"],
        )
        if key and not record["UNIT"]:
            before[key].add(
                (round(float(record["LAT"]), 7), round(float(record["LON"]), 7))
            )
    for row in current:
        a = {
            key: str(value).strip() if value is not None else ""
            for key, value in row["attributes"].items()
        }
        street = " ".join(
            a[k] for k in ("PRE_DIR", "STR_NAME", "STR_TYPE", "POST_DIR") if a[k]
        )
        key = traverse_key(a["STR_NUM"], street, a["CITY"], a["STATE"], a["ZIP_CODE"])
        if not key or a["UNIT_TYPE"] or a["UNIT_NUM"]:
            continue
        if _normal(a["DLVRY_ADD"]) != _normal(a["STR_NUM"] + " " + street):
            conflicting.add(key)
        point = row.get("geometry") or {}
        if "x" not in point or "y" not in point:
            conflicting.add(key)
            continue
        after[key].add((round(point["y"], 7), round(point["x"], 7)))
    # The archive stores 7 decimal places. Both editions must have the same
    # complete coordinate set, including every duplicate location for the key.
    return {
        key: values
        for key, values in before.items()
        if key not in conflicting and values == after.get(key)
    }


TIGER_DIGESTS = {
    "27143": (
        "a4db547735c6b9151fffd4ea0aec948371f9c0634d97fb6cec62299eb103900c",
        "35a53099daeb3b9137ce233c3072d9621fa4f0e381d9d1e5af1631c85139e338",
        "edcd86c6ae321b4d18adc174288004e9cd3884c72b8df90ecbffe62b15be5e35",
    ),
    "27155": (
        "586f88419e84770bff353ce6ab432166b0746df112ae00ce2cda1850830b7393",
        "65e2f4360f6cac42596b069401e9759a95d2c051267be99bfb4a3dd0cae570ae",
        "d30b706a8a1100102b75cd67fbf6f0d149545c479bd856de37cfeade3bdebf1a",
    ),
}


def census_files(county, directory):
    files = []
    for kind, digest in zip(
        ("addrfeat", "addrfn", "faces"), TIGER_DIGESTS[county], strict=True
    ):
        name = f"tl_2026_{county}_{kind}.zip"
        if directory:
            content = (directory / name).read_bytes()
        else:
            url = f"https://www2.census.gov/geo/tiger/TIGER2026/{kind.upper()}/{name}"
            response = requests.get(url, timeout=(5, 40))
            response.raise_for_status()
            content = response.content
        if hashlib.sha256(content).hexdigest() != digest:
            raise ValueError("Unexpected Census address source")
        files.append(content)
    return files


@dataclass(frozen=True)
class EdgeSide:
    tlid: int
    side: str
    face: int
    arid: str
    low: int
    high: int
    parity: str

    def includes(self, number):
        return self.low <= number <= self.high and self.parity in (
            "B",
            "O" if number % 2 else "E",
        )


def direction_base(street):
    words = street.split()
    directions = [i for i, w in enumerate(words) if w in _DIRECTIONS]
    if (
        len(words) >= 3
        and len(directions) == 1
        and directions[0] in (0, len(words) - 1)
    ):
        words.pop(directions[0])
        return " ".join(words)
    return None


def shape_reader(content, *kinds):
    # Copy just the requested shapefile parts into memory; pyshp needs seeks.
    with ZipFile(io.BytesIO(content)) as archive:
        streams = {
            kind: io.BytesIO(
                archive.read(
                    next(n for n in archive.namelist() if n.endswith("." + kind))
                )
            )
            for kind in kinds
        }
    return shapefile.Reader(**streams, encoding="latin1")


def confirmed_side(points, line, face):
    if face is None:
        return False
    # Address positions must sit on the published correct side, close to the
    # edge's interior. A house nearest a junction or across a road is ambiguous.
    return all(
        face.contains(p)
        and face.boundary.distance(p) >= 1
        and line.distance(p) <= 50
        and 0 < line.project(p) < line.length
        for p in points
    )


def add_range_aliases(records, census):
    edges, links, faces = census
    with shape_reader(links, "dbf") as data:
        official_links = {(r.ARID, r.LINEARID) for r in data.iterRecords()}
    project = Transformer.from_crs(4269, 26915, always_xy=True).transform
    lines, by_street, linked_names = {}, defaultdict(set), defaultdict(set)
    with shape_reader(edges, "shp", "shx", "dbf") as reader:
        for record in reader.iterShapeRecords():
            r = record.record.as_dict()
            name = _normal(r["FULLNAME"])
            for s in ("L", "R"):
                low, high = r[s + "FROMHN"], r[s + "TOHN"]
                if not (name and low.isdigit() and high.isdigit() and r["ZIP" + s]):
                    continue
                low, high = sorted((int(low), int(high)))
                key = EdgeSide(
                    r["TLID"],
                    s,
                    r["TFID" + s],
                    r["ARID" + s],
                    low,
                    high,
                    r["PARITY" + s],
                )
                by_street[(r["ZIP" + s], name)].add(key)
                if (key.arid, r["LINEARID"]) in official_links:
                    linked_names[(r["ZIP" + s], key)].add(name)
                if key.tlid not in lines:
                    lines[key.tlid] = transform(
                        project, shape(record.shape.__geo_interface__)
                    )
    possible = defaultdict(set)
    for (zipcode, side), names in linked_names.items():
        for name in names:
            if (base := direction_base(name)) in names:
                possible[(zipcode, base)].add((name, side))
    needed_faces = {side.face for options in possible.values() for _, side in options}
    polygons = {}
    with shape_reader(faces, "shp", "shx", "dbf") as reader:
        for record in reader.iterShapeRecords():
            if record.record.TFID in needed_faces:
                polygons[record.record.TFID] = transform(
                    project, shape(record.shape.__geo_interface__)
                )
    aliases = defaultdict(set)
    for address, coordinates in records.items():
        if address.house_number_suffix or address.unit:
            continue
        for name, side in possible.get((address.zip_code, _normal(address.street)), ()):
            target = {
                r
                for r in by_street[(address.zip_code, name)]
                if r.includes(address.house_number)
            }
            if target != {side}:
                continue
            points = [Point(project(lon, lat)) for lat, lon in coordinates]
            if confirmed_side(points, lines[side.tlid], polygons.get(side.face)):
                aliases[replace(address, street=name)].update(coordinates)
    return aliases


def build(rows, old, current, census_dir=None):
    sibley = defaultdict(set)
    for row in rows:
        if item := sibley_record(row):
            address, point = item
            key = replace(
                address,
                street=_normal(address.street),
                city=" ".join(_city_words(address.city)),
            )
            sibley[key].add(point)
    points = defaultdict(set)
    for county, records in (
        ("27143", sibley),
        ("27155", traverse_points(old, current)),
    ):
        for addresses in (
            records,
            add_range_aliases(records, census_files(county, census_dir)),
        ):
            for address, locations in addresses.items():
                points[address_key(address)].update(locations)
    compact = {key: sorted(values) for key, values in points.items()}
    return json.dumps(compact, separators=(",", ":"), sort_keys=True).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--census-directory", type=Path, help="Use locally staged Census ZIP files"
    )
    content = build(
        download_sibley(), *download_traverse(), parser.parse_args().census_directory
    )
    if (
        hashlib.sha256(content).hexdigest()
        != "dcefced3016316a5161a37e474e372d39e3dc24fdf84f20965a2a6112ea73b85"
    ):
        raise ValueError("County evidence changed since the November 18 comparison")
    print(f"{len(json.loads(content))} confirmed full addresses")
    INDEX.write_bytes(gzip.compress(content, compresslevel=9, mtime=0))


if __name__ == "__main__":
    main()
