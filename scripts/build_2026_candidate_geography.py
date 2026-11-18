"""Rebuild the election-specific public map from the original official files.

Download the three SOURCES in order below, then pass their local paths to
this script followed by the output path. Source hashes bind the map to the
approved editions even if a publisher later replaces its download.
"""

from __future__ import annotations

import argparse
from contextlib import closing
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3

from pyproj import Transformer
from shapely import from_wkb, to_wkb, union_all
from shapely.geometry import shape
from shapely.ops import transform

SOURCES = (
    (
        "https://operations.gis.data.mn.gov/api/publicdownload/download/936/bdry_votingdistricts.gpkg",
        "dea7ceea3b0b0e92a57eb6c3015062754f7687a31b6eb8077d8a73b9dc4386a8",
    ),
    (
        "https://electionresultsfiles.sos.mn.gov/20261103/PrctTbl.txt",
        "8a396f732ebe92ff9b05a26facb2c20a2b4142480784d5443a854abce9ce991c",
    ),
    (
        "https://gis2.co.dakota.mn.us/arcgis/rest/services/DCGIS_OL_Schools/MapServer/1/query"
        "?where=DISTRICT%20in%20(6,199)&outFields=DISTRICT&returnGeometry=true&outSR=4326&f=geojson",
        "a947fc4a60262769b56de5e50875d8cde6122e8a071472d43a0636455010fd4a",
    ),
)


# Pages 1–2 of Crow Wing County's final 2026 and proposed 2027 jurisdiction
# registers, dated March 12 and October 28, 2026, respectively. Both list the
# same single independent school district for these complete municipalities.
# The dated election returns must also contain the school race in the precinct.
# Multi-district municipalities (including Crosslake) deliberately have no entry.
# https://www.crowwing.gov/Archive/ViewFile/Item/3159
# https://www.crowwing.gov/Archive/ViewFile/Item/3321
CROW_WING_SCHOOLS = {
    "Baxter": "181",
    "Brainerd": "181",
    "Breezy Point": "186",
    "Crosby": "182",
    "Crow Wing Twp": "181",
    "Cuyuna": "182",
    "Dean Lake Unorg": "1",
    "Deerwood": "182",
    "Emily": "182",
    "Fifty Lakes": "2174",
    "Fort Ripley": "181",
    "Fort Ripley Twp": "181",
    "Gail Lake Twp": "2174",
    "Garrison": "181",
    "Irondale Twp": "182",
    "Ironton": "182",
    "Jenkins": "186",
    "Little Pine Twp": "182",
    "Long Lake Twp": "181",
    "Manhattan Beach": "2174",
    "Maple Grove Twp": "181",
    "Pequot Lakes": "186",
    "Perry Lake Twp": "182",
    "Riverton": "182",
    "Timothy Twp": "2174",
    "Trommald": "182",
    "Wolford Twp": "182",
}


def build(precinct_map: Path, register: Path, schools: Path, output: Path) -> None:
    for path, (url, expected) in zip(
        (precinct_map, register, schools), SOURCES, strict=True
    ):
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Unrecognized source edition: {url}")

    rows = [
        line.split(";") for line in register.read_text(encoding="cp1252").splitlines()
    ]
    official = {(r[0], r[1]): r for r in rows}
    if len(official) != 4105 or len(rows) != 4105:
        raise ValueError("Incomplete or duplicate November precinct register")
    lines = []
    south_st_paul = []
    with closing(
        sqlite3.connect(f"{precinct_map.resolve().as_uri()}?mode=ro", uri=True)
    ) as db:
        db.row_factory = sqlite3.Row
        for r in db.execute(
            "SELECT * FROM bdry_votingdistricts ORDER BY COUNTYCODE, PCTCODE"
        ):
            key = (r["COUNTYCODE"].zfill(2), r["PCTCODE"])
            row = official.pop(key)
            # GeoPackage uses an 8-byte prefix, an optional envelope, then WKB.
            blob = r["Shape"]
            envelope_size = (0, 32, 48, 48, 64)[(blob[3] >> 1) & 7]
            geometry = from_wkb(blob[8 + envelope_size :])
            if geometry.is_empty or not geometry.is_valid:
                raise ValueError(f"Invalid geometry for precinct {key}")
            attrs = {
                "county_code": row[0],
                "precinct_code": row[1],
                "precinct_name": row[2],
                "congressional_district": row[3],
                "house_district": row[4],
                "senate_district": r["MNSENDIST"].strip(),
                "commissioner_district": row[5],
                "judicial_district": row[6],
                "soil_water_district": row[7],
                "soil_water_name": r["SWCDIST_N"].strip(),
                "park_district": r["PARKDIST"].strip(),
                "park_name": r["PARKDIST_N"].strip(),
                "ward": r["WARD"].strip(),
            }
            # Some Minnesota precincts combine several municipalities. A single
            # municipal jurisdiction is supported only when both sources agree.
            if row[8] == r["MCDFIPS"].strip():
                attrs["municipality_code"] = row[8]
                if row[0] == "18" and (school := CROW_WING_SCHOOLS.get(r["MCDNAME"])):
                    attrs["school_type"] = "ISD"
                    attrs["school_district"] = school
            if row[9] and row[9] == r["HOSPDIST"].strip():
                attrs["hospital_district"] = row[9]
                attrs["hospital_name"] = r["HOSPDIST_N"].strip()
            if row[0] == "19" and row[8] == "61492":
                south_st_paul.append(geometry)
            for i, field in (
                (3, "CONGDIST"),
                (4, "MNLEGDIST"),
                (5, "CTYCOMDIST"),
                (6, "JUDDIST"),
                (7, "SWCDIST"),
            ):
                if row[i] != r[field].strip():
                    raise ValueError(
                        f"Election register and map disagree: {key}, {field}"
                    )
            lines.append(
                ["precinct", {k: v for k, v in attrs.items() if v}, geometry.wkb_hex]
            )
    if official or len(south_st_paul) != 6:
        raise ValueError("Mapped precincts disagree with election register")
    # The city lists the two school districts, including the street exceptions,
    # for this election and supplies one sample ballot per precinct/school style:
    # https://www.southstpaulmn.gov/228/Voting-Locations
    # https://www.southstpaulmn.gov/224/Elections
    city = union_all(south_st_paul)
    project = Transformer.from_crs("EPSG:4326", "EPSG:26915", always_xy=True)
    for feature in json.loads(schools.read_bytes())["features"]:
        code = str(feature["properties"]["DISTRICT"])
        school_type = {"6": "SSD", "199": "ISD"}[code]
        boundary = transform(
            project.transform, shape(feature["geometry"])
        ).intersection(city)
        if boundary.is_empty or not boundary.is_valid:
            raise ValueError("Missing South St. Paul school ballot geography")
        lines.append(["school", [school_type, code], to_wkb(boundary, hex=True)])
    payload = "".join(json.dumps(line, separators=(",", ":")) + "\n" for line in lines)
    output.write_bytes(gzip.compress(payload.encode(), mtime=0))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("precinct_map", "register", "schools", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    build(args.precinct_map, args.register, args.schools, args.output)
