from __future__ import annotations

import importlib.util
import sys
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "prototypes" / "alethical_schema_sqlalchemy.py"


@lru_cache(maxsize=1)
def load_schema():
    spec = importlib.util.spec_from_file_location("alethical_schema_sqlalchemy", SCHEMA_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
