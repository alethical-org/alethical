from __future__ import annotations

import hashlib
import json
import random
from collections import Counter
from pathlib import Path

import pytest

from scripts import national_fcc_collect as collect

GAP = collect.CONFIRM_GAP_SECONDS


def outcome(o, t, **extra):
    return {"k": "TV|1|f", "o": o, "t": t, **extra}


def test_a_saved_pdf_settles_the_filing_even_after_earlier_refusals():
    state = collect.latest_state(
        [outcome("missing", 0), outcome("saved", 10, sha="a" * 64, b=5, p=1)]
    )["TV|1|f"]
    assert collect.settled(state) == "saved"


def test_one_refusal_never_confirms_a_filing_unavailable():
    state = collect.latest_state([outcome("missing", 0, h=401)])["TV|1|f"]
    assert collect.settled(state) is None
    assert not collect.due(state, GAP - 1)
    assert collect.due(state, GAP)


def test_two_refusals_must_be_far_enough_apart():
    close = collect.latest_state(
        [outcome("missing", 0, h=404), outcome("missing", GAP - 1, h=404)]
    )
    assert collect.settled(close["TV|1|f"]) is None
    apart = collect.latest_state(
        [outcome("missing", 0, h=404), outcome("unreadable", GAP, h=200, v=2)]
    )
    assert collect.settled(apart["TV|1|f"]) == "unavailable"


def test_temporary_failures_prove_nothing_and_are_retried_with_backoff():
    rows = [outcome("retry", 0, err="HTTP 503") for _ in range(20)]
    state = collect.latest_state(rows)["TV|1|f"]
    assert collect.settled(state) is None
    assert state["verdicts"] == []
    assert not collect.due(state, 60)
    assert collect.due(state, 6 * 3600)


def test_pdf_check_rejects_html_and_counts_pages(tmp_path: Path):
    from pypdf import PdfWriter

    html = tmp_path / "error.part"
    html.write_bytes(b"<html>Not found</html>")
    with pytest.raises(ValueError):
        collect.pdf_pages(html)
    pdf = tmp_path / "ok.part"
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_blank_page(width=72, height=72)
    with pdf.open("wb") as out:
        writer.write(out)
    assert collect.pdf_pages(pdf) == 2


def test_run_ids_cannot_escape_the_recovery_folder():
    assert collect.run_prefix("census-20261119").endswith("/recovery/census-20261119")
    with pytest.raises(ValueError):
        collect.run_prefix("../originals")


def test_compressed_outcome_files_round_trip():
    rows = [outcome("saved", 1, sha="b" * 64, b=9, p=3), outcome("retry", 2)]
    assert list(collect.read_gz_lines(collect.gz_lines(rows))) == rows


# ---------------------------------------------------------------- source answers

MANAGER = "0e069b78-34f1-2c57-5a3f-340160a7ea54"
ALTERNATE = "1e069b78-34f1-2c57-5a3f-340160a7ea55"


def pdf_bytes(pages=1):
    import io

    from pypdf import PdfWriter

    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=72, height=72)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


class FakeStore:
    def __init__(self):
        self.saved = []

    def save_pdf(self, path, sha, size):
        assert path.read_bytes()[:5] == b"%PDF-"
        self.saved.append((sha, size))


def run_check(tmp_path, routes, monkeypatch, limit=collect.MAX_FILE_BYTES):
    import httpx

    monkeypatch.setattr(collect.Pace, "wait", lambda self: None)
    seen = []

    def handler(request):
        seen.append(str(request.url))
        for prefix, answer in routes.items():
            if str(request.url).startswith(prefix):
                return answer() if callable(answer) else answer
        return httpx.Response(599)

    store = FakeStore()
    row = {"k": "TV|1|file-1", "m": MANAGER, "f": "file-1", "e": "1"}
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        result = collect.check(row, http, collect.Pace(8, 8), store, tmp_path, limit)
    return result, store, seen


def download_url(manager):
    return collect.DOWNLOAD.format(manager=manager)


DETAIL = "https://publicfiles.fcc.gov/api/manager/file/id/file-1.json"


def test_refusal_with_no_other_address_is_a_missing_candidate(tmp_path, monkeypatch):
    import httpx

    result, store, seen = run_check(
        tmp_path,
        {
            download_url(MANAGER): httpx.Response(401),
            DETAIL: httpx.Response(400, json={"statusMessage": "Invalid File ID"}),
        },
        monkeypatch,
    )
    assert (result["o"], result["h"], result["v"]) == ("missing", 401, 2)
    assert store.saved == [] and len(seen) == 2


def test_unreadable_bytes_try_the_fcc_file_record_before_any_verdict(
    tmp_path, monkeypatch
):
    import httpx

    good = pdf_bytes(3)
    result, store, _ = run_check(
        tmp_path,
        {
            download_url(MANAGER): httpx.Response(200, content=b"%PDF-1.4 broken"),
            DETAIL: httpx.Response(
                200, json={"file": {"file_id": "file-1", "file_manager_id": ALTERNATE}}
            ),
            download_url(ALTERNATE): httpx.Response(200, content=good),
        },
        monkeypatch,
    )
    assert (result["o"], result["p"], result["mg"]) == ("saved", 3, ALTERNATE)
    assert store.saved == [(result["sha"], len(good))]


def test_unreadable_without_an_alternate_is_marked_with_this_version(
    tmp_path, monkeypatch
):
    import httpx

    result, _, _ = run_check(
        tmp_path,
        {
            download_url(MANAGER): httpx.Response(200, content=b"not a pdf at all"),
            DETAIL: httpx.Response(
                200, json={"file": {"file_id": "file-1", "file_manager_id": MANAGER}}
            ),
        },
        monkeypatch,
    )
    assert (result["o"], result["v"]) == ("unreadable", 2)


@pytest.mark.parametrize(
    "answer, reason",
    [
        (
            {
                "status_code": 200,
                "headers": {"content-type": "text/html"},
                "content": b"<html>Please verify you are human</html>",
            },
            "web page",
        ),
        ({"status_code": 400}, "unexpected HTTP 400"),
        (
            {
                "status_code": 403,
                "headers": {"content-type": "text/html"},
                "content": b"<html>Forbidden</html>",
            },
            "unexpected HTTP 403",
        ),
        (
            {"status_code": 302, "headers": {"location": "https://example.com/x"}},
            "redirect away",
        ),
        ({"status_code": 502}, "HTTP 502"),
        (
            {
                "status_code": 200,
                "headers": {"content-length": "999"},
                "content": b"%PDF-short",
            },
            "ended early",
        ),
    ],
)
def test_answers_that_say_nothing_about_the_filing_are_retried(
    tmp_path, monkeypatch, answer, reason
):
    import httpx

    result, _, _ = run_check(
        tmp_path, {download_url(MANAGER): httpx.Response(**answer)}, monkeypatch
    )
    assert result["o"] == "retry" and reason in result["err"]


def test_large_files_go_to_their_own_lane_and_never_count_as_refusals(
    tmp_path, monkeypatch
):
    import httpx

    result, _, _ = run_check(
        tmp_path,
        {
            download_url(MANAGER): httpx.Response(
                200, headers={"content-length": "4096"}, content=b"x" * 4096
            )
        },
        monkeypatch,
        limit=10,
    )
    assert (result["o"], result["b"]) == ("oversize", 4096)
    state = collect.latest_state([result])["TV|1|file-1"]
    assert collect.settled(state) is None and state["verdicts"] == []
    assert not collect.due(state, 10**10) and collect.due(state, 0, oversize_lane=True)


def test_outcomes_from_the_first_version_are_rechecked_not_confirmed():
    old = [
        outcome("unreadable", 0, h=200),
        outcome("unreadable", GAP, h=200),
        outcome("missing", 2 * GAP, h="redirect-away"),
    ]
    state = collect.latest_state(old)["TV|1|f"]
    assert state["verdicts"] == [] and collect.settled(state) is None
    assert collect.due(state, 3 * GAP)
    replayed = collect.latest_state(old + old)["TV|1|f"]
    assert replayed["verdicts"] == []


# ---------------------------------------------------------------- scratch database
#
# The in-memory reference below is the command logic the SQL path replaced: it folds
# outcome rows with latest_state, settled and due and walks the work list in Python.

RUN = "census-test"
PREFIX = collect.run_prefix(RUN)


def memory_queue(work, results, now, lane=False):
    state = collect.latest_state(results)
    queue = [
        r
        for r in work
        if "held" not in r
        and (
            (r["k"] not in state and not lane)
            or (
                r["k"] in state
                and collect.settled(state[r["k"]]) is None
                and collect.due(state[r["k"]], now, lane)
            )
        )
    ]
    # Never-checked first, newest folder year first and no year last; then retries.
    # Each in work-list order.
    queue.sort(
        key=lambda r: (r["k"] in state, -(r.get("y") or 0) * (r["k"] not in state))
    )
    return [(r["k"], r["m"]) for r in queue]


def memory_status(work, results):
    state = collect.latest_state(results)
    tally, years, shas, saved_bytes = Counter(), Counter(), set(), 0
    for row in work:
        if "held" in row:
            tally["held_" + row["held"]] += 1
            continue
        entry = state.get(row["k"])
        if entry is None:
            tally["not_checked"] += 1
            years[row.get("y", 0)] += 1
            continue
        verdict = collect.settled(entry)
        if verdict == "saved":
            tally["saved"] += 1
            if entry["final"]["sha"] not in shas:
                shas.add(entry["final"]["sha"])
                saved_bytes += entry["final"]["b"]
        elif verdict == "unavailable":
            tally["confirmed_" + entry["last"]["o"]] += 1
        elif entry["last"]["o"] == "oversize":
            tally["oversize_waiting"] += 1
        elif not entry["verdicts"]:
            tally["retry_waiting"] += 1
        else:
            tally["awaiting_confirmation_" + entry["last"]["o"]] += 1
    return {
        "work_rows": len(work),
        "filings": dict(sorted(tally.items())),
        "not_checked_by_year": {
            str(year or "none"): years[year]
            for year in sorted(years, key=lambda y: -y or 1)
        },
        "distinct_saved_pdfs": len(shas),
        "distinct_saved_bytes": saved_bytes,
    }


def memory_export(work, results):
    state = collect.latest_state(results)
    for row in work:
        entry = state.get(row["k"])
        record = {"k": row["k"]}
        if "held" in row:
            record["held"] = row["held"]
            if "mn" in row:
                record["mn"] = row["mn"]
        elif entry is None:
            record["state"] = "not_checked"
        else:
            verdict = collect.settled(entry)
            record["state"] = verdict or "pending"
            if verdict == "saved":
                final = entry["final"]
                record |= {
                    "sha": final["sha"],
                    "b": final["b"],
                    "p": final["p"],
                    "t": final["t"],
                }
                if "mg" in final:
                    record["mg"] = final["mg"]
            elif verdict == "unavailable":
                record["why"] = entry["last"]["o"]
                record["t"] = max(entry["verdicts"])
        yield record


class ObjectStore:
    """Private R2 as a dictionary of object bodies."""

    def __init__(self):
        self.objects = {}

    def get(self, key):
        return self.objects[key]

    def get_optional(self, key):
        return self.objects.get(key)

    def keys(self, prefix):
        return [key for key in self.objects if key.startswith(prefix)]

    def put_small(self, key, body, content_type):
        self.objects[key] = body

    def put_file(self, key, path, content_type):
        self.objects[key] = Path(path).read_bytes()

    def download(self, key, path):
        Path(path).write_bytes(self.objects[key])


def put_worklist(store, rows):
    body = collect.gz_lines(rows)
    store.objects[f"{PREFIX}/worklist.jsonl.gz"] = body
    manifest = {
        "run_id": RUN,
        "rows": len(rows),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
    }
    store.objects[f"{PREFIX}/manifest.json"] = json.dumps(manifest).encode()


def put_results(store, name, rows):
    store.objects[f"{PREFIX}/results/{name}"] = collect.gz_lines(rows)


def sample_run(seed=7, filings=300, rows=1500):
    """Work rows (some held) and outcomes covering every rule: replayed duplicate
    rows, version-1 rows, other statuses, oversize, retries and refusals in time."""
    rng = random.Random(seed)
    work = []
    for i in range(filings):
        row = {"k": f"TV|{i % 37}|f{i}", "s": "TV", "e": i % 37, "f": f"f{i}"}
        row |= {"m": f"{i:08x}-0000-0000-0000-000000000000", "n": i}
        if i % 5:
            row["y"] = 2012 + i % 15  # the rest have no folder year
        if i % 23 == 0:
            row["held"] = "archive"
        elif i % 31 == 0:
            row |= {"held": "minnesota", "mn": f"mn{i}"}
        work.append(row)
    results = []
    for _ in range(rows):
        k = rng.choice(work[: filings * 2 // 3])["k"]
        t = rng.randrange(0, 3 * 86400)
        kind = rng.random()
        if kind < 0.12:
            sha = rng.choice("abcdef") * 64
            row = {"o": "saved", "sha": sha, "b": ord(sha[0]), "p": 2}
            if rng.random() < 0.3:
                row["mg"] = "alt"
        elif kind < 0.45:
            row = {"o": "missing", "h": rng.choice([401, 403, 404, 410, "redirect"])}
        elif kind < 0.6:
            row = {"o": "unreadable", "h": 200, "err": "x"}
        elif kind < 0.7:
            row = {"o": "oversize", "b": 10**9}
        else:
            row = {"o": "retry", "err": "HTTP 503"}
        row = {"k": k, "t": t} | row
        if rng.random() < 0.8:
            row["v"] = 2
        results.append(row)
    results += rng.sample(results, rows // 10)  # replayed outcome rows
    # Ten retries for 1 filing reach the 6-hour cap on the retry backoff.
    results += [
        {"k": "TV|28|f250", "t": 10**6 + i, "o": "retry", "v": 2} for i in range(10)
    ]
    return work, results


def census_for(tmp_path, store):
    return collect.Census(store, RUN, tmp_path / "scratch")


def check_equal(census, work, results):
    for now in (0, 86400, 2 * 86400, 4 * 86400, 10**6 + 16_000, 10**6 + 21_609, 10**9):
        for lane in (False, True):
            expected = memory_queue(work, results, now, lane)
            # Batches resume where the last stopped: every filing once, in order.
            for batch in (1, 7, 5000):
                got = [(r["k"], r["m"]) for r in census.queue(now, lane, batch=batch)]
                assert got == expected
            assert census.queue_size(now, lane) == len(expected)
    assert census.status() == memory_status(work, results)
    assert list(census.export_rows()) == list(memory_export(work, results))


def test_sql_state_matches_the_in_memory_rules(tmp_path):
    work, results = sample_run()
    store = ObjectStore()
    put_worklist(store, work)
    for n, start in enumerate(range(0, len(results), 400)):
        put_results(
            store, f"1700000000-1-{n:05d}.jsonl.gz", results[start : start + 400]
        )
    census = census_for(tmp_path, store)
    census.load(census.manifest())
    state = collect.latest_state(results)
    buckets = memory_status(work, results)["filings"]
    # The sample reaches every outcome the rules distinguish.
    assert {"saved", "retry_waiting", "oversize_waiting"} <= set(buckets)
    assert any(b.startswith("confirmed_") for b in buckets)
    assert any(b.startswith("awaiting_confirmation_") for b in buckets)
    check_equal(census, work, results)
    assert census.settled_count() == sum(
        1 for entry in state.values() if collect.settled(entry)
    )


def test_cached_outcomes_are_appended_or_reread_in_object_order(tmp_path):
    work, results = sample_run(seed=11)
    store = ObjectStore()
    put_worklist(store, work)
    put_results(store, "1700000000-1-00001.jsonl.gz", results[:600])
    census = census_for(tmp_path, store)
    census.load(census.manifest())
    # A later file is appended to what the scratch database already holds.
    put_results(store, "1700000100-1-00001.jsonl.gz", results[600:1200])
    census.load(census.manifest())
    check_equal(census, work, results[:1200])
    # A file that sorts between those already read makes it read all again.
    put_results(store, "1700000050-1-00001.jsonl.gz", results[1200:])
    reopened = census_for(tmp_path, store)
    reopened.load(reopened.manifest())
    check_equal(reopened, work, results[:600] + results[1200:] + results[600:1200])


def test_an_interrupted_change_is_rebuilt_from_the_cache(tmp_path):
    work, results = sample_run(seed=3)
    store = ObjectStore()
    put_worklist(store, work)
    put_results(store, "1700000000-1-00001.jsonl.gz", results)
    census = census_for(tmp_path, store)
    census.load(census.manifest())
    census.set_meta("dirty", "1")
    census.close()
    # Rebuilt from cached files: the bucket lists them but no longer serves them.
    bare = ObjectStore()
    bare.objects[f"{PREFIX}/manifest.json"] = store.objects[f"{PREFIX}/manifest.json"]
    bare.objects[f"{PREFIX}/results/1700000000-1-00001.jsonl.gz"] = b"unread"
    again = census_for(tmp_path, bare)
    again.load(again.manifest())
    check_equal(again, work, results)


def test_a_work_list_that_differs_from_its_manifest_is_refused(tmp_path):
    work, _ = sample_run()
    store = ObjectStore()
    put_worklist(store, work)
    store.objects[f"{PREFIX}/worklist.jsonl.gz"] = collect.gz_lines(work[:-1])
    census = census_for(tmp_path, store)
    with pytest.raises(ValueError):
        census.load(census.manifest())


# ---------------------------------------------------------------- inventory sync

M1 = "aaaaaaaa-0000-0000-0000-000000000001"
M2 = "bbbbbbbb-0000-0000-0000-000000000002"


def put_inventory(store, inventory_id, rows):
    body = collect.gz_lines(sorted(rows, key=lambda r: r["k"]))
    sha = hashlib.sha256(body).hexdigest()
    data_key = f"fcc-national/v1/inventory/sha256/{sha[:2]}/{sha}.jsonl.gz"
    manifest_key = f"fcc-national/v1/inventory/manifests/{inventory_id}.json"
    store.objects[data_key] = body
    store.objects[manifest_key] = json.dumps(
        {
            "format": 1,
            "inventory_id": inventory_id,
            "object_key": data_key,
            "sha256": sha,
            "bytes": len(body),
            "rows": len(rows),
            "through": "2026-11-18",
        }
    ).encode()
    store.objects[collect.INVENTORY_POINTER] = json.dumps(
        {"inventory_id": inventory_id, "manifest_key": manifest_key}
    ).encode()


def inv(k, m="", **extra):
    service, entity, file_id = k.split("|")
    return {"k": k, "s": service, "e": entity, "f": file_id, "m": m, **extra}


def first_part():
    return [
        {"k": "TV|1|a", "s": "TV", "e": "1", "f": "a", "m": M1, "n": 1},
        {"k": "TV|1|b", "s": "TV", "e": "1", "f": "b", "m": "", "n": 2},
        {"k": "TV|2|c", "s": "TV", "e": "2", "f": "c", "m": M1, "n": 3},
        {"k": "TV|2|d", "s": "TV", "e": "2", "f": "d", "m": M1, "n": 4},
        {"k": "TV|28010|e", "s": "TV", "e": "28010", "f": "e", "m": M1, "n": 5}
        | {"held": "minnesota", "mn": "h"},
        {"k": "TV|3|g", "s": "TV", "e": "3", "f": "g", "m": M1, "n": 6}
        | {"held": "archive"},
    ]


def test_sync_skips_quietly_until_an_inventory_exists(tmp_path):
    store = ObjectStore()
    put_worklist(store, first_part())
    census = census_for(tmp_path, store)
    assert census.sync_inventory()["sync"] == "skipped"
    assert "parts" not in json.loads(store.objects[f"{PREFIX}/manifest.json"])


def test_sync_appends_new_filings_and_newer_download_ids(tmp_path):
    store = ObjectStore()
    part1 = first_part()
    put_worklist(store, part1)
    put_results(
        store, "1700000000-1-00001.jsonl.gz", [outcome("retry", 0) | {"k": "TV|2|c"}]
    )
    new = [inv(f"CABLE|9|n{i:02d}", M2, z=i) for i in range(40)]
    put_inventory(
        store,
        "inv-1",
        [
            inv("TV|1|a", M1.upper()),  # the same id in capitals: no change
            inv("TV|1|b", M2),  # an id where the part had none
            inv("TV|2|c", M2),  # a newer id
            inv("TV|2|d", "not-a-uuid"),  # no usable id: keep the listed one
            inv("TV|3|g", M2),  # held, so never checked and not recorded
            inv("TV|28010|z", M2),  # a new Minnesota-station filing is checked
            *new,
        ],
    )
    census = census_for(tmp_path, store)
    assert census.sync_inventory() == {
        "sync": "appended",
        "inventory_id": "inv-1",
        "part": 2,
        "new": 41,
        "updates": 2,
        "years": 0,
    }
    manifest = json.loads(store.objects[f"{PREFIX}/manifest.json"])
    # Older readers still find part 1 under its unchanged top-level digest.
    assert (
        manifest["sha256"]
        == hashlib.sha256(store.objects[f"{PREFIX}/worklist.jsonl.gz"]).hexdigest()
    )
    assert [p["key"] for p in manifest["parts"]] == [
        "worklist.jsonl.gz",
        "worklist-2.jsonl.gz",
    ]
    body = store.objects[f"{PREFIX}/worklist-2.jsonl.gz"]
    assert manifest["parts"][1]["sha256"] == hashlib.sha256(body).hexdigest()
    rows = list(collect.read_gz_lines(body))
    added = [r for r in rows if "update" not in r]
    assert sorted(r["k"] for r in added) == sorted(
        [r["k"] for r in new] + ["TV|28010|z"]
    )
    assert added != sorted(added, key=lambda r: r["k"])  # the fixed shuffle
    assert all("held" not in r for r in added)
    assert added[[r["k"] for r in added].index("CABLE|9|n07")]["n"] == 7
    assert [(r["k"], r["m"]) for r in rows if "update" in r] == [
        ("TV|1|b", M2),
        ("TV|2|c", M2),
    ]

    # The next run checks part 1 first, with the newer ids, then part 2, then retries.
    reopened = census_for(tmp_path, store)
    reopened.load(reopened.manifest())
    queue = [(r["k"], r["m"]) for r in reopened.queue(10**9, batch=3)]
    assert queue[:3] == [("TV|1|a", M1), ("TV|1|b", M2), ("TV|2|d", M1)]
    assert [k for k, _ in queue[3:-1]] == [r["k"] for r in added]
    assert queue[-1] == ("TV|2|c", M2)
    assert reopened.status()["work_rows"] == 6 + 41

    # The same inventory again changes nothing; the same inputs give the same part.
    assert census_for(tmp_path, store).sync_inventory()["sync"] == "current"
    other = ObjectStore()
    put_worklist(other, part1)
    other.objects.update({k: v for k, v in store.objects.items() if "/inventory/" in k})
    census_for(tmp_path / "other", other).sync_inventory()
    assert other.objects[f"{PREFIX}/worklist-2.jsonl.gz"] == body


def test_a_later_inventory_adds_only_filings_no_part_holds(tmp_path):
    store = ObjectStore()
    put_worklist(store, first_part())
    put_inventory(store, "inv-1", [inv("CABLE|9|x", M2)])
    census = census_for(tmp_path, store)
    census.sync_inventory()
    put_inventory(store, "inv-2", [inv("CABLE|9|x", M2), inv("CABLE|9|y", M2)])
    assert census.sync_inventory()["new"] == 1
    put_inventory(store, "inv-3", [inv("CABLE|9|x", M2), inv("CABLE|9|y", M2)])
    assert census.sync_inventory() == {
        "sync": "nothing new",
        "inventory_id": "inv-3",
        "part": None,
        "new": 0,
        "updates": 0,
        "years": 0,
    }
    manifest = json.loads(store.objects[f"{PREFIX}/manifest.json"])
    assert len(manifest["parts"]) == 3 and manifest["synced_inventory"] == "inv-3"


def test_sync_refuses_an_inventory_that_fails_its_digest(tmp_path):
    store = ObjectStore()
    put_worklist(store, first_part())
    put_inventory(store, "inv-1", [inv("CABLE|9|x", M2)])
    manifest = json.loads(
        store.objects["fcc-national/v1/inventory/manifests/inv-1.json"]
    )
    store.objects[manifest["object_key"]] = collect.gz_lines([inv("CABLE|9|q", M2)])
    with pytest.raises(ValueError):
        census_for(tmp_path, store).sync_inventory()
    assert "parts" not in json.loads(store.objects[f"{PREFIX}/manifest.json"])


# ---------------------------------------------------------------- newest years first


def folder(year):
    return f"Political Files/{year}/Federal/US House/District 5"


def keys(census, now=10**9, batch=3):
    return [r["k"] for r in census.queue(now, batch=batch)]


def test_sync_records_folder_years_and_the_run_takes_the_newest_first(tmp_path):
    store = ObjectStore()
    put_worklist(store, first_part())
    put_results(
        store, "1700000000-1-00001.jsonl.gz", [outcome("retry", 0) | {"k": "TV|2|c"}]
    )
    put_inventory(
        store,
        "inv-1",
        [
            inv("TV|1|a", M1, p=folder(2014)),
            inv("TV|1|b", p=folder(2026)),
            inv("TV|2|c", M1, p=folder(2026)),  # checked once: a retry keeps id order
            inv("TV|2|d", M1, p="Political Files/2020"),  # the year folder itself
            inv("TV|3|g", M1, p=folder(2026)),  # held, so no year is recorded
            inv("TV|28010|e", M1, p=folder(2026)),  # held Minnesota copy
            inv("CABLE|9|n1", M2, p=folder(2024)),
            inv("CABLE|9|n2", M2, p="Political Files/20x4/Federal"),  # no year
            inv("CABLE|9|n3", M2, p=folder(2026)),
            inv("CABLE|9|n4", M2),  # no folder at all
        ],
    )
    census = census_for(tmp_path, store)
    assert census.sync_inventory() == {
        "sync": "appended",
        "inventory_id": "inv-1",
        "part": 2,
        "new": 4,
        "updates": 0,
        "years": 4,
    }
    manifest = json.loads(store.objects[f"{PREFIX}/manifest.json"])
    assert manifest["prioritized_inventory"] == manifest["synced_inventory"] == "inv-1"
    assert manifest["parts"][1]["years"] == 4
    rows = list(collect.read_gz_lines(store.objects[f"{PREFIX}/worklist-2.jsonl.gz"]))
    added = [r for r in rows if "s" in r]
    # Added filings carry their year; listed filings get 1 year row each.
    assert {r["k"]: r.get("y") for r in added} == {
        "CABLE|9|n1": 2024,
        "CABLE|9|n2": None,
        "CABLE|9|n3": 2026,
        "CABLE|9|n4": None,
    }
    assert [r for r in rows if "s" not in r] == [
        {"k": "TV|1|a", "y": 2014},
        {"k": "TV|1|b", "y": 2026},
        {"k": "TV|2|c", "y": 2026},
        {"k": "TV|2|d", "y": 2020},
    ]

    reopened = census_for(tmp_path, store)
    reopened.load(reopened.manifest())
    no_year = [r["k"] for r in added if "y" not in r]
    expected = [
        "TV|1|b",  # 2026, part 1
        "CABLE|9|n3",  # 2026, part 2
        "CABLE|9|n1",  # 2024
        "TV|2|d",  # 2020
        "TV|1|a",  # 2014
        *no_year,  # no year, in work-list order
        "TV|2|c",  # the due retry
    ]
    for batch in (1, 2, 3, 100):
        assert keys(reopened, batch=batch) == expected
    assert reopened.queue_size(10**9) == len(expected)
    status = reopened.status()
    assert status["not_checked_by_year"] == {
        "2026": 2,
        "2024": 1,
        "2020": 1,
        "2014": 1,
        "none": 2,
    }
    assert status["filings"]["not_checked"] == 7
    assert status["work_rows"] == 6 + 4  # year rows are not filings


def test_years_are_written_once_and_only_when_missing_or_changed(tmp_path):
    store = ObjectStore()
    put_worklist(store, first_part())
    put_inventory(
        store,
        "inv-1",
        [inv("TV|1|a", M1, p=folder(2012)), inv("TV|1|b", p=folder(2014))],
    )
    census = census_for(tmp_path, store)
    assert census.sync_inventory()["years"] == 2
    census.load(census.manifest())
    assert keys(census) == ["TV|1|b", "TV|1|a", "TV|2|c", "TV|2|d"]

    # The same inventory again writes nothing.
    before = dict(store.objects)
    assert census_for(tmp_path, store).sync_inventory()["sync"] == "current"
    assert store.objects == before
    # A later inventory with the same years writes no part.
    put_inventory(
        store,
        "inv-2",
        [inv("TV|1|a", M1, p=folder(2012)), inv("TV|1|b", p=folder(2014))],
    )
    assert census.sync_inventory() | {"inventory_id": None} == {
        "sync": "nothing new",
        "inventory_id": None,
        "part": None,
        "new": 0,
        "updates": 0,
        "years": 0,
    }
    # A changed year and a newly readable one are written; the latest wins.
    put_inventory(
        store,
        "inv-3",
        [
            inv("TV|1|a", M1, p=folder(2016)),
            inv("TV|1|b", p=folder(2014)),
            inv("TV|2|d", M1, p=folder(2026)),
        ],
    )
    assert census.sync_inventory()["years"] == 2
    expected = ["TV|2|d", "TV|1|a", "TV|1|b", "TV|2|c"]
    census.load(census.manifest())
    assert keys(census) == expected
    # A fresh scratch database reads every part at once and agrees.
    fresh = census_for(tmp_path / "fresh", store)
    fresh.load(fresh.manifest())
    assert keys(fresh) == expected


def test_a_run_already_synced_with_the_inventory_gets_a_years_only_part(tmp_path):
    store = ObjectStore()
    put_worklist(store, first_part())
    # As an earlier version left the run: the inventory's 1 new filing in part 2,
    # no years, and the inventory recorded as read.
    put_inventory(
        store,
        "inv-1",
        [inv("TV|1|a", M1, p=folder(2026)), inv("CABLE|9|x", M2, p=folder(2020))],
    )
    body = collect.gz_lines([inv("CABLE|9|x", M2) | {"n": 0}])
    store.objects[f"{PREFIX}/worklist-2.jsonl.gz"] = body
    manifest = json.loads(store.objects[f"{PREFIX}/manifest.json"])
    manifest["parts"] = [
        *collect.manifest_parts(manifest),
        {
            "key": "worklist-2.jsonl.gz",
            "sha256": hashlib.sha256(body).hexdigest(),
            "bytes": len(body),
            "rows": 1,
        },
    ]
    manifest["synced_inventory"] = "inv-1"
    store.objects[f"{PREFIX}/manifest.json"] = json.dumps(manifest).encode()
    census = census_for(tmp_path, store)
    census.load(census.manifest())
    assert keys(census) == ["TV|1|a", "TV|1|b", "TV|2|c", "TV|2|d", "CABLE|9|x"]
    status_before = census.status()

    assert census.sync_inventory() == {
        "sync": "appended",
        "inventory_id": "inv-1",
        "part": 3,
        "new": 0,
        "updates": 0,
        "years": 2,
    }
    rows = list(collect.read_gz_lines(store.objects[f"{PREFIX}/worklist-3.jsonl.gz"]))
    assert rows == [{"k": "CABLE|9|x", "y": 2020}, {"k": "TV|1|a", "y": 2026}]
    census.load(census.manifest())
    assert keys(census) == ["TV|1|a", "CABLE|9|x", "TV|1|b", "TV|2|c", "TV|2|d"]
    # Only the order changed: the same filings and the same tallies.
    status_after = census.status()
    assert status_after["not_checked_by_year"] == {"2026": 1, "2020": 1, "none": 3}
    for status in (status_before, status_after):
        del status["not_checked_by_year"]
    assert status_after == status_before
    assert census.sync_inventory()["sync"] == "current"


def test_a_work_list_without_years_keeps_work_list_order(tmp_path):
    work, results = sample_run(seed=5)
    for row in work:
        row.pop("y", None)
    store = ObjectStore()
    put_worklist(store, work)
    put_results(store, "1700000000-1-00001.jsonl.gz", results)
    census = census_for(tmp_path, store)
    census.load(census.manifest())
    check_equal(census, work, results)
    checked = {r["k"] for r in results}
    never = [r["k"] for r in work if "held" not in r and r["k"] not in checked]
    assert never and keys(census, batch=7)[: len(never)] == never
    assert census.status()["not_checked_by_year"] == {"none": len(never)}
