# Legislator persona A/B benchmark

Offline evaluation infrastructure comparing PR #397's persona-chat behavior
(Condition A) against the same behavior plus a real first-person style
exemplar block (Condition B). See `docs/research/persona/` and the design
discussion this package implements for the full rationale; this file is the
"how to run it," not the "why."

**Isolation guarantee.** Nothing in this directory is imported by, or
modifies, `alethical/api/routers/legislator_chat.py` or any other production
file. It imports that module's real functions and calls them, the same
relationship `alethical/eval/answer_eval.py` has to `alethical/api/routers/me.py`.

## Setup

Needs the local Postgres instance the rest of the repo's tests use
(`docker-compose.yml`), and `OPENAI_API_KEY` set for a live run (mock mode
needs no key).

## 1. Regenerate the case set (only if the local fixture data changes)

```bash
DATABASE_URL=postgresql+psycopg://alethical:alethical@localhost:54329/alethical \
    python -m alethical.eval.persona_benchmark.build_dataset
```

Writes `cases/{isaac-schultz,michael-howard,jim-abeler}.json` (10 single-turn
cases each) and `cases/conversations.json` (1 six-turn conversation each).
Every fact a case checks is read live from the database at generation time —
see `build_dataset.py`'s docstring for how categories degrade to an
`insufficient_evidence` case rather than a fabricated fact when a
legislator's real record has nothing for that category.

## 2. Run the pilot

```bash
# No API key needed -- exercises the full harness with a deterministic mock
# responder. Every result is labeled as such; none of it is a real-model finding.
DATABASE_URL=postgresql+psycopg://alethical:alethical@localhost:54329/alethical \
    python -m alethical.eval.persona_benchmark.run_pilot --mode mock

# Real run, once OPENAI_API_KEY is set to a valid key:
OPENAI_API_KEY=sk-... DATABASE_URL=postgresql+psycopg://alethical:alethical@localhost:54329/alethical \
    python -m alethical.eval.persona_benchmark.run_pilot --mode live
```

Writes to `results/`:

- `run_records.json` -- every model call's full metadata (condition,
  legislator, case, model, params, prompt version, retrieved bill keys, style
  exemplars used, raw response, citations, refusal flag, latency, tokens).
- `results.json` -- machine-readable aggregate, five dimensions kept separate.
- `report.md` -- the human-readable version of the same.
- `recognition_blinded.json` / `recognition_answer_key.json` -- the blinded
  recognition-task artifact (see below) and its separate answer key.

## 3. The blinded recognition task

`recognition_blinded.json` shows a human evaluator the same prompt answered
by all three legislators, labeled only "Response 1/2/3," and asks which
legislator produced each one, how characteristic it feels (1-5), and whether
it reads as natural or as an exaggerated caricature. `recognition_answer_key.json`
holds the real mapping, kept in a separate file so scoring this artifact stays
a genuinely blind exercise for whoever does it.

## What still needs a human

`scoring.py`'s deterministic checks cover grounding facts (vote direction,
sponsorship role, committee membership, bill status, citation resolution,
refusal correctness) and a few mechanical human-likeness signals (repetition,
response length). Linguistic/style fidelity, naturalness, engagingness,
rhetorical distinctiveness, and persona/position drift across a conversation
all require the blinded human (or LLM-judge) pass this package sets up but
does not itself perform -- `report.py` says this explicitly rather than
inventing a number for them.
