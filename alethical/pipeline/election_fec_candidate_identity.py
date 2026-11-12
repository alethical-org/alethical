"""Bounded official FEC candidate-master and candidate/committee linkage readers.

Headerless ZIP layouts are distinct contracts. Candidate election year is read
from its own cell; the download cycle and FEC_ELECTION_YR never replace it. These
are source facts for explicit reviews, not ballot matching or account approval.
"""

import hashlib
from io import BytesIO
import json
import re
from urllib.parse import urlsplit
import zipfile

from alethical.pipeline.election_external_finance import CheckedExtraction

MASTER_ADAPTER_ID = "fec_candidate_master:v1"
LINKAGE_ADAPTER_ID = "fec_candidate_linkage:v1"
_HOST = "cg-519a459a-0ea3-42c2-b7bc-fa1143481f74.s3-us-gov-west-1.amazonaws.com"
_CANDIDATE = re.compile(r"[HSP][0-9][A-Z]{2}[0-9A-Z]{5}")
_ACCOUNT = re.compile(r"C[0-9]{8}")
_LAYOUTS = {
    "cn": (
        "cn.txt",
        "fec-cn-15:v1",
        15,
        (
            "CAND_ID",
            "CAND_NAME",
            "CAND_PTY_AFFILIATION",
            "CAND_ELECTION_YR",
            "CAND_OFFICE_ST",
            "CAND_OFFICE",
            "CAND_OFFICE_DISTRICT",
            "CAND_ICI",
            "CAND_STATUS",
            "CAND_PCC",
        ),
    ),
    "ccl": (
        "ccl.txt",
        "fec-ccl-7:v1",
        7,
        (
            "CAND_ID",
            "CAND_ELECTION_YR",
            "FEC_ELECTION_YR",
            "CMTE_ID",
            "CMTE_TP",
            "CMTE_DSGN",
            "LINKAGE_ID",
        ),
    ),
}
_MAX_BYTES = 16 * 1024 * 1024


class FecCandidateIdentityError(ValueError):
    """Original source or selected candidate relationship is unsupported."""


def _require(condition, message):
    if not condition:
        raise FecCandidateIdentityError(message)


def _selected(body, source, locator, layout):
    member, schema, width, fields = _LAYOUTS[layout]
    _require(
        isinstance(body, bytes) and len(body) <= _MAX_BYTES,
        "Candidate identity requires bounded original ZIP bytes",
    )
    url = source.get("url")
    _require(isinstance(url, str), "Candidate identity needs its official URL")
    parsed = urlsplit(url)
    try:
        valid_port = parsed.port in {None, 443}
    except ValueError as exc:
        raise FecCandidateIdentityError("Invalid identity publisher port") from exc
    path = re.fullmatch(
        rf"/bulk-downloads/([12][0-9]{{3}})/{layout}([0-9]{{2}})\.zip", parsed.path
    )
    _require(
        source.get("authority") == "fec"
        and parsed.scheme == "https"
        and parsed.hostname == _HOST
        and valid_port
        and parsed.username is None
        and parsed.password is None
        and not parsed.query
        and not parsed.fragment
        and not any(ord(c) < 32 for c in url)
        and path is not None
        and path[1][-2:] == path[2]
        and source.get("sha256") == hashlib.sha256(body).hexdigest(),
        "Identity ZIP is not its retained official FEC original",
    )
    _require(
        set(locator) == {"kind", "member", "member_sha256", "schema", "row"}
        and locator.get("member") == member
        and locator.get("schema") == schema
        and type(locator.get("row")) is int
        and 1 <= locator["row"] <= 200000,
        "Unsupported exact ZIP member/schema/row locator",
    )
    try:
        with zipfile.ZipFile(BytesIO(body)) as archive:
            entries = archive.infolist()
            _require(
                len(entries) == 1
                and entries[0].filename == member
                and not entries[0].is_dir()
                and not entries[0].flag_bits & 1
                and entries[0].compress_type
                in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                and entries[0].file_size <= _MAX_BYTES,
                "Unsupported identity ZIP members or expansion",
            )
            with archive.open(entries[0]) as stream:
                raw = stream.read(_MAX_BYTES + 1)
            _require(
                len(raw) == entries[0].file_size <= _MAX_BYTES,
                "Identity ZIP expansion changed or exceeded bounds",
            )
    except (zipfile.BadZipFile, RuntimeError, OSError, EOFError) as exc:
        raise FecCandidateIdentityError("Unreadable candidate identity ZIP") from exc
    _require(
        hashlib.sha256(raw).hexdigest() == locator["member_sha256"],
        "Identity ZIP member hash differs from the selected original",
    )
    lines = raw.split(b"\n")
    while lines and lines[-1] in {b"", b"\r"}:
        lines.pop()
    _require(
        len(lines) <= 200000 and locator["row"] <= len(lines),
        "Identity row is outside the bounded original member",
    )
    try:
        cells = (
            lines[locator["row"] - 1].removesuffix(b"\r").decode("cp1252").split("|")
        )
    except UnicodeDecodeError as exc:
        raise FecCandidateIdentityError("Unsupported identity text encoding") from exc
    _require(
        len(cells) == width
        and all(len(c) <= 200 and not any(ord(v) < 32 for v in c) for c in cells),
        "Identity row differs from the exact published cell layout",
    )
    return cells, fields, schema


def _year(value):
    _require(
        re.fullmatch(r"[12][0-9]{3}", value) is not None,
        "Identity needs a literal candidate election year",
    )
    return int(value)


def _quote(locator, fields, cells):
    return json.dumps(
        {
            "format": "fec-selected-zip-cells-v1",
            "member": locator["member"],
            "member_sha256": locator["member_sha256"],
            "schema": locator["schema"],
            "row": locator["row"],
            "cells": [
                {"column": n, "field": field, "raw": cells[n - 1]}
                for n, field in enumerate(fields, 1)
            ],
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def extract_candidate_master(body, source, locator):
    """Read literal candidate context, principal relationship, or name order.

    The name-rendering sub-contract recognizes only a single family/given comma
    delimiter. It emits its fixed order; the caller cannot request a different
    ordering or suppress any word, punctuation, initial or suffix.
    """
    cells, fields, _ = _selected(body, source, locator, "cn")
    (
        candidate,
        name,
        party,
        year,
        state,
        office,
        district,
        incumbency,
        status,
        account,
    ) = cells[:10]
    _require(
        _CANDIDATE.fullmatch(candidate) is not None
        and name
        and office in {"H", "S", "P"}
        and candidate[0] == office
        and candidate[2:4] == state
        and re.fullmatch(r"[A-Z]{2}", state) is not None
        and re.fullmatch(r"[0-9]{2}", district) is not None
        and (office == "H" or district == "00")
        and (not account or _ACCOUNT.fullmatch(account) is not None),
        "Master row lacks exact candidate/office/principal identity",
    )
    election_year = _year(year)
    facts = {"authority": "fec", "source_candidate_id": candidate}
    kind = locator["kind"]
    if kind == "candidate":
        facts.update(
            candidate_name=name,
            party=party,
            election_year=election_year,
            state=state,
            office=office,
            district=district,
            incumbency=incumbency,
            status=status,
            principal_account_id=account or None,
        )
    elif kind == "name_rendering":
        # ASCII case conversion has no Unicode expansion or punctuation folding.
        _require(
            name.isascii() and name.count(",") == 1 and ", " in name,
            "Master name has no supported declared family/given order",
        )
        family, given = name.split(", ")
        _require(
            family
            and given
            and family == family.strip()
            and given == given.strip()
            and "  " not in name,
            "Ambiguous master name delimiter/spacing",
        )
        facts.update(source_name=name, name_order="family_comma_given")
    elif kind in {"designation", "account_candidate"}:
        _require(
            _ACCOUNT.fullmatch(account) is not None,
            "Master has no issued principal account",
        )
        facts["account_id"] = account
        if kind == "designation":
            facts.update(
                election_year=election_year,
                state=state,
                office=office,
                district=district,
                designation_role="principal",
            )
        else:
            facts["candidate_name"] = name
    else:
        raise FecCandidateIdentityError("Unsupported master identity claim")
    return CheckedExtraction(facts, _quote(locator, fields, cells))


def extract_candidate_linkage(body, source, locator):
    """Preserve candidate election year, FEC cycle and designation separately."""
    cells, fields, _ = _selected(body, source, locator, "ccl")
    (
        candidate,
        candidate_year,
        fec_year,
        account,
        committee_type,
        designation,
        linkage_id,
    ) = cells
    _require(
        _CANDIDATE.fullmatch(candidate) is not None
        and _ACCOUNT.fullmatch(account) is not None
        and re.fullmatch(r"[0-9]+", linkage_id) is not None,
        "Linkage lacks exact issued candidate/account identifiers",
    )
    candidate_year, fec_year = _year(candidate_year), _year(fec_year)
    facts = {
        "authority": "fec",
        "account_id": account,
        "source_candidate_id": candidate,
    }
    if locator["kind"] == "link":
        facts.update(
            candidate_election_year=candidate_year,
            fec_election_year=fec_year,
            committee_type=committee_type,
            designation_code=designation,
            designation_role={"P": "principal", "A": "authorized"}.get(designation),
            linkage_id=linkage_id,
        )
    elif locator["kind"] == "designation":
        _require(
            designation in {"P", "A"},
            "Linkage is not a principal/authorized designation",
        )
        _require(
            committee_type in {"H", "S", "P"} and committee_type == candidate[0],
            "Linkage is not a candidate committee type",
        )
        facts.update(
            election_year=candidate_year,
            designation_role={"P": "principal", "A": "authorized"}[designation],
        )
    else:
        raise FecCandidateIdentityError("Unsupported linkage identity claim")
    return CheckedExtraction(facts, _quote(locator, fields, cells))
