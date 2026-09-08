"""What clearing the saved money answers must do, and must never do (#1979).

Cloudflare keeps a copy of every public money answer for up to a day. Nothing in this
repository ever asked it to throw one away, so a copy expired on a timer and on nothing
else: after a load, a rarely-visited money page could show the previous release's
figures, and after a person took back a committee-to-legislator link, a page could keep
naming that member.

Each test here stands in for one way that clearing could go quietly wrong. Quietly is
the word that matters: a purge that fails silently is worse than none at all, because
it would justify a longer window it is not earning.

* **The switch takes 2 separate conditions.** A Cloudflare token turning up in an
  environment for some other reason must not start clearing production caches on its
  own, and the switch alone with no token must not look armed.
* **An unarmed run says exactly what it would have cleared, and is not a failure.**
  That is what makes this safe to wire in before the token exists, and it is what a
  proof will read.
* **A refusal is a failure, including the 200 Cloudflare answers with
  ``success: false``** -- which is what a token lacking the Cache Purge permission
  gets back. Reading the status code alone would call that a success.
* **A prefix that would clear nothing is refused before it is sent.** Cloudflare's
  purge-by-prefix takes a hostname and a path; a scheme or a query string in there
  matches nothing, and nothing in the response would say so.
* **Every event clears every read its own records feed**, found by asking which
  handlers read those records rather than by reading address shapes.
* **A sitting is chunked to Cloudflare's 100-prefix limit**, because a review sitting
  of 50 decisions makes more prefixes than one request may carry.

No network and no database: every test here drives the real ``clear`` through its
``post`` seam, so what is exercised is the shipped code path rather than a
re-implementation of it.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
import requests
from sqlalchemy import select

from alethical.db import models
from alethical.db.session import get_session_factory

from alethical.pipeline.cache_purge import (
    CACHED_API_HOST,
    ENABLE_SETTING,
    ENABLE_VALUE,
    PREFIXES_PER_REQUEST,
    TOKEN_SETTING,
    ZONE_SETTING,
    Clearing,
    LinkDecision,
    UnsafePrefix,
    arming,
    clear,
    clear_after_publish,
    link_prefixes,
    when_a_filings_release_lands,
    when_a_money_download_release_lands,
    when_link_decisions_are_written,
    when_the_money_checks_finish,
)
from alethical.pipeline.cache_purge import ClearingResult

ROOT = Path(__file__).resolve().parents[2]
_SCRIPT = ROOT / "scripts" / "review_legislator_campaign_committees.py"
_spec = importlib.util.spec_from_file_location("review_committees_script", _SCRIPT)
assert _spec is not None and _spec.loader is not None
review_script = importlib.util.module_from_spec(_spec)
# Registered before it is executed, because this script defines dataclasses at module
# level and `@dataclass` looks its own module up in `sys.modules` while it runs.
sys.modules[_spec.name] = review_script
_spec.loader.exec_module(review_script)

ARMED = {
    TOKEN_SETTING: "a-token-with-cache-purge",
    ZONE_SETTING: "zone-1234",
    ENABLE_SETTING: ENABLE_VALUE,
}


class FakeResponse:
    def __init__(self, status_code: int, payload=None, text: str | None = None):
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else json.dumps(payload)

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


def accepting(sent: list[dict]):
    def post(url, headers=None, json=None, timeout=None):
        sent.append({"url": url, "headers": headers, "body": json, "timeout": timeout})
        return FakeResponse(200, {"success": True, "errors": [], "result": {}})

    return post


# --- the switch ------------------------------------------------------------------


def test_a_token_alone_does_not_arm_a_purge():
    """A token in the environment for another reason must not start clearing caches."""
    state = arming({TOKEN_SETTING: "t", ZONE_SETTING: "z"})
    assert state.armed is False
    assert ENABLE_SETTING in state.reason


def test_the_switch_alone_does_not_arm_a_purge():
    state = arming({ENABLE_SETTING: ENABLE_VALUE})
    assert state.armed is False
    assert TOKEN_SETTING in state.reason and ZONE_SETTING in state.reason


def test_a_zone_with_no_token_does_not_arm_a_purge():
    state = arming({ZONE_SETTING: "z", ENABLE_SETTING: ENABLE_VALUE})
    assert state.armed is False
    assert state.reason == f"{TOKEN_SETTING} not set"


@pytest.mark.parametrize("value", ["", "0", "off", "false", "no", "On ", "ON"])
def test_only_the_word_on_arms_the_switch(value):
    """Spelled out rather than a truthy check: a leftover value must not read as on.

    ``"On "`` and ``"ON"`` are the 2 that DO arm it -- the value is trimmed and
    lower-cased -- so this also pins that a stray space or a capital is not a silent
    refusal an operator would have to debug.
    """
    state = arming({TOKEN_SETTING: "t", ZONE_SETTING: "z", ENABLE_SETTING: value})
    assert state.armed is (value.strip().lower() == ENABLE_VALUE)


def test_both_conditions_together_arm_it():
    assert arming(ARMED).armed is True


# --- an unarmed run --------------------------------------------------------------


def test_an_unarmed_run_sends_nothing_and_is_not_a_failure():
    calls: list[dict] = []
    result = clear(when_a_money_download_release_lands(), env={}, post=accepting(calls))
    assert calls == []
    assert result.armed is False
    assert result.ok is True
    assert result.failed is False


def test_an_unarmed_run_names_every_prefix_it_would_have_cleared():
    """The report is what a proof reads, so it lists the addresses, not a count."""
    clearing = when_a_money_download_release_lands()
    report = clear(clearing, env={}, post=accepting([])).report()
    assert "NOT ARMED" in report
    for prefix in clearing.prefixes:
        assert prefix in report


# --- a real purge, and its failures ----------------------------------------------


def test_an_armed_purge_sends_the_prefixes_to_the_zones_purge_address():
    calls: list[dict] = []
    clearing = when_a_money_download_release_lands()
    result = clear(clearing, env=ARMED, post=accepting(calls))
    assert result.ok is True and result.armed is True
    assert len(calls) == 1
    assert calls[0]["url"].endswith("/zones/zone-1234/purge_cache")
    assert calls[0]["headers"]["Authorization"] == "Bearer a-token-with-cache-purge"
    assert calls[0]["body"] == {"prefixes": list(clearing.prefixes)}


def test_a_200_that_refuses_the_purge_is_a_failure():
    """Cloudflare answers 200 with ``success: false`` for a request it declines.

    A token without the Cache Purge permission is exactly that case, so a check on the
    status code alone would report a purge that never happened as a success.
    """

    def post(url, headers=None, json=None, timeout=None):
        return FakeResponse(
            200,
            {
                "success": False,
                "errors": [{"code": 10000, "message": "Authentication error"}],
            },
        )

    result = clear(when_a_money_download_release_lands(), env=ARMED, post=post)
    assert result.ok is False
    assert result.failed is True
    assert "Authentication error" in result.detail


def test_a_non_200_is_a_failure_that_names_the_status():
    def post(url, headers=None, json=None, timeout=None):
        return FakeResponse(403, {"success": False}, text="forbidden")

    result = clear(when_a_money_download_release_lands(), env=ARMED, post=post)
    assert result.failed is True
    assert "403" in result.detail


def test_a_body_that_is_not_json_is_a_failure():
    def post(url, headers=None, json=None, timeout=None):
        return FakeResponse(200, None, text="<html>gateway</html>")

    result = clear(when_a_money_download_release_lands(), env=ARMED, post=post)
    assert result.failed is True


def test_an_unreachable_cloudflare_is_a_failure_and_never_raises():
    """A load has already published by the time this runs.

    An exception here would lose the report of what was published, so the failure
    comes back as a value the caller prints and exits on.
    """

    def post(url, headers=None, json=None, timeout=None):
        raise requests.ConnectionError("no route to host")

    result = clear(when_a_money_download_release_lands(), env=ARMED, post=post)
    assert result.failed is True
    assert "no route to host" in result.detail


def test_a_failed_purge_report_says_the_copies_are_still_being_served():
    def post(url, headers=None, json=None, timeout=None):
        return FakeResponse(500, {"success": False}, text="boom")

    report = clear(when_a_money_download_release_lands(), env=ARMED, post=post).report()
    assert "FAILED" in report
    assert "still saved" in report


# --- a prefix that would clear nothing -------------------------------------------


@pytest.mark.parametrize(
    "prefix",
    [
        f"https://{CACHED_API_HOST}/api/v1/campaign-finance",
        f"{CACHED_API_HOST}/api/v1/campaign-finance/outside-spending?sort=newest",
        f"{CACHED_API_HOST}/api/v1/committees#top",
        "www.alethical.com/money",
    ],
)
def test_a_prefix_that_would_clear_nothing_is_refused_before_it_is_sent(prefix):
    """Each of these is accepted by nobody and reported by nobody.

    A scheme or a fragment matches no saved copy, a query string is rejected by
    Cloudflare, and the site host is not behind Cloudflare's cache at all (measured
    8 Sep 2026: ``www.alethical.com`` answers with ``server: Vercel`` and no
    ``cf-ray``), so a purge aimed there would clear nothing and say nothing.
    """
    with pytest.raises(UnsafePrefix):
        Clearing(event="a test", prefixes=(prefix,))


@pytest.mark.parametrize("segment", ["18229/finance", "18229?year=2026", "", "a b"])
def test_a_committee_or_member_identifier_that_breaks_a_prefix_is_refused(segment):
    with pytest.raises(UnsafePrefix):
        link_prefixes(registration_number=segment)


def test_a_negative_registration_number_is_usable():
    """The Board's own export carries them, ``-2139399989`` among them."""
    assert link_prefixes(registration_number="-2139399989") == (
        f"{CACHED_API_HOST}/api/v1/committees/-2139399989",
    )


# --- which reads each event clears ------------------------------------------------


def test_a_release_clears_every_path_a_money_figure_is_served_from():
    """The 3 paths, and why each one has to be there.

    ``campaign-finance`` holds the dated record reads plus search, summary and races.
    ``committees`` holds ``/committees/{n}/finance`` and ``/committees/{n}/filings``.
    ``legislators`` holds ``/legislators/{id}/campaign-finance`` and
    ``/legislators/{id}/independent-spending``, and dropping it would leave a member's
    own money answer saying the previous release's figures.
    """
    for clearing in (
        when_a_money_download_release_lands(),
        when_a_filings_release_lands(),
        when_the_money_checks_finish(),
    ):
        assert clearing.prefixes == (
            f"{CACHED_API_HOST}/api/v1/campaign-finance",
            f"{CACHED_API_HOST}/api/v1/committees",
            f"{CACHED_API_HOST}/api/v1/legislators",
        )


def test_each_event_is_named_in_its_own_report():
    """Criterion 4 proves clearing per event, so a report may not blur 2 of them."""
    events = {
        clearing.event
        for clearing in (
            when_a_money_download_release_lands(),
            when_a_filings_release_lands(),
            when_the_money_checks_finish(),
        )
    }
    assert len(events) == 3


def test_a_link_decision_clears_the_committee_the_member_and_the_2_shared_reads():
    """Both address forms of the member, because both are saved separately.

    ``/legislators/{id}/campaign-finance`` accepts a slug or a UUID, so clearing one
    form leaves the other being served.
    """
    clearing = when_link_decisions_are_written(
        [
            LinkDecision(
                registration_number="18229",
                decision="withdrawn",
                legislator_slug="karin-housley",
                legislator_id="0198aa10-0000-0000-0000-000000000000",
            )
        ]
    )
    assert clearing is not None
    assert clearing.prefixes == (
        f"{CACHED_API_HOST}/api/v1/committees/18229",
        f"{CACHED_API_HOST}/api/v1/legislators/karin-housley",
        f"{CACHED_API_HOST}/api/v1/legislators/0198aa10-0000-0000-0000-000000000000",
        f"{CACHED_API_HOST}/api/v1/campaign-finance/summary",
        f"{CACHED_API_HOST}/api/v1/campaign-finance/outside-spending",
    )


def test_a_link_decision_clears_the_outside_spending_read_that_names_the_member():
    """The read that made this the sharpest of the 4 events.

    ``/campaign-finance/outside-spending`` serves ``about.confirmed_member`` for a
    subject view (``confirmed_member_for_committee`` in
    ``alethical/api/services/outside_spending.py``), which the app prints as "Someone
    at Alethical confirmed this committee is <name>'s". Measured live 8 Sep 2026 on
    ``?about=16964``, on a response carrying ``stale-while-revalidate=86400``.
    """
    clearing = when_link_decisions_are_written(
        [LinkDecision(registration_number="16964", decision="withdrawn")]
    )
    assert clearing is not None
    assert (
        f"{CACHED_API_HOST}/api/v1/campaign-finance/outside-spending"
        in clearing.prefixes
    )


def test_a_sitting_names_which_kinds_of_decision_it_cleared_for():
    clearing = when_link_decisions_are_written(
        [
            LinkDecision("18229", "confirmed", "karin-housley", "id-1"),
            LinkDecision("19035", "confirmed", "jim-abeler", "id-2"),
            LinkDecision("17868", "withdrawn", "someone-else", "id-3"),
        ]
    )
    assert clearing is not None
    assert "2 confirmed" in clearing.event
    assert "1 withdrawn" in clearing.event


def test_a_sitting_that_decided_nothing_clears_nothing():
    """So a command that wrote no row cannot send an empty purge."""
    assert when_link_decisions_are_written([]) is None


def test_one_member_deciding_2_committees_lists_that_member_once():
    clearing = when_link_decisions_are_written(
        [
            LinkDecision("18229", "confirmed", "karin-housley", "id-1"),
            LinkDecision("18230", "rejected", "karin-housley", "id-1"),
        ]
    )
    assert clearing is not None
    assert clearing.prefixes.count(f"{CACHED_API_HOST}/api/v1/legislators/id-1") == 1


# --- Cloudflare's own limits -------------------------------------------------------


def test_a_sitting_bigger_than_the_per_request_limit_is_split_into_several_requests():
    """A sitting of 50 decisions makes about 150 prefixes, over Cloudflare's 100.

    Sent as several requests rather than truncated: a purge that clears the first 100
    prefixes and drops the rest is the silent half-failure this whole module exists to
    prevent.
    """
    decisions = [
        LinkDecision(str(20000 + index), "confirmed", f"member-{index}", f"id-{index}")
        for index in range(50)
    ]
    clearing = when_link_decisions_are_written(decisions)
    assert clearing is not None
    assert len(clearing.prefixes) == 50 * 3 + 2

    calls: list[dict] = []
    result = clear(clearing, env=ARMED, post=accepting(calls))
    assert result.ok is True
    assert len(calls) == 2
    assert len(calls[0]["body"]["prefixes"]) == PREFIXES_PER_REQUEST
    sent = calls[0]["body"]["prefixes"] + calls[1]["body"]["prefixes"]
    assert sent == list(clearing.prefixes)


def test_a_failure_partway_through_a_split_purge_is_reported_as_a_failure():
    calls: list[dict] = []

    def post(url, headers=None, json=None, timeout=None):
        calls.append(json)
        if len(calls) == 1:
            return FakeResponse(200, {"success": True})
        return FakeResponse(200, {"success": False, "errors": ["nope"]})

    decisions = [
        LinkDecision(str(20000 + index), "confirmed", f"member-{index}", f"id-{index}")
        for index in range(50)
    ]
    clearing = when_link_decisions_are_written(decisions)
    assert clearing is not None
    result = clear(clearing, env=ARMED, post=post)
    assert result.failed is True


# --- only a run that published clears anything -------------------------------------


def test_a_run_that_published_nothing_clears_nothing():
    """A quarantined or unchanged run leaves the previous set live.

    Every saved copy of it is still the right answer, so clearing then would spend an
    origin read on every money route for nothing.
    """
    calls: list[dict] = []
    logged: list[str] = []
    failed = clear_after_publish(
        when_a_filings_release_lands(),
        published=False,
        log=logged.append,
        env=ARMED,
        post=accepting(calls),
    )
    assert calls == []
    assert logged == []
    assert failed is False


def test_a_run_that_published_clears_and_says_so():
    calls: list[dict] = []
    logged: list[str] = []
    failed = clear_after_publish(
        when_a_filings_release_lands(),
        published=True,
        log=logged.append,
        env=ARMED,
        post=accepting(calls),
    )
    assert len(calls) == 1
    assert failed is False
    assert "a new filed-totals or registered-filer release" in logged[0]


def test_a_published_run_whose_clearing_failed_reports_a_failure():
    """Which is what makes a loader exit non-zero rather than finish quietly."""

    def post(url, headers=None, json=None, timeout=None):
        return FakeResponse(200, {"success": False, "errors": ["no permission"]})

    logged: list[str] = []
    failed = clear_after_publish(
        when_a_money_download_release_lands(),
        published=True,
        log=logged.append,
        env=ARMED,
        post=post,
    )
    assert failed is True
    assert "FAILED" in logged[0]


# --- the wiring for a link decision (events 3 and 4) --------------------------------
#
# Needs the local Postgres on port 54329: the pairs cleared are read out of the
# database by comparing the decisions held before and after a command, which is what
# makes a write path added later covered without anybody remembering to register it.


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def a_legislator(db) -> models.Legislator:
    jurisdiction_id = db.scalars(select(models.Jurisdiction.id)).first()
    token = uuid.uuid4().hex[:8]
    legislator = models.Legislator(
        jurisdiction_id=jurisdiction_id,
        slug=f"cache-purge-member-{token}",
        full_name=f"Cache Purge Member {token}",
        sort_name=f"Member {token}, Cache Purge",
    )
    db.add(legislator)
    db.flush()
    return legislator


def test_a_confirmation_clears_that_member_and_that_committee(db, monkeypatch):
    """Criterion 2, driven through the review script's own function.

    The prefixes are not passed in from anywhere: they are worked out from what the
    decisions table holds now against what it held before, so this is the same path a
    real sitting takes.
    """
    sent: list = []
    monkeypatch.setattr(
        review_script, "clear", lambda clearing: _record(sent, clearing)
    )
    before = review_script.load_existing_decisions(db)
    legislator = a_legislator(db)
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=legislator.id,
            registration_number="90001",
            decision=models.CommitteeLinkReviewDecision.confirmed,
            committee_name_as_reviewed="Testcase, Sample House Committee",
            reviewed_by="Alethical",
        )
    )
    db.flush()

    failed = review_script.clear_saved_answers_for_decisions(db, before)

    assert failed is False
    assert len(sent) == 1
    prefixes = sent[0].prefixes
    assert f"{CACHED_API_HOST}/api/v1/committees/90001" in prefixes
    assert f"{CACHED_API_HOST}/api/v1/legislators/{legislator.slug}" in prefixes
    assert f"{CACHED_API_HOST}/api/v1/legislators/{legislator.id}" in prefixes
    assert "1 confirmed" in sent[0].event


def test_a_withdrawal_clears_the_same_addresses(db, monkeypatch):
    """Criterion 3, and the event this issue calls the sharpest of the 4.

    Somebody withdraws a link precisely when money was attached to the wrong named
    member, so a saved copy held past this moment keeps naming that person.
    """
    legislator = a_legislator(db)
    row = models.LegislatorCampaignCommittee(
        legislator_id=legislator.id,
        registration_number="90002",
        decision=models.CommitteeLinkReviewDecision.confirmed,
        committee_name_as_reviewed="Testcase, Sample House Committee",
        reviewed_by="Alethical",
    )
    db.add(row)
    db.flush()

    sent: list = []
    monkeypatch.setattr(
        review_script, "clear", lambda clearing: _record(sent, clearing)
    )
    before = review_script.load_existing_decisions(db)
    row.decision = models.CommitteeLinkReviewDecision.withdrawn
    row.withdrawal_reason = "the Board now registers it to someone else"
    row.withdrawn_by = "Alethical"
    row.withdrawn_at = datetime.now(UTC)
    db.flush()

    review_script.clear_saved_answers_for_decisions(db, before)

    assert len(sent) == 1
    assert "1 withdrawn" in sent[0].event
    assert f"{CACHED_API_HOST}/api/v1/committees/90002" in sent[0].prefixes
    assert f"{CACHED_API_HOST}/api/v1/legislators/{legislator.slug}" in sent[0].prefixes


def test_a_command_that_decided_nothing_clears_nothing(db, monkeypatch):
    """A reviewer who read every proposal and answered none must send no purge."""
    sent: list = []
    monkeypatch.setattr(
        review_script, "clear", lambda clearing: _record(sent, clearing)
    )
    before = review_script.load_existing_decisions(db)

    assert review_script.clear_saved_answers_for_decisions(db, before) is False
    assert sent == []


def test_a_failed_clearing_after_a_decision_is_reported(db, monkeypatch):
    """The decision stands and the command exits non-zero, loudly.

    A clearing that failed quietly is the state #1979 calls worse than having no
    clearing at all, because it would justify a longer window it is not earning.
    """
    legislator = a_legislator(db)
    sent: list = []

    def failing(clearing):
        sent.append(clearing)
        return ClearingResult(
            clearing=clearing, armed=True, ok=False, detail="no permission"
        )

    monkeypatch.setattr(review_script, "clear", failing)
    before = review_script.load_existing_decisions(db)
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=legislator.id,
            registration_number="90003",
            decision=models.CommitteeLinkReviewDecision.rejected,
            committee_name_as_reviewed="Testcase, Sample House Committee",
            reviewed_by="Alethical",
        )
    )
    db.flush()

    assert review_script.clear_saved_answers_for_decisions(db, before) is True
    assert len(sent) == 1


def _record(sent: list, clearing):
    sent.append(clearing)
    return ClearingResult(clearing=clearing, armed=False, ok=True, detail="not armed")


def test_a_writing_command_clears_after_it_writes_and_never_before(db, monkeypatch):
    """The order, pinned: clearing first would re-save the answer being replaced.

    ``write_then_clear`` is the one shape all 3 writing commands go through, so this
    covers the confirm paths and the withdraw path at once.
    """
    order: list[str] = []
    legislator = a_legislator(db)

    def clearing(clear_request):
        order.append("cleared")
        return ClearingResult(
            clearing=clear_request, armed=False, ok=True, detail="not armed"
        )

    monkeypatch.setattr(review_script, "clear", clearing)

    def write() -> int:
        order.append("wrote")
        db.add(
            models.LegislatorCampaignCommittee(
                legislator_id=legislator.id,
                registration_number="90004",
                decision=models.CommitteeLinkReviewDecision.confirmed,
                committee_name_as_reviewed="Testcase, Sample House Committee",
                reviewed_by="Alethical",
            )
        )
        db.flush()
        return 0

    assert review_script.write_then_clear(db, write) == 0
    assert order == ["wrote", "cleared"]


def test_a_writing_command_whose_clearing_failed_exits_non_zero(db, monkeypatch):
    legislator = a_legislator(db)
    monkeypatch.setattr(
        review_script,
        "clear",
        lambda request: ClearingResult(
            clearing=request, armed=True, ok=False, detail="no permission"
        ),
    )

    def write() -> int:
        db.add(
            models.LegislatorCampaignCommittee(
                legislator_id=legislator.id,
                registration_number="90005",
                decision=models.CommitteeLinkReviewDecision.confirmed,
                committee_name_as_reviewed="Testcase, Sample House Committee",
                reviewed_by="Alethical",
            )
        )
        db.flush()
        return 0

    assert review_script.write_then_clear(db, write) == 1


def test_a_writing_command_that_wrote_nothing_keeps_its_own_exit_code(db, monkeypatch):
    """A withdrawal a reviewer stopped exits 1 and must not be turned into a purge."""
    sent: list = []
    monkeypatch.setattr(review_script, "clear", lambda request: _record(sent, request))

    assert review_script.write_then_clear(db, lambda: 1) == 1
    assert sent == []
