# /// script
# requires-python = ">=3.13"
# dependencies = ["openpyxl>=3.1,<4", "pyshp==2.3.1", "pyproj>=3.7,<4", "shapely>=2.1,<3"]
# ///
"""Rebuild the election-specific public map from the original official files.

Download the SOURCES in order below, then pass their local paths to
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

from openpyxl import load_workbook
from pyproj import Transformer
import shapefile
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
    (
        "https://sos.mn.gov/media/3338/precinct-table.xlsx",
        "1afd7085d97bec646afa4a75903a7d15198316e081250c219461eb609ad9d07c",
    ),
    (
        "https://operations.gis.data.mn.gov/api/publicdownload/download/1139/bdry_school_district_boundaries.gpkg",
        "5574ae347d31f56407b8c30150d0191eb52f32091abd05230e3ccddf77846eaf",
    ),
    (
        "https://www2.census.gov/geo/tiger/TIGER2026/COUSUB/tl_2026_27_cousub.zip",
        "9a683c0b4cf3b45a879e53d77e6df5a46e70b988c2080881b5f082eaf380a74b",
    ),
    (
        "https://electionresultsfiles.sos.mn.gov/20261103/SchoolDistTbl.txt",
        "6c8164b20f49c248810e6033110fb3fad21dadb219dccee6987813bafb48b4db",
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

# The 2026 and 2027 unique taxing area inventories each list every applicable
# district by municipality. Fort Snelling also contains the separately listed
# MSP airport area, so is intentionally excluded.
# https://www.hennepincounty.gov/services/property/property-taxes/taxing-district-information
HENNEPIN_SCHOOLS = {
    "Champlin": "11",
    "Chanhassen": "272",
    "Crystal": "281",
    "Deephaven": "276",
    "Excelsior": "276",
    "Greenwood": "276",
    "Hanover": "877",
    "Long Lake": "278",
    "Loretto": "879",
    "Maple Plain": "278",
    "Medicine Lake": "284",
    "Minneapolis": "1",
    "Minnetonka Beach": "278",
    "Mound": "277",
    "New Hope": "281",
    "Osseo": "279",
    "Richfield": "280",
    "Robbinsdale": "281",
    "Rockford": "883",
    "Spring Park": "277",
    "St. Anthony": "282",
    "St. Bonifacius": "110",
    "Tonka Bay": "276",
    "Woodland": "276",
}


def _geometry(blob: bytes):
    # GeoPackage uses an 8-byte prefix, an optional envelope, then native WKB.
    envelope_size = (0, 32, 48, 48, 64)[(blob[3] >> 1) & 7]
    return from_wkb(blob[8 + envelope_size :])


def _write(lines: list, path: Path) -> None:
    payload = "".join(json.dumps(line, separators=(",", ":")) + "\n" for line in lines)
    path.write_bytes(gzip.compress(payload.encode(), mtime=0))


def _pre_election_schools(source: Path, roster: Path, output: Path) -> None:
    # The House records both July 1 consolidations by name and successor number.
    # Tracy's board confirms Milroy was 635 (the House summary prints 65).
    # https://www.house.mn.gov/hrd/issinfo/schdistcon.aspx
    # https://files-backend.assets.thrillshare.com/documents/asset/uploaded_file/4256/Tapc/84780c79-207f-4157-b58e-3f2208f79f12/February-9%2C-2026-Board-Minutes.pdf
    updated = {
        "635": ("2913", "Tracy Area"),
        "2904": ("2913", "Tracy Area"),
        "93": ("2918", "Carlton-Wrenshall"),
        "100": ("2918", "Carlton-Wrenshall"),
    }
    groups: dict[tuple, list] = {}
    with closing(
        sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)
    ) as db:
        for typ, code, name, blob in db.execute(
            "SELECT sdtype, sdnumber, shortname, Shape FROM school_district_boundaries ORDER BY OBJECTID"
        ):
            geometry = _geometry(blob)
            if geometry.is_empty or not geometry.is_valid:
                raise ValueError("Invalid education district polygon")
            number = str(int(code))
            if typ == "01" and number in updated:
                number, name = updated[number]
            school = ({"01": "ISD", "02": "CSD", "03": "SSD"}[typ], number, name)
            groups.setdefault(school, []).append(geometry)
    if len(groups) != 327:
        raise ValueError(
            "Unexpected number of Minnesota school districts after consolidation"
        )
    # Official election names can differ from the education agency's short
    # name (ISD 728 versus Elk River). Minnesota has two numbered district 1s.
    election_names: dict[str, dict[str, str]] = {}
    for line in roster.read_text(encoding="cp1252").splitlines():
        code, name, county, _ = line.split(";")
        by_county = election_names.setdefault(str(int(code)), {})
        if county in by_county:
            raise ValueError("School roster repeats county and district")
        by_county[county] = name
    lines = []
    for (typ, number, name), shapes in sorted(groups.items()):
        aliases = {
            county: election_name
            for county, election_name in election_names.get(number, {}).items()
            if number != "1" or election_name.casefold() == name.casefold()
        }
        lines.append([[typ, number, name, aliases], union_all(shapes).wkb_hex])
    _write(lines, output)


def build(
    precinct_map: Path,
    register: Path,
    schools: Path,
    register_xlsx: Path,
    mde: Path,
    townships: Path,
    school_roster: Path,
    output: Path,
) -> None:
    for path, (url, expected) in zip(
        (precinct_map, register, schools, register_xlsx, mde, townships, school_roster),
        SOURCES,
        strict=True,
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
    nashwauk_city = None
    with closing(load_workbook(register_xlsx, read_only=True, data_only=True)) as wb:
        hospital_codes = {
            (str(row[1]).zfill(2), row[2]): row[11]
            for row in wb["Precincts"].iter_rows(min_row=2, values_only=True)
            if row[1]
        }
    with closing(
        sqlite3.connect(f"{precinct_map.resolve().as_uri()}?mode=ro", uri=True)
    ) as db:
        db.row_factory = sqlite3.Row
        for r in db.execute(
            "SELECT * FROM bdry_votingdistricts ORDER BY COUNTYCODE, PCTCODE"
        ):
            key = (r["COUNTYCODE"].zfill(2), r["PCTCODE"])
            row = official.pop(key)
            geometry = _geometry(r["Shape"])
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
            # The election register uses 45952 for Scandia's one precinct.
            # https://electionresults.sos.mn.gov/results/Index?ersElectionId=201&FipsCode=45952&scenario=LocalMunicipality
            scandia = (
                key == ("82", "0280")
                and row[8] == "45952"
                and r["MCDNAME"] == "Scandia"
            )
            if row[8] == r["MCDFIPS"].strip() or scandia:
                attrs["municipality_code"] = row[8]
                county_schools = {"18": CROW_WING_SCHOOLS, "27": HENNEPIN_SCHOOLS}.get(
                    row[0], {}
                )
                if school := county_schools.get(r["MCDNAME"]):
                    attrs["school_type"] = (
                        "SSD" if r["MCDNAME"] == "Minneapolis" else "ISD"
                    )
                    attrs["school_district"] = school
                    if attrs["school_type"] == "SSD":
                        # https://vote.minneapolismn.gov/results-data/election-maps/
                        attrs["school_subdistrict"] = attrs["park_district"]
            hospital = r["HOSPDIST"].strip()
            if hospital_codes.pop(key) != (hospital or "no data"):
                raise ValueError(
                    f"Election precinct hospital assignment disagrees: {key}"
                )
            if hospital:
                attrs["hospital_district"] = hospital
                attrs["hospital_name"] = r["HOSPDIST_N"].strip()
            if row[0] == "19" and row[8] == "61492":
                south_st_paul.append(geometry)
            if key == ("31", "0280") and row[8] == "44980":
                nashwauk_city = geometry
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
    if official or hospital_codes or len(south_st_paul) != 6 or nashwauk_city is None:
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
    # Nashwauk City remains in three separate legal townships. Use census
    # NAD83 county subdivisions, clipped to its dated November city precinct.
    township_codes = {"2706144998", "2706125892", "2706137934"}
    census = Transformer.from_crs("EPSG:4269", "EPSG:26915", always_xy=True)
    with shapefile.Reader(str(townships), encoding="latin1") as reader:
        for item in reader.iterShapeRecords(fields=["GEOID"]):
            geoid = item.record[0]
            if geoid in township_codes:
                poly = transform(census.transform, shape(item.shape.__geo_interface__))
                overlap = nashwauk_city.intersection(poly)
                if overlap.is_empty or not overlap.is_valid:
                    raise ValueError("Invalid Nashwauk township overlap")
                township_codes.remove(geoid)
                lines.append(["township", geoid[-5:], overlap.wkb_hex])
    if township_codes:
        raise ValueError("Missing Nashwauk township geography")
    _write(lines, output)
    _pre_election_schools(
        mde,
        school_roster,
        output.with_name("candidate_school_boundaries_sy2026.jsonl.gz"),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in (
        "precinct_map",
        "register",
        "schools",
        "register_xlsx",
        "mde",
        "townships",
        "school_roster",
        "output",
    ):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    build(**vars(args))
