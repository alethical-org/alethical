"""Offline homepage factual checks. No accounts, database, or network requests."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from scripts import check_home_hero_card_literals as hero


# Source excerpts from HF 4138 version 5, Sec. 2, Subd. 1(c). The separate
# explanation deliberately summarizes examples instead of pretending to quote.
DEFINITION = (
    '(c) "Addictive interface features" means: '
    "(1) infinite scrolling meaning either continuously loading content; "
    "(3) push notifications, whether audible, visual, or tactile; "
    "(4) autoplay video or video that begins to play without the account holder "
    'first clicking on the video or on a play button for that video; (d) "Child" '
    "means an individual who is age 15 or younger and residing in Minnesota."
)


def source(effective: str = "Jul 1, 2027") -> str:
    return "\n".join(
        (
            hero.CARD_CODE,
            hero.CARD_SHORT_TITLE,
            hero.CARD_SIGNED,
            effective,
            hero.CARD_AUTHOR,
            hero.CARD_HOUSE_VOTE,
            hero.CARD_SENATE_VOTE,
            *hero.CARD_QUOTES,
            hero.CARD_ADDICTIVE_EXAMPLES,
        )
    )


def record_responses(effective: str) -> list[dict]:
    return [
        {
            "data": [
                {
                    "file_type": "HF",
                    "file_number": 4138,
                    "ai_analysis": {"short_title": hero.CARD_SHORT_TITLE},
                    "effective_date": effective,
                    "chief_sponsors": [{"name": "Peggy Scott"}],
                }
            ]
        },
        {"data": [{"action_text": "Governor approval 05/26/2026"}]},
        {
            "data": [
                {"chamber": "house", "yes_count": 132, "no_count": 2},
                {"chamber": "senate", "yes_count": 66, "no_count": 0},
            ]
        },
        {"data": [{"is_current": True, "version_code": "5"}]},
        {
            "data": {
                "sections": [
                    {"text": DEFINITION},
                    # The omitted consent clause still sits between the quoted parts.
                    {
                        "text": " ".join(hero.CARD_QUOTES).replace(
                            " … ", " pursuant to this section, "
                        )
                    },
                ]
            }
        },
    ]


class DisplayDateTests(unittest.TestCase):
    def test_full_and_abbreviated_effective_dates_are_equivalent_in_card(self):
        for date in ("Jul 1, 2027", "July 1, 2027"):
            with self.subTest(date=date):
                failures = []
                hero.check_card_still_states(source(date), failures)
                self.assertEqual(failures, [])

    def test_wrong_display_day_or_year_is_still_a_failure(self):
        for date in ("Jul 2, 2027", "Jul 1, 2028"):
            with self.subTest(date=date):
                failures = []
                hero.check_card_still_states(source(date), failures)
                self.assertEqual(len(failures), 1)
                self.assertIn("effective date", failures[0])

    def test_record_comparison_accepts_full_or_abbreviated_month(self):
        for date in ("July 1, 2027", "Jul 1, 2027"):
            with self.subTest(date=date):
                failures = []
                with patch.object(hero, "fetch", side_effect=record_responses(date)):
                    hero.check_record_agrees("https://example.test", failures)
                self.assertEqual(failures, [])

    def test_record_comparison_rejects_wrong_day_year_and_missing_date(self):
        for date in ("July 2, 2027", "Jul 1, 2028", ""):
            with self.subTest(date=date):
                failures = []
                with patch.object(hero, "fetch", side_effect=record_responses(date)):
                    hero.check_record_agrees("https://example.test", failures)
                self.assertEqual(len(failures), 1)
                self.assertIn("taking effect", failures[0])


class AddictiveExampleTests(unittest.TestCase):
    def test_missing_or_rewritten_card_explanation_is_reported(self):
        failures = []
        hero.check_card_still_states(
            source().replace(
                hero.CARD_ADDICTIVE_EXAMPLES, "Such as a recommendation feed"
            ),
            failures,
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("addictive-feature examples", failures[0])

    def test_each_example_is_supported_by_the_definition(self):
        failures = []
        hero.check_addictive_examples_support(DEFINITION, failures)
        self.assertEqual(failures, [])

    def test_mentions_outside_the_definition_do_not_support_the_examples(self):
        for term in hero.ADDICTIVE_EXAMPLE_TERMS:
            with self.subTest(term=term):
                failures = []
                text = (
                    DEFINITION.replace(term, "another feature")
                    + f" Other section: {term}"
                )
                hero.check_addictive_examples_support(text, failures)
                self.assertEqual(len(failures), 1)
                self.assertIn(term, failures[0])

    def test_missing_definition_is_a_failure(self):
        failures = []
        hero.check_addictive_examples_support(" ".join(hero.CARD_QUOTES), failures)
        self.assertEqual(len(failures), 1)
        self.assertIn("definition", failures[0])

    def test_current_record_check_rejects_an_unsupported_explanation(self):
        responses = record_responses("July 1, 2027")
        responses[-1]["data"]["sections"][0]["text"] = DEFINITION.replace(
            "autoplay video", "another feature"
        )
        failures = []
        with patch.object(hero, "fetch", side_effect=responses):
            hero.check_record_agrees("https://example.test", failures)
        self.assertEqual(len(failures), 1)
        self.assertIn("autoplay video", failures[0])


if __name__ == "__main__":
    unittest.main()
