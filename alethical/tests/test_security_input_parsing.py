"""Host identity, safe diagnostics, and bounded work on hostile search text."""

import subprocess
import sys

import pytest


@pytest.mark.parametrize(
    "program",
    [
        "from alethical.api.routers.ask import _bill_title_phrase; "
        "assert _bill_title_phrase('housing' + ' ' * 100_000 + 'x') is not None",
        "from alethical.api.services.legislative_sessions import "
        "named_special_session_in_question; "
        "assert named_special_session_in_question('0' * 100_000 + ' special session', 94) is None",
        "from alethical.api.routers.public import bill_number_clause; "
        "assert bill_number_clause('0' * 100_000 + '!') is None",
        "from alethical.api.routers.public import bill_number_clause; "
        "assert bill_number_clause(' ' * 100_000 + '!') is None",
    ],
)
def test_search_parsers_finish_on_long_rejected_text(program):
    # A subprocess gives the old quadratic regexes a hard limit without leaving
    # a busy worker behind. Allow ample startup time on slower CI machines.
    subprocess.run([sys.executable, "-c", program], check=True, timeout=15)


@pytest.mark.parametrize("query", ["9" * 5000, "HF2147483648", "99999999999"])
def test_bill_number_above_database_integer_range_is_not_an_identifier(query):
    from alethical.api.routers.public import bill_number_clause

    assert bill_number_clause(query) is None


@pytest.mark.parametrize("query", ["HF00042", " HF 00042 ", "0" * 5000 + "42"])
def test_bill_number_keeps_leading_zero_support(query):
    from alethical.api.routers.public import bill_number_clause

    clause = bill_number_clause(query)
    assert clause is not None
    assert 42 in clause.compile().params.values()


@pytest.mark.parametrize(
    "url,house",
    [
        ("https://house.mn.gov/members/profile/1", True),
        ("https://WWW.HOUSE.MN.GOV/members/profile/1", True),
        ("https://house.mn.gov.example.org/members/profile/1", False),
        ("https://example.org/?source=house.mn.gov", False),
        ("https://house.mn.gov@example.org/members/profile/1", False),
    ],
)
def test_member_parser_uses_host_not_substrings(monkeypatch, url, house):
    from alethical.pipeline import legislator_bio_backfill as bio
    from alethical.pipeline import minnesota

    monkeypatch.setattr(minnesota, "parse_house_profile", lambda *_: "house")
    monkeypatch.setattr(minnesota, "parse_senate_profile", lambda *_: "senate")
    monkeypatch.setattr(bio, "parse_house_bio", lambda *_: "house")
    monkeypatch.setattr(bio, "parse_senate_bio", lambda *_: "senate")
    expected = "house" if house else "senate"
    assert minnesota.parse_member_profile("", url) == expected
    assert bio.parse_bio("", url, "senate") == expected


def test_saved_job_decode_failure_does_not_return_exception_details(monkeypatch):
    from oban import _recorded

    from alethical.api.routers.internal import _decode_oban_return

    def fail(_value):
        raise ValueError("private diagnostic sentinel")

    monkeypatch.setattr(_recorded, "decode_recorded", fail)
    result = _decode_oban_return({"return": "encoded sentinel"})
    assert result == {"decode_error": "Stored job result could not be decoded"}


def test_internal_dashboard_escapes_filters_and_rejects_non_numeric_limit(
    client, internal_headers, monkeypatch
):
    from alethical.api.routers import internal

    hostile = '<script>alert("synthetic")</script>'
    monkeypatch.setattr(
        internal,
        "_load_oban_dashboard_data",
        lambda *_args, **_kwargs: {
            "installed": True,
            "counts_by_state": [{"state": hostile, "count": 1}],
            "counts_by_queue": [{"queue": hostile, "state": hostile, "count": 1}],
            "jobs": [
                {
                    "id": 1,
                    "state": hostile,
                    "queue": hostile,
                    "worker": hostile,
                    "args": {"task_key": hostile},
                    "attempt": 1,
                    "max_attempts": 3,
                    "return": {"output": hostile},
                    "errors": [hostile],
                }
            ],
        },
    )
    assert client.get("/internal/v1/oban").status_code == 401
    response = client.get(
        "/internal/v1/oban",
        headers=internal_headers,
        params={"state": hostile, "queue": hostile},
    )
    assert response.status_code == 200
    assert "<script>" not in response.text
    assert "&lt;script&gt;" in response.text
    assert (
        client.get(
            "/internal/v1/oban", headers=internal_headers, params={"limit": hostile}
        ).status_code
        == 422
    )


def test_collection_review_redacts_before_writing_real_output_files(
    tmp_path, monkeypatch
):
    from alethical.pipeline import collection_failure_review as review
    from alethical.tests.test_collection_failure_review import (
        PLANTED,
        QUARANTINE,
        WORKFLOW,
        FakeRunReader,
        planted_log,
    )

    monkeypatch.setattr(
        review,
        "GitHubClient",
        lambda *_args: FakeRunReader(records=QUARANTINE, log=planted_log()),
    )
    packet = tmp_path / "packet.json"
    summary = tmp_path / "summary.txt"
    output = tmp_path / "output.txt"
    monkeypatch.setenv("GITHUB_TOKEN", PLANTED["github"])
    monkeypatch.setenv("GITHUB_REPOSITORY", "alethical-org/alethical")
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    assert (
        review.main(
            [
                "packet",
                "--run-id",
                "101",
                "--workflow",
                WORKFLOW.name,
                "--out",
                str(packet),
            ]
        )
        == 0
    )
    stored = packet.read_text() + summary.read_text() + output.read_text()
    for value in PLANTED.values():
        assert value.split("=")[-1] not in stored
