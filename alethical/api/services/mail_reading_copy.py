"""Conservative reading view over retained private extraction.

No dictionary, language model or confidence threshold can establish that a name
is wrong. Keep wordlike output verbatim. Only isolated scanner noise and characters
that cannot render as text are replaced, with an explicit gap at that location.
"""

from __future__ import annotations

import re

UNRENDERABLE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f\ufffd]+")
# Preserve standalone mathematical/currency marks and all alphanumeric content.
# These isolated stroke clusters are page decoration or extraction noise, not words.
ARTIFACT_LINE = re.compile(r"[\s|\\_~^¦—–-]+")
GAP = "[Unreadable]"


def reading_copy(side: dict) -> dict:
    """Return additive presentation fields; never mutate source or payer quotes.

    Works on existing saved results without rereading photos or changing their
    private evidence. A box close to an edge does not prove text was cropped, so
    all notices stay cause-neutral until a cause has independent evidence.
    """
    raw = side.get("text") or ""
    lines = []
    gaps = False
    for source_line in raw.replace("\r\n", "\n").split("\n"):
        stripped = source_line.strip()
        artifact = bool(
            stripped
            and ARTIFACT_LINE.fullmatch(stripped)
            and stripped not in {"-", "—", "–"}
        )
        line = GAP if artifact else UNRENDERABLE.sub(GAP, source_line)
        gaps = gaps or line != source_line
        if line == GAP and lines and lines[-1] == GAP:
            continue
        lines.append(line)
    display = "\n".join(lines)
    useful = any(character.isalnum() for character in display.replace(GAP, ""))
    if side.get("status") == "unreadable" or not useful:
        notice = "We couldn’t read this photo"
    elif side.get("status") == "partial" or gaps:
        notice = "Some text could not be read"
    else:
        notice = None
    return {**side, "display_text": display, "reading_notice": notice}
