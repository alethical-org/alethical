"""The money section's front door: one typed name, matched against 4 kinds of record.

Net: a reader types a name and gets back what that name **is** in these records -- a
sitting legislator, a registered committee, a name money was given under, or a name money
was paid to. Grouped by that, because the 4 lead to 4 different places and only 2 of them
have a page of their own.

**The match is exactly what was typed, and there is no did-you-mean here or anywhere
downstream of here.** Case-insensitive containment of the reader's string, nothing else:
no closest spelling, no similarity score, no "did you mean". This is not caution, it is
the measurement: 178 registered filer names sit a single character apart from another
registered name, and every one of those pairs is a different organisation -- the Green
Party and the Republican Party of the same district among them
([#1661](https://github.com/alethical-org/alethical/issues/1661)). A correction on this
data does not fix a typo, it silently swaps one organisation's money for another's, and
the reader has nothing on screen that could tell them. The rule lives in
``campaign_finance_register.name_contains``, which is imported rather than re-implemented
so a second copy cannot drift looser.

## Four groups, and why a person is only sometimes a person

* ``people`` -- the **200 sitting legislators**, and only them. A person is a result here
  only where we hold a record of them beyond these filings. Everyone else who appears on
  a filing resolves to what they filed, because a page about a donor would be a page
  about a *spelling* that still looks like a page about a human being
  (``docs/architecture/campaign-finance-system-design.md`` §5, and the campaign money IA).
* ``committees`` -- the register, which is the one group whose rows carry an identifier
  that survives a name change: a registration number.
* ``gave`` -- distinct names in the contributions download, with how many payments carry
  each. A private donor's name is searchable and is deliberately **not** a profile.
* ``got_paid`` and ``got_paid_independent`` -- distinct vendor names, from the
  expenditures download and the independent-expenditures download. **Two groups, never
  one row with one count.** They are 2 separate filings, and 491 rows of the independent
  file share a spender, vendor, amount and date with an expenditures row; whether that is
  one payment filed twice or two payments that coincide is not established, so a combined
  count would resolve it by inventing payments (``campaign_finance_payments``).

Every group is returned on every answer, in a fixed order, even when it is empty -- so a
caller can never read a missing group as "no matches" when it meant "we did not look".

**The employer column is deliberately not searched, and there is no group for it.** It is
free text a donor filled in, and its 4 commonest values in the live release are "Not
Employed" (67,342 rows), "Retired" (36,517), "Self employed Retired" (16,788) and
"Lawyer" (9,276). A search for "retired" returning a result row would present a status as
an entity somebody could open.

## Two things that are counted, and one that is capped

Each name row carries ``payment_count``: how many payments in that one download carry
that exact string. It is a count of records, never an amount, and it is never added
across groups.

Each group carries ``total``, the number of distinct names that matched. On the 3 name
groups that count is **exact up to ``COUNTED_UP_TO``** and ``None`` beyond it, with
``at_least`` saying how far the count got. A broad query genuinely matches thousands of
names, and a capped number printed as a total is a fabricated fact in the largest type on
the page (``.claude/rules/grounded-answers.md`` rule 11). ``None`` with an ``at_least``
beside it is the honest shape, and it is not the same as 0.

## Speed, and why the minimum length is 3

The 3 name columns carry indexes as of migration ``0040_cf_name_indexes``: 2 trigram
indexes for the substring match here, and 3 B-tree indexes for the exact-name lookups in
``campaign_finance_payments``. Measured on production before and after, warm: a donor-name
substring went from 431 ms to 5.7 ms, a vendor-name substring from 286 ms to 1.9 ms
([#1486](https://github.com/alethical-org/alethical/issues/1486)).

A trigram index cannot answer a query shorter than 3 characters -- there is no whole
trigram in "ab" to look up -- so a 1 or 2 character query would fall back to reading all
583,152 contribution rows, and would match tens of thousands of names on the way. Below
``MIN_QUERY_LENGTH`` the answer is ``unavailable`` with ``QUERY_TOO_SHORT``, which is a
served state rather than an error: the page says "type at least 3 characters", never
"nothing found", which would be a false claim about the records.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from alethical.api.services.campaign_finance_register import (
    CommitteeRow,
    CommitteesPage,
    committees,
    name_contains,
)
from alethical.api.services.committee_finance import NOT_REPORTED
from alethical.api.services.independent_spending import REPORTED, UNAVAILABLE
from alethical.db import models as schema

Dataset = schema.CampaignFinanceDataset

#: The shortest query the trigram indexes can answer. Below this the search would read
#: every row of a 583,152-row file and match tens of thousands of names.
MIN_QUERY_LENGTH = 3
#: How far a group's distinct-name count is carried before it gives up and says
#: ``at_least`` instead. Well above anything a page draws, and low enough that the
#: broadest realistic query stays under 25 ms.
COUNTED_UP_TO = 200
#: Rows per group at most. Screen B draws 5 per group and links out for the rest.
MAX_PER_GROUP = 50

#: The query is shorter than a trigram index can answer. Ours, not the reader's fault,
#: and never rendered as "nothing found".
QUERY_TOO_SHORT = "query_too_short"
#: No download release is published, so the 3 name groups have nothing to read.
NO_RELEASE = "no_release"
#: No legislative session is marked current, so there is no set of sitting members.
NO_CURRENT_SESSION = "no_current_legislative_session"

#: What the match is, served on every answer so a caller never has to assume, and so a
#: page can say in its own words that nothing was corrected.
MATCHED_ON = "substring_of_the_filed_name"

#: Group keys, in the order they are returned. Fixed rather than derived, because the
#: order is a reading order the page depends on: who this is, then what they registered,
#: then what they filed.
PEOPLE = "people"
COMMITTEES = "committees"
GAVE = "gave"
GOT_PAID = "got_paid"
GOT_PAID_INDEPENDENT = "got_paid_independent"

#: Which column of which download each name group reads, and the ``role`` a caller hands
#: straight back to ``/campaign-finance/payments-under-name`` to open that name's
#: payments. Kept in one place so a group and the role it opens cannot drift apart.
_NAME_GROUPS = (
    (
        GAVE,
        "contributor",
        Dataset.contributions,
        schema.CampaignFinanceContributionRow,
        schema.CampaignFinanceContributionRow.contributor,
    ),
    (
        GOT_PAID,
        "vendor",
        Dataset.expenditures,
        schema.CampaignFinanceExpenditureRow,
        schema.CampaignFinanceExpenditureRow.vendor_name,
    ),
    (
        GOT_PAID_INDEPENDENT,
        "independent_vendor",
        Dataset.independent_expenditures,
        schema.CampaignFinanceIndependentExpenditureRow,
        schema.CampaignFinanceIndependentExpenditureRow.vendor_name,
    ),
)


@dataclass(frozen=True)
class PersonResult:
    """One sitting legislator, the only kind of person that is a result here."""

    id: str
    slug: Optional[str]
    full_name: str
    chamber: Optional[str]
    district_code: Optional[str]
    party: Optional[str]


@dataclass(frozen=True)
class PaymentNameResult:
    """One printed name a payment was filed under, and how many carry it.

    ``payment_count`` counts records in **one** download, never across the 3. ``role`` is
    verbatim what ``/campaign-finance/payments-under-name`` takes, so a caller opens this
    name's payments without translating anything.

    The name is not an entity: no registration number, no page, and nothing here claims
    that 2 spellings are the same person or business.
    """

    name: str
    role: str
    payment_count: int


@dataclass(frozen=True)
class ResultGroup:
    """One group of results, with its own state so one gap cannot blank the others.

    ``total`` is the number of distinct matches. It is ``None`` when the count was
    capped, and ``at_least`` then says how far it got -- never a capped number wearing
    the word total. A ``total`` of 0 is a measured zero: we searched and nothing carried
    that string, which is a fact about the spelling and our records rather than about any
    person's giving.
    """

    kind: str
    state: str
    results: tuple[object, ...]
    total: Optional[int]
    at_least: Optional[int]
    has_more: bool
    reason: Optional[str]


@dataclass(frozen=True)
class SearchAnswer:
    """One search, pinned to the register and the release it read.

    Both are named because they are 2 separate copies of Minnesota's data taken by 2
    separate runs: the register behind ``committees``, the downloads behind the 3 name
    groups (``campaign_finance_register``). One date standing in for both would date half
    the answer wrongly.
    """

    state: str
    query: str
    matched_on: str
    min_query_length: int
    counted_up_to: int
    groups: tuple[ResultGroup, ...]
    as_of: Optional[date]
    snapshot_id: Optional[UUID]
    release_id: Optional[UUID]
    reason: Optional[str]


def _empty_group(kind: str, *, state: str, reason: Optional[str]) -> ResultGroup:
    """A group that could not be searched. Its total is ``None``, never 0."""
    return ResultGroup(
        kind=kind,
        state=state,
        results=(),
        total=None,
        at_least=None,
        has_more=False,
        reason=reason,
    )


def _too_short(query: str) -> SearchAnswer:
    return SearchAnswer(
        state=UNAVAILABLE,
        query=query,
        matched_on=MATCHED_ON,
        min_query_length=MIN_QUERY_LENGTH,
        counted_up_to=COUNTED_UP_TO,
        groups=tuple(
            _empty_group(kind, state=UNAVAILABLE, reason=QUERY_TOO_SHORT)
            for kind in (PEOPLE, COMMITTEES, GAVE, GOT_PAID, GOT_PAID_INDEPENDENT)
        ),
        as_of=None,
        snapshot_id=None,
        release_id=None,
        reason=QUERY_TOO_SHORT,
    )


def search(db: Session, release, *, query: str, limit: int) -> SearchAnswer:
    """Search one typed name across the 4 kinds of record, grouped by what each one is.

    ``release`` is the download release the caller already resolved and pinned, passed in
    rather than resolved again here: resolving twice inside one request is how a response
    ends up describing 2 different releases (``committee_finance.pin_to_one_view``).
    ``None`` is a real state on a fresh database and empties the 3 name groups with
    ``NO_RELEASE`` while the register and the legislators still answer.
    """
    typed = query.strip()
    if len(typed) < MIN_QUERY_LENGTH:
        return _too_short(query)
    # The same release the name groups read, so a committee's finer kind here and on
    # the committees list are read from one set of downloads rather than two.
    register = committees(db, limit=limit, offset=0, query=typed, release=release)
    groups = [
        _people_group(db, typed, limit=limit),
        _committees_group(register),
    ]
    for kind, role, dataset, model, column in _NAME_GROUPS:
        groups.append(
            _name_group(
                db,
                release,
                typed,
                limit=limit,
                kind=kind,
                role=role,
                dataset=dataset,
                model=model,
                column=column,
            )
        )
    return SearchAnswer(
        # The answer as a whole is reported whenever anything could be searched. Each
        # group carries its own state, so a missing release empties 3 groups rather than
        # refusing the register and the legislators alongside them.
        state=REPORTED,
        query=typed,
        matched_on=MATCHED_ON,
        min_query_length=MIN_QUERY_LENGTH,
        counted_up_to=COUNTED_UP_TO,
        groups=tuple(groups),
        as_of=register.as_of,
        snapshot_id=register.snapshot_id,
        release_id=getattr(release, "id", None),
        reason=None,
    )


def _committees_group(register: CommitteesPage) -> ResultGroup:
    """The register's own matches, reusing the committees list rather than re-querying.

    Same rows, same order, same matching rule as ``/campaign-finance/committees``, so the
    "see all N committees" link on the results page opens a list that agrees with the
    group it came from.
    """
    if register.state != REPORTED:
        return _empty_group(COMMITTEES, state=register.state, reason=register.reason)
    return ResultGroup(
        kind=COMMITTEES,
        state=REPORTED if register.committees else NOT_REPORTED,
        results=register.committees,
        total=register.total,
        at_least=None,
        has_more=register.has_more,
        reason=None,
    )


def _people_group(db: Session, typed: str, *, limit: int) -> ResultGroup:
    """Sitting legislators whose name contains what was typed.

    Filtered exactly as the legislator directory filters itself, including its exclusion
    of the placeholder ``-unknown`` districts, so a member findable here is a member the
    directory lists. Anyone who has left office is not a result: their money is still in
    the filings and reachable through the committee that filed it, but a person result
    promises a profile, and we hold one only for sitting members.
    """
    session_id = db.scalar(
        select(schema.LegislativeSession.id).where(
            schema.LegislativeSession.is_current.is_(True)
        )
    )
    if session_id is None:
        return _empty_group(PEOPLE, state=UNAVAILABLE, reason=NO_CURRENT_SESSION)
    legislator = schema.Legislator
    service = schema.LegislatorServicePeriod
    district = schema.District
    chamber = schema.Chamber
    # One row per person without deduplicating, because the database already guarantees
    # it: `uq_legislator_service_period_one_current` is unique on (legislator, session)
    # where `is_current`, and this query filters on both. A DISTINCT here would be
    # guarding a state the schema forbids.
    matched = (
        select(
            legislator.id.label("id"),
            legislator.slug.label("slug"),
            legislator.full_name.label("full_name"),
            legislator.sort_name.label("sort_name"),
            chamber.slug.label("chamber"),
            district.code.label("district_code"),
            service.party.label("party"),
        )
        .join(service, service.legislator_id == legislator.id)
        .join(district, district.id == service.district_id)
        .join(chamber, chamber.id == service.chamber_id)
        .where(
            service.session_id == session_id,
            service.is_current.is_(True),
            district.code.not_like("%-unknown"),
            name_contains(legislator.full_name, typed),
        )
        .subquery()
    )
    stmt = select(matched).order_by(matched.c.sort_name.asc(), matched.c.id.asc())
    total = db.scalar(select(func.count()).select_from(matched)) or 0
    rows = db.execute(stmt.limit(limit + 1)).all()
    return ResultGroup(
        kind=PEOPLE,
        state=REPORTED if rows else NOT_REPORTED,
        results=tuple(
            PersonResult(
                id=str(row.id),
                slug=row.slug,
                full_name=row.full_name,
                chamber=row.chamber,
                district_code=row.district_code,
                party=row.party,
            )
            for row in rows[:limit]
        ),
        total=total,
        at_least=None,
        has_more=len(rows) > limit,
        reason=None,
    )


def _name_group(
    db: Session,
    release,
    typed: str,
    *,
    limit: int,
    kind: str,
    role: str,
    dataset: Dataset,
    model,
    column,
) -> ResultGroup:
    """Distinct printed names in one download, with how many payments carry each.

    One download, never 2 added together (see this module's docstring). The rows are the
    distinct strings themselves, alphabetical, which is the only order that is both
    stable while a reader pages and free of any suggestion that one name matters more
    than another.
    """
    if release is None:
        return _empty_group(kind, state=UNAVAILABLE, reason=NO_RELEASE)
    snapshot_id = release.file_for(dataset).snapshot_id
    matches = (
        column.is_not(None),
        model.snapshot_id == snapshot_id,
        name_contains(column, typed),
    )
    rows = db.execute(
        select(column, func.count())
        .where(*matches)
        .group_by(column)
        .order_by(column.asc())
        .limit(limit + 1)
    ).all()
    # Counted through a bounded subquery rather than a plain COUNT(DISTINCT): a broad
    # query matches thousands of names and counting all of them costs a second of a
    # reader's time for a number no page prints. Fetching one past the cap is what tells
    # an exact total from a capped one.
    counted = (
        db.scalar(
            select(func.count()).select_from(
                select(column)
                .where(*matches)
                .distinct()
                .limit(COUNTED_UP_TO + 1)
                .subquery()
            )
        )
        or 0
    )
    capped = counted > COUNTED_UP_TO
    return ResultGroup(
        kind=kind,
        state=REPORTED if rows else NOT_REPORTED,
        results=tuple(
            PaymentNameResult(name=name, role=role, payment_count=count)
            for name, count in rows[:limit]
        ),
        total=None if capped else counted,
        at_least=COUNTED_UP_TO if capped else None,
        has_more=len(rows) > limit,
        reason=None,
    )


__all__ = [
    "COMMITTEES",
    "COUNTED_UP_TO",
    "CommitteeRow",
    "GAVE",
    "GOT_PAID",
    "GOT_PAID_INDEPENDENT",
    "MAX_PER_GROUP",
    "MIN_QUERY_LENGTH",
    "NO_RELEASE",
    "PEOPLE",
    "PaymentNameResult",
    "PersonResult",
    "QUERY_TOO_SHORT",
    "ResultGroup",
    "SearchAnswer",
    "search",
]
