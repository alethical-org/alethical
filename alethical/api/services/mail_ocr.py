"""Local OCR, retaining raw evidence beside a readable presentation."""

from __future__ import annotations

import csv
import io
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from alethical.api.services.mail_reading_copy import reading_copy

PAYER = re.compile(r"\b(?:prepared\s+and\s+)?paid\s+for\s+by\s+(.+)", re.I)


def disclosures(lines: list[dict], width: int, height: int) -> list[dict]:
    """Quote OCR verbatim; never fill a clipped or missing disclosure."""
    found = []
    for index, line in enumerate(lines):
        match = PAYER.search(line["text"])
        if not match:
            continue
        # One immediately following line is retained only as evidence, not silently
        # joined to a payer's name. A missing name remains an unreadable outcome.
        payer = match.group(1).strip()
        payer = re.split(
            r"[.;]|,?\s+https?://|,?\s+P\.?O\.?\s+Box\b|,\s+\d|\s+not\s+authorized",
            payer,
            maxsplit=1,
            flags=re.I,
        )[0].strip()
        box = line["box"]
        edge = box[0] <= 8 or box[1] <= 8 or box[2] >= width - 8 or box[3] >= height - 8
        found.append(
            {
                "quote": line["text"],
                "payer_text": payer or None,
                "quality": "machine_read",
                "edge_warning": edge,
                "box": box,
                "confidence": line["confidence"],
            }
        )
    return found


def parse_tsv(raw):
    grouped = {}
    for word in csv.DictReader(
        io.StringIO(raw), delimiter="\t", quoting=csv.QUOTE_NONE
    ):
        value = word.get("text", "").strip()
        confidence = float(word.get("conf", "-1"))
        if not value or confidence < 0:
            continue
        key = tuple(word[name] for name in ("block_num", "par_num", "line_num"))
        x, y, w, h = (int(word[name]) for name in ("left", "top", "width", "height"))
        grouped.setdefault(key, []).append((value, confidence, x, y, x + w, y + h))
    return [
        {
            "text": " ".join(w[0] for w in words),
            "confidence": round(sum(w[1] for w in words) / len(words), 1),
            "words": [
                {"text": w[0], "confidence": w[1], "box": list(w[2:])} for w in words
            ],
            "box": [
                min(w[2] for w in words),
                min(w[3] for w in words),
                max(w[4] for w in words),
                max(w[5] for w in words),
            ],
        }
        for words in grouped.values()
    ]


def deskew(image):
    """Local projection pass on a small disclosure crop, without changing bytes."""
    if np.median(np.asarray(image.convert("L"))) < 120:
        image = ImageOps.invert(image)
    sample = image.convert("L")
    sample.thumbnail((800, 300))
    pixels = np.asarray(sample)
    threshold = float(np.percentile(pixels, 35))
    mask = Image.fromarray(np.where(pixels < threshold, 255, 0).astype(np.uint8))
    choices = []
    for angle in range(-12, 13, 2):
        turned = np.asarray(mask.rotate(angle, expand=False, fillcolor=0), dtype=float)
        projection = turned.sum(axis=1)
        choices.append((float(np.square(np.diff(projection)).sum()), angle))
    angle = max(choices)[1]
    return image.rotate(
        angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor="white"
    ), angle


def angled_disclosure_region(size, box):
    """Keep context above/below sloped fine print, without reading the full page."""
    width, height = size
    x1, y1, x2, y2 = box
    span = x2 - x1
    left = max(0, x1 - max(600, span * 2))
    right = min(width, x2 + max(400, span))
    pad = max(200, int((right - left) * 0.22))
    return (left, max(0, y1 - pad), right, min(height, y2 + pad))


def disclosure_column(lines, start):
    """Keep only nearby lines aligned with the disclosure, not postage columns."""
    first = lines[start]
    x1, y1, x2, y2 = first["box"]
    selected = [first]
    bottom = y2
    line_height = max(1, y2 - y1)
    for line in sorted(lines, key=lambda item: item["box"][1]):
        if line is first:
            continue
        left, top, right, end = line["box"]
        if top < y1 + line_height / 2 or top > bottom + line_height * 2:
            continue
        overlap = max(0, min(x2, right) - max(x1, left))
        if (
            abs(left - x1) > max(80, line_height * 2)
            or overlap < min(x2 - x1, right - left) * 0.5
        ):
            continue
        selected.append(line)
        bottom = end
        if len(selected) == 4:
            break
    return selected


def payer_context(quote):
    """Stop a name at a separately read address/site line; retain the full quote."""
    kept = []
    for line in quote.splitlines():
        if kept and re.search(
            r"^\s*(?:https?://|www\.|P\.?\s*O\.?\s+Box\b|"
            r"\d{1,6}\s+.+\b(?:street|st|avenue|ave|boulevard|blvd|road|rd|"
            r"lane|ln|drive|dr|way|court|ct|highway|hwy)\b)",
            line,
            re.I,
        ):
            break
        kept.append(line)
    return " ".join(" ".join(kept).split())


def refine_disclosure(rotated, quote, folder, deadline):
    x1, y1, x2, y2 = quote["box"]
    pad = max(12, (y2 - y1) // 2)
    regions = [
        (
            max(0, x1 - pad),
            max(0, y1 - pad),
            min(rotated.width, x2 + pad),
            min(rotated.height, y2 + 4 * (y2 - y1)),
        ),
        (
            max(0, x1 - pad),
            max(0, y1 - pad),
            min(rotated.width, x2 + max(400, x2 - x1)),
            min(rotated.height, y2 + 4 * (y2 - y1)),
        ),
        (
            0,
            max(0, y1 - pad),
            min(rotated.width, x2 + pad),
            min(rotated.height, y2 + 4 * (y2 - y1)),
        ),
    ]
    # One extra sparse pass only when the normal disclosure read is unresolved
    # or weak. It shares the existing per-image deadline and 3-anchor limit.
    regions.append(angled_disclosure_region(rotated.size, quote["box"]))
    best = None
    try:
        for region_index, region in enumerate(regions):
            sparse = region_index == len(regions) - 1
            if (
                sparse
                and best is not None
                and best[1]["confidence"] >= 90
                and not best[1]["edge_warning"]
            ):
                break
            original_crop = rotated.crop(region)
            variants = (
                (deskew(original_crop),)
                if sparse
                else ((original_crop, 0), deskew(original_crop))
            )
            for corrected, angle in variants:
                if time.monotonic() >= deadline:
                    break
                path = Path(folder) / "disclosure.png"
                corrected.save(path)
                raw = subprocess.run(
                    [
                        "nice",
                        "-n",
                        "10",
                        "tesseract",
                        str(path.resolve()),
                        "stdout",
                        "-l",
                        "eng",
                        "--psm",
                        "11" if sparse else "6",
                        "tsv",
                    ],
                    capture_output=True,
                    check=True,
                    timeout=max(0.1, min(10, deadline - time.monotonic())),
                    env={**os.environ, "OMP_THREAD_LIMIT": "1"},
                ).stdout.decode("utf-8", errors="replace")
                lines = parse_tsv(raw)
                start = next(
                    (i for i, line in enumerate(lines) if PAYER.search(line["text"])),
                    None,
                )
                if start is None:
                    continue
                relevant = disclosure_column(lines, start) if sparse else lines[start:]
                refined = "\n".join(line["text"] for line in relevant)
                match = PAYER.search(payer_context(refined))
                split = re.split(
                    r"[.;]|,?\s+https?://|,?\s+P\.?O\.?\s+Box\b|,\s+\d|\s+not\s+authorized",
                    match.group(1),
                    maxsplit=1,
                    flags=re.I,
                )
                payer = split[0].strip()
                measured = relevant[: min(2, len(relevant))]
                confidence = sum(line["confidence"] for line in measured) / len(
                    measured
                )
                edge = any(
                    line["box"][0] <= 3 or line["box"][2] >= corrected.width - 3
                    for line in measured
                )
                score = (
                    confidence
                    - 20 * edge
                    - 15 * (len(split) == 1)
                    - 20 * (len(payer) > 100)
                )
                if best is None or score > best[0]:
                    best = (
                        score,
                        {
                            **quote,
                            "quote": refined,
                            "box": None,
                            "payer_text": payer,
                            "confidence": round(confidence, 1),
                            "edge_warning": edge or quote["edge_warning"],
                            "crop": {
                                "source_box": list(region),
                                "width": corrected.width,
                                "height": corrected.height,
                                "deskew_angle": angle,
                                "segmentation": "sparse_column" if sparse else "block",
                            },
                        },
                    )
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
        if best is None:
            raise
        best[1]["refinement_incomplete"] = True
    chosen = best[1] if best else quote
    if chosen.get("payer_text") and len(chosen["payer_text"]) > 100:
        chosen["payer_text"] = None
        chosen["edge_warning"] = True
    return chosen


def image_fingerprint(image):
    """Private similarity hint only; never evidence of the same creative version."""
    pixels = np.asarray(image.convert("L").resize((9, 8)))
    bits = (pixels[:, 1:] > pixels[:, :-1]).flatten()
    return format(sum(int(bit) << index for index, bit in enumerate(bits)), "016x")


def read_image(path: Path) -> dict:
    """Bound work and memory; preserve original file, including its metadata."""
    best = None
    recovery_attempted = False
    deadline = time.monotonic() + 90
    with Image.open(path) as original:
        original.draft("RGB", (4000, 4000))
        picture = ImageOps.exif_transpose(original)
        picture.thumbnail((4000, 4000))
        picture = picture.convert("RGB")
    with tempfile.TemporaryDirectory(prefix="mail-ocr-") as folder:
        try:
            for angle in (0, 90, 180, 270):
                if time.monotonic() >= deadline:
                    break
                oriented = picture.rotate(angle, expand=True)
                rotated, skew = oriented, 0
                source = Path(folder) / "page.png"
                rotated.save(source)
                raw = subprocess.run(
                    [
                        "nice",
                        "-n",
                        "10",
                        "tesseract",
                        str(source.resolve()),
                        "stdout",
                        "-l",
                        "eng",
                        "--psm",
                        "11",
                        "tsv",
                    ],
                    capture_output=True,
                    timeout=max(0.1, min(25, deadline - time.monotonic())),
                    check=True,
                    env={**os.environ, "OMP_THREAD_LIMIT": "1"},
                ).stdout.decode("utf-8", errors="replace")
                lines = parse_tsv(raw)
                initial_copy = reading_copy(
                    {
                        "text": "\n".join(line["text"] for line in lines),
                        "reading_lines": lines,
                    }
                )
                # Only recover an almost empty read. Established payer evidence
                # stays on the original path; dark/angled large print gets one
                # bounded local grayscale pass, within the same image deadline.
                if (
                    len(initial_copy["display_text"]) < 40
                    and not recovery_attempted
                    and (best is None or best[0] < 40)
                    and not any(PAYER.search(line["text"]) for line in lines)
                    and time.monotonic() < deadline
                ):
                    recovery_attempted = True
                    recovered, recovered_skew = deskew(oriented)
                    recovered = ImageOps.grayscale(recovered)
                    recovery_path = Path(folder) / "recovery.png"
                    recovered.save(recovery_path)
                    try:
                        recovery_raw = subprocess.run(
                            [
                                "nice",
                                "-n",
                                "10",
                                "tesseract",
                                str(recovery_path.resolve()),
                                "stdout",
                                "-l",
                                "eng",
                                "--psm",
                                "11",
                                "tsv",
                            ],
                            capture_output=True,
                            check=True,
                            timeout=max(0.1, min(8, deadline - time.monotonic())),
                            env={**os.environ, "OMP_THREAD_LIMIT": "1"},
                        ).stdout.decode("utf-8", errors="replace")
                        recovery_lines = parse_tsv(recovery_raw)
                        recovery_copy = reading_copy(
                            {
                                "text": "\n".join(
                                    line["text"] for line in recovery_lines
                                ),
                                "reading_lines": recovery_lines,
                            }
                        )
                        if len(recovery_copy["display_text"]) > len(
                            initial_copy["display_text"]
                        ):
                            lines, rotated, skew = (
                                recovery_lines,
                                recovered,
                                recovered_skew,
                            )
                    except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
                        pass  # Retain the usable initial read if recovery cannot finish.
                quotes = disclosures(lines, *rotated.size)
                # Sparse OCR interleaves neighboring columns. Re-read only the
                # disclosure's own column so wrapped payer names stay in order.
                for line in lines:
                    if not PAYER.search(line["text"]) and re.search(
                        r"\bpaid\b|\bprepared\b|\bexpenditure\b|\b(?:for|or|r)\s+by\b",
                        line["text"],
                        re.I,
                    ):
                        quotes.append(
                            {
                                "quote": line["text"],
                                "payer_text": None,
                                "quality": "machine_read",
                                "edge_warning": False,
                                "box": line["box"],
                                "confidence": line["confidence"],
                            }
                        )
                partial_reasons = []
                refined_quotes = []
                for quote in quotes[:3]:
                    try:
                        refined_quotes.append(
                            refine_disclosure(rotated, quote, folder, deadline)
                        )
                    except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
                        refined_quotes.append(quote)
                        partial_reasons.append("disclosure_reading_stopped")
                quotes = refined_quotes
                if any(quote.get("refinement_incomplete") for quote in quotes):
                    partial_reasons.append("disclosure_reading_stopped")
                quotes = [quote for quote in quotes if quote["payer_text"]]
                readable = [line for line in lines if line["confidence"] >= 60]
                score = sum(len(line["text"]) for line in readable) + 1000 * len(quotes)
                result = {
                    "status": (
                        "partial"
                        if partial_reasons or any(q["edge_warning"] for q in quotes)
                        else "read"
                    )
                    if readable
                    else "unreadable",
                    "partial_reasons": partial_reasons
                    + (
                        ["disclosure_cut_off"]
                        if any(q["edge_warning"] for q in quotes)
                        else []
                    ),
                    "text": "\n".join(line["text"] for line in lines)[:60000],
                    "disclosures": quotes,
                    "rotation": angle,
                    "deskew_angle": skew,
                    "reading_lines": lines,
                    "image_fingerprint": image_fingerprint(oriented),
                    "width": rotated.width,
                    "height": rotated.height,
                    "complete": False,
                }
                result = reading_copy(result)
                useful_lines = result["display_text"].splitlines()
                score = sum(len(line) for line in useful_lines) + 1000 * len(quotes)
                if not useful_lines:
                    result["status"] = "unreadable"
                if best is None or score > best[0]:
                    best = (score, result)
                # A useful upright read needs no speculative rotations. Completeness
                # is still unknown, even when every recognized word is confident.
                if time.monotonic() >= deadline or (
                    quotes and readable and all(q["confidence"] >= 70 for q in quotes)
                ):
                    break
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
            if best is None:
                raise
            best[1]["status"] = "partial"
            best[1]["partial_reasons"] = ["reading_stopped"]
    return best[1]
