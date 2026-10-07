# Private relationship retrieval evaluation

<!-- describes: alethical/eval/graph_eval.py, alethical/eval/graph_snapshot.py, alethical/eval/retrieval_eval.py, scripts/graph_retrieval_eval.py -->

This tool tests whether following recorded relationships finds better evidence than searching the same records. It supports the evidence tests in [issue 399](https://github.com/alethical-org/alethical/issues/399). It does not change public answers or require a graph database. Run inputs and results stay in an operator-selected private folder; the repository supplies the code and synthetic tests.

The [grounded answer requirements](../../../../.claude/rules/grounded-answers.md) still govern any later answer trial. A relationship does not establish motive, causation or a complete history. The existing [bill retrieval evaluator](../../../../scripts/retrieval_eval.py) and [answer evaluator](../../../../scripts/answer_eval.py) keep their separate roles. The relationship tool reuses the existing retrieval scoring module's additive evidence-level metrics.

## Inputs and privacy

Prepare a question file with a `cases` list. Each case needs a unique `id`, `bill_key` and `question`. Use resolved bill keys, not a new bill-resolution experiment. Keep every question about the same bill in the same split (`development` or `held_out`) before ranking.

The exporter reads only public civic records: current bill text, authorship and individual votes. It uses 1 bounded read-only repeatable-read transaction, a 30-second statement timeout and hard row limits. Exceeding a limit fails rather than silently truncating the source. It never reads accounts, chat histories or campaign-money identity links.

Each evidence row carries its original identifiers and available source, version and date fields. Missing raw-source archives remain explicit nulls. Import and update dates describe database observations, not when a legal relationship began or ended. An official link is not proof of an archived copy or complete historical coverage. Source hashes cover the frozen contents; capture-code hashes identify the exporter and production selector implementation.

The exporter can also call the current production passage selector inside the protected transaction using supplied query vectors. That reference preserves its own budget. It is not the complete deployed routing or answer-writing path, and a local environment setting does not prove the deployed writer configuration.

## Run stages

Run from the repository root. Replace the example private directory and filenames with the actual experiment folder. Existing output files cannot be overwritten.

```bash
# Price the bounded question batch without a network call.
uv run python -m scripts.graph_retrieval_eval embed \
  --questions /private/experiment/questions.json \
  --output /private/experiment/query-vectors.json

# Only after the paid batch is authorized, repeat with --execute.
# OPENAI_API_KEY must be available in the environment; never put it in an input file.

# Capture the bounded civic records. Production requires the normal authorized
# database connection settings; this stage performs no database writes.
uv run python -m scripts.graph_retrieval_eval snapshot \
  --questions /private/experiment/questions.json \
  --vectors /private/experiment/query-vectors.json \
  --target local \
  --output /private/experiment/snapshot.json

# After reviewing the frozen source and completing the labels, compare offline.
uv run python -m scripts.graph_retrieval_eval run \
  --snapshot /private/experiment/snapshot.json \
  --manifest /private/experiment/cases.json \
  --vectors /private/experiment/query-vectors.json \
  --output /private/experiment/report.json
```

The embedding stage permits at most 50 distinct questions and 20,000 UTF-8 bytes in 1 request, with no automatic retry. It requires real `text-embedding-3-small` vectors and rejects hash fallbacks, missing rows, wrong dimensions, booleans, nonfinite numbers and zero vectors. The dry run prints a conservative byte-based price estimate. Reuse the saved result. Offline comparison makes no network calls.

## Reviewed label manifest

Before ranking, bind the label manifest to `snapshot_digest`, `query_vectors_digest` and `character_budget` (default 6000). Digests are SHA-256 over canonical JSON: sorted keys, compact separators, Unicode preserved and nonfinite numbers rejected. The snapshot's own digest excludes only its `manifest.content_digest` field. Set `screening_gate.complete_evidence_gain_pp` to 10; the evaluator rejects a changed threshold.

Each case carries:

- `id`, `bill_key`, `question`, `split`, `kind` and `label_provenance`.
- `label_status: reviewed`, after checking the actual source rather than a historical answer or a model's assertion.
- `expected_evidence_ids`: the distinct, eligible, same-bill records that support the question.
- `required_evidence_groups`: 1 list per required fact, with alternate supporting evidence IDs inside that list. Every group must have at least 1 retrieved record for the case to count as complete.
- Optional `required_facts`, matching the number of groups, plus exact source quotes and review notes retained with the private inputs.

An empty evidence list and empty group list mean the snapshot does not support the requested answer. They do not mean the event never occurred or the amount is zero. Do not mark a vote question unsupported merely because bill text lacks votes when the experiment also supplies vote records. Conversely, an all-voter question needs all required voter/event records; 1 voter per event is a different answer.

Human-authored questions with new agent-reviewed mappings remain distinct from new agent-authored questions. Neither category proves representative reader traffic. Historical enumeration labels covering selected examples cannot establish a complete recipient list. Record known budget-impossible cases before scoring and retain them in the denominator.

## Comparisons and decision limits

Controlled comparisons include lexical text search, exact vector text search, hybrid text search, lexical search over all evidence, hybrid search over all evidence, and hybrid plus same-bill relationships. The lexical method is local BM25, not production PostgreSQL full-text search. Structured records have no vectors in this experiment; hybrid reaches them through word search.

All controlled methods use the same complete citation, text and source-URL representation and the same character budget. Records too large to fit are skipped without truncation. Graph routing receives no labels or case kind. It promotes recorded authorship/vote links or follows immediate neighboring chunks within the same section and current bill version. Its causal-word filter is experiment routing, not a public intent classifier.

The primary screen requires at least `ceil(0.10 * held_out_answerable_count)` net new complete cases against the strongest comparable non-graph baseline, no paired loss against any equally strong baseline, and no additional evidence/relationship failure on unsupported questions. Missing vectors or unavailable comparisons are explicit `not_run` results that block the screen. Total counts retain those cases; computed metric denominators exclude unrun cases rather than inventing scores.

The report retains per-case evidence IDs, character use, fact coverage, raw counts, provenance groups and wins/losses by question kind. Evidence recall, reciprocal rank and nDCG are secondary: alternate passages are separate relevance labels there, whereas required-group coverage needs only 1 alternative. Budget-limited inventory recall also depends on record length and packing.

Zero additional failures does not establish correct refusal: both methods may return unrelated evidence on an unsupported question. No generated answer is scored by this tool. A passing retrieval screen can justify a separately authorized private answer trial through the existing answer-quality gates; it cannot authorize public adoption. Gains limited to structured-record questions do not justify changing bill-text search. Vendor products, graph databases and API technologies require their own demonstrated need and comparison.

## Completion checks

Run the focused tests before using a result:

```bash
uv run pytest alethical/tests/test_graph_eval.py \
  alethical/tests/test_graph_snapshot.py \
  alethical/tests/test_graph_eval_cli.py \
  alethical/tests/test_evidence_retrieval_eval.py \
  alethical/tests/test_retrieval_eval.py \
  alethical/tests/test_answer_eval.py -q
```

The tests cover read-only export, source/version boundaries, immutable inputs, matching models, missing evidence, budget fairness, shared word forms, full fact coverage, tied baselines and paid-call guards. Replay the frozen inputs to a new output and compare actual evidence order and scores. Retain code/input hashes and the private bundle outside temporary working folders before cleanup. Do not tune held-out labels or ranking rules after seeing scores and report the tuned result as the same trial.
