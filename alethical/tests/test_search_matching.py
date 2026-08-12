"""Unit coverage for keyword-search word normalization (#571, #1452).

Two reported failures, both "a real bill returned zero results":

* searching "plumbing" found nothing when the bill's text said "plumbers", even
  though "plumb" (a shared root) matched both. ``_stem_root`` reduces inflected
  variants to that shared root so they resolve together.
* searching the exact headline a card displays, "Repeal of Political Contribution
  Refund Program", found nothing. Every word matched SF 3458's official title
  except "of", which appears nowhere in it, and one unmatched word drops the bill.
  ``search_words`` stops filler words from gating a match.

These tests pin both, and their conservative guards.
"""

from __future__ import annotations

from alethical.api.routers.public import _stem_root, search_words


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


def test_filler_words_do_not_gate_a_match():
    # The reported case. "of" is the only word of this headline missing from
    # SF 3458's official title, and requiring it returned zero results for a
    # query that otherwise described the bill exactly.
    assert search_words("Repeal of Political Contribution Refund Program") == [
        "Repeal",
        "Political",
        "Contribution",
        "Refund",
        "Program",
    ]
    # Case-insensitive, and every filler word goes, not just the first.
    assert search_words("the cost of a school lunch") == ["cost", "school", "lunch"]


def test_a_query_of_only_filler_words_still_searches_for_it():
    # Dropping every word would turn "of the" into a match-everything query.
    # Filler is dropped only while something else survives.
    assert search_words("of the") == ["of", "the"]
    assert search_words("") == []


def test_content_words_are_never_dropped():
    # The guard against over-eager filtering: nothing that carries meaning may be
    # removed, however short. "tax" and "aid" are 2-3 letters and both stay.
    assert search_words("tax aid") == ["tax", "aid"]
    assert search_words("school funding") == ["school", "funding"]
