"""Finance browsing matches, never identity claims or rewrites of source names.

Full-name spelling groups allow a small typing difference, or a middle name that
is missing or printed as its initial. Discovery can find a word within a longer
name, a word typed with accents the name lacks, a nickname or the formal name
behind it, and a name missing 1 middle word the reader typed; each result keeps
its own identifier.
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


def _compatible_middle(given_a: list[str], given_b: list[str]) -> bool:
    """Same first name; the middle names never conflict.

    One name may lack a middle initial ("Bruce" and "Bruce M"), or print the
    initial of the other's full middle name ("Linda M" and "Linda Marie"). A missing
    full middle name, 2 different initials or 2 different full middle names stay
    separate.
    """
    if not given_a or not given_b or given_a[0] != given_b[0]:
        return False
    if max(len(given_a), len(given_b)) > 2:
        return False
    if len(given_a) != len(given_b):
        return _has_middle_initial(max(given_a, given_b, key=len))
    a, b = given_a[1], given_b[1]
    shorter, longer = sorted((a, b), key=len)
    return len(shorter) == 1 and shorter.isalpha() and longer.startswith(shorter)


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
            return (
                bool(family_a)
                and family_a == family_b
                and _compatible_middle(given_a, given_b)
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


# Common English given names and the short forms people type for them. Search only:
# a nickname finds a record to look at, never evidence that 2 names are 1 person,
# and spelling groups never use it. Forms shorter than 3 letters are left out.
_NICKNAMES = {
    "abigail": ("abby",),
    "alexander": ("alex",),
    "alexandra": ("alex", "lexi"),
    "andrew": ("andy", "drew"),
    "anthony": ("tony",),
    "barbara": ("barb",),
    "benjamin": ("ben", "benny"),
    "bradley": ("brad",),
    "catherine": ("cathy", "kate", "katie"),
    "charles": ("charlie", "chuck"),
    "christopher": ("chris",),
    "cynthia": ("cindy",),
    "daniel": ("dan", "danny"),
    "david": ("dave",),
    "deborah": ("deb", "debbie"),
    "donald": ("don", "donnie"),
    "douglas": ("doug",),
    "edward": ("eddie", "ted"),
    "elizabeth": ("beth", "betsy", "betty", "libby", "liz", "lizzie"),
    "eugene": ("gene",),
    "frederick": ("fred", "freddie"),
    "gerald": ("gerry", "jerry"),
    "gregory": ("greg",),
    "harold": ("hal", "harry"),
    "henry": ("hank", "harry"),
    "jacqueline": ("jackie",),
    "james": ("jamie", "jim", "jimmy"),
    "jeffery": ("jeff",),
    "jeffrey": ("jeff",),
    "jennifer": ("jen", "jenny"),
    "jessica": ("jess", "jessie"),
    "john": ("jack", "johnny"),
    "jonathan": ("jon",),
    "joseph": ("joe", "joey"),
    "joshua": ("josh",),
    "katherine": ("kate", "kathy", "katie"),
    "kathryn": ("kate", "kathy", "katie"),
    "kenneth": ("ken", "kenny"),
    "kimberly": ("kim",),
    "lawrence": ("larry",),
    "leonard": ("len", "lenny"),
    "margaret": ("maggie", "marge", "meg", "peggy"),
    "matthew": ("matt",),
    "melissa": ("mel", "missy"),
    "michael": ("mike", "mikey"),
    "mitchell": ("mitch",),
    "nathaniel": ("nate",),
    "nicholas": ("nick", "nicky"),
    "pamela": ("pam",),
    "patricia": ("pat", "patti", "patty", "tricia", "trish"),
    "peter": ("pete",),
    "phillip": ("phil",),
    "philip": ("phil",),
    "raymond": ("ray",),
    "rebecca": ("becca", "becky"),
    "richard": ("dick", "rich", "rick", "ricky"),
    "robert": ("bob", "bobby", "rob", "robbie"),
    "ronald": ("ron", "ronnie"),
    "samuel": ("sam", "sammy"),
    "sandra": ("sandy",),
    "stephen": ("steve",),
    "steven": ("steve",),
    "susan": ("sue", "susie"),
    "theodore": ("ted", "teddy", "theo"),
    "thomas": ("tom", "tommy"),
    "timothy": ("tim", "timmy"),
    "victoria": ("tori", "vicky"),
    "vincent": ("vince",),
    "walter": ("walt",),
    "william": ("bill", "billy", "will", "willie"),
    "zachary": ("zach", "zack", "zak"),
}
_FORMAL_NAMES: dict[str, set[str]] = {}
for _formal, _short in _NICKNAMES.items():
    for _nick in _short:
        _FORMAL_NAMES.setdefault(_nick, set()).add(_formal)


def _fold(word: str) -> str:
    return "".join(
        char
        for char in unicodedata.normalize("NFKD", word)
        if not unicodedata.combining(char)
    )


def _alternatives(word: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Other spellings to accept for 1 typed word: (like the word, whole word only).

    The first kind is the word without accents, matched the way the word itself is.
    The second kind is a nickname or the formal name behind one.
    """
    if any(char.isdigit() for char in word):
        return (), ()
    folded = _fold(word)
    plain = (folded,) if folded != word else ()
    names = set(_NICKNAMES.get(folded, ())) | _FORMAL_NAMES.get(folded, set())
    return plain, tuple(sorted(names - {folded, word}))


def _with_optional_middle(conditions: list, combine_all, combine_any):
    """All typed words, or all but 1 word between the first and the last.

    A middle name or initial a reader types ("Mark W. Koran", "María Isa
    Pérez-Vega") is often absent from the printed name.
    """
    full = combine_all(conditions)
    if len(conditions) < 3:
        return full
    return combine_any(
        [
            full,
            *(
                combine_all(conditions[:i] + conditions[i + 1 :])
                for i in range(1, len(conditions) - 1)
            ),
        ]
    )


def _sql_words(conditions: list):
    return _with_optional_middle(
        conditions, lambda terms: and_(*terms), lambda terms: or_(*terms)
    )


def discovery_text(query: str, candidate: str) -> bool:
    """Same discovery decision for already-held graph node labels."""
    if query.casefold() in candidate.casefold():
        return True
    if any(char in query for char in "%_\\"):
        return False
    words, held = _tokens(query), _tokens(candidate)
    if not words:
        return False

    def found(word):
        plain, names = _alternatives(word)
        return any(
            any(form in other or _word_typo(form, other) for other in held)
            for form in (word, *plain)
        ) or any(name in held for name in names)

    return _with_optional_middle([found(word) for word in words], all, any)


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
        if surname and len(given) == 2:
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

    Each typed word must be present (in any order), resemble a whole long word,
    match without its accents, or match a nickname or formal name as a whole word.
    1 word between the first and the last may be absent. This is not the predicate
    for automatic grouping. The caller's held-data scope,
    explicit sort and pagination remain outside this predicate.
    """
    if any(char in typed for char in "%_\\"):
        return name_contains(column, typed)
    words = _tokens(typed)
    if not words:
        return name_contains(column, typed)
    clauses = []
    for word in words:
        plain, names = _alternatives(word)
        clauses.append(
            or_(
                *(_discovery_word(column, form) for form in (word, *plain)),
                *(_whole_word(column, name) for name in names),
            )
        )
    return or_(name_contains(column, typed), _sql_words(clauses))


def _whole_word(column, word):
    return column.op("~*")(
        r"(?:^|[^[:alnum:]])" + re.escape(word) + r"(?:$|[^[:alnum:]])"
    )


def _discovery_word(column, word):
    """1 typed word: present, or a small typing difference of a long word."""
    exact = _word_contains(column, word)
    if len(word) < 5 or any(char.isdigit() for char in word):
        return exact
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
    return or_(exact, typo)


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

    def candidate(word):
        return (
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
        )

    candidates = []
    for word in words:
        plain, names = _alternatives(word)
        candidates.append(
            or_(
                *(candidate(form) for form in (word, *plain)),
                *(_whole_word(column, name) for name in names),
            )
        )
    return (
        and_(
            or_(
                name_contains(column, typed),
                _sql_words(candidates),
            ),
            discovery_match(column, typed),
        )
        if candidates
        else name_contains(column, typed)
    )
