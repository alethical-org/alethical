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

from datetime import UTC, datetime

# Default Revisor discovery session code: 94th Legislature, 2025 bill list.
DEFAULT_SESSION_CODE = "0942025"

# Slug of the single biennium ``LegislativeSession`` row bills attach to.
CURRENT_SESSION_SLUG = "94-2025-regular"

# Convening and final adjournment-sine-die dates of the 94th biennium, from the
# Minnesota Legislative Reference Library session history
# (https://www.lrl.mn.gov/history/sessions): the 2025 regular session convened
# 1/14/2025; the 2026 continuing regular session adjourned sine die 5/18/2026
# (the Senate adjourned after midnight, so the last "legislative day" was 5/17).
CURRENT_SESSION_START_DATE = datetime(2025, 1, 14, tzinfo=UTC)
CURRENT_SESSION_END_DATE = datetime(2026, 5, 18, tzinfo=UTC)


def parse_session_code(session_code: str) -> tuple[int, int]:
    """Split a Revisor session code into ``(session_number, year)``.

    ``"0942025"`` -> ``(94, 2025)``; ``"0942026"`` -> ``(94, 2026)``.

    The trailing four digits are the year, the FIRST digit is the special-session
    number, and everything between them is the Legislature number — see
    ``special_session_number`` for why, and note that this is not zero-padding.
    Sliced from both ends rather than at a fixed width, so a three-digit Legislature
    ("01002027", the 100th) still reads correctly.
    """
    return int(session_code[1:-4]), int(session_code[-4:])


def special_session_number(session_code: str) -> int:
    """Which special session a Revisor session code names; ``0`` for a regular one.

    The leading digit is the special-session number, NOT a zero-pad. Read straight
    off the Revisor's own search form
    (``https://www.revisor.mn.gov/bills/status_search.php``):

    ==========  ===============================================
    ``0942025``  94th Legislature, 2025-2026 *(regular)*
    ``1942025``  94th Legislature, 2025 1st Special Session
    ``1922021``  92nd Legislature, 2021 1st Special Session
    ``7912020``  91st Legislature, 2020 7th Special Session
    ==========  ===============================================

    It matches the ``SESSION_TYPE`` a bill reports in its status XML and the third
    path segment of its API URI (``/bills/v1/94/2025/1/HF/5/``).

    This distinction is load-bearing, not cosmetic: the regular and special sessions
    of one Legislature **both** number their files from 1, so ``/94/2025/0/HF/5/``
    is a tax bill and ``/94/2025/1/HF/5/`` is a K12 education bill. Ignoring it
    would collide two unrelated bills on one ``bill_key`` (#746).
    """
    return int(session_code[0])


def build_bill_key(
    session_number: int | str,
    year: int | str,
    file_type: str,
    file_number: int | str,
    special_session: int | str = 0,
) -> str:
    """The one place a ``bill_key`` is composed.

    ``94-2025-HF5`` for a regular-session bill; ``94-2025s1-HF5`` for the 1st
    special session of the same year. The suffix appears ONLY when the special
    session is non-zero, so every one of the 10,471 regular-session keys already in
    production is byte-identical to what this produced before — the column is
    unique and referenced by ingestion dedup, so a changed key would orphan a bill
    rather than update it (#746).
    """
    special = int(special_session or 0)
    stamp = f"{year}s{special}" if special else f"{year}"
    return f"{session_number}-{stamp}-{file_type}{file_number}"
