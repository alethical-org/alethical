"""Shared bill-key resolution for the API routers.

Two resolvers, deliberately distinct (see #224 and its Codex review):

- ``get_bill_by_key`` is an exact ``bill_key`` match. Signed-in tracking
  mutations (add / change / remove a tracked bill) use this so a write only
  ever lands on the one bill the caller named.
- ``resolve_bill_by_key`` matches the exact key first, then falls back to a
  chamber-prefixed bill-number alias ("HF4138", "SF1832") scoped to the single
  current session. Public read routes use this so a shared or hand-typed
  ``/bills/HF4138`` link resolves without the client having to know the
  session-year stamp (the 94th biennium stamps bills as both ``94-2025-`` and
  ``94-2026-``, so the year is not derivable from the number alone).

Only a chamber-prefixed alias is accepted here. A bare number ("5") is
ambiguous across the House and Senate and stays on keyword search, not detail
lookup.
"""

from __future__ import annotations

import re

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from alethical.db.models import Bill, LegislativeSession

# "HF4138" / "SF 1832" / "hf04138" — chamber prefix required, optional spaces
# and leading zeros. No bare-number form on purpose (ambiguous across chambers).
_BILL_ALIAS_RE = re.compile(r"^\s*(HF|SF)\s*0*(\d+)\s*$", re.IGNORECASE)


def get_bill_by_key(db: Session, bill_key: str) -> Bill:
    """Exact ``bill_key`` match, or 404. No alias fallback."""
    bill = db.scalar(select(Bill).where(Bill.bill_key == bill_key))
    if bill is None:
        raise HTTPException(status_code=404, detail="bill not found")
    return bill


def resolve_bill_by_key(db: Session, bill_key: str) -> Bill:
    """Exact ``bill_key`` match first, then a chamber-prefixed number alias
    resolved within the single current session. 404 if neither matches."""
    bill = db.scalar(select(Bill).where(Bill.bill_key == bill_key))
    if bill is not None:
        return bill

    alias = _BILL_ALIAS_RE.match(bill_key)
    if alias is not None:
        file_type = alias.group(1).upper()
        file_number = int(alias.group(2))
        # Resolve only when exactly one session is current; fail safe on 0 or
        # several (the model does not constrain is_current to a single row).
        current_session_ids = db.scalars(
            select(LegislativeSession.id).where(LegislativeSession.is_current.is_(True))
        ).all()
        if len(current_session_ids) == 1:
            # (session_id, file_type, file_number) is unique, so at most one row.
            match = db.scalar(
                select(Bill).where(
                    Bill.session_id == current_session_ids[0],
                    func.upper(Bill.file_type) == file_type,
                    Bill.file_number == file_number,
                )
            )
            if match is not None:
                return match

    raise HTTPException(status_code=404, detail="bill not found")
