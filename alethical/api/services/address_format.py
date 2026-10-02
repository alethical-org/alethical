"""Harmless browser-address formatting shared by exact address readers."""

from __future__ import annotations

import re

from alethical.api.services.zip_state_reference import SUPPORTED_STATES

_STATE = "|".join(sorted(SUPPORTED_STATES | {"MINNESOTA"}))
_COUNTRY = r"(?:UNITED STATES(?: OF AMERICA)?|U\.?S\.?(?:A\.?)?)"
_COUNTRY_SEPARATOR = r"[ ,;:.\-–—]"
_COMPLETE_US_ADDRESS = re.compile(
    rf"(?P<address>[0-9]+[A-Z]?\s+.+\b(?:{_STATE})\s+[0-9]{{5}}(?:-[0-9]{{4}})?)"
    rf"(?:(?:{_COUNTRY_SEPARATOR}+{_COUNTRY}|"
    rf"{_COUNTRY_SEPARATOR}*\( *{_COUNTRY} *\)){_COUNTRY_SEPARATOR}*|[ ,;:.]*)",
    re.IGNORECASE,
)


def normalize_address_format(value: str) -> str:
    """Remove only a terminal US country label after a street, state and ZIP.

    Accept common separators and balanced parentheses around the country, not
    arbitrary non-word characters that could include controls or unit markers.
    Preserve all address words, units, directions and foreign country labels.
    Control characters other than native multiline autofill whitespace remain
    visible to request validation instead of silently disappearing.
    """
    # Include normal Unicode spaces, but leave other control characters intact.
    compact = re.sub(r"(?:[^\S\x00-\x1f\x7f]|[\t\r\n])+", " ", value).strip(" ")
    match = _COMPLETE_US_ADDRESS.fullmatch(compact)
    return match.group("address") if match else compact
