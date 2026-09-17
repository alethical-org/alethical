"""Alphabetical names from the held outside-spending file, without money rankings."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.api.services.committee_finance import NOT_REPORTED
from alethical.api.services.independent_spending import REPORTED, UNAVAILABLE
from alethical.pipeline.campaign_finance_filings import live_filings_snapshot
from alethical.pipeline.campaign_finance_reader import Release

PAGE_SIZE = 12

# All names, the matched count, coverage and page share one statement's source view.
# The registration key and exact-name key occupy separate columns, so a numeric
# name cannot merge with a real registration number. Latest means source row order,
# matching the existing outside-spending group reader, not an inferred report date.
_NAMES = """
WITH source AS MATERIALIZED (
    SELECT {name} AS name,
           CASE WHEN {registration} IS NULL OR trim({registration}) IN ('', '0')
                THEN NULL ELSE {registration} END AS registration_number,
           year, row_number
      FROM cf_independent_expenditure_row WHERE snapshot_id = :snapshot
), scoped AS MATERIALIZED (
    SELECT * FROM source WHERE (CAST(:year AS integer) IS NULL OR year = :year)
), identified AS (
    SELECT *, CASE WHEN registration_number IS NULL THEN name END AS name_key
      FROM scoped WHERE name IS NOT NULL AND trim(name) <> ''
), latest AS (
    SELECT DISTINCT ON (registration_number, name_key)
           name, registration_number, name_key
      FROM identified
     ORDER BY registration_number, name_key, row_number DESC
), matching AS MATERIALIZED (
    SELECT * FROM latest WHERE strpos(lower(name), lower(:query)) > 0
), counts AS (
    SELECT (SELECT count(*) FROM source) AS stored_rows,
           (SELECT count(*) FROM scoped) AS period_rows,
           (SELECT count(*) FROM matching) AS total_names,
           ARRAY(SELECT DISTINCT year FROM source WHERE year IS NOT NULL
                 ORDER BY year DESC) AS years
), bounds AS (
    SELECT *, least(:page, greatest(1, (total_names + :size - 1) / :size))
             AS page_number FROM counts
), names_page AS (
    SELECT name, registration_number,
           EXISTS (SELECT 1 FROM cf_filer f WHERE f.snapshot_id = :register
                   AND f.registration_number = m.registration_number) AS in_register
      FROM matching m
     ORDER BY lower(name) COLLATE "C", name COLLATE "C",
              registration_number COLLATE "C" NULLS LAST
     LIMIT :size OFFSET (SELECT (page_number - 1) * :size FROM bounds)
)
SELECT b.*, p.* FROM bounds b LEFT JOIN names_page p ON true
 ORDER BY lower(p.name) COLLATE "C", p.name COLLATE "C",
          p.registration_number COLLATE "C" NULLS LAST
"""


def outside_spending_names(
    db: Session,
    release: Release,
    *,
    browse: Literal["groups", "committees"] = "groups",
    year: int | None = None,
    query: str = "",
    page_number: int = 1,
    snapshot_id: UUID | None = None,
) -> dict:
    """List only participants named in this file, retaining unregistered subjects.

    ``reported`` describes the selected period's payments, not the search match
    count. It may carry no names, either because the query did not match or because
    the rows hold no names. Neither circumstance claims that nothing was spent.
    ``unavailable`` withholds counts when coverage or a source-copy check fails.
    """
    source = release.independent_expenditures
    query = query.strip()
    result = {
        "state": UNAVAILABLE,
        "browse": browse,
        "year": year,
        "query": query,
        "names": [],
        "years": [],
        "page": {
            "number": 1,
            "size": PAGE_SIZE,
            "total_names": None,
            "has_more": False,
        },
        "release_id": str(release.id),
        "snapshot_id": str(source.snapshot_id),
        "fetched_at": release.fetched_at,
        "source_url": source.source_url,
    }
    if snapshot_id is not None and snapshot_id != source.snapshot_id:
        return result
    register = live_filings_snapshot(db)
    name, registration = (
        ("spender", "spender_reg_num")
        if browse == "groups"
        else ("affected_committee_name", "affected_committee_reg_num")
    )
    rows = (
        db.execute(
            text(_NAMES.format(name=name, registration=registration)),
            {
                "snapshot": source.snapshot_id,
                "register": register.id if register else None,
                "year": year,
                "query": query,
                "page": page_number,
                "size": PAGE_SIZE,
            },
        )
        .mappings()
        .all()
    )
    head = rows[0]
    # The reader's staleness and year-coverage rules, evaluated inside the same
    # statement as the list. A source pruned during the request cannot look empty.
    if head["stored_rows"] == 0 and source.row_count > 0:
        return result
    result["years"] = head["years"]
    if head["period_rows"] == 0:
        result["state"] = NOT_REPORTED if year is None else UNAVAILABLE
        return result
    result["state"] = REPORTED
    result["names"] = [
        {
            "name": row["name"],
            "registration_number": row["registration_number"],
            "in_register": row["in_register"],
        }
        for row in rows
        if row["name"] is not None
    ]
    result["page"] = {
        "number": head["page_number"],
        "size": PAGE_SIZE,
        "total_names": head["total_names"],
        "has_more": head["page_number"] * PAGE_SIZE < head["total_names"],
    }
    return result
