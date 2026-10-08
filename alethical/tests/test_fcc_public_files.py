"""FCC source shape, record identities, and bounded public downloads."""

from __future__ import annotations

import httpx
import pytest

from alethical.pipeline.fcc_public_files import (
    DEFAULT_STATIONS,
    FCCClient,
    FCCFetchError,
    FCCSourceError,
    FileListing,
    parse_folder,
)

ROOT = DEFAULT_STATIONS[0].root_url
FOLDER = "edfbd9ba-add1-882c-33aa-757e21e21cfa"
RECORD = "dda86bdb-8de5-b7a3-ce54-ea09dfa03d4f"
BINARY = "6fdc7759-1ab7-4716-a21b-0142c94b5fdc"
SOURCE = f"https://publicfiles.fcc.gov/api/manager/download/{FOLDER}/{BINARY}.pdf"
PUBLIC_PDF = f"https://files.fcc.gov/download/{BINARY}.pdf"
PATH = "political-files/2026/state/lisa-demuth-for-governor-committee"
URL = f"{ROOT}/2026/state/lisa-demuth-for-governor-committee/{FOLDER}"
PDF = b"%PDF-1.3\nexample public document"

# Actual FCC table/row shape from 2026-10-08, stripped of navigation and style.
FILE_ROW = f'''<tr>
<td class="file public" id="file{RECORD}"><img alt="PDF icon" src="/img/file-ico-pdf.png"> &nbsp;
<a target="_blank" href="{SOURCE}" class="nav2file">K5-Lisa Demuth for Governor Committee-INVOICE-510114-1<span class="sr-only"> (Opens in new browser window)</span></a></td>
<td>154.93 KB</td><td>07/28/2026 12:31 PM</td></tr>'''
FOLDER_ROW = """<tr><td class="folder public" id="folder23311e58-9b7a-cc83-83e3-279794e43bc8"><span class="icon"></span>
<a class="nav2folder" href="/tv-profile/kstp-tv/political-files/2017/23311e58-9b7a-cc83-83e3-279794e43bc8" data-id="23311e58-9b7a-cc83-83e3-279794e43bc8" data-path="political-files/2017" data-type="">2017</a></td><td>0</td><td>--</td></tr>"""


def table(rows: str = "") -> bytes:
    return (
        """<table class="table-fileView table file-view" id="fileBrowsingTable">
<thead><tr><th>Name</th><th>Size</th><th>Date Uploaded</th></tr></thead>
<tbody>"""
        + rows
        + "</tbody></table>"
    ).encode()


def listing(url: str = SOURCE) -> FileListing:
    return FileListing(RECORD, FOLDER, PATH, "Invoice", url)


def client(handler, **kwargs) -> FCCClient:
    return FCCClient(transport=httpx.MockTransport(handler), attempts=1, **kwargs)


def test_real_source_keeps_record_id_separate_from_binary_id():
    result = parse_folder(table(FILE_ROW), URL, PATH)
    file = result.files[0]
    assert file.file_id == RECORD
    assert BINARY in file.url
    assert file.folder_id == FOLDER
    assert file.name == "K5-Lisa Demuth for Governor Committee-INVOICE-510114-1"
    assert file.size_label == "154.93 KB"
    assert file.size_bytes is None  # Rounded source size is not exact bytes.
    assert file.uploaded_at == "07/28/2026 12:31 PM"
    assert result.expected_count is None


def test_empty_known_table_is_empty_without_dropping_zero_count_children():
    empty = parse_folder(table(), ROOT, "political-files")
    assert empty.files == [] and empty.children == []
    root = parse_folder(table(FOLDER_ROW), ROOT, "political-files")
    assert root.children == [
        (f"{ROOT}/2017/23311e58-9b7a-cc83-83e3-279794e43bc8", "political-files/2017")
    ]
    assert root.expected_count is None  # A recursive child count is not a total.


def test_same_name_different_record_and_duplicate_rows_survive():
    other = FILE_ROW.replace(RECORD, "c98e54c0-5b0d-5270-01b7-195be4428056")
    result = parse_folder(table(FILE_ROW + other + FILE_ROW), URL, PATH)
    assert len(result.files) == 3
    assert len({file.file_id for file in result.files}) == 2
    assert len({file.url for file in result.files}) == 1


def test_non_pdf_and_exact_literal_byte_size_survive():
    row = FILE_ROW.replace(".pdf", ".docx").replace("154.93 KB", "1,500 bytes")
    file = parse_folder(table(row), URL, PATH).files[0]
    assert file.url.endswith(".docx") and file.size_bytes == 1500


@pytest.mark.parametrize(
    "body",
    [
        b"<html>Access denied</html>",
        b"<html>No files</html>",
        table().replace(b"Date Uploaded", b"Changed heading"),
        table().replace(b"</table>", b""),
        table() + table(),
        table().replace(b"<tbody>", b"").replace(b"</tbody>", b""),
        table("<tr><td>Unknown row</td></tr>"),
        table(FILE_ROW.replace('class="nav2file"', 'class="new-file-kind"')),
    ],
)
def test_errors_and_unknown_structure_are_not_empty(body):
    with pytest.raises(FCCSourceError):
        parse_folder(body, URL, PATH)


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example/file.pdf",
        "https://publicfiles.fcc.gov.evil.example/api/manager/download/x/x.pdf",
        "http://publicfiles.fcc.gov/tv-profile/kstp-tv/political-files",
        "https://publicfiles.fcc.gov:444/tv-profile/kstp-tv/political-files",
        "https://user@publicfiles.fcc.gov/tv-profile/kstp-tv/political-files",
        f"{ROOT}/%2e%2e/private",
        f"{ROOT}?redirect=evil",
    ],
)
def test_untrusted_folder_urls_make_no_request(url):
    seen = []
    http = client(lambda request: seen.append(request))
    try:
        with pytest.raises(FCCSourceError):
            http.read_folder(url, "political-files")
        assert seen == []
    finally:
        http.close()


def test_offsite_file_link_and_child_are_rejected():
    with pytest.raises(FCCSourceError):
        parse_folder(
            table(FILE_ROW.replace(SOURCE, "https://evil.example/private.pdf")),
            URL,
            PATH,
        )
    with pytest.raises(FCCSourceError):
        parse_folder(
            table(FOLDER_ROW.replace("/tv-profile/kstp-tv/", "/tv-profile/kare/")),
            ROOT,
            "political-files",
        )


def test_changed_folder_path_cannot_leave_parent():
    with pytest.raises(FCCSourceError):
        parse_folder(table(FOLDER_ROW), URL, PATH)


def test_offsite_redirect_is_rejected_before_request():
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(302, headers={"Location": "https://evil.example/private"})

    http = client(handler)
    try:
        with pytest.raises(FCCSourceError):
            http.download(listing())
        assert seen == [SOURCE]
    finally:
        http.close()


def test_public_redirect_and_fallback_expose_effective_download_url():
    for first_status in (302, 403):
        seen = []

        def handler(request):
            seen.append(str(request.url))
            if str(request.url) == SOURCE:
                return httpx.Response(first_status, headers={"Location": PUBLIC_PDF})
            return httpx.Response(200, content=PDF)

        http = client(handler)
        try:
            assert http.download(listing()) == PDF
            assert http.last_download_url == PUBLIC_PDF
            assert seen == [SOURCE, PUBLIC_PDF]
        finally:
            http.close()


def test_timeout_can_use_observed_official_distribution_route():
    def handler(request):
        if str(request.url) == SOURCE:
            raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(200, content=PDF)

    http = client(handler)
    try:
        assert http.download(listing()) == PDF
        assert http.last_download_url == PUBLIC_PDF
    finally:
        http.close()


def test_failed_fallback_reports_both_origins_without_inventing_success():
    http = client(lambda request: httpx.Response(403))
    try:
        with pytest.raises(
            FCCFetchError, match="official PDF distribution failed"
        ) as failure:
            http.download(listing())
        assert SOURCE in str(failure.value) and PUBLIC_PDF in str(failure.value)
        assert http.last_download_url is None
    finally:
        http.close()


@pytest.mark.parametrize(
    "body", [b"", b"<html>Denied</html>", b"Error", b"%PDF broken"]
)
def test_bad_document_body_is_never_a_saved_pdf(body):
    http = client(lambda request: httpx.Response(200, content=body))
    try:
        with pytest.raises(FCCFetchError):
            http.download(listing())
    finally:
        http.close()


def test_oversized_listing_stops_and_does_not_become_empty():
    http = client(
        lambda request: httpx.Response(200, content=table()), max_listing_bytes=10
    )
    try:
        with pytest.raises(FCCFetchError, match="exceeds 10 bytes"):
            http.read_folder(ROOT, "political-files")
    finally:
        http.close()


def test_non_pdf_failure_has_no_guessed_distribution_fallback():
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(403)

    http = client(handler)
    try:
        with pytest.raises(FCCFetchError):
            http.download(listing(SOURCE.replace(".pdf", ".docx")))
        assert len(seen) == 1
    finally:
        http.close()


def test_retry_only_retries_transient_refusal(monkeypatch):
    monkeypatch.setattr(
        "alethical.pipeline.fcc_public_files.time.sleep", lambda _: None
    )
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(503 if len(seen) < 3 else 200, content=table())

    http = FCCClient(transport=httpx.MockTransport(handler), attempts=3)
    try:
        assert http.read_folder(ROOT, "political-files").files == []
        assert len(seen) == 3
    finally:
        http.close()


def test_rows_moved_outside_body_are_error_not_empty():
    malformed = table().replace(b"</tbody>", b"</tbody>" + FILE_ROW.encode())
    with pytest.raises(FCCSourceError):
        parse_folder(malformed, URL, PATH)


def test_oversized_pdf_has_no_fallback_request():
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(200, content=PDF)

    http = client(handler, max_file_bytes=8)
    try:
        with pytest.raises(FCCFetchError, match="exceeds 8 bytes"):
            http.download(listing())
        assert seen == [SOURCE]
    finally:
        http.close()
