"""Finance's Media buys: originals and every check, never public-copy steps or links."""

# ruff: noqa: F811 -- pytest fixtures arrive as parameters named after the imports

from __future__ import annotations

import json

import pytest

from alethical.api.services import finance_media_buys as media
from alethical.api.services import tv_ad_review as review
from alethical.api.services import tv_ads as reader
from alethical.tests import test_tv_ad_review as review_fixtures
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_tv_ad_review import ACTOR, approved, fact

BASE = "/api/v1/finance/media-buys"


@pytest.fixture(autouse=True)
def page_count(monkeypatch):
    # The page count otherwise reads the saved PDF from file storage.
    monkeypatch.setattr(reader, "original_page_count", lambda *args, **kwargs: 1)


@pytest.fixture()
def listed(finance_db):
    """Commit the listed account into the outer test transaction, so a refused
    request's rollback keeps it; the outer transaction still rolls back."""
    finance_db.commit()
    return finance_db


@pytest.fixture()
def source(listed):
    return review_fixtures.source.__wrapped__(listed)


def keys(value) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {k for item in value.values() for k in keys(item)}
    if isinstance(value, list):
        return {k for item in value for k in keys(item)}
    return set()


def test_a_file_opens_as_its_original_with_no_public_copy_fields(finance_api, source):
    document, _ = source
    key = reader.file_key(document.facility_id, document.file_id)
    response = finance_api.get(f"{BASE}/files/{key}")
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers["cache-control"]
    detail = response.json()["data"]
    assert detail["name"] == "Private title"
    assert not keys(detail) & {
        "copy_id",
        "copy_status",
        "newest_approved_version",
        "href",
        "image_path",
    }
    assert all("status" not in version for version in detail["versions"])
    assert detail["pages"][0]["image"] == (
        f"/finance/media-buys/files/{key}/pages/1?version={document.content_hash}"
    )


def test_every_check_shows_published_or_not_and_never_who_made_it(finance_db, source):
    document, _ = source
    copy = approved(finance_db, source)
    review.add_fact(finance_db, copy.id, ACTOR, fact())
    review.add_fact(
        finance_db,
        copy.id,
        ACTOR,
        fact(
            field="principal",
            value="Example Committee",
            quote="Principal: Example Committee.",
            publication_approved=False,
            privacy_reviewed=False,
        ),
    )
    key = reader.file_key(document.facility_id, document.file_id)
    detail = media.file_detail(finance_db, key)
    assert {f["value"] for f in detail["facts"]} == {
        "Example Media",
        "Example Committee",
    }
    public = reader.file_detail(finance_db, key, include_archive=True)
    assert {f["value"] for f in public["facts"]} == {"Example Media"}
    text = json.dumps(detail)
    assert ACTOR not in text and "Reviewed invoice" not in text


def test_lists_carry_no_links_or_copy_ids(finance_api, source, finance_db):
    copy = approved(finance_db, source)
    review.add_fact(finance_db, copy.id, ACTOR, fact())
    for path in ("/recent", "/browse?q=Example", "/counts", "/sources"):
        response = finance_api.get(BASE + path)
        assert response.status_code == 200, (path, response.text)
        data = response.json()["data"]
        assert not keys(data) & {"copy_id", "href", "files_with_approved_copy"}
        assert "/money/" not in json.dumps(data)


def test_original_pages_are_served_private(finance_api, source, monkeypatch):
    document, _ = source
    calls = []
    monkeypatch.setattr(
        review,
        "render_original_page",
        lambda db, *args: calls.append(args) or b"\x89PNG",
    )
    key = reader.file_key(document.facility_id, document.file_id)
    response = finance_api.get(
        f"{BASE}/files/{key}/pages/1", params={"version": document.content_hash}
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert "no-store" in response.headers["cache-control"]
    assert calls == [(document.facility_id, document.file_id, document.content_hash, 1)]


def test_unknown_files_and_kinds_are_refused(finance_api, listed):
    assert finance_api.get(f"{BASE}/files/kstp-tv-missing").status_code == 404
    response = finance_api.get(f"{BASE}/connections?kind=bogus&target=x")
    assert response.status_code == 422, response.text


def test_media_buys_need_finance_access(client):
    assert client.get(f"{BASE}/counts").status_code == 401
