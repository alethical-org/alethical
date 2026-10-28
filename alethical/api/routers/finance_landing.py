"""Alethical Finance's public landing-page counts. No sign-in: the page is public.

Under ``/api/v1/finance/`` like every Finance route, but the 1 public exception to
its private, uncached answers (``PUBLIC_EXCEPTIONS`` in ``alethical/api/problems.py``):
anonymous and the same for everyone, so it takes the short public cache window. Each
count is read live (``alethical/api/services/finance_landing.py``).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from alethical.api.services.finance_landing import landing_counts
from alethical.db.session import get_db

router = APIRouter(prefix="/finance/landing")


@router.get("/counts")
def counts(db: Session = Depends(get_db)) -> dict:
    return {"data": landing_counts(db)}
