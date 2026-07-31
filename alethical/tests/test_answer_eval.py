"""Unit tests for the answer-quality eval primitives (#865).

Pure functions only — no DB, no network — so they run in CI. The end-to-end
runner (``scripts/answer_eval.py``) needs API keys and is run manually.

Every assertion here was mutation-checked: each one was confirmed to fail when
the behaviour it pins is broken, so none of them is decoration.
"""

from __future__ import annotations

import pathlib

import pytest

from alethical.eval.answer_eval import (
    SHIP_WORTHY_GRADED,
    AnswerQuery,
    AnswerResult,
    JudgeVerdict,
    RequiredFact,
    aggregate,
    cost_per_answer,
    judge_disagreement,
    literal_fact_coverage,
    load_fixture,
    meets_bar,
    mentions_missing_coverage,
    opens_with_bill_code,
    statute_citations,
)

FIXTURE = (
    pathlib.Path(__file__).resolve().parents[1] / "eval/fixtures/answer_questions.json"
)
CONTEXTS = (
    pathlib.Path(__file__).resolve().parents[1] / "eval/fixtures/answer_contexts.json"
)


def _query(*, answerable=True, framing="law", facts=()) -> AnswerQuery:
    return AnswerQuery(
        question="q",
        bill_key="94-2025-HF1",
        answerable=answerable,
        framing=framing,
        why_labeled="because",
        required_facts=facts,
    )


def _verdict(
    judge="j",
    *,
    grounded=True,
    declines=False,
    covers=2,
    addresses=2,
    framing=2,
    plain=2,
):
    return JudgeVerdict(
        judge=judge,
        grounded=grounded,
        declines=declines,
        covers=covers,
        addresses=addresses,
        framing=framing,
        plain=plain,
    )


def _result(query=None, answer="an answer", verdicts=(), **kwargs) -> AnswerResult:
    result = AnswerResult(query=query or _query(), model="m", answer=answer, **kwargs)
    result.verdicts.extend(verdicts)
    return result


# --- refusal detection: both directions matter, so both are pinned ---


@pytest.mark.parametrize(
    "answer",
    [
        "The bill text does not answer this question.",
        "The provided passages don't specify how many grants were awarded.",
        "I cannot find that information in the bill text.",
        "That is not addressed in the provided context.",
        "I could not find retrieval-ready bill text for this bill yet",
    ],
)
def test_mentions_missing_coverage_spots_a_no_coverage_sentence(answer):
    assert mentions_missing_coverage(answer)


def test_mentions_missing_coverage_is_a_hint_not_a_refusal_verdict():
    """The case that broke the first version of the refusal gate.

    The production prompt tells the model to answer the supported part and say
    what is not covered, so a good answer routinely closes with a caveat. This
    function fires on that caveat — which is why the gate reads the judges, not
    this function. Four of gpt-4o-mini's best answers were recorded as refusals
    before the gate moved.
    """
    good_answer_with_a_caveat = (
        "Minnesota firefighters qualify, and those diagnosed with a critical illness "
        "on or after August 1, 2021 can apply for support payments. The bill does not "
        "specify any additional qualifications beyond these criteria."
    )
    assert mentions_missing_coverage(good_answer_with_a_caveat)
    # ...but a judge that read the whole answer says it did not decline, and the
    # gate follows the judge.
    result = _result(
        query=_query(answerable=True),
        answer=good_answer_with_a_caveat,
        verdicts=[_verdict(declines=False)],
    )
    assert not result.declines()
    assert result.refusal_correct()


@pytest.mark.parametrize(
    "answer",
    [
        "The tax is 6.875 percent of gross receipts, paid by device owners.",
        "The law does not apply to vending machines, lottery devices, or gaming devices.",
    ],
)
def test_mentions_missing_coverage_ignores_what_a_bill_excludes(answer):
    assert not mentions_missing_coverage(answer)


def test_refusal_gate_fails_in_both_directions_on_the_judges_call():
    declined_the_answerable = _result(
        query=_query(answerable=True), verdicts=[_verdict(declines=True)]
    )
    assert not declined_the_answerable.refusal_correct()

    stretched_the_unanswerable = _result(
        query=_query(answerable=False), verdicts=[_verdict(declines=False)]
    )
    assert not stretched_the_unanswerable.refusal_correct()

    correct = _result(
        query=_query(answerable=False), verdicts=[_verdict(declines=True)]
    )
    assert correct.refusal_correct()


def test_one_judge_calling_it_a_refusal_is_enough():
    """Declining is a visible whole-answer property; the cautious read of a split
    is that the answer did not answer."""
    split = _result(
        query=_query(answerable=True),
        verdicts=[_verdict("a", declines=False), _verdict("b", declines=True)],
    )
    assert split.declines()
    assert not split.refusal_correct()


# --- rule 9 mechanical checks ---


def test_bill_code_preamble_only_matches_the_opening():
    assert opens_with_bill_code("HF 719 appropriates money for water systems.")
    assert opens_with_bill_code("The bill HF 719 names 19 cities.")
    # A bill number used mid-sentence is normal and must not be flagged.
    assert not opens_with_bill_code("Nineteen cities are named in HF 719.")


def test_statute_citations_finds_citations_but_not_programme_names():
    assert statute_citations("Amends Minnesota Statutes 2024, section 302A.111.")
    assert statute_citations("This is added to chapter 325M.")
    assert statute_citations("See subdivision 3 for details.")
    # "Section 8" is a housing programme and "section 179" a federal tax
    # provision — neither is a Minnesota Statutes citation (grounded-answers
    # rule 9 records both as the cases a blunter pattern got wrong).
    assert not statute_citations("Renters using Section 8 vouchers qualify.")
    assert not statute_citations("It mirrors the federal section 179 deduction.")


def test_literal_fact_coverage_counts_aliases_not_exact_strings():
    facts = (
        RequiredFact("the rate", ("6.875",)),
        RequiredFact("who pays", ("owner", "operator")),
        RequiredFact("missing", ("Runestone",)),
    )
    hits, total = literal_fact_coverage(
        _query(facts=facts), "A 6.875 percent tax paid by each device operator."
    )
    assert (hits, total) == (2, 3)


def test_literal_fact_coverage_is_zero_of_zero_when_nothing_is_labeled():
    assert literal_fact_coverage(_query(), "anything") == (0, 0)


# --- scoring: a gate failure must zero the answer, never merely dock it ---


def test_a_gate_failure_zeroes_an_otherwise_perfect_answer():
    perfect_but_ungrounded = _result(verdicts=[_verdict(grounded=False)])
    assert perfect_but_ungrounded.graded_total() == 8
    assert perfect_but_ungrounded.score() == 0
    assert not perfect_but_ungrounded.ship_worthy()


def test_grounding_fails_only_when_the_judges_agree_it_does():
    """Measurement drove this rule: the judges split on 3-8 of 20 answers per
    model, so 'either judge can fail it' measured the stricter judge and every
    candidate failed. A disputed call is reported as disputed, not as a failure."""
    disputed = _result(
        verdicts=[_verdict("a", grounded=True), _verdict("b", grounded=False)]
    )
    assert disputed.grounded()  # not failed — the judges disagree
    assert disputed.grounding_disputed()
    assert disputed.grounded("a")
    assert not disputed.grounded("b")  # per-judge view still shows each call

    agreed = _result(
        verdicts=[_verdict("a", grounded=False), _verdict("b", grounded=False)]
    )
    assert not agreed.grounded()
    assert not agreed.grounding_disputed()


def test_graded_total_floors_a_split_judgment_rather_than_rounding_up():
    split = _result(
        verdicts=[_verdict("a", plain=2), _verdict("b", plain=1)]
    )  # 8 and 7 -> 7.5
    assert split.graded_total() == 7


def test_ship_worthy_needs_both_gates_and_the_graded_floor():
    just_under = _result(verdicts=[_verdict(covers=1, addresses=1, plain=1)])  # 5
    assert just_under.graded_total() == SHIP_WORTHY_GRADED - 1
    assert not just_under.ship_worthy()

    just_over = _result(verdicts=[_verdict(covers=1, addresses=1)])  # 6
    assert just_over.ship_worthy()


def test_gate_failure_messages_name_the_direction_of_the_refusal_error():
    declined = _result(
        query=_query(answerable=True), verdicts=[_verdict(declines=True)]
    )
    assert "declined an answerable question" in declined.gate_failures()

    stretched = _result(
        query=_query(answerable=False), verdicts=[_verdict(declines=False)]
    )
    assert "answered a question the passages do not cover" in stretched.gate_failures()


# --- aggregation ---


def test_aggregate_reports_gate_failures_separately_from_the_mean():
    results = [
        _result(verdicts=[_verdict()]),
        _result(verdicts=[_verdict(grounded=False)]),
    ]
    summary = aggregate(results)
    assert summary["gate_failure_count"] == 1
    assert summary["ship_worthy"] == 1
    assert (
        summary["mean_score"] == 4.0
    )  # (8 + 0) / 2 — the failure is not averaged away


def test_aggregate_per_dimension_mean_ignores_answers_that_failed_a_gate():
    results = [
        _result(verdicts=[_verdict(plain=2)]),
        _result(verdicts=[_verdict(grounded=False, plain=0)]),
    ]
    # The gate-failed answer's plain=0 must not drag the readability mean down;
    # it is already counted, in full, as a gate failure.
    assert aggregate(results)["per_dimension_mean"]["plain"] == 2.0


def test_aggregate_percentiles_use_nearest_rank():
    results = [
        _result(verdicts=[_verdict()], seconds_total=t) for t in (1.0, 2.0, 3.0, 10.0)
    ]
    summary = aggregate(results)
    assert summary["seconds_total"]["p50"] == 2.0
    assert summary["seconds_total"]["p95"] == 10.0


def test_aggregate_rejects_an_empty_result_set():
    with pytest.raises(ValueError):
        aggregate([])


# --- the bar ---


def test_meets_bar_requires_quality_and_speed_together():
    good = aggregate(
        [_result(verdicts=[_verdict()], seconds_total=2.0) for _ in range(10)]
    )
    assert meets_bar(good, p50_seconds=5.0, p95_seconds=9.0)
    # Same answers, too slow for a reader who is waiting.
    slow = aggregate(
        [_result(verdicts=[_verdict()], seconds_total=12.0) for _ in range(10)]
    )
    assert not meets_bar(slow, p50_seconds=5.0, p95_seconds=9.0)


def test_meets_bar_fails_on_a_single_gate_failure_however_good_the_rest():
    results = [_result(verdicts=[_verdict()], seconds_total=1.0) for _ in range(19)]
    results.append(_result(verdicts=[_verdict(grounded=False)], seconds_total=1.0))
    summary = aggregate(results)
    assert summary["ship_worthy_rate"] == 0.95  # would clear the 90% rate on its own
    assert not meets_bar(summary, p50_seconds=5.0, p95_seconds=9.0)


def test_meets_bar_fails_below_the_ship_worthy_rate():
    results = [_result(verdicts=[_verdict()], seconds_total=1.0) for _ in range(8)]
    results += [
        _result(verdicts=[_verdict(covers=0, addresses=0)], seconds_total=1.0)
        for _ in range(2)
    ]  # 4/8 each: gates pass, not ship-worthy
    summary = aggregate(results)
    assert summary["gate_failure_count"] == 0
    assert summary["ship_worthy_rate"] == 0.8
    assert not meets_bar(summary, p50_seconds=5.0, p95_seconds=9.0)


def test_cost_per_answer_is_the_mean_over_the_fixture():
    results = [
        _result(verdicts=[_verdict()], input_tokens=2000, output_tokens=1000)
        for _ in range(2)
    ]
    summary = aggregate(results)
    # 4000 in @ $1/M + 2000 out @ $5/M = $0.004 + $0.010 = $0.014 over 2 answers
    assert cost_per_answer(
        summary, input_per_mtok=1.0, output_per_mtok=5.0
    ) == pytest.approx(0.007)


# --- the guard against a judge flattering its own family ---


def test_judge_disagreement_measures_the_gap_rather_than_hiding_it():
    results = [
        _result(verdicts=[_verdict("a", plain=2), _verdict("b", plain=0)]),  # gap 2
        _result(verdicts=[_verdict("a"), _verdict("b")]),  # gap 0
        _result(verdicts=[_verdict("a", grounded=True), _verdict("b", grounded=False)]),
    ]
    d = judge_disagreement(results, "a", "b")
    assert d["n"] == 3
    assert d["max_abs_gap"] == 2
    assert d["exact_agreement_rate"] == pytest.approx(2 / 3, abs=1e-3)
    assert d["grounding_gate_splits"] == 1


# --- the fixture itself ---


def test_fixture_loads_and_every_question_carries_a_human_label():
    queries = load_fixture(FIXTURE)
    assert len(queries) >= 20
    for q in queries:
        assert q.question and q.bill_key and q.why_labeled
        assert q.framing in {"law", "proposal"}
        # An answerable question needs required facts to score `covers` against;
        # an unanswerable one must have none, or the key contradicts itself.
        assert bool(q.required_facts) is q.answerable


def test_fixture_covers_both_stages_and_both_answerability_cases():
    queries = load_fixture(FIXTURE)
    assert sum(1 for q in queries if not q.answerable) >= 4
    assert sum(1 for q in queries if q.framing == "law") >= 5
    assert sum(1 for q in queries if q.framing == "proposal") >= 5
    assert len({q.bill_key for q in queries}) >= 8


def test_every_fixture_question_has_a_committed_retrieval_snapshot():
    import json

    contexts = json.loads(CONTEXTS.read_text())["contexts"]
    for q in load_fixture(FIXTURE):
        assert q.key in contexts, f"no snapshot for {q.key}"
        assert contexts[q.key]["chunks"], f"empty snapshot for {q.key}"


def test_required_fact_aliases_actually_appear_in_the_snapshotted_passages():
    """The answer key must be answerable from what the writer is shown.

    A required fact whose wording appears nowhere in the passages would be a
    label the best possible model could only satisfy by guessing.
    """
    import json

    contexts = json.loads(CONTEXTS.read_text())["contexts"]
    for q in load_fixture(FIXTURE):
        passages = " ".join(c["chunk_text"] for c in contexts[q.key]["chunks"]).lower()
        for fact in q.required_facts:
            assert any(alias.lower() in passages for alias in fact.any_of), (
                f"{q.bill_key}: no passage supports {fact.label!r}"
            )


# --- candidate-spec parsing lives in the runner, but the semantics are load-bearing ---


def test_parse_spec_treats_reasoning_depth_as_part_of_the_candidate():
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "answer_eval_cli",
        pathlib.Path(__file__).resolve().parents[2] / "scripts/answer_eval.py",
    )
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)

    # Default is the shippable configuration: no reasoning, because a reader waits.
    assert cli.parse_spec("openai:gpt-5-mini") == ("openai", "gpt-5-mini", False)
    assert cli.parse_spec("anthropic:claude-sonnet-5") == (
        "anthropic",
        "claude-sonnet-5",
        False,
    )
    # `+deep` measures the naive call, and is a distinct candidate with its own row.
    assert cli.parse_spec("openai:gpt-5.1+deep") == ("openai", "gpt-5.1", True)

    for bad in ("gpt-5-mini", "google:gemini", "openai:gpt-5-mini+fast"):
        with pytest.raises(SystemExit):
            cli.parse_spec(bad)


def test_the_eval_scores_productions_own_prompt_rather_than_a_copy():
    """A copied prompt would silently drift; this pins the import."""
    import importlib.util

    from alethical.api.routers.me import RAG_CHAT_SYSTEM_PROMPT

    spec = importlib.util.spec_from_file_location(
        "answer_eval_cli2",
        pathlib.Path(__file__).resolve().parents[2] / "scripts/answer_eval.py",
    )
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    assert cli.SYSTEM_PROMPT is RAG_CHAT_SYSTEM_PROMPT


# --- judge replies are not always clean JSON; the parser has to cope ---


def _cli():
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "answer_eval_cli3",
        pathlib.Path(__file__).resolve().parents[2] / "scripts/answer_eval.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.parametrize(
    "raw",
    [
        '{"grounded": true, "covers": 2}',
        '```json\n{"grounded": true, "covers": 2}\n```',
        # Trailing commentary after the object — reading to the LAST brace here
        # produced a baffling "Extra data" and killed a run mid-flight.
        '{"grounded": true, "covers": 2}\n\nI graded this strictly {see note}.',
        'Here is my grading:\n{"grounded": true, "covers": 2}',
    ],
)
def test_loads_json_takes_the_first_object_and_ignores_the_wrapping(raw):
    assert _cli()._loads_json(raw) == {"grounded": True, "covers": 2}


def test_loads_json_names_max_tokens_when_the_reply_was_truncated():
    cli = _cli()
    truncated = '{"grounded": true, "note": "the answer states'
    with pytest.raises(ValueError, match="max_tokens"):
        cli._loads_json(truncated, stop_reason="max_tokens")
    # Without that stop reason the message must not blame max_tokens.
    with pytest.raises(ValueError) as caught:
        cli._loads_json(truncated)
    assert "max_tokens" not in str(caught.value)


def test_a_verdict_that_parsed_but_is_unscoreable_is_rejected_so_the_retry_fires():
    cli = _cli()
    good = {
        "grounded": True,
        "declines": False,
        "covers": 2,
        "addresses": 1,
        "framing": 0,
        "plain": 2,
    }
    assert cli._validated_verdict(good) is good

    for broken in (
        {**good, "grounded": "yes"},  # a string, not a boolean
        {**good, "covers": 3},  # off the 0-2 scale
        {**good, "plain": "2"},  # numeric-looking string
        {**good, "framing": True},  # a bool would sneak through as int 1
        {k: v for k, v in good.items() if k != "addresses"},  # missing dimension
    ):
        with pytest.raises(ValueError):
            cli._validated_verdict(broken)


def test_unscoreable_cached_verdicts_are_detected_rather_than_trusted():
    """A cache can outlive the code that wrote it; junk must be re-judged, not read."""
    cli = _cli()
    good = {
        "grounded": True,
        "declines": False,
        "covers": 2,
        "addresses": 1,
        "framing": 0,
        "plain": 2,
    }
    assert cli._is_scoreable(good)
    assert not cli._is_scoreable({k: v for k, v in good.items() if k != "plain"})
    assert not cli._is_scoreable({**good, "covers": None})
    assert not cli._is_scoreable("not a dict")
    assert not cli._is_scoreable(None)
