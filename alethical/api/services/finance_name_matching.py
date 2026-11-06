"""Finance browsing matches, never identity claims or rewrites of source names.

Full-name spelling groups allow a small typing difference or a missing middle
initial. Discovery can find a word within a longer name and retains that
result's own identifier.
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

from sqlalchemy import and_, case, false, func, or_, select

from alethical.api.services.campaign_finance_register import (
    name_contains,
    name_words_contain,
)

_WORDS = {
    "assn": "association",
    "assoc": "association",
    "co": "company",
    "corp": "corporation",
    "inc": "incorporated",
    "ltd": "limited",
}
_TITLES = {"mr", "mrs", "ms", "dr"}
_SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def _tokens(value: str, *, person: bool = False) -> list[str]:
    text = unicodedata.normalize("NFKC", value).casefold()
    text = re.sub(r"\bl\s*\.\s*l\s*\.\s*c\b", "llc", text)
    words = re.findall(r"[^\W_]+", text)
    return [
        (_WORDS.get(word, word) if not person else word)
        for word in words
        if not (person and word in _TITLES)
    ]


def _distance(left: str, right: str) -> int:
    """Small ordinary Levenshtein distance, with adjacent swaps counted once."""
    previous = list(range(len(right) + 1))
    before_previous = previous
    for i, a in enumerate(left, 1):
        row = [i]
        for j, b in enumerate(right, 1):
            cost = min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a != b))
            if i > 1 and j > 1 and a == right[j - 2] and left[i - 2] == b:
                cost = min(cost, before_previous[j - 2] + 1)
            row.append(cost)
        before_previous, previous = previous, row
    return previous[-1]


def _word_typo(left: str, right: str) -> bool:
    if left == right:
        return True
    if any(char.isdigit() for char in left + right):
        return False
    if min(len(left), len(right)) < 5:
        return False
    allowance = 2 if min(len(left), len(right)) >= 7 else 1
    return (
        abs(len(left) - len(right)) <= allowance and _distance(left, right) <= allowance
    )


def _person_parts(value: str) -> tuple[list[str], list[str], tuple[str, ...]]:
    words = _tokens(value, person=True)
    suffixes = tuple(word for word in words if word in _SUFFIXES)
    if "," in value:
        surname, given = value.split(",", 1)
        return (
            _tokens(surname, person=True),
            [word for word in _tokens(given, person=True) if word not in _SUFFIXES],
            suffixes,
        )
    core = [word for word in words if word not in _SUFFIXES]
    return core[-1:], core[:-1], suffixes


def _has_middle_initial(given: list[str]) -> bool:
    return len(given) == 2 and len(given[1]) == 1 and given[1].isalpha()


def strong_spelling(query: str, candidate: str, *, person: bool = False) -> bool:
    """A likely complete spelling variant, not evidence of a shared identity.

    Conflicting given/middle names, suffixes, numbers and organization words remain
    distinct. Word order, punctuation, case and titles do not create a new spelling
    group. A single-word personal name cannot establish a full-name match.
    """
    left, right = _tokens(query, person=person), _tokens(candidate, person=person)
    if person:
        family_a, given_a, suffix_a = _person_parts(query)
        family_b, given_b, suffix_b = _person_parts(candidate)
        if not given_a or suffix_a != suffix_b:
            return False
        if given_a != given_b:
            shorter, longer = sorted((given_a, given_b), key=len)
            return (
                bool(family_a)
                and family_a == family_b
                and _has_middle_initial(longer)
                and shorter == longer[:1]
            )
        left, right = family_a, family_b
    if not left or not right or len(left) != len(right):
        return False
    remaining = right[:]
    unmatched = []
    for word in left:
        if word in remaining:
            remaining.remove(word)
        else:
            unmatched.append(word)
    if not unmatched:
        return True
    if len(unmatched) != 1:
        return False
    # Typing differences at the beginning of a full name are too ambiguous for
    # automatic grouping (Health/Wealth is useful discovery, not a shared agency).
    a, b = unmatched[0], remaining[0]
    return a[:2] == b[:2] and _word_typo(a, b)


def direct_text(query: str, candidate: str) -> bool:
    if query.casefold() in candidate.casefold():
        return True
    if any(char in query for char in "%_\\"):
        return False
    words = re.findall(r"[^\W_]+", query.casefold())
    return bool(words) and all(word in candidate.casefold() for word in words)


def discovery_text(query: str, candidate: str) -> bool:
    """Same discovery decision for already-held graph node labels."""
    if query.casefold() in candidate.casefold():
        return True
    if any(char in query for char in "%_\\"):
        return False
    words, held = _tokens(query), _tokens(candidate)
    return bool(words) and all(
        any(word in other or _word_typo(word, other) for other in held)
        for word in words
    )


def closeness(query: str, candidate: str) -> float:
    """Stable ordering of comparison names; never shown as a confidence score."""
    left, right = _tokens(query), _tokens(candidate)
    a, b = " ".join(sorted(left)), " ".join(sorted(right))
    return SequenceMatcher(None, a, b, autojunk=False).ratio()


def strong_candidates(column, query: str, *, person: bool = False):
    """Necessary conditions for strong_spelling, not a second eligibility rule.

    Every normalized word must be unchanged except a missing middle initial
    or at most one long word whose first 2 letters agree. Exact words anchor the
    indexed regex branches; a one-word organization uses its prefix.
    Abbreviations and punctuated LLC keep
    their raw forms. Non-ASCII source names are included conservatively because
    Python's NFKC/casefold can change their characters. Only strong_spelling
    decides which retrieved keys appear in the main groups.

    Unlike a trigram cutoff, these conditions follow directly from the matcher,
    so accepted swaps or two edits cannot vanish before eligibility is tested.
    """
    words = _tokens(query, person=person)
    if not words:
        return false()

    def forms(word):
        return [
            word,
            *(
                alias
                for alias, expanded in _WORDS.items()
                if not person and expanded == word
            ),
        ]

    def token_pattern(word):
        if word == "llc":
            return r"l[[:space:].]*l[[:space:].]*c"
        return "(?:" + "|".join(re.escape(value) for value in forms(word)) + ")"

    def whole(pattern):
        # Python treats underscores as separators; PostgreSQL's \m does not.
        return column.op("~*")(r"(?:^|[^[:alnum:]])" + pattern + r"(?:$|[^[:alnum:]])")

    unchanged = [whole(token_pattern(word)) for word in words]
    branches = [and_(*unchanged)]
    if person:
        surname, given, suffixes = _person_parts(query)
        if surname and _has_middle_initial(given):
            branches.append(
                and_(
                    *(
                        whole(token_pattern(word))
                        for word in [*surname, given[0], *suffixes]
                    )
                )
            )
    for index, word in enumerate(words):
        if len(word) < 5 or any(char.isdigit() for char in word):
            continue
        patterns = [re.escape(word[:2]) + "[[:alnum:]]*"]
        if not person:
            patterns.extend(
                re.escape(alias)
                for alias, expanded in _WORDS.items()
                if word[:2] == expanded[:2] and _word_typo(word, expanded)
            )
        changed = whole("(?:" + "|".join(patterns) + ")")
        branches.append(
            and_(*(changed if i == index else term for i, term in enumerate(unchanged)))
        )
    return or_(column.op("~")(r"[^\x01-\x7f]"), *branches)


def _word_contains(column, word):
    if word == "llc":
        return or_(
            name_contains(column, word),
            column.op("~*")(r"\ml[[:space:].]*l[[:space:].]*c\M"),
        )
    return name_contains(column, word)


def discovery_match(column, typed: str):
    """SQL predicate for Finance-only discovery, with literal numbers preserved.

    Each typed word must be present (in any order) or resemble a whole long word.
    This is not the predicate for automatic grouping. The caller's held-data scope,
    explicit sort and pagination remain outside this predicate.
    """
    if any(char in typed for char in "%_\\"):
        return name_contains(column, typed)
    words = _tokens(typed)
    if not words:
        return name_contains(column, typed)
    clauses = []
    for word in words:
        exact = _word_contains(column, word)
        if len(word) < 5 or any(char.isdigit() for char in word):
            clauses.append(exact)
            continue
        token = (
            func.regexp_split_to_table(func.lower(column), "[^[:alnum:]]+")
            .table_valued("word")
            .render_derived()
        )
        canonical = case(_WORDS, value=token.c.word, else_=token.c.word)
        allowance = 2 if len(word) >= 7 else 1
        typo = (
            select(1)
            .select_from(token)
            .where(
                func.length(canonical) >= 5,
                func.abs(func.length(canonical) - len(word)) <= allowance,
                ~token.c.word.op("~")("[[:digit:]]"),
                func.length(func.translate(canonical, word, "")) <= allowance,
                func.length(func.translate(word, canonical, "")) <= allowance,
                func.finance_word_spelling(canonical, word),
            )
            .correlate_except(token)
            .exists()
        )
        clauses.append(or_(exact, typo))
    return or_(name_contains(column, typed), and_(*clauses))


def direct_order(column, typed: str):
    """Direct names precede typo matches only on surfaces without a sort control."""
    return name_words_contain(column, typed).desc()


def configure_discovery(db):
    """Compatibility hook for Finance readers; no similarity setting is needed."""
    return None


def _edit_candidate_word(column, word):
    if len(word) in (5, 6):
        # These lengths allow only one edit, including an adjacent swap. Keep
        # every such word as an indexed regex candidate, then let the shared
        # spelling function decide eligibility. Literal runs let PostgreSQL
        # narrow more queries than the arbitrary-letter pattern below.
        letters = [re.escape(char) for char in word]
        variants = {"".join(letters)}
        for index in range(len(letters)):
            variants.add("".join(letters[:index] + letters[index + 1 :]))
            variants.add(
                "".join(letters[:index] + ["[[:alnum:]]"] + letters[index + 1 :])
            )
            if index + 1 < len(letters):
                variants.add(
                    "".join(
                        letters[:index]
                        + [letters[index + 1], letters[index]]
                        + letters[index + 2 :]
                    )
                )
        for index in range(len(letters) + 1):
            variants.add("".join(letters[:index] + ["[[:alnum:]]"] + letters[index:]))
        return column.op("~*")(
            r"(?:^|[^[:alnum:]])(?:"
            + "|".join(sorted(variants))
            + r")(?:$|[^[:alnum:]])"
        )
    # Each character absent from the query requires one edit. Adjacent swaps
    # change no characters. This necessary condition is cheaper than splitting
    # every source row into tokens; the final distance test still decides.
    letters = re.escape("".join(sorted(set(word))))
    allowance = 2 if len(word) >= 7 else 1
    pattern = (
        r"(?:^|[^[:alnum:]])(?=[[:alnum:]]{5})"
        + f"[{letters}]*(?:[^{letters}[:space:][:punct:]][{letters}]*){{0,{allowance}}}"
        + r"(?:$|[^[:alnum:]])"
    )
    return column.op("~*")(pattern)


def indexed_discovery_match(column, typed: str):
    """Necessary candidate conditions for large source tables, without a cutoff."""
    if any(char in typed for char in "%_\\"):
        return name_contains(column, typed)
    words = _tokens(typed)
    candidates = [
        or_(
            name_contains(column, word),
            _edit_candidate_word(column, word),
            *(
                column.op("~*")(r"\m" + re.escape(alias) + r"\M")
                for alias, expanded in _WORDS.items()
                if expanded == word or _word_typo(word, expanded)
            ),
        )
        if len(word) >= 5 and not any(c.isdigit() for c in word)
        else _word_contains(column, word)
        for word in words
    ]
    return (
        and_(
            or_(name_contains(column, typed), and_(*candidates)),
            discovery_match(column, typed),
        )
        if candidates
        else name_contains(column, typed)
    )
