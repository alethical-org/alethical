"""Decoding a fetched page the way the source actually encoded it.

Every pipeline module that scrapes a Minnesota Legislature page has its own
retry-and-fetch helper, and each one ended with ``return response.text``. That
single line is where accented characters were lost, so the decode lives here and
all four call it — a fifth fetcher added later inherits the fix instead of the bug.
"""

from __future__ import annotations

import requests


def response_text(response: requests.Response) -> str:
    """The response body as text, decoded by what the source really is.

    ``requests`` reads the charset off the Content-Type header, and when a
    ``text/*`` response names none it falls back to ISO-8859-1 (RFC 2616 §3.7.1).
    Three of the pages we read send exactly that while their bytes are UTF-8:

    * the Revisor's bill-status API (``text/xml`` — its XML even declares
      ``encoding="UTF-8"``, in a declaration that is discarded the moment the body
      becomes a decoded string),
    * the Senate's members pages (``text/html``),
    * the Senate's journal index, which the roll-call backfill walks
      (``text/html``).

    Under that fallback each UTF-8 byte became its own Latin-1 character, so Rep.
    María Isa Pérez-Vega's name entered the pipeline as "PÃ©rez-Vega" and reached
    42 bills' author rows that way (#849).

    So: when the server names a charset, believe it — it is the only party that
    knows. When it names none, try UTF-8 first, and keep the RFC fallback as the
    net for a source that really is Latin-1.
    """
    if "charset=" in response.headers.get("Content-Type", "").lower():
        return response.text
    try:
        return response.content.decode("utf-8")
    except UnicodeDecodeError:
        return response.text
