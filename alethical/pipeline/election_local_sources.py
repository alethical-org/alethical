"""Fixed local source adapters: observed cells and separately checked context.

A publisher/catalogue group key is internal and non-issued. These adapters never
join a ballot candidacy, infer an alias, turn purpose into payee, or approve OCR.
Current external dispatch must explicitly supply a fresh VerifiedReadingContext;
registration alone cannot make local claims checked.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from html.parser import HTMLParser
import hashlib
import json
import re
from typing import TypedDict
from urllib.parse import urljoin, urlsplit

from alethical.pipeline.election_comparison import ComparisonImportError, digest
from alethical.pipeline.election_external_finance import (
    CheckedExtraction,
    ordered_period,
)
from alethical.pipeline.election_local_financial_form import read_native_local_report
from alethical.pipeline import election_source_readings as readings

CONTEXT_KIND = "crow_wing_catalogue:v1"
CONTEXT_FIELDS = {
    "kind",
    "county_source_sha256",
    "publisher_source_sha256",
    "catalogue_source_sha256",
    "county_row",
    "publisher_url",
    "catalogue_url",
    "document_url",
    "group_label",
    "document_role",
    "parent_document_url",
    "fields",
    "version_basis",
}
_CONTEXT_KEYS = {
    "name",
    "office",
    "candidate_name",
    "candidate_mark",
    "period_start",
    "period_end",
    "report_type",
}
_MEASURES = {
    "monetary_contributions",
    "in_kind_contributions",
    "total_received",
    "amount_on_hand",
    "disbursements",
}
_LOCAL_SEAL = object()


def require(ok, message):
    if not ok:
        raise ComparisonImportError(message)


def _official_url(value, *, county=True):
    require(
        isinstance(value, str)
        and len(value) <= 2000
        and not any(ord(c) < 33 for c in value),
        "Invalid local source URL",
    )
    parsed = urlsplit(value)
    try:
        ok = parsed.port in {None, 443}
    except ValueError:
        ok = False
    require(
        parsed.scheme == "https"
        and parsed.hostname
        == ("www.crowwing.gov" if county else "electionresultsfiles.sos.mn.gov")
        and ok
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment,
        "Unsupported local publisher URL",
    )
    return parsed


def validate_context_shape(context, receipt):
    require(
        isinstance(context, dict)
        and set(context) == CONTEXT_FIELDS
        and context["kind"] == CONTEXT_KIND,
        "Unsupported checked local source context",
    )
    require(
        all(
            readings._hash(context[k])
            for k in (
                "county_source_sha256",
                "publisher_source_sha256",
                "catalogue_source_sha256",
            )
        ),
        "Local context needs exact original dependencies",
    )
    require(
        type(context["county_row"]) is int
        and context["county_row"] > 0
        and readings._string(context["group_label"], limit=500),
        "Local context needs literal county/catalogue identity",
    )
    _official_url(context["publisher_url"])
    _official_url(context["catalogue_url"])
    _official_url(context["document_url"])
    require(
        context["document_role"] in {"primary", "supplement", "certification"}
        and context["version_basis"] == "catalogued_document",
        "Unsupported local document role/version basis",
    )
    require(
        (context["document_role"] == "supplement")
        == (context["parent_document_url"] is not None),
        "Only a supplement needs an exact parent document",
    )
    if context["parent_document_url"]:
        _official_url(context["parent_document_url"])
    fields = context["fields"]
    require(
        isinstance(fields, dict)
        and set(fields) == _CONTEXT_KEYS
        and isinstance(fields["report_type"], list)
        and len(fields["report_type"]) <= 6,
        "Local context has unsupported field mappings",
    )
    known = {f["field_id"] for f in receipt["fields"]}
    require(
        all(
            v is None or isinstance(v, str) and v in known
            for k, v in fields.items()
            if k != "report_type"
        )
        and all(isinstance(v, str) and v in known for v in fields["report_type"]),
        "Local context field is outside this checked reading",
    )


class _CatalogueLink(TypedDict):
    href: str
    label: str


class _CatalogueParagraph(TypedDict):
    prefix: str
    links: list[_CatalogueLink]


class _Catalogue(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.paragraphs: list[_CatalogueParagraph] = []
        self.links: list[_CatalogueLink] = []
        self.title = ""
        self._in_title = False
        self._p: _CatalogueParagraph | None = None
        self._a: _CatalogueLink | None = None
        self._started_links = False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        if tag == "p":
            require(self._p is None, "Unsupported nested local catalogue paragraph")
            self._p = {"prefix": "", "links": []}
            self._started_links = False
        if tag == "a":
            require(self._a is None, "Unsupported nested local link")
            values = dict(attrs)
            self._a = {"href": values.get("href", ""), "label": ""}
            if self._p is not None:
                self._started_links = True

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._a is not None:
            self._a["label"] += data
        elif self._p is not None and not self._started_links:
            self._p["prefix"] += data

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag == "a" and self._a is not None:
            self._a["label"] = " ".join(self._a["label"].split())
            self.links.append(self._a)
            if self._p is not None:
                self._p["links"].append(self._a)
            self._a = None
        if tag == "p" and self._p is not None:
            self._p["prefix"] = " ".join(self._p["prefix"].split())
            self.paragraphs.append(self._p)
            self._p = None


def _html(body):
    require(
        isinstance(body, bytes) and len(body) <= 8 * 1024 * 1024,
        "Local HTML exceeds supported bounds",
    )
    parsed = _Catalogue()
    try:
        parsed.feed(body.decode("utf-8-sig"))
        parsed.close()
    except (UnicodeError, ValueError) as exc:
        raise ComparisonImportError("Unreadable local catalogue HTML") from exc
    require(
        len(parsed.links) <= 50000
        and len(parsed.paragraphs) <= 10000
        and all(len(p["prefix"]) <= 4000 for p in parsed.paragraphs),
        "Local catalogue structure exceeds bounds",
    )
    return parsed


def replay_source_context(receipt, bodies):
    """Replay actual county→publisher→catalogue→group→PDF association.

    The receipt's explicit review approves this source association, not a ballot
    match. Keys derive from the actual recipient and literal publisher grouping.
    """
    context = receipt["source_context"]
    validate_context_shape(context, receipt)
    for key in (
        "county_source_sha256",
        "publisher_source_sha256",
        "catalogue_source_sha256",
    ):
        h = context[key]
        require(
            h in bodies and hashlib.sha256(bodies[h]).hexdigest() == h,
            "Local context original is unavailable or changed",
        )
    try:
        lines = bodies[context["county_source_sha256"]].decode("utf-8-sig").splitlines()
        county = lines[context["county_row"] - 1].split(";")
    except (UnicodeError, IndexError) as exc:
        raise ComparisonImportError("Local county source row is unavailable") from exc
    require(
        county[:2] == ["18", "Crow Wing"],
        "Source recipient differs from supported Crow Wing county",
    )
    publisher = _html(bodies[context["publisher_source_sha256"]])
    require(
        "Crow Wing County" in publisher.title
        and any(
            urljoin(context["publisher_url"], a["href"]) == context["catalogue_url"]
            for a in publisher.links
        ),
        "Official county publisher does not link this catalogue",
    )
    catalogue = _html(bodies[context["catalogue_source_sha256"]])
    matches = [
        p
        for p in catalogue.paragraphs
        if any(
            urljoin(context["catalogue_url"], a["href"]) == context["document_url"]
            for a in p["links"]
        )
    ]
    require(
        len(matches) == 1 and matches[0]["prefix"] == context["group_label"],
        "PDF belongs to another or ambiguous literal catalogue group",
    )
    links = matches[0]["links"]
    indexes = [
        i
        for i, a in enumerate(links)
        if urljoin(context["catalogue_url"], a["href"]) == context["document_url"]
    ]
    require(len(indexes) == 1, "Catalogue repeats this PDF association")
    index = indexes[0]
    label = links[index]["label"]
    is_addition = "Addition to Financial Report" in label
    require(
        is_addition == (context["document_role"] == "supplement"),
        "Catalogue supplement role differs from checked source context",
    )
    if is_addition:
        require(
            index > 0
            and urljoin(context["catalogue_url"], links[index - 1]["href"])
            == context["parent_document_url"]
            and "Addition to Financial Report" not in links[index - 1]["label"],
            "Supplement is not associated with this exact primary document",
        )
    parsed = _official_url(context["document_url"])
    match = re.fullmatch(
        r"/DocumentCenter/View/([1-9][0-9]*)(?:/[^/?#]+)?", parsed.path
    )
    if match is None:
        raise ComparisonImportError("Local report lacks exact DocumentCenter identity")
    authority = {
        "key": "local:county:18",
        "name": "Crow Wing County",
        "jurisdiction": {
            "recipient_type": "county",
            "recipient_id": "18",
            "county_ids": ["18"],
        },
        "publisher_url": context["publisher_url"],
    }
    basis = {
        "kind": CONTEXT_KIND,
        "recipient_id": "18",
        "catalogue_url": context["catalogue_url"],
        "group_label": context["group_label"],
    }
    fields = {f["field_id"]: f for f in receipt["fields"]}

    def field(name, *, value_type=None):
        key = context["fields"][name]
        if key is None:
            return None
        f = fields[key]
        require(
            f["state"] == "value"
            and (value_type is None or f["value_type"] == value_type),
            "Local context field is not individually checked",
        )
        return f["normalized"]

    name = field("name", value_type="text")
    candidate_name = field("candidate_name", value_type="text")
    if candidate_name is not None:
        mark_id = context["fields"]["candidate_mark"]
        require(
            mark_id is not None
            and fields[mark_id]["label"] in {"Candidate", "Candidate report"}
            and fields[mark_id]["value_type"] == "mark"
            and fields[mark_id]["state"] == "value"
            and fields[mark_id]["normalized"] == "marked",
            "Candidate name requires the checked candidate form mark",
        )
    account = {
        "authority": authority["key"],
        "account_id": "group:" + digest(basis),
        "name": name,
        "source_candidate_id": None,
        "candidate_name": candidate_name,
        "issued_id": False,
        "reviewed_key_basis": basis,
        "jurisdiction": authority["jurisdiction"],
    }
    start, end = (
        field("period_start", value_type="date"),
        field("period_end", value_type="date"),
    )
    require(
        start is None or end is None or start <= end, "Local source period is reversed"
    )
    kinds = []
    for key in context["fields"]["report_type"]:
        f = fields[key]
        require(
            f["state"] == "value"
            and f["value_type"] == "mark"
            and f["normalized"] == "marked",
            "Report type is not a checked marked source box",
        )
        kinds.append(f["label"])
    # This is one exact catalogued document, not a claim about every report or
    # whether a different document amends it. Such relationships need new proof.
    report = {
        "authority": authority["key"],
        "account_id": account["account_id"],
        "source_report_id": match[1],
        "series_id": "local-document:" + match[1],
        "report_type": " + ".join(kinds) if kinds else None,
        "period_start": start,
        "period_end": end,
        "received_date": None,
        "predecessor_report_key": None,
        "effective": None,
        "version_scope": "exact_document",
        "amendment_status": "not_established",
    }
    return {
        "authority": authority,
        "account": account,
        "report": report,
        "office_literal": field("office", value_type="text"),
        "document_url": context["document_url"],
        "document_role": context["document_role"],
        "document_link_label": label,
        "source_group_label": context["group_label"],
        "county_literal_row": ";".join(county),
        "publisher_title": publisher.title,
        "source_dependencies": sorted(readings.source_dependencies(receipt)),
    }


class VerifiedLocalContext:
    def __init__(self, values, receipt, *, _seal=None):
        require(
            _seal is _LOCAL_SEAL,
            "Local context must come from a checked reading and replayed source chain",
        )
        self._values = deepcopy(values)
        self._receipt = deepcopy(receipt)

    def values(self):
        return deepcopy(self._values)


def verified_local_context(context, receipt_id):
    require(
        isinstance(context, readings.VerifiedReadingContext),
        "Local adapter needs a verified reading context",
    )
    receipt = context.receipt(receipt_id)
    require(
        receipt["source_context"] is not None,
        "Reading has no checked local source context",
    )
    return VerifiedLocalContext(
        context.local_values(receipt_id), receipt, _seal=_LOCAL_SEAL
    )


def _input(body, source, locator, context):
    require(
        isinstance(context, readings.VerifiedReadingContext),
        "Local adapter requires a fresh verified reading context",
    )
    require(
        context.generation_bound, "Local adapter needs exact generation source closure"
    )
    require(
        isinstance(source, dict)
        and isinstance(locator, dict)
        and isinstance(source.get("authority"), str)
        and source["authority"].startswith("local:"),
        "Local extraction needs bounded retained original",
    )
    h = readings._source_identity(body)
    require(
        source.get("sha256") == h
        and h in context.original_hashes
        and readings._hash(locator.get("receipt_sha256")),
        "Local extraction original/receipt is outside verified scope",
    )
    receipt = context.receipt(locator["receipt_sha256"])
    allowed = {receipt["original_sha256"]: None}
    if receipt["source_context"] is not None:
        expected = receipt["source_context"]
        if expected["kind"] == "local_filing_context:v1":
            values = context.local_values(locator["receipt_sha256"])
            allowed[receipt["original_sha256"]] = values["document_url"]
            authority = values["authority"]["key"]
            capture = values["source_chain"][-1]
            try:
                copied_at = datetime.fromisoformat(source.get("copied_at"))
                captured_at = datetime.fromisoformat(capture["copied_at"])
            except (TypeError, ValueError) as exc:
                raise ComparisonImportError(
                    "Local source copy time differs from checked capture"
                ) from exc
            require(
                copied_at.tzinfo is not None and copied_at == captured_at,
                "Local source copy time differs from checked capture",
            )
            captured_media = capture.get("media_type")
            require(
                captured_media is None
                or isinstance(source.get("media_type"), str)
                and source["media_type"].split(";", 1)[0].strip().lower()
                == captured_media.split(";", 1)[0].strip().lower(),
                "Local source media type differs from checked capture",
            )
        else:
            allowed[receipt["original_sha256"]] = expected["document_url"]
            if locator.get("kind") == "authority":
                allowed = {
                    expected["publisher_source_sha256"]: expected["publisher_url"]
                }
            elif locator.get("kind") in {"account", "report"}:
                allowed[expected["catalogue_source_sha256"]] = expected["catalogue_url"]
            authority = "local:county:18"
        require(
            h in allowed
            and source.get("url") == allowed[h]
            and source.get("authority") == authority,
            "Local source metadata differs from checked publisher association",
        )
    require(h in allowed, "Local reading belongs to another original")
    if h == receipt["original_sha256"]:
        readings.verify_original_type(body, receipt)
    return receipt


def _entity(context, locator, *, report=True):
    value = verified_local_context(context, locator["receipt_sha256"]).values()
    require(value["account"]["name"] is not None, "Local account name is not checked")
    if report:
        r = value["report"]
        require(
            value["document_role"] == "primary"
            and r["period_start"]
            and r["period_end"]
            and r["effective"] is None
            and r["version_scope"] == "exact_document"
            and r["amendment_status"] == "not_established"
            and r["predecessor_report_key"] is None,
            "Local report identity/period/version remains a gap",
        )
        # A missing type or checked Amended label describes this document only;
        # neither determines which filing is effective in an amendment series.
        ordered_period(r)
    return value


def _quote(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _candidate_relationship(receipt, fields, context, locator):
    require(
        set(locator) == {"kind", "receipt_sha256", "relationship"},
        "Unsupported local candidate relationship locator",
    )
    value = _entity(context, locator)
    mapped = receipt["source_context"]["fields"]
    name = fields.get(mapped["name"])
    office = fields.get(mapped["office"])
    require(
        name is not None
        and office is not None
        and name["page"] == office["page"]
        and all(
            f["record_type"] == "cover"
            and f["value_type"] == "text"
            and f["state"] == "value"
            for f in (name, office)
        )
        and name["label"]
        in {
            "Name of candidate or committee",
            "Name of candidate, committee or corporation",
            "Name of candidate, committee, or corporation",
        }
        and office["label"] in {"Office sought", "Office sought or ballot question"},
        "Candidate relationship needs its checked name and office cover fields",
    )
    require(
        not any(
            f["record_type"] == "cover"
            and f["label"]
            in {"Independent expenditure", "Independent expenditure report"}
            and f["state"] == "value"
            and f["normalized"] == "marked"
            for f in fields.values()
        ),
        "Outside expenditure is not a candidate campaign relationship",
    )
    statement = name["literal"]
    relationship = locator["relationship"]
    mark = fields.get(mapped["candidate_mark"])
    if relationship == "named_candidate_campaign":
        match = re.fullmatch(r"([^\r\n]{1,200}) for ([^\r\n]{1,200})", statement)
        require(
            match is not None
            and match[2] == office["literal"]
            and mark is not None
            and mark["page"] == name["page"]
            and mark["label"] in {"Candidate", "Candidate report"}
            and mark["value_type"] == "mark"
            and mark["state"] == "value"
            and mark["normalized"] == "marked",
            "Named campaign needs the complete person/office statement and checked Candidate mark",
        )
    elif relationship == "campaign_fund_of_person":
        match = re.fullmatch(
            r"(?P<person>[^()\r\n]{1,200})\( Campaign Fund of (?P=person) \)",
            statement,
        )
        require(
            match is not None,
            "Campaign fund statement must name the same person in both roles",
        )
    else:
        raise ComparisonImportError("Unsupported source-stated candidate relationship")
    assert match is not None  # Both supported branches have already required it.
    person = match[1]
    require(person == person.strip(), "Person name has unsupported surrounding text")
    facts = {
        k: value["report"][k]
        for k in (
            "authority",
            "account_id",
            "source_report_id",
            "period_start",
            "period_end",
        )
    }
    facts.update(
        account_name=value["account"]["name"],
        person_name=person,
        office_literal=office["literal"],
        relationship=relationship,
    )
    return CheckedExtraction(
        facts,
        _quote(
            {
                "name": {k: name[k] for k in ("page", "label", "literal", "state")},
                "office": {k: office[k] for k in ("page", "label", "literal", "state")},
                "candidate_mark": {
                    k: mark[k] for k in ("page", "label", "literal", "state")
                }
                if mark is not None
                else None,
            }
        ),
    )


_INVENTORY_LABEL = re.compile(
    r"(?:(?P<year>[0-9]{4}) (?P<periodic>Pre-primary|Pre-general|Annual)|(?P<initial>Initial)) report"
)


def _inventory_family(row, values, receipt):
    """A literal family is not an amendment order or an additive period."""
    label = _INVENTORY_LABEL.fullmatch(row["label"])
    require(label is not None, "Inventory has an unsupported potential competitor")
    assert label is not None
    report = values["report"]
    require(values["document_role"] == "primary", "Inventory member role is unresolved")
    ordered_period(report)
    require(
        bool(report["period_start"]) and bool(report["period_end"]),
        "Inventory member period is unresolved",
    )
    year, kind = label["year"], label["periodic"] or label["initial"]
    require(
        year is None or report["period_end"][:4] == year,
        "Inventory year conflicts with the actual report period",
    )
    raw_type = report["report_type"]
    require(
        raw_type in (None, kind),
        "Inventory label conflicts with the checked report type",
    )
    # Unmapped but individually checked Type-of-report fields still matter.
    # In particular, an amended/uncertain field cannot be hidden by the context
    # selecting only a different positive type mark.
    literals = {
        "(Pre-Primary report)": "Pre-primary",
        "(Initial Report)": "Initial",
    }
    for field in receipt["fields"]:
        if field["record_type"] != "cover":
            continue
        relevant = (
            field["field_id"].startswith("cover.report_type")
            or field["label"] == "Type of report"
            or "amend" in field["label"].lower()
        )
        if not relevant:
            continue
        require(
            field["state"] in {"value", "blank"},
            "Inventory has an uncertain potential amendment/type field",
        )
        if field["state"] != "value":
            continue
        require(
            "amend" not in (field["label"] + " " + field["literal"]).lower(),
            "Inventory cannot establish an amendment replacement",
        )
        if field["label"] == "Type of report":
            require(
                literals.get(field["literal"]) == kind,
                "Literal report type conflicts with inventory",
            )
        elif field["value_type"] == "mark":
            require(
                field["normalized"] == "marked" and field["label"] == kind,
                "Checked report type conflicts with inventory",
            )
        else:
            raise ComparisonImportError("Unsupported checked inventory report type")
    return year, kind


def _offered_inventory_version(context, locator):
    from alethical.pipeline.election_external_finance import inventory_reading_ids
    from alethical.pipeline.election_local_context import HENNEPIN_INVENTORY_PROFILE

    inventory_reading_ids(locator)
    selected = _entity(context, locator)
    inventory = selected.get("offered_inventory")
    require(
        isinstance(inventory, dict)
        and inventory.get("profile") == HENNEPIN_INVENTORY_PROFILE
        and isinstance(inventory.get("version_as_of"), str)
        and selected["account"]["issued_id"] is True,
        "Complete offered inventory is not established for this document",
    )
    try:
        require(
            datetime.fromisoformat(inventory["version_as_of"]).tzinfo is not None,
            "Inventory has no checked listing-copy date",
        )
    except ValueError as exc:
        raise ComparisonImportError("Inventory listing-copy date is invalid") from exc
    offered = {m["source_report_id"]: m for m in inventory["members"]}
    require(
        {m["source_report_id"] for m in locator["members"]} == set(offered),
        "Inventory proof omits or adds an offered document",
    )
    sources = [
        {
            "source_sha256": inventory["catalogue_sha256"],
            "source_url": inventory["catalogue_url"],
            "source_copied_at": inventory["version_as_of"],
            "locator": {"table": inventory["table"], "line": inventory["line"]},
        }
    ]
    family_members, quoted_members = {}, []
    selected_family = None
    for member in locator["members"]:
        rid = member["receipt_sha256"]
        values = _entity(context, {"receipt_sha256": rid})
        receipt = context.receipt(rid)
        report = values["report"]
        row = offered[member["source_report_id"]]
        require(
            values.get("offered_inventory") == inventory
            and values.get("election_date") == selected.get("election_date")
            and values["authority"] == selected["authority"]
            and values["account"]["issued_id"] is True
            and values["account"]["account_id"] == selected["account"]["account_id"]
            and report["source_report_id"] == member["source_report_id"]
            and values["document_url"] == row["url"]
            and receipt["original_sha256"] in context.original_hashes,
            "Inventory member differs from its exact checked account/catalogue/document",
        )
        capture = values["source_chain"][-1]
        require(
            capture["source_sha256"] == receipt["original_sha256"]
            and capture["final_url"] == row["url"],
            "Inventory member capture differs from offered original",
        )
        family = _inventory_family(row, values, receipt)
        family_members.setdefault(family, []).append(member["source_report_id"])
        if rid == locator["receipt_sha256"]:
            selected_family = family
            require(report == selected["report"], "Selected inventory member changed")
        sources.append(
            {
                "source_sha256": receipt["original_sha256"],
                "source_url": row["url"],
                "source_copied_at": capture["copied_at"],
                "locator": {
                    "page": values["section"]["cover"]["page"],
                    "source_report_id": member["source_report_id"],
                },
            }
        )
        quoted_members.append(
            {
                **row,
                "original_sha256": receipt["original_sha256"],
                "original_copied_at": capture["copied_at"],
                "period_start": report["period_start"],
                "period_end": report["period_end"],
                "document_role": values["document_role"],
                "report_type": report["report_type"],
            }
        )
    require(
        selected_family is not None and len(family_members[selected_family]) == 1,
        "Offered inventory has multiple possible versions of this family",
    )
    assert selected_family is not None  # The exact-family requirement above passed.
    facts = {
        k: selected["report"][k]
        for k in (
            "authority",
            "account_id",
            "source_report_id",
            "period_start",
            "period_end",
        )
    }
    facts.update(
        effective=True,
        version_scope="publisher_inventory_as_of",
        amendment_status="offered_inventory_checked",
        version_as_of=inventory["version_as_of"],
        version_sources=sources,
        family={"catalogue_year": selected_family[0], "kind": selected_family[1]},
    )
    return CheckedExtraction(
        facts,
        _quote(
            {
                "scope": "offered table in retained publisher listing",
                "catalogue_url": inventory["catalogue_url"],
                "catalogue_sha256": inventory["catalogue_sha256"],
                "listing_copied_at": inventory["version_as_of"],
                "account_id_as_source": inventory["account_id_as_source"],
                "account_name_as_source": inventory["account_name_as_source"],
                "members": quoted_members,
            }
        ),
    )


def extract_local_reading(body, source, locator, *, context=None):
    """Replay approved literal fields, or derived typed local context claims."""
    receipt = _input(body, source, locator, context)
    kind = locator.get("kind")
    if kind == "offered_inventory_version":
        return _offered_inventory_version(context, locator)
    fields = {f["field_id"]: f for f in receipt["fields"]}
    if kind == "candidate_relationship":
        return _candidate_relationship(receipt, fields, context, locator)
    if kind in {"authority", "account", "report"}:
        require(
            set(locator) == {"kind", "receipt_sha256"},
            "Unsupported local context locator",
        )
        value = _entity(context, locator, report=kind == "report")
        facts = value[kind]
        if receipt["source_context"]["kind"] == "local_filing_context:v1":
            quote = {
                "basis": "checked publisher and exact document section",
                "recipient_rows": value["recipient_rows"],
                "directory_entry": value["directory_entry"],
                "document_url": value["document_url"],
                "section": value["section"],
            }
        else:
            quote = {
                "basis": "checked publisher/catalogue association",
                "county_row": value["county_literal_row"],
                "publisher_title": value["publisher_title"],
                "catalogue_group": value["source_group_label"],
                "document_url": value["document_url"],
            }
        if kind != "authority":
            certificate_fields = (
                {
                    receipt["source_context"]["fields"]["name"],
                    receipt["source_context"]["fields"]["office"],
                }
                if receipt["document_kind"] == "certification"
                else set()
            )
            quote["observed_fields"] = {
                k: f["literal"]
                for k, f in fields.items()
                if (f["record_type"] == "cover" or k in certificate_fields)
                and f["state"] == "value"
            }
        return CheckedExtraction(deepcopy(facts), _quote(quote))
    if kind == "field":
        require(
            set(locator)
            in (
                {"kind", "receipt_sha256", "field_id"},
                {"kind", "receipt_sha256", "field_id", "page"},
            )
            and locator["field_id"] in fields,
            "Unsupported checked field locator",
        )
        f = fields[locator["field_id"]]
        require(
            type(locator.get("page", f["page"])) is int
            and locator.get("page", f["page"]) == f["page"],
            "Reading locator names another source page",
        )
        facts = {
            k: deepcopy(f[k])
            for k in (
                "field_id",
                "page",
                "label",
                "literal",
                "state",
                "value_type",
                "normalized",
                "currency",
            )
        }
        return CheckedExtraction(
            facts,
            _quote({"label": f["label"], "literal": f["literal"], "state": f["state"]}),
        )
    value = _entity(context, locator)
    report = value["report"]
    if kind == "figure":
        require(
            set(locator)
            in (
                {"kind", "receipt_sha256", "field_id"},
                {"kind", "receipt_sha256", "field_id", "page"},
            )
            and locator["field_id"] in fields,
            "Unsupported local figure locator",
        )
        f = fields[locator["field_id"]]
        require(
            type(locator.get("page", f["page"])) is int
            and locator.get("page", f["page"]) == f["page"],
            "Reading locator names another source page",
        )
        measure = f["field_id"].removeprefix("cover.")
        require(
            f["field_id"] == "cover." + measure
            and measure in _MEASURES
            and f["record_type"] == "cover"
            and f["state"] == "value"
            and f["value_type"] == "money"
            and f["currency"] is not None,
            "Local figure is not a checked scoped numeric field",
        )
        facts = {
            k: report[k]
            for k in (
                "authority",
                "account_id",
                "source_report_id",
                "period_start",
                "period_end",
            )
        }
        facts.update(
            measure=measure,
            label=f["label"],
            value=f["normalized"],
            unit="money",
            currency=f["currency"],
        )
        return CheckedExtraction(
            facts, _quote({"label": f["label"], "literal": f["literal"]})
        )
    require(
        kind in {"payment", "payment_address"}
        and set(locator) == {"kind", "receipt_sha256", "page", "row"}
        and type(locator["page"]) is int
        and type(locator["row"]) is int,
        "Unsupported local payment locator",
    )
    selected = [
        f
        for f in fields.values()
        if f["page"] == locator["page"]
        and f["row"] == locator["row"]
        and f["record_type"] == "disbursement"
    ]
    by_name = {}
    for f in selected:
        name = f["field_id"].rsplit(".", 1)[-1]
        require(name not in by_name, "Ambiguous local payment cell")
        by_name[name] = f
    by_name = _shared_payment_fields(receipt, fields, locator, by_name)
    require(
        all(
            k in by_name and by_name[k]["state"] == "value" for k in ("date", "amount")
        ),
        "Local payment needs checked date and amount",
    )
    require(
        by_name["date"]["value_type"] == "date"
        and by_name["amount"]["value_type"] == "money"
        and report["period_start"]
        <= by_name["date"]["normalized"]
        <= report["period_end"],
        "Local payment is outside its actual period",
    )

    def optional(name):
        f = by_name.get(name)
        return f["normalized"] if f and f["state"] == "value" else None

    row_id = f"{receipt['original_sha256']}:page{locator['page']}:disbursements:{locator['row']}"
    if kind == "payment_address":
        address = _local_payee_address(by_name)
        observations = {
            name: {"literal": by_name[name]["literal"], "state": by_name[name]["state"]}
            for name in ("payee_address", "payee_street")
            if name in by_name
        }
        return CheckedExtraction(
            {
                **{
                    k: report[k]
                    for k in ("authority", "account_id", "source_report_id")
                },
                "source_row_id": row_id,
                "payee_address": address,
            },
            _quote(observations),
        )
    return CheckedExtraction(
        _payment_facts(
            report,
            row_id,
            by_name["date"]["normalized"],
            by_name["amount"]["normalized"],
            by_name["amount"]["currency"],
            optional("payee"),
            optional("purpose"),
        ),
        _quote({k: f["literal"] for k, f in by_name.items()}),
    )


def _shared_payment_fields(receipt, fields, locator, by_name):
    """Resolve only the immutable reviewed map, never caller-supplied grouping."""
    groups = (receipt.get("source_context") or {}).get("payment_groups", [])
    group = next(
        (
            g
            for g in groups
            if g["page"] == locator["page"] and locator["row"] in g["rows"]
        ),
        None,
    )
    if group is None:
        return by_name
    result = dict(by_name)
    for name, reference in (("date", "date_field"), ("payee", "payee_field")):
        fid = group[reference]
        if fid is None:
            continue
        shared = fields[fid]
        if name == "date":
            require(
                shared["state"] == "value",
                "Shared payment date is not checked as a value",
            )
        own = result.get(name)
        if own is not None:
            require(
                own["state"] == "value"
                and shared["state"] == "value"
                and own["value_type"] == shared["value_type"]
                and own["normalized"] == shared["normalized"],
                "Payment row conflicts with its shared heading",
            )
        elif shared["state"] == "value":
            result[name] = shared
    return result


def _local_payee_address(by_name):
    # Only an individually checked visible address can supply an address fact.
    field = by_name.get("payee_address")
    require(
        field is not None and field["value_type"] == "text",
        "Local address needs its checked text cell",
    )
    for name in ("payee_address", "payee_street"):
        observation = by_name.get(name)
        require(
            observation is None
            or (
                observation["value_type"] == "text"
                and observation["state"]
                in {"value", "blank", "ambiguous", "unreadable", "redacted"}
            ),
            "Local address observation has not been checked as text",
        )
    address = dict.fromkeys(
        ("street_1", "street_2", "city", "state", "postal_code", "as_filed")
    )
    if field["state"] != "value":
        return address
    literal = field["literal"]
    require(
        isinstance(literal, str)
        and bool(literal.strip())
        and literal == field["normalized"],
        "Local address differs from checked literal",
    )
    address["as_filed"] = literal
    states = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI".split()
    pattern = rf"(?<![A-Za-z0-9])({'|'.join(states)})[ \t]+([0-9]{{5}}(?:-[0-9]{{4}})?)(?![A-Za-z0-9-])"
    matches = list(re.finditer(pattern, literal))
    if len(matches) == 1 and not literal[matches[0].end() :].strip():
        address["state"], address["postal_code"] = matches[0].groups()
    return address


def _payment_facts(report, row_id, day, amount, currency, payee, purpose):
    return {
        **{k: report[k] for k in ("authority", "account_id", "source_report_id")},
        "source_row_id": row_id,
        "date": day,
        "target_source_candidate_id": None,
        "payee": payee,
        "purpose": purpose,
        "amount": amount,
        "currency": currency,
        "direction": "unknown",
        "transaction_type": "local_disbursement",
        "memo": {},
    }


def _visible_native_field(
    receipt,
    source_field,
    *,
    field_id=None,
    row=None,
    name=None,
    value_type=None,
    normalized=None,
    required=True,
):
    fields = (
        [f for f in receipt["fields"] if f["field_id"] == field_id]
        if field_id
        else [
            f
            for f in receipt["fields"]
            if f["record_type"] == "disbursement"
            and f["page"] == 1
            and f["row"] == row
            and f["field_id"].rsplit(".", 1)[-1] == name
        ]
    )
    require(len(fields) <= 1, "Native field has ambiguous checked visual scope")
    field = fields[0] if fields else None
    if field is None or field["state"] != "value":
        require(not required, "Native field is not individually checked as visible")
        return None
    require(
        field["page"] == source_field["page"]
        and field["literal"] == source_field["text"]
        and (value_type is None or field["value_type"] == value_type)
        and (normalized is None or field["normalized"] == normalized),
        "Native literal differs from individually checked visible field",
    )
    bounds = field["bounds"]
    cell = source_field["bounds"]
    require(
        cell[0] <= bounds[0] < bounds[2] <= cell[2]
        and cell[1] <= bounds[1] < bounds[3] <= cell[3]
        and all(
            bounds[0] <= word["bounds"][0]
            and bounds[1] <= word["bounds"][1]
            and word["bounds"][2] <= bounds[2]
            and word["bounds"][3] <= bounds[3]
            for word in source_field["words"]
        ),
        "Native words extend beyond checked visible field region",
    )
    return field


def extract_local_native(body, source, locator, *, context=None):
    """Native equality never substitutes for a checked visible field.

    In particular, hidden text under a source redaction cannot be recovered into
    figures, purposes, addresses or quotation. Optional unapproved purpose stays
    unavailable; required unapproved date/amount prevents payment admission.
    """
    receipt = _input(body, source, locator, context)
    require(
        set(locator) == {"kind", "receipt_sha256", "field"},
        "Unsupported native local locator",
    )
    native = read_native_local_report(body)
    value = _entity(context, locator)
    report = value["report"]
    require(
        (native["period_start"], native["period_end"], native["name"], native["office"])
        == (
            report["period_start"],
            report["period_end"],
            value["account"]["name"],
            value["office_literal"],
        ),
        "Native fields differ from checked source context",
    )
    mappings = receipt["source_context"]["fields"]
    for name in ("name", "office"):
        _visible_native_field(
            receipt,
            native["identity_sources"][name],
            field_id=mappings[name],
            value_type="text",
        )
    for name in ("period_start", "period_end"):
        field = next(f for f in receipt["fields"] if f["field_id"] == mappings[name])
        bounds, cell = field["bounds"], native["period_source"]["bounds"]
        require(
            field["page"] == 1
            and field["literal"] in native["period_source"]["text"]
            and cell[0] <= bounds[0] < bounds[2] <= cell[2]
            and cell[1] <= bounds[1] < bounds[3] <= cell[3],
            "Native period differs from checked visible date regions",
        )
    field = locator["field"]
    if locator["kind"] == "figure":
        require(field in _MEASURES, "Unsupported native local measure")
        f = native["figures"][field]
        require(f["amount"] is not None, "Native amount is not shown")
        visible = _visible_native_field(
            receipt,
            f["source"],
            field_id="cover." + field,
            value_type="money",
            normalized=f["amount"],
        )
        require(
            visible["currency"] == f["currency"],
            "Native currency differs from checked visible field",
        )
        facts = {
            k: report[k]
            for k in (
                "authority",
                "account_id",
                "source_report_id",
                "period_start",
                "period_end",
            )
        }
        facts.update(
            measure=field,
            label=f["label"],
            value=f["amount"],
            unit="money",
            currency=f["currency"],
        )
        return CheckedExtraction(facts, visible["literal"])
    require(
        locator["kind"] == "payment"
        and type(field) is int
        and 1 <= field <= len(native["listed_disbursements"]),
        "Unsupported native disbursement row",
    )
    row = native["listed_disbursements"][field - 1]
    ordinal = int(row["source_row_id"].rsplit(":", 1)[-1])
    day = _visible_native_field(
        receipt,
        row["source"]["date"],
        row=ordinal,
        name="date",
        value_type="date",
        normalized=row["date"],
    )
    amount = _visible_native_field(
        receipt,
        row["source"]["amount"],
        row=ordinal,
        name="amount",
        value_type="money",
        normalized=row["amount"],
    )
    require(
        amount["currency"] == row["currency"],
        "Native payment currency differs from checked visible field",
    )
    purpose = _visible_native_field(
        receipt,
        row["source"]["purpose"],
        row=ordinal,
        name="purpose",
        value_type="text",
        required=False,
    )
    quote = {"date": day["literal"], "amount": amount["literal"]}
    if purpose is not None:
        quote["purpose"] = purpose["literal"]
    return CheckedExtraction(
        _payment_facts(
            report,
            row["source_row_id"],
            row["date"],
            row["amount"],
            row["currency"],
            None,
            purpose["normalized"] if purpose else None,
        ),
        _quote(quote),
    )


def public_locator(locator, receipt):
    """Expose source scope, never private reading/decision IDs or object paths."""
    if locator.get("field_id"):
        f = next(
            (f for f in receipt["fields"] if f["field_id"] == locator["field_id"]), None
        )
        if f is None:
            raise ComparisonImportError("Unknown reading source field")
        return {"page": f["page"], "bounds": deepcopy(f["bounds"]), "field": f["label"]}
    return {k: deepcopy(locator[k]) for k in ("page", "row", "field") if k in locator}


def field_locator(receipt_id, receipt, kind, field_id):
    """Build a precise proposed field selector; this grants no checked state."""
    require(
        kind in {"field", "figure"} and readings.receipt_digest(receipt) == receipt_id,
        "Field locator needs its exact receipt",
    )
    field = next((f for f in receipt["fields"] if f["field_id"] == field_id), None)
    if field is None:
        raise ComparisonImportError("Field is outside the reading receipt")
    return {
        "kind": kind,
        "receipt_sha256": receipt_id,
        "field_id": field_id,
        "page": field["page"],
    }
