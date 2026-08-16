# Persona benchmark pilot -- A/B report

**Mode: `mock`.** No `OPENAI_API_KEY` was available when this ran, so every answer below came from the harness's deterministic mock responder, not a real model. This report demonstrates the pipeline works end to end -- dataset loading, retrieval, prompt composition (A vs B), citation verification, scoring, and leakage detection. **None of the numbers below say anything about the real persona's quality.** Re-run with a real key to get results that do.

## 1. Grounding
- Condition A: refusal-correct {'n': 30, 'rate': 0.8, 'undetectable': 0}, fact-correct {'n': 3, 'rate': 0.0, 'undetectable': 27}, citation-correct {'n': 30, 'rate': 1.0, 'undetectable': 0}, false-premise-corrected {'n': 0, 'rate': None}, unsupported-causal-claims 0, run errors 0 / 30
- Condition B: refusal-correct {'n': 30, 'rate': 0.8, 'undetectable': 0}, fact-correct {'n': 3, 'rate': 0.0, 'undetectable': 27}, citation-correct {'n': 30, 'rate': 1.0, 'undetectable': 0}, false-premise-corrected {'n': 0, 'rate': None}, unsupported-causal-claims 0, run errors 0 / 30

## 2. Persona fidelity
Not scored here -- linguistic/style fidelity and political-position fidelity both require comparing against held-out real quotes and human judgment. See `cases/recognition_blinded.json` for the blinded artifact; this report does not pre-judge its outcome.

## 3. Human-likeness
Automatic signals only (repetition, response length); naturalness and engagingness require human/LLM-judge evaluation, not run here.
- Condition A repetition rate: 1.0
  - da8ee5cc-0f9d-4854-b5bc-1b0fd8307f78: mean response length 27.5 words (n=10)
  - 498f83f6-5b27-4bab-9b26-464719a46606: mean response length 24.1 words (n=10)
  - d40983e1-b739-4d1f-853c-8473e6df38c7: mean response length 24.1 words (n=10)
- Condition B repetition rate: 1.0
  - da8ee5cc-0f9d-4854-b5bc-1b0fd8307f78: mean response length 27.5 words (n=10)
  - 498f83f6-5b27-4bab-9b26-464719a46606: mean response length 24.1 words (n=10)
  - d40983e1-b739-4d1f-853c-8473e6df38c7: mean response length 24.1 words (n=10)

## 4. Interactive consistency
3 six-turn conversations run per condition. Position/factual/persona drift across turns requires the same human/LLM-judge pass as persona fidelity above (PICon/MREval-style adversarial interrogation) -- not scored automatically here beyond refusal/citation checks per turn.

## 5. Style leakage (Variant B only)
- n=30, fact-leak rate=0.0, motivation-leak rate=0.0

## Decision rule reminder
Variant B is worth expanding only if a completed blinded evaluation shows a meaningful recognizability/naturalness improvement **without** degrading grounding, citation correctness, or refusal accuracy above, and without the style-leakage rates above rising. This report does not itself render that verdict.