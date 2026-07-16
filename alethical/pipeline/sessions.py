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
    """Definition of a legislative session for database initialization."""
    slug: str
    session_number: int
    year_start: int
    year_end: int
    name: str
    is_current: bool


# All legislative sessions to be ingested and available in the system.
# The current session is marked is_current=True; others are historical.
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


def parse_session_code(session_code: str) -> tuple[int, int]:
    """Split a Revisor session code into ``(session_number, year)``.

    ``"0942025"`` -> ``(94, 2025)``; ``"0942026"`` -> ``(94, 2026)``. The trailing
    four digits are the year; the leading digits are the (zero-padded) session
    number.
    """
    return int(session_code[:-4]), int(session_code[-4:])
