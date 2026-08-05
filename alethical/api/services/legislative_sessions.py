"""Which legislative sessions a question is about, and how a reference names one.

One Legislature can sit more than once. Minnesota's 94th held its regular session
across 2025-2026 and a first special session in June 2025, and both are separate
``legislative_session`` rows because a special session numbers its files from 1 all
over again — "HF 5" is a tax bill in one and the K-12 education finance act in the
other (#746).

Everything that has to reason about that lives here rather than in a router, for two
reasons. The public router's cross-reference resolver and the Ask router now ask the
same two questions ("which sessions belong to this Legislature?", "does this text
name one?") and must not answer them differently (#810). And this module imports only
the ORM and the dependency-free pipeline definitions, so both routers can import it
without importing each other.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db.schema import load_schema
from alethical.pipeline.sessions import SESSION_DEFINITIONS, special_session_number

schema = load_schema()
LegislativeSession = schema.LegislativeSession


@dataclass(frozen=True)
class LegislatureScope:
    """Every session of the Legislature currently sitting.

    ``primary`` is the row flagged current — the regular session, which is the one
    that carries service periods, committees and the biennium's name. ``sessions``
    is every session of that same Legislature, ``primary`` included, so a caller
    that means "the bills a reader is asking about" uses ``ids`` and a caller that
    means "who is serving" uses ``primary``. Keeping both on one object is what
    stops the two drifting apart across five answer paths.
    """

    primary: object
    sessions: tuple[object, ...]

    @property
    def ids(self) -> tuple[uuid.UUID, ...]:
        return tuple(row.id for row in self.sessions)

    def by_id(self, session_id) -> object | None:
        return next((row for row in self.sessions if row.id == session_id), None)

    @property
    def spans_several(self) -> bool:
        return len(self.sessions) > 1


def current_legislature_scope(db: Session) -> LegislatureScope:
    """The sessions of the Legislature currently sitting, primary first.

    Grouped by ``session_number`` within one jurisdiction, because that is what a
    Legislature *is* — the 94th's regular and special sessions share the number 94,
    and the 93rd and 92nd do not. A year-overlap rule would infer the same grouping
    from dates and get it wrong the first time a special session is called in a year
    the regular session also sat, which is exactly the 2025 case. #359 adds prior
    bienniums; they carry different numbers, so they stay out with no extra guard.

    Raises if the corpus does not have exactly one current session. Nothing in the
    schema enforces that (``is_current`` is a plain boolean on every row), and the
    old ``db.scalar(...)`` this replaces would have silently picked whichever row the
    database returned first.
    """
    current = db.scalars(
        select(LegislativeSession).where(LegislativeSession.is_current.is_(True))
    ).all()
    if len(current) != 1:
        raise RuntimeError(
            f"expected exactly one current legislative session, found {len(current)}"
        )
    primary = current[0]
    siblings = db.scalars(
        select(LegislativeSession)
        .where(
            LegislativeSession.session_number == primary.session_number,
            LegislativeSession.jurisdiction_id == primary.jurisdiction_id,
            LegislativeSession.id != primary.id,
        )
        .order_by(LegislativeSession.year_start, LegislativeSession.slug)
    ).all()
    return LegislatureScope(primary=primary, sessions=(primary, *siblings))


# --- Naming a special session in free text -------------------------------------
#
# Moved here from the public router's cross-reference resolver (#804), unchanged in
# behaviour, so the Ask router asks the same question of a reader's phrasing that the
# resolver asks of the Revisor's ("First Special Session, HF 5"). Two callers, one
# definition of what "First Special Session" means.

# A description or question that says "session" at all. Cheap gate before the regex.
OTHER_SESSION = re.compile(r"\bsession\b", re.I)

# The session a phrase names. Both optional groups are genuinely optional in the
# source data: 48 production rows carry a year ("2025 1st Special Session SF3") and
# 417 do not ("First Special Session, HF 5"), while 5 give no ordinal at all ("See
# Special Session, HF5"). Missing pieces widen the candidate set rather than guessing
# at one, and a widened set that stays ambiguous is declined.
NAMED_SPECIAL_SESSION = re.compile(
    r"(?:(?P<year>(?:19|20)\d{2})\s+)?"
    r"(?:(?P<qualifier>[A-Za-z0-9]+)\s+)?"
    r"special\s+session\b",
    re.I,
)

# Ordinals run to 7th because Minnesota has gone that far: the Revisor's own session
# code ``7912020`` is the 91st Legislature's 2020 **7th** Special Session
# (``special_session_number``). Listing the whole real range matters — an ordinal
# missing from this map is treated as unrecognised and the reference is declined,
# which is the safe outcome, but only if the ones that exist are actually here.
#
# "frist" is not a typo of ours: 2 production rows spell it that way ("Frist Special
# Session, HF9"). Accepting it cannot produce a wrong match, because the uniqueness
# check still has to pass; refusing it would drop 2 real references over a
# misspelling in the source feed.
SPECIAL_SESSION_ORDINALS = {
    "first": 1,
    "1st": 1,
    "frist": 1,
    "second": 2,
    "2nd": 2,
    "third": 3,
    "3rd": 3,
    "fourth": 4,
    "4th": 4,
    "fifth": 5,
    "5th": 5,
    "sixth": 6,
    "6th": 6,
    "seventh": 7,
    "7th": 7,
}


def known_special_sessions() -> list[tuple[int, int, int, str]]:
    """Every special session we can name, as ``(legislature, ordinal, year, slug)``.

    Read from ``SESSION_DEFINITIONS`` rather than from the database so there is one
    source of truth for what "First Special Session" means, shared with the ingestion
    that creates these rows. The ordinal is the discovery code's leading digit, which
    is what ``special_session_number`` decodes.
    """
    return sorted(
        {
            (
                definition.session_number,
                special_session_number(code),
                definition.year_start,
                definition.slug,
            )
            for code, definition in SESSION_DEFINITIONS.items()
            if definition.session_type == "special"
        }
    )


def named_special_session(text: str, legislature: int) -> str | None | bool:
    """Which session slug a phrase names, if it names one unambiguously.

    Three outcomes, deliberately distinct:

    * ``False`` — it names no session, so the caller behaves exactly as before.
    * a slug — it names exactly one session we hold.
    * ``None`` — it names a session we cannot pin down to exactly one, so the caller
      declines rather than picks.

    The last case is the important one. "First Special Session, HF 5" resolved
    against the regular session lands a reader on an unrelated tax bill instead of
    the K-12 education finance bill they asked for (#745, #746). Declining costs a
    reader one extra step; a wrong match costs them the truth.

    **Candidates are confined to the given Legislature.** A bare "First Special
    Session" is only meaningful relative to a Legislature, and once #359 loads prior
    bienniums there will be several sessions answering to that name. Confining the
    search means those can never bleed in; and if one Legislature ever holds two
    special sessions in different years, an unqualified reference becomes ambiguous
    and is declined rather than guessed.
    """
    if not OTHER_SESSION.search(text):
        return False
    match = NAMED_SPECIAL_SESSION.search(text)
    if match is None:
        # Says "session" but not in a shape we recognise. Unknown, so declined.
        return None
    year = int(match.group("year")) if match.group("year") else None
    qualifier = match.group("qualifier")
    if qualifier is None:
        ordinal = None
    elif qualifier.lower() in SPECIAL_SESSION_ORDINALS:
        ordinal = SPECIAL_SESSION_ORDINALS[qualifier.lower()]
    else:
        # A word we do not recognise sits where an ordinal would. Treating that as
        # "no ordinal given" is how a wrong match gets made: "Fourth Special Session"
        # would fall through to the Legislature's only special session and match the
        # first one. Unrecognised means declined.
        return None
    candidates = {
        slug
        for candidate_legislature, candidate_ordinal, candidate_year, slug in (
            known_special_sessions()
        )
        if candidate_legislature == legislature
        and (ordinal is None or candidate_ordinal == ordinal)
        and (year is None or candidate_year == year)
    }
    return candidates.pop() if len(candidates) == 1 else None
