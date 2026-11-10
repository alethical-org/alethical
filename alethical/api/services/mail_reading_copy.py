"""Readable presentation over unchanged private extraction evidence.

Discard incoherent scanner fragments, not unfamiliar names or imperfect grammar.
When a word inside a sentence is uncertain, omit the span rather than splice a
new claim together. Raw text and disclosure quotations remain available privately.
"""

from __future__ import annotations

import re

UNRENDERABLE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f\ufffd]+")
WORD = re.compile(r"[^\W_]+(?:[’'/-][^\W_]+)*", re.UNICODE)
NUMBER = re.compile(r"^[\s$€£¥¢+−-]*\d[\d,.%\s/+-]*$")
URL = re.compile(r"(?:https?://|www\.)\S+", re.I)
LIST_MARKER = re.compile(r"^\s*([Y¥✓✔√])\s+([A-Z][^\n]+)$")
NOTICE = "Some text couldn’t be read"
# Historical rows have no boxes. Restrict their repeated checkmark repair to
# action-list phrasing, never a person's initial or an arbitrary capital word.
LIST_ACTION = re.compile(
    r"^(?:Cut|Lower|Support|Protect|Reduce|Increase|Improve|Stop|Keep|End|Expand|Fund|Build)\b"
)


def _visual_markers(lines):
    candidates = []
    for index, line in enumerate(lines):
        words = line.get("words") or []
        if len(words) < 2:
            continue
        first, second = words[:2]
        box = first.get("box")
        next_box = second.get("box")
        if (
            not box
            or not next_box
            or first.get("confidence", 100) >= 60
            or not re.fullmatch(r"[AaYyVvJj¥✓✔√]{1,2}", first.get("text", ""))
            or box[2] > next_box[0]
        ):
            continue
        candidates.append((index, box))
    return {
        index
        for index, box in candidates
        if any(
            other != index
            and abs(box[0] - other_box[0]) <= max(8, (box[3] - box[1]) / 2)
            and abs((box[2] - box[0]) - (other_box[2] - other_box[0]))
            <= max(20, (box[2] - box[0]) * 0.6)
            for other, other_box in candidates
        )
    }


def _words(text):
    return WORD.findall(text)


def _phrase(text):
    words = [word for word in _words(text) if len(word) >= 2]
    return len(words) >= 2 and sum(map(len, words)) >= 4


def _standalone(text):
    return bool(NUMBER.fullmatch(text) or URL.fullmatch(text))


def _connected(first, second):
    """Only adjoining text in the same column can form a wrapped sentence."""
    a, b = first.get("box"), second.get("box")
    if not a or not b:
        return True
    overlap = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    width = max(1, min(a[2] - a[0], b[2] - b[0]))
    height = max(1, a[3] - a[1], b[3] - b[1])
    distance = max(0, b[1] - a[3], a[1] - b[3])
    return overlap / width >= 0.6 and distance <= height * 1.5


def reading_copy(side: dict) -> dict:
    """Add readable text and one incompleteness flag without changing evidence.

    New reads supply token confidence. Historical rows get conservative fragment
    cleanup without pretending confidence or missing words can be reconstructed.
    """
    raw = side.get("text") or ""
    evidence = side.get("reading_lines")
    lines = (
        evidence
        if isinstance(evidence, list)
        else [{"text": line} for line in raw.replace("\r\n", "\n").split("\n")]
    )
    has_phrase = any(_phrase(line.get("text", "")) for line in lines)
    # A repeated capital-letter mark in the same list is a common checkmark
    # reading. A solitary Y, a name beginning with Y and currency remain words.
    markers = [LIST_MARKER.match(line.get("text", "")) for line in lines]
    check_list = (
        sum(
            bool(match and _phrase(match[2]) and LIST_ACTION.match(match[2]))
            for match in markers
        )
        >= 2
    )
    visual_markers = _visual_markers(lines)
    blocked = set()
    for index, line in enumerate(lines):
        words = line.get("words") or []
        if index in visual_markers:
            words = words[1:]
        uncertain_word = any(
            word.get("confidence", 0) < 45
            and len(re.sub(r"[^\w]", "", word.get("text", ""))) >= 2
            for word in words
        )
        rejected_confidence = (
            bool(words)
            and line.get("confidence", 0) < 60
            and any(
                any(character.isalpha() for character in word.get("text", ""))
                for word in words
            )
        )
        if (
            not uncertain_word
            and not rejected_confidence
            and not UNRENDERABLE.search(line.get("text", ""))
        ):
            continue
        blocked.add(index)
        # OCR wraps sentences into separate lines. Do not remove a line such as
        # 'not' and accidentally join 'will' to 'raise taxes'. Omit its connected
        # sentence context too, stopping at explicit sentence/paragraph edges.
        before = index - 1
        while before >= 0:
            text = lines[before].get("text", "").strip()
            if (
                not text
                or re.search(r"[.!?][\"'’)]?$", text)
                or not _connected(lines[before], lines[before + 1])
            ):
                break
            blocked.add(before)
            before -= 1
        after = index + 1
        if re.search(r"[.!?][\"'’)]?$", line.get("text", "").strip()):
            after = len(lines)
        while after < len(lines):
            text = lines[after].get("text", "").strip()
            if not text or not _connected(lines[after - 1], lines[after]):
                break
            blocked.add(after)
            if re.search(r"[.!?][\"'’)]?$", text):
                break
            after += 1
    kept = []
    omitted = False
    for index, (line, marker) in enumerate(zip(lines, markers, strict=True)):
        text = line.get("text", "").strip()
        if re.fullmatch(r"-+[A-Za-z]+-+", text):
            text = text.strip("-")
        if not text:
            continue
        words = list(line.get("words") or [])
        if index in visual_markers:
            text = text.removeprefix(words[0]["text"]).lstrip()
            words = words[1:]
        elif (
            marker
            and check_list
            and _phrase(marker[2])
            and LIST_ACTION.match(marker[2])
        ):
            text = marker[2]
            if words and words[0].get("text") == marker[1]:
                words = words[1:]
        tokens = _words(text)
        # Keep coherent source phrases, standalone numbers/sites, and single
        # words in a meaningful side. Never turn scanner-only sides into text.
        confident_text = (
            bool(words)
            and all(word.get("confidence", 0) >= 85 for word in words)
            and bool(tokens)
            and (len(tokens) > 1 or len(tokens[0]) >= 2 or tokens[0] in {"a", "A", "I"})
        )
        short_connected = (
            len(tokens) == 1
            and tokens[0] in {"a", "A", "I"}
            and any(
                other is not line
                and _phrase(other.get("text", ""))
                and other.get("confidence", 100) >= 60
                and _connected(line, other)
                for other in lines
            )
        )
        meaningful = (
            confident_text
            or _phrase(text)
            or (has_phrase and _standalone(text))
            or (
                (
                    has_phrase
                    or (
                        bool(words)
                        and all(word.get("confidence", 0) >= 85 for word in words)
                    )
                )
                and len(tokens) == 1
                and (
                    len(tokens[0]) >= 2
                    or (tokens[0] in {"a", "A", "I"} and short_connected)
                )
                and text.strip(" .,:;!?()\"'’") == tokens[0]
            )
        )
        if index in blocked or not meaningful or UNRENDERABLE.search(text):
            omitted = True
            continue
        # The weakest word matters: deleting a low-confidence 'not' could
        # reverse a sentence. Omit this entire line instead of closing the gap.
        uncertain = any(
            word.get("confidence", 0) < 45
            and any(character.isalnum() for character in word.get("text", ""))
            for word in words
        )
        if uncertain or (evidence is not None and line.get("confidence", 0) < 60):
            omitted = True
            continue
        kept.append(text)
    display = "\n".join(kept)
    incomplete = bool(
        omitted
        or not display
        or side.get("status") in {"partial", "unreadable"}
        or side.get("reading_incomplete")
    )
    return {
        **side,
        "display_text": display,
        "reading_incomplete": incomplete,
        "reading_notice": NOTICE if incomplete else None,
    }


def reading_disclosure(disclosure: dict) -> dict:
    """Normalize sentence-boundary punctuation for display, never quoted evidence.

    This is explicitly a presentation edit, not a claim of character-perfect OCR.
    No words, internal commas, decimal points, amounts or payer names change.
    """
    quote = disclosure.get("quote") or ""
    display = re.sub(
        r"((?:https?://|www\.)[^\s,]+),([ \t]+)(?=(?:It is|This is|This was|These are|They are)\b)",
        r"\1.\2",
        quote,
    )
    if len(_words(display)) >= 5:
        display = re.sub(r",(\s*)$", r".\1", display)
    if display == quote:
        return {**disclosure, "display_quote": quote}
    return {
        **disclosure,
        "display_quote": display,
        "display_quote_normalization": "sentence_boundary_punctuation_v1",
    }
