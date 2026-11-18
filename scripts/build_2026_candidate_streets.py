# /// script
# requires-python = ">=3.12"
# dependencies = ["pyshp==2.3.1", "pyproj>=3.7,<4", "shapely>=2.1,<3"]
# ///
"""Build the public 2026 street-range index, using whole streets between junctions.

Run with uv run --script, passing the Minnesota TIGER/Line ADDRFEAT and FACES ZIPs'
directory, the September election GeoPackage, the MDE SY2025–26 facility CSV,
and the destination ZIP.
See the source notice for the dated downloads. No household records are used.
"""

import argparse
from collections import defaultdict
from contextlib import closing
import csv
import gzip
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from pyproj import Transformer
from shapely import STRtree, from_wkb, transform
from shapely.geometry import LineString, MultiLineString, shape


def civic_points(source: Path) -> list:
    if (
        hashlib.sha256(source.read_bytes()).hexdigest()
        != "a2deaa62a20469931669fe7e318613e6746bae22e614beee33f365810f6248de"
    ):
        raise ValueError("Unexpected MDE facility directory edition")
    points = set()
    with source.open(encoding="cp1252", newline="") as stream:
        for row in csv.DictReader(stream):
            if row["year"] != "SY2025-26":
                raise ValueError("Unexpected facility year")
            match = re.fullmatch(
                r"(\d+) ([^,]+),\s*([^,]+),\s*MN\s+(\d{5})", row["gisaddr"], re.I
            )
            if not match:
                continue
            number, street, city, zipcode = match.groups()
            if row["latitude"] in {"NULL", ""} or row["longitude"] in {"NULL", ""}:
                continue
            lat, lon = float(row["latitude"]), float(row["longitude"])
            if 43 < lat < 50 and -98 < lon < -89:
                points.add(
                    (zipcode, int(number), street.upper(), city.upper(), lat, lon)
                )
    return sorted(points)


def _county_sources(directory: Path, file_type: str, expected: str) -> list[Path]:
    sources = [
        directory / f"tl_2026_27{n:03}_{file_type}.zip" for n in range(1, 174, 2)
    ]
    digest = hashlib.sha256()
    for path in sources:
        digest.update(path.name.encode() + hashlib.sha256(path.read_bytes()).digest())
    if digest.hexdigest() != expected:
        raise ValueError(f"Unexpected edition of the 87 Census {file_type} files")
    return sources


class FaceDistricts:
    """Assign a whole Census address-side face with at most 10 cm of linework error."""

    def __init__(self, polygons, ids):
        self.ids = ids
        self.tree = STRtree(polygons)
        self.outside = [polygon.buffer(0.1, quad_segs=2) for polygon in polygons]
        self.inside = STRtree([polygon.buffer(-0.1) for polygon in polygons])

    def containing(self, face):
        if face.is_empty or not face.is_valid or face.area <= 1:
            return ""
        centre = self.tree.query(face.representative_point(), predicate="within")
        if len(centre) != 1:
            return ""
        i = int(centre[0])
        if not self.outside[i].covers(face):
            return ""
        interiors = self.inside.query(face, predicate="intersects")
        return self.ids[i] if len(interiors) == 1 and int(interiors[0]) == i else ""


def build(directory: Path, precinct_file: Path, facilities: Path, output: Path) -> None:
    import shapefile

    sources = _county_sources(
        directory,
        "addrfeat",
        "e73e3fe1a3645f7554046db23954bf873e90f4d88c83c64798eddb7aa59a75d3",
    )
    face_sources = _county_sources(
        directory,
        "faces",
        "5c179a701b99574b1fede4de6623dd0e1fddc5b45c943fcb1739e009441c080d",
    )
    if (
        hashlib.sha256(precinct_file.read_bytes()).hexdigest()
        != "dea7ceea3b0b0e92a57eb6c3015062754f7687a31b6eb8077d8a73b9dc4386a8"
    ):
        raise ValueError("Unexpected edition of the election precinct boundaries")
    keys = []
    polygons = []
    counties = {}
    with closing(
        sqlite3.connect(f"{precinct_file.resolve().as_uri()}?mode=ro", uri=True)
    ) as db:
        for county, precinct, name, blob in db.execute(
            "SELECT COUNTYCODE, PCTCODE, COUNTYNAME, Shape FROM bdry_votingdistricts ORDER BY COUNTYCODE, PCTCODE"
        ):
            county = county.zfill(2)
            keys.append(county + precinct)
            counties[county] = name
            envelope_bytes = (0, 32, 48, 48, 64)[(blob[3] >> 1) & 7]
            polygons.append(from_wkb(blob[8 + envelope_bytes :]))
    if len(set(keys)) != 4105 or len(counties) != 87:
        raise ValueError("Incomplete voting precinct map")
    # Reject any road crossing or touching another precinct and keep a margin
    # from the boundary. This index never interpolates a house location.
    tree = STRtree(polygons)
    interiors = STRtree([polygon.buffer(-10) for polygon in polygons])
    # Derived from the MDE school-year map and 2026 consolidations by the
    # geography builder. A range on a school line cannot identify either side.
    school_file = (
        Path(__file__).resolve().parents[1]
        / "alethical/api/data/candidate_school_boundaries_sy2026.jsonl.gz"
    )
    school_ids, school_shapes = [], []
    with gzip.open(school_file, "rt", encoding="utf-8") as f:
        for line in f:
            (typ, number, _name, _aliases), wkb = json.loads(line)
            school_ids.append(f"{typ}:{number}")
            school_shapes.append(from_wkb(bytes.fromhex(wkb)))
    if len(set(school_ids)) != 327:
        raise ValueError("Incomplete source school map")
    school_tree = STRtree(school_shapes)
    school_interiors = STRtree([polygon.buffer(-10) for polygon in school_shapes])
    precinct_faces = FaceDistricts(polygons, keys)
    school_faces = FaceDistricts(school_shapes, school_ids)
    project = Transformer.from_crs("EPSG:4269", "EPSG:26915", always_xy=True)
    streets = defaultdict(lambda: defaultdict(set))
    for path, face_source in zip(sources, face_sources, strict=True):
        pending = defaultdict(set)
        with shapefile.Reader(str(path), encoding="latin1") as reader:
            for sr in reader.iterShapeRecords():
                row = sr.record.as_dict()
                sides = []
                for side in ("L", "R"):
                    low, high = row[f"{side}FROMHN"], row[f"{side}TOHN"]
                    if not (
                        row["FULLNAME"]
                        and re.fullmatch(r"[0-9]{5}", row[f"ZIP{side}"])
                        and low.isascii()
                        and low.isdigit()
                        and high.isascii()
                        and high.isdigit()
                        and row[f"PARITY{side}"] in {"B", "E", "O"}
                    ):
                        continue
                    a, b = sorted((int(low), int(high)))
                    sides.append(
                        (
                            row[f"ZIP{side}"],
                            a,
                            b,
                            row[f"PARITY{side}"],
                            row[f"TFID{side}"],
                        )
                    )
                if not sides:
                    continue
                x, y = project.transform(*zip(*sr.shape.points, strict=True))
                coords = list(zip(x, y, strict=True))
                starts = list(sr.shape.parts) + [len(coords)]
                pieces = [coords[a:b] for a, b in zip(starts, starts[1:])]
                line = (
                    LineString(pieces[0])
                    if len(pieces) == 1
                    else MultiLineString(pieces)
                )
                candidates = tree.query(line, predicate="intersects")
                key = ""
                school = ""
                if (
                    len(candidates) == 1
                    and len(interiors.query(line, predicate="within")) == 1
                ):
                    key = keys[candidates[0]]
                    matches = school_tree.query(line, predicate="dwithin", distance=10)
                    if (
                        len(matches) == 1
                        and len(school_interiors.query(line, predicate="within")) == 1
                    ):
                        school = school_ids[matches[0]]
                for zipcode, low, high, parity, face_id in sides:
                    # Retain inconclusive segments too; a conflicting second road
                    # in the same ZIP must prevent a superficially unique match.
                    if school or not face_id:
                        streets[zipcode][row["FULLNAME"]].add(
                            (low, high, parity, key, school)
                        )
                    else:
                        pending[face_id].add(
                            (zipcode, row["FULLNAME"], low, high, parity, key)
                        )
        with shapefile.Reader(str(face_source), encoding="latin1") as reader:
            for record in reader.iterRecords(fields=["TFID"]):
                if record.TFID not in pending:
                    continue
                raw = reader.shape(record.oid)
                face = transform(
                    shape(raw.__geo_interface__), project.transform, interleaved=False
                )
                precinct = precinct_faces.containing(face)
                school = school_faces.containing(face) if precinct else ""
                for zipcode, street, low, high, parity, previous in pending.pop(
                    record.TFID
                ):
                    conflict = previous and precinct and previous != precinct
                    key = "" if conflict else (previous or precinct)
                    streets[zipcode][street].add(
                        (low, high, parity, key, school if key else "")
                    )
        # A referenced face can be missing across a county boundary. Keep that
        # address side so other compatible ranges cannot overrule the unknown.
        for records in pending.values():
            for zipcode, street, low, high, parity, previous in records:
                streets[zipcode][street].add((low, high, parity, previous, ""))
    with ZipFile(output, "w") as out:

        def write(name, data):
            out.writestr(
                ZipInfo(name),
                json.dumps(data, sort_keys=True, separators=(",", ":")),
                compress_type=ZIP_DEFLATED,
            )

        write("counties", counties)
        write("civic", civic_points(facilities))
        for zipcode, rows in sorted(streets.items()):
            write(zipcode, {street: sorted(ranges) for street, ranges in rows.items()})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("directory", "precinct_file", "facilities", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    build(args.directory, args.precinct_file, args.facilities, args.output)
