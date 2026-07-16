#!/usr/bin/env python3
"""Parse the Minnesota Legislature's official printable member roster PDF.

The roster PDF (``memroster.pdf``) is the canonical, human-maintained list of
who currently holds each House and Senate seat. It is linked as the official
"All Members Roster" from both ``senate.mn/members`` and ``house.mn.gov/members``
and its URL is stable across biennia (it always points at the current two-year
roster). We use it as the authority for *membership* -- which legislators are
currently serving -- while the ``leg.mn.gov`` member-page scrape in
``minnesota.py`` remains the source for member *detail* (profile URL, email,
photo, committees) that the PDF does not carry.

The PDF holds both chambers:
  * House (page 1): ``District Last, First (Party)`` with an A/B district suffix.
  * Senate (page 2): ``District Last, First (Party)`` with a bare-number district.
  * A district cross-reference grid (ignored here).
Vacant seats read ``Vacant`` with no ``(Party)`` and are simply absent from the
parsed result.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import requests

DEFAULT_ROSTER_PDF_URL = "https://www.house.mn.gov/hinfo/leginfo/memroster.pdf"
USER_AGENT = "Alethical Minnesota Ingest/0.1"
TIMEOUT_SECONDS = 30

_HOUSE_HEADER = "Minnesota House of Representatives Members"
_SENATE_HEADER = "Minnesota Senate Members"
_GRID_HEADER = "Minnesota House and Senate Members"

# ``District Last, First (Party)`` -- House districts carry an A/B suffix,
# Senate districts are a bare number. The name is captured lazily up to the
# ``(Party)`` marker; it excludes digits so it cannot swallow a room/phone
# number or leap across the PDF's two-column gap into a later entry, and a
# comma is required (every entry is "Last, First").
_HOUSE_ENTRY = re.compile(r"(\d{1,2}[AB])\s+([^()\n\d]*?,[^()\n\d]*?)\s*\((DFL|R)\)")
_SENATE_ENTRY = re.compile(
    r"(?<!\d)(\d{1,2})\s+([^()\n\d]*?,[^()\n\d]*?)\s*\((DFL|R)\)"
)


@dataclass(frozen=True)
class RosterMember:
    """One currently-serving member as listed on the official roster PDF."""

    chamber: str  # "house" | "senate"
    district_code: str  # normalized to match District.code: "09A", "06"
    last_name: str
    first_name: str
    party: str  # "DFL" | "R"


@dataclass
class ReconcileReport:
    """Outcome of reconciling DB current members against the roster PDF."""

    pdf_total: int
    kept: int
    # (chamber, district_code, db_full_name) for members switched to not-current
    deactivated: list[tuple[str, str, str]]
    # (chamber, district_code, "Last, First") PDF seats with no kept DB match
    missing: list[tuple[str, str, str]]
    dry_run: bool

    def summary(self) -> str:
        verb = "would deactivate" if self.dry_run else "deactivated"
        lines = [
            f"Roster PDF: {self.pdf_total} members. "
            f"Kept {self.kept} current; {verb} {len(self.deactivated)}."
        ]
        for chamber, district, name in self.deactivated:
            lines.append(f"  - {verb.split()[-1]}: {chamber} {district}: {name}")
        for chamber, district, name in self.missing:
            lines.append(
                f"  ! missing DB member for {chamber} {district}: {name} "
                "(run the roster HTML scrape to add them)"
            )
        return "\n".join(lines)


def fetch_roster_pdf_text(
    url: str = DEFAULT_ROSTER_PDF_URL,
    *,
    session: requests.Session | None = None,
) -> str:
    """Download the roster PDF and extract its text via ``pdftotext -layout``.

    Mirrors the subprocess pattern already used for Senate journal PDFs in
    ``alethical/pipeline/votes.py``.
    """
    getter = session.get if session is not None else requests.get
    response = getter(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT_SECONDS)
    response.raise_for_status()
    with tempfile.TemporaryDirectory() as temp_dir:
        pdf_path = Path(temp_dir) / "memroster.pdf"
        pdf_path.write_bytes(response.content)
        result = subprocess.run(
            ["pdftotext", "-layout", str(pdf_path), "-"],
            check=True,
            capture_output=True,
            text=True,
        )
    return result.stdout


def _normalize_house_district(raw: str) -> str:
    """'9A' -> '09A' to match District.code (zero-padded, uppercase suffix)."""
    match = re.fullmatch(r"(\d{1,2})([AB])", raw)
    assert match is not None  # guaranteed by the regex that produced ``raw``
    return f"{int(match.group(1)):02d}{match.group(2)}"


def _normalize_senate_district(raw: str) -> str:
    """'6' -> '06' to match District.code (zero-padded)."""
    return f"{int(raw):02d}"


def _split_name(raw: str) -> tuple[str, str]:
    """'Johnson Stewart, Ann M.' -> ('Johnson Stewart', 'Ann M.')."""
    last, _, first = raw.partition(",")
    return last.strip(), first.strip()


def _parse_section(text: str, chamber: str) -> list[RosterMember]:
    pattern = _HOUSE_ENTRY if chamber == "house" else _SENATE_ENTRY
    normalize = (
        _normalize_house_district if chamber == "house" else _normalize_senate_district
    )
    members: list[RosterMember] = []
    for district, name, party in pattern.findall(text):
        last, first = _split_name(name)
        if not last:
            continue
        members.append(
            RosterMember(
                chamber=chamber,
                district_code=normalize(district),
                last_name=last,
                first_name=first,
                party=party,
            )
        )
    return members


def parse_roster_pdf(text: str) -> list[RosterMember]:
    """Parse ``pdftotext -layout`` output into the canonical member list."""
    house_start = text.find(_HOUSE_HEADER)
    senate_start = text.find(_SENATE_HEADER)
    grid_start = text.find(_GRID_HEADER)
    if house_start == -1 or senate_start == -1:
        raise ValueError(
            "Roster PDF text is missing the expected House/Senate section headers; "
            "the source layout may have changed."
        )
    grid_start = grid_start if grid_start != -1 else len(text)
    house_text = text[house_start:senate_start]
    senate_text = text[senate_start:grid_start]
    return _parse_section(house_text, "house") + _parse_section(senate_text, "senate")


def normalize_name_tokens(name: str) -> list[str]:
    """Fold a name to comparable tokens for cross-source matching.

    NFKD-decomposes and drops diacritics, lowercases, removes apostrophes
    (straight and curly) and hyphens (joining the parts), and splits on
    whitespace with punctuation stripped. So 'María Isa Pérez-Vega' and
    "O'Driscoll"/"O’Driscoll" fold consistently on both sides.
    """
    decomposed = unicodedata.normalize("NFKD", name)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    stripped = stripped.lower().replace("'", "").replace("’", "")
    stripped = stripped.replace("-", "")
    stripped = re.sub(r"[.,]", " ", stripped)
    return stripped.split()


def name_matches(pdf_last_name: str, db_full_name: str) -> bool:
    """True when the PDF surname is a contiguous trailing run of the DB name.

    Handles middle initials ('Roger J. Skraba'), suffixes, multi-word surnames
    ('Johnson Stewart', 'Vang Her') and hyphenated names ('Luger-Nikolai').
    Callers must scope this within a single (chamber, district) so short
    surnames like 'Lee' cannot collide across seats.
    """
    last_tokens = normalize_name_tokens(pdf_last_name)
    full_tokens = normalize_name_tokens(db_full_name)
    if not last_tokens or len(last_tokens) > len(full_tokens):
        return False
    return full_tokens[-len(last_tokens) :] == last_tokens
