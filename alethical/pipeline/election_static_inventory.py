"""Closed retained static publisher groups, never publisher-issued account IDs.

No scripts execute and remote assets are not fetched or represented as inspected.
The exact asset-reference/inline profile bounds the claim to offered retained HTML.
Acquisition, reading approval and dated candidate review remain separate checks.
"""

from __future__ import annotations

from datetime import date
import hashlib
import json
import re
from urllib.parse import urljoin

from alethical.pipeline import election_local_context as c
from alethical.pipeline.election_comparison import digest

STATIC_INVENTORY_PROFILE = "mn_static_local_offered_inventory:v1"
# Exact ordered (tag, attributes, inline text) profiles of the retained pages.
# Inline behavior covers site navigation/search, analytics, layout, accessibility,
# translation and image lazy loading. Remote references are recognized, not read.
_ASSETS = {
    "itasca": "d1e33142a9b3e9a73a18a911609c2725e99c930e341efb556b407e5907693c7a",
    "otter": "ad7ff0e3edbb48356c1b4dc80ddb86d92f9320816c8acdacfe1cf0f2df5d9343",
}
STATIC_CATALOGUES = {
    "https://www.itascacountymn.gov/710/Campaign-Finance-Information": ("itasca", "31"),
    "https://ottertailcounty.gov/elections-and-voting/campaign-financial-reports/": (
        "otter",
        "56",
    ),
}
_CERTIFICATE_LABEL = "Campaign Financial Report Certification of Filing"
_PERIOD = re.compile(
    r"([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}) (?:-|to) ([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})"
)
require = c.require


def _assets(doc, profile):
    nodes = [n for n in doc.nodes if n.tag in {"script", "style", "link"}]
    require(not any(n.duplicate for n in nodes), "Ambiguous static inventory assets")
    value = [(n.tag, n.attrs, "".join(n.text)) for n in nodes]
    # A script/style-free static document is also a closed, nonexecutable profile.
    require(
        not nodes
        or hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        == _ASSETS[profile],
        "Unsupported static inventory asset profile",
    )


_OUTSIDE = {
    "itasca": "19f80a52171a62621c6855699630e4b3f9207cbb505af43664d0f027deaa4677",
    "otter": "eea1a47bde0c19bb4a0de575217efc8f6d84b0a6217b9f319150a56ee1b08044",
}


class _StaticHTML(c._HTML):
    def __init__(self, body):
        self.unparented_text = []
        super().__init__(body)

    def handle_data(self, data):
        if not self.stack and data.strip():
            self.unparented_text.append(data)
        super().handle_data(data)


def _outside(doc, section, profile):
    require(not doc.unparented_text, "Unassigned text outside static document")
    nodes = [n for n in doc.nodes if n is not section and not c._inside(n, section)]
    # A minimal nonexecuting test/source wrapper has no other offered actions.
    if all(
        n.tag in {"html", "body", "div"}
        and not any(k.startswith(("on", "data-")) for k in n.attrs)
        and not "".join(x for x in n.content if isinstance(x, str)).strip()
        for n in nodes
    ):
        return
    value = [
        (n.tag, n.attrs, "".join(x for x in n.content if isinstance(x, str)))
        for n in nodes
    ]
    require(
        hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        == _OUTSIDE[profile],
        "Unknown navigation, controls or competing content outside static section",
    )


def _heading_visibility(doc):
    # The generic text matcher conservatively treats complex selectors as possible.
    # Its structural matcher can prove some unrelated WordPress/button selectors do
    # not match a heading. Refine only that negative result, never an unknown match.
    for node in doc.nodes:
        if node.tag not in (*c.HEADINGS, "br") or doc.css_uncertain:
            continue
        if (
            any(k in node.attrs for k in ("hidden", "inert"))
            or node.attrs.get("aria-hidden", "").lower() == "true"
            or c._obscuring_style(node.attrs.get("style", ""))
        ):
            continue
        if all(
            not c._obscuring_style(style)
            or c._table_selector_match(node, selector) is False
            for selector, style in doc.table_rules
        ):
            doc.local_visibility[node] = True


def _safe_tree(section):
    allowed = {
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "p",
        "ul",
        "li",
        "a",
        "strong",
        "b",
        "span",
        "br",
        "figure",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
    }
    for n in [section, *c._descendants(section)]:
        require(
            n.tag in allowed
            and not n.duplicate
            and not n.ancestry_uncertain
            and (n.source_closed or n.tag == "br")
            and c._usable(n),
            "Static inventory has hidden, malformed or unsupported content",
        )
        require(
            not any(
                k.startswith("on")
                or k.startswith("data-")
                and not (
                    k == "data-align"
                    and n.tag in {"th", "td"}
                    and n.attrs[k] == "center"
                    or k == "data-pasted"
                    and n.tag in {"strong", "h2", "h3"}
                    and n.attrs[k] == "true"
                )
                for k in n.attrs
            ),
            "Static inventory has executable, filtered or loaded content",
        )
        if n.tag in {"div", "figure", "table", "thead", "tbody", "tr", "ul"}:
            require(
                not "".join(x for x in n.content if isinstance(x, str)).strip(),
                "Unassigned text in static inventory structure",
            )
        require(
            all(k not in n.attrs for k in ("src", "srcdoc", "contenteditable")),
            "Static inventory content is not fixed",
        )


def _member(doc, links, label):
    require(
        bool(links) and len({n.attrs.get("href") for n in links}) == 1,
        "Inventory item has competing document links",
    )
    href = links[0].attrs.get("href")
    require(
        isinstance(href, str)
        and href
        and "#" not in href
        and not href.lower().startswith(("javascript:", "data:", "mailto:")),
        "Inventory link is not a document",
    )
    anchors = doc.all("a")
    return {
        "label": label,
        "href": href,
        "member_locator": {
            "anchors": [
                {
                    "anchor_index": anchors.index(n) + 1,
                    "line": n.line,
                    "href": href,
                    "label": c._text(n),
                }
                for n in links
            ]
        },
    }


def _scope(shape, year, office, district, person):
    require(
        re.fullmatch(r"20[0-9]{2}", year or "") is not None
        and bool(office)
        and bool(person),
        "Static group lacks its year, office or person",
    )
    return {
        "shape": shape,
        "year": year,
        "office_as_source": office,
        "district_as_source": district,
        "person_as_source": person,
    }


def _list_groups(doc):
    boxes = [
        n
        for n in doc.all("div")
        if n.attrs.get("id") == "divEditoraafee29a-985e-4b53-aee2-56e2e5b68410"
    ]
    require(len(boxes) == 1, "Static content section is ambiguous")
    views = [
        n
        for n in boxes[0].children
        if n.tag == "div" and n.attrs.get("class") == "fr-view"
    ]
    require(
        len(views) == 1
        and all(n in views or n.tag == "script" for n in boxes[0].children),
        "Static listing section is incomplete",
    )
    section = views[0]
    _safe_tree(section)
    groups, year, office, district, person = [], None, None, None, None
    for n in section.children:
        if n.tag in {"h1", "h2", "h3"}:
            require(person is None, "Person is separated from its adjacent report list")
            if n.tag == "h1":
                require(year is None, "Repeated static listing year")
                year = c._text(n)
            elif n.tag == "h2":
                office, district = c._text(n), None
            else:
                require(office is not None, "District lacks its office heading")
                district = c._text(n)
        elif n.tag == "p":
            require(
                person is None
                and all(x.tag == "strong" and not x.children for x in n.children),
                "Ambiguous static person paragraph",
            )
            person = c._text(n)
        elif n.tag == "ul":
            scope = _scope("office_person_list", year, office, district, person)
            require(
                bool(n.children) and all(x.tag == "li" for x in n.children),
                "Incomplete static report list",
            )
            members = []
            for item in n.children:
                links = [x for x in item.children if x.tag == "a"]
                require(
                    len(links) == len(item.children), "Unsupported static list item"
                )
                members.append(_member(doc, links, c._text(item)))
            groups.append({"group_scope": scope, "line": n.line, "members": members})
            person = None
        else:
            require(False, "Unassigned content or continuation in static listing")
    require(person is None and groups, "Incomplete static group")
    return section, groups


def _table_groups(doc):
    tables = [
        n
        for n in doc.all("table")
        if [c._text(x) for x in c._descendants(n) if x.tag == "th"]
        == ["Office", "Candidate", "Reporting Period"]
    ]
    require(len(tables) == 1, "Static report table is ambiguous")
    table = tables[0]
    require(
        table.parent is not None
        and table.parent.tag == "figure"
        and table.parent.parent is not None,
        "Static report table lacks its content section",
    )
    section = table.parent.parent
    _safe_tree(section)
    children = section.children
    pos = children.index(table.parent)
    require(
        pos > 0
        and children[pos - 1].tag == "h2"
        and all(n.tag == "p" for n in children[: pos - 1])
        and pos == len(children) - 1,
        "Table heading or continuation is unresolved",
    )
    prelude = children[: pos - 1]
    require(
        not prelude
        or [c._text(n) for n in prelude]
        == [
            "Per Minnesota Statute 211A.02, campaign financial reports will be posted within 30 days of receipt of the report and will remain accessible for four years after the date the report was filed.",
            "Recent legislation signed into law requires that street addresses of candidates be redacted from campaign financial reports. Otter Tail County has removed all past reports for review and will repost them when the redaction process is complete.",
        ],
        "Unknown static listing prelude or continuation",
    )
    require(
        all(
            n.tag == "a"
            and n.attrs.get("href")
            == "https://www.revisor.mn.gov/statutes/cite/211A.02"
            and c._text(n) == "Minnesota Statute 211A.02"
            for p in prelude
            for n in p.children
        ),
        "Unassigned static prelude link",
    )
    heading = c._text(children[pos - 1])
    match = re.fullmatch(r"(20[0-9]{2}) Campaign Financial Reports", heading)
    if match is None:
        raise c.ComparisonImportError("Static table year heading is missing")
    require(
        [n.tag for n in table.children] == ["thead", "tbody"]
        and len(table.children[0].children) == 1,
        "Static table header/body is incomplete",
    )
    groups = []
    for row in table.children[1].children:
        cells = row.children
        require(
            row.tag == "tr"
            and len(cells) == 3
            and all(n.tag == "td" for n in cells)
            and not cells[0].children
            and not cells[1].children,
            "Static table row is ambiguous",
        )
        require(
            not "".join(x for x in cells[2].content if isinstance(x, str)).strip(),
            "Unassigned reporting-period text",
        )
        links = [n for n in cells[2].children if n.tag == "a"]
        require(
            links and all(n.tag in {"a", "br"} for n in cells[2].children),
            "Static table contains unassigned documents",
        )
        groups.append(
            {
                "group_scope": _scope(
                    "office_candidate_table",
                    match[1],
                    c._text(cells[0]),
                    None,
                    c._text(cells[1]),
                ),
                "line": row.line,
                "members": [_member(doc, [a], c._text(a)) for a in links],
            }
        )
    require(groups, "Static table is empty")
    return section, groups


def static_offered_inventory(body, document_url, edge, root):
    """Exact selected static group, bound to the independently verified root."""
    require(document_url in STATIC_CATALOGUES, "Unsupported static publisher listing")
    profile, county = STATIC_CATALOGUES[document_url]
    recipient = root["recipient"]
    require(
        recipient.get("namespace") == "county"
        and recipient.get("source_id") == county
        and recipient.get("county_ids") == [county],
        "Static publisher belongs to another typed recipient",
    )
    doc = _StaticHTML(body)
    _assets(doc, profile)
    require(not doc.all("base"), "Static inventory has an unsupported base")
    _heading_visibility(doc)
    section, groups = _list_groups(doc) if profile == "itasca" else _table_groups(doc)
    _outside(doc, section, profile)
    parsed_anchors = {
        a["anchor_index"]
        for g in groups
        for m in g["members"]
        for a in m["member_locator"]["anchors"]
    }
    all_anchors = doc.all("a")
    section_anchors = {
        all_anchors.index(n) + 1 for n in c._descendants(section) if n.tag == "a"
    }
    statutory_anchors = {
        all_anchors.index(n) + 1
        for n in c._descendants(section)
        if profile == "otter"
        and n.tag == "a"
        and n.parent in section.children
        and n.parent.tag == "p"
        and n.attrs.get("href") == "https://www.revisor.mn.gov/statutes/cite/211A.02"
        and c._text(n) == "Minnesota Statute 211A.02"
    }
    require(
        section_anchors == parsed_anchors | statutory_anchors,
        "Static inventory contains an unassigned section anchor",
    )
    require(
        len(groups) <= 256
        and len({digest(g["group_scope"]) for g in groups}) == len(groups),
        "Duplicate static person/office group",
    )
    # A repeated person under another office is also unresolved, not an alias.
    require(
        len({g["group_scope"]["person_as_source"].casefold() for g in groups})
        == len(groups),
        "Duplicate static person",
    )
    selected, offered_urls = [], set()
    for group in groups:
        scope = group["group_scope"]
        require(
            scope["year"] == root["election_date"][:4],
            "Static group belongs to another election year",
        )
        hrefs = [m["href"] for m in group["members"]]
        require(len(hrefs) == len(set(hrefs)), "Duplicate static document rows")
        for member in group["members"]:
            member["url"] = c.p.url(urljoin(document_url, member["href"]))
            wire_url = c.p.wire_url(member["url"])
            require(
                wire_url not in offered_urls,
                "Resolved static document URL is repeated",
            )
            offered_urls.add(wire_url)
            for anchor in member["member_locator"]["anchors"]:
                if anchor == {
                    k: edge[k] for k in ("anchor_index", "line", "href", "label")
                }:
                    selected.append(group)
    require(len(selected) == 1, "Selected anchor is not in one exact static group")
    group = selected[0]
    require(0 < len(group["members"]) <= 256, "Static inventory member bound exceeded")
    basis = {
        "profile": STATIC_INVENTORY_PROFILE,
        "recipient": recipient,
        "election_date": root["election_date"],
        "catalogue_url": document_url,
        "group_scope": group["group_scope"],
    }
    return {
        "profile": STATIC_INVENTORY_PROFILE,
        "catalogue_sha256": hashlib.sha256(body).hexdigest(),
        "catalogue_url": document_url,
        "section_line": section.line,
        **group,
        "selection_group_key": "local-selection:" + digest(basis),
    }


def validate_member_locator(locator):
    require(
        isinstance(locator, dict)
        and set(locator) == {"anchors"}
        and isinstance(locator["anchors"], list)
        and 0 < len(locator["anchors"]) <= 8,
        "Invalid static member locator",
    )
    positions = []
    for a in locator["anchors"]:
        require(
            isinstance(a, dict)
            and set(a) == {"anchor_index", "line", "href", "label"}
            and type(a["anchor_index"]) is int
            and a["anchor_index"] > 0
            and type(a["line"]) is int
            and a["line"] > 0
            and isinstance(a["href"], str)
            and bool(a["href"])
            and isinstance(a["label"], str)
            and bool(a["label"]),
            "Invalid static anchor locator",
        )
        positions.append(a["anchor_index"])
    require(
        positions == sorted(set(positions))
        and len({a["href"] for a in locator["anchors"]}) == 1,
        "Ambiguous static member anchors",
    )
    return digest(locator)


_TYPE_LABELS = {
    "Initial",
    "Pre-primary",
    "Pre-general",
    "Post-general",
    "Final",
    "Annual",
}


def checked_type_fields(receipt):
    return [
        {
            k: f[k]
            for k in (
                "field_id",
                "page",
                "bounds",
                "label",
                "literal",
                "state",
                "value_type",
                "normalized",
            )
        }
        for f in receipt["fields"]
        if f["record_type"] == "cover"
        and (
            f["field_id"].startswith("cover.report_type")
            or f["label"] == "Type of report"
            or f["label"] in _TYPE_LABELS
            or "amend" in f["label"].lower()
        )
    ]


def _type_checked(values, receipt):
    report_type = values["report"]["report_type"]
    require(
        report_type is None or report_type in _TYPE_LABELS,
        "Static report type is uncertain or amended",
    )
    types = set()
    # Check all observed type fields, including ones not mapped as a positive mark.
    for f in receipt["fields"]:
        if f["record_type"] != "cover" or not (
            f["field_id"].startswith("cover.report_type")
            or f["label"] == "Type of report"
            or f["label"] in _TYPE_LABELS
            or "amend" in f["label"].lower()
        ):
            continue
        require(
            f["state"] in {"value", "blank"},
            "Static report has an uncertain type/amendment field",
        )
        if f["state"] == "blank":
            continue
        require(
            "amend" not in (f["label"] + " " + f["literal"]).lower(),
            "Static inventory cannot order amendments",
        )
        if f["value_type"] == "mark":
            require(
                f["label"] in _TYPE_LABELS and f["normalized"] == "marked",
                "Unknown checked static report type",
            )
            types.add(f["label"])
        else:
            literal = f["literal"].strip("() ").lower().removesuffix(" report")
            require(
                f["label"] == "Type of report"
                and literal in {x.lower() for x in _TYPE_LABELS},
                "Unknown literal static report type",
            )
            types.add(next(x for x in _TYPE_LABELS if x.lower() == literal))
    require(
        len(types) <= 1
        and (report_type is None or not types or types == {report_type}),
        "Checked static report types conflict",
    )


def static_inventory_family(row, values, receipt):
    """The publisher's literal period must exactly equal the checked cover period."""
    _type_checked(values, receipt)
    report = values["report"]
    require(
        values["document_role"] == "primary"
        and report["period_start"]
        and report["period_end"]
        and report["period_start"] <= report["period_end"],
        "Static financial member lacks an ordered checked period",
    )
    match = _PERIOD.fullmatch(row["label"])
    if match is None:
        raise c.ComparisonImportError("Static inventory has an unknown financial label")
    try:
        endpoints = [
            date(int(y), int(m), int(d)).isoformat()
            for m, d, y in (v.split("/") for v in match.groups())
        ]
    except ValueError as exc:
        raise c.ComparisonImportError("Static inventory period is invalid") from exc
    require(
        endpoints == [report["period_start"], report["period_end"]],
        "Publisher period conflicts with checked cover endpoints",
    )
    return {
        "kind": "publisher_period",
        "period_start": endpoints[0],
        "period_end": endpoints[1],
    }


def certificate_member(row, values, receipt):
    require(
        row["label"] == _CERTIFICATE_LABEL
        and values["document_role"] == "certification"
        and receipt["document_kind"] == "certification",
        "Static companion is not a complete checked certification",
    )
    statements = [
        f
        for f in receipt["fields"]
        if f["record_type"] == "certification"
        and f["value_type"] == "text"
        and f["state"] == "value"
        and f["label"] == "Certification"
    ]
    choices = [
        f
        for f in receipt["fields"]
        if f["record_type"] == "certification" and f["value_type"] == "mark"
    ]
    marked = [
        f for f in choices if f["state"] == "value" and f["normalized"] == "marked"
    ]
    require(
        choices
        and len(marked) == 1
        and all(
            f["state"] in {"blank", "value"}
            for f in receipt["fields"]
            if f["record_type"] == "certification"
        )
        and sum(f["literal"] == marked[0]["label"] for f in statements) == 1,
        "Certification has no complete checked source statement/choice",
    )
    require(
        values["report"]["period_start"] is None
        and values["report"]["period_end"] is None
        and values["report"]["report_type"] is None,
        "Certification cannot supply a financial period or type",
    )
