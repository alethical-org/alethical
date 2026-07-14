"""Minnesota legislative-session identifiers, shared across the pipeline.

The 94th Legislature is one biennium (2025-2026) modeled as a single
``LegislativeSession`` row (one-drawer -- see #155); bills from either year
attach to it. Discovery, however, pulls the Revisor bill list *per year*, so the
session code carries the year and defaults to 2025. Override it (e.g. "0942026")
to ingest a later year into the same biennium session.

This module is intentionally dependency-free so any pipeline module or CLI can
import these without pulling in the ORM or a database connection.
"""

from __future__ import annotations

# Default Revisor discovery session code: 94th Legislature, 2025 bill list.
DEFAULT_SESSION_CODE = "0942025"

# Slug of the single biennium ``LegislativeSession`` row bills attach to.
CURRENT_SESSION_SLUG = "94-2025-regular"


def parse_session_code(session_code: str) -> tuple[int, int]:
    """Split a Revisor session code into ``(session_number, year)``.

    ``"0942025"`` -> ``(94, 2025)``; ``"0942026"`` -> ``(94, 2026)``. The trailing
    four digits are the year; the leading digits are the (zero-padded) session
    number.
    """
    return int(session_code[:-4]), int(session_code[-4:])
