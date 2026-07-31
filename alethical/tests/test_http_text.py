"""The shared decode for every page the pipeline scrapes (#849).

Regression: the Revisor's bill-status API answers ``Content-Type: text/xml`` with
no charset while its bytes are UTF-8, so ``requests``' RFC 2616 fallback to
ISO-8859-1 split each UTF-8 byte into its own Latin-1 character. Rep. María Isa
Pérez-Vega's name reached 42 bills' author rows as "PÃ©rez-Vega". The header shapes
below are the real ones, captured from each host.
"""

from __future__ import annotations

from alethical.pipeline.http_text import response_text


class FakeResponse:
    """A response that decodes exactly as ``requests`` would.

    ``requests`` sets ``.encoding`` from the header's charset and falls back to
    ISO-8859-1 for ``text/*`` without one; ``.text`` then decodes with that. The
    fallback is the whole bug, so it is reproduced rather than stubbed away.
    """

    def __init__(self, body: bytes, content_type: str) -> None:
        self.content = body
        self.headers = {"Content-Type": content_type}
        self.encoding = (
            content_type.lower().split("charset=")[-1]
            if "charset=" in content_type.lower()
            else "ISO-8859-1"
        )

    @property
    def text(self) -> str:
        return self.content.decode(self.encoding, errors="replace")


NAME = "Pérez-Vega"
BILL_STATUS_XML = (
    f'<?xml version="1.0" encoding="UTF-8"?><BILL><AUTHORS><house><AUTHOR>'
    f"<MEMBER_NAME>{NAME}</MEMBER_NAME></AUTHOR></house></AUTHORS></BILL>"
).encode()


def test_utf8_survives_a_source_that_names_no_charset() -> None:
    # The exact header the Revisor's bill-status API sends. Before the fix this
    # returned "PÃ©rez-Vega" and that string was written to the database.
    assert NAME in response_text(FakeResponse(BILL_STATUS_XML, "text/xml"))
    assert "Ã" not in response_text(FakeResponse(BILL_STATUS_XML, "text/xml"))


def test_every_charsetless_host_we_read_is_covered() -> None:
    # Captured live: the Senate's members pages and its journal index send the
    # same bare header, and the roll-call backfill and committee scraper walk them.
    for content_type in ("text/xml", "text/html", "TEXT/HTML"):
        got = response_text(FakeResponse(BILL_STATUS_XML, content_type))
        assert NAME in got, content_type


def test_a_server_that_names_its_charset_is_believed() -> None:
    # The Revisor's bill-text pages, house.mn.gov and lrl.mn.gov all say utf-8.
    # Only the server knows, so a stated charset is never second-guessed.
    for content_type in ("text/xml; charset=utf-8", "text/html; charset=UTF-8"):
        assert NAME in response_text(FakeResponse(BILL_STATUS_XML, content_type))


def test_genuinely_latin1_bytes_still_decode() -> None:
    # The RFC fallback stays as the net: a source that really is Latin-1 must not
    # raise, and must not come back as replacement characters.
    latin1 = "Perez-Vega café".encode("iso-8859-1")
    got = response_text(FakeResponse(latin1, "text/html"))
    assert got == "Perez-Vega café"


def test_a_response_with_no_content_type_at_all_is_read_as_utf8() -> None:
    class Bare(FakeResponse):
        def __init__(self, body: bytes) -> None:
            super().__init__(body, "")
            self.headers = {}

    assert NAME in response_text(Bare(BILL_STATUS_XML))
