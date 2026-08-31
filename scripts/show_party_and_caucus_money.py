#!/usr/bin/env python3
"""Print the money in and out of Minnesota's state parties and caucuses (#1330).

Reads the published campaign-finance release and writes nothing, ever. Safe against
production, which is where the real rows are.

    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. \\
      uv run python scripts/show_party_and_caucus_money.py --target production

    # a single filer, and every transfer it reported
    ... --target production --reg-num 20010 --transfers

    # a different pair of years
    ... --target production --years 2023 2024

Which filers it covers: the ones the Board's own files classify as a state party unit
(``SPU``) or a legislative caucus committee (``CAU``). Nothing here is a hardcoded list
of registration numbers, and nothing matches on a name — 12 filers whose names contain
"Caucus" are political committees and funds rather than caucuses.

**Two numbers per year, because one of them alone is misleading.** "Money in" is the
sum of the itemized rows the Board published, and it is never a filer's true total:
Minnesota names a donor only once their giving passes $200 in aggregate within the
calendar year, and everything below that appears as one unnamed lump. "Reported by the
filer" is that filer's own figure from its filed report, stored by
[#1408](https://github.com/alethical-org/alethical/issues/1408). The gap between them
is legitimate small-donor money rather than a gap in our data, and #1408 measured it at
roughly 4 dollars in every 10, so printing only the first understates every committee
while looking authoritative (`.claude/rules/grounded-answers.md` rule 12 and
`docs/architecture/campaign-finance-system-design.md` §7, Display rules).

Money in and money out are each split by the source's own labels rather than summed
into one figure, because the labels mean different things and because filtering to any
one of them silently drops a whole kind of filer: in 2025 candidate committees filed
6,762 rows typed ``Campaign Expenditure`` and none typed ``General Expenditure``, and
party units filed 7,524 the other way round.

Transfers are separate facts and never a chain. That a party paid a caucus and the
caucus later paid a candidate are 2 documented payments; that the same dollars
travelled between them is not something any filing establishes, so nothing here
relates one transfer to another (`.claude/rules/grounded-answers.md` rule 12).
"""

from __future__ import annotations

import argparse
import sys
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from alethical.db.session import database_url_for_target
from alethical.pipeline import campaign_finance_reader as reader

DEFAULT_YEARS = (2025, 2026)


def money(value: Decimal) -> str:
    return f"${value:,.2f}"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Show the money in and out of Minnesota's state parties and "
        "caucuses. Reads only; never writes."
    )
    parser.add_argument(
        "--target",
        default="local",
        choices=("local", "production"),
        help="which database to read (default: local)",
    )
    parser.add_argument(
        "--years",
        type=int,
        nargs="+",
        default=list(DEFAULT_YEARS),
        help="filing years to cover (default: 2025 2026)",
    )
    parser.add_argument(
        "--reg-num",
        action="append",
        default=None,
        help="limit to these registration numbers; repeatable",
    )
    parser.add_argument(
        "--transfers",
        action="store_true",
        help="also list every transfer each filer reported, one line per payment",
    )
    return parser.parse_args(argv)


def chosen_filers(
    db: Session, release: reader.Release, args: argparse.Namespace
) -> list[reader.Filer]:
    filers = reader.party_units_and_caucuses(db, release)
    if args.reg_num:
        wanted = set(args.reg_num)
        filers = [filer for filer in filers if filer.reg_num in wanted]
        missing = wanted - {filer.reg_num for filer in filers}
        for reg_num in sorted(missing):
            print(
                f"note: {reg_num} is not a state party unit or caucus committee in "
                "this release, so it is skipped."
            )
    return filers


def describe(filer: reader.Filer) -> str:
    if filer.is_caucus:
        return "legislative caucus committee"
    if filer.is_state_party:
        return "state party unit"
    return "party unit"


def report(db: Session, release: reader.Release, args: argparse.Namespace) -> int:
    filers = chosen_filers(db, release, args)
    if not filers:
        print("No filers matched.")
        return 1

    years = list(args.years)
    print(f"Release {release.id}, files fetched {release.fetched_at.isoformat()}")
    print(
        "That fetch date is when we downloaded the files. It is not the period any "
        "figure covers: the period is per filer and always earlier."
    )
    print(
        f"Filing years: {', '.join(str(year) for year in years)}. "
        f"{len(filers)} filer(s)."
    )
    print(
        "Each year shows 2 different numbers. 'Money in' is the payments the Board "
        "named, which is never a filer's whole income. 'Reported by the filer' is "
        "that filer's own figure from its filed report. The gap between them is "
        "money from donors who gave $200 or less in total for the year, whom "
        "Minnesota never names."
    )

    for filer in filers:
        print()
        print("=" * 78)
        print(f"{filer.name}  ({filer.reg_num}, {describe(filer)})")
        print(
            f"  the Board files this number as {filer.kind}"
            + (f"/{filer.subkind}" if filer.subkind else "")
            + f", rows from {filer.first_year} to {filer.last_year}"
        )

        incoming = reader.money_in(db, release, filer.reg_num, years)
        outgoing = reader.money_out(db, release, filer.reg_num, years)
        independent = reader.independent_spending_by(db, release, filer.reg_num, years)
        reported = reader.reported_contributions(db, filer.reg_num, years)

        for year in years:
            print(f"  {year}")
            entry = next((row for row in incoming if row.year == year), None)
            if entry is None:
                print(
                    "    money in: not reported. This download names no payment to "
                    "this filer for this year, which is not the same as a filed zero."
                )
            else:
                print(
                    f"    money in: {money(entry.contributions.total)} across "
                    f"{entry.contributions.rows:,} named contributions"
                )
                for bucket in entry.other_receipts:
                    print(
                        f"      excluded from that figure: {bucket.rows:,} row(s) "
                        f"typed {bucket.label!r}, {money(bucket.total)}. The filing "
                        "reports these on separate schedules, outside its "
                        "contribution totals."
                    )

            _print_reported(reported, entry, year)

            spent = next((row for row in outgoing if row.year == year), None)
            if spent is None:
                print(
                    "    money out: not reported. Same caveat as above; absence is "
                    "not a zero."
                )
            else:
                print(
                    f"    money out: {money(spent.total)} across {spent.rows:,} "
                    "reported payments, by the filing's own label:"
                )
                for bucket in spent.by_label:
                    tail = (
                        "  (the only label that names who received the money)"
                        if bucket.label == reader.TRANSFER_EXPENDITURE_TYPE
                        else ""
                    )
                    print(
                        f"      {bucket.label}: {money(bucket.total)} across "
                        f"{bucket.rows:,} row(s){tail}"
                    )

            for row in (item for item in independent if item.year == year):
                print(
                    f"    independent spending, stance {row.stance!r}: "
                    f"{money(row.total)} across {row.rows:,} row(s)"
                )

        resolution = reader.resolve_payees(db, release, filer.reg_num, years)
        if resolution.payee_reg_nums:
            print(
                f"  payees: {len(resolution.payee_reg_nums)} registration number(s) "
                f"paid, {len(resolution.unresolved)} of which do not appear as a "
                "filer in this release"
            )
            if resolution.unresolved:
                print(f"    unresolved: {', '.join(resolution.unresolved)}")
            if resolution.rows_without_a_payee_number:
                print(
                    f"    {resolution.rows_without_a_payee_number} transfer row(s) "
                    "name no payee registration number at all"
                )
            if resolution.directory_checked:
                print(
                    f"    against the Board's registered-filer directory: "
                    f"{len(resolution.absent_from_directory)} absent"
                    + (
                        f" ({', '.join(resolution.absent_from_directory)})"
                        if resolution.absent_from_directory
                        else ""
                    )
                )
            else:
                print(
                    "    the Board's registered-filer directory was NOT checked, "
                    "because no filings snapshot is published here. Load one with "
                    "just load-campaign-finance-filings."
                )

        if args.transfers:
            _print_transfers(db, release, filer, years)

    return 0


def _print_reported(
    reported: list[reader.ReportedContributions],
    itemized: reader.MoneyIn | None,
    year: int,
) -> None:
    """The second of rule 12's two numbers, and what the gap between them means."""
    entry = next((row for row in reported if row.year == year), None)
    if entry is None:
        print(
            "    reported by the filer: not reported. Either no filed report is "
            "stored for this year, or none is published. That is a fact about us, "
            "not about the filer."
        )
        return
    through = (
        f", covering through {entry.reported_through.isoformat()}"
        if entry.reported_through
        else ", and the filing does not state the period it covers"
    )
    print(f"    reported by the filer: {money(entry.total)}{through}")
    if not entry.comparable:
        print(
            "      the Board's totals route cannot speak for this year, because this "
            "filer also filed a special-election series it does not return. Do not "
            "compare the 2 figures here."
        )
        return
    if itemized is not None:
        gap = entry.total - itemized.contributions.total
        print(
            f"      the 2 figures differ by {money(gap)}. That is money from donors "
            "who gave $200 or less in total for the year, whom Minnesota never "
            "names. It is not an error and not missing data."
        )


def _print_transfers(
    db: Session, release: reader.Release, filer: reader.Filer, years: list[int]
) -> None:
    source = release.expenditures.source_url
    outgoing = reader.transfers_from(db, release, filer.reg_num, years)
    incoming = reader.transfers_to(db, release, filer.reg_num, years)
    print()
    print(
        f"  Transfers, each a separate reported payment. Nothing below connects one "
        f"payment to another. Source for every line: record N of {source}"
    )
    print(f"  paid out ({len(outgoing)}):")
    for transfer in outgoing:
        print(
            f"    {transfer.paid_on}  {money(transfer.amount):>16}  "
            f"to {transfer.payee_name or '(unnamed)'} ({transfer.payee_reg_num})  "
            f"{transfer.label}  record {transfer.row_number}"
        )
    print(f"  received ({len(incoming)}):")
    for transfer in incoming:
        print(
            f"    {transfer.paid_on}  {money(transfer.amount):>16}  "
            f"from {transfer.payer_name or '(unnamed)'} "
            f"({transfer.payer_reg_num})  {transfer.label}  "
            f"record {transfer.row_number}"
        )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    engine = create_engine(database_url_for_target(args.target))
    with Session(engine) as db:
        release = reader.live_release(db)
        if release is None:
            print(
                "No campaign-finance release is published in this database. Load one "
                "with scripts/load_campaign_finance.py."
            )
            return 1
        return report(db, release, args)


if __name__ == "__main__":
    sys.exit(main())
