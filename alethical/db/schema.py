from functools import lru_cache
from types import ModuleType

from alethical.db import models


@lru_cache(maxsize=1)
def load_schema() -> ModuleType:
    return models
