import subprocess
import sys


def test_starlette_test_client_uses_httpx2_without_a_warning() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-W",
            "error",
            "-c",
            "import starlette.testclient; print(starlette.testclient.httpx.__name__)",
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    assert result.stdout.strip() == "httpx2"
