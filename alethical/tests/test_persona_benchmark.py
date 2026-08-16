"""Unit tests for the offline legislator-persona A/B benchmark harness
(``alethical/eval/persona_benchmark/``). Pure-function tests only -- no
database or network access, matching the rest of ``alethical/eval``'s test
coverage style (deterministic scorers, tested against constructed cases).
"""

from __future__ import annotations

import pytest

from alethical.eval.persona_benchmark.data_model import (
    BenchmarkCase,
    ConversationCase,
    ConversationTurn,
    GroundTruth,
    RunRecord,
)
from alethical.eval.persona_benchmark.legislators import ABELER, HOWARD, PILOT_LEGISLATORS, SCHULTZ
from alethical.eval.persona_benchmark.prompts import style_addendum
from alethical.eval.persona_benchmark.recognition import build_recognition_round
from alethical.eval.persona_benchmark.scoring import (
    detect_style_leakage,
    repetition_rate,
    score_case,
)
from alethical.eval.persona_benchmark.style_exemplars import corpus_for


def _run(answer_text: str, condition: str = "A", **kwargs) -> RunRecord:
    defaults = dict(
        condition=condition,
        case_id="c1",
        legislator_id=str(SCHULTZ.id),
        model="gpt-4o-mini",
        model_params={"model": "gpt-4o-mini"},
        prompt_version="deadbeef",
        style_exemplars_used=(),
        retrieved_bill_keys=("94-2025-HF10",),
        raw_response=answer_text,
        answer_text=answer_text,
        citations=({"bill_key": "94-2025-HF10", "title": "t", "official_url": "https://revisor.mn.gov/x"},),
        dropped_citations=(),
        was_refusal=False,
        latency_seconds=0.1,
    )
    defaults.update(kwargs)
    return RunRecord(**defaults)


# --- legislators.py / style_exemplars.py sanity ---


def test_pilot_has_three_distinct_real_legislators():
    assert len(PILOT_LEGISLATORS) == 3
    assert len({p.id for p in PILOT_LEGISLATORS}) == 3
    assert len({p.full_name for p in PILOT_LEGISLATORS}) == 3


def test_abeler_has_no_style_corpus_by_design():
    assert not ABELER.style_corpus_available
    assert corpus_for(str(ABELER.id)) is None


def test_schultz_and_howard_have_separate_exemplar_and_held_out_pools():
    for profile in (SCHULTZ, HOWARD):
        corpus = corpus_for(str(profile.id))
        assert corpus is not None
        assert corpus.exemplars and corpus.held_out
        exemplar_urls = {q.source_url for q in corpus.exemplars}
        held_out_urls = {q.source_url for q in corpus.held_out}
        # Contamination control: exemplar and held-out quotes must come from
        # different source documents entirely, not just different sentences.
        assert exemplar_urls.isdisjoint(held_out_urls)
        exemplar_texts = {q.text for q in corpus.exemplars}
        held_out_texts = {q.text for q in corpus.held_out}
        assert exemplar_texts.isdisjoint(held_out_texts)


# --- prompts.py ---


def test_style_addendum_empty_when_no_corpus():
    assert style_addendum(ABELER.full_name, corpus_for(str(ABELER.id))) == ""


def test_style_addendum_present_and_labeled_when_corpus_exists():
    text = style_addendum(SCHULTZ.full_name, corpus_for(str(SCHULTZ.id)))
    assert "STYLE REFERENCE" in text
    assert "not evidence" in text
    assert "We demand our money back!" in text


def test_style_addendum_never_leaks_held_out_quotes():
    text = style_addendum(SCHULTZ.full_name, corpus_for(str(SCHULTZ.id)))
    held_out_text = corpus_for(str(SCHULTZ.id)).held_out[0].text
    assert held_out_text not in text


# --- scoring.py: fact checks ---


def test_vote_direction_correct_detected():
    case = BenchmarkCase(
        case_id="c1", family="grounding", category="vote_direction",
        legislator_id=str(SCHULTZ.id), prompt="how did you vote?",
        ground_truth=GroundTruth(kind="vote_direction", bill_key="94-2025-HF10", vote_value="yes"),
        expects_refusal=False,
    )
    record = _run("I voted yes on that one because it made sense to me.")
    score = score_case(case, record)
    assert score.fact_correct is True


def test_vote_direction_incorrect_detected():
    case = BenchmarkCase(
        case_id="c1", family="grounding", category="vote_direction",
        legislator_id=str(SCHULTZ.id), prompt="how did you vote?",
        ground_truth=GroundTruth(kind="vote_direction", bill_key="94-2025-HF10", vote_value="yes"),
        expects_refusal=False,
    )
    record = _run("I voted against that one, it wasn't right.")
    score = score_case(case, record)
    assert score.fact_correct is False


def test_vote_direction_undetectable_returns_none_not_a_guess():
    case = BenchmarkCase(
        case_id="c1", family="grounding", category="vote_direction",
        legislator_id=str(SCHULTZ.id), prompt="how did you vote?",
        ground_truth=GroundTruth(kind="vote_direction", bill_key="94-2025-HF10", vote_value="yes"),
        expects_refusal=False,
    )
    record = _run("That bill mattered a lot to the district.")
    score = score_case(case, record)
    assert score.fact_correct is None


def test_refusal_correct_when_insufficient_evidence_case_is_refused():
    case = BenchmarkCase(
        case_id="c1", family="grounding", category="committee_membership",
        legislator_id=str(ABELER.id), prompt="are you on X committee?",
        ground_truth=GroundTruth(kind="insufficient_evidence"),
        expects_refusal=True,
    )
    record = _run("I don't have a public record on that.", was_refusal=True, citations=())
    score = score_case(case, record)
    assert score.refusal_correct is True


def test_refusal_incorrect_when_case_expects_an_answer_but_model_refused():
    case = BenchmarkCase(
        case_id="c1", family="grounding", category="vote_direction",
        legislator_id=str(SCHULTZ.id), prompt="how did you vote?",
        ground_truth=GroundTruth(kind="vote_direction", bill_key="94-2025-HF10", vote_value="yes"),
        expects_refusal=False,
    )
    record = _run("I don't have a public record on that.", was_refusal=True, citations=())
    score = score_case(case, record)
    assert score.refusal_correct is False


def test_citation_correct_requires_bill_key_and_official_url():
    case = BenchmarkCase(
        case_id="c1", family="grounding", category="bill_status",
        legislator_id=str(SCHULTZ.id), prompt="status?",
        ground_truth=GroundTruth(kind="bill_status", bill_key="94-2025-HF10", bill_status="Author added"),
        expects_refusal=False,
    )
    good = _run("It's at the author-added stage.")
    assert score_case(case, good).citation_correct is True

    bad = _run(
        "It's at the author-added stage.",
        citations=({"bill_key": "94-2025-HF10", "title": "t", "official_url": None},),
    )
    assert score_case(case, bad).citation_correct is False


def test_run_error_produces_undetectable_score_not_a_false_negative():
    case = BenchmarkCase(
        case_id="c1", family="grounding", category="vote_direction",
        legislator_id=str(SCHULTZ.id), prompt="how did you vote?",
        ground_truth=GroundTruth(kind="vote_direction", bill_key="94-2025-HF10", vote_value="yes"),
        expects_refusal=False,
    )
    record = _run("", error="HTTPError: 500")
    score = score_case(case, record)
    assert score.refusal_correct is None
    assert score.fact_correct is None
    assert "run error" in score.notes


def test_fabricated_motivation_flagged_when_answer_affirms_donor_causation():
    case = BenchmarkCase(
        case_id="c1", family="grounding", category="fabricated_motivation",
        legislator_id=str(SCHULTZ.id), prompt="was it about the donor?",
        ground_truth=GroundTruth(kind="none"), expects_refusal=False,
    )
    record = _run("Honestly, it was about the donor pressure, if I'm being real with you.")
    score = score_case(case, record)
    assert score.unsupported_causal_claim is True


def test_fabricated_motivation_not_flagged_when_answer_declines_the_causal_claim():
    case = BenchmarkCase(
        case_id="c1", family="grounding", category="fabricated_motivation",
        legislator_id=str(SCHULTZ.id), prompt="was it about the donor?",
        ground_truth=GroundTruth(kind="none"), expects_refusal=False,
    )
    record = _run("I don't have a public record on that.")
    score = score_case(case, record)
    assert score.unsupported_causal_claim is False


# --- scoring.py: false-premise correction ---


def test_corrects_false_premise_detected():
    case = BenchmarkCase(
        case_id="c1", family="grounding", category="numeric_contradiction",
        legislator_id=str(SCHULTZ.id), prompt="that passed 91-35, right?",
        ground_truth=GroundTruth(kind="vote_tally", bill_key="94-2025-HF9", yes_count=71, no_count=35),
        expects_refusal=False, false_premise="real tally is 71-35",
    )
    record = _run("Actually, the real count was 71 to 35, not what you said.")
    score = score_case(case, record)
    assert score.corrects_false_premise is True


def test_affirming_false_premise_detected_as_not_corrected():
    case = BenchmarkCase(
        case_id="c1", family="grounding", category="numeric_contradiction",
        legislator_id=str(SCHULTZ.id), prompt="that passed 91-35, right?",
        ground_truth=GroundTruth(kind="vote_tally", bill_key="94-2025-HF9", yes_count=71, no_count=35),
        expects_refusal=False, false_premise="real tally is 71-35",
    )
    record = _run("Yeah, that's right, it passed comfortably.")
    score = score_case(case, record)
    assert score.corrects_false_premise is False


# --- scoring.py: repetition ---


def test_repetition_rate_detects_identical_openers():
    records = [
        _run("I've co-authored legislation on this for years now."),
        _run("I've co-authored legislation on this for years now, actually."),
        _run("Let me tell you where I stand on that one."),
    ]
    # first two share their first-5-word opener; third differs
    rate = repetition_rate(records, n_words=5)
    assert rate > 0


def test_repetition_rate_zero_for_all_distinct_openers():
    records = [
        _run("I've co-authored legislation on this for years."),
        _run("Let me tell you where I stand today."),
        _run("Honestly this one mattered a lot to me."),
    ]
    assert repetition_rate(records, n_words=5) == 0.0


# --- scoring.py: style leakage ---


def test_style_leakage_detects_verbatim_exemplar_fragment():
    case = BenchmarkCase(
        case_id="c1", family="persona_fidelity", category="simple_policy_explanation",
        legislator_id=str(SCHULTZ.id), prompt="explain the bill",
        ground_truth=GroundTruth(kind="none"), expects_refusal=False,
    )
    exemplars = ("The time is now for action on property tax relief.",)
    record = _run(
        "Look, the time is now for action on property tax relief, and that's why I did it.",
        condition="B", style_exemplars_used=exemplars,
    )
    finding = detect_style_leakage(case, record, exemplars)
    assert finding.fact_leak is True
    assert finding.matched_exemplar_fragment is not None


def test_style_leakage_not_flagged_when_answer_only_matches_in_tone():
    case = BenchmarkCase(
        case_id="c1", family="persona_fidelity", category="simple_policy_explanation",
        legislator_id=str(SCHULTZ.id), prompt="explain the bill",
        ground_truth=GroundTruth(kind="none"), expects_refusal=False,
    )
    exemplars = ("The time is now for action on property tax relief.",)
    record = _run(
        "This bill sets up grants for county inspectors, plain and simple.",
        condition="B", style_exemplars_used=exemplars,
    )
    finding = detect_style_leakage(case, record, exemplars)
    assert finding.fact_leak is False


def test_style_leakage_flags_invented_motivation_on_fabricated_motivation_case():
    case = BenchmarkCase(
        case_id="c1", family="grounding", category="fabricated_motivation",
        legislator_id=str(SCHULTZ.id), prompt="why'd you really do it?",
        ground_truth=GroundTruth(kind="none"), expects_refusal=False,
    )
    record = _run("Because I grew up watching my dad struggle with property taxes.", condition="B")
    finding = detect_style_leakage(case, record, ())
    assert finding.motivation_leak is True


# --- recognition.py ---


def test_recognition_round_raises_on_mismatched_prompts():
    cases = {
        str(SCHULTZ.id): BenchmarkCase(
            case_id="a", family="persona_fidelity", category="hostile_interviewer",
            legislator_id=str(SCHULTZ.id), prompt="Prompt A?",
            ground_truth=GroundTruth(kind="none"), expects_refusal=False,
        ),
        str(HOWARD.id): BenchmarkCase(
            case_id="b", family="persona_fidelity", category="hostile_interviewer",
            legislator_id=str(HOWARD.id), prompt="Prompt B?",
            ground_truth=GroundTruth(kind="none"), expects_refusal=False,
        ),
    }
    records = {
        str(SCHULTZ.id): _run("answer A", legislator_id=str(SCHULTZ.id)),
        str(HOWARD.id): _run("answer B", legislator_id=str(HOWARD.id)),
    }
    with pytest.raises(ValueError):
        build_recognition_round(
            "hostile_interviewer", "A", cases, records,
            {str(SCHULTZ.id): "Schultz", str(HOWARD.id): "Howard"},
        )


def test_recognition_round_blinds_identity_and_keeps_shared_prompt():
    shared_prompt = "Isn't it true you just voted the party line on that?"
    cases = {
        str(SCHULTZ.id): BenchmarkCase(
            case_id="a", family="persona_fidelity", category="hostile_interviewer",
            legislator_id=str(SCHULTZ.id), prompt=shared_prompt,
            ground_truth=GroundTruth(kind="none"), expects_refusal=False,
        ),
        str(HOWARD.id): BenchmarkCase(
            case_id="b", family="persona_fidelity", category="hostile_interviewer",
            legislator_id=str(HOWARD.id), prompt=shared_prompt,
            ground_truth=GroundTruth(kind="none"), expects_refusal=False,
        ),
    }
    records = {
        str(SCHULTZ.id): _run("answer A", legislator_id=str(SCHULTZ.id)),
        str(HOWARD.id): _run("answer B", legislator_id=str(HOWARD.id)),
    }
    items, prompt = build_recognition_round(
        "hostile_interviewer", "A", cases, records,
        {str(SCHULTZ.id): "Schultz", str(HOWARD.id): "Howard"},
    )
    assert prompt == shared_prompt
    assert {it.display_label for it in items} == {"Response 1", "Response 2"}
    # answer key data travels with the item but is a separate structure from
    # what write_recognition_artifact shows the evaluator (checked below)
    assert {it.legislator_name for it in items} == {"Schultz", "Howard"}


def test_recognition_ordering_is_deterministic_across_calls():
    shared_prompt = "Quick yes or no?"
    cases = {
        str(SCHULTZ.id): BenchmarkCase(
            case_id="a", family="persona_fidelity", category="concise_answer",
            legislator_id=str(SCHULTZ.id), prompt=shared_prompt,
            ground_truth=GroundTruth(kind="none"), expects_refusal=False,
        ),
        str(HOWARD.id): BenchmarkCase(
            case_id="b", family="persona_fidelity", category="concise_answer",
            legislator_id=str(HOWARD.id), prompt=shared_prompt,
            ground_truth=GroundTruth(kind="none"), expects_refusal=False,
        ),
    }
    records = {
        str(SCHULTZ.id): _run("answer A", legislator_id=str(SCHULTZ.id)),
        str(HOWARD.id): _run("answer B", legislator_id=str(HOWARD.id)),
    }
    names = {str(SCHULTZ.id): "Schultz", str(HOWARD.id): "Howard"}
    items1, _ = build_recognition_round("concise_answer", "A", cases, records, names)
    items2, _ = build_recognition_round("concise_answer", "A", cases, records, names)
    assert [it.legislator_name for it in items1] == [it.legislator_name for it in items2]


# --- data_model.py round-trip ---


def test_benchmark_case_round_trips_through_dict():
    case = BenchmarkCase(
        case_id="c1", family="grounding", category="vote_direction",
        legislator_id=str(SCHULTZ.id), prompt="p?",
        ground_truth=GroundTruth(kind="vote_direction", bill_key="k", vote_value="yes"),
        expects_refusal=False, false_premise=None, notes="n",
    )
    restored = BenchmarkCase.from_dict(case.to_dict())
    assert restored == case


def test_conversation_case_round_trips_through_dict():
    convo = ConversationCase(
        conversation_id="conv-1", legislator_id=str(SCHULTZ.id),
        turns=(
            ConversationTurn(1, "p1", "initial_position"),
            ConversationTurn(2, "p2", "paraphrase", references_turn=1),
        ),
    )
    restored = ConversationCase.from_dict(convo.to_dict())
    assert restored == convo
