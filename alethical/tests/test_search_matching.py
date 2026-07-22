"""Unit coverage for keyword-search root normalization (#571).

The reported failure: searching "plumbing" returned nothing when the matching
bill's text said "plumbers", even though "plumb" (a shared root) matched both.
``_stem_root`` reduces inflected variants to that shared root so they resolve
together; these tests pin the stemmer's behavior and its conservative guards.
"""

from __future__ import annotations

from alethical.api.routers.public import _stem_root


def test_inflected_variants_share_a_root():
    # The reported case: plumbing / plumbers / plumber / plumbs all reduce to
    # "plumb", so any one query matches text containing any of the others.
    assert _stem_root("plumbing") == "plumb"
    assert _stem_root("plumbers") == "plumb"
    assert _stem_root("plumber") == "plumb"
    assert _stem_root("plumbs") == "plumb"


def test_common_suffixes_are_stripped():
    assert _stem_root("funding") == "fund"
    assert _stem_root("training") == "train"
    assert _stem_root("schools") == "school"
    assert _stem_root("scholarships") == "scholarship"


def test_short_words_are_left_alone():
    # Below the length guards there is no safe stem, so the raw word is used as
    # is — preventing "tax"/"art"-style over-matching.
    assert _stem_root("tax") is None
    assert _stem_root("art") is None
    assert _stem_root("plumb") is None  # already a root; no suffix to strip


def test_root_must_stay_meaningful():
    # "seeing" would strip to "see" (too short); the stem is skipped rather than
    # producing a 1-3 char root that matches almost everything.
    assert _stem_root("seeing") is None
