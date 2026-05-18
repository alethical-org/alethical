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
