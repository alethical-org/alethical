"""Logging configuration for backend and ingestion runtime code."""

from __future__ import annotations

import logging
import os
import re
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

DEFAULT_LOG_DIR = Path("logs")
DEFAULT_LOG_FILE = "alethical-backend.log"
DEFAULT_LOG_LEVEL = "INFO"
EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
QUERY_PATTERN = re.compile(r"((?:https?://|/)[^\s?\"']+\?)[^\s\"']+")


class PrivacySafeFormatter(logging.Formatter):
    """Remove reader details that can appear in otherwise useful log lines."""

    def format(self, record: logging.LogRecord) -> str:
        rendered = super().format(record)
        rendered = EMAIL_PATTERN.sub("[redacted-email]", rendered)
        return QUERY_PATTERN.sub(r"\1[redacted-query]", rendered)


def configure_logging() -> None:
    """Keep local file logs and also expose privacy-safe logs on Railway."""
    log_dir = Path(os.environ.get("ALETHICAL_LOG_DIR", DEFAULT_LOG_DIR))
    log_file = os.environ.get("ALETHICAL_LOG_FILE", DEFAULT_LOG_FILE)
    log_level_name = os.environ.get("ALETHICAL_LOG_LEVEL", DEFAULT_LOG_LEVEL).upper()
    log_level = getattr(logging, log_level_name, logging.INFO)
    log_path = log_dir / log_file
    log_dir.mkdir(parents=True, exist_ok=True)

    formatter = PrivacySafeFormatter(
        "%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )
    file_handler = RotatingFileHandler(
        log_path,
        maxBytes=int(os.environ.get("ALETHICAL_LOG_MAX_BYTES", "10485760")),
        backupCount=int(os.environ.get("ALETHICAL_LOG_BACKUP_COUNT", "5")),
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(log_level)

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(file_handler)
    if os.environ.get("RAILWAY_ENVIRONMENT_NAME"):
        stream_handler = logging.StreamHandler(sys.stdout)
        stream_handler.setFormatter(formatter)
        stream_handler.setLevel(log_level)
        root_logger.addHandler(stream_handler)
    root_logger.setLevel(log_level)

    for logger_name in (
        "alethical",
        "uvicorn",
        "uvicorn.error",
        "uvicorn.access",
        "fastapi",
    ):
        logger = logging.getLogger(logger_name)
        logger.handlers.clear()
        logger.propagate = True
        logger.setLevel(log_level)
