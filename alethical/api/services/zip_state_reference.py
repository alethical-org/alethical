"""A manually refreshed, versioned ZIP-to-state reference, never donor addresses."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import json
import logging
from pathlib import Path
import re

SUPPORTED_STATES = frozenset(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO "
    "MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()
)
logger = logging.getLogger(__name__)

REFERENCE_PATH = Path(__file__).parents[1] / "data" / "zip_states.json"
_ZIP = re.compile(r"[0-9]{5}(?:[0-9]{4}|-[0-9]{4})?\Z")


@dataclass(frozen=True)
class ZipStateReference:
    source_url: str
    as_of: str
    copied_at: str
    content_hash: str
    states: dict[str, str | None]

    def state_for(self, value: str | None) -> str | None:
        # A space is not a digit. Trimming must precede the length check, and
        # missing leading zeros are never invented. Accept full ZIP+4 forms only.
        if value is None or not _ZIP.fullmatch(value.strip()):
            return None
        return self.states.get(value.strip()[:5])

    def public_metadata(self) -> dict[str, str]:
        # The reference's public source is safe; its ZIP rows never leave here.
        return {
            "source_url": self.source_url,
            "as_of": self.as_of,
            "copied_at": self.copied_at,
            "content_hash": self.content_hash,
        }


@lru_cache(maxsize=1)
def load_zip_state_reference() -> ZipStateReference | None:
    try:
        value = json.loads(REFERENCE_PATH.read_text())
        reference = ZipStateReference(**value)
        if not all(
            isinstance(item, str) for item in reference.public_metadata().values()
        ):
            raise ValueError("Reference metadata must be text")
        if not isinstance(reference.states, dict) or any(
            not isinstance(zipcode, str)
            or not re.fullmatch(r"[0-9]{5}", zipcode)
            or (
                state is not None
                and (not isinstance(state, str) or state not in SUPPORTED_STATES)
            )
            for zipcode, state in reference.states.items()
        ):
            raise ValueError(
                "Reference rows must map full ZIPs to supported states or null"
            )
        return reference
    except FileNotFoundError:
        return None
    except (OSError, ValueError, TypeError):
        # This optional block must not take the committee's other figures down.
        # Do not log file contents, ZIPs, or exception text from a damaged file.
        logger.warning("ZIP reference is unreadable; donor states are unavailable")
        return None
