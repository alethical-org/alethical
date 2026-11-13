"""Checked regions must use the same page plane as the actual rendered original."""

from io import BytesIO
import struct

import pytest
from pypdf import PdfWriter
from pypdf.generic import NameObject, NumberObject, RectangleObject

from alethical.pipeline import election_source_readings as readings
from alethical.pipeline.election_comparison import ComparisonImportError


def geometry_pdf(
    *, rotation=0, crop=False, origin=False, second_page=False, size=(792, 612)
):
    writer = PdfWriter()
    page = writer.add_blank_page(width=size[0], height=size[1])
    if origin:
        page.mediabox = RectangleObject([30, 40, 30 + size[0], 40 + size[1]])
    if crop:
        page.cropbox = RectangleObject([60, 70, 750, 590])
    page[NameObject("/Rotate")] = NumberObject(rotation)
    if second_page:
        writer.add_blank_page(width=612, height=792)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


@pytest.mark.parametrize(
    ("rotation", "expected"),
    [
        (0, (792, 612)),
        (90, (612, 792)),
        (180, (792, 612)),
        (270, (612, 792)),
        (-90, (612, 792)),
        (450, (612, 792)),
    ],
)
def test_page_coordinates_match_actual_rotated_render(rotation, expected):
    metadata, png = readings.render_page(geometry_pdf(rotation=rotation), 1)
    assert (metadata["width"], metadata["height"]) == expected
    pixel_width, pixel_height = struct.unpack(">II", png[16:24])
    scale = 2600 / max(expected)
    assert abs(pixel_width - expected[0] * scale) <= 1
    assert abs(pixel_height - expected[1] * scale) <= 1


@pytest.mark.parametrize("rotation", [0, 90])
@pytest.mark.parametrize("origin", [False, True])
def test_crop_box_does_not_change_full_page_render_coordinates(rotation, origin):
    full, full_png = readings.render_page(
        geometry_pdf(rotation=rotation, origin=origin), 1
    )
    cropped, cropped_png = readings.render_page(
        geometry_pdf(rotation=rotation, crop=True, origin=origin), 1
    )
    assert (cropped["width"], cropped["height"]) == (full["width"], full["height"])
    assert struct.unpack(">II", cropped_png[16:24]) == struct.unpack(
        ">II", full_png[16:24]
    )


def test_each_page_keeps_its_own_display_dimensions():
    body = geometry_pdf(rotation=90, second_page=True)
    first, _ = readings.render_page(body, 1)
    second, _ = readings.render_page(body, 2)
    assert (first["width"], first["height"]) == (612, 792)
    assert (second["width"], second["height"]) == (612, 792)


def test_fractional_full_page_preserves_readable_coordinate_precision():
    body = geometry_pdf(size=(599.2258, 792), origin=True)
    metadata, _ = readings.render_page(body, 1)
    assert (metadata["width"], metadata["height"]) == (599.226, 792)


def test_rotated_page_accepts_visible_bottom_region_and_rejects_outside_right():
    body = geometry_pdf(rotation=90)
    field = readings.field_proposal(
        "cover.empty",
        page=1,
        bounds=[40, 740, 100, 770],
        label="Synthetic empty cell",
        literal="",
        state="blank",
        value_type="text",
    )
    receipt = readings.prepare_receipt(
        body, fields=[field], document_kind="financial_report"
    )
    assert receipt["fields"][0]["bounds"] == [40, 740, 100, 770]
    receipt["fields"][0]["bounds"] = [650, 40, 680, 70]
    with pytest.raises(ComparisonImportError, match="page bounds"):
        readings.validate_receipt(receipt)


def test_fresh_replay_rejects_old_rotated_dimensions_without_rewriting_receipt():
    body = geometry_pdf(rotation=90)
    field = readings.field_proposal(
        "cover.empty",
        page=1,
        bounds=[10, 10, 20, 20],
        label="Synthetic empty cell",
        literal="",
        state="blank",
        value_type="text",
    )
    receipt = readings.prepare_receipt(
        body, fields=[field], document_kind="financial_report"
    )
    originals = {receipt["original_sha256"]: body}
    readings.verify_receipt_sources(receipt, originals, render=True)
    receipt["pages"][0].update(width=792.0, height=612.0)
    with pytest.raises(ComparisonImportError, match="render differs"):
        readings.verify_receipt_sources(receipt, originals, render=True)
    assert (receipt["pages"][0]["width"], receipt["pages"][0]["height"]) == (792, 612)


@pytest.mark.parametrize("forged_rotation", [0, 90])
def test_pdf_metadata_cannot_supply_a_second_page_rotation(forged_rotation):
    writer = PdfWriter()
    page = writer.add_blank_page(width=792, height=612)
    page.rotate(90)
    writer.add_metadata(
        {"/Title": f"Synthetic title\nPage    1 rot:   {forged_rotation}"}
    )
    out = BytesIO()
    writer.write(out)
    with pytest.raises(ComparisonImportError, match="Cannot render"):
        readings.render_page(out.getvalue(), 1)


@pytest.mark.parametrize("page_count", [1, 257])
def test_pdf_metadata_cannot_replace_the_native_page_count(page_count):
    writer = PdfWriter()
    for _ in range(page_count):
        writer.add_blank_page(width=792, height=612)
    writer.add_metadata({"/Title": "Synthetic title\nPages: 1"})
    out = BytesIO()
    writer.write(out)
    with pytest.raises(ComparisonImportError, match="page count"):
        readings.render_page(out.getvalue(), 1)
