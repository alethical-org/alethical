import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.api.serializers import (
    clean_contact_email,
    clean_office_address,
    normalize_legislator_profile_url,
)
from alethical.db.schema import load_schema
from alethical.db.session import get_engine

schema = load_schema()


@pytest.mark.parametrize(
    ("member", "raw", "expected"),
    [
        (
            "Demuth",
            "Capitol Office\n100 Rev. Dr. Martin Luther King Jr. Blvd.\nSt. Paul, MN 55155\n651-296-4373\nMinority Leader",
            "100 Rev. Dr. Martin Luther King Jr. Blvd.\nSt. Paul, MN 55155",
        ),
        (
            "Boldon",
            "95 University Avenue W.\nMinnesota Senate Bldg., Room 3219\nToll Free: 888-234-1111",
            "95 University Avenue W.\nMinnesota Senate Bldg., Room 3219",
        ),
        (
            "Agbaje",
            "Centennial Office Building\n658 Cedar Street\nSubscribe to my newsletter",
            "Centennial Office Building\n658 Cedar Street",
        ),
        (
            "Weber",
            "Senate Building, Room 2107\n95 University Avenue W.\nClick to subscribe to multilingual newsletter",
            "Senate Building, Room 2107\n95 University Avenue W.",
        ),
    ],
)
def test_known_member_office_text_is_clean(member, raw, expected):
    assert member
    assert clean_office_address(raw) == expected


def test_contact_form_is_not_misrepresented_as_email():
    assert clean_contact_email("mailto:rep.esther.agbaje@house.mn.gov") == (
        "rep.esther.agbaje@house.mn.gov"
    )
    assert clean_contact_email("https://www.senate.mn/members/email-form/123") is None


def test_old_senate_links_are_normalized():
    assert (
        normalize_legislator_profile_url(
            "http://www.senate.leg.state.mn.us/members/member_bio.php?leg_id=15245"
        )
        == "https://www.senate.mn/members/member_bio.html?leg_id=15245"
    )


def test_cleaner_replays_across_current_local_members(seed_database):
    with Session(get_engine()) as db:
        values = db.scalars(
            select(schema.LegislatorServicePeriod.office_address).where(
                schema.LegislatorServicePeriod.is_current.is_(True)
            )
        ).all()
    for value in values:
        cleaned = clean_office_address(value) or ""
        assert "toll free" not in cleaned.lower()
        assert "newsletter" not in cleaned.lower()
