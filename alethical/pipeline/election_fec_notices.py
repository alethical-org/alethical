"""Source-only FEC 8.5 notices and correspondence, never additive finance reports.

Layouts: retained official workbook SHA
c667016493df28c186445201cf8a2bcff43563bccc41b75b2bcc06366b69132b,
F6/F65/F99/Text sheets. No network, identity approval, periodic dates, latest
inference, cross-report deduplication or financial interpretation of prose.
"""

from dataclasses import dataclass
from datetime import datetime
import csv
import hashlib
import json
import re
from typing import Any

from alethical.pipeline.election_fec_sources import FecSourceError, _Row

MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_CATALOGUE_BYTES = 16 * 1024 * 1024
MAX_TEXT_CHARACTERS = 20000


class NoticeSourceError(FecSourceError):
    """The retained original cannot support the requested notice facts."""


def _require(condition, message):
    if not condition:
        raise NoticeSourceError(message)


def _fingerprint(body, expected, limit):
    _require(
        isinstance(body, bytes)
        and 0 < len(body) <= limit
        and isinstance(expected, str)
        and re.fullmatch(r"[0-9a-f]{64}", expected)
        and hashlib.sha256(body).hexdigest() == expected,
        "Original source hash or size is invalid",
    )


def _number(value):
    _require(
        (type(value) is int or isinstance(value, str))
        and re.fullmatch(r"[1-9][0-9]*", str(value)),
        "Invalid filing identifier",
    )
    return str(value)


@dataclass(frozen=True)
class NoticeRecord:
    kind: str
    row: int
    facts_json: str
    quote: str

    @property
    def facts(self) -> dict[str, Any]:
        """Return a copy; callers cannot mutate the retained parsed record."""
        return json.loads(self.facts_json)


@dataclass(frozen=True)
class FecNotice:
    source_sha256: str
    file_number: str
    version: str
    form: str
    account_id: str
    original_report_id: str | None
    amendment_number: int | None
    header: NoticeRecord
    cover: NoticeRecord
    contributions: tuple[NoticeRecord, ...]
    text_attachments: tuple[NoticeRecord, ...]
    correspondence: NoticeRecord | None


@dataclass(frozen=True)
class CatalogueSource:
    body: bytes
    sha256: str


@dataclass(frozen=True)
class NoticeVersionEvidence:
    file_number: str
    account_id: str
    catalogue_sha256: str | None
    catalogue_sub_id: str | None
    quote: str | None
    chain: tuple[str, ...]
    latest_file_number: str | None
    source_most_recent: bool | None
    received_date: str | None
    holds: tuple[str, ...]
    catalogue_copies: tuple[tuple[str, str], ...] = ()


class _NoticeRow(_Row):
    def __init__(self, raw, number, width):
        super().__init__(raw, number, width)
        self.present_columns = min(len(raw.split(b"\x1c")), width)


def _record(row, kind, facts):
    extraction = row.extraction(kind, facts)
    selected = json.loads(extraction.quote)
    selected["format"] = "fec-notice-selected-cells-v1"
    for cell in selected["cells"]:
        cell["present"] = cell["column"] <= row.present_columns
    quote = json.dumps(
        selected, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return NoticeRecord(
        kind,
        row.number,
        json.dumps(facts, ensure_ascii=False, sort_keys=True),
        quote,
    )


def _all_cells(raw, number, width):
    row = _NoticeRow(raw, number, width)
    # Every supported cell is quoted, including explicitly blank values.
    for column in range(1, width + 1):
        row.text(column, limit=4000 if width == 6 and column == 6 else 402)
    return row


def _transaction(row, column):
    value = row.text(column, required=True, limit=20)
    _require(
        value == value.upper() and not any(c.isspace() for c in value),
        "Invalid transaction ID",
    )
    return value


def _literal_text(row, column, *, limit):
    """Validate quoted FEC text length without rewriting the original cell."""
    value = row.text(column, limit=limit * 2 + 2)
    decoded = value
    if value.startswith('"'):
        try:
            parsed = list(csv.reader([value], delimiter="\x1c", strict=True))
        except csv.Error as error:
            raise NoticeSourceError("Invalid quoted text field") from error
        _require(len(parsed) == 1 and len(parsed[0]) == 1, "Invalid quoted text field")
        decoded = parsed[0][0]
    _require(len(decoded) <= limit, "Text field exceeds its specified length")
    return value


def _name(row, start):
    return {
        key: _literal_text(row, start + i, limit=limit)
        for i, (key, limit) in enumerate(
            [
                ("last", 30),
                ("first", 20),
                ("middle", 20),
                ("prefix", 10),
                ("suffix", 10),
            ]
        )
    }


def _address(row, start):
    return {
        key: _literal_text(row, start + i, limit=limit)
        for i, (key, limit) in enumerate(
            [
                ("street_1", 34),
                ("street_2", 34),
                ("city", 30),
                ("state", 2),
                ("postal_code", 9),
            ]
        )
    }


def _cover(raw, form):
    row = _all_cells(raw, 2, 17 if form == "F99" else 24)
    account = row.identifier(2, required=True)
    if form == "F99":
        code = row.text(15, required=True, limit=3)
        frequency = row.text(16, limit=1)
        attachment = row.text(17, limit=1)
        _require(
            code in {"MSI", "MSM", "MST", "MSR", "MSW"},
            "Unsupported correspondence code",
        )
        _require(frequency in {"", "M", "Q"}, "Invalid filing frequency")
        _require(
            code not in {"MSM", "MSR"} or bool(frequency), "Filing frequency is missing"
        )
        _require(attachment in {"", "X"}, "Invalid PDF attachment indicator")
        facts = {
            "account_id": account,
            "committee_name": row.text(3, required=True),
            "address": _address(row, 4),
            "signer_name": _name(row, 9),
            "signed_date": row.day(14),
            "text_code": code,
            "filing_frequency": frequency,
            "pdf_attachment_indicator": attachment,
            "attachment_state": "not_bound" if attachment else "not_indicated",
            "additive": False,
        }
    else:
        original_date = row.day(3, required=form == "F6A")
        _require(
            form == "F6A" or original_date is None, "New notice has an amendment date"
        )
        office = row.text(16, limit=1)
        state = row.text(17, limit=2)
        district = row.text(18, limit=2)
        _require(office in {"", "H", "S", "P"}, "Invalid candidate office")
        _require(
            not state or re.fullmatch(r"[A-Z]{2}", state), "Invalid candidate state"
        )
        _require(
            not district or re.fullmatch(r"[0-9]{2}", district),
            "Invalid candidate district",
        )
        candidate_name = _name(row, 11)
        signer_name = _name(row, 19)
        _require(
            candidate_name["last"] and candidate_name["first"],
            "Candidate name is missing",
        )
        _require(signer_name["last"] and signer_name["first"], "Signer name is missing")
        facts = {
            "account_id": account,
            "committee_name": row.text(4, required=True),
            "address": _address(row, 5),
            "original_amendment_date": original_date,
            "candidate_claim": {
                "source_candidate_id": row.identifier(10, candidate=True),
                "name": candidate_name,
                "office": office,
                "state": state,
                "district": district,
            },
            "signer_name": signer_name,
            "signed_date": row.day(24, required=True),
            "additive": False,
        }
    return account, _record(
        row, "correspondence_cover" if form == "F99" else "notice_cover", facts
    )


def _contribution(raw, number, account):
    row = _all_cells(raw, number, 20)
    _require(
        row.identifier(2, required=True) == account,
        "Contributor row has a different filer",
    )
    entity = row.text(4, required=True, limit=3)
    _require(
        entity in {"IND", "CAN", "CCM", "COM", "ORG", "PAC", "PTY"},
        "Invalid contributor entity",
    )
    organization = _literal_text(row, 5, limit=200)
    name = _name(row, 6)
    _require(
        (name["last"] not in {"", '""'} and name["first"] not in {"", '""'})
        if entity in {"IND", "CAN"}
        else organization not in {"", '""'},
        "Contributor name is missing",
    )
    amount = row.money(18, required=True)
    facts = {
        "account_id": account,
        "transaction_id": _transaction(row, 3),
        "entity_type": entity,
        "organization_name": organization,
        "name": name,
        **_address(row, 11),
        "contributor_committee_id": row.identifier(16),
        "contribution_date": row.day(17, required=True),
        "amount_literal": row.text(18, required=True, limit=12),
        "amount_decimal": amount,
        "employer": _literal_text(row, 19, limit=38),
        "occupation": _literal_text(row, 20, limit=38),
        "additive": False,
    }
    return _record(row, "contribution_notice", facts)


def parse_fec_notice(
    body: bytes, file_number: str, *, expected_sha256: str
) -> FecNotice:
    """Read one hashed original. Returned source claims grant no identity approval."""
    try:
        _fingerprint(body, expected_sha256, MAX_SOURCE_BYTES)
        number = _number(file_number)
        lines = [r.removesuffix(b"\r") for r in body.split(b"\n")]
        while lines and lines[-1] == b"":
            lines.pop()
        _require(len(lines) >= 2, "Missing header or cover")
        header = _all_cells(lines[0], 1, 8)
        _require(
            header.text(1) == "HDR" and header.text(2) == "FEC", "Invalid FEC header"
        )
        _require(header.text(3) == "8.5", "Unsupported notice format")
        form = lines[1].split(b"\x1c", 1)[0].decode("ascii")
        _require(form in {"F6N", "F6A", "F99"}, "Unsupported notice cover")
        original, sequence = header.text(6, limit=16), header.text(7, limit=3)
        if form == "F6A":
            _require(
                re.fullmatch(r"FEC-[1-9][0-9]*", original),
                "Missing amendment original ID",
            )
            _require(
                re.fullmatch(r"[1-9][0-9]{0,2}", sequence), "Invalid amendment sequence"
            )
            _require(original != f"FEC-{number}", "Self-referencing amendment")
        else:
            _require(
                not original and sequence in {"", "0"}, "Unexpected amendment header"
            )
        account, cover = _cover(lines[1], form)
        contributions, attachments = [], []
        correspondence = None
        if form == "F99":
            _require(
                len(lines) >= 4
                and lines[2] == b"[BEGINTEXT]"
                and lines[-1] == b"[ENDTEXT]",
                "Missing text boundaries",
            )
            _require(
                lines.count(b"[BEGINTEXT]") == lines.count(b"[ENDTEXT]") == 1,
                "Ambiguous text boundaries",
            )
            text_lines = [line.decode("utf-8") for line in lines[3:-1]]
            text = "\n".join(text_lines)
            _require(
                len(text) <= MAX_TEXT_CHARACTERS
                and all(ord(c) >= 32 or c in "\n\t" for c in text),
                "Invalid correspondence text",
            )
            quote = json.dumps(
                {
                    "format": "fec-text-lines-v1",
                    "lines": [
                        {"row": i, "text": line} for i, line in enumerate(text_lines, 4)
                    ],
                },
                ensure_ascii=False,
                sort_keys=True,
            )
            correspondence = NoticeRecord(
                "correspondence",
                3,
                json.dumps(
                    {
                        "account_id": account,
                        "text": text,
                        "end_row": len(lines),
                        "additive": False,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ),
                quote,
            )
        else:
            seen = set()
            for index, raw in enumerate(lines[2:], 3):
                if not raw:
                    continue
                code = raw.split(b"\x1c", 1)[0]
                if code == b"F65":
                    record = _contribution(raw, index, account)
                    contributions.append(record)
                elif code == b"TEXT":
                    row = _all_cells(raw, index, 6)
                    _require(
                        row.identifier(2, required=True) == account,
                        "Text has a different filer",
                    )
                    record = _record(
                        row,
                        "notice_text",
                        {
                            "account_id": account,
                            "transaction_id": _transaction(row, 3),
                            "back_reference": row.text(4, limit=20),
                            "form_reference": row.text(5, required=True, limit=8),
                            "text": row.text(6, required=True, limit=4000),
                            "additive": False,
                        },
                    )
                    attachments.append(record)
                else:
                    raise NoticeSourceError("Unsupported row or extra cover in notice")
                transaction = record.facts["transaction_id"]
                _require(
                    transaction not in seen, "Duplicate transaction ID within notice"
                )
                seen.add(transaction)
            transactions = {r.facts["transaction_id"] for r in contributions}
            for text_record in attachments:
                facts = text_record.facts
                _require(
                    (facts["form_reference"] == form and not facts["back_reference"])
                    or (
                        facts["form_reference"] == "F65"
                        and facts["back_reference"] in transactions
                    ),
                    "Invalid text back reference",
                )
        return FecNotice(
            expected_sha256,
            number,
            "8.5",
            form,
            account,
            original.removeprefix("FEC-") or None,
            int(sequence) if form == "F6A" else None,
            _record(
                header,
                "header",
                {
                    "version": "8.5",
                    "original_report_id": original or None,
                    "amendment_number_literal": sequence,
                },
            ),
            cover,
            tuple(contributions),
            tuple(attachments),
            correspondence,
        )
    except (FecSourceError, UnicodeError, ValueError, TypeError, IndexError) as error:
        if isinstance(error, NoticeSourceError):
            raise
        raise NoticeSourceError(str(error)) from error


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, "Duplicate catalogue JSON key")
        result[key] = value
    return result


def assess_notice_versions(
    filings: tuple[FecNotice, ...], catalogue_sources: tuple[CatalogueSource, ...]
) -> tuple[NoticeVersionEvidence, ...]:
    """Bind captured catalogue facts; preserve gaps, never choose an effective notice.

    Catalogue sources must already have official-URL provenance checked by the
    caller. This function proves byte/row agreement, not publisher authority.
    """
    try:
        requested = {f.file_number: f for f in filings}
        _require(len(requested) == len(filings), "Duplicate notice file number")
        rows = {}
        for source in catalogue_sources:
            _fingerprint(source.body, source.sha256, MAX_CATALOGUE_BYTES)
            data = json.loads(source.body, object_pairs_hook=_unique_object)
            _require(
                isinstance(data, dict) and isinstance(data.get("results"), list),
                "Missing catalogue results",
            )
            for row in data["results"]:
                _require(isinstance(row, dict), "Invalid catalogue row")
                file_number = str(row.get("file_number"))
                if file_number not in requested:
                    continue
                if file_number in rows:
                    old_sha, old_row, copies = rows[file_number]
                    _require(
                        source.sha256 not in {s for s, _ in copies} and old_row == row,
                        "Duplicate or conflicting catalogue filing row",
                    )
                    copies.append((source.sha256, _number(row["sub_id"])))
                else:
                    rows[file_number] = (
                        source.sha256,
                        row,
                        [(source.sha256, _number(row["sub_id"]))],
                    )
        result = []
        for filing in filings:
            if filing.file_number not in rows:
                result.append(
                    NoticeVersionEvidence(
                        filing.file_number,
                        filing.account_id,
                        None,
                        None,
                        None,
                        (),
                        None,
                        None,
                        None,
                        ("catalogue_missing",),
                    )
                )
                continue
            sha, row, copies = rows[filing.file_number]
            _require(
                row["committee_id"] == filing.account_id
                and row["form_type"] == ("F99" if filing.form == "F99" else "F6"),
                "Catalogue filer or form differs",
            )
            sub_id = _number(row["sub_id"])
            received = datetime.fromisoformat(row["receipt_date"]).date().isoformat()
            holds = []
            chain = ()
            latest = None
            recent = row.get("most_recent")
            _require(
                recent is None or type(recent) is bool, "Invalid most recent field"
            )
            if filing.form != "F99":
                raw_chain = row.get("amendment_chain")
                _require(
                    isinstance(raw_chain, list) and bool(raw_chain),
                    "Missing notice amendment chain",
                )
                chain = tuple(_number(x) for x in raw_chain)
                _require(
                    len(set(chain)) == len(chain) and chain[-1] == filing.file_number,
                    "Invalid notice amendment chain",
                )
                version = row.get("amendment_version")
                _require(
                    type(version) is int and version == len(chain) - 1,
                    "Conflicting amendment version",
                )
                previous = _number(row["previous_file_number"])
                _require(
                    previous == (chain[-2] if len(chain) > 1 else filing.file_number),
                    "Conflicting predecessor",
                )
                _require(
                    (filing.form == "F6A") == (len(chain) > 1),
                    "Cover amendment conflicts with catalogue",
                )
                if filing.form == "F6A":
                    _require(
                        chain[0] == filing.original_report_id
                        and version == filing.amendment_number,
                        "Header amendment conflicts with catalogue",
                    )
                    original = requested.get(chain[0])
                    if original is None:
                        holds.append("original_notice_not_retained")
                    else:
                        _require(
                            original.account_id == filing.account_id
                            and original.form == "F6N",
                            "Original notice has a different filer or form",
                        )
                        original_row = rows.get(chain[0])
                        if original_row is None:
                            holds.append("original_catalogue_missing")
                        else:
                            original_date = (
                                datetime.fromisoformat(original_row[1]["receipt_date"])
                                .date()
                                .isoformat()
                            )
                            if (
                                original_date
                                != filing.cover.facts["original_amendment_date"]
                            ):
                                holds.append("original_amendment_date_conflict")
                    for predecessor in chain[1:-1]:
                        prior = requested.get(predecessor)
                        if prior is None:
                            holds.append("intermediate_notice_not_retained")
                        else:
                            _require(
                                prior.account_id == filing.account_id
                                and prior.original_report_id == chain[0],
                                "Intermediate notice has a different series",
                            )
                indicator = row.get("amendment_indicator")
                _require(
                    indicator is None
                    or indicator == ("A" if filing.form == "F6A" else "N"),
                    "Conflicting amendment indicator",
                )
                latest = (
                    _number(row["most_recent_file_number"])
                    if row.get("most_recent_file_number") is not None
                    else None
                )
                _require(
                    recent is None
                    or (
                        latest is not None and recent == (latest == filing.file_number)
                    ),
                    "Conflicting latest-file fields",
                )
                if recent is None:
                    holds.append("source_most_recent_unknown")
                if latest is None:
                    holds.append("latest_file_number_missing")
                elif latest not in requested:
                    holds.append("latest_notice_not_retained")
                else:
                    _require(
                        requested[latest].account_id == filing.account_id
                        and (requested[latest].original_report_id or latest) == chain[0]
                        and latest not in chain[:-1],
                        "Latest notice has a different filer or series",
                    )
            fields = (
                "sub_id",
                "committee_id",
                "file_number",
                "form_type",
                "receipt_date",
                "amendment_chain",
                "amendment_version",
                "previous_file_number",
                "most_recent_file_number",
                "most_recent",
                "amendment_indicator",
            )
            quote = json.dumps(
                {key: row[key] for key in fields if key in row},
                ensure_ascii=False,
                sort_keys=True,
            )
            result.append(
                NoticeVersionEvidence(
                    filing.file_number,
                    filing.account_id,
                    sha,
                    sub_id,
                    quote,
                    chain,
                    latest,
                    recent,
                    received,
                    tuple(holds),
                    tuple(copies),
                )
            )
        return tuple(result)
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        if isinstance(error, NoticeSourceError):
            raise
        raise NoticeSourceError("Invalid notice catalogue evidence") from error


def extract_fec_notice_record(
    body: bytes,
    file_number: str,
    locator: dict,
    *,
    expected_sha256: str,
) -> NoticeRecord:
    """Recheck one exact original and physical locator; never accept caller facts."""
    _require(
        isinstance(locator, dict)
        and set(locator) == {"kind", "row"}
        and isinstance(locator["kind"], str)
        and type(locator["row"]) is int
        and locator["row"] > 0,
        "Invalid notice record locator",
    )
    filing = parse_fec_notice(body, file_number, expected_sha256=expected_sha256)
    records = [
        filing.header,
        filing.cover,
        *filing.contributions,
        *filing.text_attachments,
    ]
    if filing.correspondence is not None:
        records.append(filing.correspondence)
    matches = [
        r for r in records if r.kind == locator["kind"] and r.row == locator["row"]
    ]
    _require(len(matches) == 1, "Notice record locator is absent or ambiguous")
    return matches[0]
