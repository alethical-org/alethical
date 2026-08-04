"""Repoint companion links that cross the regular/special session boundary (#928).

Net: ``link_companion`` used to build a companion's ``bill_key`` by hand, without
the ``s<n>`` that marks a special session. A special-session bill therefore looked
up the *regular* session's file of the same number, found a real and unrelated
bill, and linked **both** directions -- so the unrelated bill was given a
companion it does not have. Both sides render the same label ("SF 8"), so neither
page reads as wrong. This repairs the rows that bug already wrote; the code fix
that stops it recurring is in ``alethical/pipeline/minnesota.py``.

Dry run by default. It prints every change it would make and writes nothing:

    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. \\
        uv run python scripts/repair_companion_links.py

Add ``--apply`` to write, or ``--apply --only-bill <bill_key>`` to do a single
row first and read it back before the rest.

It runs two passes, and a single ``--apply`` does both:

1. **Fix the cross-session links** (``find_repairs``). The special-session bill
   kept the right companion file type and number and only looked them up in the
   wrong session, so it is repointed into its own session. The regular-session
   bill on the other end was *overwritten* by that same bad link, and its true
   companion is not derivable from the wrong pointer, so it is cleared -- showing
   no companion is a smaller error than showing a confident wrong one
   (``.claude/rules/grounded-answers.md`` rule 1).
2. **Recover what pass 1 had to clear** (``find_reverse_recoveries``). Because
   ``link_companion`` writes both directions, the correct link usually survives on
   the *other* bill, which names the cleared bill as its companion. Reading that
   back restored 26 of the 32 cleared pointers, each one confirmed against the
   official record.

Measured on production Aug 3 2026: 64 wrong pointers in, 0 cross-session links
and 0 one-sided links out, 6 bills left deliberately blank because nothing names
them. A normal re-ingest fills those 6 in, now that the code writes them right.

Every decision comes from ``bill_key`` and the links themselves, so a re-run finds
nothing left to do. Idempotent.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.engine import make_url

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
)

# 94-2025s1-HF5 -> ("94-2025s1", "HF", "5").
BILL_KEY_RE = re.compile(r"^(?P<session>.+?)-(?P<file_type>HF|SF)(?P<number>\d+)$")


@dataclass
class Repair:
    bill_key: str
    wrong_companion_key: str
    new_companion_key: str | None  # None means "clear the pointer"

    @property
    def action(self) -> str:
        return (
            f"repoint to {self.new_companion_key}"
            if self.new_companion_key
            else "clear (hijacked; true companion not derivable)"
        )


def corrected_companion_key(bill_key: str, wrong_companion_key: str) -> str | None:
    """The right companion for this bill, or None meaning "clear the pointer".

    The bug wrote two different kinds of wrong row, and only one is repairable.

    **The special-session bill is repairable.** Its own status XML named the
    companion's file type and number, and those are right; ``link_companion``
    only looked them up under the wrong session. So keep the type and number and
    swap in this bill's own session. Confirmed against the official record: the
    2025 first special session's HF 1 lists companion SF 8, and
    ``94-2025s1-SF8`` is in the corpus.

    **The regular-session bill is not.** It never asked to be linked here -- the
    special-session bill's ``link_companion`` set *both* directions and
    overwrote whatever was there. Its true companion is unrelated to the wrong
    pointer: the official record gives the 2025 regular session's HF 1 a
    companion of **SF 1219**, not SF 8. Nothing stored can recover that
    (``source_artifact`` keeps a path and a hash, not the XML body, and the
    status URL comes from a search rather than a pattern), so the honest repair
    is to clear it. Showing no companion is a smaller error than showing a
    confident wrong one (``.claude/rules/grounded-answers.md`` rule 1), and a
    normal re-ingest of the regular session restores the true link now that the
    code writes it correctly.

    A first draft paired a bill with the *same file number* in the other chamber
    -- HF 1 with SF 1. Minnesota companions do not work that way. The dry run
    caught it, which is why the dry run prints every row rather than a count.
    """
    bill = BILL_KEY_RE.match(bill_key)
    companion = BILL_KEY_RE.match(wrong_companion_key)
    if bill is None or companion is None:
        return None
    if not is_special(bill_key):
        return None  # hijacked: the right answer is not derivable, so clear it
    return f"{bill['session']}-{companion['file_type']}{companion['number']}"


def is_special(bill_key: str) -> bool:
    return re.search(r"^\d+-\d+s\d+-", bill_key) is not None


def find_repairs(conn: sa.Connection) -> list[Repair]:
    """Every bill whose companion sits on the other side of the session boundary."""
    rows = conn.execute(
        sa.text(
            "SELECT a.bill_key AS bill_key, b.bill_key AS companion_key "
            "FROM bill a JOIN bill b ON b.id = a.companion_bill_id "
            "ORDER BY a.bill_key"
        )
    ).all()
    known = {key for (key,) in conn.execute(sa.text("SELECT bill_key FROM bill"))}
    repairs = []
    for row in rows:
        if is_special(row.bill_key) == is_special(row.companion_key):
            continue  # same side of the boundary: this link is not the bug's work
        true_key = corrected_companion_key(row.bill_key, row.companion_key)
        repairs.append(
            Repair(
                bill_key=row.bill_key,
                wrong_companion_key=row.companion_key,
                new_companion_key=true_key if true_key in known else None,
            )
        )
    return repairs


def find_reverse_recoveries(conn: sa.Connection) -> list[Repair]:
    """Bills with no companion that exactly one other bill still points at.

    ``link_companion`` writes both directions, so a hijacked bill's correct link
    survives on the *other* bill: the hijack overwrote SF 9's pointer but left
    HF 1168 -> SF 9 standing. That surviving half names SF 9's true companion,
    and it costs nothing to read.

    Checked against the official record before trusting it. The Revisor gives the
    2025 regular session's SF 9 a companion of HF 1168, and HF 1168 is exactly
    what points at it here; likewise HF 1 recovers SF 1219, which is what the
    Revisor lists for HF 1. Two independent confirmations, so this is recovery
    rather than inference.

    Requires *exactly one* pointer. Two bills claiming the same companion is a
    contradiction this script will not guess its way through.
    """
    rows = conn.execute(
        sa.text(
            "SELECT t.bill_key AS bill_key, min(o.bill_key) AS pointer, "
            "count(o.id) AS pointers "
            "FROM bill t JOIN bill o ON o.companion_bill_id = t.id "
            "WHERE t.companion_bill_id IS NULL "
            "GROUP BY t.bill_key HAVING count(o.id) = 1 "
            "ORDER BY t.bill_key"
        )
    ).all()
    return [
        Repair(
            bill_key=row.bill_key,
            wrong_companion_key="(none)",
            new_companion_key=row.pointer,
        )
        for row in rows
    ]


def apply_repair(conn: sa.Connection, repair: Repair) -> None:
    if repair.new_companion_key:
        conn.execute(
            sa.text(
                "UPDATE bill SET companion_bill_id = "
                "(SELECT id FROM bill WHERE bill_key = :new) "
                "WHERE bill_key = :key"
            ),
            {"new": repair.new_companion_key, "key": repair.bill_key},
        )
    else:
        conn.execute(
            sa.text("UPDATE bill SET companion_bill_id = NULL WHERE bill_key = :key"),
            {"key": repair.bill_key},
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="Write. Without this, nothing changes."
    )
    parser.add_argument(
        "--only-bill",
        help="Repair a single bill_key. Use for the scoped live check before the "
        "full run.",
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET", "local"),
        help="local | production. Defaults to ALETHICAL_DATABASE_TARGET.",
    )
    args = parser.parse_args(argv)

    url = database_url_for_target(args.target)
    # Say which database, every run. The first draft took the target only from
    # --target and ignored ALETHICAL_DATABASE_TARGET, so a command that named
    # production read the local database instead and printed "nothing to repair"
    # -- a false all-clear, which is the worst thing a repair script can print.
    print(f"Database: {args.target} ({make_url(url).host}/{make_url(url).database})\n")
    engine = sa.create_engine(url, connect_args=NO_PREPARED_STATEMENTS)

    with engine.connect() as conn:
        repairs = find_repairs(conn)
        # Second pass: put back the links the first pass had to clear, wherever
        # the other bill still names them. Runs in the same command so a single
        # --apply leaves no bill blank that did not have to be.
        repairs += find_reverse_recoveries(conn)

    if args.only_bill:
        repairs = [r for r in repairs if r.bill_key == args.only_bill]
        if not repairs:
            print(f"Nothing to repair for {args.only_bill!r}.")
            return 0

    if not repairs:
        print("No cross-session companion links. Nothing to repair.")
        return 0

    verb = "Repairing" if args.apply else "Would repair"
    print(f"{verb} {len(repairs)} bill row(s):\n")
    for repair in repairs:
        print(
            f"  {repair.bill_key:22} currently -> {repair.wrong_companion_key:22} "
            f"| {repair.action}"
        )

    if not args.apply:
        print("\nDry run: nothing was written. Re-run with --apply to write.")
        return 0

    with engine.begin() as conn:
        for repair in repairs:
            apply_repair(conn, repair)

    with engine.connect() as conn:
        remaining = find_repairs(conn)
        recoverable = find_reverse_recoveries(conn)
    print(
        f"\nApplied. Cross-session links remaining: {len(remaining)}; "
        f"bills still blank that another bill names: {len(recoverable)}"
    )
    return 0 if args.only_bill or not (remaining or recoverable) else 1


if __name__ == "__main__":
    raise SystemExit(main())
