"""Finance name-matching eval: does a name land on the right record?

Two parts, both graded by code and both run through the shipped functions:

* **Spelling groups** (`score_pairs`). Each case is 2 printed names and whether
  they belong to the same registered filer. `groups_with` from
  `finance_similar_names` decides, exactly as the page does. Offline; no database.
* **Search** (`run_searches`). Each case is what a person types and the record that
  must appear in the first results of Finance search (`finance_suggestions.money`).
  Runs read-only against a database.

**Where the answer key comes from.** Pair labels come from the Campaign Finance
Board's own registration numbers on contribution rows, never from a name judgement:
2 spellings under 1 number are the same filer; 2 close spellings under different
numbers are different filers. Search expectations come from person-checked
legislator-to-committee links and the lobbyist register. A typed registration
number can be wrong at the source, so failures are read before any score is
trusted (`excluded` records a case removed for a source error, with its reason).

The method and the measured results live in
`docs/implementation/finance-name-matching-eval.md`.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from itertools import combinations
from pathlib import Path

from sqlalchemy import create_engine, event, text

FIXTURES = Path(__file__).parent / "fixtures"
PAIRS_FIXTURE = FIXTURES / "finance_name_pairs.json"
SEARCHES_FIXTURE = FIXTURES / "finance_name_searches.json"

LABELS = ("same", "different")
# "spelling": the 2 names read alike once case, punctuation and word order are set
# aside. "wording": the same filer printed with different words (a rename, an added
# word). A spelling group claims only the first; the second is reported, not failed.
CONDITIONS = ("spelling", "wording")
SPELLING_RESEMBLANCE = 0.85
ROLES = ("donor", "payee", "employer")
# Filer types whose registration numbers identify one filer. "Individual", "Self",
# "Other" and blank rows reuse numbers across unrelated people in the source.
NUMBERED_TYPES = (
    "Candidate Committee",
    "Lobbyist",
    "Political Committee/Fund",
    "Party Unit",
)
# A number printed under more spellings than this is treated as a reused placeholder.
MAX_SPELLINGS_PER_NUMBER = 6
# A spelling must recur under its number: a single row can be a mistyped number,
# which would fake a "same" or "different" label.
MIN_ROWS_PER_SPELLING = 2
# A shared word this common does not suggest 2 names are worth comparing.
COMMON_WORD_LIMIT = 40


@dataclass(frozen=True)
class PairCase:
    id: str
    left: str
    right: str
    role: str
    label: str
    condition: str
    kind: str  # "person" (a lobbyist) or "organization"
    evidence: str
    excluded: str | None = None


@dataclass(frozen=True)
class SearchCase:
    id: str
    typed: str
    surface: str  # "money": Finance search (finance_suggestions.money)
    group: str  # the result group the record must appear in
    key_field: str
    expect: str
    condition: str
    evidence: str
    excluded: str | None = None


# --- Names ------------------------------------------------------------------


def words(name: str) -> list[str]:
    return re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", name).casefold())


def normalized(name: str) -> str:
    return " ".join(sorted(words(name)))


def resemblance(left: str, right: str) -> float:
    """Character resemblance with case, punctuation and word order set aside.

    Independent of the matcher under test; used only to sort cases into conditions.
    """
    return SequenceMatcher(
        None, normalized(left), normalized(right), autojunk=False
    ).ratio()


def condition_of(left: str, right: str) -> str:
    return "spelling" if resemblance(left, right) >= SPELLING_RESEMBLANCE else "wording"


def _fold(word: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", word) if not unicodedata.combining(c)
    )


def pattern_of(left: str, right: str) -> str:
    """How 2 printed names differ, by code, so a miss names what the rule lacks."""
    a = sorted(_fold(w) for w in words(left))
    b = sorted(_fold(w) for w in words(right))
    if a == b:
        return "accents_case_or_order"
    numbers_a = {w for w in a if w.isdigit()}
    numbers_b = {w for w in b if w.isdigit()}
    if numbers_a and numbers_b and numbers_a != numbers_b:
        return "numbers_differ"
    count_a, count_b = Counter(a), Counter(b)
    only_a, only_b = (
        list((count_a - count_b).elements()),
        list((count_b - count_a).elements()),
    )
    if not only_a or not only_b:
        return "extra_words"
    if len(only_a) == len(only_b):
        if all(any(x.startswith(y) or y.startswith(x) for y in only_b) for x in only_a):
            return "shortened_word"
        if (
            len(only_a) == 1
            and SequenceMatcher(None, only_a[0], only_b[0]).ratio() >= 0.75
        ):
            return "typo"
    return "other"


def _pair_id(left: str, right: str) -> str:
    a, b = sorted((left, right))
    return hashlib.sha1(f"{a}\x00{b}".encode()).hexdigest()[:12]


# --- Spelling groups --------------------------------------------------------


def grouped(case: PairCase) -> bool:
    from alethical.api.services.finance_similar_names import groups_with

    return groups_with(case.left, case.right, case.role)


def score_pairs(cases: list[PairCase]) -> dict:
    """Per-condition counts. A wrong group is reported apart from a missed one."""
    strata: dict[str, Counter] = defaultdict(Counter)
    failures = []
    excluded = 0
    for case in cases:
        if case.excluded:
            excluded += 1
            continue
        together = grouped(case)
        key = f"{case.label}/{case.condition}/{case.kind}"
        strata[key]["cases"] += 1
        strata[key]["grouped"] += together
        should_group = case.label == "same" and case.condition == "spelling"
        if case.label == "different" and together:
            failures.append(
                {
                    **asdict(case),
                    "failure": "wrong_group",
                    "pattern": pattern_of(case.left, case.right),
                }
            )
        elif should_group and not together:
            failures.append(
                {
                    **asdict(case),
                    "failure": "missed",
                    "pattern": pattern_of(case.left, case.right),
                }
            )

    def rate(label, condition):
        n = sum(
            s["cases"]
            for k, s in strata.items()
            if k.startswith(f"{label}/{condition}/")
        )
        g = sum(
            s["grouped"]
            for k, s in strata.items()
            if k.startswith(f"{label}/{condition}/")
        )
        return {"cases": n, "grouped": g, "rate": round(g / n, 3) if n else None}

    return {
        "found_spelling_variants": rate("same", "spelling"),
        "found_reworded_names": rate("same", "wording"),
        "wrong_groups": rate("different", "spelling"),
        "strata": {k: dict(v) for k, v in sorted(strata.items())},
        "misses_by_pattern": dict(
            Counter(
                f["pattern"] for f in failures if f["failure"] == "missed"
            ).most_common()
        ),
        "excluded": excluded,
        "failures": failures,
    }


def failing_ids(report: dict) -> dict[str, str]:
    return {f["id"]: f["failure"] for f in report["failures"]}


# --- Fixtures ---------------------------------------------------------------


def load_pairs(path: Path = PAIRS_FIXTURE) -> tuple[dict, list[PairCase]]:
    data = json.loads(path.read_text())
    return data, [PairCase(**case) for case in data["cases"]]


def load_searches(path: Path = SEARCHES_FIXTURE) -> tuple[dict, list[SearchCase]]:
    data = json.loads(path.read_text())
    return data, [SearchCase(**case) for case in data["cases"]]


# --- Database access --------------------------------------------------------


def read_only_engine(url: str):
    """Every transaction is READ ONLY, so a run can never write to the database."""
    from alethical.db.session import NO_PREPARED_STATEMENTS

    # REPEATABLE READ is what committee_finance.pin_to_one_view asks for; set here
    # because the read-only hook below opens the connection before it can.
    engine = create_engine(
        url,
        connect_args=NO_PREPARED_STATEMENTS,
        pool_pre_ping=True,
        isolation_level="REPEATABLE READ",
    )

    @event.listens_for(engine, "begin")
    def _read_only(conn):  # pragma: no cover - exercised against PostgreSQL
        conn.exec_driver_sql("SET TRANSACTION READ ONLY")

    return engine


def _sample(items: list, size: int) -> list:
    return sorted(items, key=lambda c: hashlib.sha1(c.id.encode()).hexdigest())[:size]


def harvest_pairs(db, *, per_stratum: int = 40) -> tuple[dict, list[PairCase]]:
    """Build labelled pairs from registration numbers on the published contributions."""
    from alethical.api.services import committee_finance
    from alethical.db import models as m

    release = committee_finance.current_release(db)
    snapshot = release.file_for(m.CampaignFinanceDataset.contributions).snapshot_id
    rows = db.execute(
        text(
            """
            select contrib_reg_num, contributor, contrib_type, count(*) as n
            from cf_contribution_row
            where snapshot_id = :s and contrib_reg_num is not null
              and contributor is not null and btrim(contributor) <> ''
              and contrib_type = any(:types)
            group by 1, 2, 3
            """
        ),
        {"s": snapshot, "types": list(NUMBERED_TYPES)},
    ).all()
    spellings: dict[str, Counter] = defaultdict(Counter)
    types: dict[str, Counter] = defaultdict(Counter)
    for number, name, kind, n in rows:
        spellings[number][name] += n
        types[number][kind] += n
    single_row = 0
    for number in list(spellings):
        kept = Counter(
            {k: v for k, v in spellings[number].items() if v >= MIN_ROWS_PER_SPELLING}
        )
        single_row += len(spellings[number]) - len(kept)
        spellings[number] = kept
    placeholder = {n for n, s in spellings.items() if len(s) > MAX_SPELLINGS_PER_NUMBER}
    kind_of = {
        n: ("person" if t.most_common(1)[0][0] == "Lobbyist" else "organization")
        for n, t in types.items()
    }

    def case(left, right, label, kind, evidence):
        return PairCase(
            id=_pair_id(left, right),
            left=left,
            right=right,
            role="donor",
            label=label,
            condition=condition_of(left, right),
            kind=kind,
            evidence=evidence,
        )

    same = []
    trivial = 0
    for number, names in spellings.items():
        if number in placeholder:
            continue
        for left, right in combinations(sorted(names), 2):
            if normalized(left) == normalized(right):
                trivial += 1
                continue
            same.append(
                case(
                    left, right, "same", kind_of[number], f"Board registration {number}"
                )
            )

    owner = {}
    ambiguous = set()
    for number, names in spellings.items():
        if number in placeholder:
            continue
        for name in names:
            if owner.setdefault(name, number) != number:
                ambiguous.add(name)
    names = sorted(n for n in owner if n not in ambiguous)
    buckets: dict[str, list[str]] = defaultdict(list)
    counts = Counter(w for n in names for w in set(words(n)))
    for name in names:
        for w in set(words(name)):
            if len(w) >= 4 and not w.isdigit() and counts[w] <= COMMON_WORD_LIMIT:
                buckets[w].append(name)
        # Same words with different numbers: district and unit names.
        if any(w.isdigit() for w in words(name)):
            buckets[
                "#" + " ".join("#" if w.isdigit() else w for w in words(name))
            ].append(name)
    different = {}
    for members in buckets.values():
        for left, right in combinations(members, 2):
            a, b = owner[left], owner[right]
            if a == b or normalized(left) == normalized(right):
                continue
            if resemblance(left, right) < SPELLING_RESEMBLANCE:
                continue
            kind = "person" if kind_of[a] == kind_of[b] == "person" else "organization"
            pair = case(
                left, right, "different", kind, f"Board registrations {a} and {b}"
            )
            different[pair.id] = pair

    chosen = []
    pools: dict[tuple, list] = defaultdict(list)
    for c in [*same, *different.values()]:
        pools[(c.label, c.condition, c.kind)].append(c)
    for key in sorted(pools):
        if key[0] == "different" and key[1] == "wording":
            continue
        chosen.extend(_sample(pools[key], per_stratum))
    meta = {
        "contributions_snapshot": str(snapshot),
        "numbers": len(spellings),
        "placeholder_numbers_skipped": len(placeholder),
        "spellings_on_fewer_rows_skipped": single_row,
        "min_rows_per_spelling": MIN_ROWS_PER_SPELLING,
        "same_pairs_available": len(same),
        "identical_after_normalizing_skipped": trivial,
        "different_pairs_available": len(different),
        "per_stratum": per_stratum,
    }
    return meta, sorted(chosen, key=lambda c: (c.label, c.condition, c.kind, c.id))


# --- Search -----------------------------------------------------------------


def harvest_searches(db, *, per_condition: int = 30) -> tuple[dict, list[SearchCase]]:
    """Searches whose right answer is already settled by a person or a register."""
    from alethical.api.services import campaign_finance_register as register
    from alethical.api.services import lobbying

    # Only committees on the current register: search is right to return a
    # legislator's current committee rather than one that has since closed.
    register_snapshot = register.register_summary(db).snapshot_id
    links = db.execute(
        text(
            """
            select l.first_name, l.last_name, l.full_name, c.registration_number,
                   c.committee_name_as_reviewed
            from legislator_campaign_committee c
            join legislator l on l.id = c.legislator_id
            join cf_filer f on f.registration_number = c.registration_number
              and f.snapshot_id = :register and f.retained_from_snapshot_id is null
            where c.decision = 'confirmed' and l.first_name is not null
              and l.last_name is not null
            """
        ),
        {"register": register_snapshot},
    ).all()
    cases = []
    for first, last, full, number, committee in links:
        typed = f"{first} {last}"
        cases.append(
            SearchCase(
                id=_pair_id("committee", typed + number),
                typed=typed,
                surface="money",
                group="committees",
                key_field="registration_number",
                expect=number,
                condition="candidate_name_finds_committee",
                evidence=f"Person-checked link: {full} to {committee} ({number})",
            )
        )
    pair = lobbying.published_pair(db)
    lobbyists = db.execute(
        text(
            "select registration_number, name, first_name, last_name from lobbyist_row "
            "where snapshot_id = :s and first_name is not null and last_name is not null"
        ),
        {"s": pair.lobbyist_snapshot_id},
    ).all()
    for number, printed, first, last in lobbyists:
        for typed, condition in (
            (f"{first} {last}", "lobbyist_first_last"),
            (printed, "lobbyist_as_printed"),
        ):
            cases.append(
                SearchCase(
                    id=_pair_id(condition, typed + number),
                    typed=typed,
                    surface="money",
                    group="lobbyists",
                    key_field="registration_number",
                    expect=number,
                    condition=condition,
                    evidence=f"Lobbyist register {number}: {printed}",
                )
            )
    pools: dict[str, list] = defaultdict(list)
    for c in cases:
        pools[c.condition].append(c)
    chosen = []
    lobbyist_ids = {
        c.expect for c in _sample(pools["lobbyist_first_last"], per_condition)
    }
    chosen.extend(_sample(pools["candidate_name_finds_committee"], per_condition))
    for condition in ("lobbyist_first_last", "lobbyist_as_printed"):
        chosen.extend(c for c in pools[condition] if c.expect in lobbyist_ids)
    meta = {
        "confirmed_links_on_current_register": len(links),
        "lobbyists": len(lobbyists),
        "per_condition": per_condition,
    }
    return meta, sorted(chosen, key=lambda c: (c.condition, c.id))


def search_keys(db, case: SearchCase, limit: int) -> list[str]:
    if case.surface == "money":
        from alethical.api.services import finance_suggestions

        found = finance_suggestions.money(db, case.typed, limit)
        for group in found["groups"]:
            if group["kind"] == case.group:
                return [str(row.get(case.key_field)) for row in group["results"]]
        return []
    raise ValueError(f"Unknown surface {case.surface}")


def run_searches(db, cases: list[SearchCase], *, limit: int = 5) -> list[dict]:
    results = []
    for case in cases:
        if case.excluded:
            continue
        try:
            keys = search_keys(db, case, limit)
            error = None
        except Exception as exc:  # a failed read is a failed task, never a pass
            db.rollback()
            keys, error = [], f"{type(exc).__name__}: {exc}"[:300]
        rank = keys.index(case.expect) + 1 if case.expect in keys else None
        results.append({**asdict(case), "found": keys, "rank": rank, "error": error})
    return results


def score_searches(results: list[dict]) -> dict:
    by: dict[str, Counter] = defaultdict(Counter)
    for r in results:
        by[r["condition"]]["cases"] += 1
        by[r["condition"]]["found"] += r["rank"] is not None
        by[r["condition"]]["first"] += r["rank"] == 1
        by[r["condition"]]["errors"] += r["error"] is not None
    return {
        condition: {**dict(c), "rate": round(c["found"] / c["cases"], 3)}
        for condition, c in sorted(by.items())
    }


def write_fixture(
    path: Path, description: str, meta: dict, cases: list, **extra
) -> None:
    body = {
        "description": description,
        **extra,
        "harvest": meta,
        "cases": [asdict(c) for c in cases],
    }
    path.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n")


__all__ = [
    "CONDITIONS",
    "LABELS",
    "PairCase",
    "SearchCase",
    "condition_of",
    "failing_ids",
    "pattern_of",
    "grouped",
    "harvest_pairs",
    "harvest_searches",
    "load_pairs",
    "load_searches",
    "read_only_engine",
    "resemblance",
    "run_searches",
    "score_pairs",
    "score_searches",
    "write_fixture",
]
