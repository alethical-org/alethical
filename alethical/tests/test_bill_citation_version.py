"""Summary citations take their section position and topic from the summary's own
linked version, never from a newer current version.

A summary is written from 1 saved version (`ai_enrichment.bill_version_id`), and
`summary_source_version` names it. Section ids repeat across versions with other
positions and headings, so reading the current version would send a chip to a
different section and caption it with another section's subject.
"""

from __future__ import annotations

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.db.session import get_engine

KEY = "94-2099-HF9301"
OLD = (
    # (section id, heading, text): a repeated id, as the Revisor hands every
    # section outside an article.
    ("sec-a", "Section 1. OLD ALPHA.", "Old alpha: the board may act."),
    ("laws.0.1.0", "Sec. 2. OLD BETA.", "Old beta funds the grant program."),
    ("laws.0.1.0", "Sec. 3. OLD GAMMA.", "Old gamma repeals the old rule."),
)
NEW = (
    # The same ids and quotes at other positions, under other headings.
    ("laws.0.1.0", "Section 1. NEW GAMMA.", "New gamma repeals the old rule."),
    ("sec-a", "Sec. 2. NEW ALPHA.", "New alpha: the board may act."),
    ("laws.0.1.0", "Sec. 3. NEW BETA.", "New beta funds the grant program."),
    ("laws.0.1.0", "Sec. 4. NEW DELTA.", "Delta text."),
)
CITATIONS = [
    {"section_id": "sec-a", "label": "Section 1", "quote": "the board may act"},
    {"section_id": "laws.0.1.0", "label": "Sec. 2", "quote": "funds the grant program"},
    {"section_id": "laws.0.1.0", "label": "Sec. 3", "quote": "repeals the old rule"},
]


@pytest.fixture()
def bill_with_two_versions(client):
    """A bill whose summary may link to its older version while a newer one is current."""
    with Session(get_engine()) as db:
        seed = db.scalar(select(m.Bill).where(m.Bill.bill_key == "94-2025-SF1832"))
        bill = m.Bill(
            session_id=seed.session_id,
            chamber_id=seed.chamber_id,
            bill_key=KEY,
            file_type="HF",
            file_number=9301,
            title="Citation version fixture",
            official_url="https://www.revisor.mn.gov/bills/bill.php?b=House&f=HF9301",
            current_status="Chapter number",
        )
        db.add(bill)
        db.flush()
        versions = {}
        for code, sequence, current, sections, effective in (
            ("old", 1, False, OLD, "July 1, 2026"),
            ("new", 2, True, NEW, "July 1, 2027"),
        ):
            version = m.BillVersion(
                bill_id=bill.id,
                version_code=code,
                version_name=code.title(),
                sequence_number=sequence,
                is_current=current,
            )
            db.add(version)
            db.flush()
            versions[code] = version.id
            db.add_all(
                m.BillVersionSection(
                    bill_version_id=version.id,
                    section_id_text=section_id,
                    source_order=order,
                    section_heading=heading,
                    effective_date_heading="EFFECTIVE DATE.",
                    raw_text=f"{text} This section is effective {effective}.",
                )
                for order, (section_id, heading, text) in enumerate(sections, 1)
            )
        enrichment = m.AIEnrichment(
            bill_id=bill.id,
            enrichment_type=m.EnrichmentType.bill_summary,
            model_name="test",
            is_current=True,
            content_json={
                "summary": "Funds a grant program and repeals an old rule.",
                "key_points": [
                    "Funds grants.",
                    "Repeals a rule.",
                    "Lets the board act.",
                ],
                "key_point_citations": CITATIONS,
            },
        )
        db.add(enrichment)
        db.commit()
        enrichment_id = enrichment.id
        other_version = db.scalar(
            select(m.BillVersion.id).where(m.BillVersion.bill_id == seed.id).limit(1)
        )

    def link(version_id):
        with Session(get_engine()) as db:
            db.get(m.AIEnrichment, enrichment_id).bill_version_id = version_id
            db.commit()
        return client.get(
            f"/api/v1/bills/{KEY}", params={"include": "ai_analysis,ai_summary"}
        ).json()["data"]

    try:
        yield link, versions, other_version
    finally:
        with Session(get_engine()) as db:
            db.execute(delete(m.AIEnrichment).where(m.AIEnrichment.id == enrichment_id))
            db.execute(
                delete(m.BillVersionSection).where(
                    m.BillVersionSection.bill_version_id.in_(versions.values())
                )
            )
            db.execute(
                delete(m.BillVersion).where(m.BillVersion.id.in_(versions.values()))
            )
            db.execute(delete(m.Bill).where(m.Bill.bill_key == KEY))
            db.commit()


def chips(payload):
    return [
        (c["section_id"], c["excerpt"], c["section_order"], c["section_topic"])
        for c in payload["ai_analysis"]["citations"]
    ]


def test_an_older_linked_summary_places_and_captions_its_own_version(
    bill_with_two_versions,
):
    link, versions, _ = bill_with_two_versions
    payload = link(versions["old"])
    assert payload["summary_source_version"]["version_code"] == "old"
    # Each chip opens the section its quote was taken from, in the linked version:
    # a unique id at its own position, and 2 repeats of 1 id told apart by quote.
    assert chips(payload) == [
        ("sec-a", "the board may act", 1, "Old alpha"),
        ("laws.0.1.0", "funds the grant program", 2, "Old beta"),
        ("laws.0.1.0", "repeals the old rule", 3, "Old gamma"),
    ]
    # The effective date still comes from the current version's text.
    assert payload["effective_date"] == "July 1, 2027"


def test_a_summary_linked_to_the_current_version_is_unchanged(bill_with_two_versions):
    link, versions, _ = bill_with_two_versions
    payload = link(versions["new"])
    assert payload["summary_source_version"]["version_code"] == "new"
    assert chips(payload) == [
        ("sec-a", "the board may act", 2, "New alpha"),
        ("laws.0.1.0", "funds the grant program", 3, "New beta"),
        ("laws.0.1.0", "repeals the old rule", 1, "New gamma"),
    ]
    assert payload["effective_date"] == "July 1, 2027"


@pytest.mark.parametrize("linked", ["absent", "another bill's version"])
def test_without_a_resolvable_link_no_current_version_detail_is_served(
    bill_with_two_versions, linked
):
    link, _, other_version = bill_with_two_versions
    payload = link(None if linked == "absent" else other_version)
    assert "summary_source_version" not in payload
    # The chips keep their stored quote and label, with no position or topic
    # borrowed from the current version.
    assert chips(payload) == [
        ("sec-a", "the board may act", None, ""),
        ("laws.0.1.0", "funds the grant program", None, ""),
        ("laws.0.1.0", "repeals the old rule", None, ""),
    ]
    assert payload["effective_date"] == "July 1, 2027"
