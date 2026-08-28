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
    ... review --contributions ... --reviewer "Eugene Lopin"          # one at a time
    ... review --batch --contributions ... --reviewer "Eugene Lopin"  # uncontested as one list

    # re-check every confirmed link against both sources. Writes nothing; exits non-zero
    # if any link now contradicts them. Run after each campaign-finance load.
    ... verify --contributions /path/to/contributions.csv

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
import re
import sys
from dataclasses import dataclass

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
) -> schema.LegislatorCampaignCommittee:
    """Build one decision row. The single place a link is constructed, in either flow."""
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
    )


DIRECTORY_IN_BRIEF: dict[str, str] = {
    FilerVerdict.same_seat.value: "Board confirms seat",
    FilerVerdict.same_seat_not_current.value: "Board has this seat and party, not flagged current",
    FilerVerdict.different_race.value: "Board registers it for another office",
    FilerVerdict.different_person.value: "Board registers it to another seat or party",
    FilerVerdict.unknown.value: "not in Board directory",
}


def run_batch_review(
    results: list[LegislatorProposals], session: Session, reviewer: str
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
            link_row(result.member, proposal, reviewer, confirmed=True, note=note)
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
                )
            )
            session.commit()
            decisions[
                (result.member.legislator_id, proposal.committee.registration_number)
            ] = "confirmed" if answer.startswith("y") else "rejected"
            written += 1
    print(f"\ndone. {written} decisions written.")
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "command",
        choices=("coverage", "propose", "review", "verify"),
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
        default=None,
        help="Who is confirming. Required by 'review' -- an unattributed link is not a "
        "checked link.",
    )
    parser.add_argument(
        "--no-filer-directory",
        action="store_true",
        help="Skip the Board's registered-filer directory. Only for reproducing what the "
        "payment files alone can say; it puts 88 more legislators in front of you.",
    )
    parser.add_argument(
        "--batch",
        action="store_true",
        help="For 'review': show every uncontested proposal as one list and confirm them "
        "together after the reviewer types 'confirm'. The rest stay one at a time.",
    )
    parser.add_argument(
        "--tier",
        default=None,
        choices=("strong", "review"),
        help="Limit 'review' to one proposal tier.",
    )
    args = parser.parse_args()

    if args.command == "review" and not args.reviewer:
        parser.error(
            "--reviewer is required for 'review': a link records who checked it."
        )
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

    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as session:
        if args.command == "coverage":
            print_coverage(results, load_existing_decisions(session))
        elif args.command == "propose":
            print_proposals(results, load_existing_decisions(session))
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
            run_batch_review(results, session, args.reviewer)
        else:
            run_review(
                results,
                session,
                args.reviewer,
                ProposalTier(args.tier) if args.tier else None,
            )


if __name__ == "__main__":
    csv.field_size_limit(10_000_000)
    main()
