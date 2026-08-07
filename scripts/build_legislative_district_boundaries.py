"""Build the local Minnesota legislative district map used by address lookup.

The source files are the official 2022 redistricting GeoJSON downloads from the
Minnesota Legislative Coordinating Commission. They use EPSG:26915 coordinates;
the app needs WGS84 longitude and latitude coordinates (EPSG:4326).
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import zipfile
from pathlib import Path

from pyproj import Transformer


SOURCE_FILES = {
    "house": "hse2023.json",
    "senate": "sen2023.json",
}


def _canonical_district_code(value: object) -> str:
    match = re.fullmatch(r"0*(\d{1,2})([AB]?)", str(value).strip().upper())
    if not match:
        raise ValueError(f"Invalid district code: {value}")
    return f"{int(match.group(1))}{match.group(2)}"


def _transform_coordinates(value, transformer: Transformer):
    if (
        isinstance(value, list)
        and len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
    ):
        longitude, latitude = transformer.transform(value[0], value[1])
        return [round(longitude, 7), round(latitude, 7)]
    if isinstance(value, list):
        return [_transform_coordinates(item, transformer) for item in value]
    raise ValueError("Geometry has invalid coordinates")


def _features(source_zip: Path, chamber: str, transformer: Transformer) -> list[dict]:
    with zipfile.ZipFile(source_zip) as archive:
        with archive.open(SOURCE_FILES[chamber]) as source:
            payload = json.load(source)

    if payload.get("crs", {}).get("properties", {}).get("name") != "EPSG:26915":
        raise ValueError(f"{source_zip} does not use EPSG:26915")

    features = []
    for source_feature in payload.get("features", []):
        geometry = source_feature.get("geometry") or {}
        if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            raise ValueError(f"{source_zip} has an invalid geometry")
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "chamber": chamber,
                    "district": _canonical_district_code(
                        (source_feature.get("properties") or {}).get("DISTRICT")
                    ),
                },
                "geometry": {
                    "type": geometry["type"],
                    "coordinates": _transform_coordinates(
                        geometry.get("coordinates"), transformer
                    ),
                },
            }
        )
    return features


def build(*, house_zip: Path, senate_zip: Path, output: Path) -> None:
    transformer = Transformer.from_crs("EPSG:26915", "EPSG:4326", always_xy=True)
    payload = {
        "type": "FeatureCollection",
        "crs": "EPSG:4326",
        "source": "Minnesota Legislative Coordinating Commission 2022 districts, corrected May 26, 2023",
        "features": [
            *_features(house_zip, "house", transformer),
            *_features(senate_zip, "senate", transformer),
        ],
    }
    serialized = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode(
        "utf-8"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as raw_output:
        with gzip.GzipFile(fileobj=raw_output, mode="wb", mtime=0) as compressed:
            compressed.write(serialized)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--house-zip", type=Path, required=True)
    parser.add_argument("--senate-zip", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(
        house_zip=args.house_zip,
        senate_zip=args.senate_zip,
        output=args.output,
    )


if __name__ == "__main__":
    main()
