"""Closed publisher-labelled expense attachments; no inherited raw account facts.

The parent owns report identity/period, the attachment owns payment cells, and
retained catalogue text owns their relationship. This module makes no decisions.
"""

from decimal import Decimal
import math
import re
from typing import Any

from alethical.pipeline import election_local_context as c

PROFILE = "olmsted_period_expense_attachment:v1"
KINDS = frozenset({"attachment_payment", "attachment_payment_address"})
_REFERENCE_KEYS = {
    "page",
    "item_bounds",
    "heading_field_id",
    "reference_field_id",
    "item_area_field_id",
    "blank_field_ids",
}
_LOCATOR_KEYS = {
    "kind",
    "profile",
    "receipt_sha256",
    "parent_receipt_sha256",
    "reference_section",
    "page",
    "row",
}
require = c.require


def _bounds(value):
    require(
        isinstance(value, list)
        and len(value) == 4
        and all(type(n) in {int, float} and math.isfinite(n) for n in value)
        and 0 <= value[0] < value[2]
        and 0 <= value[1] < value[3],
        "Invalid attachment item rectangle",
    )
    return tuple(Decimal(str(n)) for n in value)


def _inside(outer, inner):
    return (
        outer[0] <= inner[0] < inner[2] <= outer[2]
        and outer[1] <= inner[1] < inner[3] <= outer[3]
    )


def _overlap(a, b):
    return max(a[0], b[0]) < min(a[2], b[2]) and max(a[1], b[1]) < min(a[3], b[3])


def validate_locator(locator):
    require(
        isinstance(locator, dict)
        and set(locator) == _LOCATOR_KEYS
        and locator["kind"] in KINDS
        and locator["profile"] == PROFILE,
        "Unsupported attachment locator",
    )
    ids = [locator[k] for k in ("receipt_sha256", "parent_receipt_sha256")]
    require(
        all(isinstance(v, str) and re.fullmatch(r"[0-9a-f]{64}", v) for v in ids)
        and ids[0] != ids[1],
        "Attachment needs two distinct exact checked readings",
    )
    require(
        type(locator["page"]) is int
        and 0 < locator["page"] <= 256
        and type(locator["row"]) is int
        and 0 < locator["row"] <= 2000,
        "Attachment needs an exact page and printed row",
    )
    _validate_reference_shape(locator["reference_section"])
    return frozenset(ids)


def _validate_reference_shape(section):
    require(
        isinstance(section, dict) and set(section) == _REFERENCE_KEYS,
        "Unsupported attachment reference section",
    )
    require(
        type(section["page"]) is int and 0 < section["page"] <= 256,
        "Attachment reference needs an exact page",
    )
    _bounds(section["item_bounds"])
    blanks = section["blank_field_ids"]
    require(
        isinstance(blanks, list) and 0 < len(blanks) <= 32,
        "Attachment reference needs bounded checked empty cells",
    )
    names = [
        section["heading_field_id"],
        section["reference_field_id"],
        section["item_area_field_id"],
        *blanks,
    ]
    require(
        all(
            isinstance(n, str) and re.fullmatch(r"[a-z][a-z0-9_.-]{0,119}", n)
            for n in names
        )
        and len(names) == len(set(names)),
        "Duplicate or invalid attachment reference fields",
    )


def reference_section(receipt, section):
    """Require checked heading plus an exact tiling of the source item rectangle.

    Geometry is source data. No page coordinates or receipt IDs are hardcoded.
    Ordinary read verification uses the already checked immutable receipt.
    """
    _validate_reference_shape(section)
    require(
        receipt.get("document_kind") == "financial_report",
        "Attachment parent must be a primary financial report",
    )
    require(
        section["page"] == receipt["reading_scope"]["cover"]["page"],
        "Attachment reference must be on the checked primary cover page",
    )
    require(
        not any(f["record_type"] == "disbursement" for f in receipt["fields"]),
        "Attachment parent already contains itemized disbursements",
    )
    fields = {f["field_id"]: f for f in receipt["fields"]}
    names = [
        section["heading_field_id"],
        section["reference_field_id"],
        section["item_area_field_id"],
        *section["blank_field_ids"],
    ]
    require(all(n in fields for n in names), "Attachment reference field is absent")
    selected = [fields[n] for n in names]
    require(
        all(
            f["record_type"] == "cover" and f["page"] == section["page"]
            for f in selected
        ),
        "Attachment reference fields cross pages",
    )
    heading, reference, full_area, *blanks = selected
    require(
        [
            f["field_id"]
            for f in receipt["fields"]
            if f["label"] == "Disbursements item area"
        ]
        == [full_area["field_id"]],
        "Attachment parent has competing full item-area observations",
    )
    require(
        heading["state"] == "value"
        and heading["value_type"] == "text"
        and heading["literal"] == "Disbursements"
        and heading["normalized"] == "Disbursements",
        "Attachment reference lacks checked Disbursements heading",
    )
    require(
        reference["state"] == "value"
        and reference["value_type"] == "text"
        and reference["literal"] == "See attached"
        and reference["normalized"] == "See attached",
        "Unsupported disbursement attachment reference",
    )
    item = _bounds(section["item_bounds"])
    require(
        full_area["label"] == "Disbursements item area"
        and full_area["row"] is None
        and full_area["currency"] is None
        and full_area["state"] == "value"
        and full_area["value_type"] == "text"
        and full_area["literal"] == reference["literal"]
        and full_area["normalized"] == reference["normalized"]
        and _bounds(full_area["bounds"]) == item,
        "Attachment needs the exact checked full Disbursements item area",
    )
    hb = _bounds(heading["bounds"])
    require(
        hb[3] <= item[1] and max(hb[0], item[0]) < min(hb[2], item[2]),
        "Attachment reference heading is outside the item section",
    )
    tiles = [reference, *blanks]
    for f in blanks:
        require(
            f["state"] == "blank" and f["literal"] == "" and f["normalized"] is None,
            "Attachment item area is not checked blank",
        )
    boxes = [_bounds(f["bounds"]) for f in tiles]
    require(
        all(_inside(item, b) for b in boxes),
        "Attachment item cell crosses its rectangle",
    )
    require(
        not any(_overlap(a, b) for i, a in enumerate(boxes) for b in boxes[i + 1 :]),
        "Attachment item cells overlap",
    )

    def area(b):
        return (b[2] - b[0]) * (b[3] - b[1])

    require(
        sum(map(area, boxes)) == area(item),
        "Attachment item area is not completely checked",
    )
    # Only exact agreeing subfields inside the reference cell can corroborate it.
    for f in receipt["fields"]:
        if f["field_id"] in names or f["page"] != section["page"]:
            continue
        bounds = _bounds(f["bounds"])
        if _overlap(item, bounds):
            require(
                _inside(boxes[0], bounds)
                and f["state"] == "value"
                and f["value_type"] == "text"
                and f["literal"] == reference["literal"]
                and f["normalized"] == reference["normalized"],
                "Competing or uncertain primary disbursement observation",
            )
    return {
        "page": section["page"],
        "item_bounds": list(section["item_bounds"]),
        "heading": heading,
        "reference": reference,
        "blank_fields": blanks,
    }


CATALOGUE_URL = "https://www.olmstedcounty.gov/residents/elections-and-voting/candidate-resources/campaign-finance-reports"
_ASSETS = "3aaa4ace543132ff3f71662b7156ceaa1eb0914faf375a867b0d81c074563137"
_OUTSIDE = "f7c1ebb69ddbd6f1c21280a289291a52c5635206347764389e183a1b9ade67fd"
_PERIOD = re.compile(
    r"([0-9]{1,2}-[0-9]{1,2}-(?:20)?[0-9]{2}) to ([0-9]{1,2}-[0-9]{1,2}-(?:20)?[0-9]{2})$"
)


def _fingerprint(value):
    import hashlib
    import json

    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _period(label):
    from datetime import date

    match = _PERIOD.search(label)
    if match is None:
        return None
    try:
        dates = []
        for v in match.groups():
            month, day, year = map(int, v.split("-"))
            dates.append(
                date(year + 2000 if year < 100 else year, month, day).isoformat()
            )
    except ValueError:
        return None
    return dates if dates[0] <= dates[1] else None


def catalogue_group(body, document_url, edge, root):
    """Complete current-year article group from this exact retained HTML profile.

    Uses the reviewed static parser's malformed-text and heading checks. Remote
    assets remain references only; neither scripts nor layout are executed.
    """
    from urllib.parse import urljoin
    from alethical.pipeline import election_static_inventory as static
    import hashlib

    require(document_url == CATALOGUE_URL, "Unsupported attachment publisher catalogue")
    recipient = root["recipient"]
    require(
        recipient.get("namespace") == "county"
        and recipient.get("source_id") == "55"
        and recipient.get("county_ids") == ["55"]
        and root["election_date"] == "2026-11-03",
        "Attachment catalogue belongs to another recipient/election",
    )
    doc = static._StaticHTML(body)
    require(
        not doc.unparented_text and not doc.all("base"),
        "Unassigned attachment catalogue text/base",
    )
    static._heading_visibility(doc)
    assets = [
        (n.tag, n.attrs, "".join(n.text))
        for n in doc.nodes
        if n.tag in {"script", "style", "link"}
    ]
    require(
        not any(n.duplicate for n in doc.nodes)
        and (not assets or _fingerprint(assets) == _ASSETS),
        "Unsupported attachment catalogue asset profile",
    )
    sections = [n for n in doc.all("div") if n.attrs.get("class") == "node-content"]
    require(len(sections) == 1, "Ambiguous attachment catalogue section")
    section = sections[0]
    starts = [
        i
        for i, n in enumerate(section.children)
        if n.tag == "h4" and c._text(n) == "2026 campaign finance reports by candidate"
    ]
    require(len(starts) == 1, "Ambiguous attachment catalogue year")
    start = starts[0]
    ends = [i for i, n in enumerate(section.children) if i > start and n.tag == "h4"]
    end = ends[0] if ends else len(section.children)
    active = {x for n in section.children[start:end] for x in [n, *c._descendants(n)]}
    outside = [n for n in doc.nodes if n not in active]
    minimal = all(
        n.tag in {"html", "body", "div"}
        and not n.attrs
        and not "".join(x for x in n.content if isinstance(x, str)).strip()
        for n in outside
        if n is not section
    )
    require(
        minimal
        or _fingerprint(
            [
                (n.tag, n.attrs, "".join(x for x in n.content if isinstance(x, str)))
                for n in outside
            ]
        )
        == _OUTSIDE,
        "Unknown continuation or competing content outside attachment listing",
    )
    for n in [section, *active]:
        require(
            n.tag in {"div", "h4", "h5", "p", "strong", "span", "article", "a", "br"}
            and not n.duplicate
            and not n.ancestry_uncertain
            and (n.source_closed or n.tag == "br")
            and c._usable(n),
            "Hidden, malformed or unsupported attachment catalogue content",
        )
        require(
            not any(
                k.startswith(("on", "data-"))
                or k in {"src", "srcdoc", "contenteditable"}
                for k in n.attrs
            ),
            "Attachment catalogue has executable or loaded content",
        )
    require(
        not "".join(x for x in section.content if isinstance(x, str)).strip(),
        "Unassigned text in attachment listing structure",
    )
    all_anchors = doc.all("a")
    office = district = person = None
    groups: list[dict[str, Any]] = []
    for node in section.children[start + 1 : end]:
        text = c._text(node)
        if node.tag == "p":
            require(
                not any(n.tag == "a" for n in c._descendants(node)),
                "Linked attachment scope heading",
            )
            if text in {"County Attorney", "County Sheriff", "County Commissioners"}:
                office, district, person = text, None, None
            else:
                require(
                    office is not None and bool(text), "Attachment person lacks office"
                )
                require(
                    not any(
                        g["person_as_source"].casefold() == text.casefold()
                        for g in groups
                    ),
                    "Repeated attachment catalogue person",
                )
                person = text
                groups.append(
                    dict(
                        person_as_source=person,
                        office_as_source=office,
                        district_as_source=district,
                        members=[],
                    )
                )
        elif node.tag == "h5":
            require(
                office == "County Commissioners"
                and re.fullmatch(r"District [1-9][0-9]?", text),
                "Unassigned attachment district",
            )
            district, person = text, None
        else:
            require(
                node.tag == "article" and person is not None and groups,
                "Unassigned attachment listing content",
            )
            links = [n for n in c._descendants(node) if n.tag == "a"]
            require(
                len(links) == 1
                and all(n.tag == "a" for n in node.children)
                and not "".join(x for x in node.content if isinstance(x, str)).strip(),
                "Attachment article has unassigned content or competing links",
            )
            link = links[0]
            label = c._text(link)
            require(
                set(node.attrs) == {"class", "aria-label"}
                and node.attrs["class"]
                == "media media--type-file media--view-mode-default"
                and " ".join(node.attrs["aria-label"].split())
                == f"Inside this element is a link to download {label} file",
                "Attachment article label differs from publisher title",
            )
            anchor = dict(
                kind="html_anchor",
                source_sha256=hashlib.sha256(body).hexdigest(),
                anchor_index=all_anchors.index(link) + 1,
                line=link.line,
                href=link.attrs.get("href"),
                label=label,
                base_href=None,
                target_url=c.p.url(urljoin(document_url, link.attrs.get("href", ""))),
            )
            c.replay_html_anchor(body, document_url, anchor)
            groups[-1]["members"].append(
                dict(
                    edge=anchor,
                    url=anchor["target_url"],
                    label=label,
                    period=_period(label),
                )
            )
    parsed = {m["edge"]["anchor_index"] for g in groups for m in g["members"]}
    current_anchors = {all_anchors.index(n) + 1 for n in active if n.tag == "a"}
    require(
        parsed == current_anchors,
        "Attachment listing has an unassigned heading or section anchor",
    )
    require(
        groups and len(groups) <= 256 and all(g["members"] for g in groups),
        "Incomplete attachment catalogue groups",
    )
    urls = [c.p.wire_url(m["url"]) for g in groups for m in g["members"]]
    require(len(urls) == len(set(urls)), "Reused attachment catalogue request URL")
    selected = [g for g in groups if any(m["edge"] == edge for m in g["members"])]
    require(len(selected) == 1, "Attachment anchor is not one complete publisher group")
    return dict(
        profile=PROFILE,
        catalogue_sha256=hashlib.sha256(body).hexdigest(),
        catalogue_url=document_url,
        recipient=recipient,
        election_date=root["election_date"],
        group_scope={k: v for k, v in selected[0].items() if k != "members"},
        members=selected[0]["members"],
    )


def document_request(value):
    """Published member href identifies the verified request, before redirects."""
    chain = value["source_chain"]
    require(
        bool(chain)
        and chain[-1].get("kind") == "acquisition"
        and chain[-1].get("final_url") == value["document_url"]
        and isinstance(chain[-1].get("requested_url"), str),
        "Attachment document lacks its exact checked acquisition",
    )
    return chain[-1]["requested_url"]


def relationship(parent, child, parent_receipt, child_receipt, section):
    """Verified contexts in, literal association proof out; no candidate decision."""
    require(
        parent["document_role"] == "primary"
        and child["document_role"] == "supplement"
        and parent_receipt["document_kind"] == "financial_report"
        and child_receipt["document_kind"] == "supplement"
        and parent_receipt["original_sha256"] != child_receipt["original_sha256"],
        "Attachment needs distinct primary and supplement originals",
    )
    require(
        all(
            child_receipt["source_context"]["fields"][k] is None
            for k in (
                "name",
                "office",
                "candidate_name",
                "candidate_mark",
                "period_start",
                "period_end",
            )
        )
        and child_receipt["source_context"]["fields"]["report_type"] == [],
        "Attachment must retain absent own identity and period",
    )
    require(
        parent_receipt["source_context"]["root_receipt_id"]
        == child_receipt["source_context"]["root_receipt_id"],
        "Attachment and primary have different checked recipient roots",
    )
    a, b = parent.get("attachment_catalogue"), child.get("attachment_catalogue")
    require(
        isinstance(a, dict) and a == b and a.get("profile") == PROFILE,
        "Attachment needs the same complete checked catalogue group",
    )
    require(
        parent["election_date"] == child["election_date"] == a["election_date"]
        and parent["authority"]["key"] == child["authority"]["key"] == "local:county:55"
        and parent["recipient_rows"] == child["recipient_rows"],
        "Attachment recipient/election differs from primary",
    )

    # Capture identity, not only body equality: two different catalogue copies do
    # not establish the same offered family as of one retained acquisition.
    def common(v):
        return [
            (s["receipt_id"], s["source_sha256"])
            for s in v["source_chain"]
            if s.get("kind") == "acquisition"
            and s.get("source_sha256") == a["catalogue_sha256"]
        ]

    require(
        common(parent) and common(parent) == common(child),
        "Attachment catalogue capture differs",
    )
    scope = a["group_scope"]
    name = scope["person_as_source"]
    require(
        parent["account"]["name"] == name
        and scope["office_as_source"] == "County Attorney"
        and scope["district_as_source"] is None
        and parent["office_literal"] == "Olmsted County Attorney",
        "Attachment publisher person/office conflicts with checked primary",
    )
    for field in child_receipt["fields"]:
        if field["state"] != "value":
            continue
        if field["label"] == "Name of candidate or committee":
            require(field["literal"] == name, "Attachment has a contrary own person")
        if field["label"] in {
            "Office sought",
            "Office sought by candidate (if applicable)",
        }:
            require(
                field["literal"] == parent["office_literal"],
                "Attachment has a contrary own office",
            )
    report = parent["report"]
    period = [report["period_start"], report["period_end"]]
    require(
        all(period)
        and period[0] <= period[1]
        and report["report_type"] == "Pre-primary"
        and report["effective"] is None
        and report["version_scope"] == "exact_document"
        and report["amendment_status"] == "not_established",
        "Attachment primary report period/version is unresolved",
    )
    family = [m for m in a["members"] if m["period"] == period or m["period"] is None]

    def dates(m):
        match = _PERIOD.search(m["label"])
        return match.group(0) if match else ""

    primary = [
        m
        for m in family
        if m["label"] == f"{name} Pre-Primary Campaign Finance Report {dates(m)}"
    ]
    expenses = [
        m
        for m in family
        if m["label"] == f"{name} Primary Spending Report - Sheet1 {dates(m)}"
    ]
    donations = [
        m
        for m in family
        if m["label"] == f"{name} Primary Report Donations - Sheet1 {dates(m)}"
    ]
    require(
        len(primary) == 1
        and len(expenses) == 1
        and len(donations) <= 1
        and len(primary) + len(expenses) + len(donations) == len(family)
        and primary[0]["url"] == document_request(parent)
        and expenses[0]["url"] == document_request(child),
        "Attachment family has competing, amended or unsupported members",
    )
    from alethical.pipeline.election_static_inventory import _type_checked

    _type_checked(parent, parent_receipt)
    reference = reference_section(parent_receipt, section)
    headings = [
        f
        for f in child_receipt["fields"]
        if f["state"] == "value"
        and f["value_type"] == "text"
        and f["literal"] == "Expenditures"
        and f["record_type"] == "other"
    ]
    require(len(headings) == 1, "Attachment lacks its checked Expenditures heading")
    return dict(catalogue=a, parent_reference=reference, attachment_heading=headings[0])


def publisher_relationship(value, receipt):
    """Exact catalogue person/report claim, separate from form-role inference."""
    require(
        not any(
            f["record_type"] == "cover"
            and f["state"] == "value"
            and f["value_type"] == "mark"
            and f["normalized"] == "marked"
            and f["label"]
            in {
                "Association",
                "Independent expenditure",
                "Independent expenditure report",
            }
            for f in receipt["fields"]
        ),
        "Contrary association/outside-spending role cannot become a candidate relationship",
    )
    offered = value.get("attachment_catalogue")
    require(
        isinstance(offered, dict) and offered.get("profile") == PROFILE,
        "No closed Olmsted publisher relationship",
    )
    scope = offered["group_scope"]
    report = value["report"]
    person = scope["person_as_source"]
    require(
        value["document_role"] == "primary"
        and value["authority"]["key"] == "local:county:55"
        and value["election_date"] == offered["election_date"] == "2026-11-03"
        and value["account"]["name"] == person
        and value["account"].get("candidate_name") in (None, person)
        and scope["office_as_source"] == "County Attorney"
        and scope["district_as_source"] is None
        and value["office_literal"] == "Olmsted County Attorney",
        "Olmsted publisher identity conflicts with checked cover",
    )
    members = [m for m in offered["members"] if m["url"] == document_request(value)]
    require(len(members) == 1, "Publisher does not offer this exact report")
    member = members[0]
    match = _PERIOD.search(member["label"])
    require(
        match is not None
        and member["label"]
        == f"{person} Pre-Primary Campaign Finance Report {match.group(0)}"
        and member["period"] == [report["period_start"], report["period_end"]]
        and report["report_type"] == "Pre-primary",
        "Publisher person/report role or period conflicts with checked source",
    )
    return dict(
        relationship="publisher_lists_report_for_person",
        profile=PROFILE,
        catalogue_sha256=offered["catalogue_sha256"],
        catalogue_url=offered["catalogue_url"],
        group_scope=scope,
        member=member,
    )


def county_office_matches(publisher, race, literal):
    """One source-backed county wording pair, never arbitrary name/office aliases."""
    jurisdiction = publisher.get("jurisdiction", {})
    return (
        publisher.get("key") == "local:county:55"
        and publisher.get("name") == "Olmsted County"
        and jurisdiction.get("recipient_type") == "county"
        and jurisdiction.get("recipient_id") == "55"
        and jurisdiction.get("county_ids") == ["55"]
        and race.payload.get("jurisdiction_kind") == "county"
        and race.payload.get("jurisdiction_id") == "55"
        and race.payload.get("county_ids", ["55"]) == ["55"]
        and race.payload.get("office_name") == "County Attorney"
        and literal == "Olmsted County Attorney"
    )


def report_binding_matches(locator, report, *, parent_original):
    """Require the actual containing report's exact checked parent identity."""
    validate_locator(locator)
    binding = report.get("binding")
    parts = binding if isinstance(binding, list) else [binding]
    require(
        bool(parts) and report.get("source_sha256") == parent_original,
        "Attachment belongs to a different containing report original",
    )
    for part in parts:
        require(
            isinstance(part, dict)
            and part.get("adapter") == "local_checked_reading:v1"
            and part.get("source_sha256") == parent_original
            and part.get("locator")
            == {"kind": "report", "receipt_sha256": locator["parent_receipt_sha256"]},
            "Attachment parent is not this exact report identity binding",
        )
