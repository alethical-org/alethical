"""Regression tests for offline topic extraction (#258).

``_extract_topic`` feeds the ``ILIKE`` match predicate behind the topic answer
paths; junk words left in the topic over-narrow the match and produce a false
NO MATCHES. These guard the two mis-extraction shapes fixed in #258, plus the
correctly-handled shapes that must stay intact (no over-stripping).
"""

from __future__ import annotations

import pytest

from alethical.api.services.ask_router import _extract_topic


@pytest.mark.parametrize(
    "question, expected",
    [
        # #258: a trailing verb must be stripped, not left in the topic.
        ("What statutes regarding data privacy passed?", "data privacy"),
        # #258: base-form "relate to" must be stripped like "related"/"relating".
        ("What bills relate to K-12 education funding?", "k-12 education funding"),
        # Must stay intact — the fix must not over-strip interior/tail words.
        ("What bills affect student aid?", "student aid"),
        (
            "What bills cover mental health and addiction?",
            "mental health and addiction",
        ),
        ("List the laws passed on paid family leave.", "paid family leave"),
        ("What laws address homelessness?", "homelessness"),
        # A non-topic question still carries no topic.
        ("How does the paid-leave program work?", None),
    ],
)
def test_extract_topic_strips_leading_and_trailing_qualifiers(question, expected):
    assert _extract_topic(question) == expected
