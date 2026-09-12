"""Read Minnesota's yearly Political Contribution Refund summaries (#2147).

**What the program is.** A Minnesota resident who gives to a state candidate's principal
campaign committee or to a political party unit can claim the money back from the state,
up to $75 a year for one person and $150 for a married couple filing jointly. The
Campaign Finance Board publishes, once a year, two summaries of what it refunded: one
listing every candidate committee and one listing every party unit.

**They are published as PDFs and nothing else.** There is no CSV, no API and no data
download, unlike every other campaign-finance source in this package. So the figures are
read out of the printed page, which is why this module is mostly a parser and why it
refuses to guess: a row it cannot read is recorded as unread rather than dropped
(``ParsedFile.unreadable``), because a silently dropped row is a figure that goes missing
from a named person's page with nothing anywhere saying so.

**The links are resolved from the Board's own page on every run, never built from the
year.** Read 12 September 2026, the page links 2013, 2014, 2015 and 2017 through 2025.
Guessing the pattern would have produced a 2016 address that answers **HTTP 200** with the
Board's HTML shell whose only heading reads "This page is not available" -- the same
failure ``docs/architecture/campaign-finance-system-design.md`` §4.6 records against the
lobbying page behind our largest published figure. A status code decides nothing here
either: ``looks_like_refund_pdf`` reads the bytes.

**Six printed layouts across 12 years, and they disagree about more than spacing.** Every
one of these was measured on the Board's own files on 12 September 2026, and each is why a
line of this parser exists:

* **The columns swap order.** 2015 and 2017 print ``$amount`` then the count; every other
  candidate year prints the count then ``$amount``.
* **2024 publishes no count at all.** Its candidate rows carry an amount and a party and
  nothing else, and so do its section totals (``$640,431.28Party Total``). That is a fact
  about what Minnesota published, so ``contribution_count`` is nullable and a reader is
  told the count was not published rather than shown a 0
  (``.claude/rules/grounded-answers.md`` rule 12, missing versus zero).
* **2013 prints no cents**, in both files: ``$462``, not ``$462.00``. Stored as printed.
* **The party files run the amount and the count together** with no separator:
  ``1st Congressional District DFL $613.829`` is $613.82 across 9 contributions. The split
  is only unambiguous because the amount carries exactly 2 decimals, so a party row whose
  amount has no cents (2013's whole file) is read the other way round -- there the count
  is printed *before* the amount, separated by a space.
* **The separators are not ASCII.** 2015 and 2017 use a no-break space (U+00A0) between
  every word, and 2013 through 2017 use a non-breaking hyphen (U+2010) in ``House ‐ 45B``.
  Normalising those is what took 2015 and 2017 from 0 parsed rows to all of them.
* **A party code can run into the amount**: ``Senate - 47 66 $4,640.85DFL``.

**Why the office is matched before the count, and not after.** A seat ends in a number, so
"Abeler, Jim Senate - 35 $10,508.22 RPM" read right-to-left gives a count of 35 and a
district of nothing. The office is therefore matched first, against the closed set of
offices these files actually print, and only what is left between the office and the
amount can be a count. The closed set is House and Senate seats plus Attorney General,
Governor, Secretary of State and State Auditor; a row whose office is none of those is
recorded as unreadable rather than guessed at.
"""

from __future__ import annotations

import gzip
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Iterable, Optional

import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline.raw_file_store import sha256_of_file

# The two files the Board publishes each year.
CANDIDATE = "candidate"
PARTY_UNIT = "party_unit"

REFUND_INDEX_URL = (
    "https://cfb.mn.gov/citizen-resources/board-programs/public-subsidy-of-campaigns/"
    "historical-use-of-public-subsidy-program/"
)
CFB_ORIGIN = "https://cfb.mn.gov"

# What the Board's own file names call each kind, inside the linked address.
_KIND_BY_SUFFIX = {"cand": CANDIDATE, "party": PARTY_UNIT}

# ``/pdf/publications/public_subsidy/historical/2025_refunds_cand.pdf``. Anchored on the
# file name rather than the folder, so a reorganised path still resolves.
_LINK = re.compile(
    r'href="(?P<href>[^"]*?/(?P<year>(?:19|20)\d{2})_refunds_(?P<suffix>cand|party)\.pdf)"',
    re.IGNORECASE,
)

# Every character these files use where ASCII would use a space or a hyphen. Normalised
# before anything is matched: 2015's and 2017's rows are separated by U+00A0 throughout,
# and the seat separator is U+2010 in every file before 2018.
_SPACES = "\xa0    "
_DASHES = "‐‑‒–—−"
_NORMALISE = {ord(c): " " for c in _SPACES} | {ord(c): "-" for c in _DASHES}

# A money figure exactly as printed: thousands separated by commas, cents optional
# because 2013 prints none.
_MONEY = r"\$(?P<amount>\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)"

# The offices these files print. The district is **optional**, because 9 rows of the 2021
# candidate summary print a chamber with no district at all ("Hemmingsen-Jaeger, Amand
# House 1 $50.00"). Those 9 rows are real money -- they are exactly the $1,000 and 15
# contributions by which that file's own section totals exceed the rows we could
# otherwise read -- so dropping them would lose real money, while inventing a district for
# them would break the identity rule. They are kept with no district, which means they can
# never match a confirmed committee, which is the honest outcome.
#
# The district's letter is matched in either case: 2023 prints "House - 50a".
_SEAT = r"(?:House|Senate)(?:\s*-\s*\d{1,2}\s*[ABab]?)?"
_STATEWIDE = r"(?:Attorney General|Secretary of State|State Auditor|Governor)"
_OFFICE = re.compile(rf"(?P<office>{_SEAT}|{_STATEWIDE})\s*$")
_SEAT_PARTS = re.compile(
    r"^(?P<chamber>House|Senate)(?:\s*-\s*(?P<district>\d{1,2}\s*[ABab]?))?$"
)

# pypdf splits a word where the PDF kerned it, so "Senate" reaches us as "Senat e" in the
# 2013 file (and the Note line reads "re ported" in several years). Repaired only where
# the next characters are an office's own -- a dash or a number -- so nothing else in a
# line can be glued together by accident.
_SPLIT_OFFICE_WORD = re.compile(
    r"\b(?P<word>H\s?o\s?u\s?s\s?e|S\s?e\s?n\s?a\s?t\s?e)(?=\s*-|\s+\d)"
)

# The file printed the amount as hash characters because the number was wider than its
# column. The figure is genuinely not in the file, so the row is recorded as unreadable
# and no amount is guessed at from the totals around it.
_OVERFLOWED = re.compile(r"##+")

# A party code as printed at the end of a 2024 or 2025 candidate row, or as a section
# heading. Letters only, so it can never swallow a figure.
_PARTY_CODE = re.compile(r"^[A-Za-z][A-Za-z.\-]{0,14}$")

# Lines that are furniture rather than data. Matched on the normalised line.
_TITLE = re.compile(r"Contribution Refund Summary for", re.IGNORECASE)
_NOTE = re.compile(r"^Note:", re.IGNORECASE)
_COLUMN_HEADING = re.compile(
    r"^(?:Candidate Name|Party Units|Office Sought|Contributions?|Refunded"
    r"|Refunded Amount|Refund|Contribution Number|Amount|Party)\b",
    re.IGNORECASE,
)
_PAGE_NUMBER = re.compile(r"^(?:Page\s+)?\d{1,3}(?:\s+of\s+\d{1,3})?$", re.IGNORECASE)

# A printed total. The Board writes 4 different words for one idea -- "Subtotals:",
# "Party Total", "Grand Total", "Grand Totals:" -- and runs each of them onto the amount
# with no space. ``scope`` separates a section's own total from the file's.
#
# The label is optional because the candidate summaries from 2013 to 2018 print their
# section totals with no word at all, as a bare "7,109 $462,465" on its own line. Such a
# line cannot be a data row: every data row carries a name.
_TOTAL = re.compile(
    rf"^(?:(?P<count>\d{{1,3}}(?:,\d{{3}})*|\d+)\s+)?{_MONEY}\s*"
    r"(?P<label>Sub\s*totals?:?|Party\s+Totals?:?|Grand\s+Totals?:?|Totals?:?)?\s*$",
    re.IGNORECASE,
)


def normalise(text: str) -> str:
    """Put a line into ASCII spacing and repair a split office word.

    Everything else is left exactly as printed.
    """
    flattened = text.translate(_NORMALISE)
    return _SPLIT_OFFICE_WORD.sub(
        lambda match: re.sub(r"\s+", "", match.group("word")), flattened
    )


def looks_like_refund_pdf(body: bytes) -> bool:
    """Whether these bytes are a PDF at all.

    A status code decides nothing (``docs/architecture/campaign-finance-system-design.md``
    §4.6). The 2016 addresses answer 200 with 30 KB of the Board's HTML shell whose only
    heading reads "This page is not available", so the bytes are what is asked.
    """
    return body.startswith(b"%PDF")


@dataclass(frozen=True)
class RefundFileLink:
    """One refund summary the Board's page links, as that page links it."""

    year: int
    kind: str
    url: str


def resolve_refund_files(index_html: str) -> list[RefundFileLink]:
    """Every refund summary the Board's own page links, in year then kind order.

    Resolved from the page rather than built from the year, because the set of published
    years is the Board's to decide and has a hole in it: 2016 is linked nowhere, and its
    guessable address answers 200 with an error page.
    """
    found: dict[tuple[int, str], str] = {}
    for match in _LINK.finditer(index_html):
        href = match.group("href")
        url = href if href.startswith("http") else CFB_ORIGIN + href
        key = (int(match.group("year")), _KIND_BY_SUFFIX[match.group("suffix").lower()])
        found.setdefault(key, url)
    return [
        RefundFileLink(year=year, kind=kind, url=url)
        for (year, kind), url in sorted(found.items())
    ]


@dataclass(frozen=True)
class RefundRow:
    """One printed line of a refund summary, stored as printed.

    ``contribution_count`` is ``None`` where the file published no count -- the whole 2024
    candidate summary -- and that is never turned into 0.
    """

    row_number: int
    page_number: int
    printed_name: str
    office_sought: Optional[str]
    office: Optional[str]
    district: Optional[str]
    party: Optional[str]
    contribution_count: Optional[int]
    refunded_amount: Decimal
    section_heading: Optional[str]
    printed_line: str


@dataclass(frozen=True)
class RefundTotal:
    """A total the file itself printed, for checking our own rows against."""

    scope: str  # "section" | "file"
    label: str
    section_heading: Optional[str]
    contribution_count: Optional[int]
    refunded_amount: Decimal
    page_number: int


@dataclass(frozen=True)
class UnreadableLine:
    """A line that carried a money figure and could not be read.

    Kept rather than dropped: a row that vanishes silently is a figure missing from a
    named person's page with nothing saying so.
    """

    page_number: int
    printed_line: str
    reason: str


@dataclass
class ParsedFile:
    year: int
    kind: str
    page_count: int
    rows: list[RefundRow] = field(default_factory=list)
    totals: list[RefundTotal] = field(default_factory=list)
    unreadable: list[UnreadableLine] = field(default_factory=list)

    @property
    def amount_total(self) -> Decimal:
        return sum((row.refunded_amount for row in self.rows), Decimal("0"))


def _money(raw: str) -> Decimal:
    return Decimal(raw.replace(",", ""))


def _count(raw: str | None) -> Optional[int]:
    return None if raw is None else int(raw.replace(",", ""))


def _is_furniture(line: str) -> bool:
    return bool(
        _TITLE.search(line)
        or _NOTE.match(line)
        or _COLUMN_HEADING.match(line)
        or _PAGE_NUMBER.match(line)
    )


def _split_seat(office: str) -> tuple[Optional[str], Optional[str]]:
    """ "Senate -  3" becomes ("Senate", "3"); a statewide office keeps itself and no district.

    The district's letter is upper-cased, because 2023 prints "House - 50a" for a seat
    every other file in the set prints as "50A". That is the printer's slip rather than a
    different district, and the line exactly as printed is kept on the row beside it
    (``office_sought``), so nothing is lost by matching on the settled form.
    """
    collapsed = re.sub(r"\s+", " ", office).strip()
    parts = _SEAT_PARTS.match(collapsed)
    if parts is None:
        return collapsed, None
    district = parts.group("district")
    return parts.group("chamber"), (
        None if district is None else re.sub(r"\s+", "", district).upper()
    )


def _match_total(
    line: str, page_number: int, heading: Optional[str]
) -> Optional[RefundTotal]:
    match = _TOTAL.match(line)
    if match is None:
        return None
    label = re.sub(r"\s+", " ", match.group("label") or "").strip()
    scope = "file" if label.lower().startswith("grand") else "section"
    return RefundTotal(
        scope=scope,
        label=label,
        section_heading=None if scope == "file" else heading,
        contribution_count=_count(match.group("count")),
        refunded_amount=_money(match.group("amount")),
        page_number=page_number,
    )


def _trailing_count(text: str) -> tuple[str, Optional[int]]:
    """Take an integer off the end of ``text`` if one is there."""
    match = re.search(r"\s(\d{1,3}(?:,\d{3})*|\d{1,6})$", text)
    if match is None:
        return text, None
    return text[: match.start()].rstrip(), _count(match.group(1))


def _split_after(after: str) -> tuple[Optional[int], Optional[str], bool]:
    """Read what follows the amount: a count, a party code, both, or neither.

    The third value says the tail was not understood. A party code can run straight into
    the amount with no space (``$4,640.85DFL``), which is why the count is required to be
    separated from the letters rather than merely to precede them.
    """
    tail = after.strip()
    if not tail:
        return None, None, False
    match = re.fullmatch(
        r"(?:(?P<count>\d{1,3}(?:,\d{3})*|\d{1,6})\s*)?(?P<party>[A-Za-z][A-Za-z.\-]{0,14})?",
        tail,
    )
    if match is None or (match.group("count") is None and match.group("party") is None):
        return None, None, True
    return _count(match.group("count")), match.group("party"), False


def parse_candidate_pages(pages: Iterable[str], *, year: int) -> ParsedFile:
    """Read one year's candidate-committee refund summary out of its printed pages.

    ``pages`` is the text of each page in order, as extracted from the PDF. Kept separate
    from the PDF reading so the layouts above can be tested as text, which is what the
    fixtures in ``alethical/tests/test_campaign_finance_refunds.py`` hold.
    """
    parsed = ParsedFile(year=year, kind=CANDIDATE, page_count=0)
    heading: Optional[str] = None
    row_number = 0
    for page_number, page_text in enumerate(pages, start=1):
        parsed.page_count = page_number
        for raw_line in (page_text or "").split("\n"):
            line = re.sub(r"[ \t]+", " ", normalise(raw_line)).strip()
            if not line or _is_furniture(line):
                continue
            total = _match_total(line, page_number, heading)
            if total is not None:
                parsed.totals.append(total)
                continue
            if _OVERFLOWED.search(line):
                parsed.unreadable.append(
                    UnreadableLine(
                        page_number,
                        line,
                        "the file printed the amount as # characters, too wide for its column",
                    )
                )
                continue
            if "$" not in line:
                # A party section heading: "DFL", "RPM", "Other". Anything else with no
                # money on it is furniture we have not seen and is worth reporting.
                if _PARTY_CODE.match(line) or len(line.split()) <= 6:
                    heading = line
                else:
                    parsed.unreadable.append(
                        UnreadableLine(
                            page_number, line, "no money figure and not a heading"
                        )
                    )
                continue
            money = re.search(_MONEY, line)
            if money is None or line.count("$") != 1:
                parsed.unreadable.append(
                    UnreadableLine(
                        page_number, line, "expected exactly one money figure"
                    )
                )
                continue
            before = line[: money.start()].strip()
            after_count, party, tail_unread = _split_after(line[money.end() :])
            if tail_unread:
                parsed.unreadable.append(
                    UnreadableLine(
                        page_number, line, "could not read what follows the amount"
                    )
                )
                continue
            # The office is matched before any count is taken off, because a seat ends in
            # a number: "Abeler, Jim Senate - 35" read right-to-left gives a count of 35.
            office_match = _OFFICE.search(before)
            before_count: Optional[int] = None
            if office_match is None:
                before, before_count = _trailing_count(before)
                office_match = _OFFICE.search(before)
            if office_match is None:
                parsed.unreadable.append(
                    UnreadableLine(page_number, line, "no office this parser knows")
                )
                continue
            if before_count is not None and after_count is not None:
                parsed.unreadable.append(
                    UnreadableLine(
                        page_number, line, "a count on both sides of the amount"
                    )
                )
                continue
            name = before[: office_match.start()].strip()
            if not name:
                parsed.unreadable.append(
                    UnreadableLine(page_number, line, "no candidate name")
                )
                continue
            office_sought = re.sub(r"\s+", " ", office_match.group("office")).strip()
            office, district = _split_seat(office_sought)
            row_number += 1
            parsed.rows.append(
                RefundRow(
                    row_number=row_number,
                    page_number=page_number,
                    printed_name=name,
                    office_sought=office_sought,
                    office=office,
                    district=district,
                    # The row's own party code where the file prints one (2024, 2025),
                    # otherwise the heading its section sits under. Both are the file's
                    # own claim about this row.
                    party=party or heading,
                    contribution_count=before_count
                    if after_count is None
                    else after_count,
                    refunded_amount=_money(money.group("amount")),
                    section_heading=heading,
                    printed_line=line,
                )
            )
    return parsed


def parse_party_unit_pages(pages: Iterable[str], *, year: int) -> ParsedFile:
    """Read one year's party-unit refund summary out of its printed pages.

    The amount and the count are printed with no separator between them
    (``$613.829`` is $613.82 across 9 contributions), which is readable only because the
    amount carries exactly 2 decimals. 2013 prints no cents and puts the count first
    instead, so a run-together tail on an amount with no cents is genuinely ambiguous and
    is recorded as unreadable rather than split on a guess.
    """
    parsed = ParsedFile(year=year, kind=PARTY_UNIT, page_count=0)
    heading: Optional[str] = None
    row_number = 0
    for page_number, page_text in enumerate(pages, start=1):
        parsed.page_count = page_number
        for raw_line in (page_text or "").split("\n"):
            line = re.sub(r"[ \t]+", " ", normalise(raw_line)).strip()
            if not line or _is_furniture(line):
                continue
            total = _match_total(line, page_number, heading)
            if total is not None:
                parsed.totals.append(total)
                continue
            if _OVERFLOWED.search(line):
                parsed.unreadable.append(
                    UnreadableLine(
                        page_number,
                        line,
                        "the file printed the amount as # characters, too wide for its column",
                    )
                )
                continue
            if "$" not in line:
                heading = line
                continue
            money = re.search(_MONEY, line)
            if money is None or line.count("$") != 1:
                parsed.unreadable.append(
                    UnreadableLine(
                        page_number, line, "expected exactly one money figure"
                    )
                )
                continue
            amount_text = money.group("amount")
            name = line[: money.start()].strip()
            tail = line[money.end() :].strip()
            count: Optional[int] = None
            if tail:
                if not tail.isdigit():
                    parsed.unreadable.append(
                        UnreadableLine(
                            page_number, line, "could not read what follows the amount"
                        )
                    )
                    continue
                if "." not in amount_text:
                    parsed.unreadable.append(
                        UnreadableLine(
                            page_number,
                            line,
                            "amount has no cents, so the digits after it could be either",
                        )
                    )
                    continue
                count = int(tail)
            else:
                name, count = _trailing_count(name)
            if not name:
                parsed.unreadable.append(
                    UnreadableLine(page_number, line, "no party unit name")
                )
                continue
            row_number += 1
            parsed.rows.append(
                RefundRow(
                    row_number=row_number,
                    page_number=page_number,
                    printed_name=name,
                    office_sought=None,
                    office=None,
                    district=None,
                    party=heading,
                    contribution_count=count,
                    refunded_amount=_money(amount_text),
                    section_heading=heading,
                    printed_line=line,
                )
            )
    return parsed


def parse_pages(pages: Iterable[str], *, year: int, kind: str) -> ParsedFile:
    if kind == CANDIDATE:
        return parse_candidate_pages(pages, year=year)
    if kind == PARTY_UNIT:
        return parse_party_unit_pages(pages, year=year)
    raise ValueError(f"unknown refund summary kind: {kind!r}")


def extract_pages(pdf_bytes: bytes) -> list[str]:
    """The text of each page of a refund summary PDF, in order."""
    import io

    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    return [page.extract_text() or "" for page in reader.pages]


def source_note_metadata(pages: list[str]) -> dict:
    """Record a printed note, not an inferred rule about how Minnesota counts.

    The exact sentence appears in the Board's 2024 and 2025 candidate PDFs.
    False means the complete readable text carries no such note; it does not assert
    that joint returns are counted separately. Incomplete or unfamiliar text is unknown.
    """
    sentence = "Contributions from a married couple filing jointly are reported as one contribution"
    for page_number, page in enumerate(pages, 1):
        flattened = " ".join(normalise(page).split())
        # The older PDFs split this exact word as "re ported" when text is extracted.
        pattern = re.escape(sentence).replace("reported", r"re\s*ported")
        match = re.search(pattern, flattened, re.I)
        if match:
            return {
                "joint_filing_counts_as_one": True,
                "joint_filing_note": match.group(0),
                "joint_filing_note_page": page_number,
            }
    text = " ".join(" ".join(normalise(page).split()) for page in pages)
    complete = bool(pages) and all(page.strip() for page in pages)
    familiar = bool(
        re.search(
            r"Contribution Refund Summary for (?:Candidate|Principal Campaign|Political Party)",
            text,
            re.I,
        )
    )
    ambiguous = bool(re.search(r"married|jointly|joint filing", text, re.I))
    return {
        "joint_filing_counts_as_one": False
        if complete and familiar and not ambiguous
        else None,
        "joint_filing_note": None,
        "joint_filing_note_page": None,
    }


def _source_metadata(pages: list[str], index_url: Optional[str]) -> dict:
    return {"source_url": index_url, **source_note_metadata(pages)}


# --- Checking a file before anything of it is published ------------------------------
#
# Four checks, and what separates them is who the disagreement belongs to. A section
# total that disagrees with the rows printed under it means **we misread the file**, and
# that quarantines it. A grand total that disagrees with the sum of the file's own
# sections means **Minnesota's file disagrees with itself**, which is a fact to record
# rather than a reason to throw the file away. Conflating the 2 would either publish our
# own parsing mistakes or refuse to publish Minnesota's.

OK = "ok"
FAILED = "failed"
SKIPPED = "skipped"
RECORDED = "recorded"

# How far a year's row count may sit from the nearest earlier year we hold, before the
# run stops and asks for a person. Wide on purpose, and the width is measured rather than
# guessed: across the 11 year-on-year steps in the candidate summaries the ratio runs from
# 0.56 to 1.73, because an election year lists far more candidates than the year after it.
# A band tight enough to catch that swing would fire every other year; this one still
# catches the failure it is for, which is a layout change silently reading 0 rows or 10
# times too many.
ROW_COUNT_BAND = (0.4, 2.5)


@dataclass(frozen=True)
class Check:
    name: str
    status: str
    detail: str

    @property
    def blocks_publishing(self) -> bool:
        return self.status == FAILED


def prints_cents(parsed: ParsedFile) -> bool:
    """Whether this file printed cents at all.

    The 2013 files print whole dollars, so the sum of their rows cannot equal their
    printed total and a check demanding equality would quarantine a file that was read
    perfectly. ``Decimal`` keeps the printed scale, so this is read off the figures
    themselves rather than off the year.
    """
    amounts = [row.refunded_amount for row in parsed.rows]
    return bool(amounts) and all(amount.as_tuple().exponent == -2 for amount in amounts)


def _section_sums(parsed: ParsedFile) -> dict[Optional[str], tuple[Decimal, int, int]]:
    """Per section: the amount, the count, and how many rows published no count."""
    sums: dict[Optional[str], tuple[Decimal, int, int]] = {}
    for row in parsed.rows:
        amount, count, missing = sums.get(row.section_heading, (Decimal("0"), 0, 0))
        sums[row.section_heading] = (
            amount + row.refunded_amount,
            count + (row.contribution_count or 0),
            missing + (1 if row.contribution_count is None else 0),
        )
    return sums


def _unreadable_sections(parsed: ParsedFile) -> set[Optional[str]]:
    """Sections holding a line we could not read, whose totals therefore cannot be checked."""
    if not parsed.unreadable:
        return set()
    # An unreadable line's own section is not recoverable from the line itself, so any
    # unreadable line puts every section total beyond checking. Blunt on purpose: a
    # narrower rule would have to guess which section a line it could not read sits in.
    return set(_section_sums(parsed)) | {None}


def validate(
    parsed: ParsedFile, *, previous_row_count: Optional[int] = None
) -> list[Check]:
    """Every check one refund summary is put through, and what each one answered."""
    checks: list[Check] = []
    cents = prints_cents(parsed)
    sums = _section_sums(parsed)
    beyond_checking = _unreadable_sections(parsed)

    if not parsed.rows:
        checks.append(Check("rows_found", FAILED, "the file yielded no rows at all"))
        return checks
    checks.append(Check("rows_found", OK, f"{len(parsed.rows)} rows read"))

    if parsed.unreadable:
        checks.append(
            Check(
                "every_line_read",
                RECORDED,
                "; ".join(
                    f"page {line.page_number}: {line.reason} -- {line.printed_line}"
                    for line in parsed.unreadable
                ),
            )
        )
    else:
        checks.append(
            Check("every_line_read", OK, "every line carrying money was read")
        )

    sections = [total for total in parsed.totals if total.scope == "section"]
    if not sections:
        checks.append(
            Check("section_totals", SKIPPED, "the file prints no section totals")
        )
    else:
        problems: list[str] = []
        compared = 0
        for total in sections:
            if total.section_heading in beyond_checking:
                continue
            got = sums.get(total.section_heading)
            if got is None:
                problems.append(f"{total.section_heading!r} has a total and no rows")
                continue
            amount, count, missing_counts = got
            if cents and amount != total.refunded_amount:
                problems.append(
                    f"{total.section_heading!r} prints {total.refunded_amount} "
                    f"and its rows come to {amount}"
                )
            if total.contribution_count is not None and missing_counts == 0:
                if count != total.contribution_count:
                    problems.append(
                        f"{total.section_heading!r} prints {total.contribution_count} "
                        f"contributions and its rows come to {count}"
                    )
            compared += 1
        if problems:
            checks.append(Check("section_totals", FAILED, "; ".join(problems)))
        elif compared == 0:
            checks.append(
                Check(
                    "section_totals",
                    SKIPPED,
                    "every section holds a line the file printed unreadably",
                )
            )
        else:
            checks.append(
                Check(
                    "section_totals",
                    OK,
                    f"{compared} section total(s) agree with the rows printed under them"
                    + ("" if cents else "; amounts skipped, this file prints no cents"),
                )
            )

    file_totals = [total for total in parsed.totals if total.scope == "file"]
    if not file_totals:
        checks.append(Check("file_total", SKIPPED, "the file prints no grand total"))
    elif parsed.unreadable:
        checks.append(
            Check(
                "file_total",
                SKIPPED,
                "the file printed a line unreadably, so its grand total cannot be checked",
            )
        )
    else:
        printed = file_totals[-1]
        ours = parsed.amount_total
        our_count = sum(row.contribution_count or 0 for row in parsed.rows)
        missing_counts = any(row.contribution_count is None for row in parsed.rows)
        disagreements: list[str] = []
        if cents and printed.refunded_amount != ours:
            disagreements.append(f"prints {printed.refunded_amount} against our {ours}")
        if (
            printed.contribution_count is not None
            and not missing_counts
            and printed.contribution_count != our_count
        ):
            disagreements.append(
                f"prints {printed.contribution_count} contributions against our {our_count}"
            )
        if not disagreements:
            checks.append(
                Check(
                    "file_total",
                    OK,
                    "the grand total agrees with our rows"
                    + ("" if cents else "; amounts skipped, this file prints no cents"),
                )
            )
        else:
            # Does the file disagree with itself? If every section total agrees with our
            # rows and the sections do not add up to the grand total, the inconsistency is
            # Minnesota's and the file is still worth publishing. The 2022 candidate
            # summary is exactly this: its grand total is $200 and 2 contributions larger
            # than the sum of its own 5 section totals, which our rows match to the cent.
            section_amount = sum(
                (total.refunded_amount for total in sections), Decimal("0")
            )
            sections_agree = bool(sections) and all(
                check.status == OK for check in checks if check.name == "section_totals"
            )
            if sections_agree and section_amount == ours:
                checks.append(
                    Check(
                        "file_total",
                        RECORDED,
                        "the file's own grand total disagrees with the sum of its own "
                        "sections, which our rows match: " + "; ".join(disagreements),
                    )
                )
            else:
                checks.append(Check("file_total", FAILED, "; ".join(disagreements)))

    if previous_row_count is None:
        checks.append(
            Check("row_count_band", SKIPPED, "no earlier year of this kind is held")
        )
    else:
        low = previous_row_count * ROW_COUNT_BAND[0]
        high = previous_row_count * ROW_COUNT_BAND[1]
        detail = (
            f"{len(parsed.rows)} rows against {previous_row_count} in the nearest "
            f"earlier year held, band {low:.0f} to {high:.0f}"
        )
        checks.append(
            Check(
                "row_count_band",
                OK if low <= len(parsed.rows) <= high else FAILED,
                detail,
            )
        )
    return checks


# --- Identity: which rows reach a person's page --------------------------------------

# The 3 answers stored on a row, in the vocabulary the confirmation block already serves
# (``CommitteeMatchCheck`` in ``alethical/api/services/legislator_finance.py``).
NAME_EXACT = "exact"
NAME_DIFFERS = "differs"
SEAT_AGREES = "office_and_district_agree"
SEAT_DIFFERS = "office_or_district_differs"
PARTY_AGREES = "agrees"
PARTY_DIFFERS = "differs"


@dataclass(frozen=True)
class RegisteredCandidate:
    """One confirmed committee as the registered-filer directory describes it."""

    registration_number: str
    candidate_name: Optional[str]
    party: Optional[str]
    office: Optional[str]
    district: Optional[str]


@dataclass(frozen=True)
class RowMatch:
    """What the identity check decided about one refund row, and on what basis."""

    registration_number: Optional[str]
    name_evidence: str
    register_verdict: str
    party_agreement: str

    @property
    def attached(self) -> bool:
        return self.registration_number is not None


def match_row(row: RefundRow, register: Iterable[RegisteredCandidate]) -> RowMatch:
    """Attach a refund row to a confirmed committee, or to nothing.

    A refund row names a candidate and an office and **never a registration number**, so
    the only honest route to a person is through a committee somebody has already
    confirmed as theirs. All 3 of these must agree with that committee's row in the
    registered-filer directory:

    * the printed name equals the register's candidate name, character for character;
    * the office and the district both equal the register's;
    * the party equals the register's.

    Anything less stays unattached. There is deliberately no scoring, no threshold and no
    fuzzy matching: a wrong link publishes one person's money under another person's
    photograph, and the design record measured that nothing downstream would ever catch it
    (``docs/architecture/campaign-finance-system-design.md`` §5.1).
    """
    best = RowMatch(None, NAME_DIFFERS, SEAT_DIFFERS, PARTY_DIFFERS)
    for filer in register:
        name_evidence = (
            NAME_EXACT
            if filer.candidate_name is not None
            and row.printed_name == filer.candidate_name
            else NAME_DIFFERS
        )
        seat = (
            SEAT_AGREES
            if row.office == filer.office and row.district == filer.district
            else SEAT_DIFFERS
        )
        party = (
            PARTY_AGREES
            if row.party is not None and row.party == filer.party
            else PARTY_DIFFERS
        )
        if (
            name_evidence == NAME_EXACT
            and seat == SEAT_AGREES
            and party == PARTY_AGREES
        ):
            return RowMatch(filer.registration_number, name_evidence, seat, party)
        # Keep the nearest near-miss so an unattached row can say which of the 3 failed,
        # rather than only that it did.
        agreements = sum(
            1
            for value, wanted in (
                (name_evidence, NAME_EXACT),
                (seat, SEAT_AGREES),
                (party, PARTY_AGREES),
            )
            if value == wanted
        )
        current = sum(
            1
            for value, wanted in (
                (best.name_evidence, NAME_EXACT),
                (best.register_verdict, SEAT_AGREES),
                (best.party_agreement, PARTY_AGREES),
            )
            if value == wanted
        )
        if agreements > current:
            best = RowMatch(None, name_evidence, seat, party)
    return best


# --- Loading ------------------------------------------------------------------------

USER_AGENT = "Alethical Minnesota Ingest/0.1"
REQUEST_TIMEOUT_SECONDS = 60
# The Board's site is a shared public resource and this run makes at most a few dozen
# requests, so it is paced rather than parallelised.
REQUEST_SPACING_SECONDS = 0.25
# Years probed for a file the index page does not link, so "the Board published nothing"
# is an answer we asked for rather than one we assumed. 2013 is the earliest year the page
# has ever linked; the upper end is this year.
FIRST_PUBLISHED_YEAR = 2013


def object_key(kind: str, content_hash: str) -> str:
    """Where one refund summary's bytes live in the store.

    A sixth kind of stored body under the one retention rule §4.5 sets: content-addressed,
    gzipped with ``mtime=0``, read back and hashed before the row that names it exists,
    and never deleted from either store.
    """
    folder = "candidate" if kind == CANDIDATE else "party-unit"
    return f"campaign-finance/refund-summary/{folder}/{content_hash}.pdf.gz"


@dataclass
class FetchedFile:
    link: RefundFileLink
    status_code: int
    media_type: Optional[str]
    body: bytes
    started_at: datetime
    completed_at: datetime

    @property
    def is_document(self) -> bool:
        return self.status_code == 200 and looks_like_refund_pdf(self.body)


@dataclass
class FileOutcome:
    link: RefundFileLink
    parsed: Optional[ParsedFile] = None
    checks: list[Check] = field(default_factory=list)
    summary_id: Optional[uuid.UUID] = None
    published: bool = False
    reused: bool = False
    not_published_reason: Optional[str] = None
    unavailable_reason: Optional[str] = None
    attached_rows: int = 0
    unattached_rows: int = 0

    @property
    def blocked(self) -> bool:
        return any(check.blocks_publishing for check in self.checks)


@dataclass
class LoadReport:
    outcomes: list[FileOutcome] = field(default_factory=list)
    not_published: list[tuple[int, str, str]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def published_count(self) -> int:
        return sum(1 for outcome in self.outcomes if outcome.published)


def fetch_file(http: requests.Session, link: RefundFileLink) -> FetchedFile:
    started = datetime.now(UTC)
    response = http.get(link.url, timeout=REQUEST_TIMEOUT_SECONDS)
    return FetchedFile(
        link=link,
        status_code=response.status_code,
        media_type=(response.headers.get("Content-Type") or None),
        body=response.content,
        started_at=started,
        completed_at=datetime.now(UTC),
    )


def http_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def registered_candidates(
    db: Session, *, registration_numbers: Iterable[str]
) -> tuple[Optional[uuid.UUID], list[RegisteredCandidate]]:
    """The register's own description of each confirmed committee.

    Read from the newest filings snapshot, because that is the set ``cf_filer`` is keyed
    to and it is replaced on every filings run. A committee with no row in it yields
    nothing, so its refund rows stay unattached rather than matching on 2 fields out of 3.
    """
    wanted = list(registration_numbers)
    if not wanted:
        return None, []
    newest = db.execute(
        select(schema.CampaignFinanceFilingSnapshot.id)
        .order_by(schema.CampaignFinanceFilingSnapshot.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if newest is None:
        return None, []
    rows = db.execute(
        select(
            schema.CampaignFinanceFiler.registration_number,
            schema.CampaignFinanceFiler.candidate_name,
            schema.CampaignFinanceFiler.party,
            schema.CampaignFinanceFiler.office,
            schema.CampaignFinanceFiler.district,
        ).where(
            schema.CampaignFinanceFiler.snapshot_id == newest,
            schema.CampaignFinanceFiler.registration_number.in_(wanted),
        )
    ).all()
    return newest, [
        RegisteredCandidate(
            registration_number=row[0],
            candidate_name=row[1],
            party=row[2],
            office=row[3],
            district=row[4],
        )
        for row in rows
    ]


def confirmed_registration_numbers(db: Session) -> list[str]:
    """Every committee a person has confirmed as some legislator's.

    ``decision == confirmed`` only, so a withdrawn confirmation takes its committee's
    refund rows off that person's page in the same statement (§5.1).
    """
    return list(
        db.execute(
            select(schema.LegislatorCampaignCommittee.registration_number).where(
                schema.LegislatorCampaignCommittee.decision
                == schema.CommitteeLinkReviewDecision.confirmed
            )
        )
        .scalars()
        .all()
    )


def match_summary_rows(
    db: Session, summary_id: uuid.UUID, *, log=print
) -> tuple[int, int]:
    """Re-run the identity check over one stored summary's rows.

    Separate from the load and re-runnable, because the 2 things it reads both move on
    their own: a committee is confirmed by a person days after a file is loaded, and the
    registered-filer directory is replaced by every filings run. A match is therefore a
    fact about a moment, and the snapshot it read is stored beside it.
    """
    numbers = confirmed_registration_numbers(db)
    filing_snapshot_id, register = registered_candidates(
        db, registration_numbers=numbers
    )
    rows = (
        db.execute(
            select(schema.CampaignFinanceRefundRow).where(
                schema.CampaignFinanceRefundRow.summary_id == summary_id
            )
        )
        .scalars()
        .all()
    )
    now = datetime.now(UTC)
    attached = unattached = 0
    for stored in rows:
        candidate = RefundRow(
            row_number=stored.row_number,
            page_number=stored.page_number,
            printed_name=stored.printed_name,
            office_sought=stored.office_sought,
            office=stored.office,
            district=stored.district,
            party=stored.party,
            contribution_count=stored.contribution_count,
            refunded_amount=stored.refunded_amount,
            section_heading=stored.section_heading,
            printed_line=stored.printed_line,
        )
        verdict = match_row(candidate, register)
        stored.matched_registration_number = verdict.registration_number
        stored.name_evidence = verdict.name_evidence
        stored.register_verdict = verdict.register_verdict
        stored.party_agreement = verdict.party_agreement
        stored.matched_against_filing_snapshot_id = filing_snapshot_id
        stored.matched_at = now
        if verdict.attached:
            attached += 1
        else:
            unattached += 1
    db.flush()
    log(f"    matched {attached} row(s) to a confirmed committee, {unattached} not")
    return attached, unattached


def _hash_bytes(body: bytes) -> str:
    import hashlib

    return hashlib.sha256(body).hexdigest()


def _store_from_env():
    from alethical.pipeline.raw_file_store import raw_file_store_from_env

    return raw_file_store_from_env()


def _gzip_bytes(body: bytes, directory: str, name: str) -> tuple[str, str, int]:
    """Write the bytes and their gzip beside each other, and hash the gzip.

    ``mtime=0`` and ``filename=""`` for the same reason every other body here carries
    them: without both, compressing identical input twice produces different bytes, and an
    unchanged file then looks like a new one (``campaign_finance.gzip_to``).
    """
    raw_path = os.path.join(directory, name)
    with open(raw_path, "wb") as handle:
        handle.write(body)
    compressed_path = raw_path + ".gz"
    with (
        open(raw_path, "rb") as source,
        open(compressed_path, "wb") as target,
        gzip.GzipFile(fileobj=target, mode="wb", mtime=0, filename="") as compressed,
    ):
        shutil.copyfileobj(source, compressed)
    return (
        compressed_path,
        sha256_of_file(compressed_path),
        os.path.getsize(compressed_path),
    )


def _previous_row_count(db: Session, *, year: int, kind: str) -> Optional[int]:
    """Rows in the nearest earlier year of this kind we hold.

    The nearest earlier year rather than ``year - 1``, because the Board published nothing
    for 2016 and a band measured against a year that does not exist is no band at all.
    """
    return db.execute(
        select(schema.CampaignFinanceRefundSummary.row_count)
        .where(
            schema.CampaignFinanceRefundSummary.kind
            == schema.CampaignFinanceRefundKind(kind),
            schema.CampaignFinanceRefundSummary.year < year,
            schema.CampaignFinanceRefundSummary.status
            == schema.CampaignFinanceRefundStatus.published,
        )
        .order_by(schema.CampaignFinanceRefundSummary.year.desc())
        .limit(1)
    ).scalar_one_or_none()


def _record_not_published(
    db: Session, link: RefundFileLink, fetched: Optional[FetchedFile], reason: str
) -> None:
    """Write down that the Board publishes nothing here, and what it answered instead.

    Stored rather than left as an absence, because "Minnesota published none" and "we have
    not loaded it" are different facts and a page may only say the first
    (``.claude/rules/grounded-answers.md`` rule 12).
    """
    existing = db.get(
        schema.CampaignFinanceRefundNotPublished,
        (link.year, schema.CampaignFinanceRefundKind(link.kind)),
    )
    values = {
        "url": link.url,
        "observed_on": datetime.now(UTC).date(),
        "http_status": fetched.status_code if fetched else None,
        "served_media_type": fetched.media_type if fetched else None,
        "byte_size": len(fetched.body) if fetched else None,
        "reason": reason,
    }
    if existing is None:
        db.add(
            schema.CampaignFinanceRefundNotPublished(
                year=link.year,
                kind=schema.CampaignFinanceRefundKind(link.kind),
                **values,
            )
        )
    else:
        for column, value in values.items():
            setattr(existing, column, value)
    # A year that starts publishing is no longer a year that publishes nothing.
    db.flush()


def _clear_not_published(db: Session, link: RefundFileLink) -> None:
    existing = db.get(
        schema.CampaignFinanceRefundNotPublished,
        (link.year, schema.CampaignFinanceRefundKind(link.kind)),
    )
    if existing is not None:
        db.delete(existing)
        db.flush()


def _publish(db: Session, summary) -> None:
    """Make this copy the live one for its year and kind, and retire the last one.

    The old copy is marked superseded rather than deleted, because §4.5 keeps every body
    indefinitely: a figure a reader was shown last month resolves to the line of the file
    it was read from, and it resolves to nothing if that copy is gone.
    """
    previous = (
        db.execute(
            select(schema.CampaignFinanceRefundSummary).where(
                schema.CampaignFinanceRefundSummary.year == summary.year,
                schema.CampaignFinanceRefundSummary.kind == summary.kind,
                schema.CampaignFinanceRefundSummary.status
                == schema.CampaignFinanceRefundStatus.published,
                schema.CampaignFinanceRefundSummary.id != summary.id,
            )
        )
        .scalars()
        .all()
    )
    for row in previous:
        row.status = schema.CampaignFinanceRefundStatus.superseded
    # Retire the old one before claiming the slot: the partial unique index permits one
    # published copy per year and kind, so the other order raises.
    db.flush()
    summary.status = schema.CampaignFinanceRefundStatus.published
    db.flush()


def load_refund_summaries(
    db: Session,
    *,
    http: Optional[requests.Session] = None,
    store: Any = None,
    index_html: Optional[str] = None,
    index_url: str = REFUND_INDEX_URL,
    years: Optional[Iterable[int]] = None,
    probe_unlinked_years: bool = True,
    dry_run: bool = False,
    ingestion_run_id: Optional[uuid.UUID] = None,
    log=print,
) -> LoadReport:
    """Read every refund summary the Board's page links, and keep what it served.

    The order matters and is the same order §4.5 sets for every other stored body: the
    bytes are uploaded and read back **before** the row that names them exists, because an
    orphaned object is recoverable and a row pointing at a missing object destroys the
    evidence it claims to have.

    A file is published only when nothing in ``validate`` blocks it. A file that is blocked
    is kept, with its checks, as ``quarantined`` -- so the next run can see what was wrong
    rather than re-downloading into the same silence.
    """
    report = LoadReport()
    http = http or http_session()
    wanted = set(years) if years is not None else None

    if index_html is None:
        log(f"reading the Board's index page: {index_url}")
        try:
            response = http.get(index_url, timeout=REQUEST_TIMEOUT_SECONDS)
            response.raise_for_status()
            index_html = response.text
        except requests.RequestException as error:
            report.errors.append(
                f"the Board's index could not be read: {type(error).__name__}"
            )
            return report
    links = resolve_refund_files(index_html)
    log(f"the page links {len(links)} file(s)")
    if not links:
        report.errors.append(
            "the Board's page links no refund summary at all, which has never been true; "
            "nothing was loaded"
        )
        return report

    linked = {(link.year, link.kind) for link in links}
    source_index = {
        "url": index_url,
        "candidate_years": sorted(
            {link.year for link in links if link.kind == CANDIDATE}
        ),
        "observed_on": datetime.now(UTC).date().isoformat(),
    }
    for link in links:
        if wanted is not None and link.year not in wanted:
            continue
        outcome = _load_one(
            db,
            link,
            http=http,
            store=store,
            dry_run=dry_run,
            ingestion_run_id=ingestion_run_id,
            index_url=index_url,
            log=log,
        )
        report.outcomes.append(outcome)
        if outcome.unavailable_reason:
            report.errors.append(
                f"{link.year} {link.kind}: {outcome.unavailable_reason}"
            )
        time.sleep(REQUEST_SPACING_SECONDS)

    if probe_unlinked_years:
        # Probe gaps inside the observed history, never invent a future year's absence.
        for year in range(
            min(link.year for link in links), max(link.year for link in links) + 1
        ):
            if wanted is not None and year not in wanted:
                continue
            for kind, suffix in ((CANDIDATE, "cand"), (PARTY_UNIT, "party")):
                if (year, kind) in linked:
                    continue
                link = RefundFileLink(
                    year=year,
                    kind=kind,
                    url=(
                        f"{CFB_ORIGIN}/pdf/publications/public_subsidy/historical/"
                        f"{year}_refunds_{suffix}.pdf"
                    ),
                )
                try:
                    fetched = fetch_file(http, link)
                except requests.RequestException as error:
                    report.errors.append(
                        f"{year} {kind}: unlinked probe unavailable ({type(error).__name__})"
                    )
                    continue
                # A missing link alone does not establish that a file was not published.
                missing_page = (
                    fetched.status_code == 200
                    and not looks_like_refund_pdf(fetched.body)
                    and bool(
                        re.search(
                            rb"<h[1-6][^>]*>\s*This page is not available\s*</h[1-6]>",
                            fetched.body,
                            re.I,
                        )
                    )
                )
                if not missing_page:
                    report.errors.append(
                        f"{year} {kind}: unlinked address needs review (HTTP {fetched.status_code}); no absence recorded"
                    )
                    continue
                reason = f"the Board's page links no {kind} file for {year}, and its address returned the Board's 'This page is not available' heading"
                log(f"  {year} {kind}: not published -- {reason}")
                report.not_published.append((year, kind, reason))
                if not dry_run:
                    _record_not_published(db, link, fetched, reason)
                time.sleep(REQUEST_SPACING_SECONDS)

    if not dry_run:
        source_index["read_failures"] = list(report.errors)
        # Preserve index evidence even when a newly linked year could not be copied.
        for summary in db.scalars(
            select(schema.CampaignFinanceRefundSummary).where(
                schema.CampaignFinanceRefundSummary.kind
                == schema.CampaignFinanceRefundKind.candidate,
                schema.CampaignFinanceRefundSummary.status
                == schema.CampaignFinanceRefundStatus.published,
            )
        ).all():
            summary.validation_json = {
                **(summary.validation_json or {}),
                "source_index": source_index,
            }
        db.commit()
    return report


def _load_one(
    db: Session,
    link: RefundFileLink,
    *,
    http: requests.Session,
    store: Any,
    dry_run: bool,
    ingestion_run_id: Optional[uuid.UUID],
    log,
    index_url: Optional[str] = None,
) -> FileOutcome:
    import tempfile

    outcome = FileOutcome(link=link)
    log(f"  {link.year} {link.kind}: {link.url}")
    try:
        fetched = fetch_file(http, link)
    except requests.RequestException as error:
        outcome.unavailable_reason = (
            f"linked file could not be read ({type(error).__name__})"
        )
        return outcome
    if not fetched.is_document:
        reason = (
            f"the linked address answered HTTP {fetched.status_code} with "
            f"{len(fetched.body)} bytes that are not a PDF"
        )
        outcome.unavailable_reason = reason
        log(f"    unavailable: {reason}")
        return outcome

    content_hash = _hash_bytes(fetched.body)
    from pypdf.errors import PdfReadError

    try:
        pages = extract_pages(fetched.body)
    except (PdfReadError, ValueError) as error:
        outcome.unavailable_reason = (
            f"linked PDF could not be read ({type(error).__name__})"
        )
        return outcome
    metadata = _source_metadata(pages, index_url)
    parsed = parse_pages(pages, year=link.year, kind=link.kind)
    outcome.parsed = parsed
    outcome.checks = validate(
        parsed,
        previous_row_count=_previous_row_count(db, year=link.year, kind=link.kind),
    )
    for check in outcome.checks:
        if check.status in (FAILED, RECORDED):
            log(f"    {check.status}: {check.name}: {check.detail}")
    if dry_run:
        log(f"    dry run: {len(parsed.rows)} rows, nothing written")
        return outcome

    existing = db.execute(
        select(schema.CampaignFinanceRefundSummary).where(
            schema.CampaignFinanceRefundSummary.year == link.year,
            schema.CampaignFinanceRefundSummary.kind
            == schema.CampaignFinanceRefundKind(link.kind),
            schema.CampaignFinanceRefundSummary.content_hash == content_hash,
        )
    ).scalar_one_or_none()

    if existing is not None:
        outcome.summary_id = existing.id
        # These are the same bytes: keep their original copy dates and raw records.
        existing.validation_json = {
            **(existing.validation_json or {}),
            "source_metadata": metadata,
        }
        outcome.reused = True
        log(
            "    these exact bytes are already held; refreshing source notes and identity checks"
        )
    else:
        store = store or _store_from_env()
        key = object_key(link.kind, content_hash)
        with tempfile.TemporaryDirectory() as directory:
            compressed_path, compressed_hash, compressed_size = _gzip_bytes(
                fetched.body, directory, f"{link.year}_{link.kind}.pdf"
            )
            # Upload and verify before the row exists.
            store.put_and_verify(key, compressed_path, compressed_hash)
        file_total = [total for total in parsed.totals if total.scope == "file"]
        summary = schema.CampaignFinanceRefundSummary(
            year=link.year,
            kind=schema.CampaignFinanceRefundKind(link.kind),
            source_url=link.url,
            content_hash=content_hash,
            byte_size=len(fetched.body),
            object_key=key,
            compressed_hash=compressed_hash,
            compressed_byte_size=compressed_size,
            compression="gzip",
            fetched_on=fetched.completed_at.date(),
            fetch_started_at=fetched.started_at,
            fetch_completed_at=fetched.completed_at,
            page_count=parsed.page_count,
            row_count=len(parsed.rows),
            unreadable_count=len(parsed.unreadable),
            prints_cents=prints_cents(parsed),
            printed_total_amount=file_total[-1].refunded_amount if file_total else None,
            printed_total_count=(
                file_total[-1].contribution_count if file_total else None
            ),
            status=schema.CampaignFinanceRefundStatus.fetched,
            validation_json={
                "source_metadata": metadata,
                "checks": [
                    {"name": c.name, "status": c.status, "detail": c.detail}
                    for c in outcome.checks
                ],
                "unreadable": [
                    {
                        "page": line.page_number,
                        "reason": line.reason,
                        "line": line.printed_line,
                    }
                    for line in parsed.unreadable
                ],
            },
            ingestion_run_id=ingestion_run_id,
        )
        db.add(summary)
        db.flush()
        db.add_all(
            schema.CampaignFinanceRefundRow(
                summary_id=summary.id,
                row_number=row.row_number,
                page_number=row.page_number,
                printed_name=row.printed_name,
                printed_line=row.printed_line,
                office_sought=row.office_sought,
                office=row.office,
                district=row.district,
                party=row.party,
                section_heading=row.section_heading,
                contribution_count=row.contribution_count,
                refunded_amount=row.refunded_amount,
            )
            for row in parsed.rows
        )
        db.flush()
        outcome.summary_id = summary.id
        if outcome.blocked:
            summary.status = schema.CampaignFinanceRefundStatus.quarantined
            log("    quarantined: a check that must pass did not")
        else:
            _publish(db, summary)
            outcome.published = True
            _clear_not_published(db, link)
            log(f"    published {len(parsed.rows)} rows")

    outcome.attached_rows, outcome.unattached_rows = match_summary_rows(
        db, outcome.summary_id, log=log
    )
    if outcome.reused:
        held = db.get(schema.CampaignFinanceRefundSummary, outcome.summary_id)
        outcome.published = (
            held is not None
            and held.status is schema.CampaignFinanceRefundStatus.published
        )
    return outcome


def enrich_refund_source_metadata(
    db: Session,
    *,
    store: Any,
    index_html: str,
    index_url: str,
    years: Optional[Iterable[int]] = None,
    dry_run: bool = True,
) -> list[dict]:
    """Enrich published candidate PDFs alone; never re-match rows or change other copies.

    The caller supplies an index it actually read. A program link is added only where
    that index links the stored PDF URL. Existing provenance remains when a file has
    since disappeared from the index. Copy dates and all published facts stay untouched.
    Hash failures abort before any changes are applied. The caller owns commit/rollback.
    """
    import tempfile
    from pathlib import Path

    links = resolve_refund_files(index_html)
    if not links:
        raise ValueError("The supplied index links no refund PDFs; refusing enrichment")
    linked = {(link.year, link.kind, link.url) for link in links}
    statement = (
        select(schema.CampaignFinanceRefundSummary)
        .where(
            schema.CampaignFinanceRefundSummary.kind
            == schema.CampaignFinanceRefundKind.candidate,
            schema.CampaignFinanceRefundSummary.status
            == schema.CampaignFinanceRefundStatus.published,
        )
        .order_by(
            schema.CampaignFinanceRefundSummary.year,
            schema.CampaignFinanceRefundSummary.id,
        )
    )
    if years is not None:
        statement = statement.where(
            schema.CampaignFinanceRefundSummary.year.in_(list(years))
        )
    if not dry_run:
        statement = statement.with_for_update()
    statement = statement.execution_options(populate_existing=True)
    proposals = []
    for summary in db.scalars(statement).all():
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "source.gz")
            store.get(summary.object_key, path, max_bytes=summary.compressed_byte_size)
            if sha256_of_file(path) != summary.compressed_hash:
                raise ValueError(f"Stored compressed hash mismatch: {summary.id}")
            body = gzip.decompress(Path(path).read_bytes())
            if (
                len(body) != summary.byte_size
                or _hash_bytes(body) != summary.content_hash
            ):
                raise ValueError(f"Stored PDF hash or size mismatch: {summary.id}")
            if not looks_like_refund_pdf(body):
                raise ValueError(f"Stored body is not a PDF: {summary.id}")
            pages = extract_pages(body)
        before = dict(summary.validation_json or {})
        previous_source = before.get("source_metadata", {}).get("source_url")
        source_url = (
            index_url
            if (summary.year, summary.kind.value, summary.source_url) in linked
            else previous_source
        )
        after = {**before, "source_metadata": _source_metadata(pages, source_url)}
        proposals.append((summary, before, after))
    if not dry_run:
        for summary, before, after in proposals:
            if before != after:
                summary.validation_json = after
        db.flush()
    return [
        {
            "summary_id": str(summary.id),
            "year": summary.year,
            "kind": summary.kind.value,
            "changed": before != after,
            "before": before,
            "after": after,
        }
        for summary, before, after in proposals
    ]
