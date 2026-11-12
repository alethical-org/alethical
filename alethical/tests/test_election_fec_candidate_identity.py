"""Exact candidate-keyed context and issued FEC account relationships."""

import hashlib
from io import BytesIO
import json
import zipfile

import pytest

from alethical.pipeline import election_external_finance as s
from alethical.pipeline.election_external_adapters import register_external_adapters
from alethical.pipeline.election_fec_paper_identity import extract_fec_paper_identity
from alethical.tests.test_election_fec_paper_identity import paper_pdf

HOST = "cg-519a459a-0ea3-42c2-b7bc-fa1143481f74.s3-us-gov-west-1.amazonaws.com"
MASTER = "H6MN01111|EXAMPLE, ALEX|DFL|2026|MN|H|01|O|C|C00123456|||||"
LINK = "H6MN01111|2026|2026|C00123456|H|P|123456"


def zipped(row=MASTER, *, member="cn.txt", entries=None):
    output = BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, value in (entries or {member: row + "\r\n"}).items():
            archive.writestr(name, value)
    return output.getvalue()


def source(body, file="cn26.zip"):
    return {
        "authority": "fec",
        "sha256": hashlib.sha256(body).hexdigest(),
        "url": f"https://{HOST}/bulk-downloads/2026/{file}",
        "media_type": "application/zip",
    }


def locator(body, *, member="cn.txt", kind="designation", row=1):
    with zipfile.ZipFile(BytesIO(body)) as archive:
        member_hash = hashlib.sha256(archive.read(member)).hexdigest()
    return {
        "kind": kind,
        "member": member,
        "member_sha256": member_hash,
        "schema": "fec-cn-15:v1" if member == "cn.txt" else "fec-ccl-7:v1",
        "row": row,
    }


def extraction(body, *, file="cn26.zip", **kwargs):
    register_external_adapters()
    name = (
        "fec_candidate_master:v1"
        if file.startswith("cn")
        else "fec_candidate_linkage:v1"
    )
    return s.ADAPTERS[name](body, source(body, file), locator(body, **kwargs))


def binding(body, metadata, loc, adapter):
    actual = s.ADAPTERS[adapter](body, metadata, loc)
    return {
        "source_sha256": metadata["sha256"],
        "adapter": adapter,
        "locator": loc,
        "facts": actual.facts,
        "quote": actual.quote,
    }


def chain():
    register_external_adapters()
    body = zipped()
    metadata = source(body)
    account = binding(body, metadata, locator(body), "fec_candidate_master:v1")
    paper = paper_pdf()
    paper_source = {
        "authority": "fec",
        "sha256": hashlib.sha256(paper).hexdigest(),
        "url": "https://docquery.fec.gov/pdf/001/202611120000000001/202611120000000001.pdf",
    }
    context = []
    for field in ("election_year", "office", "state", "district"):
        loc = {"kind": "field", "page": 1, "field": field}
        actual = extract_fec_paper_identity(paper, paper_source, loc)
        context.append(
            {
                "source_sha256": paper_source["sha256"],
                "adapter": "fec_form2_pdf:v1",
                "locator": loc,
                "facts": actual.facts,
                "quote": actual.quote,
            }
        )
    # Linkage intentionally supplies no office; context must come from candidate-only F2.
    link = zipped(LINK, member="ccl.txt")
    link_source = source(link, "ccl26.zip")
    account = binding(
        link, link_source, locator(link, member="ccl.txt"), "fec_candidate_linkage:v1"
    )
    generation = {"sources": [metadata, paper_source, link_source]}
    bodies = {
        metadata["sha256"]: body,
        paper_source["sha256"]: paper,
        link_source["sha256"]: link,
    }
    expected = {
        "authority": "fec",
        "account_id": "C00123456",
        "source_candidate_id": "H6MN01111",
        "election_year": 2026,
        "office": "H",
        "state": "MN",
        "district": "01",
        "designation_role": "principal",
    }
    return generation, bodies, account, context, expected


def test_typed_candidate_context_composes_only_after_issued_designation():
    generation, bodies, account, context, expected = chain()
    s.validate_federal_designation(generation, bodies, [*context, account], expected)
    # Generic joins stay strict; the explicit typed composition is the only exception.
    with pytest.raises(s.ComparisonImportError, match="exact entity"):
        s.validate_binding(
            generation,
            bodies,
            [account, *context],
            expected,
            authority="fec",
            joins=("authority", "account_id", "source_candidate_id"),
        )


@pytest.mark.parametrize(
    "change",
    [
        "account",
        "candidate",
        "year",
        "office",
        "state",
        "district",
        "role",
        "missing_account",
        "filer_only",
        "injected_id",
        "wrong_paper_adapter",
    ],
)
def test_candidate_context_cannot_cross_account_candidate_role_or_office(change):
    generation, bodies, account, context, expected = chain()
    if change == "missing_account":
        account = None
    elif change == "filer_only":
        account["facts"].pop("source_candidate_id")
    elif change == "injected_id":
        context[0]["facts"]["account_id"] = expected["account_id"]
    elif change == "wrong_paper_adapter":
        context[0]["adapter"] = "fec_candidate_master:v1"
    else:
        key, value = {
            "account": ("account_id", "C00999999"),
            "candidate": ("source_candidate_id", "H6MN02222"),
            "year": ("election_year", 2024),
            "office": ("office", "S"),
            "state": ("state", "WI"),
            "district": ("district", "02"),
            "role": ("designation_role", "authorized"),
        }[change]
        expected[key] = value
    with pytest.raises(s.ComparisonImportError):
        s.validate_federal_designation(
            generation, bodies, context + ([account] if account else []), expected
        )


def test_linkage_keeps_candidate_election_year_separate_from_fec_cycle():
    body = zipped(LINK.replace("|2026|2026|", "|2024|2026|"), member="ccl.txt")
    link = extraction(body, file="ccl26.zip", member="ccl.txt", kind="link")
    assert link.facts["candidate_election_year"] == 2024
    assert link.facts["fec_election_year"] == 2026
    designation = extraction(body, file="ccl26.zip", member="ccl.txt")
    assert designation.facts["election_year"] == 2024
    assert designation.facts["designation_role"] == "principal"
    assert {c["field"] for c in json.loads(designation.quote)["cells"]} >= {
        "CAND_ELECTION_YR",
        "FEC_ELECTION_YR",
        "CMTE_DSGN",
    }


@pytest.mark.parametrize("role", ["J", "D", "U", ""])
def test_linkage_never_promotes_other_committee_roles(role):
    body = zipped(LINK.replace("|P|", f"|{role}|"), member="ccl.txt")
    assert (
        extraction(body, file="ccl26.zip", member="ccl.txt", kind="link").facts[
            "designation_code"
        ]
        == role
    )
    with pytest.raises(ValueError):
        extraction(body, file="ccl26.zip", member="ccl.txt")


def test_master_blank_principal_is_candidate_context_without_an_account():
    body = zipped(MASTER.replace("C00123456", ""))
    assert extraction(body, kind="candidate").facts["principal_account_id"] is None
    with pytest.raises(ValueError):
        extraction(body)


@pytest.mark.parametrize(
    "change",
    [
        "hash",
        "host",
        "authority",
        "member_hash",
        "member",
        "schema",
        "row",
        "extra_member",
        "width",
        "cycle_path",
        "candidate_id",
        "year",
        "office",
        "district",
    ],
)
def test_zip_sources_and_exact_schema_fail_closed(change):
    register_external_adapters()
    body = zipped()
    if change == "extra_member":
        body = zipped(entries={"cn.txt": MASTER, "other.txt": "unexpected"})
    elif change == "width":
        body = zipped(MASTER + "|extra")
    elif change in {"candidate_id", "year", "office", "district"}:
        cells = MASTER.split("|")
        cells[{"candidate_id": 0, "year": 3, "office": 5, "district": 6}[change]] = {
            "candidate_id": "C00123456",
            "year": "",
            "office": "X",
            "district": "1",
        }[change]
        body = zipped("|".join(cells))
    metadata, loc = source(body), locator(body)
    if change == "hash":
        metadata["sha256"] = "0" * 64
    if change == "host":
        metadata["url"] = metadata["url"].replace(HOST, "example.com")
    if change == "authority":
        metadata["authority"] = "mn_cfb"
    if change == "member_hash":
        loc["member_sha256"] = "0" * 64
    if change == "member":
        loc["member"] = "../cn.txt"
    if change == "schema":
        loc["schema"] = "fec-ccl-7:v1"
    if change == "row":
        loc["row"] = True
    if change == "cycle_path":
        metadata["url"] = metadata["url"].replace("cn26.zip", "cn24.zip")
    with pytest.raises(ValueError):
        s.ADAPTERS["fec_candidate_master:v1"](body, metadata, loc)


def name_check(source_name, ballot_name, *, change=None):
    register_external_adapters()
    body = zipped(MASTER.replace("EXAMPLE, ALEX", source_name))
    metadata = source(body)
    proof = binding(
        body, metadata, locator(body, kind="name_rendering"), "fec_candidate_master:v1"
    )
    if change == "order":
        proof["facts"]["name_order"] = "given_family"
    if change == "candidate":
        proof["facts"]["source_candidate_id"] = "H6MN02222"
    return s.validate_federal_name_rendering(
        {"sources": [metadata]},
        {metadata["sha256"]: body},
        proof,
        source_candidate_id="H6MN01111",
        source_name=source_name,
        ballot_name=ballot_name,
    )


def test_name_case_and_declared_order_keep_both_literal_strings():
    assert name_check("EXAMPLE, ALEX", "Alex Example") is None


@pytest.mark.parametrize(
    "source_name,ballot_name",
    [
        ("EXAMPLE, ALEX MIDDLE", "Alex Example"),
        ("EXAMPLE, ALEX M.", "Alex Middle Example"),
        ("EXAMPLE, ALEX JR.", "Alex Example"),
        ("EXAMPLE, ALEX", "Al Example"),
        ("O'EXAMPLE, ALEX", "Alex OExample"),
        ("EXAMPLE, ALEX", "Alex  Example"),
        ("EXAMPLE, ALEX, JR.", "Alex Example Jr."),
    ],
)
def test_name_rendering_never_proves_alias_missing_parts_or_punctuation(
    source_name, ballot_name
):
    with pytest.raises((ValueError, s.ComparisonImportError)):
        name_check(source_name, ballot_name)


@pytest.mark.parametrize("change", ["order", "candidate"])
def test_name_order_and_candidate_cannot_be_spoofed(change):
    with pytest.raises(s.ComparisonImportError):
        name_check("EXAMPLE, ALEX", "Alex Example", change=change)


def test_candidate_fragments_are_not_read_before_account_designation(monkeypatch):
    generation, bodies, account, context, expected = chain()
    visited = []
    original_account = s.ADAPTERS[account["adapter"]]
    original_paper = s.ADAPTERS["fec_form2_pdf:v1"]

    def account_reader(*args):
        visited.append("account")
        return original_account(*args)

    def paper_reader(*args):
        assert visited and visited[0] == "account"
        visited.append("paper")
        return original_paper(*args)

    monkeypatch.setitem(s.ADAPTERS, account["adapter"], account_reader)
    monkeypatch.setitem(s.ADAPTERS, "fec_form2_pdf:v1", paper_reader)
    s.validate_federal_designation(generation, bodies, [*context, account], expected)
    assert visited == ["account", "paper", "paper", "paper", "paper"]


def test_principal_and_authorized_sources_cannot_be_mixed_or_relabeled():
    generation, bodies, principal, context, expected = chain()
    authorized_body = zipped(
        LINK.replace("C00123456", "C00654321").replace("|P|", "|A|"), member="ccl.txt"
    )
    metadata = source(authorized_body, "ccl26.zip")
    authorized = binding(
        authorized_body,
        metadata,
        locator(authorized_body, member="ccl.txt"),
        "fec_candidate_linkage:v1",
    )
    generation["sources"].append(metadata)
    bodies[metadata["sha256"]] = authorized_body
    authorized_expected = {
        **expected,
        "account_id": "C00654321",
        "designation_role": "authorized",
    }
    s.validate_federal_designation(
        generation, bodies, [authorized, *context], authorized_expected
    )
    with pytest.raises(s.ComparisonImportError):
        s.validate_federal_designation(
            generation, bodies, [principal, authorized, *context], authorized_expected
        )
    with pytest.raises(s.ComparisonImportError):
        s.validate_federal_designation(
            generation, bodies, [authorized, *context], expected
        )


def test_cycle_year_cannot_override_a_genuinely_different_candidate_election_year():
    generation, bodies, account, context, expected = chain()
    body = zipped(LINK.replace("|2026|2026|", "|2024|2026|"), member="ccl.txt")
    metadata = source(body, "ccl26.zip")
    proof = binding(
        body, metadata, locator(body, member="ccl.txt"), "fec_candidate_linkage:v1"
    )
    generation["sources"].append(metadata)
    bodies[metadata["sha256"]] = body
    with pytest.raises(s.ComparisonImportError, match="Binding fields differ"):
        s.validate_federal_designation(generation, bodies, [proof, *context], expected)


def test_master_principal_identity_fragment_keeps_literal_candidate_name():
    actual = extraction(zipped(), kind="account_candidate")
    assert actual.facts == {
        "authority": "fec",
        "source_candidate_id": "H6MN01111",
        "account_id": "C00123456",
        "candidate_name": "EXAMPLE, ALEX",
    }


@pytest.mark.parametrize(
    "row", [MASTER.replace("|MN|H|", "|MN|S|"), MASTER.replace("|MN|H|", "|WI|H|")]
)
def test_master_office_and_state_must_not_conflict_with_the_issued_candidate_id(row):
    with pytest.raises(ValueError):
        extraction(zipped(row))


def test_linkage_committee_office_conflict_does_not_hide_behind_paper_context():
    body = zipped(LINK.replace("|H|P|", "|S|P|"), member="ccl.txt")
    with pytest.raises(ValueError):
        extraction(body, file="ccl26.zip", member="ccl.txt")


@pytest.mark.parametrize(
    "field",
    [
        "account_id",
        "source_candidate_id",
        "election_year",
        "office",
        "state",
        "district",
    ],
)
def test_typed_designation_cannot_silently_drop_required_context(field):
    generation, bodies, account, context, expected = chain()
    expected.pop(field)
    with pytest.raises(s.ComparisonImportError, match="complete typed"):
        s.validate_federal_designation(
            generation, bodies, [account, *context], expected
        )
