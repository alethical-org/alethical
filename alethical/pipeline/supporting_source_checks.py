"""Read-only checks for official sources that require a reviewed replacement.

Outputs are evidence for the shared scheduler, never permission to publish a new
map, election, candidate identity, or ZIP reference. No visitor address is used.
"""

from __future__ import annotations

import calendar
import hashlib
import io
import json
import re
import time
import zipfile
from dataclasses import asdict, dataclass, field
from datetime import date
from html.parser import HTMLParser
from typing import Callable
from urllib.parse import urljoin, urlsplit

import requests

MAP_INDEX = "https://gis.lcc.mn.gov/html/download.html"
BALLOT_HOME = "https://myballotmn.sos.mn.gov/"
HUD_INDEX = "https://www.huduser.gov/portal/datasets/usps_crosswalk.html"
MAX_BYTES = 20_000_000


@dataclass
class CheckResult:
    source: str
    status: str
    detail: str
    evidence: dict = field(default_factory=dict)

    def document(self) -> dict:
        return asdict(self)


class SourceUnavailable(ValueError):
    """A public source did not provide the bounded, expected response."""


def fetch_public(url: str) -> bytes:
    """Bounded GETs only; reject redirects, credentials and unapproved hosts."""
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname
        not in {"gis.lcc.mn.gov", "myballotmn.sos.mn.gov", "www.huduser.gov"}
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
    ):
        raise SourceUnavailable("Unapproved source address")
    for attempt in range(3):
        if attempt:
            time.sleep(3 * attempt)
        try:
            with requests.get(
                url,
                timeout=(5, 30),
                stream=True,
                allow_redirects=False,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; AlethicalSourceCheck/1.0; +https://www.alethical.com)"
                },
            ) as response:
                if response.status_code != 200:
                    raise SourceUnavailable(
                        f"Source returned HTTP {response.status_code}"
                    )
                body = bytearray()
                started = time.monotonic()
                for chunk in response.iter_content(65536):
                    body.extend(chunk)
                    if len(body) > MAX_BYTES or time.monotonic() - started > 60:
                        raise SourceUnavailable("Source response exceeded its limit")
                if not body:
                    raise SourceUnavailable("Source returned an empty body")
                return bytes(body)
        except (requests.RequestException, SourceUnavailable):
            if attempt == 2:
                raise SourceUnavailable(
                    "Source unavailable after 3 bounded reads"
                ) from None
    raise AssertionError("unreachable")


class PageLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.options: list[str] = []
        self.scripts: list[str] = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "option" and values.get("value"):
            self.options.append(values["value"])
        if tag == "script" and values.get("src"):
            self.scripts.append(values["src"])


def current_map_links(body: bytes) -> dict[str, str]:
    parser = PageLinks()
    parser.feed(body.decode("utf-8"))
    selected = {}
    for chamber, suffix in (("house", "hse"), ("senate", "sen")):
        # The official download page lists all old releases. Pick the latest
        # named legislative plan, not unrelated census or election-result files.
        matches = []
        for url in parser.options:
            match = re.fullmatch(
                rf"https://gis\.lcc\.mn\.gov/data/geojson/L(\d{{4}})_0{suffix}\.zip",
                url,
            )
            if match:
                matches.append((int(match[1]), url))
        if not matches:
            raise SourceUnavailable(f"No official {chamber} GeoJSON download found")
        selected[chamber] = max(matches)[1]
    return selected


def map_payload(body: bytes, chamber: str) -> dict:
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        files = [
            item
            for item in archive.infolist()
            if item.filename.lower().endswith((".json", ".geojson"))
        ]
        if len(files) != 1 or files[0].file_size > MAX_BYTES:
            raise SourceUnavailable("Map archive must contain 1 bounded GeoJSON file")
        payload = json.loads(archive.read(files[0]))
    expected = (
        {str(n) for n in range(1, 68)}
        if chamber == "senate"
        else {f"{n}{letter}" for n in range(1, 68) for letter in "AB"}
    )
    codes = []
    features = payload.get("features", [])
    for feature in features:
        raw = str(feature.get("properties", {}).get("DISTRICT", "")).upper()
        match = re.fullmatch(r"0*(\d{1,2})([AB]?)", raw)
        geometry = feature.get("geometry", {})
        if (
            not match
            or geometry.get("type") not in {"Polygon", "MultiPolygon"}
            or not geometry.get("coordinates")
        ):
            raise SourceUnavailable("Map has an invalid district or shape")
        codes.append(f"{int(match[1])}{match[2]}")
    if set(codes) != expected or len(codes) != len(expected):
        raise SourceUnavailable("Map is missing districts or repeats a district")
    crs = payload.get("crs", {}).get("properties", {}).get("name")
    if crs not in (None, "EPSG:26915", "EPSG:4326", "urn:ogc:def:crs:OGC:1.3:CRS84"):
        raise SourceUnavailable("Map uses an unsupported coordinate system")
    # GeoJSON without an explicit CRS uses longitude/latitude. Never feed it
    # through the older reviewed importer's EPSG:26915 transformation.
    from shapely.geometry import shape

    for feature in features:
        geometry = shape(feature["geometry"])
        if geometry.is_empty or not geometry.is_valid:
            raise SourceUnavailable("Map contains an invalid shape")
        if crs != "EPSG:26915":
            west, south, east, north = geometry.bounds
            if not (-98 <= west <= east <= -89 and 43 <= south <= north <= 50):
                raise SourceUnavailable("Map coordinates are outside Minnesota")
    return payload


def check_maps(
    approved_hashes: dict[str, str], fetch: Callable = fetch_public
) -> list[CheckResult]:
    try:
        links = current_map_links(fetch(MAP_INDEX))
    except (SourceUnavailable, ValueError, UnicodeError) as error:
        return [CheckResult("district-map-index", "unavailable", str(error))]
    results = []
    for chamber, url in links.items():
        try:
            time.sleep(3)
            body = fetch(url)
            payload = map_payload(body, chamber)
            digest = hashlib.sha256(body).hexdigest()
            changed = digest != approved_hashes[chamber]
            results.append(
                CheckResult(
                    f"district-map-{chamber}",
                    "review_required" if changed else "unchanged",
                    "Official download differs from the reviewed copy; compare geometry before replacing the map"
                    if changed
                    else "Official download matches the reviewed copy",
                    {
                        "url": url,
                        "sha256": digest,
                        "approved_sha256": approved_hashes[chamber],
                        "districts": len(payload["features"]),
                        "coordinate_system": payload.get("crs", {})
                        .get("properties", {})
                        .get("name", "GeoJSON longitude/latitude"),
                    },
                )
            )
        except (SourceUnavailable, ValueError, KeyError, zipfile.BadZipFile) as error:
            results.append(
                CheckResult(f"district-map-{chamber}", "unavailable", str(error))
            )
    return results


def check_ballot_contract(
    election: dict, today: date, fetch: Callable = fetch_public
) -> CheckResult:
    """Observe the public app contract, never query a resident's address."""
    try:
        parser = PageLinks()
        parser.feed(fetch(BALLOT_HOME).decode("utf-8"))
        main = [
            urljoin(BALLOT_HOME, value)
            for value in parser.scripts
            if re.fullmatch(r"main-[A-Za-z0-9]+\.js", value)
        ]
        if len(main) != 1:
            raise SourceUnavailable(
                "Official ballot app script could not be identified"
            )
        time.sleep(3)
        script = fetch(main[0]).decode("utf-8")
        if not all(
            value in script
            for value in (
                "/api/Streets/GetStreets",
                "/api/PollingPlaceData/GetPollingPlaceData",
                "prodAddressRangeId",
                "ElectionId",
            )
        ):
            raise SourceUnavailable(
                "Official ballot app no longer exposes the supported request contract"
            )
    except (SourceUnavailable, ValueError, UnicodeError) as error:
        return CheckResult("candidate-ballot", "unavailable", str(error))
    election_date = date.fromisoformat(election["date"])
    days_left = (election_date - today).days
    review = days_left <= 60
    return CheckResult(
        "candidate-ballot",
        "review_required" if review else "unchanged",
        "Review the next official election mapping; the approved election is approaching or has ended"
        if review
        else "Public ballot app exposes the supported request contract",
        {
            "supported_election": election,
            "days_until_election": days_left,
            "script_url": main[0],
            "scope": "Public app contract only; no address-based API response or statewide candidate completeness claim",
        },
    )


def check_zip_reference(as_of: date, today: date) -> CheckResult:
    """A review deadline is not evidence that HUD published a new workbook."""
    if (
        as_of.month not in (3, 6, 9, 12)
        or as_of.day != calendar.monthrange(as_of.year, as_of.month)[1]
    ):
        raise ValueError("The held ZIP reference must carry its actual quarter-end")
    quarter = (as_of.month - 1) // 3 + 1
    next_month = quarter * 3 + 3
    year = as_of.year + (next_month - 1) // 12
    month = (next_month - 1) % 12 + 1
    quarter_end = date(year, month, calendar.monthrange(year, month)[1])
    deadline_month = month + 1
    deadline_year = year + (deadline_month - 1) // 12
    deadline_month = (deadline_month - 1) % 12 + 1
    review_on = date(
        deadline_year,
        deadline_month,
        calendar.monthrange(deadline_year, deadline_month)[1],
    )
    due = today >= review_on
    return CheckResult(
        "zip-state-reference",
        "review_required" if due else "not_due",
        "Obtain and review the authenticated HUD ZIP-to-county workbook; availability has not been established"
        if due
        else "Next quarterly workbook review is not due",
        {
            "source_url": HUD_INDEX,
            "held_as_of": as_of.isoformat(),
            "next_quarter_end": quarter_end.isoformat(),
            "review_on": review_on.isoformat(),
            "access": "HUD sign-in required; existing lookup remains unchanged",
        },
    )
