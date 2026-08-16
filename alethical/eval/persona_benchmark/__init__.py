"""Offline A/B benchmark for the legislator persona feature (PR #397).

Evaluation infrastructure only. Nothing here is imported by, or changes the
behavior of, ``alethical/api/routers/legislator_chat.py`` — this package reads
that module's real functions and constants to run an experiment against them,
the same relationship ``alethical/eval/answer_eval.py`` has to
``alethical/api/routers/me.py``.

Condition A calls ``synthesize_legislator_answer`` exactly as production does.
Condition B calls the same function with one addition: a short, clearly
labeled style-exemplar block appended after the real system prompt, built
from real first-person quotes for that legislator (``style_exemplars.py``).
The production prompt template, retrieval, and citation verification are
untouched and identical between conditions — see ``runner.py``.

See ``README.md`` in this directory for how to run the pilot.
"""
