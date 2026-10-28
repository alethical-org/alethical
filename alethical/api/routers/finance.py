"""Alethical Finance's endpoints. Every route depends on the Finance access check.

The router-level dependency means no Finance route can be added that forgets it,
and ``default_public_cache`` in ``alethical/api/main.py`` marks every response
under ``/api/v1/finance/`` private, so 1 account's answer never reaches another.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from alethical.api.finance_access import require_finance_access

router = APIRouter(prefix="/finance", dependencies=[Depends(require_finance_access)])


@router.get("/access")
def access() -> dict:
    """200 for a listed account; the access check answers 401 or 403 otherwise."""
    return {"data": {"allowed": True}}
