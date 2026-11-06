"""Checked invoice links pinned to exact published expenditure rows."""

from collections import defaultdict

from sqlalchemy import select

from alethical.api.services import finance_station_checks as checks
from alethical.api.services import tv_ads as reader
from alethical.db import models as m


def _row_scope(model, snapshot_id, numbers):
    saved = model.target_snapshot
    return (
        model.kind == "expense",
        saved["source_dataset"].astext == "expenditures",
        saved["source_snapshot_id"].astext == str(snapshot_id),
        saved["source_row_number"].astext.in_([str(n) for n in numbers]),
    )


def matching_invoices(db, *, snapshot_id, row_numbers):
    """Return a link only for one distinct checked invoice on the exact row.

    Read checks for candidate files only. Use the same Finance withdrawal,
    correction and expense-currentness readers as the station-file screen.
    No copied private evidence or reviewer identity leaves this projection.
    """
    numbers = set(row_numbers)
    if not snapshot_id or not numbers:
        return {}
    publication = m.TVAdPublication
    connection = m.TVAdConnection
    files = set(
        db.execute(
            select(publication.facility_id, publication.file_id)
            .join(connection, connection.publication_id == publication.id)
            .where(
                publication.status != "draft",
                publication.facility_id.in_(reader.STATIONS),
                connection.scope == "file",
                connection.status == "checked",
                *_row_scope(connection, snapshot_id, numbers),
            )
        ).all()
    )
    finance = m.FinanceTVConnection
    files.update(
        db.execute(
            select(finance.facility_id, finance.file_id).where(
                finance.facility_id.in_(reader.STATIONS),
                finance.withdrawn_at.is_(None),
                *_row_scope(finance, snapshot_id, numbers),
            )
        ).all()
    )
    if not files:
        return {}

    # A separate bounded projection avoids inheriting a prior screen's cached
    # checks, or replacing its scope if this is called inside another read.
    prior = db.info.get("tv_projection")
    db.info["tv_projection"] = {"originals": True, "scoped": True}
    try:
        evidence = reader._original_checks(db, files)
    finally:
        if prior is None:
            db.info.pop("tv_projection", None)
        else:
            db.info["tv_projection"] = prior

    found = defaultdict(set)
    for version, connections in evidence["connections"].items():
        kinds = {
            f.value.strip().casefold()
            for f in evidence["facts"].get(version, [])
            if f.status == "checked" and f.field == "document_kind"
        }
        # A checked invoice number on an order is not a document-kind decision.
        if kinds != {"invoice"} or db.get(m.FCCDocument, version) is None:
            continue
        for c in connections:
            saved = c.target_snapshot or {}
            number = saved.get("source_row_number")
            if (
                c.status != "checked"
                or c.kind != "expense"
                or saved.get("source_dataset") != "expenditures"
                or saved.get("source_snapshot_id") != str(snapshot_id)
                or number not in numbers
            ):
                continue
            if getattr(c, "finance", False):
                if (
                    saved.get("facility_id"),
                    saved.get("file_id"),
                    saved.get("content_hash"),
                ) != version:
                    continue
                current = checks.expense_current(db, saved)
            else:
                current = not reader._expense_changed(db, c)
            if current:
                found[number].add(
                    (reader.file_key(version[0], version[1]), version[2], c.page)
                )
    return {
        number: {"key": value[0], "version": value[1], "page": value[2]}
        for number, matches in found.items()
        if len(matches) == 1
        for value in matches
    }
