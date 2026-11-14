"""CLI for the Finance name-matching eval.

Stages
------
  pairs            Grade the committed spelling pairs with the shipped grouping
                   rule. Offline, free, seconds.
  search           Run the committed searches through Finance search, read-only,
                   against the database ALETHICAL_DATABASE_TARGET selects.
  harvest-pairs    Rebuild the pairs fixture from registration numbers on the
                   published contributions (read-only).
  harvest-searches Rebuild the searches fixture from person-checked legislator
                   links and the lobbyist register (read-only).

Examples
--------
  PYTHONPATH=. uv run python scripts/finance_name_eval.py pairs
  ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run python \
      scripts/finance_name_eval.py search --run-dir /tmp/finance-name-eval

Method and measured results: docs/implementation/finance-name-matching-eval.md.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import warnings
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from alethical.db.session import database_url_for_target, load_dotenv_if_present
from alethical.eval import finance_names as ev

PAIRS_DESCRIPTION = (
    "Spelling pairs for the Finance name-matching eval. Labels come from the Campaign "
    "Finance Board's registration numbers on contribution rows: 2 spellings under 1 "
    "number are the same filer, close spellings under different numbers are different "
    "filers. Rebuild with `scripts/finance_name_eval.py harvest-pairs`; method in "
    "docs/implementation/finance-name-matching-eval.md."
)
SEARCHES_DESCRIPTION = (
    "Searches for the Finance name-matching eval. Each expected record is settled by "
    "a person-checked legislator-to-committee link or the lobbyist register. Rebuild "
    "with `scripts/finance_name_eval.py harvest-searches`; method in "
    "docs/implementation/finance-name-matching-eval.md."
)


# committee_finance.pin_to_one_view asks for REPEATABLE READ on a connection the
# read-only engine has already opened at that level; its warning is expected here.
warnings.filterwarnings("ignore", message="Connection is already established")


def _session() -> Session:
    load_dotenv_if_present()
    target = os.environ.get("ALETHICAL_DATABASE_TARGET")
    return Session(ev.read_only_engine(database_url_for_target(target)))


def _write(run_dir: Path | None, name: str, body) -> None:
    if run_dir is None:
        return
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / name).write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n")


def _print_rate(label: str, row: dict) -> None:
    rate = "n/a" if row["rate"] is None else f"{row['rate']:.0%}"
    print(f"  {label:<34} {row['grouped']:>4} of {row['cases']:<4} {rate}")


def pairs(args) -> int:
    data, cases = ev.load_pairs()
    report = ev.score_pairs(cases)
    if args.record_known:
        data["known_failures"] = dict(sorted(ev.failing_ids(report).items()))
        ev.PAIRS_FIXTURE.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        )
        print(
            f"Recorded {len(data['known_failures'])} known failures in {ev.PAIRS_FIXTURE}"
        )
    print(f"Spelling pairs: {len(cases)} cases, {report['excluded']} excluded")
    _print_rate("Same filer, spelling differs:", report["found_spelling_variants"])
    _print_rate("Same filer, words differ:", report["found_reworded_names"])
    _print_rate("Different filers grouped:", report["wrong_groups"])
    print("  Misses by pattern:", report["misses_by_pattern"])
    for failure in report["failures"][: args.show]:
        print(
            f"  {failure['failure']:<11} {failure['pattern']:<22} {failure['left']!r} / {failure['right']!r}  ({failure['evidence']})"
        )
    _write(args.run_dir, "pairs.json", report)
    return 0


def search(args) -> int:
    data, cases = ev.load_searches()
    with _session() as db:
        results = ev.run_searches(db, cases, limit=args.limit)
    score = ev.score_searches(results)
    print(f"Searches: {len(results)} run, record must appear in the first {args.limit}")
    for condition, row in score.items():
        print(
            f"  {condition:<34} {row['found']:>4} of {row['cases']:<4} {row['rate']:.0%}  first: {row['first']}  errors: {row['errors']}"
        )
    for r in [r for r in results if r["rank"] is None][: args.show]:
        print(f"  missed  {r['typed']!r} -> {r['expect']}  ({r['evidence']})")
    _write(
        args.run_dir,
        "searches.json",
        {
            "ran_at": datetime.now(timezone.utc).isoformat(),
            "score": score,
            "results": results,
        },
    )
    return 0


def harvest_pairs(args) -> int:
    previous = {}
    if ev.PAIRS_FIXTURE.exists():
        previous = {c.id: c.excluded for c in ev.load_pairs()[1] if c.excluded}
    with _session() as db:
        meta, cases = ev.harvest_pairs(db, per_stratum=args.per_stratum)
    # A case read and excluded for a source error stays excluded with its reason.
    cases = [replace(c, excluded=previous.get(c.id)) for c in cases]
    meta["harvested_at"] = datetime.now(timezone.utc).date().isoformat()
    ev.write_fixture(
        ev.PAIRS_FIXTURE, PAIRS_DESCRIPTION, meta, cases, known_failures={}
    )
    print(
        json.dumps(meta, indent=2),
        f"\n{len(cases)} cases written to {ev.PAIRS_FIXTURE}",
    )
    return 0


def harvest_searches(args) -> int:
    with _session() as db:
        meta, cases = ev.harvest_searches(db, per_condition=args.per_condition)
    meta["harvested_at"] = datetime.now(timezone.utc).date().isoformat()
    ev.write_fixture(ev.SEARCHES_FIXTURE, SEARCHES_DESCRIPTION, meta, cases)
    print(
        json.dumps(meta, indent=2),
        f"\n{len(cases)} cases written to {ev.SEARCHES_FIXTURE}",
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="stage", required=True)
    p = sub.add_parser("pairs")
    p.add_argument("--run-dir", type=Path)
    p.add_argument("--show", type=int, default=40)
    p.add_argument(
        "--record-known",
        action="store_true",
        help="Write today's failures into the fixture as the regression floor",
    )
    p.set_defaults(func=pairs)
    s = sub.add_parser("search")
    s.add_argument("--run-dir", type=Path)
    s.add_argument("--limit", type=int, default=5)
    s.add_argument("--show", type=int, default=40)
    s.set_defaults(func=search)
    h = sub.add_parser("harvest-pairs")
    h.add_argument("--per-stratum", type=int, default=40)
    h.set_defaults(func=harvest_pairs)
    hs = sub.add_parser("harvest-searches")
    hs.add_argument("--per-condition", type=int, default=30)
    hs.set_defaults(func=harvest_searches)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
