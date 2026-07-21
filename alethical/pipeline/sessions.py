"""Minnesota legislative-session identifiers, shared across the pipeline.

The Minnesota Legislature is modeled as one ``LegislativeSession`` row per
biennium (one-drawer -- see #155); bills from either year within the biennium
attach to it. Discovery, however, pulls the Revisor bill list *per year*, so the
session code carries the year and defaults to 2025 for the current session.
Override it (e.g. "0942026" for 2026, "0932024" for 2024, etc.) to ingest a
specific year into the appropriate biennium session.

This module is intentionally dependency-free so any pipeline module or CLI can
import these without pulling in the ORM or a database connection.
"""

from __future__ import annotations

from dataclasses import dataclass

# Default Revisor discovery session code: 94th Legislature, 2025 bill list.
DEFAULT_SESSION_CODE = "0942025"

# Slug of the single biennium ``LegislativeSession`` row bills attach to.
CURRENT_SESSION_SLUG = "94-2025-regular"


@dataclass(frozen=True)
class LegislativeSessionDef:
    """Canonical definition of one biennium ``LegislativeSession`` row.

    ``session_number`` is the Minnesota Legislature number (94th, 93rd, 92nd);
    it matches the ``SESSION_NUMBER`` a bill reports in its Revisor status XML,
    which is how each ingested bill resolves to the right session row.
    """

    slug: str
    session_number: int
    year_start: int
    year_end: int
    name: str
    is_current: bool


# Every biennium Alethical knows how to ingest and surface, newest first. Bills
# from either year of a biennium attach to that biennium's single row (#155).
# A row is only *created* in a database when its session is actually ingested
# (see MinnesotaIngestionPipeline.seed_reference_data), so a session appears in
# the /sessions list and the Search Bills session dropdown only once it has
# data -- never as an empty option (grounded-answers rule 2: never advertise
# what you can't answer).
LEGISLATIVE_SESSIONS = [
    LegislativeSessionDef(
        slug="94-2025-regular",
        session_number=94,
        year_start=2025,
        year_end=2026,
        name="94th Legislature (2025 - 2026) Regular Session",
        is_current=True,
    ),
    LegislativeSessionDef(
        slug="93-2023-regular",
        session_number=93,
        year_start=2023,
        year_end=2024,
        name="93rd Legislature (2023 - 2024) Regular Session",
        is_current=False,
    ),
    LegislativeSessionDef(
        slug="92-2021-regular",
        session_number=92,
        year_start=2021,
        year_end=2022,
        name="92nd Legislature (2021 - 2022) Regular Session",
        is_current=False,
    ),
]

# The single current biennium; always ensured so /meta, /sessions/current, and
# the default (slug-less) bill query have a session to resolve to.
CURRENT_SESSION_DEF = next(d for d in LEGISLATIVE_SESSIONS if d.is_current)


def parse_session_code(session_code: str) -> tuple[int, int]:
    """Split a Revisor session code into ``(session_number, year)``.

    ``"0942025"`` -> ``(94, 2025)``; ``"0942026"`` -> ``(94, 2026)``;
    ``"0932023"`` -> ``(93, 2023)``. The trailing four digits are the year; the
    leading digits are the (zero-padded) session number.
    """
    return int(session_code[:-4]), int(session_code[-4:])


def session_def_for_number(session_number: int) -> LegislativeSessionDef | None:
    """The biennium definition for a Legislature number, or None if unknown."""
    for session_def in LEGISLATIVE_SESSIONS:
        if session_def.session_number == session_number:
            return session_def
    return None


def session_defs_to_ensure(session_code: str) -> list[LegislativeSessionDef]:
    """Session rows an ingestion for ``session_code`` should create/ensure.

    Always the current biennium, plus the biennium the code targets (when it is
    a known session). Ingesting a historical session thus creates *only* that
    row and the current one -- it never pre-creates the other historical rows as
    empty dropdown options.
    """
    target_number, _ = parse_session_code(session_code)
    defs = [CURRENT_SESSION_DEF]
    target = session_def_for_number(target_number)
    if (
        target is not None
        and target.session_number != CURRENT_SESSION_DEF.session_number
    ):
        defs.append(target)
    return defs
