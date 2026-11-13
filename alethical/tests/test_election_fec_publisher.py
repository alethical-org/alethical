import hashlib
import json

import pytest

from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.pipeline import election_fec_publisher as p

BODY = (
    '<a class="site-title" href="/"><span>' + p.TITLE + "</span></a>\n"
    "<p>" + p.DESCRIPTION + "</p>\n"
).encode()


def source(body=BODY):
    return {
        "authority": "fec",
        "sha256": hashlib.sha256(body).hexdigest(),
        "url": p.URL,
        "media_type": "text/html; charset=utf-8",
    }


def test_publisher_retains_exact_lines_without_claiming_candidate_identity():
    result = p.extract_publisher(BODY, source(), {"kind": "publisher"})
    assert result.facts == {
        "key": "fec",
        "name": "Federal Election Commission",
        "jurisdiction": "United States",
        "publisher_url": "https://www.fec.gov",
    }
    selected = json.loads(result.quote)["lines"]
    assert selected == [
        {"line": n, "text": line}
        for n, line in enumerate(BODY.decode().splitlines(), 1)
    ]


@pytest.mark.parametrize(
    "changes",
    [
        {"authority": "local:example"},
        {"sha256": "0" * 64},
        {"url": "https://www.fec.gov.example/about/"},
        {"url": "https://www.fec.gov/about/?source=example"},
        {"url": "https://www.fec.gov/about/#agency"},
        {"url": "http://www.fec.gov/about/"},
        {"url": "https://user@www.fec.gov/about/"},
        {"media_type": "application/json"},
    ],
)
def test_publisher_rejects_changed_source_context(changes):
    with pytest.raises(ComparisonImportError):
        p.extract_publisher(BODY, source() | changes, {"kind": "publisher"})


@pytest.mark.parametrize(
    "body", [b"", b"\xff", BODY.splitlines()[0], BODY.splitlines()[1]]
)
def test_publisher_requires_both_retained_identity_claims(body):
    with pytest.raises(ComparisonImportError):
        p.extract_publisher(body, source(body), {"kind": "publisher"})


def test_publisher_rejects_unrequested_fact_or_injected_locator():
    with pytest.raises(ComparisonImportError):
        p.extract_publisher(BODY, source(), {"kind": "publisher", "candidate_id": "X"})
