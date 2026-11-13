"""Retained Ramsey, Maple Grove and Hennepin chains; no network, DB or approval.

Real originals and collector records are read from a private evidence folder
named by ALETHICAL_RETAINED_LOCAL_EVIDENCE. Without it the retained-chain tests
skip; the synthetic negative tests still run. Readings here are unreviewed
synthetic section proposals over the real PDF hashes: they test only context
replay, never a source reading, candidate, account or money approval.
"""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path

import pytest

from alethical.pipeline import election_local_context as c
from alethical.pipeline import election_source_provenance as p
from alethical.pipeline import election_source_readings as readings
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.pipeline.election_source_files import verified_source_files
from alethical.tests.test_election_source_files import Store, source

EVIDENCE = Path(os.environ.get("ALETHICAL_RETAINED_LOCAL_EVIDENCE", "/nonexistent"))
retained_only = pytest.mark.skipif(
    not (EVIDENCE / "local-source-capture" / "attempts.jsonl").is_file(),
    reason="private retained local evidence folder is not available",
)
LCR = "local-filing-recovery/"
ORIGINALS = {
    "c7354486a7563aed6ff2bdacb2306e275632e6e9da052053401f9019a2109c10": "full-coverage-federal-local/board-local-directory.html",
    "e3fca5db4cb4198208de15bd4f1dec9e262aadaa30a5ef46d6d85f82460c62d7": "authority-directory-capture/{h}.body",
    "1cd3b6b790d431a1311cd375ff81912a357fa4a82612512d2d46cd9807f0030c": "local-source-capture/{h}.body",
    "85a4c1d294545b6ce32bdc30b16c3cc3271345d7b2aa35d6f53932f8f2c0746e": LCR
    + "slice-6-execution-2026-11-12/large-sources/originals/{h}.body",
    "9898b72bb29036bccebfe044a15de5ce05ccc0f99979de7f8262bac86b831d03": LCR
    + "slice-4-execution-2026-11-12/originals/{h}.body",
    "9d33c658bda2c9c2deb1d710d7b2251fc8f2dc2c792196f4e75cac46dbf30cb2": LCR
    + "slice-5-execution-2026-11-12/originals/{h}.body",
    "a6186c85c60829a57a61a358568e3f700ff64e14d6d45c88e69949c2ab0423dd": LCR
    + "slice-6-execution-2026-11-12/originals/{h}.body",
    "513908360877892ea1e0a926677f5f4251cc50d0c05f00e68e22f205a8a1e9ec": LCR
    + "slice-7-execution-2026-11-12/ramsey-scoped/originals/{h}.body",
    "3094c6ba3f34ece36b4e8a4df786fc997303c564e22cba47b5ee63117a3c21e2": "local-source-capture/{h}.body",
    "e15e5bb94fc0d3404e77429f7ad1f82824878368468e28ba92d690ce335f9d9d": LCR
    + "forms/{h}.body",
    "cd1e815b8caf7b0ffd66b86d83f70d3f1acc231f08c67311cee300928d5d4265": LCR
    + "hennepin-all/{h}.body",
    "586f340fc7dbd29be989c3d9783f3526d520681e100fe0ef668cccbd23c92ace": LCR
    + "hennepin-account-catalogues/{h}.body",
    "0ae5bd8563009cb5bf2d176089ed74b94c1ae91c8b544db39eed20e277a88b01": LCR
    + "hennepin-account-catalogues/{h}.body",
    "8b47601f6709bce614b7c5e8643cf23af523afab8fa3200f3c824843d7e6d4d1": LCR
    + "hennepin-reports/{h}.body",
    "d998d3c2ac9bcbc4aca6ce1e1fea25eb700215367552e8b511a8e4369786d0dd": LCR
    + "hennepin-reports/{h}.body",
    "3300632fa26935fb291f92b64d0aa10be3fdb5a9da6f3dd34a0299708c76cf96": LCR
    + "hennepin-reports/{h}.body",
    "36c2ef47f2f9495ae7d4847e2d0c8ee7fd9ea18653e0e1bdd22d6a8bf6974e29": "2026-source-audit/LocalCandTbl.txt",
    "1830c4b1993606049c397c7f318cf36db33219d660b1528ba4df074ab8e5a570": "2026-source-audit/Cntytbl.txt",
}
BOARD, CITIES = (
    "c7354486a7563aed6ff2bdacb2306e275632e6e9da052053401f9019a2109c10",
    "e3fca5db4cb4198208de15bd4f1dec9e262aadaa30a5ef46d6d85f82460c62d7",
)
LOCAL_CAND = "36c2ef47f2f9495ae7d4847e2d0c8ee7fd9ea18653e0e1bdd22d6a8bf6974e29"
COUNTY_TBL = "1830c4b1993606049c397c7f318cf36db33219d660b1528ba4df074ab8e5a570"
# name: (evidence file, JSONL line or None for a whole JSON file, pointer)
CAPTURES = {
    "board": ("full-coverage-federal-local/fresh-route-manifest.json", None, "/0"),
    "cities": ("authority-directory-capture/inventory.json", None, "/0"),
    "maple_catalogue": ("local-source-capture/attempts.jsonl", 103, ""),
    "maple_pdf": (
        LCR + "slice-6-execution-2026-11-12/large-sources/source-inventory.json",
        None,
        "/0",
    ),
    "ramsey_root_body": (LCR + "slice-4-execution-2026-11-12/attempts.jsonl", 52, ""),
    "ramsey_redirects": (LCR + "slice-3-execution-2026-11-12/attempts.jsonl", 56, ""),
    "ramsey_elections": (LCR + "slice-5-execution-2026-11-12/attempts.jsonl", 6, ""),
    "ramsey_catalogue": (LCR + "slice-6-execution-2026-11-12/attempts.jsonl", 5, ""),
    "ramsey_pdf": (
        LCR + "slice-7-execution-2026-11-12/ramsey-scoped/source-inventory.json",
        None,
        "/0",
    ),
    "hennepin_root": ("local-source-capture/attempts.jsonl", 208, ""),
    "hennepin_first": (LCR + "forms/attempts.jsonl", 1, ""),
    "hennepin_all": (LCR + "hennepin-all/attempts.jsonl", 1, ""),
    "hennepin_catalogue_1237": (
        LCR + "hennepin-account-catalogues/attempts.jsonl",
        82,
        "",
    ),
    "hennepin_catalogue_1247": (
        LCR + "hennepin-account-catalogues/attempts.jsonl",
        126,
        "",
    ),
    "hennepin_pdf_1": (LCR + "hennepin-reports/attempts.jsonl", 61, ""),
    "hennepin_pdf_2": (LCR + "hennepin-reports/attempts.jsonl", 77, ""),
    "hennepin_pdf_3": (LCR + "hennepin-reports/attempts.jsonl", 78, ""),
    # Original retained SOS file manifest rows (no final URL, status or method).
    "sos_local_candidates": ("2026-source-audit/manifest.json", None, "/6"),
    "sos_county_table": ("2026-source-audit/manifest-additional.json", None, "/8"),
}
SOS_CAPTURE = {LOCAL_CAND: "sos_local_candidates", COUNTY_TBL: "sos_county_table"}
HENNEPIN_LISTING = "https://www16.co.hennepin.mn.us/cfrs/search_options.do?searchBy=candidate&city=&office=&district=&filterby=&alpha=&ps=284&pn=0"


SYNTHETIC = {}  # invented test-only bytes, keyed by hash; never retained evidence


def original(h):
    if h in SYNTHETIC:
        return SYNTHETIC[h]
    body = (EVIDENCE / ORIGINALS[h].format(h=h)).read_bytes()
    assert hashlib.sha256(body).hexdigest() == h
    return body


def evidence(name):
    rel, line, _ = CAPTURES[name]
    body = (EVIDENCE / rel).read_bytes()
    if line is not None:
        # The exact JSONL record line, including its newline, is the evidence unit.
        body = body.split(b"\n")[line - 1] + b"\n"
    return body


def captures():
    """Proposed acquisition receipts (never approval) with their exact evidence."""
    result = {}
    for name in CAPTURES:
        body = evidence(name)
        ref = result["ramsey_root_body"][0] if name == "ramsey_redirects" else None
        result[name] = (
            p.prepare_acquisition(body, CAPTURES[name][2], body_capture=ref),
            body,
        )
    return result


def anchor_at(h, href, occurrence=1, label=None):
    """Locate the nth literal href; returns index, exact-byte line, label, base."""
    doc = c._HTML(original(h))
    found = [
        (i, n)
        for i, n in enumerate(doc.all("a"), 1)
        if n.attrs.get("href") == href and label in (None, c._text(n))
    ]
    index, node = found[occurrence - 1]
    return index, node.line, c._text(node), doc.base("https://example.invalid/")[0]


def directory(acq, family, h, href, category, label=None):
    index, _, label, _ = anchor_at(h, href, label=label)
    facts = c.directory_entry_facts(original(h), family, index)
    assert (facts["category"], facts["label"], facts["href"]) == (category, label, href)
    return {
        "family": family,
        "source_sha256": h,
        "source_url": c.DIRECTORIES[family],
        "acquisition_receipt_id": p.digest(acq),
        **{k: facts[k] for k in ("anchor_index", "line", "label", "category", "href")},
        "base_href": facts["base_href"],
        "shared_target_entries": facts["shared_target_entries"],
    }


def sos_acquisition(h):
    rel, line, pointer = CAPTURES[SOS_CAPTURE[h]]
    assert line is None
    return p.prepare_acquisition((EVIDENCE / rel).read_bytes(), pointer)


def sos_rows(h, lines, kind="local_candidate", *, acquisition_receipt_id=None):
    body = original(h).split(b"\n")
    origin = acquisition_receipt_id or p.digest(sos_acquisition(h))
    return [
        {
            "source_sha256": h,
            "line": n,
            "literal": body[n - 1].removesuffix(b"\r").decode("cp1252"),
            "kind": kind,
            "acquisition_receipt_id": origin,
        }
        for n in lines
    ]


def roots(acq):
    board, cities = acq["board"][0], acq["cities"][0]

    def root(
        kind, sid, county_ids, rows, dirn, namespace, entry, dtype=None, mtype=None
    ):
        return {
            "schema": p.RECIPIENT,
            "original_routing_group": f"mn-local:{kind}:{sid}",
            "election_date": "2026-11-03",
            "recipient": {
                "namespace": kind,
                "source_id": sid,
                "district_type": dtype,
                "municipality_type": mtype,
                "county_ids": county_ids,
            },
            "sos_rows": rows,
            "directory": dirn,
            "publisher_namespace": namespace,
            "entry_url": entry,
            "claim_scope": "official_publisher_for_typed_recipient",
        }

    fam = "mn_cfb_local_directory"
    return {
        "ramsey": root(
            "municipality",
            "53026",
            ["02"],
            sos_rows(LOCAL_CAND, range(3842, 3847)),
            directory(
                cities,
                "mn_state_city_directory",
                CITIES,
                "http://www.ci.ramsey.mn.us/",
                "City",
            ),
            "ramsey-city-website",
            "http://www.ci.ramsey.mn.us/",
            mtype="city",
        ),
        "maple": root(
            "municipality",
            "40166",
            ["27"],
            sos_rows(LOCAL_CAND, range(2931, 2938)),
            directory(
                board,
                fam,
                BOARD,
                "https://www.maplegrovemn.gov/Archive.aspx?AMID=41",
                "City",
                "Maple Grove",
            ),
            "maple-grove-archive-center",
            "https://www.maplegrovemn.gov/Archive.aspx?AMID=41",
            mtype="city",
        ),
        "hennepin": root(
            "county",
            "27",
            ["27"],
            sos_rows(COUNTY_TBL, [27], "county"),
            directory(
                board,
                fam,
                BOARD,
                "http://www16.co.hennepin.mn.us/cfrs/search_options.do",
                "County",
                "Hennepin",
            ),
            "hennepin-cfrs",
            "http://www16.co.hennepin.mn.us/cfrs/search_options.do",
        ),
        "isd1": root(
            "school",
            "0001",
            ["01"],
            sos_rows(LOCAL_CAND, [5156, 5158, 5160, 5162]),
            directory(
                board,
                fam,
                BOARD,
                "https://home.isd1.org/school-board.html",
                "School District",
                "Aitkin (ISD 1)",
            ),
            "aitkin-isd1-website",
            "https://home.isd1.org/school-board.html",
            dtype="ISD",
        ),
        "ssd1": root(
            "school",
            "0001",
            ["27"],
            sos_rows(
                LOCAL_CAND, [5157, 5159, 5161, 5163, 6523, 6524, 6545, 6554, 6555]
            ),
            directory(
                board,
                fam,
                BOARD,
                "https://vote.minneapolismn.gov/candidates/campaign-finance/view-campaign-finance-reports/",
                "School District",
                "Minneapolis (SSD 1)",
            ),
            "minneapolis-elections-website",
            "https://vote.minneapolismn.gov/candidates/campaign-finance/view-campaign-finance-reports/",
            dtype="SSD",
        ),
    }


def anchor_edge(h, url, href, occurrence=1):
    index, line, label, base = anchor_at(h, href, occurrence)
    from urllib.parse import urljoin

    return {
        "kind": "html_anchor",
        "source_sha256": h,
        "anchor_index": index,
        "line": line,
        "href": href,
        "label": label,
        "base_href": base,
        "target_url": urljoin(url if base is None else urljoin(url, base), href),
    }


def acq_edge(acq, name):
    return {"kind": "acquisition", "receipt_id": p.digest(acq[name][0])}


def account_edge(account_id, name):
    h = "cd1e815b8caf7b0ffd66b86d83f70d3f1acc231f08c67311cee300928d5d4265"
    links = c._HTML(original(h)).all("a")
    found = [
        (i, n)
        for i, n in enumerate(links, 1)
        if c._text(n) == name and n.attrs.get("href") == "#"
    ]
    assert len(found) == 1
    index, line = found[0][0], found[0][1].line
    from urllib.parse import quote_plus

    return {
        "kind": "hennepin_account_form",
        "source_sha256": h,
        "anchor_index": index,
        "line": line,
        "name_as_source": name,
        "account_id": account_id,
        "target_url": "https://www16.co.hennepin.mn.us/cfrs/getreports.do?filterBy=&searchBy=candidate&fullname="
        + quote_plus(name)
        + f"&ids={account_id}&alpha=&city=&office=&district=&ps=284",
    }


def contexts(acq, root):
    rid = {k: p.digest(v) for k, v in root.items()}
    fields = {k: None for k in c.FIELD_KEYS} | {"name": "cover.name", "report_type": []}
    physical = {
        "kind": c.PHYSICAL_SECTION,
        "issued_id": False,
        "account_id": None,
        "name_as_source": None,
        "location": None,
        "office": None,
        "district": None,
    }
    ramsey_base = "https://www.cityoframseymn.gov/"
    ramsey = [
        acq_edge(acq, "ramsey_redirects"),
        anchor_edge(
            "9898b72bb29036bccebfe044a15de5ce05ccc0f99979de7f8262bac86b831d03",
            ramsey_base,
            "/city-hall/elections/",
        ),
        acq_edge(acq, "ramsey_elections"),
        anchor_edge(
            "9d33c658bda2c9c2deb1d710d7b2251fc8f2dc2c792196f4e75cac46dbf30cb2",
            ramsey_base + "city-hall/elections/",
            "/city-hall/elections/campaign-finance-reports/",
        ),
        acq_edge(acq, "ramsey_catalogue"),
        anchor_edge(
            "a6186c85c60829a57a61a358568e3f700ff64e14d6d45c88e69949c2ab0423dd",
            ramsey_base + "city-hall/elections/campaign-finance-reports/",
            "https://media-002-us.cdn.govstack.com/cityoframseymn-002-us/media/glsb1r24/2026-campaign-finance-report_11-10-26.pdf",
        ),
        acq_edge(acq, "ramsey_pdf"),
    ]
    maple = [
        acq_edge(acq, "maple_catalogue"),
        anchor_edge(
            "1cd3b6b790d431a1311cd375ff81912a357fa4a82612512d2d46cd9807f0030c",
            "https://www.maplegrovemn.gov/Archive.aspx?AMID=41",
            "Archive.aspx?ADID=107",
        ),
        acq_edge(acq, "maple_pdf"),
    ]
    prefix = [
        acq_edge(acq, "hennepin_root"),
        {
            "kind": "offered_get_form",
            "source_sha256": "3094c6ba3f34ece36b4e8a4df786fc997303c564e22cba47b5ee63117a3c21e2",
            "form_index": 1,
            "line": c._HTML(
                original(
                    "3094c6ba3f34ece36b4e8a4df786fc997303c564e22cba47b5ee63117a3c21e2"
                )
            )
            .all("form")[0]
            .line,
            "action": "search_options.do",
            "choices": {"searchBy": "candidate"},
            "target_url": "https://www16.co.hennepin.mn.us/cfrs/search_options.do?searchBy=candidate&city=&office=&district=",
        },
        acq_edge(acq, "hennepin_first"),
        anchor_edge(
            "e15e5bb94fc0d3404e77429f7ad1f82824878368468e28ba92d690ce335f9d9d",
            "https://www16.co.hennepin.mn.us/cfrs/search_options.do?searchBy=candidate&city=&office=&district=",
            "search_options.do?searchBy=candidate&city=&office=&district=&filterby=&alpha=&ps=284&pn=0",
        ),
        acq_edge(acq, "hennepin_all"),
    ]

    def hennepin(account_id, name, catalogue, cat_h, pdf_href, pdf):
        edge = account_edge(account_id, name)
        return prefix + [
            edge,
            acq_edge(acq, catalogue),
            anchor_edge(cat_h, edge["target_url"], pdf_href),
            acq_edge(acq, pdf),
        ]

    def account(account_id, name, office, district):
        return {
            "kind": c.HENNEPIN_ACCOUNT,
            "issued_id": True,
            "account_id": account_id,
            "name_as_source": name,
            "location": "Hennepin County",
            "office": office,
            "district": district,
        }

    def ctx(root_name, edges, acct, namespace):
        return {
            "kind": c.CONTEXT_KIND,
            "root_receipt_id": rid[root_name],
            "edges": edges,
            "publisher_account": acct | {"namespace": namespace},
            "document_role": "primary",
            "fields": deepcopy(fields),
            "recipient_binding": None,
        }

    cat_1237 = "586f340fc7dbd29be989c3d9783f3526d520681e100fe0ef668cccbd23c92ace"
    cat_1247 = "0ae5bd8563009cb5bf2d176089ed74b94c1ae91c8b544db39eed20e277a88b01"
    return {
        "ramsey": ctx("ramsey", ramsey, physical, "ramsey-city-website"),
        "maple": ctx("maple", maple, physical, "maple-grove-archive-center"),
        "hennepin_1237": ctx(
            "hennepin",
            hennepin(
                "1237",
                "Frazier, Cedrick",
                "hennepin_catalogue_1237",
                cat_1237,
                "getReport.pdf?seq=1&ids=1237",
                "hennepin_pdf_1",
            ),
            account("1237", "Frazier, Cedrick", "County Attorney", ""),
            "hennepin-cfrs",
        ),
        "hennepin_1247_seq2": ctx(
            "hennepin",
            hennepin(
                "1247",
                "Ibrahim, Abdihakim",
                "hennepin_catalogue_1247",
                cat_1247,
                "getReport.pdf?seq=2&ids=1247",
                "hennepin_pdf_2",
            ),
            account("1247", "Ibrahim, Abdihakim", "Commissioner", "3"),
            "hennepin-cfrs",
        ),
        "hennepin_1247_seq3": ctx(
            "hennepin",
            hennepin(
                "1247",
                "Ibrahim, Abdihakim",
                "hennepin_catalogue_1247",
                cat_1247,
                "getReport.pdf?seq=3&ids=1247",
                "hennepin_pdf_3",
            ),
            account("1247", "Ibrahim, Abdihakim", "Commissioner", "3"),
            "hennepin-cfrs",
        ),
    }


def synthetic_reading(original_sha256, *, page_size=(612, 792)):
    """An unreviewed v2 section proposal over a real PDF hash (no render)."""
    width, height = page_size
    field = readings.field_proposal(
        "cover.name",
        page=1,
        bounds=[10, 10, 300, 40],
        label="Committee name",
        literal="SYNTHETIC TEST PROPOSAL",
    )
    return {
        "schema": c.SECTION_SCHEMA,
        "verification_basis": "visual_source_check",
        "original_sha256": original_sha256,
        "document_kind": "financial_report",
        "pages": [
            {
                "page": 1,
                "width": width,
                "height": height,
                "image_sha256": "0" * 64,
                "render_profile": readings.RENDER_PROFILE,
                "transcript": "cover.name | Committee name | SYNTHETIC TEST PROPOSAL | value",
            }
        ],
        "fields": [field],
        "dependencies": [],
        "source_context": None,
        "reading_scope": {
            "cover": {"page": 1, "bounds": [0, 0, 612, 390]},
            "regions": [{"page": 1, "bounds": [0, 0, 612, 390], "role": "cover"}],
        },
    }


def candidate_form_reading(original_sha256, *, marked=True):
    """One physical name cell plus a separate Candidate box (synthetic proposal)."""
    reading = synthetic_reading(original_sha256)
    reading["fields"][0] = readings.field_proposal(
        "cover.name",
        page=1,
        bounds=[10, 10, 300, 40],
        label="Name of candidate or committee",
        literal="SYNTHETIC TEST PROPOSAL",
    )
    mark = readings.field_proposal(
        "cover.candidate",
        page=1,
        bounds=[310, 10, 330, 30],
        label="Candidate",
        literal="X" if marked else "",
        value_type="mark",
        state="value" if marked else "blank",
    )
    office = readings.field_proposal(
        "cover.office",
        page=1,
        bounds=[10, 50, 300, 80],
        label="Office sought",
        literal="SYNTHETIC OFFICE",
    )
    reading["fields"] = [reading["fields"][0], mark, office]
    reading["pages"][0]["transcript"] = "\n".join(
        f"{f['field_id']} | {f['label']} | {f['literal']} | {f['state']}"
        for f in reading["fields"]
    )
    return reading


def role_fields(**changes):
    value = {k: None for k in c.FIELD_KEYS} | {"report_type": []}
    value.update(
        name="cover.name",
        candidate_name="cover.name",
        candidate_mark="cover.candidate",
        office="cover.office",
    )
    value.update(changes)
    return value


@contextmanager
def verified(hashes):
    store, metadata = Store(), []
    for h in sorted(hashes):
        metadata.append(source(store, original(h), compression="raw", media_type=None))
    with verified_source_files(store, metadata) as files:
        yield files


def offline_proof(acq, root_receipts, names, root_names):
    """Pure stand-in for the DB verifier: replay each receipt, then seal."""
    receipts, outcomes = {}, {}
    ordered = sorted(
        names, key=lambda n: acq[n][0]["body_capture_receipt_id"] is not None
    )
    for n in ordered:
        receipt, body = acq[n]
        with verified({receipt["final"]["source_sha256"]}) as files:
            proof = p._context(receipts, {}, outcomes, {}, set())
            p.replay_acquisition(receipt, body, files, proof)
        receipts[p.digest(receipt)] = receipt
        outcomes[p.digest(receipt)] = True
    for r in root_names:
        with verified(p.source_hashes(root_receipts[r])) as files:
            proof = p._context(receipts, {}, outcomes, {}, set())
            c.replay_root(root_receipts[r], files, proof)
        receipts[p.digest(root_receipts[r])] = root_receipts[r]
        outcomes[p.digest(root_receipts[r])] = True
    return p._context(receipts, {}, outcomes, {}, set())


@pytest.fixture(scope="module")
def chain():
    acq = captures()
    root = roots(acq)
    return acq, root, contexts(acq, root)


def _replay(acq, root, ctx, root_name, *, reading=None, mutate=None):
    names = [n for n in acq]
    proof = offline_proof(acq, root, names, [root_name])
    final = ctx["edges"][-1]["receipt_id"]
    pdf = next(r for r, _ in acq.values() if p.digest(r) == final)["final"][
        "source_sha256"
    ]
    reading = reading or synthetic_reading(pdf)
    hashes = {
        e["source_sha256"] for e in ctx["edges"] if e["kind"] != "acquisition"
    } | {pdf}
    with verified(hashes) as files:
        return c.replay_local_context(ctx, reading, originals=files, provenance=proof)


# --- Retained positive replays ----------------------------------------------------


@retained_only
def test_three_retained_capture_variants_reproduce_exact_collector_facts(chain):
    acq, _, _ = chain
    redirect = acq["ramsey_redirects"][0]
    assert redirect["capture_kind"] == "response_hops"
    assert [(h["status"], h["location"]) for h in redirect["observed_hops"]] == [
        (301, "https://www.ci.ramsey.mn.us/"),
        (308, "https://www.cityoframseymn.gov/"),
    ]
    # Earlier hop observation and later separate body copy both survive.
    assert (
        redirect["observed_hops"][1]["observed_at"]
        == "2026-11-12T15:47:43.826488+00:00"
    )
    assert redirect["final"]["copied_at"] == "2026-11-12T16:02:56.303564+00:00"
    assert redirect["body_capture_receipt_id"] == p.digest(acq["ramsey_root_body"][0])
    maple = acq["maple_pdf"][0]
    assert [
        (h["method"], h["status"], h["location"]) for h in maple["observed_hops"]
    ] == [("GET", 302, "/ArchiveCenter/ViewFile/Item/107")]
    assert maple["final"]["byte_size"] == 40226764
    hennepin = acq["hennepin_root"][0]
    assert hennepin["capture_kind"] == "historical_collector_association"
    assert hennepin["observed_hops"] == [
        {
            "from": "http://www16.co.hennepin.mn.us/cfrs/search_options.do",
            "to": "https://www16.co.hennepin.mn.us/cfrs/search_options.do",
        }
    ]
    assert hennepin["requested"]["method"] is None
    assert (
        hennepin["evidence_sha256"]
        == "5105d37df1dbb8a5ba1b021c5ca02d0575ed623f1b8cf2d81dc54ca7512c022c"
    )
    assert len(acq["hennepin_root"][1]) == 2392
    board = acq["board"][0]
    assert board["final"]["media_type"] is None and board["requested"]["method"] is None
    assert (
        acq["ramsey_redirects"][0]["final"]["media_type"] == "text/html; charset=utf-8"
    )
    assert len(acq["maple_pdf"][1]) == 16389


@retained_only
@pytest.mark.parametrize(
    "name",
    ["ramsey", "maple", "hennepin_1237", "hennepin_1247_seq2", "hennepin_1247_seq3"],
)
def test_retained_chain_replays_to_exact_section_facts(chain, name):
    acq, root, ctx = chain
    root_name = "hennepin" if name.startswith("hennepin") else name
    result = _replay(acq, root, ctx[name], root_name)
    assert result["election_date"] == root[root_name]["election_date"] == "2026-11-03"
    report = result["report"]
    assert (
        report["effective"],
        report["version_scope"],
        report["amendment_status"],
    ) == (
        None,
        "exact_document",
        "not_established",
    )
    assert result["document_role"] == "primary"
    assert result["account"]["source_candidate_id"] is None
    if name == "ramsey":
        assert result["authority"]["key"] == "local:municipality:53026"
        assert result["authority"]["jurisdiction"]["county_ids"] == ["02"]
        assert result["account"]["issued_id"] is False
        assert result["document_link_label"] == "2026 Campaign Finance Reports (PDF)"
        assert report["source_report_id"] is None
    elif name == "maple":
        assert result["authority"]["key"] == "local:municipality:40166"
        assert (
            result["document_url"]
            == "https://www.maplegrovemn.gov/ArchiveCenter/ViewFile/Item/107"
        )
    else:
        assert result["authority"]["key"] == "local:county:27"
        assert result["authority"]["name"] == "Hennepin County"
        account = result["account"]["publisher_account"]
        assert account["location"] == "Hennepin County"
        seq = name.rsplit("seq", 1)[-1] if "seq" in name else "1"
        assert report["source_report_id"] == seq
        assert report["series_id"].endswith(f":{account['account_id']}:seq:{seq}")
    assert set(result["provenance_receipt_ids"]) >= {ctx[name]["root_receipt_id"]}


@retained_only
def test_all_fifteen_retained_literal_edges_replay(chain):
    acq, root, ctx = chain
    proof = offline_proof(acq, root, list(acq), list(root))
    edges = 0
    with verified({BOARD, CITIES, LOCAL_CAND, COUNTY_TBL}) as files:
        for name in ("ramsey", "maple", "hennepin", "isd1", "ssd1"):
            c.replay_root(root[name], files, proof)
            edges += 1
    # Anoka-Hennepin (ISD 11) proves only that host and recipient type differ.
    anoka = "https://www.anokacounty.us/2987/Campaign-Financial-Reports"
    doc = c._HTML(original(BOARD))
    # One county-hosted publisher URL is listed for three different school districts.
    shared = [c._text(n) for n in doc.all("a") if n.attrs.get("href") == anoka]
    assert shared == [
        "Anoka-Hennepin (ISD 11)",
        "Fridley (ISD 14)",
        "Spring Lake Park (ISD 16)",
    ]
    index, line, label, base = anchor_at(BOARD, anoka, 1)
    entry = {
        "family": "mn_cfb_local_directory",
        "source_url": c.DIRECTORIES["mn_cfb_local_directory"],
        "anchor_index": index,
        "line": line,
        "href": "https://www.anokacounty.us/2987/Campaign-Financial-Reports",
        "label": label,
        "category": "School District",
        "base_href": base,
        "shared_target_entries": c.directory_entry_facts(
            original(BOARD), "mn_cfb_local_directory", index
        )["shared_target_entries"],
    }
    # The shared target is recorded, naming the 2 sibling school districts.
    assert [e["label"] for e in entry["shared_target_entries"]] == [
        "Fridley (ISD 14)",
        "Spring Lake Park (ISD 16)",
    ]
    assert (
        c._directory_entry(doc, entry) == entry["href"]
        and label == "Anoka-Hennepin (ISD 11)"
    )
    with pytest.raises(ComparisonImportError):
        c._directory_entry(doc, entry | {"category": "County"})
    edges += 1
    # The Board's older Ramsey archive route is retained literally but unused:
    # the independent root chain starts at the state cities directory instead.
    old_ramsey = "https://www.ci.ramsey.mn.us/Archive.aspx?AMID=37"
    index, line, label, base = anchor_at(BOARD, old_ramsey, label="Ramsey")
    assert (
        c._directory_entry(
            doc,
            entry
            | {
                "anchor_index": index,
                "line": line,
                "href": old_ramsey,
                "label": label,
                "category": "City",
                "shared_target_entries": [],
            },
        )
        == old_ramsey
    )
    edges += 1
    seen = set()
    for context in ctx.values():
        position = None
        for edge in context["edges"]:
            if edge["kind"] == "acquisition":
                position = next(
                    r for r, _ in acq.values() if p.digest(r) == edge["receipt_id"]
                )["final"]["url"]
                continue
            key = (edge["source_sha256"], edge.get("line"), edge.get("href"))
            if edge["kind"] == "html_anchor" and key not in seen:
                seen.add(key)
                assert (
                    c.replay_html_anchor(
                        original(edge["source_sha256"]), position, edge
                    )
                    == edge["target_url"]
                )
                edges += 1
    # Ramsey's elections page repeats the identical catalogue navigation.
    second = anchor_edge(
        "9d33c658bda2c9c2deb1d710d7b2251fc8f2dc2c792196f4e75cac46dbf30cb2",
        "https://www.cityoframseymn.gov/city-hall/elections/",
        "/city-hall/elections/campaign-finance-reports/",
    )
    assert (
        c.replay_html_anchor(
            original(second["source_sha256"]),
            "https://www.cityoframseymn.gov/city-hall/elections/",
            second,
        )
        == "https://www.cityoframseymn.gov/city-hall/elections/campaign-finance-reports/"
    )
    assert edges == 15


@retained_only
def test_school_isd_and_ssd_are_distinct_recipient_subjects(chain):
    _, root, _ = chain
    isd, ssd = root["isd1"], root["ssd1"]
    assert (
        isd["original_routing_group"]
        == ssd["original_routing_group"]
        == "mn-local:school:0001"
    )
    assert p.subject_key(isd) != p.subject_key(ssd)


# --- Retained negative cases ------------------------------------------------------


def _root_fails(acq, root, receipt):
    proof = offline_proof(acq, root, ["board", "cities"], [])
    with verified({BOARD, CITIES, LOCAL_CAND, COUNTY_TBL}) as files:
        with pytest.raises(ComparisonImportError):
            c.validate_root_receipt(receipt)
            c.replay_root(receipt, files, proof)


@retained_only
@pytest.mark.parametrize(
    "change",
    [
        "isd_as_ssd",
        "ssd_rows_on_isd_entry",
        "maple_township",
        "ramsey_county_62",
        "wrong_category",
        "spoofed_id",
        "label",
        "fabricated_entry",
        "unreviewed_directory",
        "literal_row",
        "county_scope",
    ],
)
def test_root_refuses_wrong_typed_recipient(chain, change):
    acq, root, _ = chain
    if change == "isd_as_ssd":
        receipt = deepcopy(root["isd1"])
        receipt["recipient"]["district_type"] = "SSD"
    elif change == "ssd_rows_on_isd_entry":
        receipt = deepcopy(root["ssd1"])
        receipt["directory"] = deepcopy(root["isd1"]["directory"])
        receipt["entry_url"] = root["isd1"]["entry_url"]
    elif change == "maple_township":
        receipt = deepcopy(root["maple"])
        receipt["recipient"].update(
            source_id="40130", municipality_type="town", county_ids=["03"]
        )
        receipt["original_routing_group"] = "mn-local:municipality:40130"
        receipt["sos_rows"] = sos_rows(LOCAL_CAND, [2928, 2929, 2930])
        receipt["directory"]["category"] = "Township"
    elif change == "ramsey_county_62":
        receipt = deepcopy(root["hennepin"])
        receipt["recipient"].update(source_id="62", county_ids=["62"])
        receipt["original_routing_group"] = "mn-local:county:62"
        receipt["sos_rows"] = sos_rows(COUNTY_TBL, [62], "county")
        receipt["directory"] = deepcopy(root["ramsey"]["directory"])
        receipt["directory"]["category"] = "County"
    elif change == "wrong_category":
        receipt = deepcopy(root["maple"])
        receipt["directory"]["category"] = "County"
    elif change == "spoofed_id":
        receipt = deepcopy(root["ramsey"])
        receipt["recipient"]["source_id"] = "40166"
        receipt["original_routing_group"] = "mn-local:municipality:40166"
    elif change == "label":
        receipt = deepcopy(root["maple"])
        receipt["directory"]["label"] = "Ramsey"
    elif change == "fabricated_entry":
        receipt = deepcopy(root["hennepin"])
        receipt["entry_url"] = "https://www16.co.hennepin.mn.us/cfrs/search_options.do"
    elif change == "unreviewed_directory":
        receipt = deepcopy(root["maple"])
        receipt["directory"]["acquisition_receipt_id"] = p.digest(
            acq["maple_catalogue"][0]
        )
    elif change == "literal_row":
        receipt = deepcopy(root["ramsey"])
        receipt["sos_rows"][0]["literal"] = receipt["sos_rows"][0]["literal"].replace(
            "02;", "62;"
        )
    else:
        receipt = deepcopy(root["ramsey"])
        receipt["recipient"]["county_ids"] = ["02", "27"]
    _root_fails(acq, root, receipt)


@retained_only
@pytest.mark.parametrize(
    "change",
    [
        "municipal_account_as_county",
        "other_account_pdf",
        "case_folded_filterby",
        "invented_page_size",
        "form_index",
        "account_name",
        "skipped_all_link",
        "wrong_root",
        "reordered_query",
        "namespace",
        "section_account_literals",
        "office",
    ],
)
def test_hennepin_chain_refuses_unbound_or_altered_navigation(chain, change):
    acq, root, ctx = chain
    context = deepcopy(ctx["hennepin_1237"])
    edges = context["edges"]
    if change == "municipal_account_as_county":
        # A real Minneapolis-located account on the same county-hosted portal.
        listing = c._HTML(original(edges[5]["source_sha256"]))
        name = next(
            c._text(n)
            for n in listing.all("a")
            if n.attrs.get("href") == "#"
            and "getElementById('ids')" in n.attrs.get("onclick", "")
            and [c._text(td) for td in c._ancestor(n, "tr").children if td.tag == "td"][
                4
            ]
            == "Minneapolis"
        )
        row = next(
            n
            for n in listing.all("a")
            if c._text(n) == name and n.attrs.get("href") == "#"
        )
        cells = [
            c._text(td) for td in c._ancestor(row, "tr").children if td.tag == "td"
        ]
        assignment = c._ASSIGN.fullmatch(row.attrs["onclick"])
        assert assignment is not None
        account_id = assignment[2]
        edges[5] = account_edge(account_id, name)
        context["publisher_account"].update(
            account_id=account_id,
            name_as_source=name,
            location=cells[4],
            office=cells[5],
            district=cells[6],
        )
    elif change == "other_account_pdf":
        edges[6:] = deepcopy(ctx["hennepin_1247_seq2"]["edges"][6:])
    elif change == "case_folded_filterby":
        edges[5]["target_url"] = edges[5]["target_url"].replace(
            "filterBy=", "filterby="
        )
    elif change == "invented_page_size":
        edges[3]["target_url"] = edges[3]["target_url"].replace("ps=284", "ps=500")
    elif change == "form_index":
        edges[1]["form_index"] = 2
    elif change == "account_name":
        edges[5]["name_as_source"] = "Ibrahim, Abdihakim"
        context["publisher_account"]["name_as_source"] = "Ibrahim, Abdihakim"
    elif change == "skipped_all_link":
        del edges[3:5]
    elif change == "wrong_root":
        context["root_receipt_id"] = p.digest(root["ssd1"])
    elif change == "reordered_query":
        edges[1]["target_url"] = (
            "https://www16.co.hennepin.mn.us/cfrs/search_options.do?city=&searchBy=candidate&office=&district="
        )
    elif change == "namespace":
        context["publisher_account"]["namespace"] = "minneapolis-elections-website"
    elif change == "section_account_literals":
        context["publisher_account"]["kind"] = c.PHYSICAL_SECTION
        context["publisher_account"]["issued_id"] = False
    else:
        context["publisher_account"]["office"] = "Commissioner"
    root_name = "ssd1" if change == "wrong_root" else "hennepin"
    with pytest.raises(ComparisonImportError):
        _replay(acq, root, context, root_name)


@retained_only
@pytest.mark.parametrize(
    "change",
    [
        "raw_source",
        "unreached_original",
        "ramsey_without_redirect",
        "media_header",
        "neighbor_reading",
        "v1_reading",
        "role",
    ],
)
def test_city_chain_refuses_forged_or_shortcut_sources(chain, change):
    acq, root, ctx = chain
    context = deepcopy(ctx["maple"])
    root_name, reading = "maple", None
    if change == "raw_source":
        context["edges"][1]["source_sha256"] = BOARD
    elif change == "unreached_original":
        reading = synthetic_reading("51390836" + "0" * 56)
    elif change == "ramsey_without_redirect":
        context = deepcopy(ctx["ramsey"])
        context["edges"][0] = acq_edge(acq, "ramsey_root_body")
        root_name = "ramsey"
    elif change == "media_header":
        forged = deepcopy(acq)
        forged["maple_catalogue"][0]["final"]["media_type"] = "application/pdf"
        context["edges"][0] = {
            "kind": "acquisition",
            "receipt_id": p.digest(forged["maple_catalogue"][0]),
        }
        acq = forged
    elif change == "neighbor_reading":
        reading = synthetic_reading(
            "85a4c1d294545b6ce32bdc30b16c3cc3271345d7b2aa35d6f53932f8f2c0746e"
        )
        reading["fields"][0]["record_type"] = "disbursement"
    elif change == "v1_reading":
        reading = synthetic_reading(
            "85a4c1d294545b6ce32bdc30b16c3cc3271345d7b2aa35d6f53932f8f2c0746e"
        )
        reading["schema"] = readings.SCHEMA
        del reading["reading_scope"]
    else:
        context["document_role"] = "supplement"
    with pytest.raises(ComparisonImportError):
        _replay(acq, root, context, root_name, reading=reading)


# --- Synthetic primitives (always run) ---------------------------------------------

PAGE = "https://publisher.example/list/"


def _edge(body, index, href, label, *, base=None):
    from urllib.parse import urljoin

    doc = c._HTML(body)
    node = doc.all("a")[index - 1]
    return {
        "kind": "html_anchor",
        "source_sha256": hashlib.sha256(body).hexdigest(),
        "anchor_index": index,
        "line": node.line,
        "href": href,
        "label": label,
        "base_href": base,
        "target_url": urljoin(urljoin(PAGE, base) if base else PAGE, href),
    }


@pytest.mark.parametrize(
    "body,href",
    [
        (b'<html><a href="javascript:go()">Report</a></html>', "javascript:go()"),
        (b'<html><a href="data:text/html,x">Report</a></html>', "data:text/html,x"),
        (b'<html><a href="#">Report</a></html>', "#"),
        (b'<html><a href="r.pdf" href="s.pdf">Report</a></html>', "r.pdf"),
        (
            b'<html><base href="/a/"><base href="/b/"><a href="r.pdf">Report</a></html>',
            "r.pdf",
        ),
        (b'<html><a href="x"><a href="r.pdf">Report</a></a></html>', "r.pdf"),
    ],
)
def test_anchor_refuses_script_data_fragment_duplicate_base_and_nested(body, href):
    index = len(c._HTML(body).all("a"))
    with pytest.raises(ComparisonImportError):
        c.replay_html_anchor(body, PAGE, _edge(body, index, href, "Report"))


def test_anchor_keeps_literal_query_identity_and_entities():
    body = b'<html><a href="r.do?filterBy=&amp;ids=1">Report &amp; list</a></html>'
    edge = _edge(body, 1, "r.do?filterBy=&ids=1", "Report & list")
    assert c.replay_html_anchor(body, PAGE, edge).endswith("r.do?filterBy=&ids=1")
    edge["target_url"] = edge["target_url"].replace("filterBy", "filterby")
    with pytest.raises(ComparisonImportError):
        c.replay_html_anchor(body, PAGE, edge)


FORM = b"""<html><form action="find.do">
<input type="radio" name="kind" value="candidate"><input type="radio" name="kind" value="fund">
<select name="city"><option value="" selected>Any</option><option value="X">X</option></select>
<input type="hidden" name="ps" value="10">
<button type="button" onclick="javascript:document.forms[0].submit();">Go</button>
</form></html>"""


def _form_edge(choices, target):
    return {
        "kind": "offered_get_form",
        "source_sha256": hashlib.sha256(FORM).hexdigest(),
        "form_index": 1,
        "line": 1,
        "action": "find.do",
        "choices": choices,
        "target_url": target,
    }


def test_offered_form_serializes_only_actual_controls():
    edge = _form_edge(
        {"kind": "candidate"}, PAGE + "find.do?kind=candidate&city=&ps=10"
    )
    assert c.replay_offered_get_form(FORM, PAGE, edge) == edge["target_url"]


@pytest.mark.parametrize(
    "choices,target",
    [
        ({"kind": "everyone"}, "find.do?kind=everyone&city=&ps=10"),
        ({"kind": "candidate", "ps": "284"}, "find.do?kind=candidate&city=&ps=284"),
        ({"kind": "candidate"}, "find.do?kind=candidate&city=&ps=10&pn=0"),
        ({"kind": "candidate", "pages": "1"}, "find.do?kind=candidate&city=&ps=10"),
        ({"kind": "candidate"}, "find.do?city=&kind=candidate&ps=10"),
    ],
)
def test_offered_form_refuses_invented_values_and_parameters(choices, target):
    with pytest.raises(ComparisonImportError):
        c.replay_offered_get_form(FORM, PAGE, _form_edge(choices, PAGE + target))


def test_offered_form_refuses_post_and_missing_submission():
    edge = _form_edge(
        {"kind": "candidate"}, PAGE + "find.do?kind=candidate&city=&ps=10"
    )
    with pytest.raises(ComparisonImportError):
        c.replay_offered_get_form(
            FORM.replace(b"<form action", b'<form method="post" action'), PAGE, edge
        )
    with pytest.raises(ComparisonImportError):
        c.replay_offered_get_form(FORM.replace(b"onclick", b"data-x"), PAGE, edge)


ACCOUNT = """<html><script>function sub(){
	frm = document.forms[0];
	frm.action="getreports.do"
	frm.submit();
	}</script><form action="search.do">
<select name="filterBy"><option value="">&nbsp;</option><option value="all">All</option></select>
<table><thead><tr><th data-field="candidate_name">N</th><th data-field="location">L</th><th data-field="office">O</th><th data-field="district">D</th></tr></thead>
<tr><td><a href="#" onclick="document.getElementById('fullname').value='Doe, Jo';
 document.getElementById('ids').value='12';	sub();">Doe, Jo</a></td><td>Hennepin County </td><td>Sheriff</td><td></td></tr></table>
<input type="hidden" name="fullname" id="fullname"><input type="hidden" name="ids" id="ids"><input type="hidden" name="ps" value='5'>
</form></html>"""
LISTING = "https://www16.co.hennepin.mn.us/cfrs/search_options.do?x=1"


def _account(body):
    return {
        "kind": "hennepin_account_form",
        "source_sha256": hashlib.sha256(body.encode()).hexdigest(),
        "anchor_index": 1,
        "line": 8,
        "name_as_source": "Doe, Jo",
        "account_id": "12",
        "target_url": "https://www16.co.hennepin.mn.us/cfrs/getreports.do?filterBy=&fullname=Doe%2C+Jo&ids=12&ps=5",
    }


def test_account_selector_follows_fixed_grammar_without_running_script():
    target, row = c.replay_hennepin_account_form(
        ACCOUNT.encode(), LISTING, _account(ACCOUNT)
    )
    assert target.endswith("filterBy=&fullname=Doe%2C+Jo&ids=12&ps=5")
    assert row == {"location": "Hennepin County", "office": "Sheriff", "district": ""}


@pytest.mark.parametrize(
    "old,new",
    [
        ('frm.action="getreports.do"', 'frm.action="steal.do"'),
        ("frm = document.forms[0];", "frm = document.forms[1];"),
        ('sub();">', 'sub();alert(1);">'),
        ("'12';", "'13';"),
        ('id="ids"', 'id="ids2"'),
        ("</script>", "function sub(){}</script>"),
        ('<form action="search.do">', '<form action="search.do" method="post">'),
        (
            '<input type="hidden" name="ps"',
            '<input type="hidden" name="ids" id="ids"><input type="hidden" name="ps"',
        ),
        ('<th data-field="district">D</th>', ""),
    ],
)
def test_account_selector_refuses_altered_grammar(old, new):
    body = ACCOUNT.replace(old, new)
    assert body != ACCOUNT
    with pytest.raises(ComparisonImportError):
        c.replay_hennepin_account_form(body.encode(), LISTING, _account(ACCOUNT))


def test_account_selector_is_only_for_the_fixed_listing_host():
    with pytest.raises(ComparisonImportError):
        c.replay_hennepin_account_form(
            ACCOUNT.encode(),
            "https://evil.example/cfrs/search_options.do",
            _account(ACCOUNT),
        )


def test_context_shape_is_closed_and_needs_a_section_reading():
    context = {
        "kind": c.CONTEXT_KIND,
        "root_receipt_id": "a" * 64,
        "edges": [
            {"kind": "acquisition", "receipt_id": "b" * 64},
            {
                "kind": "html_anchor",
                "source_sha256": "c" * 64,
                "anchor_index": 1,
                "line": 1,
                "href": "r.pdf",
                "label": "Report",
                "base_href": None,
                "target_url": "https://x.example/r.pdf",
            },
            {"kind": "acquisition", "receipt_id": "d" * 64},
        ],
        "publisher_account": {
            "kind": c.PHYSICAL_SECTION,
            "namespace": "x-site",
            "issued_id": False,
            "account_id": None,
            "name_as_source": None,
            "location": None,
            "office": None,
            "district": None,
        },
        "document_role": "primary",
        "fields": {k: None for k in c.FIELD_KEYS}
        | {"name": "cover.name", "report_type": []},
        "recipient_binding": None,
    }
    reading = synthetic_reading("e" * 64)
    c.validate_context_shape(context, reading)
    assert c.context_dependencies(context) == {
        "provenance_receipt_ids": ["a" * 64, "b" * 64, "d" * 64],
        "public_original_hashes": ["c" * 64],
    }
    for mutate in (
        lambda x, r: x.update(accepted=True),
        lambda x, r: x["edges"].insert(1, x["edges"][0]),
        lambda x, r: x["edges"][1].update(kind="script"),
        lambda x, r: x["publisher_account"].update(account_id="ADID:107"),
        lambda x, r: x["fields"].update(name="cover.absent"),
        lambda x, r: r.update(schema=readings.SCHEMA),
        lambda x, r: x.update(document_role="certification"),
    ):
        changed, changed_reading = deepcopy(context), deepcopy(reading)
        mutate(changed, changed_reading)
        with pytest.raises(ComparisonImportError):
            c.validate_context_shape(changed, changed_reading)


# --- One printed name cell serving account name and candidate_name ------------------


def _shape_context(fields):
    return {
        "kind": c.CONTEXT_KIND,
        "root_receipt_id": "a" * 64,
        "edges": [
            {"kind": "acquisition", "receipt_id": "b" * 64},
            {
                "kind": "html_anchor",
                "source_sha256": "c" * 64,
                "anchor_index": 1,
                "line": 1,
                "href": "r.pdf",
                "label": "Report",
                "base_href": None,
                "target_url": "https://x.example/r.pdf",
            },
            {"kind": "acquisition", "receipt_id": "d" * 64},
        ],
        "publisher_account": {
            "kind": c.PHYSICAL_SECTION,
            "namespace": "x-site",
            "issued_id": False,
            "account_id": None,
            "name_as_source": None,
            "location": None,
            "office": None,
            "district": None,
        },
        "document_role": "primary",
        "fields": fields,
        "recipient_binding": None,
    }


def test_shared_name_cell_is_the_only_allowed_role_reuse():
    reading = candidate_form_reading("e" * 64)
    c.validate_context_shape(_shape_context(role_fields()), reading)
    for changes in (
        {"office": "cover.name"},
        {"period_start": "cover.name"},
        {"report_type": ["cover.name"]},
        {"candidate_name": "cover.office"},
        {"candidate_mark": "cover.name"},
        {
            "office": "cover.office",
            "name": "cover.office",
            "candidate_name": "cover.office",
        },
    ):
        with pytest.raises(ComparisonImportError):
            c.validate_context_shape(_shape_context(role_fields(**changes)), reading)


@retained_only
def test_shared_name_cell_replays_as_candidate_name_only_with_checked_mark(chain):
    acq, root, ctx = chain
    pdf = "85a4c1d294545b6ce32bdc30b16c3cc3271345d7b2aa35d6f53932f8f2c0746e"
    context = deepcopy(ctx["maple"])
    context["fields"] = role_fields()
    result = _replay(acq, root, context, "maple", reading=candidate_form_reading(pdf))
    assert (
        result["account"]["name"]
        == result["account"]["candidate_name"]
        == ("SYNTHETIC TEST PROPOSAL")
    )
    assert result["office_literal"] == "SYNTHETIC OFFICE"
    # Unmarked box: reusing the cell as candidate_name is refused.
    unmarked = candidate_form_reading(pdf, marked=False)
    with pytest.raises(ComparisonImportError, match="Candidate name requires"):
        _replay(acq, root, context, "maple", reading=unmarked)
    # Unmarked or committee form keeps candidate_name unknown, name intact.
    committee = deepcopy(context)
    committee["fields"] = role_fields(candidate_name=None, candidate_mark=None)
    result = _replay(acq, root, committee, "maple", reading=unmarked)
    assert result["account"]["candidate_name"] is None
    assert result["account"]["name"] == "SYNTHETIC TEST PROPOSAL"


# --- Independent review regressions (defects 1-3, literal links, raw spaces) ----------

FAIRVIEW = (
    "https://www.fairviewtwpmn.com/index.asp?SEC=B3D5EA89-A859-4C2A-A127-8D022F0A00B0"
)
RAMSEY_SHARED = "https://www.ramseycounty.us/residents/elections-voting/candidates/campaign-finance/campaign-finance-reports"


def _root(kind, sid, counties, rows, entry, namespace, *, mtype=None, dtype=None):
    acq = captures()
    receipt = roots(acq)["maple"] | {
        "original_routing_group": f"mn-local:{kind}:{sid}",
        "recipient": {
            "namespace": kind,
            "source_id": sid,
            "district_type": dtype,
            "municipality_type": mtype,
            "county_ids": counties,
        },
        "sos_rows": rows,
        "directory": entry,
        "publisher_namespace": namespace,
        "entry_url": entry["href"],
    }
    return acq, receipt


def _replay_roots(acq, receipts):
    return offline_proof(acq, receipts, list(acq), list(receipts))


@retained_only
@pytest.mark.parametrize(
    "code,county,lines", [("20366", "11", [1573, 1574]), ("20384", "42", [1575, 1576])]
)
def test_one_township_label_cannot_bind_two_same_named_towns(code, county, lines):
    acq = captures()
    entry = directory(
        acq["board"][0],
        "mn_cfb_local_directory",
        BOARD,
        FAIRVIEW,
        "Township",
        "Fairview",
    )
    acq, receipt = _root(
        "municipality",
        code,
        [county],
        sos_rows(LOCAL_CAND, lines),
        entry,
        "fairview-township-website",
        mtype="town",
    )
    with pytest.raises(ComparisonImportError, match="same name"):
        _replay_roots(acq, {"fairview": receipt})


@retained_only
def test_unambiguous_township_name_still_replays():
    # Maple Grove Township 40130 has no same-type duplicate; only the label check
    # of its own category applies (it is not in the Board Township list).
    acq = captures()
    receipt = roots(acq)["maple"]
    assert _replay_roots(acq, {"maple": receipt}).recipient(p.digest(receipt))


def _shared_world(acq):
    fam = "mn_cfb_local_directory"
    board = acq["board"][0]
    county = _root(
        "county",
        "62",
        ["62"],
        sos_rows(COUNTY_TBL, [62], "county"),
        directory(board, fam, BOARD, RAMSEY_SHARED, "County", "Ramsey"),
        "ramsey-county-website",
    )[1]
    city = _root(
        "municipality",
        "55852",
        ["62"],
        sos_rows(LOCAL_CAND, [4013]),
        directory(board, fam, BOARD, RAMSEY_SHARED, "City", "Roseville"),
        "ramsey-county-website",
        mtype="city",
    )[1]
    return {"county": county, "city": city}


def _shared_section(acq, receipts, page_html, *, binding=None):
    """Invented downstream page and PDF (never a real capture or approval)."""
    pdf = b"%PDF-1.4 synthetic shared-publisher regression body\n"
    page_hash, pdf_hash = (hashlib.sha256(b).hexdigest() for b in (page_html, pdf))
    SYNTHETIC.update({page_hash: page_html, pdf_hash: pdf})

    def capture_receipt(body, url_, media):
        record = {
            "requested_url": url_,
            "fetched_at": "2026-11-12T00:00:00+00:00",
            "state": "captured",
            "redirects": [],
            "final_url": url_,
            "sha256": hashlib.sha256(body).hexdigest(),
            "bytes": len(body),
            "content_type": media,
        }
        evidence = json.dumps(record).encode()
        return p.prepare_acquisition(evidence), evidence

    pdf_url = "https://www.ramseycounty.us/synthetic/report.pdf"
    page_acq = capture_receipt(page_html, RAMSEY_SHARED, "text/html")
    pdf_acq = capture_receipt(pdf, pdf_url, "application/pdf")
    store, metadata = Store(), []
    for body in (page_html, pdf):
        metadata.append(source(store, body, compression="raw", media_type=None))
    sealed = _replay_roots(acq | {"page": page_acq, "pdf": pdf_acq}, receipts)
    doc = c._HTML(page_html)
    links = doc.all("a")
    index = next(
        i
        for i, n in enumerate(links, 1)
        if n.attrs.get("href") == "/synthetic/report.pdf"
    )
    edge = {
        "kind": "html_anchor",
        "source_sha256": page_hash,
        "anchor_index": index,
        "line": links[index - 1].line,
        "href": "/synthetic/report.pdf",
        "label": c._text(links[index - 1]),
        "base_href": None,
        "target_url": pdf_url,
    }
    results = {}
    for name, receipt in receipts.items():
        context = {
            "kind": c.CONTEXT_KIND,
            "root_receipt_id": p.digest(receipt),
            "edges": [
                {"kind": "acquisition", "receipt_id": p.digest(page_acq[0])},
                edge,
                {"kind": "acquisition", "receipt_id": p.digest(pdf_acq[0])},
            ],
            "publisher_account": {
                "kind": c.PHYSICAL_SECTION,
                "namespace": "ramsey-county-website",
                "issued_id": False,
                "account_id": None,
                "name_as_source": None,
                "location": None,
                "office": None,
                "district": None,
            },
            "document_role": "primary",
            "fields": {k: None for k in c.FIELD_KEYS}
            | {"name": "cover.name", "report_type": []},
            "recipient_binding": binding(doc, index) if binding else None,
        }
        with verified_source_files(store, metadata) as files:
            try:
                results[name] = c.replay_local_context(
                    context,
                    synthetic_reading(pdf_hash),
                    originals=files,
                    provenance=sealed,
                )["authority"]["key"]
            except ComparisonImportError as exc:
                results[name] = "refused: " + str(exc)
    return results


@retained_only
def test_shared_publisher_page_cannot_assign_a_section_by_reviewer_choice():
    acq = captures()
    page = b'<html><body><h2>Reports</h2><a href="/synthetic/report.pdf">Report</a></body></html>'
    results = _shared_section(acq, _shared_world(acq), page)
    assert all(v.startswith("refused") for v in results.values()), results


def _unreviewed_row_root():
    acq = captures()
    receipt = roots(acq)["hennepin"]
    note = b"reviewer-made note, not a Secretary of State file\n\n27;Hennepin;395\n"
    receipt["sos_rows"] = [
        {
            "source_sha256": hashlib.sha256(note).hexdigest(),
            "line": 3,
            "literal": "27;Hennepin;395",
            "kind": "county",
        }
    ]
    return acq, receipt, note


@retained_only
def test_reviewer_note_imitating_an_official_row_is_refused():
    acq, receipt, note = _unreviewed_row_root()
    store = Store()
    metadata = [
        source(store, note, compression="raw", media_type=None),
        source(store, original(BOARD), compression="raw", media_type=None),
    ]
    proof = offline_proof(acq, {}, ["board"], [])
    with (
        verified_source_files(store, metadata) as files,
        pytest.raises(ComparisonImportError),
    ):
        c.validate_root_receipt(receipt)
        c.replay_root(receipt, files, proof)


@pytest.mark.parametrize(
    "wrapper,visible",
    [
        ("<template>{a}</template>", False),
        ("<noscript>{a}</noscript>", False),
        ("<div hidden>{a}</div>", False),
        ("<div><p hidden=hidden><span>{a}</span></p></div>", False),
        ("<svg><defs>{a}</defs></svg>", False),
        ("<svg><symbol id=s>{a}</symbol></svg>", False),
        ("<svg>{a}</svg>", True),
        ("<div><span>{a}</span></div>", True),
    ],
)
def test_only_rendered_literal_links_count(wrapper, visible):
    anchor = '<a href="/x.pdf">Report</a>'
    body = ("<html><body>" + wrapper.format(a=anchor) + "</body></html>").encode()
    edge = {
        "anchor_index": 1,
        "line": 1,
        "href": "/x.pdf",
        "label": "Report",
        "base_href": None,
        "target_url": "https://example.gov/x.pdf",
    }
    if visible:
        assert (
            c.replay_html_anchor(body, "https://example.gov/page", edge)
            == edge["target_url"]
        )
    else:
        with pytest.raises(ComparisonImportError, match="not rendered"):
            c.replay_html_anchor(body, "https://example.gov/page", edge)


WABASHA = "local-filing-recovery/wabasha-seven-execution-20261112/"


@retained_only
@pytest.mark.parametrize("line", range(1, 8))
def test_wabasha_raw_space_urls_keep_literal_and_wire_identity(line):
    lines = (EVIDENCE / WABASHA / "batch-02/attempts.jsonl").read_bytes().split(b"\n")
    body_evidence = lines[line - 1] + b"\n"
    record = json.loads(body_evidence)
    body = p.prepare_acquisition(body_evidence)
    assert (
        body["requested"]["url"] == record["requested_url"]
        and " " in body["requested"]["url"]
    )
    assert (
        body["requested"]["wire_url"]
        == record["response_hops"][-1]["prepared_request_url"]
    )
    issuer = (EVIDENCE / WABASHA / "batch-01/attempts.jsonl").read_bytes().split(b"\n")[
        line - 1
    ] + b"\n"
    held = p.prepare_acquisition(issuer, body_capture=body)
    assert held["capture_kind"] == "response_hops"
    assert held["observed_hops"][0]["status"] == 302
    assert (
        held["requested"]["wire_url"]
        == json.loads(issuer)["response_hops"][0]["prepared_request_url"]
    )


@pytest.mark.parametrize(
    "value",
    [
        "https://exa mple.gov/x",
        "https://example.gov/a\tb",
        "https://example.gov/a\nb",
        " https://example.gov/x",
        "https://example.gov/x ",
        "https://example.gov/a b#frag",
        "ht tps://example.gov/x",
    ],
)
def test_raw_space_support_does_not_admit_other_forbidden_url_forms(value):
    with pytest.raises(ComparisonImportError):
        p.url(value)


def _heading_binding(position=1, tag="h2", text=None):
    def build(doc, index):
        node = doc.all("a")[index - 1]
        heading = [
            n for n in doc.nodes[: doc.nodes.index(node)] if n.tag in c.HEADINGS
        ][-1]
        return {
            "kind": "preceding_heading",
            "edge_position": position,
            "heading_tag": heading.tag if tag is None else tag,
            "heading_line": heading.line,
            "heading_text": c._text(heading) if text is None else text,
        }

    return build


@retained_only
@pytest.mark.parametrize(
    "heading,expected",
    [
        ("City of Roseville", {"city": "local:municipality:55852"}),
        ("Roseville", {"city": "local:municipality:55852"}),
        ("Ramsey County", {"county": "local:county:62"}),
        ("Reports", {}),
        ("White Bear Township", {}),
    ],
)
def test_shared_publisher_section_binds_only_the_recipient_its_heading_names(
    heading, expected
):
    acq = captures()
    page = (
        "<html><body><h2>Reports</h2><h3>"
        + heading
        + '</h3><ul><li><a href="/synthetic/report.pdf">Report</a></li></ul></body></html>'
    ).encode()
    results = _shared_section(
        acq, _shared_world(acq), page, binding=_heading_binding(tag="h3")
    )
    accepted = {k: v for k, v in results.items() if not v.startswith("refused")}
    assert accepted == expected, results


@retained_only
@pytest.mark.parametrize(
    "page,tag,text",
    [
        (
            b'<html><h3 hidden>City of Roseville</h3><a href="/synthetic/report.pdf">Report</a></html>',
            "h3",
            None,
        ),
        (
            b'<html><h3>City of Roseville</h3><h4>Archive</h4><a href="/synthetic/report.pdf">Report</a></html>',
            "h3",
            "City of Roseville",
        ),
        (
            b'<html><h3>City of Roseville</h3><a href="/synthetic/report.pdf">Report</a></html>',
            "h2",
            None,
        ),
    ],
)
def test_heading_binding_refuses_hidden_stale_or_mislocated_headings(page, tag, text):
    acq = captures()
    results = _shared_section(
        acq, _shared_world(acq), page, binding=_heading_binding(tag=tag, text=text)
    )
    assert all(v.startswith("refused") for v in results.values()), results


@retained_only
def test_unshared_root_needs_no_binding_and_steps_carry_media_type(chain):
    acq, root, ctx = chain
    assert root["maple"]["directory"]["shared_target_entries"] == []
    result = _replay(acq, root, ctx["maple"], "maple")
    steps = [s for s in result["source_chain"] if s["kind"] == "acquisition"]
    assert [s["media_type"] for s in steps] == [
        "text/html; charset=utf-8",
        "application/pdf",
    ]
    assert steps[-1]["copied_at"] == "2026-11-12T16:29:03.751870+00:00"


@retained_only
def test_manifest_record_cannot_be_a_navigation_step(chain):
    acq, root, ctx = chain
    context = deepcopy(ctx["maple"])
    context["edges"][0] = {
        "kind": "acquisition",
        "receipt_id": p.digest(acq["sos_local_candidates"][0]),
    }
    with pytest.raises(ComparisonImportError, match="replayed source position"):
        _replay(acq, root, context, "maple")


@retained_only
def test_state_cities_page_navigation_links_are_not_city_entries():
    doc = c._HTML(original(CITIES))
    english = next(i for i, n in enumerate(doc.all("a"), 1) if c._text(n) == "English")
    with pytest.raises(ComparisonImportError, match="category list"):
        c.directory_entry_facts(original(CITIES), "mn_state_city_directory", english)
    elko = next(i for i, n in enumerate(doc.all("a"), 1) if c._text(n) == "Elko")
    facts = c.directory_entry_facts(original(CITIES), "mn_state_city_directory", elko)
    assert [e["label"] for e in facts["shared_target_entries"]] == ["New Market"]


def test_directory_label_repeated_in_its_category_is_refused():
    body = (
        '<html><base href="/"><div class="link-list col-md-3"><h2>Township</h2><ul class="link-list">'
        '<li class="link-item"><a href="https://a.example/">Lincoln</a></li>'
        '<li class="link-item"><a href="https://b.example/">Lincoln</a></li></ul></div></html>'
    ).encode()
    facts = c.directory_entry_facts(body, "mn_cfb_local_directory", 1)
    entry = {
        "family": "mn_cfb_local_directory",
        "source_url": c.DIRECTORIES["mn_cfb_local_directory"],
        **facts,
    }
    with pytest.raises(ComparisonImportError, match="repeats"):
        c._directory_entry(c._HTML(body), entry)


DISCLOSED = """<html><script>
	function onRowClick(id) {
		var summaryIdentifier = "#doc" + id;
		var hiddenStatus = !document.querySelector(summaryIdentifier).hidden
		document.querySelector(summaryIdentifier).hidden = hiddenStatus;
		var rowIdentifier = "#rowExpStatus" +id;
		document.querySelector(rowIdentifier).innerHTML = hiddenStatus ? "+" : "-";
	};</script><table><tbody>
<tr id="4" onClick="onRowClick(4)"><td id="rowExpStatus4"> + </td></tr>
<tr id="doc4" hidden=true class="detailDocRow"><td><a href="getReport.pdf?seq=1&ids=9">Download Document</a></td></tr>
</tbody></table></html>"""


@pytest.mark.parametrize(
    "old,new,ok",
    [
        ("", "", True),
        ('onClick="onRowClick(4)"', 'onClick="onRowClick(5)"', False),
        ('onClick="onRowClick(4)"', "", False),
        ('hiddenStatus ? "+" : "-"', "fetch('/x')", False),
        ('class="detailDocRow"', 'class="other"', False),
        ("<tbody>", "<tbody><template>", False),
        ('<tr id="4"', '<tr hidden id="4"', False),
    ],
)
def test_only_the_fixed_offered_row_disclosure_reveals_a_hidden_link(old, new, ok):
    body = DISCLOSED.replace(old, new).encode() if old else DISCLOSED.encode()
    links = c._HTML(body).all("a")
    edge = {
        "anchor_index": len(links),
        "line": links[-1].line,
        "href": "getReport.pdf?seq=1&ids=9",
        "label": "Download Document",
        "base_href": None,
        "target_url": "https://www16.co.hennepin.mn.us/cfrs/getReport.pdf?seq=1&ids=9",
    }
    page = "https://www16.co.hennepin.mn.us/cfrs/getreports.do?x=1"
    if ok:
        assert c.replay_html_anchor(body, page, edge) == edge["target_url"]
    else:
        with pytest.raises(ComparisonImportError):
            c.replay_html_anchor(body, page, edge)


WABASHA_CATALOGUE = "26e4ef1e774eb14754007f272c108893a25b9c26e90043805675421f1158cb09"
WABASHA_COUNTY_PAGE = "291643bbc19244a348adb81da3cc55e37676c32bc505c1aace76f940452084ba"


@retained_only
def test_wabasha_catalogue_links_replay_but_the_base_resolution_gap_holds():
    ORIGINALS[WABASHA_CATALOGUE] = (
        "local-filing-recovery/retained-filing-next17-execution-20261112/batch-01/originals/{h}.body"
    )
    ORIGINALS[WABASHA_COUNTY_PAGE] = "local-source-capture/{h}.body"
    catalogue = "https://www.co.wabasha.mn.us/departments/auditor_treasurer/election_information/campaign_finance_reports.php"
    href = "Auditor-Treasurer/Campaign Finance Reports/2026/Holst, Courtney SWCD D1 Under $750.pdf?t=202606101419500"
    index, line, label, base = anchor_at(WABASHA_CATALOGUE, href)
    edge = {
        "anchor_index": index,
        "line": line,
        "href": href,
        "label": label,
        "base_href": base,
        "target_url": "https://www.co.wabasha.mn.us/" + href,
    }
    assert (
        c.replay_html_anchor(original(WABASHA_CATALOGUE), catalogue, edge)
        == edge["target_url"]
    )
    issuer = json.loads(
        (EVIDENCE / WABASHA / "batch-01/attempts.jsonl").read_bytes().split(b"\n")[0]
    )
    assert (
        p.wire_url(edge["target_url"])
        == issuer["response_hops"][0]["prepared_request_url"]
    )
    # G1 stays held: the Board-reached page's <base> resolves the index link elsewhere.
    county = "https://www.co.wabasha.mn.us/departments/auditor_treasurer/campaign_finance_reports.php"
    index, line, label, base = anchor_at(
        WABASHA_COUNTY_PAGE, "departments/auditor_treasurer/index.php"
    )
    held = {
        "anchor_index": index,
        "line": line,
        "href": "departments/auditor_treasurer/index.php",
        "label": label,
        "base_href": base,
        "target_url": "https://www.co.wabasha.mn.us/departments/auditor_treasurer/index.php",
    }
    with pytest.raises(ComparisonImportError, match="target differs"):
        c.replay_html_anchor(original(WABASHA_COUNTY_PAGE), county, held)


def test_collector_wire_serialization_must_match_the_literal_request():
    url_ = "https://files.example/a b/c.pdf"
    record = {
        "request_id": "r",
        "method": "GET",
        "requested_url": url_,
        "started_at": "2026-11-12T00:00:00+00:00",
        "finished_at": "2026-11-12T00:00:01+00:00",
        "state": "captured",
        "final_url": url_,
        "sha256": "a" * 64,
        "bytes": 10,
        "response_hops": [
            {
                "requested_url": url_,
                "prepared_request_url": "https://files.example/a%20b/c.pdf",
                "method": "GET",
                "http_status": 200,
                "headers": {"Content-Type": "application/pdf"},
                "at": "2026-11-12T00:00:00.5+00:00",
            }
        ],
    }
    receipt = p.prepare_acquisition(json.dumps(record).encode())
    assert receipt["requested"]["wire_url"] == "https://files.example/a%20b/c.pdf"
    assert receipt["final"]["wire_url"] == "https://files.example/a%20b/c.pdf"
    record["response_hops"][0]["prepared_request_url"] = (
        "https://files.example/a+b/c.pdf"
    )
    with pytest.raises(ComparisonImportError, match="serialization"):
        p.prepare_acquisition(json.dumps(record).encode())


@pytest.mark.parametrize(
    "wrapper",
    [
        '<div style="display:none">{a}</div>',
        '<div style="visibility:hidden">{a}</div>',
        '<div style="opacity:0">{a}</div>',
        '<div style="clip-path:inset(100%)">{a}</div>',
        "<div inert>{a}</div>",
        '<style>.private {{display:none}}</style><div class="private">{a}</div>',
        '<style>@media screen {{ .private {{visibility:hidden}} }}</style><div class="private">{a}</div>',
    ],
)
def test_obscured_links_do_not_establish_navigation(wrapper):
    body = (
        "<html><body>"
        + wrapper.format(a='<a href="/report.pdf">Report</a>')
        + "</body></html>"
    ).encode()
    doc = c._HTML(body)
    node = doc.all("a")[0]
    with pytest.raises(ComparisonImportError):
        c.replay_html_anchor(
            body,
            PAGE,
            {
                "anchor_index": 1,
                "line": node.line,
                "href": "/report.pdf",
                "label": "Report",
                "base_href": None,
                "target_url": c.urljoin(PAGE, "/report.pdf"),
            },
        )


@pytest.mark.parametrize(
    "old,new",
    [
        ("<a href=", "<a hidden href="),
        ("<a href=", "<a inert href="),
        ("<script>", '<script type="application/json">'),
        ('<tr id="4"', '<tr style="display:none" id="4"'),
        ('<tr id="4"', '<tr inert id="4"'),
        ('<tr id="doc4"', '<tr style="visibility:hidden" id="doc4"'),
    ],
)
def test_disclosure_never_overrides_another_hidden_or_nonexecutable_state(old, new):
    test_only_the_fixed_offered_row_disclosure_reveals_a_hidden_link(old, new, False)


@pytest.mark.parametrize(
    "wrapper",
    [
        "<template>{form}</template>",
        "<div hidden>{form}</div>",
        "<div inert>{form}</div>",
        '<div style="display:none">{form}</div>',
    ],
)
def test_unusable_form_is_not_an_offered_path(wrapper):
    form = '<form action="/reports" method="get"><select name="year"><option>2026</option></select><button>Show</button></form>'
    body = ("<html><body>" + wrapper.format(form=form) + "</body></html>").encode()
    with pytest.raises(ComparisonImportError):
        c.replay_offered_get_form(
            body,
            PAGE,
            {
                "form_index": 1,
                "line": 1,
                "action": "/reports",
                "choices": {"year": "2026"},
                "target_url": c.urljoin(PAGE, "/reports?year=2026"),
            },
        )


@pytest.mark.parametrize(
    "attribute", ["hidden", "disabled", "inert", 'style="display:none"']
)
def test_unusable_submitter_is_not_an_offered_path(attribute):
    body = f'<html><form action="/reports"><input type="hidden" name="year" value="2026"><button {attribute}>Show</button></form></html>'.encode()
    with pytest.raises(ComparisonImportError):
        c.replay_offered_get_form(
            body,
            PAGE,
            {
                "form_index": 1,
                "line": 1,
                "action": "/reports",
                "choices": {},
                "target_url": c.urljoin(PAGE, "/reports?year=2026"),
            },
        )


@retained_only
@pytest.mark.parametrize(
    "inner",
    [
        '<section><h2>City of Roseville</h2><p>No reports here</p></section><section aria-label="Ramsey County"><a href="/synthetic/report.pdf">Report</a></section>',
        '<section><h2>Ramsey County</h2><aside><h3>City of Roseville</h3></aside><a href="/synthetic/report.pdf">Report</a></section>',
        '<h2 style="display:none">City of Roseville</h2><a href="/synthetic/report.pdf">Report</a>',
        '<h2>City of <span hidden>Roseville</span></h2><a href="/synthetic/report.pdf">Report</a>',
    ],
)
def test_recipient_heading_must_visibly_own_the_document_group(inner):
    acq = captures()
    results = _shared_section(
        acq,
        _shared_world(acq),
        ("<html><body>" + inner + "</body></html>").encode(),
        binding=_heading_binding(tag=None),
    )
    assert results["city"].startswith("refused:"), results


def test_shared_targets_use_transport_space_identity_without_rewriting_literals():
    body = b'<html><div class="link-list"><h2>County</h2><ul class="link-list"><li class="link-item"><a href="https://example.gov/report files?q=a%26b">Ramsey</a></li></ul></div><div class="link-list"><h2>City</h2><ul class="link-list"><li class="link-item"><a href="https://example.gov/report%20files?q=a%26b">Roseville</a></li><li class="link-item"><a href="https://example.gov/report%20files?q=a&b">Other</a></li></ul></div></html>'
    facts = [
        c.directory_entry_facts(body, "mn_cfb_local_directory", n) for n in (1, 2, 3)
    ]
    assert [e["label"] for e in facts[0]["shared_target_entries"]] == ["Roseville"]
    assert [e["label"] for e in facts[1]["shared_target_entries"]] == ["Ramsey"]
    assert facts[2]["shared_target_entries"] == []
    assert facts[0]["href"] == "https://example.gov/report files?q=a%26b"


@pytest.mark.parametrize(
    "selector",
    [
        '[data-note="x y"]',
        ":is(.other, a)",
        ':is(.other, [data-note="x y"])',
        r"a\000020",
        '[data-note="unclosed',
    ],
)
def test_uncertain_obscuring_selectors_cannot_prove_navigation(selector):
    body = (
        "<html><style>"
        + selector
        + '{display:none}</style><a data-note="x y" href="/r.pdf">Report</a></html>'
    ).encode()
    with pytest.raises(ComparisonImportError):
        c.replay_html_anchor(
            body,
            PAGE,
            {
                "anchor_index": 1,
                "line": 1,
                "href": "/r.pdf",
                "label": "Report",
                "base_href": None,
                "target_url": c.urljoin(PAGE, "/r.pdf"),
            },
        )


def test_unrelated_obscuring_styles_do_not_hide_visible_literal_text():
    body = b'<html><style>.private {display:none} aside a {visibility:hidden}</style><h2>City of <span class="private">Other</span>Roseville</h2><a href="/r.pdf">Report</a></html>'
    doc = c._HTML(body)
    assert c._text(doc.all("h2")[0]) == "City of Roseville"
    # The fixed conservative rule cannot establish whether an ancestor-only
    # condition applies; it holds a possibly affected anchor, not unrelated text.
    assert not c._rendered(doc.all("a")[0])


def test_fixed_disclosure_is_not_a_generic_script_execution_primitive():
    with pytest.raises(ComparisonImportError):
        c.replay_html_anchor(
            DISCLOSED.encode(),
            PAGE,
            {
                "anchor_index": 1,
                "line": c._HTML(DISCLOSED.encode()).all("a")[0].line,
                "href": "getReport.pdf?seq=1&ids=9",
                "label": "Download Document",
                "base_href": None,
                "target_url": c.urljoin(PAGE, "getReport.pdf?seq=1&ids=9"),
            },
        )


@retained_only
def test_recipient_binding_cannot_borrow_an_earlier_navigation_edge(chain):
    _, _, contexts = chain
    context = deepcopy(contexts["ramsey"])
    anchors = [i for i, e in enumerate(context["edges"]) if e["kind"] == "html_anchor"]
    assert len(anchors) > 1
    context["recipient_binding"] = {
        "kind": "preceding_heading",
        "edge_position": anchors[0],
        "heading_tag": "h2",
        "heading_line": 1,
        "heading_text": "City of Ramsey",
    }
    with pytest.raises(ComparisonImportError, match="Invalid recipient binding"):
        c.validate_context_shape(context, synthetic_reading("a" * 64))


@retained_only
def test_county_heading_still_owns_its_link_despite_unrelated_sidebar():
    acq = captures()
    page = b'<html><body><section><h2>Ramsey County</h2><aside><h3>City of Roseville</h3></aside><ul><li><a href="/synthetic/report.pdf">Report</a></li></ul></section></body></html>'

    def binding(doc, index):
        heading = doc.all("h2")[0]
        return {
            "kind": "preceding_heading",
            "edge_position": 1,
            "heading_tag": heading.tag,
            "heading_line": heading.line,
            "heading_text": c._text(heading),
        }

    results = _shared_section(acq, _shared_world(acq), page, binding=binding)
    assert results["county"] == "local:county:62"
    assert results["city"].startswith("refused:")


@retained_only
def test_shared_wire_alias_cannot_assign_one_document_to_two_recipients(monkeypatch):
    acq = captures()
    urls = {
        "county": "https://www.ramseycounty.us/report files",
        "city": "https://www.ramseycounty.us/report%20files",
    }
    directory_body = f'''<html><body>
<div class="link-list"><h2>County</h2><ul class="link-list"><li class="link-item"><a href="{urls["county"]}">Ramsey</a></li></ul></div>
<div class="link-list"><h2>City</h2><ul class="link-list"><li class="link-item"><a href="{urls["city"]}">Roseville</a></li></ul></div>
</body></html>'''.encode()
    h = hashlib.sha256(directory_body).hexdigest()
    SYNTHETIC[h] = directory_body
    url = c.DIRECTORIES["mn_cfb_local_directory"]
    evidence = json.dumps(
        {
            "url": url,
            "final_url": url,
            "bytes": len(directory_body),
            "sha256": h,
            "checked_at": "2026-11-12T00:00:00+00:00",
            "status": 200,
            "hit_safety_byte_limit": False,
        }
    ).encode()
    capture = p.prepare_acquisition(evidence)
    recipients = _shared_world(acq)
    for n, name in enumerate(["county", "city"], 1):
        root = recipients[name]
        root["directory"] = {
            "family": "mn_cfb_local_directory",
            "source_sha256": h,
            "source_url": url,
            "acquisition_receipt_id": p.digest(capture),
            **c.directory_entry_facts(directory_body, "mn_cfb_local_directory", n),
        }
        root["entry_url"] = urls[name]
        assert len(root["directory"]["shared_target_entries"]) == 1
        # This synthetic capture uses the exact as-filed spelling for each root.
        # Both transport spellings must require explicit recipient proof.
        monkeypatch.setitem(globals(), "RAMSEY_SHARED", urls[name])
        result = _shared_section(
            acq | {"board": (capture, evidence)},
            {name: root},
            b'<html><body><a href="/synthetic/report.pdf">Report</a></body></html>',
        )
        assert result[name].startswith("refused:"), result


def test_hidden_input_is_a_value_not_an_offered_submission_trigger():
    body = b'<html><form action="/reports"><input type="hidden" name="year" value="2026" onclick="document.forms[0].submit()"></form></html>'
    with pytest.raises(ComparisonImportError, match="submission"):
        c.replay_offered_get_form(
            body,
            PAGE,
            {
                "form_index": 1,
                "line": 1,
                "action": "/reports",
                "choices": {},
                "target_url": c.urljoin(PAGE, "/reports?year=2026"),
            },
        )


def test_ordinary_hidden_input_keeps_its_value_with_a_visible_submitter():
    body = b'<html><form action="/reports"><input type="hidden" name="year" value="2026"><button>Show</button></form></html>'
    edge = {
        "form_index": 1,
        "line": 1,
        "action": "/reports",
        "choices": {},
        "target_url": c.urljoin(PAGE, "/reports?year=2026"),
    }
    assert c.replay_offered_get_form(body, PAGE, edge) == edge["target_url"]


@retained_only
@pytest.mark.parametrize(
    "paint",
    [
        "#0000",
        "#00000000",
        "rgb(0 0 0 / 0)",
        "rgba(0,0,0,0)",
        "color(srgb 0 0 0 / 0)",
        "var(--hidden)",
        "inherit",
    ],
)
def test_unsupported_recipient_paint_is_not_visible_identity(paint):
    acq = captures()
    page = (
        '<html><body><h2>City of <span style="color:'
        + paint
        + '">Roseville</span></h2><a href="/synthetic/report.pdf">Report</a></body></html>'
    ).encode()
    result = _shared_section(
        acq, _shared_world(acq), page, binding=_heading_binding(tag=None)
    )
    assert result["city"].startswith("refused:"), result


@retained_only
@pytest.mark.parametrize("opening", ["", " open"])
def test_only_statically_open_dialog_offers_recipient_group(opening):
    acq = captures()
    page = (
        "<html><body><dialog"
        + opening
        + '><h2>City of Roseville</h2><a href="/synthetic/report.pdf">Report</a></dialog></body></html>'
    ).encode()
    result = _shared_section(
        acq, _shared_world(acq), page, binding=_heading_binding(tag=None)
    )
    if opening:
        assert result["city"] == "local:municipality:55852"
    else:
        assert result["city"].startswith("refused:"), result


@pytest.mark.parametrize(
    "controls",
    [
        '<fieldset disabled><input type="hidden" name="jurisdiction" value="roseville"></fieldset>',
        '<fieldset disabled><legend><input type="hidden" name="jurisdiction" value="roseville"></legend></fieldset>',
        '<select name="jurisdiction"><option selected disabled value="roseville">Roseville</option><option value="ramsey">Ramsey</option></select>',
        '<select name="jurisdiction"><option disabled value="roseville">Roseville</option><option value="ramsey">Ramsey</option></select>',
        '<select name="jurisdiction"><optgroup disabled><option selected value="roseville">Roseville</option></optgroup><option value="ramsey">Ramsey</option></select>',
        '<select size="2" name="jurisdiction"><option value="roseville">Roseville</option><option value="ramsey">Ramsey</option></select>',
    ],
)
def test_unsupported_form_defaults_cannot_invent_jurisdiction(controls):
    body = (
        '<html><form action="/reports">'
        + controls
        + "<button>Show</button></form></html>"
    ).encode()
    with pytest.raises(ComparisonImportError):
        c.replay_offered_get_form(
            body,
            PAGE,
            {
                "form_index": 1,
                "line": 1,
                "action": "/reports",
                "choices": {},
                "target_url": c.urljoin(PAGE, "/reports?jurisdiction=roseville"),
            },
        )


@pytest.mark.parametrize(
    "controls,choice,jurisdiction",
    [
        (
            '<input type="hidden" name="jurisdiction" value="roseville">',
            {},
            "roseville",
        ),
        (
            '<select name="jurisdiction"><option value="roseville">Roseville</option><option value="ramsey">Ramsey</option></select>',
            {},
            "roseville",
        ),
        (
            '<select name="jurisdiction"><option value="roseville">Roseville</option><option selected value="ramsey">Ramsey</option></select>',
            {},
            "ramsey",
        ),
        (
            '<select name="jurisdiction"><option disabled value="roseville">Roseville</option><option value="ramsey">Ramsey</option></select>',
            {"jurisdiction": "ramsey"},
            "ramsey",
        ),
    ],
)
def test_supported_form_defaults_and_exact_choices_still_replay(
    controls, choice, jurisdiction
):
    body = (
        '<html><form action="/reports">'
        + controls
        + "<button>Show</button></form></html>"
    ).encode()
    edge = {
        "form_index": 1,
        "line": 1,
        "action": "/reports",
        "choices": choice,
        "target_url": c.urljoin(PAGE, "/reports?jurisdiction=" + jurisdiction),
    }
    assert c.replay_offered_get_form(body, PAGE, edge) == edge["target_url"]


@retained_only
@pytest.mark.parametrize("paint", ["#000", "#003865", "black", "rgb(0, 24, 62)"])
def test_closed_opaque_paint_subset_preserves_recipient_text(paint):
    acq = captures()
    page = (
        '<html><body><h2>City of <span style="color:'
        + paint
        + '">Roseville</span></h2><a href="/synthetic/report.pdf">Report</a></body></html>'
    ).encode()
    result = _shared_section(
        acq, _shared_world(acq), page, binding=_heading_binding(tag=None)
    )
    assert result["city"] == "local:municipality:55852", result


@pytest.mark.parametrize(
    "submitter",
    [
        '<button name="jurisdiction" value="roseville">Show</button>',
        '<input type="image" alt="Show">',
        '<button formaction="/other">Show</button>',
        '<button formmethod="post">Show</button>',
        '<button onclick="return false">Show</button>',
    ],
)
def test_unsupported_submitter_cannot_invent_a_get_request(submitter):
    body = (
        '<html><form action="/reports"><input type="hidden" name="year" value="2026">'
        + submitter
        + "</form></html>"
    ).encode()
    with pytest.raises(ComparisonImportError):
        c.replay_offered_get_form(
            body,
            PAGE,
            {
                "form_index": 1,
                "line": 1,
                "action": "/reports",
                "choices": {},
                "target_url": c.urljoin(PAGE, "/reports?year=2026"),
            },
        )


def test_multiple_checked_radio_defaults_are_held_until_an_exact_choice():
    body = b'<html><form action="/reports"><input type="radio" name="jurisdiction" checked value="roseville"><input type="radio" name="jurisdiction" checked value="ramsey"><button>Show</button></form></html>'
    edge = {
        "form_index": 1,
        "line": 1,
        "action": "/reports",
        "choices": {},
        "target_url": c.urljoin(
            PAGE, "/reports?jurisdiction=roseville&jurisdiction=ramsey"
        ),
    }
    with pytest.raises(ComparisonImportError):
        c.replay_offered_get_form(body, PAGE, edge)
    edge["choices"] = {"jurisdiction": "ramsey"}
    edge["target_url"] = c.urljoin(PAGE, "/reports?jurisdiction=ramsey")
    assert c.replay_offered_get_form(body, PAGE, edge) == edge["target_url"]
