"""Flatten FCC PDF pages and burn redactions into pixels before private storage.

No source PDF objects, annotations, metadata, embedded files, fonts or text are
copied. Safe searchable text is reviewed separately by the publication service.
"""

from __future__ import annotations

import hashlib
import io
import math
import struct
import subprocess
import tempfile
import time
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
)

MAX_SOURCE_BYTES = 30 * 1024 * 1024
MAX_PAGES = 100
MAX_EDGE = 1600
MAX_ARTIFACT_BYTES = 100 * 1024 * 1024


def _number(value):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise ValueError("Redaction coordinates must be finite numbers")
    return float(value)


def validate_redactions(redactions: list, page_count: int) -> list[dict]:
    if not isinstance(redactions, list) or len(redactions) > 5000:
        raise ValueError("Use a bounded list of redactions")
    result = []
    for box in redactions:
        if (
            not isinstance(box, dict)
            or set(box) - {"page", "x", "y", "width", "height", "kind"}
            or not {"page", "x", "y", "width", "height"}.issubset(box)
        ):
            raise ValueError("Redaction needs page, x, y, width and height")
        page = box["page"]
        if (
            isinstance(page, bool)
            or not isinstance(page, int)
            or not 1 <= page <= page_count
        ):
            raise ValueError("Redaction page is outside the document")
        values = {key: _number(box[key]) for key in ("x", "y", "width", "height")}
        if not (
            0 <= values["x"] < 1
            and 0 <= values["y"] < 1
            and 0 < values["width"] <= 1
            and 0 < values["height"] <= 1
            and values["x"] + values["width"] <= 1.0000001
            and values["y"] + values["height"] <= 1.0000001
        ):
            raise ValueError("Redaction rectangle must fit inside the page")
        kind = box.get("kind", "blank")
        if kind not in {"blank", "name_withheld"}:
            raise ValueError("Use blank or name_withheld redactions")
        result.append({"page": page, "kind": kind, **values})
    return result


def _ppm(data: bytes) -> tuple[int, int, bytearray]:
    # Poppler writes 8-bit binary P6 RGB. Parse headers without treating pixel
    # whitespace as header whitespace: the first pixel may itself be 0x0a.
    pos, tokens = 0, []
    while len(tokens) < 4:
        while pos < len(data) and data[pos] in b" \t\r\n":
            pos += 1
        if pos < len(data) and data[pos] == 35:
            pos = data.index(b"\n", pos) + 1
            continue
        start = pos
        while pos < len(data) and data[pos] not in b" \t\r\n":
            pos += 1
        tokens.append(data[start:pos])
    if tokens[0] != b"P6" or tokens[3] != b"255" or pos >= len(data):
        raise ValueError("Unsupported raster output")
    width, height = int(tokens[1]), int(tokens[2])
    if not 0 < width <= MAX_EDGE or not 0 < height <= MAX_EDGE:
        raise ValueError("Raster dimensions exceed limits")
    pixels = bytearray(data[pos + 1 :])
    if len(pixels) != width * height * 3:
        raise ValueError("Incomplete raster output")
    return width, height, pixels


def burn_pixels(width: int, height: int, pixels: bytearray, boxes: list[dict]) -> bytes:
    """Replace every covered pixel, including fractional rectangle edges."""
    if len(pixels) != width * height * 3:
        raise ValueError("Pixel buffer has the wrong size")
    image = Image.frombytes("RGB", (width, height), bytes(pixels))
    draw = ImageDraw.Draw(image)
    font_path = (
        Path(__file__).resolve().parents[1] / "assets/fonts/LibreFranklin-Bold.ttf"
    )
    for box in boxes:
        x0 = max(0, math.floor(box["x"] * width))
        y0 = max(0, math.floor(box["y"] * height))
        x1 = min(width, math.ceil((box["x"] + box["width"]) * width))
        y1 = min(height, math.ceil((box["y"] + box["height"]) * height))
        if box.get("kind", "blank") == "blank":
            draw.rectangle((x0, y0, x1 - 1, y1 - 1), fill="#d6dad7")
            continue
        draw.rectangle(
            (x0, y0, x1 - 1, y1 - 1), fill="#eef0ef", outline="#8d948e", width=1
        )
        for size in range(min(32, y1 - y0 - 4), 5, -1):
            font = ImageFont.truetype(str(font_path), size)
            bounds = draw.textbbox((0, 0), "Name withheld", font=font)
            tw, th = bounds[2] - bounds[0], bounds[3] - bounds[1]
            if tw <= x1 - x0 - 6 and th <= y1 - y0 - 4:
                draw.text(
                    (
                        x0 + (x1 - x0 - tw) / 2 - bounds[0],
                        y0 + (y1 - y0 - th) / 2 - bounds[1],
                    ),
                    "Name withheld",
                    font=font,
                    fill="#2c322c",
                )
                break
        else:
            raise ValueError(
                "Enlarge the Name withheld rectangle so its label is readable"
            )
    return image.tobytes()


def _png(width: int, height: int, pixels: bytes) -> bytes:
    def chunk(kind, body):
        return (
            struct.pack(">I", len(body))
            + kind
            + body
            + struct.pack(">I", zlib.crc32(kind + body))
        )

    scanlines = b"".join(
        b"\x00" + pixels[y * width * 3 : (y + 1) * width * 3] for y in range(height)
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scanlines))
        + chunk(b"IEND", b"")
    )


def render_redacted(
    source: bytes, redactions: list, *, only_page: int | None = None
) -> dict:
    """Return newly encoded PNG pages and a pixel-only PDF, with strict limits."""
    if len(source) > MAX_SOURCE_BYTES or not source.lstrip().startswith(b"%PDF-"):
        raise ValueError("Use a PDF within the source size limit")
    reader = PdfReader(io.BytesIO(source), strict=True)
    if reader.is_encrypted:
        raise ValueError("Encrypted source cannot be prepared")
    page_count = len(reader.pages)
    if not 1 <= page_count <= MAX_PAGES:
        raise ValueError("Document page count exceeds preparation limits")
    if only_page is not None and (
        isinstance(only_page, bool)
        or not isinstance(only_page, int)
        or not 1 <= only_page <= page_count
    ):
        raise ValueError("Requested page is outside the document")
    boxes = validate_redactions(redactions, page_count)
    started = time.monotonic()
    pages, writer, total = [], PdfWriter(), 0
    writer.metadata = None
    with tempfile.TemporaryDirectory(prefix="tv-redaction-") as directory:
        path = Path(directory) / "source.pdf"
        path.write_bytes(source)
        for page in [only_page] if only_page is not None else range(1, page_count + 1):
            if time.monotonic() - started > 180:
                raise ValueError("Document preparation exceeded the time limit")
            prefix = Path(directory) / "page"
            try:
                subprocess.run(
                    [
                        "pdftoppm",
                        "-f",
                        str(page),
                        "-l",
                        str(page),
                        "-singlefile",
                        "-scale-to",
                        str(MAX_EDGE),
                        str(path),
                        str(prefix),
                    ],
                    check=True,
                    timeout=30,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except (OSError, subprocess.SubprocessError) as error:
                raise ValueError("Private PDF page preparation failed") from error
            ppm_path = prefix.with_suffix(".ppm")
            if ppm_path.stat().st_size > MAX_EDGE * MAX_EDGE * 3 + 1024:
                raise ValueError("Raster size exceeds limit")
            width, height, pixels = _ppm(ppm_path.read_bytes())
            pixels = burn_pixels(
                width, height, pixels, [box for box in boxes if box["page"] == page]
            )
            png = _png(width, height, pixels)
            total += len(png)
            if total > MAX_ARTIFACT_BYTES:
                raise ValueError("Prepared pages exceed storage limit")
            pages.append({"page": page, "width": width, "height": height, "bytes": png})
            image = DecodedStreamObject()
            image.set_data(pixels)
            image.update(
                {
                    NameObject("/Type"): NameObject("/XObject"),
                    NameObject("/Subtype"): NameObject("/Image"),
                    NameObject("/Width"): NumberObject(width),
                    NameObject("/Height"): NumberObject(height),
                    NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
                    NameObject("/BitsPerComponent"): NumberObject(8),
                }
            )
            image_ref = writer._add_object(image.flate_encode())
            out_page = writer.add_blank_page(width=width, height=height)
            out_page[NameObject("/Resources")] = DictionaryObject(
                {
                    NameObject("/XObject"): DictionaryObject(
                        {NameObject("/PageImage"): image_ref}
                    )
                }
            )
            content = DecodedStreamObject()
            content.set_data(
                f"q {width} 0 0 {height} 0 0 cm /PageImage Do Q".encode("ascii")
            )
            out_page[NameObject("/Contents")] = writer._add_object(content)
        output = io.BytesIO()
        writer.write(output)
        pdf = output.getvalue()
    if len(pdf) > MAX_ARTIFACT_BYTES:
        raise ValueError("Prepared PDF exceeds storage limit")
    return {"pdf": pdf, "pages": pages, "redactions": boxes}


def store_artifacts(store, rendered: dict) -> dict:
    """Save immutable private artifacts and verify each stored fingerprint."""

    def save(body, extension):
        digest = hashlib.sha256(body).hexdigest()
        key = f"fcc/tv-approved-copies/{digest}.{extension}"
        with tempfile.TemporaryDirectory(prefix="tv-store-") as directory:
            path = Path(directory) / ("copy." + extension)
            path.write_bytes(body)
            store.put_and_verify(key, str(path), digest)
        return {"object_key": key, "sha256": digest, "byte_size": len(body)}

    return {
        "pdf": save(rendered["pdf"], "pdf"),
        "pages": [
            {
                "page": page["page"],
                "width": page["width"],
                "height": page["height"],
                **save(page["bytes"], "png"),
            }
            for page in rendered["pages"]
        ],
    }
