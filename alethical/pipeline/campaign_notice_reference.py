"""Materialize one complete register/payment view before notice source requests."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from alethical.api.services.campaign_finance_register import sub_types_for
from alethical.db import models as schema
from alethical.pipeline.campaign_finance_filings import live_filings_snapshot
from alethical.pipeline.campaign_finance_reader import live_release


@dataclass(frozen=True)
class NoticeFiler:
    kind: schema.CampaignFinanceFilerKind
    registration_number: str
    office: str | None
    district: str | None
    candidate_name: str | None
    retained_from_snapshot_id: UUID | None = None


@dataclass(frozen=True)
class NoticeReference:
    snapshot_id: UUID
    release_id: UUID | None
    filers: tuple[NoticeFiler, ...]
    sub_types: dict[str, str]

    def still_current(self, db, *, require_payments=False):
        # Hold both pointers through the mutation's commit. Money publication
        # locks these same rows, so a late completion cannot race a new pointer.
        pointer = db.scalar(
            select(
                schema.CampaignFinanceFilingCurrentSnapshot.snapshot_id
            ).with_for_update(read=True)
        )
        if pointer != self.snapshot_id:
            return False
        if require_payments:
            release = db.scalar(
                select(schema.CampaignFinanceCurrentRelease.release_id).with_for_update(
                    read=True
                )
            )
            return self.release_id is not None and release == self.release_id
        return True


def load_reference(engine, *, require_payments=False):
    with Session(engine) as db:
        db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
        snapshot = live_filings_snapshot(db)
        if snapshot is None:
            raise ValueError("no published campaign register")
        filer = schema.CampaignFinanceFiler
        rows = db.execute(
            select(
                filer.kind,
                filer.registration_number,
                filer.office,
                filer.district,
                filer.candidate_name,
                filer.retained_from_snapshot_id,
            ).where(filer.snapshot_id == snapshot.id)
        ).all()
        current_count = sum(row.retained_from_snapshot_id is None for row in rows)
        if not rows or not current_count or current_count != snapshot.filer_count:
            raise ValueError("published campaign register is empty or incomplete")
        filers = tuple(NoticeFiler(*row) for row in rows)
        release = live_release(db)
        if require_payments and release is None:
            raise ValueError("no published payment reference for ballot exclusions")
        types = (
            sub_types_for(db, release, [f.registration_number for f in filers])
            if require_payments
            else {}
        )
        return NoticeReference(
            snapshot.id, release.id if release else None, filers, types
        )
