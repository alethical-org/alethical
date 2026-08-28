"""A money figure that refuses to be added to another committee's ([#1663]).

Some candidates run more than one campaign committee, usually because they moved
between offices or started a new run. When they close one and open another, the
leftover money is transferred, and Minnesota records that transfer exactly as it
records a donation: a ``Contribution``, from the old committee to the new one.

So the same dollars sit in our records twice, correctly. Once as money **out** of the
first committee, and once as money **in** to the second, inside its itemized
contribution total. Each committee's own figure is right. The double count appears
only if somebody adds them.

Measured on the live release and recorded on [#1663]: **9 candidates, 30 payments,
$121,241.64** moved between committees the same person controls. For Diane Napper in
2026 and Frank Pafko in 2026 the moved amount is **100.0%** of what a combined figure
would show, so a combined figure for either would be entirely the same money counted
twice, under a named person's photograph.

Nothing shipped adds them. This module exists so that nothing can: a figure carried on
a legislator's profile knows which committee filed it, and adding 2 of them raises
``CrossCommitteeTotal`` instead of returning a number. A page that sums a person's
committees therefore fails the moment it is written, rather than publishing a figure
that looks right.

**Scope is money a person's own committees reported.** Independent spending is a
different file and is deliberately summed across a person's committees
(``alethical/api/services/independent_spending.py``): every row of
``cf_independent_expenditure_row`` names exactly 1 affected committee, and a transfer
between a person's own committees never appears in that file at all, so no dollar
there can land in 2 of one person's committees. Do not copy this guard onto it.

Rules: ``.claude/rules/grounded-answers.md`` rule 12 (two numbers, and never a chain)
and ``docs/architecture/campaign-finance-system-design.md`` §7 (Display rules).

[#1663]: https://github.com/alethical-org/alethical/issues/1663
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any


class CrossCommitteeTotal(Exception):
    """Two committees' money figures were combined into one.

    Deliberately not a ``TypeError``: a bare ``except TypeError`` around arithmetic is
    ordinary defensive code, and it would swallow the one signal this guard exists to
    send.
    """


class CommitteeAmount(Decimal):
    """A money figure that knows which committee reported it.

    Behaves as a ``Decimal`` everywhere except in one place: adding or subtracting it
    from another committee's figure raises. Arithmetic against a plain number, and
    against another figure from the *same* committee, is untouched, which is what
    keeps a single committee's own split working.

    ``sum()`` is covered by both directions. It starts at ``0``, so the first step is
    ``0 + amount`` and lands in ``__radd__``, which passes because ``0`` names no
    committee; the second step is one committee's figure plus another's, which raises.
    """

    #: The Minnesota registration number of the committee that reported this figure.
    registration_number: str

    def __new__(cls, value: Decimal | int | str, registration_number: str) -> Any:
        amount = super().__new__(cls, value)
        amount.registration_number = registration_number
        return amount

    def _refuse_another_committee(self, other: object) -> None:
        if (
            isinstance(other, CommitteeAmount)
            and other.registration_number != self.registration_number
        ):
            raise CrossCommitteeTotal(
                "refusing to combine campaign money from committee "
                f"{self.registration_number} with committee "
                f"{other.registration_number}: they can be the same person's, and "
                "money moved between a person's own committees is reported by both, "
                "so a combined figure counts it twice (#1663). Show each committee's "
                "figure on its own line instead."
            )

    def _same_committee(self, result: object) -> Any:
        if result is NotImplemented or not isinstance(result, Decimal):
            return result
        return CommitteeAmount(result, self.registration_number)

    def __add__(self, other: object) -> Any:
        self._refuse_another_committee(other)
        return self._same_committee(super().__add__(other))  # type: ignore[arg-type]

    def __radd__(self, other: object) -> Any:
        self._refuse_another_committee(other)
        return self._same_committee(super().__radd__(other))  # type: ignore[arg-type]

    def __sub__(self, other: object) -> Any:
        self._refuse_another_committee(other)
        return self._same_committee(super().__sub__(other))  # type: ignore[arg-type]

    def __rsub__(self, other: object) -> Any:
        self._refuse_another_committee(other)
        return self._same_committee(super().__rsub__(other))  # type: ignore[arg-type]


def reported_by(registration_number: str, value: Decimal | None) -> Decimal | None:
    """Tag one figure with the committee that reported it, passing ``None`` through.

    ``None`` stays ``None`` because a missing figure and a zero are different facts
    (rule 12), and wrapping absence in anything would be the first step to printing it.
    """
    if value is None:
        return None
    return CommitteeAmount(value, registration_number)
