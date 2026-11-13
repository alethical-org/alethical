"""One reviewed outcome must agree across the vote and money readers."""

# ruff: noqa: F811, F401
from copy import deepcopy

import pytest

from alethical.api.services import election_finance_reads as reads
from alethical.api.services import election_comparison_reads as result_reads
from alethical.api.services import election_source_io
from alethical.db import models as m
from alethical.pipeline import election_outcomes as outcomes
from alethical.pipeline import election_comparison as storage
from alethical.pipeline.election_account_reviews import candidate_identity
from alethical.tests.finance_fixtures import finance_api, finance_db
from alethical.tests.test_election_finance_reads import (
    comparison,
    spending,
    KEY,
    RACE,
    URL,
)
from alethical.tests.test_election_comparison_reads import _precinct
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.test_election_analytics import retain_analytics_originals

BASE = f"/api/v1/finance/elections/{KEY}"


@pytest.fixture
def reviewed_race(finance_db, comparison, spending, monkeypatch):
    retain_analytics_originals(finance_db, spending, monkeypatch)
    race = comparison["race"]
    snapshot = finance_db.get(m.ElectionComparisonSnapshot, race.snapshot_id)
    original = deepcopy(race.payload)
    store = MemoryStore()
    downloads = {}
    monkeypatch.setattr(outcomes, "raw_file_store_from_env", lambda: store)
    monkeypatch.setattr(election_source_io, "reader_store_from_env", lambda: store)
    monkeypatch.setattr(result_reads, "raw_file_store_from_env", lambda: store)
    monkeypatch.setattr(
        outcomes, "_download", lambda url, hosts: (downloads[url], url, "text/plain")
    )
    _precinct(finance_db)
    finance_db.commit()
    candidate = race.payload["candidates"][0]

    def request(
        status="certified", *, previous=None, decision="recorded", claim="elected"
    ):
        number = len(downloads)
        url = f"https://www.sos.mn.gov/canvass-{number}.txt"
        publisher_url = "https://www.sos.mn.gov/publisher"
        candidate_text = f"{candidate['name']}: {claim}"
        body = f"Attorney General\n2026-11-03\nStatewide\nResult {status}\n{candidate_text}\nReview {decision}\n".encode()
        downloads[url] = body
        downloads[publisher_url] = f"Official source: {url}".encode()
        source = outcomes.capture_source(
            finance_db,
            url=url,
            publisher_url=publisher_url,
            publisher_hosts=["www.sos.mn.gov"],
            authority="Explicit fixture canvassing authority",
            store=store,
        )

        def locator(line):
            return {"line_start": line, "line_end": line, "encoding": "utf-8"}

        def evidence(kind, line, **extra):
            bindings = [
                ("office", race.label, "Attorney General", 1),
                ("election_date", snapshot.election_date.isoformat(), "2026-11-03", 2),
                ("jurisdiction", race.jurisdiction, "Statewide", 3),
            ]
            if "candidate_id" in extra:
                bindings.append(
                    ("candidate_name", candidate["name"], candidate["name"], 5)
                )
            return {
                **outcomes.capture_metadata(source),
                "kind": kind,
                "identity": outcomes.race_identity(snapshot, race),
                "quote": body.decode().splitlines()[line - 1],
                "locator": locator(line),
                "context": {
                    "bindings": [
                        {
                            "field": field,
                            "value": value,
                            "literal": literal,
                            "quote": body.decode().splitlines()[row - 1],
                            "locator": locator(row),
                            "reason": "PRIVATE identity explanation",
                        }
                        for field, value, literal, row in bindings
                    ]
                },
                **extra,
            }

        evidence_rows = (
            [evidence("withdrawal", 6)]
            if decision == "withdrawn"
            else [evidence("race_status", 4, status=status)]
        )
        claims = []
        if decision == "recorded" and status == "certified":
            evidence_rows.extend(
                [
                    evidence("final_certification", 4, final=True),
                    evidence(
                        "candidate_outcome",
                        5,
                        final=True,
                        candidate_id=candidate["candidate_id"],
                        outcome=claim,
                    ),
                ]
            )
            claims = [
                {
                    "candidate_id": candidate["candidate_id"],
                    "identity": candidate_identity(race, candidate),
                    "outcome": claim,
                }
            ]
        return dict(
            snapshot_id=snapshot.id,
            race_id=race.id,
            decision=decision,
            result_status=status,
            identity=outcomes.race_identity(snapshot, race),
            candidate_outcomes=claims,
            evidence=evidence_rows,
            reason="PRIVATE substantive outcome review",
            reviewed_by="PRIVATE reviewer",
            expected_previous_id=previous,
        )

    return snapshot, race, store, request, original


def data(client, url, **params):
    response = client.get(url, params=params)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def assert_agree(client, reviewed_race, *, status, state, claim):
    snapshot, race, _, _, original = reviewed_race
    detail = data(client, f"{BASE}/races/{race.id}", snapshot_id=snapshot.id)["race"]
    listing = data(client, f"{BASE}/races", snapshot_id=snapshot.id)["races"][0]
    precincts = data(
        client, f"{BASE}/races/{race.id}/precincts", snapshot_id=snapshot.id
    )
    money = data(client, URL, snapshot_id=snapshot.id)
    analytics = data(
        client, f"{BASE}/analytics/candidates", snapshot_id=snapshot.id, race_id=race.id
    )
    assert (
        money["result_status"]
        == detail["result_status"]
        == listing["result_status"]
        == precincts["result_status"]
        == status
    )
    assert (
        money["outcome_review"]
        == detail["outcome_review"]
        == listing["outcome_review"]
        == precincts["outcome_review"]
    )
    assert money["outcome_review"]["state"] == state
    for candidate in detail["candidates"]:
        financial = next(
            c
            for c in money["candidates"]
            if c["candidate_id"] == candidate["candidate_id"]
        )
        for field in ("outcome", "outcome_status", "evidence", "votes"):
            assert financial[field] == candidate[field]
        if not candidate["is_write_in_aggregate"]:
            analytic = next(
                c
                for c in analytics["candidates"]
                if c["candidate_id"] == candidate["candidate_id"]
            )
            for field in ("outcome", "outcome_status", "evidence", "votes"):
                assert analytic[field] == candidate[field]
    assert money["candidates"][0]["outcome"] == claim
    assert money["candidates"][1]["outcome"] is None
    assert money["candidates"][2]["outcome"] is None
    assert [c["votes"] for c in money["candidates"]] == [7, None, 0]
    assert precincts["precincts"][0]["rows"][0]["votes"] == 7
    assert race.payload == original
    assert "PRIVATE" not in str(money)
    assert (
        money["candidates"][0]["accounts"][0]["latest_report"]["figures"][
            "contributions_received"
        ]["total"]
        == "0.00"
    )
    return money


def financial_values(response):
    return [
        {
            key: value
            for key, value in c.items()
            if key not in {"outcome", "outcome_status", "evidence"}
        }
        for c in response["candidates"]
    ]


def assert_stale(client, snapshot, version):
    for url in (URL, URL + "/candidates/a/outside-spending"):
        assert (
            client.get(
                url, params={"snapshot_id": snapshot.id, "version": version}
            ).status_code
            == 409
        )


def test_review_replacement_and_withdrawal_match_all_readers(
    finance_api, finance_db, reviewed_race
):
    snapshot, _, _, request, _ = reviewed_race
    baseline = data(finance_api, URL)
    certified = outcomes.record_decision(finance_db, **request())
    finance_db.commit()
    checked = assert_agree(
        finance_api, reviewed_race, status="certified", state="checked", claim="elected"
    )
    assert_stale(finance_api, snapshot, baseline["version"])
    changed = outcomes.record_decision(
        finance_db, **request(previous=certified.id, claim="not_elected")
    )
    finance_db.commit()
    replacement = assert_agree(
        finance_api,
        reviewed_race,
        status="certified",
        state="checked",
        claim="not_elected",
    )
    assert_stale(finance_api, snapshot, checked["version"])
    outcomes.record_decision(
        finance_db, **request("pending", previous=changed.id, decision="withdrawn")
    )
    finance_db.commit()
    withdrawn = assert_agree(
        finance_api, reviewed_race, status="unofficial", state="withdrawn", claim=None
    )
    assert_stale(finance_api, snapshot, replacement["version"])
    assert withdrawn["version"] != baseline["version"]
    for result in (checked, replacement, withdrawn):
        assert financial_values(result) == financial_values(baseline)


@pytest.mark.parametrize("damage", ["missing", "corrupt"])
@pytest.mark.parametrize("source_field", ["sha256", "publisher_sha256"])
def test_active_evidence_loss_invalidates_money_and_matches_pending_readers(
    finance_api, finance_db, reviewed_race, damage, source_field
):
    snapshot, _, store, request, _ = reviewed_race
    review = request()
    outcomes.record_decision(finance_db, **review)
    finance_db.commit()
    before = data(finance_api, URL)
    source = finance_db.get(m.ElectionResultSource, review["evidence"][0][source_field])
    if damage == "missing":
        store.objects.pop(source.object_key)
    else:
        store.objects[source.object_key] = b"corrupt evidence"
    assert_stale(finance_api, snapshot, before["version"])
    after = assert_agree(
        finance_api,
        reviewed_race,
        status="unofficial",
        state="sources_unavailable",
        claim=None,
    )
    assert after["version"] != before["version"]
    assert financial_values(after) == financial_values(before)


def test_source_loss_during_money_read_is_caught_by_end_version_check(
    finance_api, finance_db, reviewed_race, monkeypatch
):
    _, _, store, request, _ = reviewed_race
    review = request()
    outcomes.record_decision(finance_db, **review)
    finance_db.commit()
    source = finance_db.get(m.ElectionResultSource, review["evidence"][0]["sha256"])
    original = reads._outside

    def lose_evidence(*args, **kwargs):
        result = original(*args, **kwargs)
        store.objects.pop(source.object_key, None)
        return result

    monkeypatch.setattr(reads, "_outside", lose_evidence)
    assert finance_api.get(URL).status_code == 409


def test_historical_outcome_source_loss_invalidates_money_without_erasing_current_claim(
    finance_api, finance_db, reviewed_race
):
    snapshot, _, store, request, _ = reviewed_race
    old_request = request()
    first = outcomes.record_decision(finance_db, **old_request)
    outcomes.record_decision(
        finance_db, **request(previous=first.id, claim="not_elected")
    )
    finance_db.commit()
    before = data(finance_api, URL)
    old_source = finance_db.get(
        m.ElectionResultSource, old_request["evidence"][0]["sha256"]
    )
    store.objects.pop(old_source.object_key)
    assert_stale(finance_api, snapshot, before["version"])
    after = assert_agree(
        finance_api,
        reviewed_race,
        status="certified",
        state="checked",
        claim="not_elected",
    )
    assert financial_values(after) == financial_values(before)


def test_money_evidence_uses_exact_published_snapshot_source_authorization(
    finance_api, finance_db, reviewed_race
):
    snapshot, _, store, request, _ = reviewed_race
    review = request()
    outcomes.record_decision(finance_db, **review)
    finance_db.commit()
    money = data(finance_api, URL)
    source = money["candidates"][0]["evidence"][0]
    source_url = f"{BASE}/sources/{source['sha256']}"
    response = finance_api.get(source_url, params={"snapshot_id": snapshot.id})
    stored = finance_db.get(m.ElectionResultSource, source["sha256"])
    assert response.content == storage.read_source(store, stored)
    assert response.status_code == 200
    assert (
        finance_api.get(source_url, params={"snapshot_id": "f" * 64}).status_code == 404
    )
    assert (
        finance_api.get(
            f"{BASE}/finance/sources/{source['sha256']}/raw",
            params={"collection_id": money["collection_id"]},
        ).status_code
        == 404
    )
    finance_api.headers.pop("Authorization")
    for url in (URL, source_url):
        assert finance_api.get(
            url, params={"snapshot_id": snapshot.id}
        ).status_code in {401, 403}
