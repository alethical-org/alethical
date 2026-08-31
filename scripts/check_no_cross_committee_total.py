"""Fail the build if the app tries to add a person's campaign committees together.

Some candidates run more than one campaign committee. When they close one and open
another, the leftover money is transferred, and Minnesota records that transfer exactly
as it records a donation: a ``Contribution`` from the old committee to the new one. So
the same dollars sit in both committees' figures, correctly, and a combined figure
counts them twice. Measured on the live release and recorded on
`#1663 <https://github.com/alethical-org/alethical/issues/1663>`_: 9 candidates, 30
payments, $121,241.64, and for Diane Napper in 2026 and Frank Pafko in 2026 **every
dollar** a combined figure would show is the same money twice.

The backend cannot do it at all: every figure on a legislator's profile is a
``CommitteeAmount`` tagged with the committee that reported it, and adding 2 of them
raises (``alethical/api/services/committee_amount.py``). The frontend has no such
mechanism -- the figures arrive as plain strings -- so this check is the frontend's
half, and it stops the one step a combined figure cannot skip: turning 2 committees'
amounts into numbers.

**What it checks**, in the app files that handle a legislator's committee money:

1. Turning one of the tagged money fields into a number by any of the usual routes.
   The only sanctioned conversion is ``isAmountAboveZero`` in
   ``apps/frontend/src/lib/legislatorCampaignMoney.ts``, which takes 1 amount and
   returns a boolean, so it cannot be used to build a total.
2. Folding the committee list into a single value with ``reduce``.

**What it does not check.** It reads text rather than a parsed program, so it is a
guard against writing the summing code, not a proof that no total can exist. The
backend guard is the one that cannot be talked around; this one makes the frontend
attempt fail in CI on the day it is written.

Pure stdlib, so the ``changes`` job can run it on every event.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

FRONTEND_SOURCE = Path("apps/frontend/src")

#: The files this check reads: anything naming one of the 2 shapes that carry *several*
#: of one person's committees. Chosen so a new file handling this data is covered the
#: moment it is written, rather than needing to be added to a list here.
#:
#: Deliberately not "imports the legislator-money module": a committee's own page
#: (``screens/redesign/CommitteeMoneyScreen.tsx``) imports the same formatters and shows
#: exactly 1 committee, whose figure is correct and out of scope. Marking it would make
#: this check fire on work it has no business stopping, which is how a guard gets
#: switched off.
IN_SCOPE_MARKERS = (
    "CampaignCommitteeMoney",
    "LegislatorCampaignMoney",
)

#: The money fields a combined figure would be built from, exactly as
#: ``apps/frontend/src/data/types.ts`` names them on ``CampaignCommitteeMoney``.
AMOUNT_FIELDS = (
    "itemizedContributionTotal",
    "itemizedPaymentTotal",
    "reportedTotal",
    "namedTotal",
    "namedCashTotal",
    "namedInKindTotal",
    "unnamedTotal",
)

#: The file that decides what the tab may say. Always read, whether or not it names
#: the shapes above, and exempt from rule 1 alone: it owns the one sanctioned
#: conversion, ``isAmountAboveZero``, which takes 1 amount and returns a boolean and so
#: can build no total. Rule 2 still applies to it.
CONVERSION_OWNER = FRONTEND_SOURCE / "lib" / "legislatorCampaignMoney.ts"

_FIELDS = "|".join(AMOUNT_FIELDS)
#: ``Number(x.namedTotal)``, ``parseFloat(split.reportedTotal)``, ``+committee.…``.
#: The argument may be a longer expression, so the field name is looked for anywhere
#: before the closing bracket rather than immediately inside it.
NUMERIC_CALL = re.compile(
    rf"\b(?:Number|parseFloat|parseInt)\s*\([^)\n]*\b(?:{_FIELDS})\b"
)
UNARY_PLUS = re.compile(rf"(?<![\w)\]+])\+\s*[\w.\[\]']*\b(?:{_FIELDS})\b")
#: ``money.committees.reduce(…)`` and a bare ``committees.reduce(…)`` on a parameter,
#: including across a line break.
COMMITTEES_REDUCE = re.compile(r"\bcommittees\b[\s\S]{0,80}?\.reduce\s*\(")

ADD_THEM_UP = (
    "adds a person's campaign committees together. Money moved between a person's own "
    "committees is reported by both of them, so a combined figure counts it twice "
    "(#1663). Show each committee's figure on its own line."
)


def violations(root: Path = FRONTEND_SOURCE) -> list[str]:
    """Every place the app converts or folds a committee money figure, as messages."""
    found: list[str] = []
    for path in sorted(root.rglob("*.ts")) + sorted(root.rglob("*.tsx")):
        text = path.read_text(encoding="utf-8")
        in_scope = path == CONVERSION_OWNER or any(
            marker in text for marker in IN_SCOPE_MARKERS
        )
        if not in_scope:
            continue
        if path != CONVERSION_OWNER:
            for pattern in (NUMERIC_CALL, UNARY_PLUS):
                for match in pattern.finditer(text):
                    line = text.count("\n", 0, match.start()) + 1
                    found.append(
                        f"{path}:{line}: turns a committee's money figure into a "
                        f"number. Use isAmountAboveZero from "
                        f"lib/legislatorCampaignMoney.ts for one amount; anything "
                        f"that needs 2 {ADD_THEM_UP}"
                    )
        for match in COMMITTEES_REDUCE.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            found.append(
                f"{path}:{line}: folds the committee list into one value, which {ADD_THEM_UP}"
            )
    return found


def main() -> int:
    if not FRONTEND_SOURCE.is_dir():
        print(f"{FRONTEND_SOURCE} not found; run this from the repository root")
        return 1
    found = violations()
    if found:
        print("A person's campaign committees may never be added together (#1663):")
        for message in found:
            print(f"  {message}")
        return 1
    print("No surface adds a person's campaign committees together.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
