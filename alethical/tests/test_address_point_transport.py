"""Minnesota connection reuse must not retain reader location or source cookies."""

from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

import pytest
import requests

from alethical.api.services import representative_lookup as lookup


@pytest.fixture
def address_server():
    seen = []

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self):
            seen.append((self.path, dict(self.headers), self.client_address[1]))
            if self.path.startswith("/redirect"):
                self.send_response(302)
                self.send_header("Location", "/query")
                body = b""
            else:
                self.send_response(200)
                body = b'{"features": []}'
            self.send_header("Set-Cookie", "test_source_id=public-fixture; Path=/")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}", seen
    server.shutdown()
    server.server_close()
    thread.join()


def test_address_transport_is_reused_per_thread_and_isolated_between_threads():
    main = lookup._address_point_session()
    assert lookup._address_point_session() is main
    with ThreadPoolExecutor(max_workers=1) as executor:
        other, repeated = executor.submit(
            lambda: (lookup._address_point_session(), lookup._address_point_session())
        ).result()
    assert other is repeated
    assert other is not main
    other.close()


def test_address_transport_reuses_connection_without_cookies_auth_or_query_cache(
    address_server, monkeypatch
):
    base_url, seen = address_server
    monkeypatch.setattr(
        requests.sessions,
        "get_netrc_auth",
        lambda *args: pytest.fail(
            "Public address transport must not load saved credentials"
        ),
    )
    session = lookup._address_point_session()
    try:
        for path in ("/redirect", "/query", "/query"):
            result = lookup._get_json(
                url=base_url + path,
                params={"where": "anumber = 350"},
                timeout=1,
                get=session.get,
            )
            assert result == {"features": []}
            assert len(session.cookies) == 0
        assert len(seen) == 4
        assert len({port for _, _, port in seen}) == 1
        assert all("Cookie" not in headers for _, headers, _ in seen)
        assert all("Authorization" not in headers for _, headers, _ in seen)
        assert session.params == {}
        assert session.auth is None
    finally:
        session.close()


def test_address_transport_strips_explicit_credentials(address_server):
    base_url, seen = address_server
    session = lookup._address_point_session()
    try:
        response = session.get(
            base_url + "/query",
            headers={
                "Cookie": "test=fixture",
                "Authorization": "Bearer test-fixture",
                "Proxy-Authorization": "Basic test-fixture",
            },
            timeout=1,
        )
        assert response.status_code == 200
        assert len(seen) == 1
        assert not (
            {"Cookie", "Authorization", "Proxy-Authorization"} & seen[0][1].keys()
        )
        assert len(session.cookies) == 0
    finally:
        session.close()


def test_address_transport_preserves_retry_and_timeout(monkeypatch):
    seen = []

    def get(url, *, params, timeout):
        seen.append((url, params, timeout))
        if len(seen) == 1:
            raise requests.Timeout("public source fixture timeout")
        response = requests.Response()
        response.status_code = 200
        response._content = b'{"features": []}'
        return response

    monkeypatch.setattr(lookup.time, "sleep", lambda delay: None)
    assert lookup._get_json(
        url="https://example.test/query", params={"f": "json"}, timeout=8, get=get
    ) == {"features": []}
    assert seen == [("https://example.test/query", {"f": "json"}, 8)] * 2


def test_address_points_use_pooled_transport_and_census_keeps_default(monkeypatch):
    source_calls = []
    default_calls = []

    def response():
        result = requests.Response()
        result.status_code = 200
        result._content = b'{"features": []}'
        return result

    def source_get(url, **kwargs):
        source_calls.append((url, kwargs))
        return response()

    monkeypatch.setattr(lookup._address_point_session(), "get", source_get)
    monkeypatch.setattr(
        requests, "get", lambda url, **kwargs: default_calls.append(url) or response()
    )
    lookup.MinnesotaAddressPointGeocoder().suggest_matches("350 S 5")
    lookup._get_json(url="https://example.test/census", params={}, timeout=10)
    assert len(source_calls) == 1
    assert default_calls == ["https://example.test/census"]
