"""Exact county-published address points that predate the November 2026 election."""

from __future__ import annotations

from functools import lru_cache
import gzip
import hashlib
import json
from pathlib import Path

from alethical.pipeline.candidate_ballot import StreetAddress

INDEX = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "candidate_county_points_20261103.json.gz"
)


def address_key(address: StreetAddress) -> str:
    from alethical.api.services.candidate_lookup import _city_words, _normal

    parts = (
        address.state.upper(),
        address.zip_code,
        " ".join(_city_words(address.city)),
        str(address.house_number),
        address.house_number_suffix.strip().upper(),
        _normal(address.street),
        address.unit.strip().upper(),
    )
    return hashlib.sha256(json.dumps(parts, separators=(",", ":")).encode()).hexdigest()


@lru_cache(maxsize=1)
def _index() -> dict[str, list[list[float]]]:
    # Only the packaged public record set is cached.
    with gzip.open(INDEX, "rt", encoding="utf-8") as archive:
        return json.load(archive)


def county_address_points(address: StreetAddress) -> set[tuple[float, float]]:
    """Return every matching published (latitude, longitude) for this full address."""
    return {(lat, lon) for lat, lon in _index().get(address_key(address), ())}
