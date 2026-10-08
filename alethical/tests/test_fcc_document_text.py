"""FCC document evidence stays page-scoped, conservative, and bounded."""

from __future__ import annotations

import io
import re
import shutil
import subprocess
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch

import pytest

from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.generic import (
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
)

from alethical.pipeline import fcc_document_text as reader
from alethical.pipeline.fcc_document_text import PageText, _read_facts, extract_document


def _pdf(*texts: str) -> bytes:
    writer = PdfWriter()
    for text in texts:
        page = writer.add_blank_page(width=612, height=792)
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {
                NameObject("/Font"): DictionaryObject(
                    {NameObject("/F1"): writer._add_object(font)}
                )
            }
        )
        stream = DecodedStreamObject()
        commands = ["BT /F1 12 Tf 40 750 Td"]
        for line in text.splitlines():
            safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            commands.append(f"({safe}) Tj 0 -16 Td")
        commands.append("ET")
        stream.set_data("\n".join(commands).encode("ascii"))
        page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def _read(*texts: str):
    return _read_facts(
        [PageText(n, text, "pypdf", "extracted") for n, text in enumerate(texts, 1)]
    )


def _values(facts):
    return {fact.field: fact.value for fact in facts}


# Retained text from page 4 of the official Defending Main Street PB-19,
# SHA256 0bc89eea480e8559e6bce2e1ce06b42acd61af18053cc1db7b3237976a69a96b.
# pypdf's layout output drops the filled values and splits "Station Call".
_PB19_HEADING = (
    "Political Broadcast Agreement Form for\nNon-Candidate/Issue Advertisements (PB-19)"
)
_PB19_PYPDF = (
    "Contract #:       Station  Call Letters:       Date Received/Requested:\n"
    "Est. #:           Station  Location:           Run Start and End Dates:"
)
_PB19_POPPLER = (
    "Contract #:       Station Call Letters:       Date Received/Requested:\n"
    "    #429347                   KSTP-TV         5/6/22\n"
    "Est. #:           Station Location:           Run Start and End Dates:\n"
    "    #8860         Minneapolis/St. Paul        5/6/22-5/13/22"
)

# Retained native layout from KARE contract 2577554, page 1,
# SHA256 1480c586b161b1c1b02423acec134ee287ba91f4072025717c097bb843d77f70.
_KARE_ADVERTISER_ROWS = (
    "Advertiser                    Original Date / Revision\n"
    "POL/ Keith Ellison / D / Attny General / MN       10/26/22 / 11/04/22"
)


class LabelReadingTests(unittest.TestCase):
    def test_actual_kare_header_is_not_advertiser_on_any_repeated_page(self):
        kind, facts, errors = _read(*([_KARE_ADVERTISER_ROWS] * 5))
        self.assertEqual(kind, "unknown")
        self.assertFalse(facts)
        self.assertFalse(errors)

    def test_explicit_advertiser_keeps_slashes_in_real_name(self):
        _, facts, _ = _read("Advertiser: POL/ Keith Ellison / D / Attny General / MN")
        self.assertEqual(
            _values(facts),
            {"advertiser": "POL/ Keith Ellison / D / Attny General / MN"},
        )

    def test_actual_pb19_column_heading_is_not_contract_number(self):
        _, facts, _ = _read(_PB19_HEADING, _PB19_PYPDF)
        self.assertNotIn("order_number", _values(facts))
        # Multiple aligned fields on the next row remain searchable evidence,
        # without guessing which filled value belongs to the contract label.
        _, facts, _ = _read(_PB19_HEADING, _PB19_POPPLER)
        self.assertNotIn("order_number", _values(facts))

    def test_explicit_disclosure_heading_outranks_referenced_contract(self):
        kind, facts, _ = _read(_PB19_HEADING, "Contract #: 429347")
        self.assertEqual(kind, "disclosure")
        self.assertEqual(_values(facts), {"order_number": "429347"})

    def test_identifiers_need_a_digit_to_avoid_bare_column_headings(self):
        _, facts, _ = _read("Order Number: Station\nInvoice Number: Date")
        self.assertFalse(facts)

    def test_actual_wideorbit_order_layout_and_totals(self):
        kind, facts, errors = _read(
            "ORDER\nOrders               Order / Rev:              510114\n"
            "Flight Dates:             07/17/26 - 07/21/26       Sales Office:     H-PHL\n"
            "Agency               Name:                     Strategic Media Services\n"
            "Arlington, VA  22203              Agency Commission:            15%\n"
            "Advertiser           Name:                     Lisa Demuth for Governor Committee\n"
            "Bill Plan                  Totals\n"
            "Start Date       End Date          # Spots   Gross Amount        Net Amount             Month                     # Spots      Gross Amount         Net Amount          Rating\n"
            "06/29/26         07/21/26               73    $23,240.00          $19,754.00            July 2026                   73           $23,240.00          $19,754.00          0.00\n"
            "                                                                                        Totals                           73         $23,240.00          $19,754.00         0.00",
            "Order / Rev:        510114      Advertiser:       Lisa Demuth for Governor Committee",
        )
        self.assertFalse(errors)
        self.assertEqual(kind, "order")
        self.assertEqual(
            _values(facts),
            {
                "order_number": "510114",
                "start_date": "07/17/26",
                "end_date": "07/21/26",
                "agency_name": "Strategic Media Services",
                "advertiser": "Lisa Demuth for Governor Committee",
                "commission_rate": "15",
                "gross_amount": "23240.00",
                "net_amount": "19754.00",
            },
        )
        self.assertNotIn("paid_amount", _values(facts))
        self.assertNotIn("commission_amount", _values(facts))

    def test_named_section_labels_are_never_values(self):
        _, facts, _ = _read("Agency  Name:\nAdvertiser  Name:")
        self.assertFalse(facts)

    def test_actual_wideorbit_invoice_layout(self):
        kind, facts, errors = _read(
            "Property            KSTP_KSAX               Order #         510114\n"
            "KSTP-TV, LLC         Invoice #           510114-1                Alt Order #     20155588\n"
            "3415 University Ave  Invoice Date        07/26/26                Ext. Opp. ID\n"
            "Main: (651)646-5555  Invoice Period      06/29/26 - 07/21/26     Flight Dates    07/17/26 - 07/21/26\n"
            "Billing: (651)642-4230  Advertiser          Lisa Demuth for Governor Committee\n"
            "Line   Start Date    End Date       Description   Rate\n"
            "1      07/19/26      07/19/26       News           $25.00",
            "INVOICE\nInvoice #   510114-1    Invoice Month  July 2026\n"
            "Payment Terms 30 Days       Gross Total           $20,445.00\n"
            "Agency Commission                    $3,066.75\n"
            "Net Amount Due                $17,378.25",
        )
        self.assertEqual(kind, "invoice")
        self.assertFalse(errors)
        self.assertEqual(
            _values(facts),
            {
                "order_number": "510114",
                "invoice_number": "510114-1",
                "invoice_date": "07/26/26",
                "start_date": "07/17/26",
                "end_date": "07/21/26",
                "advertiser": "Lisa Demuth for Governor Committee",
                "gross_amount": "20445.00",
                "commission_amount": "3066.75",
                "net_amount": "17378.25",
            },
        )
        self.assertEqual(next(f.page for f in facts if f.field == "gross_amount"), 2)

    def test_poppler_invoice_flight_cell_is_distinct_from_invoice_period(self):
        _, facts, _ = _read(
            "Main: (651)646-5555     Invoice Period    "
            "06/29/26 - 07/21/26 Flight Dates 07/17/26 - 07/21/26"
        )
        self.assertEqual(
            _values(facts), {"start_date": "07/17/26", "end_date": "07/21/26"}
        )
        _, facts, _ = _read("Invoice Period 06/29/26 - 07/21/26")
        self.assertFalse(facts)

    def test_invoice_values_have_exact_source_quotes(self):
        kind, facts, errors = _read(
            "INVOICE\nInvoice Number: A-101\nOrder Number: B-202\n"
            "Agency Name: Example Media\nAgency Address: 123 Main Street\n"
            "Advertiser: Example Committee\nPayer: Example Buyer\n"
            "Invoice Date: 10/08/2026\nStart Date: 10/01/2026\nEnd Date: 10/31/2026\n"
            "Gross Amount: $1,234.50\nCommission Amount: $123.45\n"
            "Commission Rate: 10%\nNet Total: $1,111.05\nTotal Order Amount: $2,000.00"
        )
        self.assertEqual(kind, "invoice")
        self.assertFalse(errors)
        self.assertEqual(_values(facts)["gross_amount"], "1234.50")
        self.assertEqual(_values(facts)["commission_rate"], "10")
        self.assertEqual(_values(facts)["agency_name"], "Example Media")
        self.assertEqual(_values(facts)["order_number"], "B-202")
        self.assertNotIn("paid_amount", _values(facts))
        self.assertTrue(all(fact.page == 1 for fact in facts))
        gross = next(fact for fact in facts if fact.field == "gross_amount")
        self.assertEqual(gross.quote, "Gross Amount: $1,234.50")

    def test_multiline_label_value_retains_quote(self):
        _, facts, _ = _read("Invoice Number\n\nA-101\nGross Amount:\n$42.30")
        self.assertEqual(
            _values(facts), {"invoice_number": "A-101", "gross_amount": "42.30"}
        )
        self.assertEqual(facts[0].quote, "Invoice Number\n\nA-101")

    def test_repeated_footer_preserves_each_page_and_deduplicates_same_quote(self):
        _, facts, errors = _read(
            "Invoice Number: A-101\nInvoice Number: A-101",
            "Invoice Number: A-101\nGross Amount: $18.00",
        )
        self.assertFalse(errors)
        numbers = [fact for fact in facts if fact.field == "invoice_number"]
        self.assertEqual([fact.page for fact in numbers], [1, 2])
        self.assertEqual(
            next(fact.page for fact in facts if fact.field == "gross_amount"), 2
        )

    def test_conflicting_values_are_not_chosen(self):
        _, facts, errors = _read("Gross Amount: $100.00", "Gross Amount: $200.00")
        self.assertFalse(facts)
        self.assertEqual(errors, ["conflicting_field:gross_amount"])

    def test_same_amount_formats_are_not_conflicting(self):
        _, facts, errors = _read("Gross Amount: $1,000.0", "Gross Amount: USD 1000.00")
        self.assertFalse(errors)
        self.assertEqual([f.value for f in facts], ["1000.00", "1000.00"])

    def test_credit_and_signs_remain_exact(self):
        kind, facts, _ = _read(
            "Credit Memo\nCredit Amount: ($1,234.56)\nNet Amount: -$1,234.56"
        )
        self.assertEqual(kind, "credit")
        self.assertEqual(
            _values(facts), {"credit_amount": "-1234.56", "net_amount": "-1234.56"}
        )

    def test_only_explicit_payment_label_can_be_paid(self):
        kind, facts, _ = _read(
            "Advertising Order\nOrder Total: $100.00\nAmount Due: $85.00"
        )
        self.assertEqual(kind, "order")
        self.assertEqual(_values(facts), {"total_order_amount": "100.00"})
        _, facts, _ = _read("Amount Paid: $25.00")
        self.assertEqual(_values(facts), {"paid_amount": "25.00"})

    def test_no_commission_or_zero_inferred_from_amounts(self):
        _, facts, _ = _read("Gross Amount: $100.00\nNet Amount: $85.00\nCommission:\n")
        self.assertEqual(set(_values(facts)), {"gross_amount", "net_amount"})

    def test_explicit_valid_commission_rate_is_read(self):
        self.assertEqual(
            _values(_read("Agency Commission: 15%")[1]), {"commission_rate": "15"}
        )

    def test_unknown_and_disclosure_are_not_invoice_by_incidental_word(self):
        self.assertEqual(_read("Please send your invoice to the station")[0], "unknown")
        self.assertEqual(
            _read("Political Advertising Disclosure\nAdvertiser: Committee")[0],
            "disclosure",
        )
        self.assertEqual(_read("INVOICE\nCredit Amount: $20.00")[0], "invoice")


@pytest.mark.parametrize(
    "text",
    (
        "Gross Amount  Net Amount\n$100.00      $85.00",
        "Gross Amount: $100.00  $85.00",
        "Gross Amount:\nNet Amount: $85.00",
        "Gross Amount: $10,00.00",
        "Gross Amount: $100.001",
        "Gross Amount: see page 2, $100.00",
        "Gross Amount: 1e3",
    ),
)
def test_wrong_columns_and_malformed_money_are_unknown(text):
    _, facts, _ = _read(text)
    assert "gross_amount" not in _values(facts)


@pytest.mark.parametrize("value", ("15", "150%", "$15.00", "15%  $300.00"))
def test_rate_requires_explicit_percent_and_valid_range(value):
    assert not _read(f"Commission Rate: {value}")[1]


@pytest.mark.parametrize(
    "label", ("Advertiser", "Agency Name", "Agency Address", "Payer")
)
@pytest.mark.parametrize(
    "heading",
    (
        "Original Date / Revision",
        "Contract / Revision",
        "Contract Dates",
        "Station Call Letters",
        "Account Executive",
        "Invoice Date",
    ),
)
def test_neighboring_headers_are_not_text_field_values(label, heading):
    assert not _read(f"{label}       {heading}")[1]
    assert not _read(f"{label}: {heading}")[1]
    assert not _read(f"{label}\n{heading}")[1]


# Separate pytest cases keep JUnit's declared count equal to its testcase nodes.
@pytest.mark.parametrize(
    "answer",
    (b"", subprocess.CalledProcessError(1, "pdftotext")),
    ids=("empty", "failed"),
)
def test_native_text_survives_empty_or_failed_poppler(answer):
    body = _pdf("Invoice Number: 12345")
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / "source.pdf"
        source.write_bytes(body)
        with (
            patch.object(reader.shutil, "which", return_value="pdftotext"),
            patch.object(reader, "_command", side_effect=[answer]),
            patch.object(reader, "_ocr_page") as ocr,
        ):
            result = reader._extract_pages(body, source)
    ocr.assert_not_called()
    assert result.pages[0].method == "pypdf"
    assert _values(result.facts) == {"invoice_number": "12345"}


class PdfReadingTests(unittest.TestCase):
    def test_usable_pb19_native_boilerplate_does_not_hide_filled_values(self):
        body = _pdf(_PB19_HEADING, _PB19_PYPDF)
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "pb19.pdf"
            source.write_bytes(body)
            with (
                patch.object(reader.shutil, "which", return_value="pdftotext"),
                patch.object(
                    reader,
                    "_command",
                    side_effect=[_PB19_HEADING.encode(), _PB19_POPPLER.encode()],
                ) as command,
                patch.object(reader, "_ocr_page") as ocr,
            ):
                result = reader._extract_pages(body, source)
        self.assertEqual(command.call_count, 2)
        ocr.assert_not_called()
        self.assertEqual(result.document_kind, "disclosure")
        self.assertEqual(result.pages[1].method, "pdftotext")
        self.assertIn("#429347", result.pages[1].text)
        self.assertIn("KSTP-TV", result.pages[1].text)
        self.assertIn("5/6/22-5/13/22", result.pages[1].text)
        self.assertNotIn("order_number", _values(result.facts))

    @unittest.skipUnless(
        shutil.which("pdftoppm") and shutil.which("tesseract"),
        "optional local OCR tools are unavailable",
    )
    def test_real_local_ocr_of_image_only_pdf(self):
        # Rasterize generated source text, then embed only pixels in the PDF.
        # The assertion exercises actual recognition, not a mocked OCR answer.
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "native.pdf"
            source.write_bytes(_pdf("Invoice Number: 12345", "Gross Amount: $42.30"))
            prefix = Path(directory) / "raster"
            subprocess.run(
                [
                    "pdftoppm",
                    "-f",
                    "1",
                    "-l",
                    "1",
                    "-singlefile",
                    "-r",
                    "150",
                    str(source),
                    str(prefix),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=30,
            )
            ppm = prefix.with_suffix(".ppm").read_bytes()
            header = re.match(rb"P6\n(\d+) (\d+)\n255\n", ppm)
            self.assertIsNotNone(header)
            assert header is not None
            image = DecodedStreamObject()
            image.set_data(zlib.compress(ppm[header.end() :]))
            image.update(
                {
                    NameObject("/Type"): NameObject("/XObject"),
                    NameObject("/Subtype"): NameObject("/Image"),
                    NameObject("/Width"): NumberObject(int(header.group(1))),
                    NameObject("/Height"): NumberObject(int(header.group(2))),
                    NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
                    NameObject("/BitsPerComponent"): NumberObject(8),
                    NameObject("/Filter"): NameObject("/FlateDecode"),
                }
            )
            writer = PdfWriter()
            page = writer.add_blank_page(612, 792)
            page[NameObject("/Resources")] = DictionaryObject(
                {
                    NameObject("/XObject"): DictionaryObject(
                        {NameObject("/Im0"): writer._add_object(image)}
                    )
                }
            )
            content = DecodedStreamObject()
            content.set_data(b"q 612 0 0 792 0 0 cm /Im0 Do Q")
            page[NameObject("/Contents")] = writer._add_object(content)
            output = io.BytesIO()
            writer.write(output)
            result = extract_document(output.getvalue(), "scan.pdf")
        self.assertEqual(result.status, "pending_review")
        self.assertEqual(result.pages[0].method, "tesseract")
        self.assertIn("12345", result.pages[0].text)

        # A searchable footer beside a full-page scanned invoice must not make
        # the image body disappear from the searchable evidence.
        footer_writer = PdfWriter(
            clone_from=PdfReader(io.BytesIO(_pdf("Station Public File")))
        )
        footer = footer_writer.pages[0]
        footer.add_transformation(Transformation().translate(0, -700))
        page.merge_page(footer)
        mixed = io.BytesIO()
        writer.write(mixed)
        body = mixed.getvalue()
        result = extract_document(body, "native-footer-scanned-body.pdf")
        self.assertEqual(result.status, "pending_review")
        native_method = "pdftotext" if shutil.which("pdftotext") else "pypdf"
        self.assertEqual(result.pages[0].method, native_method + "+tesseract")
        self.assertIn("Station Public File", result.pages[0].text)
        self.assertIn("12345", result.pages[0].text)
        self.assertEqual(_values(result.facts)["invoice_number"], "12345")

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "mixed.pdf"
            source.write_bytes(body)
            with patch.object(
                reader, "_ocr_page", return_value=("", "local_ocr_failed")
            ):
                failed = reader._extract_pages(body, source)
        self.assertEqual(failed.status, "partial")
        self.assertEqual(failed.pages[0].status, "partial")
        self.assertEqual(failed.pages[0].error, "local_ocr_failed")
        self.assertIn("Station Public File", failed.pages[0].text)
        self.assertNotIn("invoice_number", _values(failed.facts))

    def test_real_pdf_roundtrip_ignores_filename_and_preserves_pages(self):
        result = extract_document(
            _pdf("Invoice Number: 123", "Gross Amount: $42.30"), "paid-$9999.pdf"
        )
        self.assertEqual(result.status, "pending_review")
        self.assertEqual(result.document_kind, "invoice")
        self.assertEqual([page.page for page in result.pages], [1, 2])
        native_method = "pdftotext" if shutil.which("pdftotext") else "pypdf"
        self.assertEqual([page.method for page in result.pages], [native_method] * 2)
        self.assertEqual(result.version, "fcc-document-text-v3")
        self.assertEqual(
            _values(result.facts), {"invoice_number": "123", "gross_amount": "42.30"}
        )
        result = extract_document(
            _pdf("Station political file"), "invoice-500-paid-$9999.pdf"
        )
        self.assertEqual(result.document_kind, "unknown")
        self.assertFalse(result.facts)
        same_body = _pdf("Invoice Number: 123")
        self.assertEqual(
            extract_document(same_body, "order.pdf"),
            extract_document(same_body, "invoice-paid-1000.pdf"),
        )

    def test_blank_page_never_counts_as_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            body = _pdf("Invoice Number: 123", "")
            source.write_bytes(body)
            with patch.object(reader.shutil, "which", return_value=None):
                result = reader._extract_pages(body, source)
        self.assertEqual(result.status, "partial")
        self.assertEqual(result.pages[1].status, "needs_ocr")
        self.assertEqual(result.pages[1].error, "local_ocr_unavailable")
        self.assertEqual(result.pages[1].text, "")

    def test_ocr_is_only_used_for_pages_without_text(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            body = _pdf("Invoice Number: 123", "")
            source.write_bytes(body)
            with (
                patch.object(reader.shutil, "which", return_value=None),
                patch.object(
                    reader, "_ocr_page", return_value=("Net Amount: $85.00", None)
                ) as ocr,
            ):
                result = reader._extract_pages(body, source)
        self.assertEqual(ocr.call_count, 1)
        self.assertEqual(ocr.call_args.args[1], 2)
        self.assertEqual(result.pages[1].method, "tesseract")
        self.assertEqual(result.status, "pending_review")
        self.assertEqual(
            next(f.page for f in result.facts if f.field == "net_amount"), 2
        )

    def test_failed_ocr_retains_gap_and_error(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            body = _pdf("")
            source.write_bytes(body)
            with (
                patch.object(reader.shutil, "which", return_value=None),
                patch.object(
                    reader, "_ocr_page", return_value=("", "local_ocr_no_text")
                ),
            ):
                result = reader._extract_pages(body, source)
        self.assertEqual(result.status, "unreadable")
        self.assertEqual(result.pages[0].status, "unreadable")
        self.assertEqual(result.pages[0].error, "local_ocr_no_text")

    def test_all_empty_pages_without_ocr_are_needs_ocr(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            body = _pdf("Page 1", "Page 2")
            source.write_bytes(body)
            with patch.object(reader.shutil, "which", return_value=None):
                result = reader._extract_pages(body, source)
        self.assertEqual(result.status, "needs_ocr")
        self.assertTrue(all(page.status == "needs_ocr" for page in result.pages))
        self.assertFalse(result.facts)

    def test_not_pdf_and_malformed_pdf_are_unreadable(self):
        self.assertEqual(
            extract_document(b"<html>denied</html>", "invoice.pdf").status, "unreadable"
        )
        self.assertEqual(
            extract_document(b"%PDF-invalid", "invoice.pdf").status, "unreadable"
        )

    def test_encrypted_pdf_is_unreadable(self):
        writer = PdfWriter()
        writer.add_blank_page(612, 792)
        writer.encrypt("password")
        output = io.BytesIO()
        writer.write(output)
        result = extract_document(output.getvalue(), "encrypted.pdf")
        self.assertEqual(result.errors, ["encrypted_pdf"])

    def test_page_and_byte_limits_fail_without_partial_claim(self):
        with patch.object(reader, "MAX_DOCUMENT_BYTES", 2):
            self.assertEqual(extract_document(b"%PDF-", "x").status, "limit_exceeded")
        with patch.object(reader, "MAX_PAGES", 1):
            result = reader._extract_pages(_pdf("a", "b"), Path("unused.pdf"))
        self.assertEqual(result.status, "limit_exceeded")
        self.assertFalse(result.pages)

    def test_worker_timeout_reports_bounded_failure(self):
        with (
            patch.object(reader.subprocess, "Popen") as constructor,
            patch.object(reader.os, "killpg") as kill,
        ):
            process = constructor.return_value
            process.wait.side_effect = [subprocess.TimeoutExpired("reader", 180), 0]
            process.pid = 123456
            result = extract_document(b"%PDF-", "x")
        self.assertEqual(result.errors, ["document_time_limit"])
        self.assertEqual(result.status, "limit_exceeded")
        kill.assert_called_once_with(123456, reader.signal.SIGKILL)


if __name__ == "__main__":
    unittest.main()
