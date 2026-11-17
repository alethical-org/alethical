"""Verify and renew the Finance member-file grant without exposing its token.

The signer runs in GitHub Actions. The Finance API only holds the child grant.
The command defaults to a read-only probe. --apply stores the verified grant.
"""

from __future__ import annotations

import argparse
import os
import time
from datetime import datetime, timezone

from botocore.exceptions import ClientError
import jwt
from sqlalchemy import create_engine, select
from sqlalchemy.dialects.postgresql import insert

from alethical.db import models as m
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target
from alethical.pipeline.national_fcc_read_grant import (
    ACCOUNT_HOST,
    PREFIXES,
    PURPOSE,
    TTL,
    store_from_token,
)


def issue(now: int) -> str:
    endpoint = os.environ["CLOUDFLARE_R2_ENDPOINT"].rstrip("/")
    host = endpoint.removeprefix("https://")
    match = ACCOUNT_HOST.fullmatch(host)
    if not match or endpoint != f"https://{host}":
        raise ValueError("Invalid Cloudflare S3 endpoint")
    return jwt.encode(
        {
            "iss": os.environ["CLOUDFLARE_R2_ACCESS_KEY_ID"],
            "sub": match[1],
            "aud": host,
            "iat": now,
            "exp": now + TTL,
            "bucket": os.environ["CLOUDFLARE_R2_BUCKET"],
            "actions": ["GetObject"],
            "paths": {"prefixPaths": list(PREFIXES), "objectPaths": []},
        },
        os.environ["CLOUDFLARE_R2_SECRET_ACCESS_KEY"],
        algorithm="HS256",
    )


def verify(store, original_key, text_key, research_key):
    for key, prefix in zip((original_key, text_key), PREFIXES, strict=True):
        if not key.startswith(prefix):
            raise ValueError("Expected a member file from each permitted prefix")
        result = store._client.get_object(
            Bucket=store.bucket, Key=key, Range="bytes=0-0"
        )
        body = result["Body"]
        try:
            if len(body.read(2)) != 1:
                raise ValueError("Finance file probe returned unexpected bytes")
        finally:
            body.close()
    # Read-only boundary probes. A missing object is not evidence of denial.
    if not research_key.startswith("fcc-national/v1/research/"):
        raise ValueError("Expected a private research object")
    for operation, params in (
        ("get_object", {"Key": research_key, "Range": "bytes=0-0"}),
        ("list_objects_v2", {"Prefix": PREFIXES[0], "MaxKeys": 1}),
        ("head_object", {"Key": original_key}),
    ):
        try:
            response = getattr(store._client, operation)(Bucket=store.bucket, **params)
        except ClientError as exc:
            if exc.response["ResponseMetadata"]["HTTPStatusCode"] == 403:
                continue
            raise RuntimeError("Could not confirm the Finance grant boundary") from None
        if "Body" in response:
            response["Body"].close()
        raise RuntimeError("Finance grant exceeded its read boundary")


def save(db, token, exp):
    query = insert(m.NationalFCCReadGrant).values(
        purpose=PURPOSE,
        token=token,
        expires_at=datetime.fromtimestamp(exp, timezone.utc),
    )
    db.execute(
        query.on_conflict_do_update(
            index_elements=["purpose"],
            set_={
                "token": query.excluded.token,
                "expires_at": query.excluded.expires_at,
            },
            where=query.excluded.expires_at > m.NationalFCCReadGrant.expires_at,
        )
    )


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--target", required=True, choices=["production"])
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()
    engine = create_engine(
        database_url_for_target(args.target, None),
        hide_parameters=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    original, release = m.NationalFCCOriginal, m.NationalFCCSnapshot
    with engine.connect() as db:
        # On first release, stage the verified files, then run this before activation.
        sample = db.execute(
            select(
                original.object_key, original.text_object_key, release.index_object_key
            )
            .join(release, release.snapshot_id == original.snapshot_id)
            .where(original.text_object_key.is_not(None))
            .order_by(
                release.active.desc(), release.created_at.desc(), original.record_key
            )
            .limit(1)
        ).one_or_none()
    if not sample:
        raise ValueError("No verified member files staged")
    now = int(time.time())
    token = issue(now)
    store, exp = store_from_token(token, now)
    verify(store, *sample)
    if args.apply:
        with engine.begin() as db:
            save(db, token, exp)
    print(
        f"Finance file access verified; grant expires {datetime.fromtimestamp(exp, timezone.utc).isoformat()}"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Provider exceptions can contain request details, and this process signs
        # credentials. Report fixed status only in the workflow's public log.
        raise SystemExit(
            f"Finance grant renewal failed ({type(exc).__name__}). Prior grant retained."
        ) from None
