"""Narrow native-text reader for the retained FEC Form2 printed layout.

This reads original PDF bytes through Poppler. It does no OCR, name matching,
committee-ID inference or identity approval. Page1 fields are bound to the
printed image number and inspected label/field positions. Other layouts fail
closed, and later pages are not claimed to be read by a page1 extraction.
"""

from copy import deepcopy
from datetime import date
from functools import lru_cache
import hashlib
import json
import math
import os
import re
import selectors
import signal
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from xml.etree import ElementTree

ADAPTER_ID = "fec_form2_pdf:v1"
_CANDIDATE = re.compile(r"[HSP][0-9][A-Z]{2}[0-9A-Z]{5}")
# Bounds are PDF points, top-down, for the inspected 612x792 Form2 layout.
_FIELDS = {
    "candidate_name": (65, 121, 555, 134),
    "source_candidate_id": (380, 144, 555, 156),
    "office": (180, 190, 315, 202),
    "state": (320, 190, 375, 202),
    "district": (375, 190, 425, 202),
    "election_year": (420, 230, 451, 242),
    "principal_account_name": (60, 280, 555, 300),
}
# Optional dated evidence does not change older identity facts or quotation bytes.
_SIGNED_DATE_BOUNDS = (379, 603, 452, 617)
_ANCHORS = (
    ((44, 49, 151, 68), "FEC FORM 2"),
    ((44, 74, 222, 89), "STATEMENT OF CANDIDACY"),
    ((47, 111, 165, 121), "1. (a) Name of Candidate (in full)"),
    ((165, 211, 443, 225), "DESIGNATION OF PRINCIPAL CAMPAIGN COMMITTEE"),
    ((59, 268, 168, 279), "(a) Name of Committee (in full)"),
)


class FecPaperIdentityError(ValueError):
    """A paper original cannot prove the requested narrowly defined facts."""


def _source_image(body: bytes, source: dict):
    if (
        not isinstance(body, bytes)
        or not body.startswith(b"%PDF-")
        or len(body) > 8 * 1024 * 1024
    ):
        raise FecPaperIdentityError("Form2 needs bounded original PDF bytes")
    url = source.get("url")
    if not isinstance(url, str):
        raise FecPaperIdentityError("Form2 has no retained official URL")
    parsed = urlsplit(url)
    try:
        valid_port = parsed.port in {None, 443}
    except ValueError as exc:
        raise FecPaperIdentityError("Form2 has an invalid publisher port") from exc
    match = re.fullmatch(r"/pdf/([0-9]{3})/([0-9]{18})/([0-9]{18})\.pdf", parsed.path)
    if (
        source.get("authority") != "fec"
        or parsed.scheme != "https"
        or parsed.hostname != "docquery.fec.gov"
        or not valid_port
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or any(ord(char) < 32 for char in url)
        or match is None
        or match[2] != match[3]
        or match[1] != match[2][-3:]
        or source.get("sha256") != hashlib.sha256(body).hexdigest()
    ):
        raise FecPaperIdentityError("Form2 is not its exact retained official original")
    return match[2]


# Limits apply only inside a fresh isolated launcher, before exec of Poppler.
# No preexec_fn or parent/global resource limits are used. Darwin does not
# implement a reliable RLIMIT_AS; hard memory enforcement is a Linux runtime
# guarantee, while streaming, CPU and wall-clock limits apply on both platforms.
_RESOURCE_EXEC = """
import os, resource, sys
try:
    cpu = int(sys.argv[1])
    memory = int(sys.argv[2])
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu + 1))
    if sys.platform == 'linux':
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
    elif sys.platform != 'darwin':
        raise RuntimeError('unsupported resource-limit platform')
except BaseException:
    os._exit(125)
try:
    os.execvp(sys.argv[3], sys.argv[3:])
except OSError:
    os._exit(126)
"""


def _stop_reader(process):
    # Kill the whole owned group even if the direct child exited, because a
    # descendant could still hold a pipe open. Reap only this direct child.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def _run_native_reader(
    body: bytes,
    *,
    command=None,
    max_stdout=2 * 1024 * 1024,
    max_stderr=64 * 1024,
    timeout=15,
    cpu_seconds=10,
    memory_bytes=256 * 1024 * 1024,
):
    """Stream bounded native output; abort/reap on every failure boundary.

    Internal command/limit arguments serve deterministic process tests. Source
    metadata and locators cannot supply or modify a command or limit.
    """
    if os.name != "posix":
        raise FecPaperIdentityError("Native PDF resource limits are unavailable")
    if command is None:
        command = ["pdftotext", "-f", "1", "-l", "1", "-bbox-layout", "-", "-"]
    process = None
    deadline = time.monotonic() + timeout
    # A bounded anonymous input file avoids the stdin-write/stdout-read pipe
    # deadlock. It is never a caller-selected path and closes on every outcome.
    with tempfile.TemporaryFile() as source, selectors.DefaultSelector() as selector:
        source.write(body)
        source.seek(0)
        try:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-c",
                    _RESOURCE_EXEC,
                    str(cpu_seconds),
                    str(memory_bytes),
                    *command,
                ],
                stdin=source,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
                start_new_session=True,
            )
            assert process.stdout is not None and process.stderr is not None
            selector.register(process.stdout, selectors.EVENT_READ, "stdout")
            selector.register(process.stderr, selectors.EVENT_READ, "stderr")
            output = bytearray()
            stderr_count = 0
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise FecPaperIdentityError("Form2 native PDF reader time limit")
                events = selector.select(remaining)
                if not events:
                    raise FecPaperIdentityError("Form2 native PDF reader time limit")
                for key, _ in events:
                    limit_left = (
                        max_stdout - len(output)
                        if key.data == "stdout"
                        else max_stderr - stderr_count
                    )
                    block = os.read(key.fd, min(65536, limit_left + 1))
                    if not block:
                        selector.unregister(key.fileobj)
                        continue
                    if len(block) > limit_left:
                        label = "output" if key.data == "stdout" else "stderr"
                        raise FecPaperIdentityError(f"Form2 native PDF {label} limit")
                    if key.data == "stdout":
                        output.extend(block)
                    else:
                        # stderr is counted and discarded, never accumulated.
                        stderr_count += len(block)
            try:
                process.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired as exc:
                raise FecPaperIdentityError(
                    "Form2 native PDF reader time limit"
                ) from exc
            if process.returncode:
                raise FecPaperIdentityError(
                    "Form2 native PDF reader failed or reached a resource limit"
                )
            return bytes(output)
        except OSError as exc:
            raise FecPaperIdentityError("Form2 native PDF reader unavailable") from exc
        finally:
            if process is not None:
                _stop_reader(process)
                if process.stdout is not None:
                    process.stdout.close()
                if process.stderr is not None:
                    process.stderr.close()


@lru_cache(maxsize=2)
def _native_words(body: bytes):
    try:
        root = ElementTree.fromstring(_run_native_reader(body))
    except ElementTree.ParseError as exc:
        raise FecPaperIdentityError(
            "Form2 native PDF reader could not read page1"
        ) from exc
    pages = [node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "page"]
    if (
        len(pages) != 1
        or pages[0].get("width") != "612.000000"
        or pages[0].get("height") != "792.000000"
    ):
        raise FecPaperIdentityError("Unsupported Form2 page dimensions or layout")
    words = []
    try:
        for node in pages[0].iter():
            if node.tag.rsplit("}", 1)[-1] != "word":
                continue
            box = tuple(
                float(node.attrib[key]) for key in ("xMin", "yMin", "xMax", "yMax")
            )
            if (
                not all(math.isfinite(value) for value in box)
                or box[0] > box[2]
                or box[1] > box[3]
            ):
                raise ValueError
            words.append((box, node.text or ""))
    except (ValueError, KeyError) as exc:
        raise FecPaperIdentityError("Invalid Form2 native text positions") from exc
    return tuple(words)


def _select(words, bounds):
    x0, y0, x1, y1 = bounds
    for box, _ in words:
        intersects = box[0] < x1 and x0 < box[2] and box[1] < y1 and y0 < box[3]
        contained = x0 <= box[0] and y0 <= box[1] and box[2] <= x1 and box[3] <= y1
        if intersects and not contained:
            raise FecPaperIdentityError("Form2 text crosses a supported field boundary")
    selected = tuple(
        (box, text)
        for box, text in words
        if x0 <= box[0] and y0 <= box[1] and box[2] <= x1 and box[3] <= y1
    )
    # Native word order is retained; no fuzzy/case/punctuation name normalization.
    text = " ".join(word for _, word in selected)
    if not text or any(ord(char) < 32 for char in text):
        raise FecPaperIdentityError("Required Form2 field or label is absent")
    return text, selected


def extract_fec_paper_identity(body: bytes, source: dict, locator: dict):
    """Return page1 identity facts with exact selected native words/positions.

    candidate_designation returns no account_id: page1 prints a committee name,
    not an issued committee ID. Separate exact F1/bulk candidate-ID evidence and
    reviewed joins are required to prove a formal account link. `field` returns
    one fact with the exact candidate ID, never an unbound name search. Local
    storage paths cannot replace original bytes/hash/official URL validation.
    """
    from alethical.pipeline.election_external_finance import CheckedExtraction

    image = _source_image(body, source)
    kind = locator.get("kind")
    wanted = {"kind", "page", "field"} if kind == "field" else {"kind", "page"}
    if (
        set(locator) != wanted
        or kind not in {"candidate_designation", "field"}
        or type(locator.get("page")) is not int
        or locator["page"] != 1
        or (kind == "field" and locator.get("field") not in {*_FIELDS, "signed_date"})
    ):
        raise FecPaperIdentityError("Unsupported Form2 page or field locator")
    words = _native_words(body)
    for bounds, expected in _ANCHORS:
        if _select(words, bounds)[0] != expected:
            raise FecPaperIdentityError("Unsupported Form2 printed labels/layout")
    if _select(words, (46, 33, 165, 44))[0] != f"Image# {image}":
        raise FecPaperIdentityError("Form2 printed image does not match its source URL")
    selected_bounds = dict(_FIELDS)
    if kind == "field" and locator.get("field") == "signed_date":
        # Poppler exposes the original form label either as one word or separate
        # glyphs. Both exact encodings occupy the inspected date-label box.
        if _select(words, (374, 589, 395, 600))[0] not in {"Date", "D a t e"}:
            raise FecPaperIdentityError("Unsupported Form2 signature-date label")
        selected_bounds["signed_date"] = _SIGNED_DATE_BOUNDS
    evidence = {
        field: _select(words, bounds) for field, bounds in selected_bounds.items()
    }
    values = {field: value[0] for field, value in evidence.items()}
    if (
        _CANDIDATE.fullmatch(values["source_candidate_id"]) is None
        or values["office"] not in {"House", "Senate", "President"}
        or re.fullmatch(r"[A-Z]{2}", values["state"]) is None
        or re.fullmatch(r"[0-9]{2}", values["district"]) is None
        or re.fullmatch(r"[12][0-9]{3}", values["election_year"]) is None
        or len(values["candidate_name"]) > 200
        or len(values["principal_account_name"]) > 200
    ):
        raise FecPaperIdentityError(
            "Form2 has incomplete or ambiguous printed identity"
        )
    facts = {"authority": "fec", **values}
    facts["office_label"] = values["office"]
    facts["office"] = {"House": "H", "Senate": "S", "President": "P"}[values["office"]]
    facts["election_year"] = int(values["election_year"])
    if "signed_date" in values:
        match = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", values["signed_date"])
        if not match:
            raise FecPaperIdentityError("Ambiguous Form2 signature date")
        try:
            facts["signed_date"] = date(
                int(match[3]), int(match[1]), int(match[2])
            ).isoformat()
        except ValueError as exc:
            raise FecPaperIdentityError("Invalid Form2 signature date") from exc
    selected_fields = tuple(_FIELDS)
    if kind == "field":
        field = locator["field"]
        selected_fields = tuple(dict.fromkeys(("source_candidate_id", field)))
        facts = {"authority": "fec", **{key: facts[key] for key in selected_fields}}
    quote = json.dumps(
        {
            "format": "fec-selected-pdf-fields-v1",
            "page": 1,
            "image_number": image,
            "fields": [
                {
                    "field": field,
                    "bounds": selected_bounds[field],
                    "text": evidence[field][0],
                    "words": [
                        {"text": text, "bbox": box} for box, text in evidence[field][1]
                    ],
                }
                for field in selected_fields
            ],
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return CheckedExtraction(facts=deepcopy(facts), quote=quote)
