"""Logging configuration for backend and ingestion runtime code."""

from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

DEFAULT_LOG_DIR = Path("logs")
DEFAULT_LOG_FILE = "alethical-backend.log"
DEFAULT_LOG_LEVEL = "INFO"


def configure_logging() -> None:
    """Route application logs to rotating files instead of stdout."""
    log_dir = Path(os.environ.get("ALETHICAL_LOG_DIR", DEFAULT_LOG_DIR))
    log_file = os.environ.get("ALETHICAL_LOG_FILE", DEFAULT_LOG_FILE)
    log_level_name = os.environ.get("ALETHICAL_LOG_LEVEL", DEFAULT_LOG_LEVEL).upper()
    log_level = getattr(logging, log_level_name, logging.INFO)
    log_path = log_dir / log_file
    log_dir.mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter(
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
    root_logger.setLevel(log_level)

    for logger_name in ("alethical", "uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        logger = logging.getLogger(logger_name)
        logger.handlers.clear()
        logger.propagate = True
        logger.setLevel(log_level)
