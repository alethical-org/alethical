"""Daily official-returns check: unchanged does nothing, changes publish guarded."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

from alethical.pipeline import election_results_refresh as refresh
from alethical.pipeline.election_comparison import ComparisonImportError

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "election_comparison_command_for_refresh",
    ROOT / "scripts" / "election_comparison.py",
)
assert SPEC and SPEC.loader
command = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(command)

WINDOW = refresh.ResultsWindow(
    "201", date(2026, 11, 3), "general", False, date(2026, 12, 31)
)
TODAY = date(2026, 11, 23)
FILES = "https://electionresultsfiles.sos.mn.gov/20261103/"
HOME = "https://electionresults.sos.mn.gov/20261103"


def precinct(ellison=384, schutz=524):
    total = ellison + schutz
    return (
        f"MN;01;0005;0335;Attorney General;;0401;Keith Ellison;;;DFL;1;1;{ellison};0;{total}\n"
        f"MN;01;0005;0335;Attorney General;;0302;Ronald J. Schutz;;;R;1;1;{schutz};0;{total}\n"
        f"MN;01;0005;0335;Attorney General;;9901;WRITE-IN;;;WI;1;1;0;0.00;{total}\n"
    ).encode()


def files(**changes):
    body = precinct()
    result = {
        "cand.txt": b"03350401;Keith Ellison;0335;Attorney General;88;04;DFL\n03350302;Ronald J. Schutz;0335;Attorney General;88;03;R\n",
        "allracesbyprecinct.txt": body,
        "allracesbycounty.txt": body.replace(b";0005;", b";;"),
        "PrctTbl.txt": b"01;0005;AITKIN;8;10A;01;09;3001;00460;\n",
        "Cntytbl.txt": b"01;Aitkin;1\n",
        "pctstats.txt": b"MN;01;0005;AITKIN;1;1423;32;621;307;0;0;928\n",
        "home.html": b'<h1>State General Election</h1><p>Tuesday, November 3, 2026</p><p>Results are unofficial until canvassing</p><a href="/Results?ersElectionId=201&amp;scenario=state">Results</a>',
    }
    result.update(changes)
    return result


def url(name):
    return HOME if name == "home.html" else FILES + name


def prepared(tmp_path, bodies, fetched_at="2026-11-11T15:00:00+00:00"):
    folder = tmp_path / f"published-{len(list(tmp_path.iterdir()))}"
    folder.mkdir()
    manifest = []
    for name, body in bodies.items():
        (folder / name).write_bytes(body)
        manifest.append(
            {
                "file": name,
                "url": url(name),
                "sha256": hashlib.sha256(body).hexdigest(),
                "bytes": len(body),
                "fetched_at": fetched_at,
            }
        )
    path = folder / "manifest.json"
    path.write_text(json.dumps(manifest))
    import argparse

    return command.prepare_from_files(
        argparse.Namespace(
            directory=folder,
            manifest=path,
            election_id="201",
            election_date=WINDOW.election_date,
            stage="general",
            status_file="home.html",
            include_local=False,
        )
    )[0]


def published_from(generation, decisions=0):
    return refresh.Published(
        generation["id"],
        datetime.fromisoformat(generation["fetched_at"]),
        generation["sources"],
        {
            race["id"]: refresh.race_signature(race["result_status"], race["payload"])
            for race in generation["races"]
        },
        generation["coverage"],
        decisions,
    )


class Official:
    """Serves bodies like the collector, writing content-addressed captures."""

    def __init__(self, bodies, statuses=None):
        self.bodies = bodies
        self.statuses = statuses or {}
        self.calls = 0

    def __call__(self, requests, directory, *, max_bytes):
        self.calls += 1
        assert max_bytes == refresh.MAX_SOURCE_BYTES
        directory.mkdir(parents=True, exist_ok=True)
        sources = []
        for request in requests:
            name = request["id"]
            if name in self.statuses:
                sources.append(
                    {
                        "id": name,
                        "requested_url": request["url"],
                        "state": "fetch_failed",
                        "http_status": self.statuses[name],
                        "fetched_at": "2026-11-23T14:00:00+00:00",
                    }
                )
                continue
            body = self.bodies[name]
            digest = hashlib.sha256(body).hexdigest()
            (directory / f"{digest}.body").write_bytes(body)
            sources.append(
                {
                    "id": name,
                    "requested_url": request["url"],
                    "state": "captured",
                    "sha256": digest,
                    "bytes": len(body),
                    "file": f"{digest}.body",
                    "content_type": "text/plain",
                    "last_modified": "Thu, 19 Nov 2026 20:38:32 GMT",
                    "fetched_at": "2026-11-23T14:00:00+00:00",
                }
            )
        captured = sum(s["state"] == "captured" for s in sources)
        return {
            "expected": len(requests),
            "captured": captured,
            "failed": len(requests) - captured,
            "sources": sources,
        }


class Production:
    """A pointer with compare-and-swap, recording every external write."""

    def __init__(self, published):
        self.published = published
        self.staged = []
        self.publishes = []

    def read(self, key):
        assert key == WINDOW.election_key
        return self.published

    def stage(self, generation, originals, target):
        self.staged.append((generation["id"], sorted(originals), target))

    def publish(self, snapshot_id, expected_previous, target, *, restore):
        self.publishes.append((snapshot_id, expected_previous, target, restore))
        if self.published.snapshot_id != expected_previous:
            raise ComparisonImportError(
                "Published generation changed; review the current one"
            )
        previous = self.published.snapshot_id
        self.published = refresh.Published(
            snapshot_id,
            datetime.now(UTC),
            self.published.sources,
            self.published.races,
            self.published.coverage,
            0,
        )
        return {"previous": previous, "current": snapshot_id}

    def steps(self):
        return refresh.Steps(command.prepare_from_files, self.stage, self.publish)


def check(production, official, *, execute=True, retained=None, today=TODAY):
    return refresh.run(
        target="production",
        execute=execute,
        read=production.read,
        steps=production.steps(),
        today=today,
        windows=(WINDOW,),
        download=official,
        retained=retained,
    )


@pytest.fixture
def current(tmp_path):
    return published_from(prepared(tmp_path, files()))


def test_unchanged_official_files_do_nothing(current):
    production = Production(current)
    code, finding = check(production, Official(files()))
    assert code == 0
    assert finding["elections"][0]["status"] == "unchanged"
    assert production.staged == [] and production.publishes == []
    assert production.published.snapshot_id == current.snapshot_id


def test_a_changed_status_page_alone_is_not_a_new_count(current):
    page = files()["home.html"] + b"<p>Updated 4:02 PM</p>"
    production = Production(current)
    code, finding = check(production, Official(files(**{"home.html": page})))
    assert code == 0 and finding["elections"][0]["status"] == "unchanged"
    assert production.publishes == []


def test_canvass_change_publishes_with_the_current_pointer_as_expected_previous(
    current,
):
    production = Production(current)
    canvass = precinct(ellison=390)
    official = Official(
        files(
            **{
                "allracesbyprecinct.txt": canvass,
                "allracesbycounty.txt": canvass.replace(b";0005;", b";;"),
            }
        )
    )
    code, finding = check(production, official)
    result = finding["elections"][0]
    assert code == 0 and result["status"] == "published", finding
    assert result["restore_to"] == current.snapshot_id
    new = result["candidate"]
    assert new != current.snapshot_id
    assert production.staged == [(new, sorted(files()), "production")]
    assert production.publishes == [(new, current.snapshot_id, "production", False)]
    assert production.published.snapshot_id == new
    assert result["changed_files"] == ["allracesbycounty.txt", "allracesbyprecinct.txt"]


def test_dry_run_prepares_but_never_writes(current):
    production = Production(current)
    canvass = precinct(ellison=390)
    official = Official(
        files(
            **{
                "allracesbyprecinct.txt": canvass,
                "allracesbycounty.txt": canvass.replace(b";0005;", b";;"),
            }
        )
    )
    code, finding = check(production, official, execute=False)
    assert code == 0 and finding["elections"][0]["status"] == "ready_to_publish"
    assert production.staged == [] and production.publishes == []


def test_a_concurrent_writer_makes_publication_refuse_visibly(current):
    production = Production(current)
    canvass = precinct(ellison=390)
    official = Official(
        files(
            **{
                "allracesbyprecinct.txt": canvass,
                "allracesbycounty.txt": canvass.replace(b";0005;", b";;"),
            }
        )
    )
    other = "f" * 64

    def read(key):
        # The run read the pointer; another writer publishes before our swap.
        return current

    production.read = read
    production.published = refresh.Published(
        other, current.fetched_at, current.sources, current.races, current.coverage, 0
    )
    code, finding = check(production, official)
    assert code == 1
    assert finding["elections"][0]["reason"] == "publication_refused"
    assert production.published.snapshot_id == other
    assert finding["results"][0]["status"] == "failed"


@pytest.mark.parametrize("status", [404, 403, None])
def test_a_missing_vote_file_fails_closed_and_visibly(current, status):
    production = Production(current)
    code, finding = check(
        production, Official(files(), statuses={"allracesbyprecinct.txt": status})
    )
    assert code == 1
    result = finding["elections"][0]
    assert result["reason"] == "download_incomplete"
    assert result["files"] == [
        {"file": "allracesbyprecinct.txt", "http_status": status}
    ]
    assert production.staged == [] and production.publishes == []
    assert (
        finding["finding_key"] and finding["results"][0]["source"] == "election-results"
    )


def test_a_blocked_status_page_uses_only_the_verified_retained_copy(current):
    canvass = precinct(ellison=390)
    changed = files(
        **{
            "allracesbyprecinct.txt": canvass,
            "allracesbycounty.txt": canvass.replace(b";0005;", b";;"),
        }
    )
    blocked = Official(changed, statuses={"home.html": 302})
    retained = {hashlib.sha256(files()["home.html"]).hexdigest(): files()["home.html"]}

    production = Production(current)
    code, finding = check(production, blocked, retained=retained.__getitem__)
    assert code == 0 and finding["elections"][0]["status"] == "published"
    assert finding["elections"][0]["context_pages_retained"] == ["home.html"]

    production = Production(current)
    code, finding = check(production, blocked, retained=None)
    assert code == 1
    assert finding["elections"][0]["reason"] == "context_page_unavailable"
    assert production.publishes == []

    production = Production(current)
    code, finding = check(
        production, blocked, retained=lambda h: b"not the retained page"
    )
    assert code == 1
    assert finding["elections"][0]["reason"] == "source_bytes_changed_after_check"
    assert production.publishes == []


def test_a_changed_candidate_register_needs_a_person(current):
    register = files()["cand.txt"] + b""
    register = register.replace(b"Keith Ellison", b"Keith M. Ellison")
    production = Production(current)
    code, finding = check(production, Official(files(**{"cand.txt": register})))
    assert code == 1
    assert finding["elections"][0]["reason"] == "candidate_register_changed"
    assert production.staged == [] and production.publishes == []


def test_a_race_that_stops_reconciling_is_not_published(current):
    # County summary no longer agrees with the precinct rows.
    production = Production(current)
    code, finding = check(
        production,
        Official(files(**{"allracesbyprecinct.txt": precinct(ellison=390)})),
    )
    assert code == 1
    assert finding["elections"][0]["reason"] == "race_reconciliation_failed"
    assert production.staged == [] and production.publishes == []


def test_importer_refusal_is_reported_without_publishing(current):
    test_page = b'<h1>Test Results</h1><p>General election November 3, 2026 unofficial</p><a href="?ersElectionId=201">Results</a>'
    canvass = precinct(ellison=390)
    production = Production(current)
    code, finding = check(
        production,
        Official(
            files(
                **{
                    "home.html": test_page,
                    "allracesbyprecinct.txt": canvass,
                    "allracesbycounty.txt": canvass.replace(b";0005;", b";;"),
                }
            )
        ),
    )
    assert code == 1
    assert finding["elections"][0]["reason"] == "prepare_refused"
    assert "test data" in finding["elections"][0]["check"]
    assert production.publishes == []


def test_recorded_outcomes_or_no_first_publication_stop_before_download(current):
    official = Official(files())
    for published, reason in (
        (
            published_from_decisions(current),
            "outcome_decisions_on_published_generation",
        ),
        (None, "no_published_generation"),
    ):
        production = Production(current)
        production.read = lambda key, p=published: p
        code, finding = check(production, official)
        assert code == 1 and finding["elections"][0]["reason"] == reason
    assert official.calls == 0


def published_from_decisions(current):
    return refresh.Published(
        current.snapshot_id,
        current.fetched_at,
        current.sources,
        current.races,
        current.coverage,
        1,
    )


def test_changed_race_identity_or_authority_is_refused(current, tmp_path):
    canvass = precinct(ellison=390)
    new = prepared(
        tmp_path,
        files(
            **{
                "allracesbyprecinct.txt": canvass,
                "allracesbycounty.txt": canvass.replace(b";0005;", b";;"),
            }
        ),
    )
    refresh.compare_generation(current, new)
    race_id = next(iter(current.races))
    for field, value, reason in (
        ("candidates", ['"other"'], "candidacies_changed"),
        ("authority", "state", "canvassing_authority_changed"),
    ):
        races = {race_id: {**current.races[race_id], field: value}}
        changed = refresh.Published(
            current.snapshot_id,
            current.fetched_at,
            current.sources,
            races,
            current.coverage,
            0,
        )
        with pytest.raises(refresh.RefreshStop) as stop:
            refresh.compare_generation(changed, new)
        assert stop.value.reason == reason
    extra = dict(current.races, **{"0" * 64: current.races[race_id]})
    with pytest.raises(refresh.RefreshStop) as stop:
        refresh.compare_generation(
            refresh.Published(
                current.snapshot_id,
                current.fetched_at,
                current.sources,
                extra,
                current.coverage,
                0,
            ),
            new,
        )
    assert stop.value.reason == "race_set_changed"


def test_window_closes_by_itself_and_registers_its_own_family(monkeypatch):
    from alethical.pipeline import record_refresh

    assert refresh.active_windows(date(2026, 11, 2), (WINDOW,)) == []
    assert refresh.active_windows(date(2026, 11, 3), (WINDOW,)) == [WINDOW]
    assert refresh.active_windows(date(2027, 1, 1), (WINDOW,)) == []
    monkeypatch.setattr(refresh, "WINDOWS", (WINDOW,))
    inside = record_refresh.jobs(datetime(2026, 11, 23, 18, tzinfo=UTC))
    job = inside[record_refresh.ELECTION_RESULTS_JOB]
    assert job.interval == timedelta(days=1)
    assert "--execute" in job.arguments
    assert record_refresh.job_family(job.name) == "elections"
    # 01:00 UTC on January 1 is still December 31 in Minnesota.
    assert record_refresh.ELECTION_RESULTS_JOB in record_refresh.jobs(
        datetime(2027, 1, 1, 1, tzinfo=UTC)
    )
    assert record_refresh.ELECTION_RESULTS_JOB not in record_refresh.jobs(
        datetime(2027, 1, 1, 7, tzinfo=UTC)
    )
    # Outside every window nothing runs, and the run still reports success.
    production = Production(None)
    code, finding = check(production, Official({}), today=date(2027, 1, 2))
    assert code == 0 and finding["elections"] == []


def test_family_is_off_until_listed(monkeypatch):
    from alethical.pipeline import record_refresh

    monkeypatch.setattr(refresh, "WINDOWS", (WINDOW,))
    monkeypatch.setenv("ALETHICAL_SOURCE_REFRESH_FAMILIES", '["supporting"]')
    assert not record_refresh.enabled_job(record_refresh.ELECTION_RESULTS_JOB)
    monkeypatch.setenv("ALETHICAL_SOURCE_REFRESH_FAMILIES", '["elections"]')
    assert record_refresh.enabled_job(record_refresh.ELECTION_RESULTS_JOB)
