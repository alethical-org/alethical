"""Finance's payments under 1 printed name: alethical.com's rows plus Finance's own facts.

The rows, their order, paging, counts and states are alethical.com's own readers
(``campaign_finance_payments``), unchanged, so the 2 sites never disagree about which
payments a spelling has. Finance adds what only Finance accounts may see, per row:

* ``fingerprint``: the server's sha256 of the record kind, file and printed fields,
  the same value identity confirmations store (``identity_confirmations._PRINTED``).
  The client never recomputes it.
* ``identity``: the identity standing today for the active confirmation holding that
  fingerprint under this exact spelling, or ``None``. A confirmation is never inferred
  from a name.
* ``evidence``: where the row is held (file, saved copy, record number, address,
  copy date) and ``excerpt``: every column of the row as the file lays it out, an
  ordered list of [the file's column label, the held value]. Text is as printed,
  except that a blank cell is null; amounts, dates (YYYY-MM-DD) and years are the
  values the loader parsed from it, not the file's own bytes.

and for the whole filtered set, ``identities``: each identity holding records of this
spelling in scope, with how many. ``filer`` narrows rows and every count to 1 filer's
own filings. Nothing here sums money.

Each source row appears and counts once. The database already lets a fingerprint
belong to at most 1 active confirmation, and a merge moves no confirmation, but the
read takes 1 claim per row anyway, so no change elsewhere can double a count here.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Literal
from uuid import UUID

from sqlalchemy import Text, cast, func, literal, select
from sqlalchemy.orm import Session

from alethical.api.services import (
    campaign_finance_payments as payments,
    committee_finance,
    identity_confirmations as identities,
)
from alethical.db import models as m
from alethical.pipeline.campaign_finance import SPEC_BY_DATASET
from alethical.pipeline.campaign_finance_reader import ReleaseNoLongerHeld

Role = Literal["contributor", "vendor", "independent_vendor", "employer"]

# Which reader each role uses, the printed-name kind its rows are confirmed as, and
# the column naming the filer whose filing each row is.
ROLES = {
    "contributor": (payments.payments_from_contributor, "contributor", "donor_name"),
    "vendor": (payments.payments_to_vendor, "vendor", "payee_name"),
    "independent_vendor": (
        payments.independent_payments_to_vendor,
        "vendor",
        "independent_payee_name",
    ),
    "employer": (payments.payments_from_donors_typing, "employer", "employer_name"),
}


def dataset_for(role: Role):
    """The Board file a role's rows come from."""
    return identities._PRINTED[ROLES[role][2]].dataset


class ReleaseChanged(Exception):
    """The caller's pinned release is not the published one."""


class NothingPublished(Exception):
    """No usable release is published, which says nothing about any name."""


def _excerpt(printed):
    """The whole row in the file's column order: [label, held value as text]."""
    spec = SPEC_BY_DATASET[printed.dataset]
    return func.jsonb_build_array(
        *(
            func.jsonb_build_array(
                cast(literal(column.source), Text),
                # Dates as YYYY-MM-DD whatever the connection's date style.
                func.to_char(getattr(printed.model, column.attribute), "YYYY-MM-DD")
                if column.kind == "date"
                else cast(getattr(printed.model, column.attribute), Text),
            )
            for column in spec.columns
        )
    )


def _claims(kind: str, name: str, where: list):
    """Rows in scope, 1 per source row, with their fingerprint and active claim."""
    printed = identities._PRINTED[kind]
    model = printed.model
    record, confirmation = m.IdentityConfirmedRecord, m.IdentityConfirmation
    fingerprint = printed.fingerprint(kind)
    return (
        select(
            model.row_number.label("row_number"),
            fingerprint.label("fingerprint"),
            _excerpt(printed).label("excerpt"),
            confirmation.entity_id.label("entity_id"),
        )
        .distinct(model.row_number)
        .select_from(model)
        .outerjoin(record, (record.fingerprint == fingerprint) & record.active)
        .outerjoin(
            confirmation,
            (confirmation.id == record.confirmation_id)
            & confirmation.active
            & (confirmation.record_kind == kind)
            & (confirmation.record_key == name),
        )
        .where(printed.name == name, *where)
        # 1 claim per source row: a claim of this spelling first, then the earliest.
        .order_by(
            model.row_number,
            confirmation.entity_id.is_(None),
            confirmation.checked_at,
            confirmation.id,
        )
    )


def read(
    db: Session,
    *,
    name: str,
    role: Role,
    year: int | None,
    filer: str | None,
    limit: int,
    offset: int,
    release_id: UUID | None,
) -> dict:
    committee_finance.pin_to_one_view(db)
    try:
        release = committee_finance.current_release(db)
    except ReleaseNoLongerHeld:
        # A published release whose files are gone: our gap, the same state.
        release = None
    if release is None and release_id is not None:
        # The pinned file is gone, as Finance's other money reads answer.
        raise ReleaseChanged()
    if release is None:
        # A fact about our records, never about the name: the same unavailable
        # state Finance's other money reads give, with no count.
        raise NothingPublished()
    if release_id is not None and release.id != release_id:
        raise ReleaseChanged()
    reader, argument, kind = ROLES[role]
    page = reader(
        db,
        release,
        **{argument: name},
        year=year,
        limit=limit,
        offset=offset,
        filer=filer,
    )
    printed = identities._PRINTED[kind]
    model = printed.model
    source = release.file_for(printed.dataset)
    scope = [model.snapshot_id == source.snapshot_id]
    if year is not None:
        scope.append(model.year == year)
    if filer is not None:
        filer_column = SPEC_BY_DATASET[printed.dataset].filer_attribute
        scope.append(getattr(model, filer_column) == filer)
    numbers = [payment.record_number for payment in page.payments]
    per_row = {}
    if numbers:
        per_row = {
            row.row_number: row
            for row in db.execute(
                _claims(kind, name, [*scope, model.row_number.in_(numbers)])
            )
        }
    # Each identity standing today for the rows in scope, merges followed; a split
    # identity holds no active confirmation, so it is never listed. Skipped when no
    # active confirmation names this spelling, so common strings such as "Retired"
    # cost no fingerprint pass.
    claimed = db.scalar(
        select(m.IdentityConfirmation.id)
        .where(
            m.IdentityConfirmation.record_kind == kind,
            m.IdentityConfirmation.record_key == name,
            m.IdentityConfirmation.active,
        )
        .limit(1)
    )
    in_scope = _claims(kind, name, scope).subquery()
    counts: dict[str, int] = defaultdict(int)
    standing: dict[str, m.IdentityEntity] = {}
    for entity_id, records in (
        db.execute(
            select(in_scope.c.entity_id, func.count())
            .where(in_scope.c.entity_id.is_not(None))
            .group_by(in_scope.c.entity_id)
        )
        if claimed is not None
        else ()
    ):
        entity = identities._today(db, entity_id)
        standing[str(entity.id)] = entity
        counts[str(entity.id)] += records
    today = {
        entity_id: identities._today(db, entity_id)
        for entity_id in {row.entity_id for row in per_row.values() if row.entity_id}
    }

    def identity(entity_id):
        if entity_id is None:
            return None
        entity = today[entity_id]
        return identities._summary(entity)

    rows = []
    for payment in page.payments:
        held = per_row.get(payment.record_number)
        rows.append(
            {
                "record_number": payment.record_number,
                "fingerprint": held.fingerprint if held else None,
                "identity": identity(held.entity_id) if held else None,
                "evidence": {
                    "dataset": printed.dataset.value,
                    "snapshot_id": str(source.snapshot_id),
                    "record_number": payment.record_number,
                    "source_url": source.source_url,
                    "copied_at": release.copied_at(printed.dataset),
                },
                "excerpt": held.excerpt if held else None,
            }
        )
    return {
        "page": page,
        "record_kind": kind,
        "rows": rows,
        "identities": [
            {
                **identities._summary(standing[entity_id]),
                "confirmed_records": counts[entity_id],
            }
            for entity_id in sorted(standing, key=lambda key: (standing[key].name, key))
        ],
    }
