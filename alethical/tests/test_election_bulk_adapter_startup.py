"""Cold analytics reads prepare trusted source readers without another route first."""

import hashlib

from fastapi import HTTPException
import pytest

from alethical.api.services import election_external_finance_reads as reads
from alethical.pipeline import election_external_finance as storage


class EvidenceReached(Exception):
    pass


def test_bulk_read_checks_builtin_evidence_on_its_first_call(monkeypatch):
    monkeypatch.setattr(storage, "ADAPTERS", {})
    body = (
        b'<a class="site-title" href="/">'
        b"Federal Election Commission | United States of America</a>\n"
        b"The FEC is an independent government agency, created by Congress in 1974."
    )

    def check_evidence(*args, **kwargs):
        checked = storage.ADAPTERS["fec_publisher:v1"](
            body,
            {
                "authority": "fec",
                "sha256": hashlib.sha256(body).hexdigest(),
                "url": "https://www.fec.gov/about/",
                "media_type": "text/html",
            },
            {"kind": "publisher"},
        )
        assert checked.facts["key"] == "fec"
        assert "Federal Election Commission" in checked.quote
        raise EvidenceReached

    monkeypatch.setattr(reads, "_context", check_evidence)
    for _ in range(2):
        with pytest.raises(EvidenceReached):
            reads.bulk_finance(None, election_key="mn-2026-11-03-general")


def test_bulk_adapter_collision_refuses_before_source_or_database_reads(monkeypatch):
    def existing(*args):
        return None

    monkeypatch.setattr(storage, "ADAPTERS", {"fec_raw:v1": existing})

    def forbidden(*args, **kwargs):
        pytest.fail("Conflicting reader code must fail before reading records")

    monkeypatch.setattr(reads, "_context", forbidden)
    with pytest.raises(HTTPException) as error:
        reads.bulk_finance(None, election_key="mn-2026-11-03-general")
    assert error.value.status_code == 503
    assert "temporarily unavailable" in error.value.detail["detail"]
    assert storage.ADAPTERS == {"fec_raw:v1": existing}
