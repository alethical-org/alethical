"""The Finance member sees only a verified original in the active release."""

# ruff: noqa: F811 -- pytest fixtures arrive as parameters named after the imports

import hashlib
import io
from unittest.mock import Mock

from alethical.api.services import finance_national_files as national
from alethical.db import models as m
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401

BASE = "/api/v1/finance/media-buys/national-files"
KEY = "CABLE|000123|test-file"
PDF_HASH = "a" * 64
TEXT = (
    b'{"pages":[{"page":1,"text":"Source text","method":"ocr","local_path":"private"}]}'
)
TEXT_HASH = hashlib.sha256(TEXT).hexdigest()
TEXT_KEY = f"fcc-national/v1/text/sha256/{TEXT_HASH[:2]}/{TEXT_HASH}.json"


def seed(db, release, active, count):
    db.add(
        m.NationalFCCSnapshot(
            snapshot_id=release,
            active=active,
            index_object_key="private/index",
            index_sha256="b" * 64,
            index_bytes=100,
            index_rows=10000,
            index_stored_bytes=90,
            index_stored_sha256="b" * 64,
            source_manifest_object_key="private/manifest",
            import_sha256="c" * 64,
            original_count=count,
        )
    )
    db.flush()
    for i in range(count):
        db.add(
            m.NationalFCCOriginal(
                snapshot_id=release,
                record_key=KEY + str(i),
                service="CABLE",
                entity_id="000123",
                file_id="test-file" + str(i),
                station_name="Held Cable",
                title=f"{release} original {i}",
                folder_path="Political Files/2026/State",
                file_year=2026,
                source_url="https://files.fcc.gov/download/test.pdf",
                content_hash=PDF_HASH,
                byte_size=len(b"%PDF-file"),
                object_key=f"fcc-national/v1/originals/sha256/aa/{PDF_HASH}.pdf",
                text_object_key=TEXT_KEY,
                page_count=1,
            )
        )
    db.commit()


def test_active_originals_and_private_paging(finance_api, finance_db):
    seed(finance_db, "released", True, 27)
    seed(finance_db, "staged", False, 28)
    first = finance_api.get(BASE, params={"q": "held cable"}).json()["data"]
    assert first["total"] == 27 and len(first["rows"]) == 25
    assert (
        finance_api.get(BASE, params={"q": "State Cable"}).json()["data"]["total"] == 27
    )
    preview = finance_api.get(BASE, params={"q": "held cable", "preview": 1}).json()[
        "data"
    ]
    assert preview["total"] == 27 and len(preview["rows"]) == 5
    second = finance_api.get(
        BASE, params={"q": "held cable", "page": 2, "version": first["version"]}
    ).json()["data"]
    assert len(second["rows"]) == 2
    beyond = finance_api.get(BASE, params={"q": "held cable", "page": 3}).json()["data"]
    assert beyond["rows"] == [] and beyond["total"] == 27
    assert len({r["key"] for r in first["rows"] + second["rows"]}) == 27
    assert finance_api.get(BASE, params={"q": "%"}).json()["data"]["total"] == 0
    assert finance_api.get(BASE, params={"q": "staged"}).json()["data"]["total"] == 0
    assert finance_api.get(BASE, params={"version": "0" * 16}).status_code == 409
    assert finance_api.get(BASE + "/" + KEY + "27").status_code == 404


def test_original_access_and_page_text(finance_api, finance_db, monkeypatch):
    seed(finance_db, "released", True, 1)
    path = BASE + "/" + KEY + "0"
    detail = finance_api.get(path).json()["data"]
    assert detail["title"] == "released original 0"
    assert not (
        {"object_key", "text_object_key", "index_object_key", "snapshot_id"}
        & detail.keys()
    )
    store = Mock(bucket="private")
    store._client.get_object.side_effect = [
        {"Body": io.BytesIO(b"%PDF-file"), "ContentLength": len(b"%PDF-file")},
        {"Body": io.BytesIO(TEXT), "ContentLength": len(TEXT)},
    ]
    monkeypatch.setattr(national, "member_file_store", lambda db: store)
    params = {"version": PDF_HASH}
    assert (
        finance_api.get(path + "/original", params={"version": "b" * 64}).status_code
        == 404
    )
    result = finance_api.get(path + "/original", params=params)
    assert result.content == b"%PDF-file"
    assert result.headers["content-type"] == "application/pdf"
    assert "no-store" in result.headers["cache-control"]
    store._client.get_object.assert_called_once_with(
        Bucket="private", Key=f"fcc-national/v1/originals/sha256/aa/{PDF_HASH}.pdf"
    )
    text = finance_api.get(path + "/text", params=params).json()["data"]
    assert text == {"pages": [{"page": 1, "text": "Source text", "method": "ocr"}]}
    for endpoint in (BASE, path, path + "/original", path + "/text"):
        assert (
            finance_api.get(
                endpoint,
                params=params if endpoint != BASE else {},
                headers={"Authorization": ""},
            ).status_code
            == 401
        )
    # A bad pointer can never sign an unrelated private object.
    held = finance_db.get(m.NationalFCCOriginal, ("released", KEY + "0"))
    held.object_key = "private/index"
    finance_db.commit()
    assert finance_api.get(path + "/original", params=params).status_code == 503
    assert store._client.get_object.call_count == 2
