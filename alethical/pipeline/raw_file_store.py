"""Keep the exact bytes of a downloaded source file, so a figure can be traced to them.

Minnesota's Campaign Finance Board publishes no archive: the 23 download links
never change and the file behind each one is replaced as it grows, so a file we
fail to keep is not re-fetchable — asking again returns a different file. That is
what makes retention a correctness requirement rather than housekeeping. A
displayed figure resolves to ``(snapshot_id, row_number)``, which resolves to a
line in a specific download, and it resolves to nothing if that download is gone.

Where the bytes go, and why not the database:
``docs/architecture/campaign-finance-system-design.md`` §4.5 (Where the downloaded
files live, and for how long). In short, our Supabase plan includes 100 GB of file
storage against 8 GB of database disk of which about 3 GB is already used, every
dated file is roughly 7 to 10 GB a year, and large bodies in Postgres ride along
in every backup and restore.

**Storage-scoped S3 credentials, not a service-role key.** These bypass row
security inside Storage and cannot touch the database at all, so a leak cannot
reach any data. Path-style addressing is required: Supabase serves one endpoint
for every bucket, and the virtual-host style boto3 prefers by default would
resolve a hostname that does not exist.

Campaign finance is the first source in this repo to retain bodies. The general
facility for every other source is
[#1346](https://github.com/alethical-org/alethical/issues/1346), which is why this
module is deliberately small and knows nothing about campaign finance.
"""

from __future__ import annotations

import hashlib
import os
from typing import BinaryIO, Optional

BUCKET = "raw-source-files"

# Above this, boto3 splits the upload. The bodies are 18.3 MB and 8.8 MB, so they
# take the multipart path; Supabase's own guidance recommends it past 6 MB.
MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024
READ_CHUNK_BYTES = 1 << 20

REQUIRED_ENV = (
    "SUPABASE_STORAGE_S3_ENDPOINT",
    "SUPABASE_STORAGE_S3_REGION",
    "SUPABASE_STORAGE_S3_ACCESS_KEY_ID",
    "SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY",
)

# The second copy. Supabase's own documentation says database backups "do not
# include objects you store via the Storage API", so nothing that protects the
# database protects the bucket above — see #1402 and
# ``docs/architecture/campaign-finance-system-design.md`` §4.5.
MIRROR_REQUIRED_ENV = (
    "CLOUDFLARE_R2_ENDPOINT",
    "CLOUDFLARE_R2_BUCKET",
    "CLOUDFLARE_R2_ACCESS_KEY_ID",
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
)


def sha256_of_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(READ_CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


class RawFileStore:
    """The private bucket that holds one object per distinct downloaded file.

    Keys are content addresses, which is what makes an object effectively
    immutable: any writer putting bytes at that key is putting the same bytes,
    because the key is their hash. **Nothing here enforces write-once at the
    protocol level**, and Codex was right to say so — there is no conditional
    write, and an unversioned S3 bucket lets a same-key upload replace what is
    there. What is enforced instead is stronger where it counts: every object is
    read back and hashed before any database row points at it, so a row can never
    claim bytes that are missing, truncated, or not the ones we meant.
    """

    def __init__(self, client, bucket: str = BUCKET) -> None:
        self._client = client
        self.bucket = bucket

    def exists(self, key: str) -> bool:
        return self.size(key) is not None

    def size(self, key: str) -> Optional[int]:
        """The stored object's byte size, or ``None`` when there is no such object.

        Size is not identity — the hash is — but it is the one property a single
        cheap request returns, and because keys are content addresses any
        difference at all means two different files are claiming one name. So the
        mirror uses it to tell "already copied" from "must not be overwritten"
        without moving bytes.
        """
        from botocore.exceptions import ClientError

        try:
            response = self._client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as error:
            status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if status in (403, 404):
                return None
            raise
        return int(response["ContentLength"])

    def list_objects(self) -> dict[str, int]:
        """Every object in the bucket, as key to byte size.

        The bucket is the authority on what has been stored, and the database is
        not: one bucket serves every database, so a local run's downloads land
        beside production's and production's rows describe only some of what is
        there. Measured 12 August 2026 — 12 objects present, 3 of them named by a
        production row. A mirror driven off the rows would have left 9 real
        downloads of dated Minnesota files unprotected.
        """
        objects: dict[str, int] = {}
        for page in self._client.get_paginator("list_objects_v2").paginate(
            Bucket=self.bucket
        ):
            for item in page.get("Contents", []):
                objects[item["Key"]] = int(item["Size"])
        return objects

    def put_and_verify(self, key: str, path: str, expected_sha256: str) -> None:
        """Upload the file at ``path``, then read the object back and hash it.

        The read-back is the point of this method. An orphaned object is
        recoverable; a database row pointing at a missing or truncated object
        destroys the evidence it claims to have, and nothing else in this system
        would notice until someone asked to see the source of a figure.

        Idempotent, because the key is a content address: an object already
        present is verified rather than re-uploaded, so a re-run of an unchanged
        download costs one read instead of one write.
        """
        from boto3.s3.transfer import TransferConfig

        if not self.exists(key):
            with open(path, "rb") as handle:
                self._client.upload_fileobj(
                    handle,
                    self.bucket,
                    key,
                    Config=TransferConfig(
                        multipart_threshold=MULTIPART_THRESHOLD_BYTES
                    ),
                )
        stored = hashlib.sha256()
        body: BinaryIO = self._client.get_object(Bucket=self.bucket, Key=key)["Body"]
        try:
            for chunk in iter(lambda: body.read(READ_CHUNK_BYTES), b""):
                stored.update(chunk)
        finally:
            body.close()
        if stored.hexdigest() != expected_sha256:
            raise RuntimeError(
                f"{self.bucket}/{key} read back as {stored.hexdigest()} but the bytes "
                f"we uploaded hash to {expected_sha256}. Refusing to record a row that "
                "points at a body we cannot vouch for. If the object was already "
                "there, the likeliest cause is a change in how we compress: the key "
                "names the original file, so a body written by an older compression "
                "setting is a different object under the same name. Compare the "
                "compression recorded on the existing row before removing anything, "
                "because a stored body may be the only record of what the source "
                "published that day."
            )

    def get(self, key: str, destination: str) -> None:
        body = self._client.get_object(Bucket=self.bucket, Key=key)["Body"]
        try:
            with open(destination, "wb") as handle:
                for chunk in iter(lambda: body.read(READ_CHUNK_BYTES), b""):
                    handle.write(chunk)
        finally:
            body.close()


def raw_file_store_from_env(bucket: str = BUCKET) -> RawFileStore:
    """Build the store from the 4 Storage-scoped credentials in the environment.

    Raises with all the missing names at once rather than one per attempt, because
    the usual cause is a shell that never loaded ``.env``.
    """
    import boto3
    from botocore.config import Config

    missing = [name for name in REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        raise RuntimeError(
            "Cannot reach the raw-file store: "
            + ", ".join(missing)
            + " not set. These are the Storage-scoped S3 credentials from the "
            "Supabase dashboard, and they live in the gitignored .env at the "
            "repository root."
        )
    client = boto3.client(
        "s3",
        endpoint_url=os.environ["SUPABASE_STORAGE_S3_ENDPOINT"],
        region_name=os.environ["SUPABASE_STORAGE_S3_REGION"],
        aws_access_key_id=os.environ["SUPABASE_STORAGE_S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY"],
        # Supabase serves every bucket from one endpoint, so the virtual-host
        # style boto3 defaults to would resolve <bucket>.<host>, which does not
        # exist.
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
    return RawFileStore(client, bucket=bucket)


def mirror_file_store_from_env() -> RawFileStore:
    """Build the second copy's store — Cloudflare R2 — from the environment.

    Same class, same read-back check, different endpoint: both stores speak S3, so
    the second copy is one copy step rather than a second integration.

    Two things R2 needs that Supabase does not, both measured 11 August 2026:

    * ``region_name="auto"``. R2 has no regions and ignores the value, but boto3
      refuses to sign a request without one.
    * **Never call ``list_buckets``.** The token is scoped to this one bucket, so
      listing them all answers ``AccessDenied``. That is the scoping working, not
      a misconfiguration, and it is why nothing here uses it as a health check.
    """
    import boto3
    from botocore.config import Config

    missing = [name for name in MIRROR_REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        raise RuntimeError(
            "Cannot reach the second copy: "
            + ", ".join(missing)
            + " not set. These are the Cloudflare R2 settings and its bucket-scoped "
            "key, and they live in the gitignored .env at the repository root. In a "
            "GitHub Actions run they are repository secrets of the same names."
        )
    client = boto3.client(
        "s3",
        endpoint_url=os.environ["CLOUDFLARE_R2_ENDPOINT"],
        region_name="auto",
        aws_access_key_id=os.environ["CLOUDFLARE_R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["CLOUDFLARE_R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
    return RawFileStore(client, bucket=os.environ["CLOUDFLARE_R2_BUCKET"])
