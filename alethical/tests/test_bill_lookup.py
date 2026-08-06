"""Bill-key resolution (#224).

resolve_bill_by_key backs the public read routes: it matches the exact stored
key first, then a chamber-prefixed number alias ("HF4138") within the single
current session. get_bill_by_key stays exact-only for signed-in tracking writes.
The regression these guard: the 94th biennium stamps bills both 94-2025- and
94-2026-, so a client that fabricated "94-2025-<number>" pointed at the wrong
bill (or a 404) for any 2026 bill.
"""

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from alethical.api.bill_lookup import get_bill_by_key, resolve_bill_by_key
from alethical.db.schema import load_schema
from alethical.db.session import get_engine


# A 2026-stamped bill in the current (2025-2026) session: its key year differs
# from any client-side guess of "2025", which is the whole point of #224.
BILL_KEY = "94-2026-HF424244"
FILE_NUMBER = 424244


@pytest.fixture()
def seeded_2026_bill(client):
    schema = load_schema()
    with Session(get_engine()) as db:
        seed = db.scalar(
            select(schema.Bill).where(schema.Bill.bill_key == "94-2025-SF1832")
        )
        session_id, chamber_id = seed.session_id, seed.chamber_id
    try:
        with Session(get_engine()) as db:
            db.add(
                schema.Bill(
                    session_id=session_id,
                    chamber_id=chamber_id,
                    bill_key=BILL_KEY,
                    file_type="HF",
                    file_number=FILE_NUMBER,
                    title="Bill-key resolution fixture",
                    description="Seeded for #224 resolver tests.",
                    current_status="Introduced",
                    has_current_summary=True,
                )
            )
            db.commit()
        yield
    finally:
        with Session(get_engine()) as db:
            db.execute(delete(schema.Bill).where(schema.Bill.bill_key == BILL_KEY))
            db.commit()


def test_exact_key_resolves(seeded_2026_bill):
    with Session(get_engine()) as db:
        assert resolve_bill_by_key(db, BILL_KEY).bill_key == BILL_KEY


def test_chamber_prefixed_alias_resolves_across_the_year_stamp(seeded_2026_bill):
    # "HF424244" must find 94-2026-HF424244 even though the client never knows
    # the "2026" stamp — the fix's core guarantee.
    with Session(get_engine()) as db:
        for alias in ("HF424244", "hf424244", "HF 424244", "hf 0424244"):
            assert resolve_bill_by_key(db, alias).bill_key == BILL_KEY, alias


def test_unknown_alias_is_404(seeded_2026_bill):
    with Session(get_engine()) as db:
        with pytest.raises(HTTPException) as exc:
            resolve_bill_by_key(db, "HF999999")
        assert exc.value.status_code == 404


def test_bare_number_without_chamber_is_not_a_detail_lookup(seeded_2026_bill):
    # A bare number is ambiguous across chambers and stays on search, not here.
    with Session(get_engine()) as db:
        with pytest.raises(HTTPException) as exc:
            resolve_bill_by_key(db, str(FILE_NUMBER))
        assert exc.value.status_code == 404


def test_exact_lookup_does_not_accept_aliases(seeded_2026_bill):
    # Tracking writes use get_bill_by_key; an alias must NOT resolve there so a
    # write only ever lands on the exact bill named.
    with Session(get_engine()) as db:
        assert get_bill_by_key(db, BILL_KEY).bill_key == BILL_KEY
        with pytest.raises(HTTPException) as exc:
            get_bill_by_key(db, "HF424244")
        assert exc.value.status_code == 404
