"""Closed static listing shapes and exact physical-report version semantics."""

import pytest

from alethical.pipeline import election_local_context as local
from alethical.pipeline import election_static_inventory as static
from alethical.pipeline.election_comparison import ComparisonImportError

ITASCA_URL = "https://www.itascacountymn.gov/710/Campaign-Finance-Information"
OTTER_URL = (
    "https://ottertailcounty.gov/elections-and-voting/campaign-financial-reports/"
)
ITASCA = """<html><body><div id="divEditoraafee29a-985e-4b53-aee2-56e2e5b68410"><div class="fr-view"><h1>2026</h1><h2>County Attorney</h2><p>Cassidy Villeneuve</p><ul><li><a href="/DocumentCenter/View/1">5/19/2026 - 7/1/2026</a></li><li><a href="/DocumentCenter/View/2">7/2/2026 - 8/2/2026</a></li><li><a href="/DocumentCenter/View/3">8/2/2026 - 10/20/2026</a></li><li><a href="/DocumentCenter/View/4">Campaign Financial Report Certification of Filing</a></li></ul></div></div></body></html>"""
OTTER = """<html><body><div class="fl-rich-text"><h2 class="wp-block-heading"><strong>2026 Campaign Financial Reports</strong></h2><figure class="wp-block-table is-style-stripes"><table class="has-fixed-layout"><thead><tr><th>Office</th><th>Candidate</th><th>Reporting Period</th></tr></thead><tbody><tr><td>County Commissioner District 2</td><td>Jeff Gontarek</td><td><a href="/one.pdf">5/19/2026 to 7/28/2026</a><br><a href="/two.pdf">7/29/2026 to 10/19/2026</a></td></tr></tbody></table></figure></div></body></html>"""


def root(county="Itasca", code="31"):
    return {
        "election_date": "2026-11-03",
        "recipient": {
            "namespace": "county",
            "source_id": code,
            "name": county,
            "county_ids": [code],
        },
    }


def edge(body, url, index=1):
    doc = local._HTML(body.encode())
    a = doc.all("a")[index - 1]
    return {
        "anchor_index": index,
        "line": a.line,
        "href": a.attrs["href"],
        "label": local._text(a),
        "base_href": None,
        "target_url": url.rstrip("/") + "/unused",
    }


def inventory(body=ITASCA, url=ITASCA_URL, index=1, recipient=None):
    return static.static_offered_inventory(
        body.encode(), url, edge(body, url, index), recipient or root()
    )


def test_itasca_complete_four_member_group_keeps_exact_locators():
    v = inventory()
    assert v["profile"] == static.STATIC_INVENTORY_PROFILE
    assert v["group_scope"] == {
        "shape": "office_person_list",
        "year": "2026",
        "office_as_source": "County Attorney",
        "district_as_source": None,
        "person_as_source": "Cassidy Villeneuve",
    }
    assert len(v["members"]) == 4
    assert v["members"][0]["member_locator"]["anchors"] == [
        {
            "anchor_index": 1,
            "line": 1,
            "href": "/DocumentCenter/View/1",
            "label": "5/19/2026 - 7/1/2026",
        }
    ]
    assert (
        v["members"][3]["label"] == "Campaign Financial Report Certification of Filing"
    )
    assert "version_as_of" not in v
    assert "account_id_as_source" not in v


def test_otter_exact_row_closes_every_offered_member():
    v = inventory(OTTER, OTTER_URL, recipient=root("Otter Tail", "56"))
    assert v["group_scope"]["person_as_source"] == "Jeff Gontarek"
    assert v["group_scope"]["office_as_source"] == "County Commissioner District 2"
    assert len(v["members"]) == 2


def test_split_adjacent_same_href_within_one_item_is_one_original():
    split = ITASCA.replace(
        "Campaign Financial Report Certification of Filing</a>",
        'Campaign Financial Report</a><a href="/DocumentCenter/View/4"> Certification of Filing</a>',
    )
    v = inventory(split)
    assert len(v["members"]) == 4
    assert len(v["members"][3]["member_locator"]["anchors"]) == 2
    assert (
        v["members"][3]["label"] == "Campaign Financial Report Certification of Filing"
    )


@pytest.mark.parametrize("across_people", [False, True])
def test_distinct_source_links_to_same_wire_request_are_not_two_members(across_people):
    body = ITASCA.replace("/DocumentCenter/View/1", "/DocumentCenter/View/report 1.pdf")
    if across_people:
        body = body.replace(
            "</ul>",
            '</ul><p>Different Person</p><ul><li><a href="/DocumentCenter/View/report%201.pdf">5/19/2026 - 7/1/2026</a></li></ul>',
            1,
        )
    else:
        body = body.replace(
            "/DocumentCenter/View/2", "/DocumentCenter/View/report%201.pdf"
        )
    with pytest.raises(ComparisonImportError):
        inventory(body)


@pytest.mark.parametrize(
    "change",
    [
        lambda s: s.replace("<p>Cassidy", "<p hidden>Cassidy"),
        lambda s: s.replace("<ul>", "<ul hidden>"),
        lambda s: s.replace("<h2>County Attorney</h2>", ""),
        lambda s: s.replace(
            "</ul>",
            '</ul><p>Cassidy Villeneuve</p><ul><li><a href="/other.pdf">More</a></li></ul>',
        ),
        lambda s: s.replace(
            "</ul>",
            '<li><a href="/DocumentCenter/View/1">5/19/2026 - 7/1/2026</a></li></ul>',
        ),
        lambda s: s.replace("</ul>", '</ul><a href="/page2">Next page</a>'),
        lambda s: s.replace("</ul>", "</ul><select><option>2026</option></select>"),
        lambda s: s.replace("</body>", '<script src="/unknown.js"></script></body>'),
        lambda s: s.replace(
            "</body>", '<script>document.querySelector("ul").remove()</script></body>'
        ),
        lambda s: s.replace("<ul>", '<ul data-url="/more">'),
        lambda s: s.replace("</li>", "", 1),
    ],
)
def test_ambiguous_hidden_changed_or_continued_section_refuses(change):
    with pytest.raises(ComparisonImportError):
        inventory(change(ITASCA))


def test_wrong_typed_recipient_refuses():
    with pytest.raises(ComparisonImportError):
        inventory(recipient=root("Otter Tail", "56"))


def test_group_key_is_stable_across_members_and_changed_bytes_but_not_scope():
    first = inventory()
    assert first["selection_group_key"] == inventory(index=3)["selection_group_key"]
    assert (
        first["selection_group_key"]
        == inventory(ITASCA.replace("10/20/2026", "10/21/2026"))["selection_group_key"]
    )
    assert (
        first["catalogue_sha256"]
        != inventory(ITASCA.replace("10/20/2026", "10/21/2026"))["catalogue_sha256"]
    )
    assert (
        first["selection_group_key"]
        != inventory(ITASCA.replace("Cassidy Villeneuve", "Different Person"))[
            "selection_group_key"
        ]
    )
    assert (
        first["selection_group_key"]
        != inventory(ITASCA.replace("County Attorney", "County Auditor"))[
            "selection_group_key"
        ]
    )


def test_literal_period_family_checks_cover_without_filling_type():
    values = {
        "document_role": "primary",
        "report": {
            "period_start": "2026-05-19",
            "period_end": "2026-07-01",
            "report_type": None,
        },
    }
    assert static.static_inventory_family(
        {"label": "5/19/2026 - 7/1/2026"}, values, {"fields": []}
    ) == {
        "kind": "publisher_period",
        "period_start": "2026-05-19",
        "period_end": "2026-07-01",
    }
    assert values["report"]["report_type"] is None
    values["report"]["period_end"] = "2026-07-02"
    with pytest.raises(ComparisonImportError):
        static.static_inventory_family(
            {"label": "5/19/2026 - 7/1/2026"}, values, {"fields": []}
        )


@pytest.mark.parametrize(
    "label,state,literal", [("Amended", "value", "X"), ("Initial", "ambiguous", "?")]
)
def test_uncertain_or_amended_type_blocks_period_family(label, state, literal):
    values = {
        "document_role": "primary",
        "report": {
            "period_start": "2026-05-19",
            "period_end": "2026-07-01",
            "report_type": None,
        },
    }
    receipt = {
        "fields": [
            {
                "field_id": "cover.report_type",
                "record_type": "cover",
                "label": label,
                "state": state,
                "literal": literal,
                "value_type": "mark",
                "normalized": None,
            }
        ]
    }
    with pytest.raises(ComparisonImportError):
        static.static_inventory_family(
            {"label": "5/19/2026 - 7/1/2026"}, values, receipt
        )


@pytest.mark.parametrize(
    "outside",
    [
        '<a href="/more.pdf">More reports</a>',
        '<input type="search">',
        '<div data-url="/page2">More</div>',
    ],
)
def test_unknown_navigation_outside_the_content_section_also_refuses(outside):
    with pytest.raises(ComparisonImportError):
        inventory(ITASCA.replace("</body>", outside + "</body>"))


def test_static_locator_uses_exact_anchors_never_document_number():
    from alethical.pipeline import election_external_finance as storage
    from alethical.pipeline.election_comparison import digest

    members = [
        {"member_locator": m["member_locator"], "receipt_sha256": f"{i:064x}"}
        for i, m in enumerate(inventory()["members"], 1)
    ]
    members.sort(key=lambda m: digest(m["member_locator"]))
    locator = {
        "kind": "offered_inventory_version",
        "profile": static.STATIC_INVENTORY_PROFILE,
        "receipt_sha256": f"{1:064x}",
        "members": members,
    }
    assert storage.inventory_reading_ids(locator) == {f"{i:064x}" for i in range(1, 5)}
    locator["members"][0]["source_report_id"] = "1"
    with pytest.raises(ComparisonImportError):
        storage.inventory_reading_ids(locator)


@pytest.mark.parametrize(
    "page,sha,url,county,total",
    [
        (
            "itasca",
            "c7effe76e36633763f94744abbf604274e311ca7f479d51b11f2b7d4f881a7df",
            ITASCA_URL,
            "31",
            18,
        ),
        (
            "otter",
            "b13be13c9ad44f63d71e537fdcbeabf603fb1dc2a8a6aa285b89e56a9e262eae",
            OTTER_URL,
            "56",
            17,
        ),
    ],
)
def test_exact_retained_catalogues_replay_all_member_anchors(
    page, sha, url, county, total
):
    import hashlib
    import os
    from pathlib import Path

    path = (
        Path(os.environ.get("ALETHICAL_RETAINED_LOCAL_EVIDENCE", "/nonexistent"))
        / "local-source-capture"
        / (sha + ".body")
    )
    if not path.is_file():
        pytest.skip("private retained originals unavailable")
    body = path.read_bytes()
    assert hashlib.sha256(body).hexdigest() == sha
    doc = local._HTML(body)
    groups = {}
    typed = {
        "election_date": "2026-11-03",
        "recipient": {
            "namespace": "county",
            "source_id": county,
            "district_type": None,
            "municipality_type": None,
            "county_ids": [county],
        },
    }
    for i, a in enumerate(doc.all("a"), 1):
        href = a.attrs.get("href", "")
        if (page == "itasca" and href.startswith("/DocumentCenter/View/")) or (
            page == "otter"
            and "/wp-content/uploads/2026/" in href
            and href.endswith(".pdf")
        ):
            e = {
                "anchor_index": i,
                "line": a.line,
                "href": href,
                "label": local._text(a),
                "base_href": None,
            }
            v = static.static_offered_inventory(body, url, e, typed)
            groups[v["selection_group_key"]] = v
            e.update(
                kind="html_anchor",
                source_sha256=sha,
                target_url=next(
                    m["url"]
                    for m in v["members"]
                    if any(
                        x["anchor_index"] == i for x in m["member_locator"]["anchors"]
                    )
                ),
            )
            assert local.replay_html_anchor(body, url, e) == e["target_url"]
    assert len(groups) == (9 if page == "itasca" else 6)
    assert sum(len(g["members"]) for g in groups.values()) == total
    # Profile-bound source changes cannot silently inherit a prior closed proof.
    with pytest.raises(ComparisonImportError):
        static.static_offered_inventory(
            body + b'<script src="/new.js"></script>', url, e, typed
        )


@pytest.fixture
def static_version_world(monkeypatch):
    """Isolate version-family logic; normal verifier/source tests are separate."""
    from copy import deepcopy
    from alethical.pipeline import election_local_sources as adapter
    from alethical.pipeline.election_comparison import digest

    inv = inventory()
    inv["version_as_of"] = "2026-11-12T00:00:00+00:00"
    values, receipts, members = {}, {}, []
    for i, row in enumerate(inv["members"], 1):
        rid = f"{i:064x}"
        certificate = i == 4
        period = [
            ("2026-05-19", "2026-07-01"),
            ("2026-07-02", "2026-08-02"),
            ("2026-08-02", "2026-10-20"),
            (None, None),
        ][i - 1]
        values[rid] = {
            "offered_inventory": inv,
            "election_date": "2026-11-03",
            "authority": {"key": "local:county:31"},
            "account": {
                "issued_id": False,
                "account_id": "group:" + rid,
                "name": "Cassidy Villeneuve",
            },
            "report": {
                "authority": "local:county:31",
                "account_id": "group:" + rid,
                "source_report_id": None,
                "period_start": period[0],
                "period_end": period[1],
                "report_type": None,
                "effective": None,
            },
            "document_role": "certification" if certificate else "primary",
            "document_url": row["url"],
            "source_chain": [
                {
                    "source_sha256": rid,
                    "final_url": row["url"],
                    "copied_at": inv["version_as_of"],
                }
            ],
            "section": {"cover": {"page": 1}},
            "office_literal": "County Attorney",
        }
        receipts[rid] = {
            "original_sha256": rid,
            "document_kind": "certification" if certificate else "financial_report",
            "fields": [
                {
                    "record_type": "certification",
                    "value_type": "text",
                    "state": "value",
                    "label": "Certification",
                    "literal": "All required reports submitted.",
                },
                {
                    "record_type": "certification",
                    "value_type": "mark",
                    "state": "value",
                    "normalized": "marked",
                    "label": "All required reports submitted.",
                    "literal": "X",
                },
            ]
            if certificate
            else [],
        }
        members.append({"member_locator": row["member_locator"], "receipt_sha256": rid})
    members.sort(key=lambda x: digest(x["member_locator"]))
    locator = {
        "kind": "offered_inventory_version",
        "receipt_sha256": f"{1:064x}",
        "profile": static.STATIC_INVENTORY_PROFILE,
        "members": members,
    }

    class Context:
        original_hashes = set(receipts)

        def receipt(self, rid):
            return deepcopy(receipts[rid])

    def entity(context, loc, *, report=True):
        v = deepcopy(values[loc["receipt_sha256"]])
        if report and v["document_role"] != "primary":
            raise ComparisonImportError("Not a financial primary")
        return v

    monkeypatch.setattr(adapter, "_entity", entity)
    return adapter, Context(), locator, values, receipts, inv


def test_complete_static_version_does_not_merge_raw_accounts_or_fill_blank_type(
    static_version_world,
):
    adapter, context, locator, values, receipts, inv = static_version_world
    result = adapter._offered_inventory_version(context, locator)
    assert result.facts["effective"] is True
    assert result.facts["selection_group_key"] == inv["selection_group_key"]
    assert len(result.facts["version_sources"]) == 5
    assert all(
        v["report"]["effective"] is None and v["report"]["report_type"] is None
        for v in values.values()
    )
    assert len({v["account"]["account_id"] for v in values.values()}) == 4


@pytest.mark.parametrize(
    "change",
    [
        "same_family_bytes",
        "null_date",
        "missing_certificate",
        "unresolved_certificate",
        "certificate_period",
        "supplement",
        "unknown_label",
        "uncertain_type",
    ],
)
def test_static_version_competitor_and_nonfinancial_holds(static_version_world, change):
    adapter, context, locator, values, receipts, inv = static_version_world
    one, two, cert = (f"{i:064x}" for i in (1, 2, 4))
    if change == "same_family_bytes":
        inv["members"][1]["label"] = inv["members"][0]["label"]
        values[two]["report"].update(
            period_start=values[one]["report"]["period_start"],
            period_end=values[one]["report"]["period_end"],
        )
    elif change == "null_date":
        values[two]["report"]["period_end"] = None
    elif change == "missing_certificate":
        locator["members"] = [
            m for m in locator["members"] if m["receipt_sha256"] != cert
        ]
    elif change == "unresolved_certificate":
        receipts[cert]["fields"][1]["state"] = "ambiguous"
    elif change == "certificate_period":
        values[cert]["report"]["period_start"] = "2026-01-01"
    elif change == "supplement":
        values[two]["document_role"] = "supplement"
    elif change == "unknown_label":
        inv["members"][1]["label"] = "Additional report"
    else:
        receipts[two]["fields"] = [
            {
                "record_type": "cover",
                "field_id": "cover.report_type",
                "value_type": "mark",
                "state": "ambiguous",
                "label": "Pre-primary",
                "literal": "?",
            }
        ]
    with pytest.raises(ComparisonImportError):
        adapter._offered_inventory_version(context, locator)


@pytest.mark.parametrize(
    "body,url,index,recipient",
    [
        (
            ITASCA.replace(
                "<h2>County Attorney</h2>",
                '<h2><a href="/more-reports.pdf">County Attorney</a></h2>',
            ),
            ITASCA_URL,
            2,
            root(),
        ),
        (
            ITASCA.replace("<h1>2026</h1>", '<h1><a href="/page-2">2026</a></h1>'),
            ITASCA_URL,
            2,
            root(),
        ),
        (
            OTTER.replace("<th>Office</th>", '<th><a href="/page-2">Office</a></th>'),
            OTTER_URL,
            2,
            root("Otter Tail", "56"),
        ),
        (
            OTTER.replace(
                "<strong>2026 Campaign Financial Reports</strong>",
                '<a href="/page-2">2026 Campaign Financial Reports</a>',
            ),
            OTTER_URL,
            2,
            root("Otter Tail", "56"),
        ),
        (
            ITASCA.replace(
                "</body>",
                "<div>Only selected reports are shown. Additional reports are being reviewed.</div></body>",
            ),
            ITASCA_URL,
            1,
            root(),
        ),
        (
            ITASCA.replace(
                "</ul>",
                '</ul><p>CASSIDY VILLENEUVE</p><ul><li><a href="/different.pdf">10/21/2026 - 11/3/2026</a></li></ul>',
                1,
            ),
            ITASCA_URL,
            1,
            root(),
        ),
        (
            ITASCA.replace(
                "/DocumentCenter/View/2",
                "https://www.itascacountymn.gov/DocumentCenter/View/1",
            ),
            ITASCA_URL,
            1,
            root(),
        ),
        (
            ITASCA.replace(
                "</ul>",
                '</ul><p>Different Person</p><ul><li><a href="/DocumentCenter/View/1">5/19/2026 - 7/1/2026</a></li></ul>',
                1,
            ),
            ITASCA_URL,
            1,
            root(),
        ),
        (
            ITASCA.replace(
                "</ul>",
                '</ul><p>Different Person</p><ul><li><a href="/DocumentCenter/View/1">5/19/2026 - 7/1/2026</a></li></ul>',
                1,
            ),
            ITASCA_URL,
            5,
            root(),
        ),
    ],
)
def test_reviewed_unassigned_anchor_text_and_group_ambiguity_refuses(
    body, url, index, recipient
):
    with pytest.raises(ComparisonImportError):
        inventory(body, url, index, recipient)


@pytest.mark.parametrize(
    "body",
    [
        ITASCA + "Additional reports are being reviewed.",
        ITASCA.replace("</body>", "Only selected reports are shown.</body>"),
    ],
)
def test_reviewed_unassigned_outside_text_cannot_use_minimal_wrapper(body):
    with pytest.raises(ComparisonImportError):
        inventory(body)


@pytest.fixture
def publisher_relationship_world(monkeypatch):
    """Adapter unit boundary only; normal decision tests remain separate."""
    from copy import deepcopy
    from alethical.pipeline import election_local_sources as adapter

    values = {
        "account": {"name": "Synthetic Committee", "candidate_name": None},
        "report": {
            "authority": "local:county:31",
            "account_id": "group:physical",
            "source_report_id": None,
            "period_start": "2026-05-19",
            "period_end": "2026-07-01",
        },
        "publisher_relationship": {
            "relationship": "publisher_lists_report_for_person",
            "group_scope": {
                "person_as_source": "Cassidy Villeneuve",
                "office_as_source": "County Attorney",
                "district_as_source": None,
            },
        },
    }
    fields = {
        key: {
            "page": 1,
            "record_type": "cover",
            "value_type": "text",
            "state": "value",
            "label": label,
            "literal": literal,
        }
        for key, label, literal in [
            ("name", "Name of candidate or committee", "Synthetic Committee"),
            ("office", "Office sought", "County Attorney"),
        ]
    }
    fields["mark"] = {
        "page": 1,
        "record_type": "cover",
        "value_type": "mark",
        "state": "blank",
        "label": "Candidate",
        "literal": "",
        "normalized": None,
    }
    receipt = {
        "source_context": {
            "fields": {"name": "name", "office": "office", "candidate_mark": "mark"}
        }
    }
    locator = {
        "kind": "candidate_relationship",
        "receipt_sha256": "a" * 64,
        "relationship": "publisher_lists_report_for_person",
    }
    monkeypatch.setattr(adapter, "_entity", lambda *args, **kwargs: deepcopy(values))
    return adapter, values, fields, receipt, locator


@pytest.mark.parametrize("mapped_candidate", [True, False])
def test_reviewed_publisher_cannot_override_checked_candidate_even_if_context_omits_it(
    publisher_relationship_world, mapped_candidate
):
    adapter, values, fields, receipt, locator = publisher_relationship_world
    values["account"].update(
        name="Different Person",
        candidate_name="Different Person" if mapped_candidate else None,
    )
    fields["name"]["literal"] = "Different Person"
    fields["mark"].update(state="value", literal="X", normalized="marked")
    if not mapped_candidate:
        receipt["source_context"]["fields"]["candidate_mark"] = None
    with pytest.raises(ComparisonImportError):
        adapter._candidate_relationship(receipt, fields, None, locator)


@pytest.mark.parametrize("candidate_marked", [False, True])
def test_reviewed_publisher_positive_preserves_name_and_separately_binds_cover_office(
    publisher_relationship_world, candidate_marked
):
    adapter, values, fields, receipt, locator = publisher_relationship_world
    if candidate_marked:
        values["account"].update(
            name="Cassidy Villeneuve", candidate_name="Cassidy Villeneuve"
        )
        fields["name"]["literal"] = "Cassidy Villeneuve"
        fields["mark"].update(state="value", literal="X", normalized="marked")
    result = adapter._candidate_relationship(receipt, fields, None, locator)
    assert result.facts["person_name"] == "Cassidy Villeneuve"
    assert result.facts["account_name"] == values["account"]["name"]
    assert result.facts["office_literal"] == "County Attorney"
    assert result.facts["cover_office_literal"] == "County Attorney"
    assert fields["name"]["literal"] in result.quote
