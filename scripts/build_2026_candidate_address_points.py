"""Build the packaged October 8, 2026 address-point file for the November 3 lookup.

Run from the repository root:

    uv run python -m scripts.build_2026_candidate_address_points SOURCE.gpkg

SOURCE.gpkg is the state's public address file
(https://operations.gis.data.mn.gov/api/publicdownload/download/497/loc_addresses_open.gpkg,
2,220,021 rows, last changed October 8, 2026). The output replaces
alethical/api/data/candidate_address_points_20261008.bin. A revised state edition
needs separate historical evidence, so the source row count is pinned.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
from pathlib import Path
import sqlite3
import struct

from alethical.api.services.candidate_historical_points import (
    PATH,
    STRING_COLUMNS,
    pack_file,
    epoch_ms,
)

SOURCE_ROWS = 2_220_021
COLUMNS = (
    *STRING_COLUMNS,
    "anumber",
    "zip",
    "status",
    "eff_date",
    "ret_date",
    "latitude",
    "longitude",
    "shape",
)


def native_point(shape: bytes | None) -> tuple[float, float] | None:
    """The point inside a GeoPackage MULTIPOINT blob, in the file's own metres."""
    if shape is None:
        return None
    if shape[:2] != b"GP" or shape[2] != 0:
        raise ValueError("Unrecognized GeoPackage geometry")
    flags = shape[3]
    if flags & 0b00100000:  # extended type
        raise ValueError("Unsupported GeoPackage geometry")
    if flags & 0b00010000:  # empty
        return None
    envelope = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(flags >> 1) & 7]
    wkb = shape[8 + envelope :]
    order = "<" if wkb[0] == 1 else ">"
    kind, count = struct.unpack(order + "II", wkb[1:9])
    if kind != 4 or count != 1:
        raise ValueError("Expected exactly 1 point per address")
    inner = wkb[9:]
    inner_order = "<" if inner[0] == 1 else ">"
    inner_kind = struct.unpack(inner_order + "I", inner[1:5])[0]
    if inner_kind != 1:
        raise ValueError("Unexpected point type")
    return struct.unpack(inner_order + "dd", inner[5:21])


def read_rows(source: Path) -> dict[str, list[dict]]:
    connection = sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)
    total = connection.execute("SELECT COUNT(*) FROM loc_addresses_open").fetchone()[0]
    if total != SOURCE_ROWS:
        raise ValueError(f"Source has {total} rows, expected {SOURCE_ROWS}")
    by_zip: dict[str, list[dict]] = defaultdict(list)
    kept = 0
    for values in connection.execute(
        f"SELECT {','.join(COLUMNS)} FROM loc_addresses_open"
    ):
        row = dict(zip(COLUMNS, values))
        zip_code, number = row["zip"], row["anumber"]
        # The lookup only asks for a 5-digit ZIP and a whole house number.
        if not (
            isinstance(zip_code, str)
            and len(zip_code) == 5
            and zip_code.isascii()
            and zip_code.isdigit()
            and type(number) is int
        ):
            continue
        point = native_point(row.pop("shape"))
        row["x"], row["y"] = point if point else (None, None)
        row["eff_date"] = epoch_ms(row["eff_date"])
        row["ret_date"] = epoch_ms(row["ret_date"])
        by_zip[zip_code].append(row)
        kept += 1
    print(f"{total} source rows, {kept} searchable, {len(by_zip)} ZIP codes")
    return by_zip


def build(source: Path, output: Path) -> None:
    by_zip = read_rows(source)
    temporary = output.with_suffix(".tmp")
    temporary.write_bytes(pack_file(by_zip))
    temporary.replace(output)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    print(f"{output} {output.stat().st_size} bytes sha256 {digest}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=PATH)
    args = parser.parse_args()
    build(args.source, args.output)
