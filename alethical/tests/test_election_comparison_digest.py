"""Canonical hashes must keep old bytes without whole-document encoding copies."""

from copy import deepcopy
import hashlib
import json
import tracemalloc

import pytest

from alethical.pipeline import election_comparison as storage


def legacy_digest(value):
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()


def legacy_generation_digest(generation):
    content = {k: v for k, v in generation.items() if k not in {"id", "fetched_at"}}
    content["sources"] = sorted(
        ({k: v for k, v in s.items() if k != "fetched_at"} for s in content["sources"]),
        key=lambda s: (s["sha256"], s.get("url", "")),
    )
    content["races"] = sorted(content["races"], key=lambda r: r["id"])
    content["precincts"] = sorted(
        content["precincts"], key=lambda r: (r["race_id"], r["key"])
    )
    return legacy_digest(content)


@pytest.mark.parametrize(
    "value",
    [
        None,
        True,
        False,
        {},
        [],
        [0, -7, 10**80, 0.0, -0.0, 1.25, 1e-30, 1e30],
        [float("inf"), float("-inf"), float("nan")],
        {"z": [None, False, {"Å": "雪 😀"}], "a": 'quote" slash\\\n\t\r\x00'},
        {"é": "e\u0301", "Z": [1, "1", True, None], "a": "\u2028\u2029"},
    ],
)
def test_digest_keeps_exact_legacy_json_bytes(value):
    assert storage.digest(value) == legacy_digest(value)


def test_digest_additional_allocation_is_bounded_for_many_small_records():
    # Construct input and expected hash before tracing. Only encoding/hash
    # allocations count; this does not pretend the caller's input is streamed.
    value = [{"row": n, "text": "x" * 384, "literal": "Å雪"} for n in range(10_000)]
    expected = legacy_digest(value)
    tracemalloc.start()
    try:
        actual = storage.digest(value)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert actual == expected
    assert peak < 2 * 1024 * 1024, f"Whole-document hashing allocated {peak:,} bytes"


def sample_generation():
    return {
        "format": 1,
        "election_key": "mn-2026-11-03-general",
        "election_date": "2026-11-03",
        "stage": "general",
        "id": "excluded snapshot identity",
        "fetched_at": "excluded top observation",
        "coverage": {"n": 3, "complete": False, "gap": None},
        "extra_top_field": {"fetched_at": "nested time is included", "é": "雪"},
        "sources": [
            {"sha256": "b" * 64, "url": "z", "fetched_at": "excluded"},
            {"sha256": "a" * 64, "url": "é", "extra": True},
            {"sha256": "a" * 64, "url": "Z", "extra": None},
        ],
        "races": [
            {"id": key, "payload": {"value": 1.25, "literal": '"雪\\\n'}}
            for key in ["é", "a", "Z"]
        ],
        "precincts": [
            {"race_id": race, "key": key, "payload": {"votes": 10**20}}
            for race, key in [("a", "é"), ("Z", "a"), ("a", "Z")]
        ],
    }


def test_generation_preserves_all_top_fields_ordering_and_observation_exclusions():
    generation = sample_generation()
    expected = legacy_generation_digest(generation)
    assert storage.generation_digest(generation) == expected
    changed = deepcopy(generation)
    changed["sources"].reverse()
    changed["races"].reverse()
    changed["precincts"].reverse()
    changed["fetched_at"] = "different excluded observation"
    changed["sources"][0]["fetched_at"] = "also excluded"
    assert storage.generation_digest(changed) == expected
    changed["extra_top_field"]["fetched_at"] = "a substantive nested change"
    assert storage.generation_digest(changed) != expected


def test_ordered_generation_writer_consumes_rows_once_with_bounded_allocation():
    generation = sample_generation()

    def rows():
        for n in range(10_000):
            yield {"id": f"{n:08}", "payload": {"literal": str(n) + "x" * 384}}

    expected = legacy_generation_digest(
        {**generation, "races": list(rows()), "precincts": []}
    )
    tracemalloc.start()
    try:
        actual = storage._ordered_generation_digest(
            generation, races=rows(), precincts=iter(()), strict=True
        )
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert actual == expected
    assert peak < 2 * 1024 * 1024, f"Ordered generation buffered {peak:,} bytes"


@pytest.mark.parametrize("keys", [["a", "a"], ["é", "Z"]])
def test_ordered_generation_writer_rejects_duplicates_or_non_python_order(keys):
    generation = sample_generation()
    with pytest.raises(storage.ComparisonImportError, match="uniquely ordered"):
        storage._ordered_generation_digest(
            generation,
            races=({"id": key} for key in keys),
            precincts=iter(()),
            strict=True,
        )


def test_prepared_duplicate_rows_still_keep_legacy_fingerprint():
    generation = sample_generation()
    generation["precincts"].append(deepcopy(generation["precincts"][0]))
    assert storage.generation_digest(generation) == legacy_generation_digest(generation)
