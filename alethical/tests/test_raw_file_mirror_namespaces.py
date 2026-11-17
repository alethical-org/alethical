"""The national archive shares the mirror bucket but has no Supabase primary."""

import boto3
from botocore.stub import Stubber
import pytest
from unittest.mock import Mock

from alethical.pipeline import raw_file_mirror
from alethical.pipeline.raw_file_store import RawFileStore
from scripts import mirror_raw_files as command


@pytest.mark.parametrize("has_national_archive", [False, True])
def test_mirror_lists_every_other_root_and_skips_national_subtree(has_national_archive):
    client = boto3.client(
        "s3",
        region_name="us-east-1",
        aws_access_key_id="test",
        aws_secret_access_key="test",
    )
    store = RawFileStore(client, bucket="archive")
    root = {"Bucket": "archive", "Delimiter": "/"}
    prefixes = [{"Prefix": "legacy/"}]
    if has_national_archive:
        prefixes.append({"Prefix": "fcc-national/"})
    with Stubber(client) as stub:
        stub.add_response(
            "list_objects_v2",
            {
                "Contents": [{"Key": "fcc-national", "Size": 1}],
                "CommonPrefixes": prefixes,
                "IsTruncated": True,
                "NextContinuationToken": "second",
            },
            root,
        )
        stub.add_response(
            "list_objects_v2",
            {"CommonPrefixes": [{"Prefix": "fcc-national-other/"}]},
            {**root, "ContinuationToken": "second"},
        )
        for prefix in ("fcc-national-other/", "legacy/"):
            stub.add_response(
                "list_objects_v2",
                {"Contents": [{"Key": prefix + "nested/key", "Size": 2}]},
                {"Bucket": "archive", "Prefix": prefix},
            )
        assert store.list_objects(exclude_root_prefix="fcc-national/") == {
            "fcc-national": 1,
            "legacy/nested/key": 2,
            "fcc-national-other/nested/key": 2,
        }
        stub.assert_no_pending_responses()


@pytest.mark.parametrize("mode", ["backup", "audit", "dry-run"])
def test_primary_namespace_conflicts_and_legacy_mirror_orphans_still_fail(
    tmp_path, monkeypatch, capsys, mode
):
    reserved = "fcc-national/v1/source"
    orphan = "fcc-national-other/orphan"
    source = Mock(spec=RawFileStore)
    mirror = Mock(spec=RawFileStore)
    source.list_objects.return_value = {reserved: 10}
    mirror.list_objects.return_value = {orphan: 5}
    db = Mock()
    if mode == "dry-run":
        monkeypatch.setattr(command, "rows_by_object_key", lambda db: {})
        assert command._describe_only(db, source, mirror) == 1
        output = capsys.readouterr().out
        assert "0 object(s) would be copied" in output
        assert f"FAILED primary missing: {orphan}" in output
        assert f"FAILED reserved archive namespace: {reserved}" in output
    else:
        monkeypatch.setattr(raw_file_mirror, "rows_by_object_key", lambda db: {})
        report = raw_file_mirror.mirror_raw_files(
            db, source, mirror, str(tmp_path), audit_only=mode == "audit"
        )
        failures = {row.key: row.detail for row in report.failures}
        assert set(failures) == {reserved, orphan}
        assert "reserved" in failures[reserved]
        assert "missing from the primary" in failures[orphan]
        assert not report.unrecorded_keys
    source.list_objects.assert_called_once_with()
    mirror.list_objects.assert_called_once_with(exclude_root_prefix="fcc-national/")
    source.get.assert_not_called()
    mirror.size.assert_not_called()
    mirror.put_and_verify.assert_not_called()
    db.commit.assert_not_called()
