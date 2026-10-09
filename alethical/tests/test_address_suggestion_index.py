"""The shared public address copy never retains queries or extends freshness.

Covers the off switch, validation before an all-at-once swap, the 24-hour expiry
and 12-hour refresh, 1 builder per machine, and fallback to the live service.
"""

from concurrent.futures import ThreadPoolExecutor
import json
import shutil
import sqlite3
import threading
from types import SimpleNamespace

import pytest
from requests.cookies import RequestsCookieJar

from alethical.api.services import address_suggestion_index as module
from alethical.api.services.candidate_lookup import CandidateLookupService
from alethical.api.services.representative_lookup import (
    MINNESOTA_ADDRESS_POINTS_URL,
    MinnesotaAddressPointGeocoder,
)


@pytest.fixture(autouse=True)
def enough_space(monkeypatch):
    monkeypatch.setattr(
        module.shutil, "disk_usage", lambda path: SimpleNamespace(free=5_000_000_000)
    )


@pytest.fixture
def source_file(tmp_path):
    sequence = 0

    def create(rows=None, *, missing=None, wrong_type=None):
        nonlocal sequence
        sequence += 1
        path = tmp_path / f"fixture-{sequence}.gpkg"
        fields = ("objectid", *module.ADDRESS_FIELDS)
        types = {
            f: "INTEGER"
            if f in ("objectid", "anumber")
            else "REAL"
            if f in ("longitude", "latitude")
            else "TEXT"
            for f in fields
        }
        if missing:
            del types[missing]
        if wrong_type:
            types[wrong_type] = "BLOB"
        with sqlite3.connect(path) as connection:
            connection.execute(
                "CREATE TABLE loc_addresses_open ("
                + ",".join(f"{f} {t}" for f, t in types.items())
                + ")"
            )
            for index, row in enumerate(
                rows
                if rows is not None
                else [{"st_name": "Main", "anumbersuf": "A"}, {"st_name": "Maple"}],
                1,
            ):
                values = {
                    "objectid": index,
                    "anumber": 100,
                    "st_name": "Main",
                    "longitude": -93.2,
                    "latitude": 44.9,
                    "status": "Active",
                    "state_code": "MN",
                    **row,
                }
                connection.execute(
                    "INSERT INTO loc_addresses_open VALUES ("
                    + ",".join("?" for _ in types)
                    + ")",
                    [values.get(f) for f in types],
                )
        return path

    return create


@pytest.fixture
def folder(tmp_path):
    return tmp_path / "shared-copy"


@pytest.fixture
def make_index(folder, source_file):
    indexes = []

    def create(source=None, **kwargs):
        source = source or source_file()

        def copy_source(output, stop):
            shutil.copyfile(source, output)

        options = {
            "enabled": True,
            "directory": folder,
            "min_source_rows": 1,
            "downloader": copy_source,
            **kwargs,
        }
        index = module.AddressSuggestionIndex(**options)
        indexes.append(index)
        return index

    yield create
    for index in indexes:
        index.stop()


def query(index, **kwargs):
    return index.suggestions(house_number=100, street_names=("MA",), **kwargs)


def copies(folder):
    return sorted(path.name for path in folder.glob("copy-*.sqlite"))


def test_default_off_never_creates_files_or_calls_network(folder, monkeypatch):
    monkeypatch.setattr(
        module.requests,
        "Session",
        lambda: pytest.fail("Disabled copy contacted source"),
    )
    index = module.AddressSuggestionIndex(directory=folder)
    index.start()
    assert index._thread is None
    assert not index.refresh_due()
    assert not index.refresh()
    assert query(index) is None
    assert not index.status()["ready"]
    index.stop()
    assert not folder.exists()


def test_a_query_never_starts_a_download(make_index):
    index = make_index()
    index._downloader = lambda *args: pytest.fail("Query started download")
    assert query(index) is None


def test_default_accessor_is_idle_off_and_recreated_after_shutdown(folder, monkeypatch):
    monkeypatch.setattr(module, "_default_index", None)
    monkeypatch.delenv("ALETHICAL_ADDRESS_SUGGESTION_INDEX_ENABLED", raising=False)
    monkeypatch.setenv("ALETHICAL_ADDRESS_SUGGESTION_INDEX_DIRECTORY", str(folder))
    first = module.get_address_suggestion_index()
    assert not first.enabled
    assert first is module.get_address_suggestion_index()
    first.stop()
    monkeypatch.setenv("ALETHICAL_ADDRESS_SUGGESTION_INDEX_ENABLED", "true")
    second = module.get_address_suggestion_index()
    assert second is not first
    assert second.enabled
    assert second._root == folder
    assert second._thread is None
    second.stop()
    assert not folder.exists()
    monkeypatch.setattr(module, "_default_index", None)


def test_projection_preserves_raw_fields_case_suffix_and_parameterization(make_index):
    index = make_index()
    assert index.refresh()
    assert len(query(index)) == 2
    result = index.suggestions(house_number=100, street_names=("ma",), house_suffix="a")
    assert len(result) == 1
    assert result[0]["attributes"]["st_name"] == "Main"
    assert result[0]["attributes"]["anumbersuf"] == "A"
    assert tuple(result[0]["attributes"]) == module.ADDRESS_FIELDS
    assert index.suggestions(house_number=100, street_names=("MA' OR 1=1 --",)) == []
    assert index.suggestions(house_number=100, street_names=("MA%",)) == []
    assert query(index, house_suffix="A' OR 1=1 --") == []
    assert len(query(index)) == 2
    assert index.suggestions(house_number=100, street_names=("MÄ",)) is None
    assert index.suggestions(house_number=100, street_names=("",)) is None


def test_expiry_is_exactly_24h_after_completed_download(make_index):
    now = [1_000_000.0]
    index = make_index(clock=lambda: now[0])
    original = index._downloader

    def delayed_download(*args):
        original(*args)
        now[0] = 1_000_020.0

    index._downloader = delayed_download
    assert index.refresh()
    expires = 1_000_020.0 + module.TTL_SECONDS
    assert index.status()["expires_at"] == expires
    now[0] = expires - 0.001
    assert query(index)
    now[0] = expires
    assert query(index) is None
    assert not index.status()["ready"]


def test_refresh_is_due_at_12_hours_and_a_failure_waits_1_hour(make_index):
    now = [1_000_000.0]
    index = make_index(clock=lambda: now[0])
    assert index.refresh_due()
    assert index.refresh()
    assert not index.refresh_due()
    now[0] += module.REFRESH_SECONDS - 1
    assert not index.refresh_due()
    now[0] += 1
    assert index.refresh_due()

    index._downloader = lambda *args: (_ for _ in ()).throw(ValueError("down"))
    assert not index.refresh()
    assert not index.refresh_due()
    now[0] += module.RETRY_SECONDS - 1
    assert not index.refresh_due()
    now[0] += 1
    assert index.refresh_due()


def test_failed_refresh_keeps_valid_copy_and_original_expiry(
    make_index, folder, caplog
):
    now = [1_000_000.0]
    index = make_index(clock=lambda: now[0])
    assert index.refresh()
    original_status = index.status()
    original_copies = copies(folder)
    now[0] += 100

    def fail(*args):
        raise ValueError("PRIVATE ADDRESS SENTINEL https://source.invalid/private")

    index._downloader = fail
    assert not index.refresh()
    assert index.status() == original_status
    assert query(index)
    assert "PRIVATE" not in caplog.text
    assert copies(folder) == original_copies
    assert not list(folder.glob("pending-*"))


@pytest.mark.parametrize(
    "kind",
    [
        "missing",
        "corrupt",
        "truncated",
        "missing_field",
        "wrong_type",
        "empty",
        "duplicate",
        "null_id",
        "non_ascii",
        "invalid_value",
    ],
)
def test_bad_sources_never_become_ready(kind, source_file, make_index, folder):
    if kind == "missing_field":
        source = source_file(missing="status")
    elif kind == "wrong_type":
        source = source_file(wrong_type="st_name")
    elif kind == "empty":
        source = source_file([])
    elif kind == "duplicate":
        source = source_file([{"objectid": 1}, {"objectid": 1}])
    elif kind == "null_id":
        source = source_file([{"objectid": None}])
    elif kind == "non_ascii":
        source = source_file([{"st_name": "Mäin"}])
    elif kind == "invalid_value":
        source = source_file([{"anumber": "bad-number"}])
    else:
        source = source_file()
        if kind == "missing":
            source.unlink()
        elif kind == "corrupt":
            source.write_bytes(b"not a sqlite database")
        else:
            source.write_bytes(source.read_bytes()[:-100])
    index = make_index(source)
    assert not index.refresh()
    assert query(index) is None
    assert not index.status()["ready"]
    assert copies(folder) == []
    assert not (folder / module.MANIFEST).exists()
    assert not list(folder.glob("pending-*"))


def test_source_count_and_disk_space_bounds(make_index, monkeypatch):
    index = make_index(max_source_rows=1)
    assert not index.refresh()
    index._max_rows = 10
    monkeypatch.setattr(
        module.shutil,
        "disk_usage",
        lambda path: SimpleNamespace(free=module.MIN_FREE_BYTES - 1),
    )
    index._downloader = lambda *args: pytest.fail("Download started without disk space")
    assert not index.refresh()


def test_row_cap_never_returns_partial_results(make_index, source_file, monkeypatch):
    monkeypatch.setattr(module, "MAX_ROWS", 2)
    index = make_index(source_file([{}, {}, {}]))
    assert index.refresh()
    assert query(index) is None
    assert index.suggestions(house_number=999, street_names=("MA",)) == []


@pytest.mark.parametrize("damage", ["corrupt", "missing"])
def test_damaged_published_copy_falls_back_and_asks_for_a_rebuild(
    make_index, folder, damage
):
    index = make_index()
    assert index.refresh()
    assert not index.refresh_due()
    published = folder / copies(folder)[0]
    if damage == "corrupt":
        published.write_bytes(b"bad")
    else:
        published.unlink()
    assert query(index) is None
    assert index.refresh_due()
    assert index.refresh()
    assert query(index)


@pytest.mark.parametrize(
    "manifest",
    [
        {"file": "../../etc/passwd", "downloaded_at": 0, "source_hash": "", "count": 1},
        {"file": "copy-0123456789abcdef-1000000000-01234567.sqlite"},
        "not json",
    ],
)
def test_untrusted_or_broken_state_file_is_never_followed(make_index, folder, manifest):
    index = make_index()
    assert index.refresh()
    state = folder / module.MANIFEST
    state.write_text(manifest if isinstance(manifest, str) else json.dumps(manifest))
    assert query(index) is None
    assert index.refresh_due()


def test_a_copy_dated_in_the_future_is_never_used(make_index, folder):
    now = [1_000_000.0]
    index = make_index(clock=lambda: now[0])
    assert index.refresh()
    state = folder / module.MANIFEST
    value = json.loads(state.read_text())
    value["downloaded_at"] = now[0] + 3600
    state.write_text(json.dumps(value))
    assert query(index) is None


def test_atomic_switch_keeps_open_reader_consistent_and_keeps_1_previous_copy(
    make_index, source_file, folder, monkeypatch
):
    now = [1_000_000.0]
    index = make_index(source_file([{"st_name": "Main Old"}]), clock=lambda: now[0])
    assert index.refresh()
    old_path = folder / copies(folder)[0]
    opened, release = threading.Event(), threading.Event()
    original_read = module._read_only

    class DelayedReader:
        def __init__(self, connection):
            self.connection = connection

        def execute(self, *args):
            opened.set()
            assert release.wait(5)
            return self.connection.execute(*args)

        def close(self):
            self.connection.close()

    def open_read(path):
        connection = original_read(path)
        return DelayedReader(connection) if path == old_path else connection

    monkeypatch.setattr(module, "_read_only", open_read)

    def replace_with(street, at):
        replacement = source_file([{"st_name": street}])
        index._downloader = lambda output, stop: shutil.copyfile(replacement, output)
        now[0] = at
        assert index.refresh()

    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(query, index)
        assert opened.wait(5)
        replace_with("Main New", 1_000_100.0)
        release.set()
        assert pending.result()[0]["attributes"]["st_name"] == "Main Old"
    assert query(index)[0]["attributes"]["st_name"] == "Main New"
    assert old_path.exists()
    replace_with("Main Newest", 1_000_200.0)
    assert not old_path.exists()
    assert len(copies(folder)) == 2
    assert query(index)[0]["attributes"]["st_name"] == "Main Newest"


def test_processes_sharing_a_folder_build_once_and_read_the_same_copy(make_index):
    builder = make_index()
    reader = make_index()
    began, release = threading.Event(), threading.Event()
    original = builder._downloader

    def slow_download(output, stop):
        began.set()
        assert release.wait(5)
        original(output, stop)

    builder._downloader = slow_download
    reader._downloader = lambda *args: pytest.fail("Second process downloaded too")
    with ThreadPoolExecutor(max_workers=1) as executor:
        building = executor.submit(builder.refresh)
        assert began.wait(5)
        # The folder lock is held across processes, not only threads.
        assert not reader.refresh()
        assert query(reader) is None
        release.set()
        assert building.result()
    assert len(query(reader)) == 2
    assert not reader.refresh_due()
    assert reader.status()["source_hash"] == builder.status()["source_hash"]


def test_start_is_single_background_loader_and_stop_cancels(make_index, folder):
    index = make_index()
    began = threading.Event()
    calls = []

    def blocked(output, stop):
        calls.append(output)
        began.set()
        assert stop.wait(5)
        raise ValueError("cancelled")

    index._downloader = blocked
    index.start()
    index.start()
    assert began.wait(5)
    assert query(index) is None
    assert not index.refresh()
    index.stop()
    assert len(calls) == 1
    assert not index._thread.is_alive()
    assert not list(folder.glob("pending-*"))
    index.start()
    assert len(calls) == 1


def test_stop_leaves_the_shared_copy_for_other_processes(make_index, folder):
    first = make_index()
    assert first.refresh()
    first.stop()
    second = make_index()
    assert len(query(second)) == 2


def test_stop_interrupts_hashing_between_chunks(make_index, folder, monkeypatch):
    index = make_index()
    updates = []

    class CancelHash:
        def update(self, chunk):
            updates.append(len(chunk))
            index._stop.set()

        def hexdigest(self):
            pytest.fail("Cancelled hash must not finish")

    monkeypatch.setattr(module.hashlib, "sha256", CancelHash)
    assert not index.refresh()
    assert len(updates) == 1
    assert updates[0] <= 1 << 20
    assert copies(folder) == []
    assert not list(folder.glob("pending-*"))


def test_status_and_folder_contain_no_address_values_or_queries(make_index, folder):
    index = make_index()
    assert index.refresh()
    index.suggestions(house_number=100, street_names=("PRIVATEQUERY",))
    assert set(index.status()) == {"ready", "expires_at", "source_hash", "count"}
    assert len(index.status()["source_hash"]) == 64
    assert not any("Main" in str(value) for value in vars(index).values())
    state_files = [path for path in folder.iterdir() if path.suffix != ".sqlite"]
    assert all("PRIVATEQUERY" not in path.read_text() for path in state_files)


def test_background_loop_checks_the_shared_state_on_a_bounded_schedule(
    make_index, monkeypatch
):
    index = make_index()
    waits, refreshes = [], []

    class Stop:
        stopped = False

        def is_set(self):
            return self.stopped

        def set(self):
            self.stopped = True

        def wait(self, seconds):
            waits.append(seconds)
            self.set()

    index._stop = Stop()
    monkeypatch.setattr(index, "refresh", lambda: refreshes.append(1))
    index._run()
    assert waits == [module.CHECK_SECONDS]
    assert refreshes == [1]


def test_expiry_during_read_cannot_return_old_rows(make_index):
    index = make_index(clock=lambda: 1_000_000.0)
    assert index.refresh()
    expires = index.status()["expires_at"]
    times = iter([expires - 1, expires])
    index._clock = lambda: next(times)
    assert query(index) is None


@pytest.fixture
def copied_suggestions(make_index, source_file, monkeypatch):
    def create(rows):
        index = make_index(source_file(rows))
        assert index.refresh()
        monkeypatch.setattr(
            "alethical.api.services.representative_lookup.get_address_suggestion_index",
            lambda: index,
        )
        return index

    return create


SUMMIT = {
    "anumber": 1006,
    "st_name": "Summit",
    "st_pos_typ": "Avenue",
    "postcomm": "Saint Paul",
    "ctu_name": "Saint Paul",
    "zip": "55105",
    "latitude": 44.9413,
    "longitude": -93.1534,
}


def test_copied_suggestions_skip_the_live_service_and_are_marked(
    copied_suggestions, monkeypatch
):
    copied_suggestions([SUMMIT, {**SUMMIT, "objectid": 2, "latitude": 44.9414}])
    geocoder = MinnesotaAddressPointGeocoder(base_url=MINNESOTA_ADDRESS_POINTS_URL)
    monkeypatch.setattr(
        geocoder,
        "_request_features",
        lambda *args, **kwargs: pytest.fail("live service asked while copy matched"),
    )

    matches = geocoder.suggest_matches("1006 Summit")

    assert [match.matched_address for match in matches] == [
        "1006 Summit Avenue, Saint Paul, MN 55105"
    ]
    assert matches[0].requires_location_check


@pytest.mark.parametrize(
    "rows",
    [
        [{**SUMMIT, "anumber": 1007}],
        [{**SUMMIT, "status": "Retired"}],
        [{**SUMMIT, "state_code": "WI"}],
    ],
    ids=["no-row", "retired-only", "other-state-only"],
)
def test_no_safe_copied_match_asks_the_live_service(
    copied_suggestions, monkeypatch, rows
):
    copied_suggestions(rows)
    geocoder = MinnesotaAddressPointGeocoder(base_url=MINNESOTA_ADDRESS_POINTS_URL)
    calls = []

    def live(where, *, result_record_count):
        calls.append(where)
        return [
            {"attributes": {**SUMMIT, "status": "Active", "state_code": "MN"}}
        ], False

    monkeypatch.setattr(geocoder, "_request_features", live)

    matches = geocoder.suggest_matches("1006 Summit")

    assert len(calls) == 1
    assert [match.requires_location_check for match in matches] == [False]


def test_a_test_or_other_source_never_reads_the_copy(copied_suggestions, monkeypatch):
    copied_suggestions([SUMMIT])
    geocoder = MinnesotaAddressPointGeocoder(base_url="https://source.invalid/query")
    monkeypatch.setattr(
        geocoder, "_request_features", lambda *args, **kwargs: ([], False)
    )

    assert geocoder.suggest_matches("1006 Summit") == []


def test_candidate_suggestions_from_the_copy_still_need_1_official_range(
    copied_suggestions,
):
    copied_suggestions([SUMMIT])
    fetched = []

    def fetch(url, params):
        fetched.append(params)
        return json.dumps({"Streets": []}).encode()

    lookup = CandidateLookupService(fetch=fetch)
    lookup.geocoder._request_features = lambda *args, **kwargs: pytest.fail(
        "live service asked while copy matched"
    )

    # The copy offers the address, but no election street range supports it.
    assert lookup.suggest("1006 Summit") == []
    assert fetched == [{"ZipCode": "55105"}]


@pytest.fixture
def download_response(monkeypatch):
    seen = []
    response = SimpleNamespace(status_code=200, headers={}, chunks=[b"source", b""])

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        @property
        def status_code(self):
            return response.status_code

        @property
        def headers(self):
            return response.headers

        @property
        def raw(self):
            return self

        def read1(self, size):
            assert size == 1 << 20
            return response.chunks.pop(0)

    class Session:
        def __init__(self):
            self.cookies = RequestsCookieJar()
            self.trust_env = True

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, url, **kwargs):
            seen.append((url, kwargs, self.trust_env, self.cookies.get_policy()))
            return Response()

    monkeypatch.setattr(module.requests, "Session", Session)
    return response, seen


def test_public_download_has_fixed_source_no_credentials_cookies_or_redirects(
    tmp_path, download_response
):
    response, seen = download_response
    output = tmp_path / "source.gpkg"
    module._download(output, threading.Event())
    assert output.read_bytes() == b"source"
    url, kwargs, trust_env, policy = seen[0]
    assert url == module.SOURCE_URL
    assert kwargs == {
        "stream": True,
        "timeout": (3.05, 15),
        "allow_redirects": False,
        "headers": {"Accept-Encoding": "identity"},
    }
    assert trust_env is False
    assert policy.set_ok(None, None) is False
    assert policy.return_ok(None, None) is False


@pytest.mark.parametrize(
    "kind", ["http", "too_big", "declared_big", "incomplete", "cancel", "deadline"]
)
def test_public_download_rejects_failed_partial_large_or_stalled_response(
    tmp_path, download_response, monkeypatch, kind
):
    response, _ = download_response
    stop = threading.Event()
    if kind == "http":
        response.status_code = 503
    if kind == "too_big":
        monkeypatch.setattr(module, "MAX_DOWNLOAD_BYTES", 2)
    if kind == "declared_big":
        response.headers["Content-Length"] = str(module.MAX_DOWNLOAD_BYTES + 1)
    if kind == "incomplete":
        response.headers["Content-Length"] = "20"
    if kind == "cancel":
        stop.set()
    if kind == "deadline":
        clock = iter([0, 166])
        monkeypatch.setattr(module.time, "monotonic", lambda: next(clock))
    with pytest.raises(ValueError):
        module._download(tmp_path / "source.gpkg", stop)
