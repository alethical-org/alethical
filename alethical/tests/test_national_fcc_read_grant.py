from datetime import datetime, timezone
import io
from unittest.mock import Mock

import jwt
import pytest
from botocore.exceptions import ClientError
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from alethical.db.models import NationalFCCReadGrant
from alethical.db.session import get_engine
from alethical.pipeline import national_fcc_read_grant as grants
from scripts import national_fcc_db_renew as renew
from scripts.national_fcc_db import activate

SECRET = "test-parent-signing-secret-with-32-bytes"
HOST = "d" * 32 + ".r2.cloudflarestorage.com"


@pytest.fixture
def signer(monkeypatch):
    for key, value in {
        "ENDPOINT": "https://" + HOST,
        "BUCKET": "test-fcc",
        "ACCESS_KEY_ID": "test-access",
        "SECRET_ACCESS_KEY": SECRET,
    }.items():
        monkeypatch.setenv("CLOUDFLARE_R2_" + key, value)


def test_reader_limits_child_and_never_requires_the_parent(signer, monkeypatch):
    now = 1700000000
    token = renew.issue(now)
    # Verify the issuer created a valid signature with the fixed scope.
    data = jwt.decode(
        token,
        SECRET,
        algorithms=["HS256"],
        audience=HOST,
        options={"verify_exp": False},
    )
    assert data["actions"] == ["GetObject"]
    assert data["paths"] == {"prefixPaths": list(grants.PREFIXES), "objectPaths": []}
    monkeypatch.delenv("CLOUDFLARE_R2_SECRET_ACCESS_KEY")
    factory = Mock()
    monkeypatch.setattr(grants.boto3, "client", factory)
    store, expires = grants.store_from_token(token, now)
    assert store.bucket == "test-fcc" and expires == now + grants.TTL
    params = factory.call_args.kwargs
    assert params["aws_secret_access_key"] != SECRET and params["aws_session_token"]
    for overrides in (
        {"actions": ["GetObject", "PutObject"]},
        {"paths": {"prefixPaths": ["fcc-national/"]}},
        {"aud": "evil.example"},
        {"exp": expires + 1},
        {"scope": "object-read-only"},
    ):
        with pytest.raises(ValueError):
            grants.store_from_token(
                jwt.encode(dict(data, **overrides), SECRET, algorithm="HS256"), now
            )
    with pytest.raises(ValueError):
        grants.store_from_token(token, expires)
    # A grant issued before the search file existed stays usable until it expires.
    legacy = {"prefixPaths": list(grants.LEGACY_PREFIXES), "objectPaths": []}
    grants.store_from_token(
        jwt.encode(dict(data, paths=legacy), SECRET, algorithm="HS256"), now
    )
    widened = {"prefixPaths": [*grants.PREFIXES, "fcc-national/v1/research/"]}
    with pytest.raises(ValueError):
        grants.store_from_token(
            jwt.encode(
                dict(data, paths=widened | {"objectPaths": []}),
                SECRET,
                algorithm="HS256",
            ),
            now,
        )


def test_grant_rotation_keeps_newest_and_expired_cache_fails_closed(
    signer, monkeypatch
):
    # Give each isolated transaction an engine key that production requests never use.
    clock = 1700000000
    monkeypatch.setattr(grants.time, "time", lambda: clock)
    monkeypatch.setattr(grants.boto3, "client", Mock())
    token = renew.issue(clock)
    with get_engine().connect() as connection, connection.begin() as tx:
        session = Session(bind=connection)
        try:
            renew.save(connection, token, clock + grants.TTL)
            renew.save(connection, "older", clock + grants.TTL - 1)
            assert connection.scalar(select(NationalFCCReadGrant.token)) == token
            assert connection.scalar(
                text(
                    "select relrowsecurity from pg_class where relname='national_fcc_read_grant'"
                )
            )
            first = grants.member_file_store(session)
            assert grants.member_file_store(session) is first
            clock += grants.TTL
            with pytest.raises(RuntimeError, match="renewal"):
                grants.member_file_store(session)
            assert connection.scalar(
                select(NationalFCCReadGrant.expires_at)
            ) == datetime.fromtimestamp(clock, timezone.utc)
        finally:
            grants._cache.pop(connection.engine, None)
            session.close()
            tx.rollback()


def test_probe_requires_real_bytes_and_denials():
    store = Mock()
    store.bucket = "test-fcc"
    denied = ClientError(
        {
            "Error": {"Code": "AccessDenied"},
            "ResponseMetadata": {"HTTPStatusCode": 403},
        },
        "GetObject",
    )

    def reads(*, Key, **kwargs):
        if Key.startswith("fcc-national/v1/research/"):
            raise denied
        return {"Body": io.BytesIO(b"x")}

    store._client.get_object.side_effect = reads
    store._client.list_objects_v2.side_effect = denied
    store._client.head_object.side_effect = denied
    keys = (
        grants.PREFIXES[0] + "a.pdf",
        grants.PREFIXES[1] + "a.json",
        "fcc-national/v1/research/index",
    )
    renew.verify(store, *keys)
    store._client.list_objects_v2.side_effect = None
    store._client.list_objects_v2.return_value = {"Contents": []}
    with pytest.raises(RuntimeError, match="exceeded"):
        renew.verify(store, *keys)


def test_withdrawal_waits_for_inflight_renewal(monkeypatch):
    engine = get_engine()
    monkeypatch.setattr(renew, "renewal_sample", lambda *_: ("pdf", "text", "index"))
    monkeypatch.setattr(renew, "issue", lambda _: "temporary")
    monkeypatch.setattr(renew, "store_from_token", lambda *_: (object(), 2000000000))
    saved = Mock()
    monkeypatch.setattr(renew, "save", saved)

    def try_withdrawal(*_):
        with engine.begin() as other:
            other.exec_driver_sql("SET LOCAL lock_timeout = '150ms'")
            activate(other, None, None)

    def probe(*_):
        with pytest.raises(OperationalError) as error:
            try_withdrawal()
        assert error.value.orig.sqlstate == "55P03"

    monkeypatch.setattr(renew, "verify", probe)
    with engine.begin() as db:
        assert renew.renew_access(db, False, True) == 2000000000
        saved.assert_called_once_with(db, "temporary", 2000000000)
    try_withdrawal()
