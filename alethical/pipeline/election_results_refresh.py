"""Daily check of official election returns during each election's counting window.

Each run downloads the published generation's official files again into a new
folder, prepares them with the existing offline importer and compares the result
with the published generation. Unchanged files do nothing. Changed files are
staged and published through the existing compare-and-swap pointer, so the
previous generation stays restorable with one ``--restore`` command.

Automatic publication is limited to a canvass or recount that changes vote
records inside the same races and candidacies. Anything else stops before
staging and fails visibly: a missing or partial download, a changed candidate
register, a race or candidacy that appears or disappears, a race that stops
reconciling, a changed canvassing authority, more excluded rows, a changed
precinct register, or recorded outcome decisions on the published generation.
Precinct totals above the reported voter count are reported, not blocked. When
the status page or statute cannot be read again, the hash-verified copy retained
with the published generation is used; every vote file must be fresh. This
module never records an outcome or marks a winner certified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.pipeline.election_source_capture import collect

MINNESOTA = ZoneInfo("America/Chicago")
OFFICIAL_HOSTS = frozenset(
    {
        "electionresultsfiles.sos.mn.gov",
        "electionresults.sos.mn.gov",
        "www.revisor.mn.gov",
    }
)
#: The two candidate registers. Finance collections and account reviews pin the
#: published register's exact bytes, so a changed register needs a person first.
CANDIDATE_REGISTERS = frozenset({"cand.txt", "LocalCandTbl.txt"})
#: The importer's own per-file limit (``load_sources``).
MAX_SOURCE_BYTES = 100_000_000


@dataclass(frozen=True)
class ResultsWindow:
    """One election whose published returns are rechecked once a day.

    ``checks_until`` is the last Minnesota calendar day of automatic checks. It
    covers the county and state canvasses, certification and the recount period
    in which the Secretary of State amends the official files.
    """

    election_id: str
    election_date: date
    stage: str
    include_local: bool
    checks_until: date

    @property
    def election_key(self) -> str:
        return f"mn-{self.election_date.isoformat()}-{self.stage}"

    def active(self, today: date) -> bool:
        return self.election_date <= today <= self.checks_until


WINDOWS: tuple[ResultsWindow, ...] = (
    # The results home page says the State Canvassing Board met on Thursday,
    # November 19, 2026 to certify state and federal results, and that recounted
    # results amend the official files afterwards. December 31 leaves room for
    # recounts requested after that canvass.
    ResultsWindow("201", date(2026, 11, 3), "general", True, date(2026, 12, 31)),
)


def minnesota_today(now: datetime | None = None) -> date:
    return (now or datetime.now(MINNESOTA)).astimezone(MINNESOTA).date()


def active_windows(today: date, windows=WINDOWS) -> list[ResultsWindow]:
    return [window for window in windows if window.active(today)]


class RefreshStop(Exception):
    """A code-owned reason this run publishes nothing."""

    def __init__(self, reason: str, **facts):
        super().__init__(reason)
        self.reason = reason
        self.facts = facts


@dataclass(frozen=True)
class Published:
    snapshot_id: str
    fetched_at: datetime
    sources: list[dict]
    races: dict[str, dict]
    coverage: dict
    outcome_decisions: int
    #: Generations of this election already published with a later observation
    #: than the current one: nonzero after a deliberate restore.
    newer_published: int = 0


def _candidate_ids(candidates) -> list[str]:
    # A write-in aggregate can carry a null ID; keep it distinct from any string.
    return sorted(json.dumps(c.get("candidate_id")) for c in candidates or [])


def race_signature(result_status: str, payload: dict) -> dict:
    authority = payload.get("expected_certification_authority") or {}
    return {
        "result_status": result_status,
        "candidates": _candidate_ids(payload.get("candidates")),
        "authority": authority.get("level") or "unknown",
    }


def read_published(db: Session, election_key: str) -> Published | None:
    current = db.get(m.ElectionComparisonCurrent, election_key)
    if current is None:
        return None
    snapshot = db.get(m.ElectionComparisonSnapshot, current.snapshot_id)
    race = m.ElectionComparisonRace
    races = {
        row.id: race_signature(
            row.result_status,
            {
                "candidates": row.candidates,
                "expected_certification_authority": {"level": row.authority},
            },
        )
        for row in db.execute(
            select(
                race.id,
                race.result_status,
                race.payload["candidates"].label("candidates"),
                race.payload["expected_certification_authority"]["level"].astext.label(
                    "authority"
                ),
            ).where(race.snapshot_id == snapshot.id)
        )
    }
    decisions = len(
        db.scalars(
            select(m.ElectionOutcomeDecision.id).where(
                m.ElectionOutcomeDecision.snapshot_id == snapshot.id
            )
        ).all()
    )
    newer = len(
        db.scalars(
            select(m.ElectionComparisonSnapshot.id).where(
                m.ElectionComparisonSnapshot.election_key == election_key,
                m.ElectionComparisonSnapshot.first_published_at.is_not(None),
                m.ElectionComparisonSnapshot.fetched_at > snapshot.fetched_at,
            )
        ).all()
    )
    return Published(
        snapshot.id,
        snapshot.fetched_at,
        list(snapshot.sources),
        races,
        dict(snapshot.coverage),
        decisions,
        newer,
    )


class _Visible(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        self.hidden += tag in ("script", "style")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def _bot_check(body: bytes) -> bool:
    """A challenge page, by the visible words the importer also refuses."""
    parser = _Visible()
    parser.feed(body.decode("utf-8", errors="replace"))
    text = " ".join(" ".join(parser.parts).split()).lower()
    return "captcha" in text or "access denied" in text


def capture_manifest(published: Published, window: ResultsWindow) -> list[dict]:
    """Request exactly the files the published generation was built from."""
    requests = []
    for source in published.sources:
        url, name = source.get("url"), source.get("file")
        host = urlsplit(url or "").hostname
        if host not in OFFICIAL_HOSTS or not name:
            raise RefreshStop("unofficial_source_in_published_generation", file=name)
        requests.append({"id": name, "url": url, "allowed_hosts": [host]})
    return requests


def status_file(published: Published, window: ResultsWindow) -> str:
    home = f"https://electionresults.sos.mn.gov/{window.election_date:%Y%m%d}"
    names = [s["file"] for s in published.sources if s.get("url") == home]
    if len(names) != 1:
        raise RefreshStop("status_page_missing_from_published_generation")
    return names[0]


def _context_files(published: Published, window: ResultsWindow) -> set[str]:
    """The status page and statute describe the count; they are not vote records."""
    statute = (
        f"https://www.revisor.mn.gov/statutes/{window.election_date.year}/cite/204C.33"
    )
    return {status_file(published, window)} | {
        s["file"] for s in published.sources if s.get("url") == statute
    }


def write_prepare_inputs(
    sources: list[dict], capture_dir: Path, prepare_dir: Path
) -> Path:
    """Name each verified file as the importer expects, with its manifest.

    A fresh capture carries its own observation time. A retained context page
    keeps the published generation's metadata and bytes, with no new time.
    """
    prepare_dir.mkdir()
    manifest = []
    for source in sources:
        if "retained_body" in source:
            body = source["retained_body"]
        else:
            body = (capture_dir / source["capture_file"]).read_bytes()
        if (
            hashlib.sha256(body).hexdigest() != source["sha256"]
            or len(body) != source["bytes"]
        ):
            raise RefreshStop("source_bytes_changed_after_check", file=source["file"])
        (prepare_dir / source["file"]).write_bytes(body)
        manifest.append(
            {
                k: source[k]
                for k in (
                    "url",
                    "file",
                    "sha256",
                    "bytes",
                    "fetched_at",
                    "content_type",
                    "last_modified",
                )
                if source.get(k)
            }
        )
    path = prepare_dir / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2) + "\n")
    return path


def compare_generation(published: Published, generation: dict) -> dict:
    """Refuse anything a canvass or recount of the same candidacies would not do."""
    fresh = {
        race["id"]: race_signature(race["result_status"], race["payload"])
        for race in generation["races"]
    }
    if set(fresh) != set(published.races):
        raise RefreshStop(
            "race_set_changed",
            added=len(set(fresh) - set(published.races)),
            removed=len(set(published.races) - set(fresh)),
        )
    for key, label in (
        ("candidates", "candidacies_changed"),
        ("authority", "canvassing_authority_changed"),
    ):
        changed = sum(fresh[r][key] != published.races[r][key] for r in fresh)
        if changed:
            raise RefreshStop(label, races=changed)
    stopped = sum(
        published.races[r]["result_status"] == "unofficial"
        and fresh[r]["result_status"] != "unofficial"
        for r in fresh
    )
    if stopped:
        raise RefreshStop("race_reconciliation_failed", races=stopped)
    old, new = published.coverage, generation["coverage"]
    if new.get("registered_precincts") != old.get("registered_precincts"):
        raise RefreshStop("precinct_register_changed")
    for key in ("excluded_rows", "excluded_summary_rows"):
        if len(new.get(key, [])) > len(old.get(key, [])):
            raise RefreshStop("more_excluded_rows", kind=key)

    def discrepancies(coverage):
        bound = coverage.get("comparison_checks", {}).get("precinct_voter_bound", {})
        return bound.get("discrepancy_count")

    # Precinct totals above the reported voter count are official figures the
    # comparison already shows with their scope; a canvass can add or remove
    # one. They are reported, never corrected and never a reason to keep
    # pre-canvass totals live.
    before, after = discrepancies(old), discrepancies(new)
    if after is None:
        raise RefreshStop("precinct_voter_check_missing")
    return {"precinct_voter_discrepancies": {"before": before, "after": after}}


@dataclass(frozen=True)
class Steps:
    """The existing operator commands, injected so tests can observe them."""

    prepare: Callable[[argparse.Namespace], tuple[dict, dict[str, bytes]]]
    stage: Callable[[dict, dict[str, bytes], str], None]
    publish: Callable[..., dict]


def refresh_window(
    window: ResultsWindow,
    *,
    read: Callable[[str], Published | None],
    steps: Steps,
    target: str,
    execute: bool,
    workdir: Path,
    download=collect,
    retained: Callable[[str], bytes] | None = None,
) -> dict:
    """Return one code-owned result; raise ``RefreshStop`` before any write."""
    published = read(window.election_key)
    if published is None:
        # A first publication stays a reviewed manual release.
        raise RefreshStop("no_published_generation")
    requests = capture_manifest(published, window)
    context = _context_files(published, window)
    capture_dir = workdir / "capture"
    inventory = download(requests, capture_dir, max_bytes=MAX_SOURCE_BYTES)
    receipts = {r["id"]: r for r in inventory["sources"]}
    home = status_file(published, window)
    if receipts.get(home, {}).get("state") == "captured" and _bot_check(
        (capture_dir / receipts[home]["file"]).read_bytes()
    ):
        # A challenge page served with HTTP 200 is a refused read, not a
        # status page; it is treated like any other failed context fetch.
        receipts[home] = {**receipts[home], "state": "bot_check"}
    failed = sorted(
        name
        for name in (r["id"] for r in requests)
        if receipts.get(name, {}).get("state") != "captured"
    )
    vote_failures = [name for name in failed if name not in context]
    if vote_failures:
        # Every vote record must be a fresh, complete download.
        raise RefreshStop(
            "download_incomplete",
            files=[
                {"file": name, "http_status": receipts.get(name, {}).get("http_status")}
                for name in vote_failures
            ],
        )
    held = {s["file"]: s for s in published.sources}
    changed = sorted(
        name
        for name in held
        if name not in context and receipts[name]["sha256"] != held[name]["sha256"]
    )
    result = {
        "election_key": window.election_key,
        "published": published.snapshot_id,
        "observed_at": max(
            receipts[name]["fetched_at"] for name in held if name not in failed
        ),
        "changed_files": changed,
        "context_pages_retained": failed,
    }
    if not changed:
        return {**result, "status": "unchanged"}
    # Both holds below matter only when there is something to publish.
    if published.newer_published:
        # Someone restored an older generation on purpose; publishing forward
        # would undo that. A person decides, then removes this hold by
        # publishing forward or by stopping the job.
        raise RefreshStop(
            "current_generation_was_restored", newer=published.newer_published
        )
    if published.outcome_decisions:
        # Outcome decisions belong to the exact published generation.
        raise RefreshStop(
            "outcome_decisions_on_published_generation",
            decisions=published.outcome_decisions,
        )
    if CANDIDATE_REGISTERS & set(changed):
        raise RefreshStop(
            "candidate_register_changed",
            files=sorted(CANDIDATE_REGISTERS & set(changed)),
        )
    sources = []
    for name, source in held.items():
        if name in failed:
            # The status page or statute could not be read again (the state's
            # bot check can refuse it). Use the hash-verified copy retained
            # with the published generation, never an unverified page.
            if retained is None:
                raise RefreshStop("context_page_unavailable", file=name)
            try:
                body = retained(source["sha256"])
            except Exception as error:
                raise RefreshStop(
                    "context_page_unavailable", file=name, error=type(error).__name__
                ) from error
            sources.append({**source, "retained_body": body})
            continue
        receipt = receipts[name]
        sources.append(
            {
                "url": receipt["requested_url"],
                "file": name,
                "sha256": receipt["sha256"],
                "bytes": receipt["bytes"],
                "fetched_at": receipt["fetched_at"],
                "content_type": receipt.get("content_type"),
                "last_modified": receipt.get("last_modified"),
                "capture_file": receipt["file"],
            }
        )
    manifest = write_prepare_inputs(sources, capture_dir, workdir / "prepare")
    try:
        generation, originals = steps.prepare(
            argparse.Namespace(
                directory=workdir / "prepare",
                manifest=manifest,
                election_id=window.election_id,
                election_date=window.election_date,
                stage=window.stage,
                status_file=status_file(published, window),
                include_local=window.include_local,
            )
        )
    except (ValueError, KeyError, OSError) as error:
        # The importer's own refusals name a check, never source text or
        # credentials; any other error is reported by its type only.
        check = (
            str(error)[:200]
            if isinstance(error, ComparisonImportError)
            else type(error).__name__
        )
        raise RefreshStop("prepare_refused", check=check) from error
    if generation["id"] == published.snapshot_id:
        return {**result, "status": "unchanged"}
    result.update(compare_generation(published, generation))
    result.update(
        candidate=generation["id"],
        races=len(generation["races"]),
        reconciled_races=generation["coverage"]["reconciled_races"],
    )
    if not execute:
        return {**result, "status": "ready_to_publish"}
    try:
        steps.stage(generation, originals, target)
        # The pointer read at the start is the expected previous value, so a
        # concurrent writer makes this refuse instead of being overwritten.
        receipt = steps.publish(
            generation["id"], published.snapshot_id, target, restore=False
        )
    except ComparisonImportError as error:
        raise RefreshStop("publication_refused", check=str(error)[:200]) from error
    if receipt.get("current") != generation["id"] or (
        receipt.get("previous") != published.snapshot_id
    ):
        raise RefreshStop("publication_receipt_mismatch")
    after = read(window.election_key)
    if after is None or after.snapshot_id != generation["id"]:
        raise RefreshStop("publication_read_back_mismatch")
    return {**result, "status": "published", "restore_to": published.snapshot_id}


def run(
    *,
    target: str,
    execute: bool,
    read: Callable[[str], Published | None],
    steps: Steps,
    today: date | None = None,
    windows=WINDOWS,
    download=collect,
    retained: Callable[[str], bytes] | None = None,
) -> tuple[int, dict]:
    """Check every active window; return an exit code and a public-safe finding."""
    today = today or minnesota_today()
    results = []
    for window in active_windows(today, windows):
        with tempfile.TemporaryDirectory(prefix="election-results-") as directory:
            try:
                results.append(
                    refresh_window(
                        window,
                        read=read,
                        steps=steps,
                        target=target,
                        execute=execute,
                        workdir=Path(directory),
                        download=download,
                        retained=retained,
                    )
                )
            except RefreshStop as stop:
                results.append(
                    {
                        "election_key": window.election_key,
                        "status": "failed",
                        "reason": stop.reason,
                        **stop.facts,
                    }
                )
    failed = [r for r in results if r["status"] == "failed"]
    finding = {
        "status": "failed" if failed else "complete",
        "today": today.isoformat(),
        "elections": results,
        "results": [
            {
                "source": "election-results",
                "status": "failed",
                "finding_key": hashlib.sha256(
                    f"{r['election_key']}:{r['reason']}".encode()
                ).hexdigest()[:16],
            }
            for r in failed
        ],
    }
    if failed:
        finding["finding_key"] = hashlib.sha256(
            "|".join(f"{r['election_key']}:{r['reason']}" for r in failed).encode()
        ).hexdigest()[:16]
    return (1 if failed else 0), finding
