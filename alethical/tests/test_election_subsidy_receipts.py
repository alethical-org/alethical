from datetime import date
from decimal import Decimal, localcontext
from unittest.mock import patch
from types import SimpleNamespace
import unittest

from alethical.pipeline import election_subsidy_receipts as m

NAME = "Hanson, Jessica"
OFFICE = "House of Representatives District 55A"


def schedule(rows=None, total="7,348.55", number=1):
    rows = (
        rows
        if rows is not None
        else ["08/26/2026 Public subsidy payment from State of Minnesota 7,348.55"]
    )
    return "\n".join(
        [
            m.TITLE,
            f"{NAME} {OFFICE} Committee",
            "Date Total",
            *rows,
            *([] if total is None else [f"Amount Received {total}"]),
            "Campaign Finance Reporter Online 1.0.4439 XSD Version: 2.6 Printed 10/26/2026",
            f"Page {number}",
        ]
    )


class Page:
    def __init__(self, standard, layout=None):
        self.standard, self.layout, self.calls = standard, layout, []

    def extract_text(self, **kwargs):
        self.calls.append(kwargs)
        return (
            (self.standard if self.layout is None else self.layout)
            if kwargs
            else self.standard
        )


class Tests(unittest.TestCase):
    def call(self, texts, **changes):
        pages = [t if isinstance(t, Page) else Page(t) for t in texts]
        reader = SimpleNamespace(pages=pages, is_encrypted=False)
        args = dict(
            candidate_name=NAME,
            office=OFFICE,
            period_start="2026-01-01",
            period_end="2026-10-19",
            expected_total=Decimal("7348.55"),
        )
        args.update(changes)
        with patch.object(m, "PdfReader", return_value=reader):
            r = m.extract_subsidy_receipts(b"%PDF-fixture", **args)
        return r, pages

    def test_exact_amount_date_and_raw_locators(self):
        raw = schedule().replace("Date Total", "Date     Total")
        r, p = self.call([raw])
        self.assertEqual(r["status"], "checked")
        self.assertEqual(r["total"], Decimal("7348.55"))
        self.assertEqual(r["rows"][0]["date"], date(2026, 8, 26))
        self.assertEqual(r["rows"][0]["line"], 4)
        self.assertEqual(r["printed_total"]["line"], 5)
        self.assertEqual(r["evidence"][0]["layout_text"], raw)
        self.assertEqual(r["rows"][0]["amount"].as_tuple().exponent, -2)

    def test_all_rows_and_repeated_consecutive_page_headings(self):
        rows = [
            "08/21/2026 Public subsidy payment from State of Minnesota 100.01",
            "08/26/2026 Public subsidy payment from State of Minnesota 7,248.54",
        ]
        r, p = self.call([schedule(rows[:1], None, 1), schedule(rows[1:], number=2)])
        self.assertEqual(r["status"], "checked")
        self.assertEqual(len(r["rows"]), 2)
        self.assertEqual(r["schedule_pages"], [1, 2])

    def test_explicit_zero_only_with_printed_total_and_complete_rows(self):
        for rows in [
            [],
            ["08/26/2026 Public subsidy payment from State of Minnesota 0.00"],
        ]:
            r, p = self.call([schedule(rows, "0.00")], expected_total="0.00")
            self.assertEqual(r["status"], "checked")
            self.assertEqual(r["total"], Decimal("0.00"))
        r, p = self.call(["Summary row7 public subsidy0.00"], expected_total="0.00")
        self.assertEqual((r["status"], r["total"]), ("unavailable", None))

    def test_no_layout_for_unrelated_pages_negative_requires_full_scan(self):
        r, pages = self.call(
            ["Cover", "Summary Sch. A1 - PS", schedule(number=3), "Expenses"]
        )
        self.assertEqual(r["status"], "checked")
        self.assertEqual(r["pages_scanned"], 4)
        self.assertEqual([len(p.calls) for p in pages], [1, 1, 2, 1])
        r, pages = self.call(["Cover", "Summary Sch. A1 - PS", "Expenses"])
        self.assertEqual(r["reason"], "schedule_not_found")
        self.assertEqual(r["pages_scanned"], 3)
        self.assertTrue(all(p.calls == [{}] for p in pages))
        r, _ = self.call(["Cover", ""])
        self.assertEqual(r["reason"], "unreadable_page")

    def test_wrong_identity_office_period_and_expectation_refuse(self):
        for changes in [
            {"candidate_name": "Hanson, Jess"},
            {"office": OFFICE.replace("55A", "55B")},
            {"period_end": "2026-08-25"},
            {"expected_total": "7348.54"},
            {"expected_total": 7348.55},
            {"expected_total": True},
            {"expected_total": Decimal("7348.550")},
            {"period_start": "2026-13-01"},
        ]:
            with self.subTest(changes=changes):
                r, _ = self.call([schedule()], **changes)
                self.assertEqual((r["status"], r["total"]), ("unavailable", None))
        r, _ = self.call([schedule()], candidate_name="  Hanson,\tJessica  ")
        self.assertEqual(r["status"], "checked")

    def test_malformed_extra_ambiguous_and_unreadable_rows_refuse(self):
        base = schedule()
        bad = [
            base.replace("08/26/2026", "02/30/2026"),
            base.replace("7,348.55", "7,348.5"),
            base.replace("State of Minnesota", "Other issuer"),
            base.replace("7,348.55", "-7,348.55"),
            base.replace("Public subsidy payment", "Public subsidy refund"),
            base.replace("Amount Received", "UNREADABLE Amount Received"),
            base.replace("Amount Received", "99.99\nAmount Received"),
            base.replace("Date Total", "Date Cash Total"),
            base.replace("Schedule A2", "Schedule A1"),
            base.replace("Page 1", "Page 2"),
            base.replace("Amount Received 7,348.55", "Amount Received 7,348.54"),
            base.replace(
                "Amount Received 7,348.55",
                "Amount Received 7,348.55\nAmount Received 7,348.55",
            ),
            base.replace(
                "Amount Received 7,348.55",
                "Amount Received 7,348.55\nAmount Received 0.00",
            ),
            base.replace(
                "Amount Received 7,348.55",
                "Amount Received 7,348.55\n08/27/2026 Public subsidy payment from State of Minnesota 0.00",
            ),
            base.replace("Printed 10/26/2026", "Printed unreadable"),
        ]
        for text in bad:
            with self.subTest(text=text):
                r, _ = self.call([text])
                self.assertEqual(r["status"], "unavailable")
        repeated = "08/26/2026 Public subsidy payment from State of Minnesota 1.00"
        r, _ = self.call(
            [schedule([repeated, repeated], "2.00")], expected_total="2.00"
        )
        self.assertEqual(r["reason"], "ambiguous_duplicate_payment")

    def test_nonconsecutive_pages_repeated_total_and_mode_disagreement(self):
        r, _ = self.call([schedule(total=None), "Unrelated", schedule(number=3)])
        self.assertEqual(r["reason"], "ambiguous_schedule_pages")
        r, _ = self.call([schedule(), schedule(number=2)])
        self.assertEqual(r["reason"], "duplicate_or_misplaced_total")
        r, _ = self.call([Page(schedule(), schedule().replace("7,348.55", "0.00"))])
        self.assertEqual(r["reason"], "extraction_modes_disagree")

    def test_missing_total_bad_pdf_limits_and_no_external_inputs(self):
        r, _ = self.call([schedule(total=None)])
        self.assertEqual(r["reason"], "missing_unique_total")
        kwargs = dict(
            candidate_name=NAME,
            office=OFFICE,
            period_start="2026-01-01",
            period_end="2026-10-19",
            expected_total="7348.55",
        )
        for body in [b"not PDF", None, b"%PDF-broken"]:
            r = m.extract_subsidy_receipts(body, **kwargs)
            self.assertEqual(r["status"], "unavailable")
        with self.assertRaises(TypeError):
            m.extract_subsidy_receipts(b"%PDF-broken", issuer_total="7348.55", **kwargs)
        with patch.object(m, "MAX_TEXT", 10):
            r, _ = self.call([schedule()])
            self.assertEqual(r["reason"], "text_limit_exceeded")
        with patch.object(m, "MAX_PAGES", 1):
            r, _ = self.call(["Cover", schedule(number=2)])
            self.assertEqual(r["reason"], "unsupported_pdf")

    def test_expense_bounds_and_exact_sum_ignore_ambient_precision(self):
        self.assertEqual(
            (m.MAX_BYTES, m.MAX_PAGES, m.MAX_TEXT),
            (64 * 1024 * 1024, 2000, 24 * 1024 * 1024),
        )
        with localcontext() as context:
            context.prec = 4
            r, _ = self.call([schedule()])
        self.assertEqual(r["status"], "checked")
        self.assertEqual(r["total"], Decimal("7348.55"))

    def test_orphan_subsidy_content_never_silently_ignored(self):
        for orphan in [
            "08/27/2026 Public subsidy payment from State of Minnesota 100.00",
            "BAD-DATE Public subsidy payment from State of Minnesota unreadable",
            "08/27/2026 Public subsidy payment from State of Minnesota 100.0?",
        ]:
            with self.subTest(orphan=orphan):
                r, pages = self.call([schedule(), orphan])
                self.assertEqual(
                    (r["status"], r["total"], r["reason"]),
                    ("unavailable", None, "orphan_subsidy_content"),
                )
                self.assertTrue(all(p.calls == [{}] for p in pages))
        r, pages = self.call([schedule(), "Other schedule: postage payment 100.00"])
        self.assertEqual(r["status"], "checked")
        self.assertEqual([len(p.calls) for p in pages], [2, 1])


if __name__ == "__main__":
    unittest.main(verbosity=2)
