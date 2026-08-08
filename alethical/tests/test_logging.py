from __future__ import annotations

import logging

from alethical.logging import configure_logging


def test_configure_logging_writes_to_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ALETHICAL_LOG_DIR", str(tmp_path))
    monkeypatch.setenv("ALETHICAL_LOG_FILE", "backend.log")
    monkeypatch.setenv("ALETHICAL_LOG_LEVEL", "INFO")

    configure_logging()
    logging.getLogger("alethical.tests").info("file logging is configured")

    log_path = tmp_path / "backend.log"
    assert log_path.exists()
    assert "file logging is configured" in log_path.read_text(encoding="utf-8")


def test_configure_logging_also_streams_on_railway(
    tmp_path, monkeypatch, capsys
) -> None:
    monkeypatch.setenv("ALETHICAL_LOG_DIR", str(tmp_path))
    monkeypatch.setenv("ALETHICAL_LOG_FILE", "backend.log")
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")

    configure_logging()
    logging.getLogger("alethical.tests").info("Railway can read this line")

    assert "Railway can read this line" in capsys.readouterr().out


def test_railway_logs_redact_email_and_query_values(
    tmp_path, monkeypatch, capsys
) -> None:
    monkeypatch.setenv("ALETHICAL_LOG_DIR", str(tmp_path))
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")

    configure_logging()
    logging.getLogger("alethical.tests").warning(
        "request for ada@example.com used /api/v1/bills?q=my+private+words"
    )

    output = capsys.readouterr().out
    assert "ada@example.com" not in output
    assert "my+private+words" not in output
    assert "[redacted-email]" in output
    assert "/api/v1/bills?[redacted-query]" in output
