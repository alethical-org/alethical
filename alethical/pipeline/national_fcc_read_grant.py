"""Expire and cache the server's narrow read access to Finance member files.

R2 grants are bearer credentials. Never put the token, client configuration or
a presigned URL from this client in an HTTP response, log or exception message.
"""

from __future__ import annotations

import base64
import hashlib
import re
import threading
import time
from datetime import datetime, timezone
from weakref import WeakKeyDictionary

import boto3
from botocore.config import Config
import jwt
from sqlalchemy import select

from alethical.db.models import NationalFCCReadGrant
from alethical.pipeline.raw_file_store import RawFileStore

PREFIXES = (
    "fcc-national/v1/originals/",
    "fcc-national/v1/text/",
    "fcc-national/v1/search/",
)
# A grant issued before the search file existed stays valid until it expires.
LEGACY_PREFIXES = PREFIXES[:2]
PURPOSE = "finance-media"
TTL = 3 * 24 * 60 * 60
CACHE_SECONDS = 300
ACCOUNT_HOST = re.compile(r"([a-f0-9]{32})\.r2\.cloudflarestorage\.com")
_cache = WeakKeyDictionary()
_lock = threading.Lock()


def store_from_token(token: str, now: int) -> tuple[RawFileStore, int]:
    # R2 itself verifies the upstream signature. Locally refuse broadened or
    # malformed claims before constructing any URL or passing data to boto3.
    try:
        claims = jwt.decode(
            token, options={"verify_signature": False}, algorithms=["HS256"]
        )
        algorithm = jwt.get_unverified_header(token).get("alg")
    except jwt.PyJWTError:
        raise ValueError("Invalid Finance file grant") from None
    host = claims.get("aud")
    match = ACCOUNT_HOST.fullmatch(host) if isinstance(host, str) else None
    exp, iat = claims.get("exp"), claims.get("iat")
    if (
        not match
        or match[1] != claims.get("sub")
        or algorithm != "HS256"
        or not isinstance(exp, int)
        or not isinstance(iat, int)
        or not iat - 60 <= now < exp
        or not 0 < exp - iat <= TTL
        or "scope" in claims
        or claims.get("actions") != ["GetObject"]
        or claims.get("paths")
        not in (
            {"prefixPaths": list(PREFIXES), "objectPaths": []},
            {"prefixPaths": list(LEGACY_PREFIXES), "objectPaths": []},
        )
        or not isinstance(claims.get("iss"), str)
        or not claims["iss"]
        or not isinstance(claims.get("bucket"), str)
        or not claims["bucket"]
    ):
        raise ValueError("Invalid or expired Finance file grant")
    client = boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=f"https://{host}",
        aws_access_key_id=claims["iss"],
        aws_secret_access_key=hashlib.sha256(token.encode()).hexdigest(),
        aws_session_token=base64.b64encode(b"jwt/" + token.encode()).decode(),
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            retries={"total_max_attempts": 2},
            connect_timeout=5,
            read_timeout=30,
        ),
    )
    return RawFileStore(client, bucket=claims["bucket"]), exp


def member_file_store(db) -> RawFileStore:
    engine = db.get_bind().engine
    now = int(time.time())
    with _lock:
        cached = _cache.get(engine)
        if cached and now < cached[0]:
            return cached[1]
        token = db.scalar(
            select(NationalFCCReadGrant.token).where(
                NationalFCCReadGrant.purpose == PURPOSE,
                NationalFCCReadGrant.expires_at
                > datetime.fromtimestamp(now, timezone.utc),
            )
        )
        if not token:
            raise RuntimeError("Finance file access needs renewal")
        store, exp = store_from_token(token, now)
        _cache[engine] = (min(now + CACHE_SECONDS, exp), store)
        return store
