"""Incomplete public downloads cannot establish committee identity contradictions."""

from types import SimpleNamespace

import pytest

from scripts import review_legislator_campaign_committees as review


@pytest.mark.parametrize("tail", ["", "\n", ",,,,,\n"])
def test_download_rejects_header_only_or_unusable_rows(monkeypatch, tmp_path, tail):
    body = (review.CONTRIBUTIONS_HEADER_LINE + "\n" + tail).encode()
    response = SimpleNamespace(
        headers={"Content-Disposition": "Itemized Contributions Received.csv"},
        raise_for_status=lambda: None,
        iter_content=lambda **kw: [body],
    )
    http = SimpleNamespace(headers={}, get=lambda *a, **kw: response)
    monkeypatch.setattr(review.requests, "Session", lambda: http)
    monkeypatch.setattr(
        review,
        "resolve_contributions_download_url",
        lambda _: "https://cfb.mn.gov/example",
    )
    with pytest.raises(RuntimeError, match="SOURCE INCOMPLETE"):
        review.download_contributions(str(tmp_path / "contributions.csv"))


def test_empty_source_never_reports_confirmed_links_as_wrong(monkeypatch, capsys):
    monkeypatch.setattr(
        review, "inspect", lambda _: SimpleNamespace(has_table=lambda _: True)
    )
    db = SimpleNamespace(
        get_bind=lambda: None, scalars=lambda _: SimpleNamespace(all=lambda: [object()])
    )
    monkeypatch.setattr(
        review,
        "recheck_confirmed_links",
        lambda *a, **kw: pytest.fail("must not compare incomplete source"),
    )
    assert (
        review.run_verify(
            db, [], [], party_by_registration={}, filers_by_registration={}
        )
        == 2
    )
    assert "SOURCE INCOMPLETE" in capsys.readouterr().out
