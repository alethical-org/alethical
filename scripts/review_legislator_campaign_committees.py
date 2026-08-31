#!/usr/bin/env python3
"""Review and confirm which Minnesota committee belongs to which legislator (#1354).

Minnesota gives every registered filer a registration number but never links it to a
person. `docs/architecture/campaign-finance-system-design.md` §5 (Identity) therefore
forbids linking one automatically: **a candidate joins an Alethical legislator only
through a link a person has checked.** Attaching the wrong committee publishes someone
else's money under a legislator's name, which is the worst error this product can make, so
this script proposes and a person decides. Nothing here writes a link without a keystroke.

Four commands, of which one writes:

    # what the proposer found, and how much of the roster it narrowed down. Writes nothing.
    ... coverage --contributions /path/to/contributions.csv

    # the full proposal list with the evidence behind each one. Writes nothing.
    ... propose --contributions /path/to/contributions.csv

    # confirm or reject. The only command that writes.
    ... review --contributions ...          # one at a time
    ... review --batch --contributions ...  # uncontested as one list

    # re-check every confirmed link against both sources. Writes nothing; exits non-zero
    # if any link now contradicts them. Run after each campaign-finance load.
    ... verify --contributions /path/to/contributions.csv

    # rewrite the generated half of the public audit record. Writes 1 file, no database.
    ... record --contributions /path/to/contributions.csv

``--batch`` is for a single sitting: it prints every uncontested proposal with its evidence,
takes the numbers of any to hold back, and writes the rest only after the reviewer types the
word ``confirm``. Contested ones stay one at a time, because that is where reading the
alternatives is the point.

Getting the file: ``--download`` resolves the contributions "All" link from the Board's
landing page and fetches it. The link is resolved from the page every time rather than
hardcoded, per `campaign-finance-system-design.md` §2.1 (Campaign finance) — the download
numbers are **signed and negative**, and a stale number returns HTTP 200 with a 39 KB HTML
error page, so the header line is checked before the file is used.

Which database: one, for both halves. A link is a legislator's id plus a registration
number, and an id only means anything in the database that holds that legislator — so
reading production's roster while writing locally produces rows that point at nobody, and
the foreign key rejects them one at a time. ``--target`` therefore picks both, and
``coverage`` and ``propose`` are safe against ``production`` because neither writes.

``review`` against ``production`` writes there, one row per keystroke. That is the
intended path: production holds the real 200 sitting members, so it is where a real
confirmed link belongs.
"""

from __future__ import annotations

import argparse
import csv
import html
import os
import pathlib
import re
import sys
from dataclasses import dataclass
from datetime import date

import requests
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.legislator_committee_match import (
    CommitteeRecord,
    ConfirmedLink,
    FilerRecord,
    FilerVerdict,
    LegislatorProposals,
    Proposal,
    ProposalTier,
    RosterMember,
    coverage_counts,
    propose_all,
    read_contributions_csv,
    recheck_confirmed_links,
)

CONTRIBUTIONS_LANDING_PAGE = (
    "https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/"
)
CONTRIBUTIONS_DATASET_HEADING = "itemized contributions received of over $200"
CONTRIBUTIONS_HEADER_LINE = (
    '"Recipient reg num",Recipient,"Recipient type","Recipient subtype",Amount,'
    '"Receipt date",Year,Contributor,"Contrib Reg Num","Contrib type","Receipt type",'
    '"In kind?","In-kind descr","Contrib zip","Contrib Employer name"'
)
TIMEOUT_SECONDS = 300
USER_AGENT = "Alethical Campaign Committee Review/0.1 (+https://alethical.com)"

FILER_DIRECTORY_URL = "https://cfb.mn.gov/reports/api/"
FILER_DIRECTORY_FORM = {
    "action": "grid_data",
    "data[action]": "all-registered-candidates",
    "data[type]": "current-lists",
    # Omitting this returns the JSON literal `false` rather than an error, so it is not
    # optional and its absence is a silent failure (§9.7).
    "data[params][0]": "all",
}


def fetch_filer_directory() -> dict[str, FilerRecord]:
    """Fetch the Board's registered-filer directory, keyed by registration number (§9.7).

    Three ways this call fails quietly, all measured and all guarded here rather than
    trusted:

    * **A ``PHPSESSID`` cookie is required and its value is never checked.** Without one the
      server answers 403 with an Apache error page. An empty value works.
    * **Omitting ``data[params][0]=all`` returns the JSON literal ``false``**, not an error,
      and a GET with the same parameters returns HTTP 200 and ``[]``. So the response's
      shape is checked, not its status code.
    * The payload is a dict of ``cols`` plus ``data`` keyed by registration number, with each
      value a *list* of rows, not a flat array.
    """
    response = requests.post(
        FILER_DIRECTORY_URL,
        data=FILER_DIRECTORY_FORM,
        headers={"User-Agent": USER_AGENT, "Cookie": "PHPSESSID="},
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or "cols" not in payload or "data" not in payload:
        raise RuntimeError(
            "The filer directory did not return its usual shape, so it cannot be trusted. "
            f"Got {type(payload).__name__}: {str(payload)[:120]!r}"
        )
    columns = payload["cols"]
    directory: dict[str, FilerRecord] = {}
    for group in payload["data"].values():
        for raw in group:
            row = dict(zip(columns, raw))
            registration = (row.get("RegisteredEntityID") or "").strip()
            if not registration:
                continue
            directory[registration] = FilerRecord(
                registration_number=registration,
                committee_name=row.get("RegisteredEntityFullName") or "",
                candidate_name=row.get("CandidateFullName") or "",
                office=row.get("OfficeSoughtFullName") or None,
                district=row.get("District") or None,
                party=row.get("Party") or None,
                is_incumbent=row.get("Incumbent") == "1",
                is_terminated=bool(row.get("TerminationDate")),
            )
    print(f"read {len(directory):,} registered filers from the Board", file=sys.stderr)
    return directory


def resolve_contributions_download_url(session: requests.Session) -> str:
    """Find the contributions "All" download on the Board's landing page.

    Resolved from the page's own labels — the ``<h1>`` naming the dataset and the row whose
    first cell reads "All" — rather than from a position or a saved number. The number is
    matched as ``-?\\d+`` because all 3 of the numbers we want are negative, and a pattern
    that drops the minus sign silently resolves a different file.
    """
    response = session.get(CONTRIBUTIONS_LANDING_PAGE, timeout=60)
    response.raise_for_status()
    for section in re.split(r"<h1[^>]*>", response.text)[1:]:
        heading, _, body = section.partition("</h1>")
        if (
            CONTRIBUTIONS_DATASET_HEADING
            not in html.unescape(re.sub(r"<[^>]+>", "", heading)).strip().lower()
        ):
            continue
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
            cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
            if not cells:
                continue
            category = html.unescape(re.sub(r"<[^>]+>", " ", cells[0])).strip().lower()
            link = re.search(r'href="([^"]*\?download=-?\d+)"', row)
            if category == "all" and link:
                return requests.compat.urljoin(
                    CONTRIBUTIONS_LANDING_PAGE, html.unescape(link.group(1))
                )
    raise RuntimeError(
        "Could not find the contributions 'All' download on "
        f"{CONTRIBUTIONS_LANDING_PAGE}. The page's labels may have changed; resolve the "
        "link by hand and pass --contributions."
    )


def download_contributions(destination: str) -> str:
    """Fetch the contributions file and prove it is the file, not an error page.

    Nothing in the response says it arrived complete: there is no ``Content-Length``, the
    body is chunked, and a stale download number returns HTTP 200 with an HTML error page
    typed ``application/octet-stream``. So the two checks §2.1 names are done here — the
    ``Content-Disposition`` filename and the exact header line.
    """
    http = requests.Session()
    http.headers["User-Agent"] = USER_AGENT
    url = resolve_contributions_download_url(http)
    print(f"resolved download: {url}", file=sys.stderr)

    response = http.get(url, timeout=TIMEOUT_SECONDS, stream=True)
    response.raise_for_status()
    disposition = response.headers.get("Content-Disposition", "")
    if "Itemized Contributions Received" not in disposition:
        raise RuntimeError(
            "The download did not name the contributions file "
            f"(Content-Disposition: {disposition!r}). Refusing to use it."
        )
    with open(destination, "wb") as handle:
        for chunk in response.iter_content(chunk_size=1 << 20):
            handle.write(chunk)

    with open(destination, encoding="utf-8-sig") as handle:
        first_line = handle.readline().rstrip("\r\n")
    if first_line != CONTRIBUTIONS_HEADER_LINE:
        raise RuntimeError(
            "The downloaded file's first line is not the expected column header, so it is "
            f"not the contributions file. Got: {first_line[:120]!r}"
        )
    print(
        f"downloaded {os.path.getsize(destination):,} bytes to {destination}",
        file=sys.stderr,
    )
    return destination


@dataclass(frozen=True)
class Roster:
    members: list[RosterMember]
    current_years: tuple[str, ...]


def read_roster(database_url: str) -> Roster:
    """Read the sitting legislators, and the years their session covers.

    Written against production's actual columns rather than the models: production's
    schema differs from ``main`` in places, and ``district`` is keyed ``code`` there.
    Reading with a plain select of named columns keeps that difference from turning into a
    wrong query.
    """
    engine = create_engine(
        normalize_database_url(database_url),
        echo=False,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    with Session(engine) as session:
        rows = session.execute(
            select(
                schema.Legislator.id,
                schema.Legislator.full_name,
                schema.Legislator.first_name,
                schema.Legislator.last_name,
                schema.Chamber.slug,
                schema.District.code,
                schema.LegislatorServicePeriod.party,
                schema.LegislativeSession.year_start,
                schema.LegislativeSession.year_end,
            )
            .join(
                schema.LegislatorServicePeriod,
                schema.LegislatorServicePeriod.legislator_id == schema.Legislator.id,
            )
            .join(
                schema.Chamber,
                schema.Chamber.id == schema.LegislatorServicePeriod.chamber_id,
            )
            .join(
                schema.District,
                schema.District.id == schema.LegislatorServicePeriod.district_id,
            )
            .join(
                schema.LegislativeSession,
                schema.LegislativeSession.id
                == schema.LegislatorServicePeriod.session_id,
            )
            .where(schema.LegislatorServicePeriod.is_current.is_(True))
            .order_by(schema.Chamber.slug, schema.Legislator.sort_name)
        ).all()

    # Only the bounds, because ``_years_overlap`` compares against the earliest and latest
    # and nothing reads the years between. Keeping it to two values also means a session
    # record with an implausible end year (the local sample data carries year_end 2904)
    # produces two strings rather than nine hundred.
    years: set[str] = set()
    members = []
    for row in rows:
        members.append(
            RosterMember(
                legislator_id=str(row.id),
                full_name=row.full_name,
                chamber_slug=row.slug,
                first_name=row.first_name,
                last_name=row.last_name,
                district=row.code,
                party=row.party,
            )
        )
        if row.year_start and row.year_end:
            years.update({str(row.year_start), str(row.year_end)})
    return Roster(members=members, current_years=tuple(sorted(years)))


def describe(proposal: Proposal) -> str:
    parts = [
        f"{proposal.committee.registration_number}  {proposal.committee.name}",
        f"      years {proposal.committee.first_year}-{proposal.committee.last_year}"
        f"   contribution rows {proposal.committee.contribution_rows}"
        f"   name evidence: {proposal.given_name_evidence.value}",
    ]
    if proposal.party_of_party_unit_money:
        # Three states, not two. ``party_agrees`` is None when we hold no party for this
        # legislator, and printing that as a disagreement would tell the reviewer something
        # false at the exact moment they are deciding -- the failure this whole review flow
        # exists to prevent.
        agreement = {
            True: "agrees with our record",
            False: "DISAGREES with our record",
        }.get(proposal.party_agrees, "we hold no party for this legislator to compare")
        parts.append(
            f"      party units giving to it are "
            f"{proposal.party_of_party_unit_money} ({agreement})"
        )
    # What the Board's own directory says about this committee's seat. Worth its own line
    # because it is the strongest evidence on the screen when it is present, and the reviewer
    # should be able to see that it was absent rather than assume it agreed.
    parts.append(
        "      Board's filer directory: "
        + {
            FilerVerdict.same_seat.value: "registered for this member's own seat and party, "
            "and flagged as its current holder",
            FilerVerdict.same_seat_not_current.value: "registered for this member's seat and "
            "party, but not flagged as its current holder -- could be a predecessor",
            FilerVerdict.different_race.value: "registered for a different office",
            FilerVerdict.different_person.value: "registered to a different seat or party",
            FilerVerdict.unknown.value: "not listed, which says nothing either way",
        }[proposal.filer_verdict]
    )
    for reason in proposal.reasons:
        parts.append(f"      needs a look: {reason}")
    return "\n".join(parts)


def load_existing_decisions(session: Session) -> dict[tuple[str, str], str]:
    """What a person has already answered, or nothing if the table is not there yet.

    `coverage` and `propose` are the two commands worth running against production before
    this table's migration has been deployed there, and both only read. Treating a missing
    table as "no decisions yet" is true, so they answer instead of crashing. `review` writes,
    so it is left to fail loudly rather than silently reviewing into nowhere.
    """
    if not inspect(session.get_bind()).has_table(
        schema.LegislatorCampaignCommittee.__tablename__
    ):
        print(
            "note: this database has no legislator_campaign_committee table yet, so no "
            "link has been confirmed anywhere in it.",
            file=sys.stderr,
        )
        return {}
    return {
        (str(row.legislator_id), row.registration_number): row.decision.value
        for row in session.scalars(select(schema.LegislatorCampaignCommittee)).all()
    }


def print_coverage(
    results: list[LegislatorProposals], decisions: dict[tuple[str, str], str]
) -> None:
    counts = coverage_counts(results)
    confirmed_legislators = {
        legislator_id
        for (legislator_id, _), decision in decisions.items()
        if decision == "confirmed"
    }
    confirmed_links = sum(1 for value in decisions.values() if value == "confirmed")
    rejected_links = sum(1 for value in decisions.values() if value == "rejected")

    print("What a person has actually checked")
    print(
        f"  legislators with at least one confirmed committee: {len(confirmed_legislators)}"
    )
    print(f"  confirmed links: {confirmed_links}")
    print(f"  rejected proposals recorded: {rejected_links}")
    print()
    print(
        f"What the proposer narrowed down, across {counts['total']} sitting legislators"
    )
    print(
        f"  matched    (one committee proposed, nothing competing): {counts['matched']}"
    )
    print(
        f"  ambiguous  (more than one plausible, or a soft signal): {counts['ambiguous']}"
    )
    print(
        f"  unmatched  (no committee proposed at all):              {counts['unmatched']}"
    )
    print()
    print(
        "A 'matched' count is not a link count. Nothing above the first block is linked."
    )

    unresolved = [
        result
        for result in results
        if result.member.legislator_id not in confirmed_legislators
    ]
    if unresolved:
        print()
        print(f"Still unresolved: {len(unresolved)} legislators, with the reason")
        for result in unresolved:
            hidden = (
                f"  [{result.suppressed_surname_only} stale namesakes not shown]"
                if result.suppressed_surname_only
                else ""
            )
            print(
                f"  {result.member.full_name} "
                f"({result.member.chamber_slug} {result.member.district}) "
                f"-- {result.unresolved_reason}{hidden}"
            )


def print_proposals(
    results: list[LegislatorProposals], decisions: dict[tuple[str, str], str]
) -> None:
    for result in results:
        print(
            f"\n{result.member.full_name} "
            f"({result.member.chamber_slug} {result.member.district} "
            f"{result.member.party}) -- {result.outcome}"
        )
        if not result.proposals:
            print(f"  nothing proposed: {result.unresolved_reason}")
            continue
        for proposal in result.proposals:
            already = decisions.get(
                (result.member.legislator_id, proposal.committee.registration_number)
            )
            marker = {"confirmed": "[confirmed]", "rejected": "[rejected]"}.get(
                already, f"[{proposal.tier.value}]"
            )
            print(f"  {marker} {describe(proposal)}")
        if result.suppressed_surname_only:
            print(
                f"  ({result.suppressed_surname_only} more committees share the surname "
                "but have no contributions in the current session's years)"
            )


def link_row(
    member: RosterMember,
    proposal: Proposal,
    reviewer: str,
    *,
    confirmed: bool,
    note: str | None,
    records_through: str | None,
) -> schema.LegislatorCampaignCommittee:
    """Build one decision row. The single place a link is constructed, in either flow.

    Records the basis as well as the choice. The ``_as_reviewed`` name, office and years
    say which committee was picked; the 3 signal columns say why, and
    ``records_through_as_reviewed`` says from which snapshot. The screen is gone when a
    sitting ends and the Board's download changes daily, so a decision's basis is either
    written here as it is made or lost.
    """
    return schema.LegislatorCampaignCommittee(
        legislator_id=member.legislator_id,
        registration_number=proposal.committee.registration_number,
        decision=(
            schema.CommitteeLinkReviewDecision.confirmed
            if confirmed
            else schema.CommitteeLinkReviewDecision.rejected
        ),
        committee_name_as_reviewed=proposal.committee.name,
        office_as_reviewed=proposal.parsed.office,
        first_year_as_reviewed=proposal.committee.first_year,
        last_year_as_reviewed=proposal.committee.last_year,
        reviewed_by=reviewer,
        evidence=note,
        name_evidence_as_reviewed=proposal.given_name_evidence.value,
        filer_directory_as_reviewed=proposal.filer_verdict,
        party_agreement_as_reviewed=party_agreement_as_reviewed(proposal),
        records_through_as_reviewed=records_through,
    )


# Who a decision is recorded against. The company, not the individual who typed the
# keystroke: Alethical, LLC is the entity accountable for the match, and it is the entity a
# reader is told checked it, so the stored value and the published one are the same words
# (Eugene, 31 Aug 2026). The tradeoff is real and accepted: the row no longer says which
# human answered, so if 2 people ever hold sittings the record cannot say which of them to
# ask about one decision. ``--reviewer`` still overrides, for the day that matters.
REVIEWER_OF_RECORD = "Alethical, LLC"


PARTY_AGREEMENT_AGREES = "agrees"
PARTY_AGREEMENT_DISAGREES = "disagrees"
PARTY_AGREEMENT_NO_PARTY_ON_RECORD = "no_party_on_record"
PARTY_AGREEMENT_NO_PARTY_MONEY = "no_party_money"


def party_agreement_as_reviewed(proposal: Proposal) -> str:
    """Which of the 4 party-money states this proposal was in, as the screen showed it.

    Four, not two. ``party_agrees`` is False only when party money exists and names the
    other party; it is None both when no party unit has ever paid this committee and when
    we hold no party for the legislator, and those 2 are different facts about different
    sides of the comparison. Collapsing them would record "we could not compare" as though
    it said something about the committee.
    """
    if proposal.party_of_party_unit_money is None:
        return PARTY_AGREEMENT_NO_PARTY_MONEY
    if proposal.party_agrees is True:
        return PARTY_AGREEMENT_AGREES
    if proposal.party_agrees is False:
        return PARTY_AGREEMENT_DISAGREES
    return PARTY_AGREEMENT_NO_PARTY_ON_RECORD


def newest_receipt_date(path: str) -> str | None:
    """The newest payment date in this download, as ``YYYY-MM-DD``.

    Stored on every decision so an auditor knows which snapshot would reproduce it: any
    download carrying data through this date holds the rows the decision rested on. A date
    rather than a file name or a hash, because a hash identifies a file nobody else has and
    a name identifies nothing at all.

    Its own pass over the file, on purpose. The shared reader
    (``read_contributions_csv``) has a second caller in the campaign-finance pipeline, and
    widening its return value to carry a fact only this script needs would change that
    caller for nothing. One extra read of a column costs a few seconds, once per sitting.

    Read as text and compared as text: the Board writes ``YYYY-MM-DD``, so string order is
    date order, and parsing would only add a way to fail on a row we could otherwise skip.
    """
    newest: str | None = None
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as handle:
        for row in csv.DictReader(handle):
            value = (row.get("Receipt date") or "").strip()[:10]
            if len(value) == 10 and value[4] == "-" and value[7] == "-":
                if newest is None or value > newest:
                    newest = value
    return newest


DIRECTORY_IN_BRIEF: dict[str, str] = {
    FilerVerdict.same_seat.value: "Board confirms seat",
    FilerVerdict.same_seat_not_current.value: "Board has this seat and party, not flagged current",
    FilerVerdict.different_race.value: "Board registers it for another office",
    FilerVerdict.different_person.value: "Board registers it to another seat or party",
    FilerVerdict.unknown.value: "not in Board directory",
}


def name_words(value: str | None) -> set[str]:
    """The name words in a value, lowercased, with punctuation and hyphens as spaces.

    Hyphens matter: the Board writes "Momanyi Hiltsley, Huldah Nyamisa" for a member our
    roster holds as "Huldah Momanyi-Hiltsley", so a comparison that keeps the hyphen reads a
    real match as a different person. Single letters are dropped, because an initial
    separates nobody.
    """
    cleaned = re.sub(r"[^a-z ]+", " ", (value or "").lower())
    return {word for word in cleaned.split() if len(word) > 1}


def register_names_this_member(member: RosterMember, filer: FilerRecord | None) -> bool:
    """Whether the Board's own row for this account names this member as its candidate.

    The one check ``compare_to_filer_directory`` never makes. That function decides
    ``different_race`` from the office alone and returns before the candidate name is read,
    which is right for its purpose and leaves the strongest available fact unused: the row
    carries ``CandidateFullName``. Measured across the 37 other-office accounts the
    contested group holds, the Board names the same member on 9 and a different person on
    the rest -- Angie Hanson against Jessica Hanson, Keri Heintzeman against Josh
    Heintzeman, Mark T Johnson and Cherie Johnson against Pete and Wayne Johnson, Erin
    Murphy against Tom Murphy.

    Surname and at least one further given-name word, both required. A surname alone is what
    put those strangers on the list in the first place.
    """
    if filer is None or not filer.candidate_name:
        return False
    surname = name_words(filer.candidate_name.split(",")[0])
    member_surname = name_words(member.last_name or member.full_name.split()[-1])
    if not surname or surname != member_surname:
        return False
    given = name_words(filer.candidate_name) - surname
    member_given = name_words(member.full_name) - member_surname
    return bool(given & member_given)


#: One batchable group: its key, the title, the single stated reason every row shares, and
#: whether answering the group means the account is theirs or is somebody else's.
GROUPS: tuple[tuple[str, str, str, bool], ...] = (
    (
        "own_seat",
        "The Board registers this account for this member's own seat and party",
        "and flags them as its current holder, which is the state making the link rather "
        "than us inferring it",
        True,
    ),
    (
        "own_other_office",
        "The Board registers this account to this member under another office",
        "naming the same candidate, so it is their own run for something else",
        True,
    ),
    (
        "another_person",
        "The Board registers this account to a different named candidate",
        "so it reached this list on a shared surname alone",
        False,
    ),
)


def group_of(
    member: RosterMember, proposal: Proposal, filer: FilerRecord | None
) -> str | None:
    """Which batchable group a contested proposal falls in, or None for one at a time.

    Deliberately narrow. A group exists only where every row in it shares **one** stated
    fact from the Board's own register, so reading the list is checking that one fact 52
    times rather than weighing alternatives. Everything the register cannot speak to -- a
    dormant account it does not list, a member whose seat it never names -- falls through to
    the one-at-a-time pass, where the alternatives are the point.
    """
    if proposal.filer_verdict == FilerVerdict.same_seat.value:
        return "own_seat"
    if proposal.filer_verdict in {
        FilerVerdict.different_race.value,
        FilerVerdict.different_person.value,
    }:
        if register_names_this_member(member, filer):
            return "own_other_office"
        return "another_person"
    return None


def run_grouped_review(
    results: list[LegislatorProposals],
    session: Session,
    reviewer: str,
    records_through: str | None,
    filers_by_registration: dict[str, FilerRecord],
) -> int:
    """Answer the contested proposals in groups that share one stated reason.

    The one-at-a-time pass exists because contested cases need their alternatives read.
    That is true of the cases the Board's register cannot speak to, and not true of the ones
    it can: where the register names exactly one account for a member's own seat, the
    alternatives are demonstrably other people's accounts, and reading them one at a time is
    the same single check 52 times. Measured on the 56 contested legislators, the register
    settles 52 of them.

    Same safety as the uncontested batch, for the same reason: the whole group is printed
    with its evidence, any row can be held back by number, the word ``confirm`` has to be
    typed, and nothing is written before that. A held-back row joins the one-at-a-time pass.
    """
    decisions = load_existing_decisions(session)
    pending: dict[str, list[tuple[LegislatorProposals, Proposal]]] = {
        key: [] for key, _, _, _ in GROUPS
    }
    for result in results:
        if result.outcome != "ambiguous":
            continue
        for proposal in result.proposals:
            if (
                result.member.legislator_id,
                proposal.committee.registration_number,
            ) in decisions:
                continue
            key = group_of(
                result.member,
                proposal,
                filers_by_registration.get(proposal.committee.registration_number),
            )
            if key:
                pending[key].append((result, proposal))

    written = 0
    for key, title, because, confirms in GROUPS:
        rows = pending[key]
        if not rows:
            continue
        verb = "confirmed as theirs" if confirms else "rejected as somebody else's"
        print()
        print(f"=== {title} ===")
        print(f"    {because}.")
        print(
            f"    {len(rows)} accounts, all {verb} together. Each line is the legislator, "
            "the account, and what the Board's own row says."
        )
        print()
        for index, (result, proposal) in enumerate(rows, start=1):
            filer = filers_by_registration.get(proposal.committee.registration_number)
            board = (
                f"Board: {filer.candidate_name!r} for {filer.office or '(no office)'} "
                f"{filer.district or ''} {filer.party or ''}".rstrip()
                if filer
                else "Board: not in the register"
            )
            print(
                f"{index:4}. {result.member.full_name} "
                f"({result.member.chamber_slug} {result.member.district} "
                f"{result.member.party})"
            )
            print(
                f"       {proposal.committee.registration_number}  "
                f"{proposal.committee.name}  "
                f"({proposal.committee.first_year}-{proposal.committee.last_year})"
            )
            print(f"       {board}")
        print()
        print(f"Type 'confirm' to record all {len(rows)} as {verb} by {reviewer}.")
        print("To hold some back for the one-at-a-time pass, list their numbers first.")
        held: set[int] = set()
        while True:
            answer = (
                input("  numbers to hold back, or 'confirm', or 'quit': ")
                .strip()
                .lower()
            )
            if answer.startswith("q"):
                print(f"\nstopped. {written} decisions written.")
                return written
            if answer == "confirm":
                break
            numbers = {int(part) for part in answer.split() if part.isdigit()}
            unknown = {n for n in numbers if not 1 <= n <= len(rows)}
            if unknown or not numbers:
                print(f"  did not understand that. Expected numbers 1 to {len(rows)}.")
                continue
            held |= numbers
            print(
                f"  holding back {len(held)}: {sorted(held)}. "
                f"{len(rows) - len(held)} left."
            )
        note = (
            input("  What did you check, for the record? (optional): ").strip() or None
        )
        for index, (result, proposal) in enumerate(rows, start=1):
            if index in held:
                continue
            session.add(
                link_row(
                    result.member,
                    proposal,
                    reviewer,
                    confirmed=confirms,
                    note=note,
                    records_through=records_through,
                )
            )
            session.commit()
            written += 1
        print(f"  recorded {len(rows) - len(held)}.")
    if written == 0:
        print("nothing is left that a shared reason can answer.")
    print(f"\ndone. {written} decisions written.")
    return written


def run_batch_review(
    results: list[LegislatorProposals],
    session: Session,
    reviewer: str,
    records_through: str | None,
) -> int:
    """Confirm the uncontested proposals as one reviewed list, in a single sitting.

    Only proposals where nothing competes and every signal is source-stated are eligible, so
    a reader of this list is checking names against seats rather than weighing alternatives.
    Everything else stays one question at a time, because that is where the alternatives are
    the point.

    This is still a person confirming, not a bulk write. The whole list is printed with its
    evidence, the reviewer has to type the word ``confirm`` rather than press a key, and any
    row they name is dropped from the batch and left for the one-at-a-time pass. Nothing is
    written until then.
    """
    decisions = load_existing_decisions(session)
    eligible = [
        (result, result.proposals[0])
        for result in results
        if result.outcome == "matched"
        and (
            result.member.legislator_id,
            result.proposals[0].committee.registration_number,
        )
        not in decisions
    ]
    if not eligible:
        print("nothing uncontested is left to confirm.")
        return 0

    print(
        f"{len(eligible)} legislators have one committee proposed with nothing competing.\n"
        "Each line is the legislator, then the committee, then what the evidence rests on.\n"
    )
    for index, (result, proposal) in enumerate(eligible, start=1):
        seat = f"{result.member.chamber_slug} {result.member.district}"
        # Every verdict gets its own words. Collapsing the other 4 into "not in Board
        # directory" understated the strongest evidence on the screen: a committee the Board
        # registers for this member's own seat and party, merely without flagging them as its
        # current holder, read to a reviewer as absent from the directory altogether. It
        # fires on 0 of the 144 uncontested proposals today, and the case it is wrong about
        # -- a special-election winner, or a lagging incumbent flag -- is exactly the one a
        # reviewer needs the truth on.
        directory = DIRECTORY_IN_BRIEF[proposal.filer_verdict]
        party = (
            f", party money {proposal.party_of_party_unit_money} agrees"
            if proposal.party_agrees
            else ""
        )
        print(
            f"{index:4}. {result.member.full_name} ({seat} {result.member.party})\n"
            f"       {proposal.committee.registration_number}  {proposal.committee.name}\n"
            f"       {proposal.given_name_evidence.value} name, {directory}{party}"
        )

    print(
        f"\nType 'confirm' to record all {len(eligible)} as checked by {reviewer}.\n"
        "To hold some back, list their numbers first (e.g. '7 12 40'), then confirm the rest."
    )
    held: set[int] = set()
    while True:
        answer = (
            input("  numbers to hold back, or 'confirm', or 'quit': ").strip().lower()
        )
        if answer.startswith("q"):
            print("\nstopped. 0 decisions written.")
            return 0
        if answer == "confirm":
            break
        numbers = {int(part) for part in answer.split() if part.isdigit()}
        unknown = {n for n in numbers if not 1 <= n <= len(eligible)}
        if unknown or not numbers:
            print(f"  did not understand that. Expected numbers 1 to {len(eligible)}.")
            continue
        held |= numbers
        print(
            f"  holding back {len(held)}: {sorted(held)}. {len(eligible) - len(held)} left."
        )

    note = input("  What did you check, for the record? (optional): ").strip() or None
    written = 0
    for index, (result, proposal) in enumerate(eligible, start=1):
        if index in held:
            continue
        session.add(
            link_row(
                result.member,
                proposal,
                reviewer,
                confirmed=True,
                note=note,
                records_through=records_through,
            )
        )
        written += 1
    session.commit()
    print(
        f"\nconfirmed {written} links. {len(held)} held back for the one-at-a-time pass."
    )
    return written


def run_verify(
    session: Session,
    members: list[RosterMember],
    committees: list[CommitteeRecord],
    *,
    party_by_registration: dict[str, str],
    filers_by_registration: dict[str, FilerRecord],
) -> int:
    """Re-check every confirmed link against both sources. Writes nothing; exits non-zero.

    The answer to "should a second person confirm the ambiguous ones". Two people reading
    one committee name share the whole of their evidence and so share its mistakes. What is
    independent of the reviewer is the Board's registered-filer directory and which party's
    units pay the committee, and this compares every confirmed link against both, plus
    against the committee's own published name, which can change between downloads.

    Run it after each campaign-finance load, since the data is already in hand there. It
    reports rather than repairs: a contradiction wants a person's eyes, and deleting a link
    somebody made would be the same overreach in the other direction.
    """
    if not inspect(session.get_bind()).has_table(
        schema.LegislatorCampaignCommittee.__tablename__
    ):
        print("no legislator_campaign_committee table here, so no link to re-check.")
        return 0
    rows = session.scalars(
        select(schema.LegislatorCampaignCommittee).where(
            schema.LegislatorCampaignCommittee.decision
            == schema.CommitteeLinkReviewDecision.confirmed
        )
    ).all()
    if not rows:
        print("no confirmed links yet, so there is nothing to re-check.")
        return 0

    problems = recheck_confirmed_links(
        [
            ConfirmedLink(
                legislator_id=str(row.legislator_id),
                registration_number=row.registration_number,
                committee_name_as_reviewed=row.committee_name_as_reviewed,
                reviewed_by=row.reviewed_by,
            )
            for row in rows
        ],
        {member.legislator_id: member for member in members},
        {committee.registration_number: committee for committee in committees},
        party_by_registration=party_by_registration,
        filers_by_registration=filers_by_registration,
    )
    print(f"re-checked {len(rows)} confirmed links against both sources.")
    if not problems:
        print(
            "every one still agrees with the Board's directory and its own donations."
        )
        return 0
    print(f"\n{len(problems)} need a person to look again:\n")
    names = {member.legislator_id: member.full_name for member in members}
    for link, problem in problems:
        who = names.get(link.legislator_id, link.legislator_id)
        print(
            f"  {who} -- {link.registration_number} {link.committee_name_as_reviewed!r}"
        )
        print(f"      {problem}")
        print(f"      confirmed by {link.reviewed_by}")
    return 1


def run_review(
    results: list[LegislatorProposals],
    session: Session,
    reviewer: str,
    only_tier: ProposalTier | None,
    records_through: str | None,
) -> int:
    """Ask about each proposal and write only what the reviewer confirms or rejects.

    One question per proposal, answered ``y`` / ``n`` / ``s`` / ``q``. A confirmation
    records who answered, when, what name they read, and any note they typed. Rejections
    are written too, so the same wrong suggestion is not offered again and so "checked, not
    theirs" stays distinguishable from "nobody has looked".
    """
    decisions = load_existing_decisions(session)
    written = 0
    for result in results:
        pending = [
            proposal
            for proposal in result.proposals
            if (result.member.legislator_id, proposal.committee.registration_number)
            not in decisions
            and (only_tier is None or proposal.tier is only_tier)
        ]
        if not pending:
            continue
        print(
            f"\n=== {result.member.full_name} "
            f"({result.member.chamber_slug} {result.member.district} "
            f"{result.member.party}) -- {result.outcome} ==="
        )
        if result.suppressed_surname_only:
            print(
                f"    note: {result.suppressed_surname_only} further committees share this "
                "surname but have no contributions in the current session's years"
            )
        # Say what was discarded and on whose authority, so a reviewer can catch the rule
        # being wrong rather than only ever seeing what survived it.
        for committee, filer in result.ruled_out_by_directory:
            print(
                f"    ruled out: {committee.name!r} -- the Board registers it for "
                f"{filer.office} {filer.district or '(no district)'} {filer.party}, "
                f"candidate {filer.candidate_name!r}"
            )
        for proposal in pending:
            print(f"\n  [{proposal.tier.value}] {describe(proposal)}")
            answer = (
                input(
                    "  Is this committee this legislator's? [y]es / [n]o / [s]kip / [q]uit: "
                )
                .strip()
                .lower()
            )
            if answer.startswith("q"):
                print(f"\nstopped. {written} decisions written.")
                return written
            if not answer.startswith(("y", "n")):
                continue
            note = input("  What did you check? (optional): ").strip() or None
            session.add(
                link_row(
                    result.member,
                    proposal,
                    reviewer,
                    confirmed=answer.startswith("y"),
                    note=note,
                    records_through=records_through,
                )
            )
            session.commit()
            decisions[
                (result.member.legislator_id, proposal.committee.registration_number)
            ] = "confirmed" if answer.startswith("y") else "rejected"
            written += 1
    print(f"\ndone. {written} decisions written.")
    return written


AUDIT_RECORD_PATH = (
    "docs/operations/how-a-legislator-is-matched-to-their-campaign-account.md"
)
GENERATED_OPENS = (
    "<!-- generated by review_legislator_campaign_committees.py record -->"
)
GENERATED_CLOSES = "<!-- end generated -->"

#: The strongest evidence a proposal can carry: the filed name matches exactly, the Board's
#: own register confirms this member's seat and party, and the party money agrees. A case in
#: this shape has nothing for a reader to scrutinise, so the record gives it as a count.
STRONGEST = ("exact", FilerVerdict.same_seat.value, PARTY_AGREEMENT_AGREES)

NAME_EVIDENCE_IN_WORDS = {
    "exact": "matches exactly",
    "shortened": "is a shortened form",
    "published_nickname": "is a nickname the state prints",
    "surname_only": "shares only the last name",
}
DIRECTORY_IN_WORDS = {
    FilerVerdict.same_seat.value: "confirms this seat and party",
    FilerVerdict.same_seat_not_current.value: "has this seat and party, not flagged current",
    FilerVerdict.different_race.value: "registers it for another office",
    FilerVerdict.different_person.value: "registers it to another seat or party",
    FilerVerdict.unknown.value: "does not list the account",
}
PARTY_IN_WORDS = {
    PARTY_AGREEMENT_AGREES: "agrees",
    PARTY_AGREEMENT_DISAGREES: "names the other party",
    PARTY_AGREEMENT_NO_PARTY_ON_RECORD: "cannot be compared, no party on our record",
    PARTY_AGREEMENT_NO_PARTY_MONEY: "none has ever come in",
}


def _basis(proposal: Proposal) -> tuple[str, str, str]:
    return (
        proposal.given_name_evidence.value,
        proposal.filer_verdict,
        party_agreement_as_reviewed(proposal),
    )


def closing_dates(registration_numbers: list[str]) -> dict[str, str]:
    """Each account's closing date from our copy of the Board's filer list, as text.

    Its own connection and its own query rather than a parameter threaded through the
    proposer: the registered-*candidates* directory the proposer reads carries only current
    filers, so a closed committee is absent from it by definition and its closing date can
    only come from the broader filer snapshot we store.

    A missing row is a missing key, never an empty string. "We hold no closing date" and
    "the registration is open" are different facts and the record words them differently.
    """
    if not registration_numbers:
        return {}
    engine = create_engine(
        normalize_database_url(database_url_for_target("production")),
        echo=False,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    with Session(engine) as session:
        rows = session.execute(
            select(
                schema.CampaignFinanceFiler.registration_number,
                schema.CampaignFinanceFiler.termination_date,
            ).where(
                schema.CampaignFinanceFiler.registration_number.in_(
                    registration_numbers
                )
            )
        ).all()
    return {row[0]: row[1].isoformat() for row in rows if row[1] is not None}


def write_audit_record(
    results: list[LegislatorProposals],
    decisions: dict[tuple[str, str], str],
    *,
    path: str,
    records_through: str | None,
    read_on: str,
) -> None:
    """Rewrite the generated half of the public audit record.

    Generated rather than typed, because half of what an audit needs moves: a count is
    wrong the hour after a sitting, and a hand-kept table nobody trusts is worse than none.
    The prose around the markers is written by hand and never touched here.

    What it names and what it counts is a deliberate split. Every case whose evidence is
    weaker than ``STRONGEST`` is named, because those are the ones worth an outsider's
    scrutiny; the strongest are given as a count with 1 example, because there is nothing
    in them to scrutinise. The full per-legislator record is in the database either way,
    and the prose says how to read it.

    Every hard case is worded as a fact about a record, never as a doubt about a person:
    "the Board's register does not list account 18472", never "we are unsure about X".
    """
    counts = coverage_counts(results)
    confirmed_links = sum(1 for value in decisions.values() if value == "confirmed")
    rejected_links = sum(1 for value in decisions.values() if value == "rejected")
    confirmed_legislators = {
        legislator_id
        for (legislator_id, _), decision in decisions.items()
        if decision == "confirmed"
    }

    matched = [r for r in results if r.outcome == "matched"]
    ambiguous = [r for r in results if r.outcome == "ambiguous"]
    unmatched = [r for r in results if r.outcome == "unmatched"]

    lines: list[str] = [GENERATED_OPENS, ""]
    lines.append(
        f"Read on {read_on} from a contributions download reaching "
        f"{records_through or 'an unknown date'}, against "
        f"{counts['total']} sitting legislators."
    )
    lines.append("")
    lines.append("| What | How many |")
    lines.append("| --- | --- |")
    lines.append(f"| Sitting legislators | {counts['total']} |")
    lines.append(
        f"| Matches a person has confirmed | {confirmed_links} "
        f"(covering {len(confirmed_legislators)} legislators) |"
    )
    lines.append(f"| Proposals a person has rejected | {rejected_links} |")
    lines.append(f"| One account proposed, nothing competing | {len(matched)} |")
    lines.append(f"| More than one account in play | {len(ambiguous)} |")
    lines.append(f"| No account proposed at all | {len(unmatched)} |")
    lines.append("")

    strongest = [r for r in matched if _basis(r.proposals[0]) == STRONGEST]
    weaker = [r for r in matched if _basis(r.proposals[0]) != STRONGEST]
    lines.append(f"## The {len(matched)} with one account and nothing competing")
    lines.append("")
    if strongest:
        example = strongest[0]
        lines.append(
            f"**{len(strongest)} carry the strongest evidence there is**: the filed name "
            f"matches exactly, the Board's own register confirms the member's seat and "
            f"party, and the party money agrees. Nothing in that shape is open to "
            f"argument, so they are a count here rather than {len(strongest)} rows. "
            f"{example.member.full_name} "
            f"({example.member.chamber_slug} {example.member.district}), account "
            f"{example.proposals[0].committee.registration_number}, is one of them."
        )
        lines.append("")
    if weaker:
        lines.append(
            f"**{len(weaker)} are weaker in exactly one way each, and every one is named "
            f"here.** No case among them carries a signal that contradicts the match; a "
            f"missing signal and a conflicting signal are different things, and a "
            f"conflicting one sends a case to the group below instead."
        )
        lines.append("")
        lines.append(
            "| Legislator | Seat | Account | Filed name | Board's register | Party money |"
        )
        lines.append("| --- | --- | --- | --- | --- | --- |")
        for r in sorted(weaker, key=lambda row: row.member.full_name):
            name_ev, verdict, party = _basis(r.proposals[0])
            lines.append(
                f"| {r.member.full_name} "
                f"| {r.member.chamber_slug} {r.member.district} "
                f"| {r.proposals[0].committee.registration_number} "
                f"| {NAME_EVIDENCE_IN_WORDS.get(name_ev, name_ev)} "
                f"| {DIRECTORY_IN_WORDS.get(verdict, verdict)} "
                f"| {PARTY_IN_WORDS.get(party, party)} |"
            )
        lines.append("")

    # An account absent from the register is the weakest single case on the page, and the
    # reason matters more than the absence: a closed registration drops out of a list of
    # *current* candidates, which is an explanation rather than a hole in our data. Left
    # unexplained, a reader concludes the second.
    absent = [
        r for r in matched if r.proposals[0].filer_verdict == FilerVerdict.unknown.value
    ]
    if absent:
        closing = closing_dates(
            [r.proposals[0].committee.registration_number for r in absent]
        )
        lines.append("### Why an account can be missing from the state's register")
        lines.append("")
        lines.append(
            "The register lists *current* candidates, so a committee that has closed "
            "drops out of it. Where Minnesota's own filer record gives a closing date, "
            "the absence is explained and is not a gap in our data."
        )
        lines.append("")
        for r in sorted(absent, key=lambda row: row.member.full_name):
            registration = r.proposals[0].committee.registration_number
            closed_on = closing.get(registration)
            if closed_on:
                lines.append(
                    f"- **{r.member.full_name}** "
                    f"({r.member.chamber_slug} {r.member.district}), account "
                    f"{registration}: Minnesota's filer record shows the registration "
                    f"closed on {closed_on}, which is why the register of current "
                    f"candidates does not list it."
                )
            else:
                lines.append(
                    f"- **{r.member.full_name}** "
                    f"({r.member.chamber_slug} {r.member.district}), account "
                    f"{registration}: we hold no closing date for it, so why the "
                    f"register does not list it is unexplained. The match rests on the "
                    f"filed name and the party money alone."
                )
        lines.append("")

    lines.append(f"## The {len(ambiguous)} where more than one account is in play")
    lines.append("")
    if ambiguous:
        ruled_out = sum(len(r.ruled_out_by_directory) for r in ambiguous)
        with_ruled_out = sum(1 for r in ambiguous if r.ruled_out_by_directory)
        lines.append(
            f"These are not unidentified people. Almost every one is a member holding "
            f"more than one account of their own, so the question is which to show. "
            f"Between them they carry "
            f"{sum(len(r.proposals) for r in ambiguous)} accounts. The Board's own "
            f"register had already removed {ruled_out} wrong accounts across "
            f"{with_ruled_out} of them before any person read a line, so the narrowing "
            f"is Minnesota's records rather than our judgement."
        )
        lines.append("")
        lines.append(
            "| Legislator | Seat | Accounts in play | Why each needs a person |"
        )
        lines.append("| --- | --- | --- | --- |")
        for r in sorted(ambiguous, key=lambda row: row.member.full_name):
            reasons: list[str] = []
            for proposal in r.proposals:
                for reason in proposal.reasons:
                    if reason not in reasons:
                        reasons.append(reason)
            lines.append(
                f"| {r.member.full_name} "
                f"| {r.member.chamber_slug} {r.member.district} "
                f"| {len(r.proposals)} "
                f"| {'; '.join(reasons) or 'more than one account of their own'} |"
            )
        lines.append("")

    lines.append(GENERATED_CLOSES)
    generated = "\n".join(lines)

    existing = pathlib.Path(path).read_text(encoding="utf-8")
    opens = existing.index(GENERATED_OPENS)
    closes = existing.index(GENERATED_CLOSES) + len(GENERATED_CLOSES)
    pathlib.Path(path).write_text(
        existing[:opens] + generated + existing[closes:], encoding="utf-8"
    )
    print(f"rewrote the generated section of {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "command",
        choices=("coverage", "propose", "record", "review", "verify"),
        help="What to do.",
    )
    parser.add_argument(
        "--contributions",
        default=None,
        help="Path to an itemized-contributions CSV already downloaded.",
    )
    parser.add_argument(
        "--download",
        default=None,
        metavar="PATH",
        help="Download the contributions 'All' file to PATH and use it.",
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "production",
        choices=("production", "local"),
        help="Which database the roster is read from AND links are written to. One "
        "setting for both: a legislator id only means anything in the database holding "
        "that legislator. Default production, where the real sitting members are.",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Override the connection outright, for both the roster and the links.",
    )
    parser.add_argument(
        "--reviewer",
        default=REVIEWER_OF_RECORD,
        help=f"Who is confirming. Defaults to {REVIEWER_OF_RECORD!r}, the entity "
        "accountable for the match and the words a reader is shown. A default rather than "
        "a prompt because 144 rows stamped with a typo cannot be corrected by retyping it.",
    )
    parser.add_argument(
        "--no-filer-directory",
        action="store_true",
        help="Skip the Board's registered-filer directory. Only for reproducing what the "
        "payment files alone can say; it puts 88 more legislators in front of you.",
    )
    parser.add_argument(
        "--audit-record",
        default=AUDIT_RECORD_PATH,
        help=f"For 'record': the file whose generated section is rewritten. Defaults to "
        f"{AUDIT_RECORD_PATH}.",
    )
    parser.add_argument(
        "--batch",
        action="store_true",
        help="For 'review': answer in lists rather than one question at a time. First "
        "every uncontested proposal as one list, then the contested ones grouped by the "
        "single fact from the Board's register that answers them. Each list prints in full, "
        "any row can be held back by number, and nothing is written until the word "
        "'confirm' is typed. Whatever the register cannot speak to stays one at a time.",
    )
    parser.add_argument(
        "--tier",
        default=None,
        choices=("strong", "review"),
        help="Limit 'review' to one proposal tier.",
    )
    args = parser.parse_args()

    if args.command == "review" and not args.reviewer.strip():
        parser.error("--reviewer cannot be blank: a link records who checked it.")
    if not args.contributions and not args.download:
        parser.error("pass --contributions PATH or --download PATH.")

    contributions_path = args.contributions or download_contributions(args.download)
    committees, party_by_registration = read_contributions_csv(contributions_path)
    candidate_committees = [
        committee for committee in committees if committee.is_candidate_committee
    ]
    print(
        f"read {len(committees):,} committees from {contributions_path}, "
        f"of which {len(candidate_committees):,} are candidate committees",
        file=sys.stderr,
    )

    # One connection for both halves, so a confirmed link can only ever name a legislator
    # that database actually holds.
    database_url = normalize_database_url(
        args.database_url or database_url_for_target(args.target)
    )
    roster = read_roster(database_url)
    if not roster.members:
        raise SystemExit(
            "That database holds no current legislators, so there is nothing to review. "
            "Pass --target production, or load sample data locally."
        )
    print(
        f"read {len(roster.members)} sitting legislators; current session years "
        f"{roster.current_years[0]}-{roster.current_years[-1]}",
        file=sys.stderr,
    )
    filers = {} if args.no_filer_directory else fetch_filer_directory()
    results = propose_all(
        roster.members,
        committees,
        current_years=roster.current_years,
        party_by_registration=party_by_registration,
        filers_by_registration=filers,
    )

    # Only 'review' writes, so only 'review' pays for the extra pass over the file. Read
    # before the first question rather than after the last: a sitting can be answered over
    # an hour, and the snapshot a decision was made against is the file as it was opened.
    records_through = (
        newest_receipt_date(contributions_path) if args.command == "review" else None
    )
    if args.command == "review":
        print(
            f"decisions will record this download as reaching {records_through}",
            file=sys.stderr,
        )

    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as session:
        if args.command == "coverage":
            print_coverage(results, load_existing_decisions(session))
        elif args.command == "propose":
            print_proposals(results, load_existing_decisions(session))
        elif args.command == "record":
            write_audit_record(
                results,
                load_existing_decisions(session),
                path=args.audit_record,
                records_through=newest_receipt_date(contributions_path),
                read_on=date.today().isoformat(),
            )
        elif args.command == "verify":
            raise SystemExit(
                run_verify(
                    session,
                    roster.members,
                    committees,
                    party_by_registration=party_by_registration,
                    filers_by_registration=filers,
                )
            )
        elif args.batch:
            run_batch_review(results, session, args.reviewer, records_through)
            run_grouped_review(results, session, args.reviewer, records_through, filers)
        else:
            run_review(
                results,
                session,
                args.reviewer,
                ProposalTier(args.tier) if args.tier else None,
                records_through,
            )


if __name__ == "__main__":
    csv.field_size_limit(10_000_000)
    main()
