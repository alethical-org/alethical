"""Finance access, exact version pins and attachment-only external source routes."""

# ruff: noqa: F401,F811
from copy import deepcopy
import importlib
import socket
from uuid import UUID

from fastapi import HTTPException
import pytest
from sqlalchemy import text

from alethical.api.auth import get_auth_service
from alethical.api.problems import problem_exception
from alethical.api.routers import election_external_finance as routes
from alethical.api.services import election_external_finance_reads as reads
from alethical.api.services import finance_access
from alethical.api.services.auth import AuthenticatedPrincipal
from alethical.db.session import get_db
from alethical.pipeline import election_external_adapters as adapters
from alethical.pipeline import election_external_finance as storage
from alethical.tests.test_election_external_finance import db, external, publish, rehash
from alethical.tests.test_election_external_finance_reads import checked

KEY = "mn-2026-11-03-general"
RACE = "a" * 64
GENERATION = "b" * 64
VERSION = "c" * 64
SOURCE = "d" * 64
BASE = f"/api/v1/finance/elections/{KEY}/external-finance"
CANDIDATE = f"{BASE}/races/{RACE}/candidates/00000001"
PINS = {"generation_id": GENERATION, "version": VERSION}
ENDPOINTS = [
    (BASE, {}, "context"),
    (CANDIDATE, {}, "candidate_finance"),
    (CANDIDATE + "/payments", PINS, "payment_records"),
    (BASE + f"/sources/{SOURCE}", {"generation_id": GENERATION}, "source_body"),
]
SUBJECTS = {"listed": str(UUID(int=1001)), "unlisted": str(UUID(int=1002))}


class TestAccounts:
    def authenticate(self, token):
        if token not in SUBJECTS:
            raise ValueError("Unknown test token")
        return AuthenticatedPrincipal(
            provider="supabase",
            provider_subject=SUBJECTS[token],
            email=f"{token}@example.test",
            email_verified=True,
        )


@pytest.fixture
def api(client, db):
    db.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
    db.execute(
        text("""CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
        deleted_at timestamptz, banned_until timestamptz,
        is_anonymous boolean NOT NULL DEFAULT false)""")
    )
    for token, subject in SUBJECTS.items():
        db.execute(
            text(
                "INSERT INTO auth.users (id,email,email_confirmed_at) VALUES (:id,:email,CURRENT_TIMESTAMP)"
            ),
            {"id": subject, "email": f"{token}@example.test"},
        )
    finance_access.grant(db, "listed@example.test", team=False)
    client.app.dependency_overrides[get_db] = lambda: db
    client.app.dependency_overrides[get_auth_service] = lambda: TestAccounts()
    return client


def bearer(account="listed"):
    return {"Authorization": f"Bearer {account}"}


def private(response):
    assert "private" in response.headers["cache-control"]
    assert "no-store" in response.headers["cache-control"]
    assert response.headers["x-robots-tag"] == "noindex, nofollow"


@pytest.mark.parametrize("url,params,service", ENDPOINTS)
@pytest.mark.parametrize("account,status", [(None, 401), ("unlisted", 403)])
def test_access_denied_before_any_external_service_store_or_bootstrap(
    api, monkeypatch, url, params, service, account, status
):
    def forbidden(*a, **kw):
        pytest.fail("Refused request entered external finance code")

    for name in (
        "context",
        "candidate_finance",
        "payment_records",
        "source_body",
        "raw_file_store_from_env",
    ):
        monkeypatch.setattr(reads, name, forbidden)
    monkeypatch.setattr(routes, "register_external_adapters", forbidden)
    response = api.get(url, params=params, headers=bearer(account) if account else {})
    assert response.status_code == status
    private(response)


@pytest.mark.parametrize(
    "url,params,service",
    ENDPOINTS[:3] + [(BASE, PINS, "context"), (CANDIDATE, PINS, "candidate_finance")],
)
def test_finance_account_receives_exact_scoped_arguments_and_64_character_version(
    api, db, monkeypatch, url, params, service
):
    calls = []

    def captured(session, **kwargs):
        assert session is db
        calls.append(kwargs)
        return {"version": VERSION, "generation_id": GENERATION}

    monkeypatch.setattr(reads, service, captured)
    response = api.get(url, params=params, headers=bearer())
    assert response.status_code == 200, response.text
    assert response.json() == {
        "data": {"version": VERSION, "generation_id": GENERATION},
        "links": None,
    }
    expected = {
        "election_key": KEY,
        "generation_id": params.get("generation_id"),
        "version": params.get("version"),
    }
    if service != "context":
        expected.update(race_id=RACE, candidate_id="00000001")
    if service == "payment_records":
        expected.update(effective_only=True, limit=100, offset=0)
    assert calls == [expected]
    private(response)


def test_all_candidate_payment_pins_filters_and_exact_identity_are_forwarded(
    api, monkeypatch
):
    received = {}

    def capture(db, **kwargs):
        received.update(kwargs)
        return {"rows": [], "version": VERSION}

    monkeypatch.setattr(reads, "payment_records", capture)
    params = {**PINS, "limit": 200, "offset": 2147483647, "effective_only": "false"}
    response = api.get(CANDIDATE + "/payments", params=params, headers=bearer())
    assert response.status_code == 200
    assert received == {
        "election_key": KEY,
        "race_id": RACE,
        "candidate_id": "00000001",
        **PINS,
        "limit": 200,
        "offset": 2147483647,
        "effective_only": False,
    }


@pytest.mark.parametrize(
    "url,params",
    [
        (BASE, {"generation_id": "a" * 63}),
        (BASE, {"generation_id": "A" * 64}),
        (BASE, {"version": "a" * 16}),
        (CANDIDATE, {"version": "a" * 65}),
        (CANDIDATE, {"generation_id": "not-a-generation"}),
        (BASE.replace(KEY, "mn-2026-11-03-other"), {}),
        (CANDIDATE.replace(RACE, "short"), {}),
        (CANDIDATE.replace("00000001", "x" * 65), {}),
        (CANDIDATE.replace("00000001", "bad%00id"), {}),
        (CANDIDATE + "/payments", {}),
        (CANDIDATE + "/payments", {"generation_id": GENERATION}),
        (CANDIDATE + "/payments", {"version": VERSION}),
        (CANDIDATE + "/payments", {**PINS, "limit": 0}),
        (CANDIDATE + "/payments", {**PINS, "limit": 201}),
        (CANDIDATE + "/payments", {**PINS, "offset": -1}),
        (CANDIDATE + "/payments", {**PINS, "offset": 2147483648}),
        (CANDIDATE + "/payments", {**PINS, "effective_only": "sometimes"}),
        (BASE + f"/sources/{SOURCE}", {}),
        (BASE + "/sources/short", {"generation_id": GENERATION}),
        (BASE + f"/sources/{SOURCE}", {"generation_id": "B" * 64}),
    ],
)
def test_invalid_route_query_is_422_before_external_work(api, monkeypatch, url, params):
    monkeypatch.setattr(
        routes,
        "register_external_adapters",
        lambda: pytest.fail("Invalid query entered endpoint"),
    )
    response = api.get(url, params=params, headers=bearer())
    assert response.status_code == 422, response.text
    private(response)


@pytest.mark.parametrize("url,params,service", ENDPOINTS)
@pytest.mark.parametrize("status", [404, 409, 503])
def test_service_problem_status_is_preserved(
    api, monkeypatch, url, params, service, status
):
    def unavailable(*a, **kw):
        raise problem_exception(
            status, "Unavailable test records", "Exact service refusal"
        )

    monkeypatch.setattr(reads, service, unavailable)
    response = api.get(url, params=params, headers=bearer())
    assert response.status_code == status
    assert response.json()["detail"] == "Exact service refusal"
    private(response)


def test_fixed_bootstrap_is_idempotent_and_collision_does_not_partly_register(
    monkeypatch,
):
    monkeypatch.setattr(storage, "ADAPTERS", {})
    adapters.register_external_adapters()
    first = dict(storage.ADAPTERS)
    assert set(first) == {
        "fec_raw:v1",
        "fec_bulk_summary:v1",
        "fec_catalogue:v1",
        "fec_publisher:v1",
        "fec_form2_pdf:v1",
        "fec_candidate_master:v1",
        "fec_candidate_linkage:v1",
    }
    adapters.register_external_adapters()
    assert storage.ADAPTERS == first

    def wrong(*a):
        return None

    monkeypatch.setattr(storage, "ADAPTERS", {"fec_catalogue:v1": wrong})
    with pytest.raises(storage.ComparisonImportError):
        adapters.register_external_adapters()
    assert storage.ADAPTERS == {"fec_catalogue:v1": wrong}


def test_bootstrap_module_import_has_no_storage_or_network_side_effects(monkeypatch):
    monkeypatch.setattr(storage, "ADAPTERS", {})

    def forbidden(*a, **kw):
        pytest.fail("Module import performed external work")

    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(reads, "raw_file_store_from_env", forbidden)
    importlib.reload(adapters)
    assert storage.ADAPTERS == {}


def test_bootstrap_collision_is_private_service_unavailable(api, monkeypatch):
    monkeypatch.setattr(storage, "ADAPTERS", {"fec_raw:v1": lambda: None})
    response = api.get(BASE, headers=bearer())
    assert response.status_code == 503
    assert "adapter" not in response.text.lower()
    private(response)


def test_retained_source_is_exact_attachment_with_no_metadata_leak(
    api, db, external, monkeypatch
):
    ctx = external
    publish(db, ctx)
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: ctx.store)
    url = f"{BASE}/sources/{ctx.source_hash}"
    response = api.get(url, params={"generation_id": ctx.g["id"]}, headers=bearer())
    assert response.status_code == 200, response.text
    assert response.content == ctx.originals[ctx.source_hash]
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert (
        response.headers["content-disposition"]
        == f'attachment; filename="external-finance-{ctx.source_hash}.json"'
    )
    assert "PRIVATE_OBJECT_KEY" not in str(response.headers)
    assert "PRIVATE_REVIEWER" not in response.text
    private(response)
    unrelated = storage.archive_source(
        db, ctx.store, b"retained outside selected generation"
    )
    denied = api.get(
        f"{BASE}/sources/{unrelated}",
        params={"generation_id": ctx.g["id"]},
        headers=bearer(),
    )
    assert denied.status_code == 404


def test_real_service_pins_historical_generation_and_rejects_changed_review_version(
    api, db, external, monkeypatch
):
    ctx = external
    first = checked(db, ctx)
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: ctx.store)
    url = f"{BASE}/races/{ctx.race.id}/candidates/{ctx.candidate['candidate_id']}"
    response = api.get(url, headers=bearer())
    assert response.status_code == 200, response.text
    initial = response.json()["data"]
    assert len(initial["version"]) == 64
    params = {
        "generation_id": initial["generation_id"],
        "version": initial["version"],
        "limit": 1,
    }
    assert (
        api.get(url + "/payments", params=params, headers=bearer()).status_code == 200
    )
    newer = deepcopy(ctx.g)
    newer["coverage"][0]["next_action"] = "New pending collection action"
    rehash(newer)
    storage.stage_generation(db, ctx.store, newer, {})
    storage.publish_generation(
        db, ctx.store, newer["id"], expected_previous=ctx.g["id"]
    )
    # A pointer change does not mix old page records with the new generation.
    pinned = api.get(url + "/payments", params=params, headers=bearer())
    assert pinned.status_code == 200
    assert pinned.json()["data"]["generation_id"] == initial["generation_id"]
    from alethical.pipeline import election_account_reviews as reviews

    reviews.record_decision(
        db,
        **{
            **ctx.args,
            "decision": "withdrawn",
            "expected_previous_id": first.id,
            "reason": "Private withdrawal",
        },
    )
    changed = api.get(url + "/payments", params=params, headers=bearer())
    assert changed.status_code == 409
    # SOS identity remains scoped to the exact race; FEC candidate ID is not a substitute.
    assert (
        api.get(url.replace("00000001", "S6MN00001"), headers=bearer()).status_code
        == 404
    )


def test_external_namespace_exposes_no_mutation_methods(api):
    response = api.post(BASE, headers=bearer(), json={"publish": True})
    assert response.status_code == 405
