"""Builds the Variant B style addendum -- appended after the real system
prompt, never substituted into it.

``alethical.api.routers.legislator_chat.SYSTEM_PROMPT_TEMPLATE`` is imported
and used verbatim for both conditions. Condition B's system prompt is that
same string, formatted the same way, with this addendum appended as its own
clearly labeled section. Nothing in this module edits the template string or
the file it lives in.
"""

from __future__ import annotations

from alethical.eval.persona_benchmark.style_exemplars import StyleCorpus

STYLE_ADDENDUM_TEMPLATE = """

STYLE REFERENCE (voice only -- not evidence)
The lines below are things {legislator_name} has actually said publicly. Use them ONLY
to match tone, rhythm, sentence length, and word choice. Do NOT treat anything in them
as a source of facts, positions, motivations, or events, and do not quote them verbatim.
Every factual claim in your answer must still come only from "His record" above -- this
section changes how you sound, never what you are allowed to claim.

{quotes}"""


def style_addendum(legislator_name: str, corpus: StyleCorpus | None) -> str:
    """Empty string when no style corpus exists for this legislator -- Condition
    B then has nothing appended and is byte-identical to Condition A, which is
    itself the intended test for a quote-poor legislator (see legislators.py)."""
    if corpus is None or not corpus.exemplars:
        return ""
    return STYLE_ADDENDUM_TEMPLATE.format(
        legislator_name=legislator_name, quotes=corpus.exemplar_block()
    )
