"""Unit tests for the answer-quality eval primitives (#865).

Pure functions only — no DB, no network — so they run in CI. The end-to-end
runner (``scripts/answer_eval.py``) needs API keys and is run manually.

Every assertion here was mutation-checked: each one was confirmed to fail when
the behaviour it pins is broken, so none of them is decoration.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from alethical.eval.answer_eval import (
    SHIP_WORTHY_GRADED,
    AnswerQuery,
    AnswerResult,
    EnumerationScore,
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
    claims_completeness=False,
    asserts_absence=False,
    covers=2,
    addresses=2,
    framing=2,
    plain=2,
):
    return JudgeVerdict(
        judge=judge,
        grounded=grounded,
        declines=declines,
        claims_completeness=claims_completeness,
        asserts_absence=asserts_absence,
        covers=covers,
        addresses=addresses,
        framing=framing,
        plain=plain,
    )


def _result(query=None, answer="an answer", verdicts=(), **kwargs) -> AnswerResult:
    result = AnswerResult(query=query or _query(), model="m", answer=answer, **kwargs)
    result.verdicts.extend(verdicts)
    return result


def _ctx(*, chunks=1, passages_total=1, chunk_text="a passage") -> dict:
    """A frozen retrieval context, in the shape the runner's snapshot writes."""
    return {
        "bill_key": "94-2025-HF1",
        "question": "q",
        "passages_total": passages_total,
        "chunks": [
            {"citation_label": f"Sec. {i}", "chunk_text": chunk_text}
            for i in range(chunks)
        ],
    }


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


def _bar(summary, **overrides):
    """``meets_bar`` at the shipped numbers, so a test names only what it varies."""
    return meets_bar(
        summary,
        **{
            "p50_seconds": 5.0,
            "p95_seconds": 9.0,
            "worst_seconds": 15.0,
            "min_enumeration_recall": 0.80,
            **overrides,
        },
    )


def _enumerating(named, total=100, shape="cities"):
    """A result carrying a recall observation per sample."""
    return _result(
        verdicts=[_verdict()],
        seconds_total=2.0,
        enumeration=(EnumerationScore(shape=shape, total=total, named=tuple(named)),),
    )


def test_meets_bar_requires_quality_and_speed_together():
    good = aggregate(
        [_result(verdicts=[_verdict()], seconds_total=2.0) for _ in range(9)]
        + [_enumerating([90])]
    )
    assert _bar(good)
    # Same answers, too slow for a reader who is waiting.
    slow = aggregate(
        [_result(verdicts=[_verdict()], seconds_total=12.0) for _ in range(9)]
        + [_enumerating([90])]
    )
    assert not _bar(slow)


def test_meets_bar_fails_on_a_single_gate_failure_however_good_the_rest():
    results = [_result(verdicts=[_verdict()], seconds_total=1.0) for _ in range(18)]
    results.append(_enumerating([90]))
    results.append(_result(verdicts=[_verdict(grounded=False)], seconds_total=1.0))
    summary = aggregate(results)
    assert summary["ship_worthy_rate"] == 0.95  # would clear the 90% rate on its own
    assert not _bar(summary)


def test_meets_bar_fails_below_the_ship_worthy_rate():
    results = [_result(verdicts=[_verdict()], seconds_total=1.0) for _ in range(7)]
    results.append(_enumerating([90]))
    results += [
        _result(verdicts=[_verdict(covers=0, addresses=0)], seconds_total=1.0)
        for _ in range(2)
    ]  # 4/8 each: gates pass, not ship-worthy
    summary = aggregate(results)
    assert summary["gate_failure_count"] == 0
    assert summary["ship_worthy_rate"] == 0.8
    assert not _bar(summary)


# --- #895: the two conditions an average was hiding ---


def test_the_worst_answer_fails_the_bar_even_where_both_percentiles_pass():
    """The hole this closes: every arm measured breaches the 9-second budget on its
    slowest answer, at 10.6 to 29.5 seconds, while its p95 lands underneath.

    p95 over 20 questions is the 19th-slowest, and only a handful of the questions
    are long bills — so the percentile is measuring the short ones and calling the
    tail clean. Nineteen fast answers and one that takes half a minute is not a fast
    product for the reader who asked about the long bill.
    """
    results = [_result(verdicts=[_verdict()], seconds_total=1.0) for _ in range(19)]
    results.append(_enumerating([90]))
    results[-1].seconds_total = 1.0
    results[-1].sample_seconds = (1.0, 1.0, 29.5)
    summary = aggregate(results)
    assert summary["seconds_total"]["p50"] == 1.0
    assert summary["seconds_total"]["p95"] == 1.0  # the tail is invisible here
    assert summary["seconds_total"]["worst"] == 29.5  # and visible here
    assert not _bar(summary)
    # Nothing else about the arm changed, so the tail is what failed it.
    assert _bar(summary, worst_seconds=30.0)


def test_the_worst_case_reads_every_sample_not_just_the_scored_one():
    """A repeat exists precisely because one draw is not a tail. The same question
    and model measured 10.0 to 23.2 seconds run to run, so a worst case computed
    from the first sample would report whichever run happened to be scored.
    """
    results = [_enumerating([90]) for _ in range(3)]
    results[0].sample_seconds = (2.0, 23.2, 10.0)
    assert aggregate(results)["seconds_total"]["worst"] == 23.2


def test_recall_binds_the_worst_draw_because_a_reader_gets_one_draw():
    """Four runs of one question returned 19, 26, 34 and 35 of 98 cities. Their mean
    is 29%, which describes no answer anybody received. The bar reads the 19.
    """
    swings = aggregate([_enumerating([19, 26, 34, 35], total=98)])
    recall = swings["enumeration_recall"]
    assert round(recall["min"], 3) == 0.194
    assert round(recall["max"], 3) == 0.357
    assert not _bar(swings)
    # A steady arm at the same *worst* value passes, so the spread is not being
    # punished twice — being erratic costs a candidate only its bad draws.
    steady = aggregate([_enumerating([90, 90, 90], total=100)])
    assert _bar(steady)
    # And an arm that is high on average but dips below on one draw does not.
    erratic = aggregate([_enumerating([99, 99, 70], total=100)])
    assert erratic["enumeration_recall"]["median"] == 0.99
    assert not _bar(erratic)


def test_each_shape_is_scored_apart_so_a_good_list_cannot_carry_a_bad_one():
    """The arm that named 19 of 98 cities named 1 of 17 counties. Pooled, that is one
    mediocre percentage; apart, it is a short list and a denied category, which are
    different failures and only the second is the one #868 was filed for.
    """
    pooled_would_hide_it = aggregate(
        [
            _result(
                verdicts=[_verdict()],
                seconds_total=1.0,
                enumeration=(
                    EnumerationScore(shape="cities", total=100, named=(95,)),
                    EnumerationScore(shape="counties", total=20, named=(2,)),
                ),
            )
        ]
    )
    recall = pooled_would_hide_it["enumeration_recall"]
    assert recall["shapes"] == 2
    assert recall["min"] == 0.10  # the counties, not (95+2)/120 = 81%
    assert not _bar(pooled_would_hide_it)


def test_an_unmeasured_recall_fails_the_bar_rather_than_passing_it_by_default():
    """A fixture that lost its long bills must not start passing everything.

    ``None`` here means "not measured", and the cautious reading of a missing
    measurement is that the condition is unmet — the same reasoning that makes a
    missing latency figure fail rather than pass.
    """
    summary = aggregate(
        [_result(verdicts=[_verdict()], seconds_total=1.0) for _ in range(10)]
    )
    assert summary["enumeration_recall"] is None
    assert not _bar(summary)


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
    assert cli.parse_spec("openai:gpt-5-mini") == ("openai", "gpt-5-mini", False, 4)
    assert cli.parse_spec("anthropic:claude-sonnet-5") == (
        "anthropic",
        "claude-sonnet-5",
        False,
        4,
    )
    # `+deep` measures the naive call, and is a distinct candidate with its own row.
    assert cli.parse_spec("openai:gpt-5.1+deep") == ("openai", "gpt-5.1", True, 4)

    for bad in ("gpt-5-mini", "google:gemini", "openai:gpt-5-mini+fast"):
        with pytest.raises(SystemExit):
            cli.parse_spec(bad)


def test_the_eval_sends_the_whole_prompt_production_sends():
    """Pins the eval to production's *complete* instruction, not just its first half.

    The original guard asserted the eval used `RAG_CHAT_SYSTEM_PROMPT` by identity,
    which catches a copy that drifted. It could not catch a layer production adds
    on top, and #868 did exactly that: it composed the constant with a coverage
    rule forbidding the overclaiming the eval measures, and the eval kept sending
    half the prompt with every guard green.

    So this asserts against whatever production composes today — the constant while
    #868 is unmerged, `rag_chat_system_prompt(None)` once it lands. `None` is the
    right coverage for a caller holding no context, and stays the right answer for
    the bill-scoped chat, which retrieves a fixed three passages and never counts
    the bill.
    """
    import alethical.api.routers.me as me

    cli = _cli()
    composer = getattr(me, "rag_chat_system_prompt", None)
    expected = composer(None) if composer else me.RAG_CHAT_SYSTEM_PROMPT
    assert cli.production_system_prompt() == expected
    # Whatever it composes, production's own words must be inside it.
    assert me.RAG_CHAT_SYSTEM_PROMPT in cli.production_system_prompt()


def test_the_prompt_follows_each_questions_coverage_not_the_runs():
    """A complete read gets production's complete-coverage rule, not the partial one.

    The gap this closes (#878): the eval sent `rag_chat_system_prompt(None)` for
    every question, which was right when every frozen context was four passages of
    a long bill and wrong the moment #868 started reading some bills whole. On a
    complete read production sends a materially *different* instruction — one that
    positively licenses "the bill names none of these" and asks for every instance
    rather than a handful. Sending the partial rule there scores a model on words
    it never received.
    """
    import alethical.api.routers.me as me

    cli = _cli()
    whole = {"chunks": [{}, {}, {}], "passages_total": 3}
    part = {"chunks": [{}, {}, {}], "passages_total": 102}

    assert cli.production_system_prompt(whole) == me.rag_chat_system_prompt(
        me.BillTextCoverage(searched=3, total=3)
    )
    assert cli.production_system_prompt(part) == me.rag_chat_system_prompt(
        me.BillTextCoverage(searched=3, total=102)
    )
    assert cli.production_system_prompt(whole) != cli.production_system_prompt(part)
    # An unknown denominator must read as partial, never as licence to speak for
    # the whole bill — the safe direction, and production's own (BillTextCoverage).
    assert cli.production_system_prompt(
        {"chunks": [{}], "passages_total": 0}
    ) == cli.production_system_prompt(part)


def test_a_prompt_change_invalidates_a_cached_arm_rather_than_mixing_two():
    """Without this, a prompt change is invisible: the run reuses old answers,
    scores them beside new ones, and publishes a comparison across two prompts.

    Digests every variant in play, not one: since #868 a single run sends two
    system prompts, and hashing only the partial one would let an edit to the
    complete-coverage rule ship against a stale cache.
    """
    cli = _cli()
    partial_only = {"q": _ctx(passages_total=9)}
    both = {**partial_only, "w": _ctx(passages_total=1)}

    assert len(cli.prompt_fingerprint(partial_only)) == 12
    assert cli.prompt_fingerprint(partial_only) == cli.prompt_fingerprint(partial_only)
    # A run that also reads a bill whole sends a second prompt, so it must not
    # reuse a cache generated when only the partial rule was ever sent.
    assert cli.prompt_fingerprint(both) != cli.prompt_fingerprint(partial_only)


def test_re_snapshotting_invalidates_a_cached_arm_too_not_only_a_prompt_edit():
    """#895: this was believed to happen and did not, which is why it is pinned now.

    Neither coverage rule quotes a passage count — both are fixed prose — so a fresh
    snapshot keeping the same mix of complete and partial reads produced a
    byte-identical set of system prompts and the same digest, however much the bill
    text underneath had moved. The cached arm was then reused, and answers written
    from the old passages were scored and judged against the new ones.
    """
    cli = _cli()
    before = {"q": _ctx(chunk_text="the city of Duluth")}
    after = {"q": _ctx(chunk_text="the city of Rochester")}
    assert cli.prompt_fingerprint(before) != cli.prompt_fingerprint(after)
    # The coverage classes are identical across those two, so the system prompts
    # alone genuinely cannot tell them apart. That is the near-miss, stated.
    assert cli.production_system_prompt(before["q"]) == cli.production_system_prompt(
        after["q"]
    )


def test_repeats_go_to_the_long_questions_and_nowhere_else():
    """Sampling is confined to where the variance is (#895). The short questions are
    stable, so repeats there would buy nothing and cost three times the money — the
    reason the plan is "cut arms, never repeats" rather than "sample everything".
    """
    cli = _cli()
    short = _ctx(chunks=cli.CHUNK_LIMIT, passages_total=cli.CHUNK_LIMIT)
    long_bill = _ctx(chunks=102, passages_total=102)
    assert cli.samples_wanted(short) == 1
    assert cli.samples_wanted(long_bill) == cli.REPEAT_SAMPLES >= 3
    # Derived from production's own budget, not a hand-written list of bill keys,
    # so the set stays right when the fixture or the budget changes.
    contexts = json.loads(CONTEXTS.read_text())["contexts"]
    repeated = [k for k, c in contexts.items() if cli.samples_wanted(c) > 1]
    assert len(repeated) == 6, repeated
    # Every bill a recall figure is measured on is in the repeated set, or its
    # spread — the thing the sampling was bought for — goes unmeasured.
    from alethical.eval.ground_truth import ENUMERATION_CASES

    for case in ENUMERATION_CASES:
        assert any(k.startswith(case.bill_key) for k in repeated), case.bill_key


def test_the_snapshot_reproduces_both_of_productions_retrieval_branches():
    """The eval must ask ask.py how much to read, not restate the rule (#868).

    Before this, the snapshot took one flat passage budget for every question. After
    #868 production reads the question first — an enumerate-everything question gets
    up to `_LIST_QUESTION_WORD_BUDGET` words of the bill, a specific question keeps
    the fixed four passages — so a flat snapshot measures neither shape.
    """
    import inspect

    import alethical.api.routers.ask as ask

    cli = _cli()
    source = inspect.getsource(cli.snapshot)
    assert "_retrieve_bill_text" in source, (
        "the snapshot must call production's own retrieval, not re-implement it"
    )
    assert "_LIST_QUESTION_RE" in source, (
        "the snapshot must decide enumerating-ness the way ask.py does"
    )
    # And the constant the eval names as production's fixed budget really is it.
    assert cli.CHUNK_LIMIT == ask._BILL_TEXT_CHUNK_LIMIT


def test_the_scored_answer_is_what_production_serves_not_the_raw_completion():
    """`synthesize_grounded_answer` is the unit under test, guards included.

    Scoring the model's raw words measures a product we do not ship: on a partial
    read production re-scopes absence claims and always drops a sentence vouching
    for its own list, so a reader never sees either shape however the model wrote it.
    """
    import alethical.api.routers.me as me

    cli = _cli()
    partial = me.BillTextCoverage(searched=4, total=102)
    whole = me.BillTextCoverage(searched=48, total=48)

    denial = "The bill does not name any counties."
    assert cli.served_answer(denial, partial) == me.narrow_bill_absence_claims(denial)
    assert cli.served_answer(denial, partial) != denial
    # Once every section has been read the same sentence is true, so it survives.
    assert cli.served_answer(denial, whole) == denial

    vouched = "Duluth and Rochester get grants. That is the complete list."
    assert "complete list" not in cli.served_answer(vouched, whole)


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
        "claims_completeness": False,
        "asserts_absence": False,
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
        "claims_completeness": False,
        "asserts_absence": False,
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


# --- the partial-reading gate: the failure every other signal passes (#868) ---


def _partial(**verdict_kwargs) -> AnswerResult:
    """An answer written from 4 of a bill's 102 passages, as HF 719's is."""
    return _result(
        verdicts=[_verdict(**verdict_kwargs)], passages_shown=4, passages_total=102
    )


def test_a_complete_looking_list_from_a_partial_reading_fails():
    """The HF 719 failure: 19 cities named as though that were the set, when the
    bill names ~98. Grounded, cited, plain, and wrong."""
    overclaimed = _partial(claims_completeness=True)
    assert overclaimed.grounded()  # every claim IS supported by what it was shown
    assert overclaimed.refusal_correct()
    assert not overclaimed.honest_about_partial_reading()
    assert not overclaimed.gates_passed()
    assert overclaimed.score() == 0


def test_denying_a_category_from_a_partial_reading_fails():
    """ "The bill does not name any counties" from 4 of 102 passages. The bill names
    at least 17."""
    denied = _partial(asserts_absence=True)
    assert not denied.honest_about_partial_reading()
    assert "denied something exists, on a partial reading of the bill" in (
        denied.gate_failures()
    )


def test_the_gate_says_how_little_of_the_bill_was_read():
    failure = " ".join(_partial(claims_completeness=True).gate_failures())
    assert "4 of 102" in failure


def test_the_gate_does_not_fire_when_the_whole_bill_was_in_context():
    """A complete list IS complete, and an absence IS an absence, when every
    passage was read. 94.6% of bills fit, so this must not tax them."""
    whole_bill = _result(
        verdicts=[_verdict(claims_completeness=True, asserts_absence=True)],
        passages_shown=3,
        passages_total=3,
    )
    assert not whole_bill.context_is_partial
    assert whole_bill.honest_about_partial_reading()
    assert whole_bill.gates_passed()


def test_one_judge_spotting_an_overclaim_is_enough():
    split = _result(
        verdicts=[
            _verdict("a", claims_completeness=False),
            _verdict("b", claims_completeness=True),
        ],
        passages_shown=4,
        passages_total=102,
    )
    assert not split.honest_about_partial_reading()


def test_aggregate_counts_overclaims_only_among_partial_context_questions():
    results = [
        _partial(claims_completeness=True),
        _partial(),
        _result(verdicts=[_verdict()], passages_shown=2, passages_total=2),
    ]
    summary = aggregate(results)
    assert summary["partial_context_questions"] == 2
    assert summary["overclaimed_on_partial"] == 1


# --- shared ground truth (#868 imports these; they must not drift) ---


def test_hf719_ground_truth_bounds_sit_below_the_measured_counts():
    from alethical.eval import ground_truth as gt

    # Measured independently twice: 98 cities, 17 counties. Bounds sit clear of
    # every definitional edge case, so only a real regression breaches them.
    assert gt.HF719_MIN_GRANT_CITIES <= 98
    assert gt.HF719_MIN_GRANT_COUNTIES <= 17
    # ...and well above what the buggy answer claimed.
    assert gt.HF719_MIN_GRANT_CITIES > gt.HF719_ANSWER_CITY_COUNT_BUG
    assert gt.HF719_COUNTIES_ARE_NAMED is True
    for name in gt.HF719_GRANT_COUNTIES:
        assert name and name[0].isupper()
    assert "Hennepin" in gt.HF719_GRANT_COUNTIES
    assert "Minneapolis" in gt.HF719_GRANT_CITIES


def test_the_grant_recipients_are_read_off_the_snapshot_and_clear_the_bounds():
    """The denominator of the recall figure has to come from the bill, not a list.

    A hand-typed roster of 98 names goes stale the first time the text is
    re-ingested, and a stale denominator turns a recall percentage into a fiction.
    So the names are derived from the snapshotted passages, and this asserts the
    derivation still finds what two independent hand counts found.
    """
    from alethical.eval import ground_truth as gt

    contexts = json.loads(CONTEXTS.read_text())["contexts"]
    key = next(k for k in contexts if "cities and counties" in k)
    bill_text = "\n".join(c["chunk_text"] for c in contexts[key]["chunks"])
    cities, counties = gt.hf719_grant_recipients(bill_text)

    assert len(cities) >= gt.HF719_MIN_GRANT_CITIES
    assert len(counties) >= gt.HF719_MIN_GRANT_COUNTIES
    assert {"Minneapolis", "Duluth", "Rochester"} <= cities
    assert {"Hennepin", "Ramsey", "Anoka"} <= counties

    # And an answer naming a handful reads as naming a handful, which is the whole
    # point: the honesty gate passes this answer, so only the count can fail it.
    handful = "Grants go to Minneapolis, Duluth and Hennepin County."
    assert len(gt.names_from(cities, handful)) == 2
    assert len(gt.names_from(counties, handful)) == 1


def test_the_derivation_reproduces_the_hand_counts_exactly_not_just_the_bounds():
    """The bounds above are 90 and 15, so they pass at 16 counties — and the shipped
    pattern found 16 while the module documented 17.

    A lower bound is the right shape for a *regression* test and cannot catch an
    off-by-one in the denominator itself, which silently makes every recall
    percentage in §12 a fraction of the wrong total. So this pins the two figures
    the module publishes, exactly.

    The seventeenth county is Lake of the Woods, whose name carries lowercase
    connectors no capitals-only pattern can match.
    """
    from alethical.eval import ground_truth as gt

    contexts = json.loads(CONTEXTS.read_text())["contexts"]
    key = next(k for k in contexts if "cities and counties" in k)
    bill_text = "\n".join(c["chunk_text"] for c in contexts[key]["chunks"])
    # The figures only mean anything if this really is the whole bill.
    assert len(contexts[key]["chunks"]) == contexts[key]["passages_total"]

    cities, counties = gt.hf719_grant_recipients(bill_text)
    assert len(cities) == 98
    assert len(counties) == 17
    assert "Lake of the Woods" in counties
    # A connector may not run the name on into the sentence that follows it.
    assert not any(name.endswith(("of", "the")) for name in counties)


def test_every_enumeration_case_reproduces_its_hand_verified_count_exactly():
    """#895: recall is measured on three bills now, so all three need a real denominator.

    Each count was derived from the bill's whole text and then read match by match in
    context, because every one of the three turned up something a pattern alone gets
    wrong — a truncated multi-word name, a name followed by revision markup, and a bill
    that names 15 school districts while funding 11. Asserting **exactly**, never as a
    bound: a bound is deaf in the direction it bounds, which is how a county pattern
    finding 16 sat under a `>= 15` assertion while the docstring said 17 ([#900](https://github.com/alethical-org/alethical/pull/900)).
    """
    from alethical.eval import ground_truth as gt

    contexts = json.loads(CONTEXTS.read_text())["contexts"]
    assert gt.ENUMERATION_CASES, "the registry must not be empty"

    for case in gt.ENUMERATION_CASES:
        context = next(c for c in contexts.values() if c["bill_key"] == case.bill_key)
        # A recall denominator only means anything against the whole bill. If the
        # snapshot ever reads one of these partially, the count below is measuring a
        # sample and this must fail rather than quietly shrink.
        assert len(context["chunks"]) == context["passages_total"], (
            f"{case.bill_key} is no longer read in full"
        )
        bill_text = "\n".join(c["chunk_text"] for c in context["chunks"])

        found = case.found_in(bill_text)
        assert len(found) == case.expected, (
            f"{case.bill_key} {case.shape}: derived {len(found)}, "
            f"hand-verified {case.expected}"
        )
        for exemplar in case.exemplars:
            assert exemplar in found, (
                f"{case.bill_key} {case.shape}: {exemplar!r} is named in the bill "
                "but the pattern missed it"
            )
        # No name may run on into the sentence after it.
        assert not any(name.endswith((" of", " the")) for name in found)


def test_the_new_bills_cover_shapes_and_scales_hf719_cannot():
    """Three bills is the corpus maximum, so each one has to earn its place.

    A second copy of HF 719's city pattern would add a row and no information. What
    these add is a **non-place** enumerable shape (school district numbers), a second
    scale (14 items against 98), and both framings, so the framing dimension is
    exercised on a long bill rather than only on short ones.
    """
    from alethical.eval import ground_truth as gt

    by_bill = {c.bill_key for c in gt.ENUMERATION_CASES}
    assert len(by_bill) == 3, "recall is measured on three bills"
    assert {c.shape for c in gt.ENUMERATION_CASES} == {
        "cities",
        "counties",
        "school districts",
    }
    # Scales are genuinely different, so "does it shorten a short list too" is askable.
    assert sorted(c.expected for c in gt.ENUMERATION_CASES) == [11, 14, 17, 98]

    queries = {q.bill_key: q for q in load_fixture(FIXTURE)}
    assert queries["94-2025-HF2484"].framing == "law"
    assert queries["94-2026-SF3551"].framing == "proposal"
    # Every enumeration bill has a fixture question, or nothing scores its recall.
    for bill_key in by_bill:
        assert bill_key in queries, f"{bill_key} has no fixture question"


def test_a_dollar_figure_does_not_credit_a_school_district_of_the_same_digits():
    """Finding an item in a *bill* and finding it in an *answer* are different jobs.

    School district 13 and the "13" inside "$13,000" are the same three characters,
    and the districts are the one enumerable shape in the fixture that is a bare
    number rather than a proper noun. Crediting a dollar amount would inflate recall
    with money — an answer that named nothing would score for every district whose
    digits happened to open an appropriation.
    """
    from alethical.eval.ground_truth import MENTIONED_AS_NUMBER, names_from

    districts = {"13", "38", "152"}
    money = "The bill gives $13,000 to one district and $1,152,000 to another."
    assert names_from(districts, money, template=MENTIONED_AS_NUMBER) == set()
    # And a real listing is still read, in the two shapes an answer writes it.
    listed = "Districts No. 13, 38, and 152 each receive money."
    assert names_from(districts, listed, template=MENTIONED_AS_NUMBER) == districts


def test_recall_is_not_computed_from_a_denominator_that_stopped_reproducing():
    """A missing row is a visible gap; a wrong row is a fiction that reads like a
    measurement. If the snapshot's text no longer yields the count a human verified,
    every percentage from it is wrong by the same amount, so none is printed (#900).
    """
    cli = _cli()
    contexts = json.loads(CONTEXTS.read_text())["contexts"]
    whole_bill = next(
        c
        for c in contexts.values()
        if c["bill_key"] == "94-2025-HF2484" and len(c["chunks"]) == c["passages_total"]
    )
    assert cli.enumeration_scores(whole_bill, ["Anoka"])[0].total == 14

    # Half the bill: the denominator would be a sample of the list, not the list.
    half = {**whole_bill, "chunks": whole_bill["chunks"][:30]}
    assert cli.enumeration_scores(half, ["Anoka"]) == ()

    # Whole bill, but the text has changed under the hand-verified count.
    gutted = {
        **whole_bill,
        "chunks": [{**c, "chunk_text": "nothing"} for c in whole_bill["chunks"]],
    }
    assert cli.enumeration_scores(gutted, ["Anoka"]) == ()


def test_a_short_recipient_name_is_not_credited_to_a_longer_one_containing_it():
    """Three of HF 719's names sit inside another: St. Paul in South St. Paul,
    Benton in Lake Benton, Minnetonka in Minnetonka Beach.

    A plain substring test credits the short name every time the long one appears,
    so an answer naming only Lake Benton is recorded as having named Benton as well
    and reads as more complete than it is. Measured on the re-run's own answers this
    inflated three of the four arms checked by one name each.
    """
    from alethical.eval import ground_truth as gt

    cities = {"St. Paul", "South St. Paul", "Benton", "Lake Benton", "Duluth"}

    only_the_long_ones = "Grants go to South St. Paul and Lake Benton."
    assert gt.names_from(cities, only_the_long_ones) == {
        "South St. Paul",
        "Lake Benton",
    }

    # Both named separately still counts as both — the fix must not swing the other
    # way and hide a name the answer really did print.
    both = "Grants go to South St. Paul, to St. Paul, to Lake Benton and to Benton."
    assert gt.names_from(cities, both) == cities - {"Duluth"}

    # And a word boundary, so a city called Grant is not found in "grants".
    assert gt.names_from({"Grant", "Duluth"}, "The bill awards grants.") == set()
    assert gt.names_from({"Grant"}, "A grant to the city of Grant.") == {"Grant"}


def test_the_hf719_fixture_question_forbids_both_overclaims():
    """The label must forbid the two things production actually did."""
    hf719 = next(
        q
        for q in load_fixture(FIXTURE)
        if q.bill_key == "94-2025-HF719" and "cities and counties" in q.question
    )
    forbidden = " ".join(hf719.must_not_claim).lower()
    assert "no counties are named" in forbidden
    assert "complete set" in forbidden
    # And the third, added once #868 started reading this bill whole (#878): the
    # names a short answer left out are IN the context, so blaming the context for
    # them is a claim about the context that the context refutes.
    assert "absent from the provided text" in forbidden
    # The label must describe the input the writer now gets. A label still saying
    # the writer sees four passages is a false statement handed to the judge, which
    # is worse than no label at all.
    assert "all 102 passages" in hf719.why_labeled.lower()


# --- passage budget is part of a candidate's identity ---


def test_parse_spec_reads_the_passage_budget():
    cli = _cli()
    assert cli.parse_spec("openai:gpt-4o-mini") == ("openai", "gpt-4o-mini", False, 4)
    assert cli.parse_spec("openai:gpt-4o-mini@16") == (
        "openai",
        "gpt-4o-mini",
        False,
        16,
    )
    assert cli.parse_spec("anthropic:claude-sonnet-5+deep@8") == (
        "anthropic",
        "claude-sonnet-5",
        True,
        8,
    )
    for bad in ("openai:gpt-4o-mini@0", "openai:gpt-4o-mini@lots"):
        with pytest.raises(SystemExit):
            cli.parse_spec(bad)


def test_a_wider_budget_gets_its_own_snapshot_file():
    """The baseline snapshot must never be overwritten by the experiment it is
    being compared against."""
    cli = _cli()
    assert cli.contexts_path(4) == cli.CONTEXTS
    assert cli.contexts_path(16) != cli.CONTEXTS
    assert "16" in cli.contexts_path(16).name


def test_a_budget_appears_in_the_cache_filename():
    cli = _cli()
    assert cli._slug("openai:gpt-4o-mini@16") != cli._slug("openai:gpt-4o-mini")
    assert "@" not in cli._slug("openai:gpt-4o-mini@16")


def test_a_candidates_cost_is_looked_up_by_the_model_it_runs():
    """`+deep` and `@16` change how many tokens, never what a token costs.

    Keying the price table on the whole spec is why three of the nine rows in the
    bar doc's §10 printed no cost — the three whose entire point was that they
    consume more tokens than the plain arm.
    """
    cli = _cli()
    plain = cli.price_of("openai:gpt-5.1")
    assert plain is not None
    assert cli.price_of("openai:gpt-5.1+deep") == plain
    assert cli.price_of("openai:gpt-4o-mini@16") == cli.price_of("openai:gpt-4o-mini")
    assert cli.price_of("openai:gpt-4o-mini+deep@8") == cli.price_of(
        "openai:gpt-4o-mini"
    )
    # An unpriced model still reads as unpriced rather than as free.
    assert cli.price_of("openai:gpt-9-imaginary") is None


def test_a_guard_edit_counts_words_removed_not_whitespace_normalised():
    """Measuring this wrong invented the loudest number in the comparison.

    Counting any difference reported that `gpt-5.1` needed production's backstop on
    11 of 20 answers. 31 of the 34 differences across seven arms were whitespace:
    `strip_list_completeness_claims` splits into sentences and rejoins them, and the
    rejoin drops a Markdown hard line break (two spaces before a newline). It
    removed nothing and flagged everything.
    """
    cli = _cli()
    assert not cli.guard_changed_content(
        "Line one.  \nLine two.", "Line one.\nLine two."
    )
    assert not cli.guard_changed_content("a\n\nb", "a b")
    # A dropped sentence is the thing worth counting, and still counts.
    assert cli.guard_changed_content(
        "Duluth and Ely get grants. That is the complete list.",
        "Duluth and Ely get grants.",
    )
    # ...as does a re-scoped absence claim, which changes words without shortening.
    assert cli.guard_changed_content(
        "The bill does not name any counties.",
        "The passages searched do not name any counties.",
    )


def test_unrendered_markdown_counts_only_what_the_page_cannot_show():
    """The answer page strips **bold** and prints the rest verbatim — no renderer.

    So a heading reaches the reader as "### Eligibility", which reads as a typo.
    Inline emphasis and ordinary list lines are deliberately not counted: the
    emphasis is removed before display, and "1." or "- " reads fine as plain text.
    """
    from alethical.eval.answer_eval import unrendered_markdown

    assert unrendered_markdown("## Eligibility\nFirefighters qualify.")
    assert unrendered_markdown("The bill adds:\n> reasonable force may be used")
    assert unrendered_markdown("| City | Grant |\n| --- | --- |")
    # Not counted — these survive display intact.
    assert not unrendered_markdown("**Duluth** gets a grant.")
    assert not unrendered_markdown("- Duluth\n- Ely")
    assert not unrendered_markdown("1. Duluth\n2. Ely")
    # A hash mid-sentence is not a heading.
    assert not unrendered_markdown("The grant is #3 on the priority list.")
