"""The locked HTTP helper must release objects after item-view operations.

Regression for the package's real reference leak, CVE-2026-104874:
https://github.com/aio-libs/multidict/security/advisories/GHSA-54p9-h82j-f925
"""

import gc
import operator
import sys

import pytest
from multidict import CIMultiDict, MultiDict


@pytest.mark.parametrize("dictionary_type", [MultiDict, CIMultiDict])
@pytest.mark.parametrize("operation", ["reflected_union", "subtraction"])
def test_item_views_release_operand_references(dictionary_type, operation):
    values = dictionary_type(seed="x")
    sentinel = object()
    operand = [(f"key{i}", sentinel) for i in range(1000)]
    gc.collect()
    before = sys.getrefcount(sentinel)
    result = (
        operator.or_(operand, values.items())
        if operation == "reflected_union"
        else operator.sub(values.items(), operand)
    )
    assert len(result) == (1001 if operation == "reflected_union" else 1)
    del result
    gc.collect()
    assert sys.getrefcount(sentinel) == before
