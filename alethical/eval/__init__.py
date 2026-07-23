"""Retrieval-quality evaluation harness (#399/#400/#380/#255).

A reusable, corpus-grounded eval that measures how well semantic bill
resolution actually works, so retrieval changes (hybrid FTS+RRF, threshold
tuning, embedding-model swaps) are gated on measured lift rather than guessed.
See ``alethical/eval/retrieval_eval.py`` for the runner and
``scripts/retrieval_eval.py`` for the CLI.
"""
