# The Answer Quality Bar — what makes a generated answer good enough to ship

<!-- describes: alethical/eval/answer_eval.py, alethical/eval/ground_truth.py, alethical/eval/fixtures/answer_questions.json, alethical/eval/fixtures/judge_calibration.json, scripts/answer_eval.py, alethical/api/routers/me.py, alethical/api/routers/ask.py -->

> **Net:** Every word of every AI answer a reader sees is written by one model, and
> until now we had no way to say whether a different model would write better ones.
> This document defines "good enough" concretely enough to score, so "upgrade the
> model" becomes a measurement instead of a hunch. The eval that implements it is
> `alethical/eval/answer_eval.py`, run by `scripts/answer_eval.py`. Filed as
> [#865](https://github.com/alethical-org/alethical/issues/865).
>
> **Where to start reading.** §3 is the bar. §12 is the current answer and the
> recommendation ([#878](https://github.com/alethical-org/alethical/issues/878));
> §11 is why its middle rows can be believed and §10's could not. §10 is the
> earlier run, kept as a control because it was measured against a prompt and a
> retrieval shape production no longer uses.

## 1. What is being measured, and what is deliberately not

One function writes the prose for **both** places a reader meets a generated
answer: `synthesize_grounded_answer` (`alethical/api/routers/me.py`) serves the Ask
answer page (`alethical/api/routers/ask.py`) and the signed-in bill-scoped chat. So
one model choice moves both surfaces, and one eval covers both.

That function takes a question plus already-retrieved bill passages and returns
prose. **How many passages is production's business, not a constant here** — since
[#868](https://github.com/alethical-org/alethical/issues/868) `ask.py` reads the
question first, giving an enumerate-everything question as much of the bill as a
20,000-word budget allows and a specific question the fixed four. The snapshot
calls `ask.py`'s own `_retrieve_bill_text` rather than restating that rule, so
retrieval is guarded by import the same way the prompt is (§11 records the run
where it was not, and what that cost).

**The passages are the input, not the thing being tested.** The eval freezes them:
one snapshot of production's retrieval is taken once, committed to
`alethical/eval/fixtures/answer_contexts.json`, and every candidate model is asked
to write from the identical passages. Three consequences, all intended:

- A score difference is the writer's. No model can win by getting a luckier search.
- The embeddings are untouched, which is what
  [#400](https://github.com/alethical-org/alethical/issues/400) requires — retrieval
  quality is that issue's ground, and the decision to keep the current embeddings
  stands. This is about the words written *from* what retrieval already found.
- The bill is pinned per question, so the question router
  (`alethical/api/services/ask_router.py`) is out of scope too. It is a separate
  model choice; §7 answers whether it should be the same one.

This is the same method the retrieval eval already uses for its own head-to-head:
`scripts/retrieval_eval.py head2head` compares embedding models over *identical*
exact-kNN retrieval so the comparison isolates one variable. This eval is that
idea pointed at the other half of the pipeline.

## 2. Why a bar has to exist before a comparison

A model comparison with no bar produces a preference, and a preference cannot be
checked, reproduced, or disagreed with on evidence. Worse, it hides the failure that
actually matters. Ask five people to rank answers and they will rank on fluency,
because fluency is what reading rewards — and a fluent answer that has drifted off
the cited passages is the single worst thing this product can ship
(`.claude/rules/grounded-answers.md` rule 1). A bar that scores fluency and
faithfulness separately, and lets faithfulness veto, is the only kind worth having.

## 3. The bar

Two **gates**, pass or fail. A gate failure sets the answer's score to **zero**. It
is not a deduction and it is never averaged against good writing.

| Gate | Fails when |
|---|---|
| **`grounded`** | A factual claim is not supported by the four passages the model was shown — **and both judges agree it isn't**. One invented number, name, date, or effect is enough to fail, but one *judge's* objection is not. |
| **`refusal_correct`** | The answer declines on a question the passages *do* answer, **or** answers one they do not. Both directions are failures. Whether an answer declines is a judge's whole-answer call, not a pattern match. |
| **`honest_about_partial_reading`** | The passages are a *sample* of a longer bill, and the answer either presents a list or count as the complete set, or denies that something exists. Passes trivially when the whole bill was in context. |

### The third gate, and why the first two could not catch the worst failure we ship

Asked *"which cities and counties get named infrastructure grants?"* about HF 719,
production answers **nineteen cities**, names them as though that were the set, and
says **no counties are named**. Counted from the bill's own 48 sections, it names at
least **98 cities** and at least **17 counties**
([`alethical/eval/ground_truth.py`](../../alethical/eval/ground_truth.py),
[#868](https://github.com/alethical-org/alethical/issues/868)).

**Every trust signal we have passes that answer.** The citations are real. The
passages genuinely say what the answer says. Cite-or-refuse is satisfied. The prose
is clean, plain and stage-correct. It scores well on all four graded dimensions. The
answer is wrong because the writer was handed **4 of the bill's 102 passages** —
about 900 words of 15,430 — with nothing marking them as a sample, and then told to
answer from the provided text.

So the gate scores the one thing a model *can* control here. It cannot know what it
was not shown, but it can decline to claim a completeness it has no basis for. Two
failures, either of which is disqualifying:

- **Claiming completeness** — a list, set or count presented as the answer when only
  part of the bill was read. "The bill names 19 cities: ..." is true of the passages
  and false of the bill.
- **Asserting absence** — "the bill does not name any counties" from 4 of 102
  passages is absence of evidence sold as evidence of absence.

Saying the same things about *the passages* ("the sections I can see name, among
others, ...") is fine, and is what a correct answer does.

**This is a gate rather than a graded dimension because grading it softer would let
that answer average its way to a pass.** It is good on everything else; a one-point
deduction on a fifth dimension would not stop it shipping.

**It passes trivially when the whole bill was in context.** A complete list *is*
complete when every section was read, and an absence *is* an absence. The gate only
bites on the long bills where the passages are a sample.

How much of the bill the writer saw is **derived from the snapshot, not
hand-labeled**, so it stays correct when the passage budget changes.

> **And after #868 it passes trivially on the very question it was written for.**
> An enumerate-everything question now reads the whole bill where it fits, and HF
> 719 fits: all 102 passages, 16,894 words. Partial reads across the fixture fell
> from 10 of 20 questions to 6, and HF 719's grants question is no longer one of
> them. That is the fix working — and it moved the failure rather than ending it.
> Reading everything is not reporting everything: handed all 98 city names,
> candidates report between 19 and 95 of them, and **no gate in this section can
> tell those apart**, because every gate here was written for the partial-read
> failure. §12 measures the gap as enumeration recall and treats it as a decisive
> number rather than a scored one, on the grounds that one fixture question cannot
> responsibly carry a fourth gate.

**A caution I earned the hard way.** My first version of this fixture's HF 719 label
said the passages "name only cities, not counties, so an answer that claims counties
receive grants is overreaching." That is true of the four passages and false of the
bill — I wrote the product's own bug into the test for the product's bug, because I
labeled against what the model sees instead of against the source. Anything scoring
completeness has to be labeled from the **whole bill**, and the eval now checks
against a count taken from it.

### Two rules that changed after the first real run, and why

Both of the original rules made the eval unable to tell models apart. Recording
the correction here because the reasoning matters more than the rule:

**The refusal gate used to be a regular expression, and it was wrong.** The
production prompt instructs the model to "answer the supported part and say what is
not covered", so a *good* answer routinely closes with a caveat: *"...the bill does
not specify how often the training must be repeated."* A pattern cannot tell that
sentence apart from a whole answer that declines. It fired on four of gpt-4o-mini's
best answers and scored them as refusals. Whether an answer declines is a property
of the answer as a whole, so a judge decides it and the pattern is kept — renamed
`mentions_missing_coverage` — as an independently reported signal. A single judge
calling it a refusal is enough: declining is visible and judges agree on it readily,
and the cautious read of a split is that the answer did not answer.

**The grounding gate used to fail an answer if *either* judge objected.** The
reasoning was that a disputed answer is not a safe answer. Measurement killed it:
the two judges split on grounding for **3 to 8 of 20 answers per model**, so the
union of their objections measured whichever judge was stricter, not the model — and
all six candidates failed. An objection now has to survive the second judge to
count. Disputed calls are not forgiven, they are **counted and printed** as
`disputed`, so a model with many disputes reads as less certainly grounded than one
with none. This is the same standard the repo applies to its own findings: a claim
counts when it survives an independent check.

Four **graded** dimensions, scored **0 / 1 / 2** each — 8 points total — and only on
answers that clear both gates:

| Dimension | 2 points | 0 points |
|---|---|---|
| **`covers`** | Carries every fact the human answer key requires (a paraphrase counts) | Carries none of them |
| **`addresses`** | Answers the question that was asked | Summarizes the bill instead |
| **`framing`** | Speaks in the right stage — an enacted law *requires*, a pending bill *would require* | Consistently states a proposal as law, or a law as a proposal |
| **`plain`** | A resident with no legal training follows it on one read | Legalese, dumped statute citations, or a bill-number preamble |

**An answer ships** if it clears both gates and scores **≥ 6 of 8**. Six is the
point where no single dimension is worse than "partly" on average; five would admit
an answer that is weak on half of what we claim to care about at once.

**A model clears the bar** when all four of these hold:

1. **Zero gate failures** across the fixture.
2. **≥ 90% of answers ship-worthy** (18 of 20).
3. **p50 total generation ≤ 5 s**, **p95 ≤ 9 s**.
4. It wins under **both** judges, not just one (§5).

### Why those numbers

**Zero gate failures, not a high pass rate.** The gates encode `grounded-answers`
rules 1 and 3 — cite or refuse, and describe records rather than inferred positions.
A product whose promise is "it tells you when it doesn't know" cannot ship a model
that guessed once in twenty. On a fixture this small, one failure is not noise; it
is proof the failure mode exists.

**90%, not 100%, on the graded score.** Two of the four graded dimensions are
judgments about readability, where reasonable readers differ by a point. Demanding
20 of 20 would fit the fixture rather than the product, and would reward a model
that happened to match the judges' taste. 18 of 20 leaves room for two mediocre
answers and no more.

**5 s and 9 s, from the product's own constraint.** [#865](https://github.com/alethical-org/alethical/issues/865)
sets the terms: an answer that takes 12 seconds is worse than a slightly duller one
in 3. So the bar sits between them and closer to the good end. Note *total*, not
time-to-first-word — see §4.

**Weigh p50 more heavily than p95, because at twenty questions p95 is one
observation.** The 95th percentile of a 20-item fixture is the 19th-slowest answer —
a single request, and therefore as much a measurement of one moment's network and
queue conditions as of the model. A p50 failure is a property of the model; a p95
failure driven by one outlier is a prompt to re-run rather than a verdict. The eval
prints both and `meets_bar()` requires both, so a p95 breach fails a candidate — but
read a marginal one as "measure again", not "disqualified". Tightening this properly
means more samples per question, which is a cheap follow-up if latency ever decides
a close call.

## 4. Speed is measured as total time, because nothing streams

`synthesize_grounded_answer` makes a blocking, non-streaming HTTP request and
returns the finished string; `_bill_text_answer` then returns the whole
`AskBillTextAnswer` at once. **There is no path today by which a reader sees a first
word before the last one is written.** Time-to-first-token is therefore not a
product metric here — it is a metric of a product we could build, not the one we
ship. The eval records both and scores against total time.

Two things follow, and they are worth stating because they cut against instinct:

- **A verbose model is slower for the reader in proportion to how much it writes.**
  Output length is a latency cost, not just a token cost.
- **Streaming is the change that would make time-to-first-word matter.** If we ever
  stream the answer page, the latency half of this bar should be re-derived, and a
  model that thinks before writing becomes viable in a way it is not today.

### The reasoning trap, and why it is a candidate's identity rather than a default

Every current frontier model reasons before answering unless told not to, and on
both providers the *naive* call is the slow one:

- **Claude Sonnet 5** runs adaptive thinking whenever the `thinking` parameter is
  omitted. The eval sends `thinking: {"type": "disabled"}` with effort `low`
  (disabling is allowed at effort `high` or below).
- **OpenAI's gpt-5 family** reasons at its default effort. The eval sends
  `reasoning: {"effort": "minimal"}`. (`"none"` is rejected — the accepted values
  are `minimal`, `low`, `medium`, `high`.)

Writing three sentences from four passages already in front of the model is not a
reasoning task, so the fast configuration is the one we would actually ship — and it
is the eval's default. But **the same model reasoning or not is two different
products to a waiting reader**, so depth is part of the candidate's name rather than
a hidden default: a `+deep` suffix on any candidate spec measures the naive call, and
gets its own row in the report. That keeps the comparison fair across providers
(neither family is penalised for a default the other was spared) and makes the cost
of insisting on speed visible instead of assumed.

Judging is genuinely a reasoning task and no reader is waiting on it, so the judges
keep thinking on.

## 5. How an answer gets scored, and what stops the grader flattering the model

Both, deliberately: mechanical checks where a machine can be certain, a model judge
where only judgment will do.

**Mechanical, no judge involved** — these cannot be flattered, so they are the
floor the judged scores sit on:

- refusal detection, by pattern, in both directions;
- bill-code preamble at the start of an answer (rule 9);
- raw statute citations, with `Section 8` (a housing program) and `section 179` (a
  federal tax provision) deliberately *not* counted — rule 9 records both as cases a
  blunter pattern got wrong;
- literal coverage of each labeled fact's accepted wordings;
- latency, token counts, and cost.

**Human labels, written before any model was run.** Every fixture question carries
an answer key written by reading the snapshotted passages: the facts a correct
answer must carry, what it must not claim, whether the passages answer the question
at all, and why the label was assigned. Same convention as
`fixtures/retrieval_queries.json` — *"labels assigned by human reading, never by
vector search"* — because a fixture derived from what some model already says can
only ever confirm that model.

**A model judge, anchored to those labels.** The judge is asked "does this answer
carry fact X from the key?", not "is this a good answer?". It sees the passages, the
question, and the key; it never sees which model wrote the answer.

Four defenses against a judge flattering its own family, in increasing order of how
much work they do:

1. **The judge is blind.** Answers arrive anonymized, and the run order is shuffled
   with a fixed seed so a judge cannot infer authorship from a predictable sequence.
2. **The judge grades against the key, not against taste.** Most of the judgment is
   reduced to checking labeled facts and stage-correct verbs.
3. **There are two judges, one from each provider in the candidate set**
   (`claude-sonnet-5` and `gpt-5.1`), and **every score is reported per judge as
   well as pooled.** A candidate that wins under one judge and loses under the other
   has not won.
4. **The disagreement between them is measured and published** — mean and maximum
   score gap, exact-agreement rate, and how often they split on the grounding gate
   (`judge_disagreement()`). If a judge is favouring its own family, that shows up
   as a systematic gap rather than being assumed away. If the two judges disagree
   more than the models differ, the comparison is not conclusive and the honest
   report says so.
5. **The grounding gate requires both judges to agree**, so no single judge can
   disqualify a rival's model on its own — the defence that actually binds, rather
   than the three above which only make bias visible.

**And the judges' output shape is constrained, not requested.** Asking for six keys
in prose does not reliably return six keys: on 14 of 120 pairs the Sonnet judge
returned a well-formed object that simply omitted `plain`, and did so on all three
retries, because it was a considered choice rather than a sampling accident. The
verdict schema is now enforced on the request (`json_schema`, every dimension
required and restricted to 0/1/2), which is the difference between a run that
completes and a run that dies two-thirds of the way through having already been paid
for.

The residual limitation, stated plainly: two judges cannot prove the absence of a
shared bias, only bound the disagreement between them. The mechanical checks and
human labels are what keep the result from resting on the judges alone.

**Two of the judge's own fields went undefined for the whole of the first run.**
The verdict schema required `claims_completeness` and `asserts_absence`, the code
decided the honesty gate from them, and the instructions never said what either
meant — so each judge invented a reading. That is the likeliest single cause of the
disagreement §10 could not explain, and it is the sort of gap five defences against
bias will not catch, because none of them checks that the grader was told what it
was grading. §11 records what fixing it did.

## 6. The fixture

Twenty questions over twelve real bills, in
`alethical/eval/fixtures/answer_questions.json`:

- **15 the passages answer**, **5 they do not** — because the refusal gate is
  half the bar and needs real cases, not a token one.
- **8 enacted laws, 7 pending proposals** — the framing dimension needs both.
- **Question shapes a reader actually types**: a list ("which cities get grants"), a
  lookup ("what is the program called now"), a two-part question ("what tax, and
  what would it pay for"), a definition, a penalty, an eligibility test.
- **The five unanswerable ones are baited.** Each has a nearby number or a
  same-named section that a careless model will reach for. The sharpest: asked what
  new highway signs would cost, SF 3899's passages include a section literally headed
  *SIGNAGE COSTS* (which covers two building renames and names no figure) and a
  separate `$86,000` appropriation (which funds a memorial state park working
  group). Answering `$86,000` is an ungrounded claim, not a near miss.
- **One severe framing trap.** SF 624's text reads *"This section is effective
  August 1, 2025"* — a date now past — but the bill never became law. An answer
  saying Minnesotans no longer have a duty to retreat is stating a proposal as law,
  which is exactly the failure `grounded-answers` rule 7 warns status-stale answers
  produce.
- **The quality gap from #865 is in it**: HF 719's named infrastructure grants,
  where the live answer is correct and flat.

Twenty scored carefully beats two hundred scored carelessly. Every fact in the key
is checked by CI to actually appear in the snapshotted passages
(`test_required_fact_aliases_actually_appear_in_the_snapshotted_passages`), so the
key can never ask for something the best possible model could only guess.

## 7. Should the question router use the same model?

**No, and they should be chosen separately.** They are different jobs:

| | Answer writer (`OPENAI_RAG_CHAT_MODEL`) | Question router (`OPENAI_ASK_ROUTER_MODEL`) |
|---|---|---|
| Output | Several sentences of prose a reader judges | One label from a fixed set |
| What "better" means | Faithful, plain, stage-correct writing | Picking the right bucket more often |
| Failure a reader sees | A wrong or unreadable answer | The wrong kind of answer page, or a needless refusal |
| Cost driver | Output tokens — it writes | Input tokens — it reads and emits a few |
| Measured by | This eval | Classification accuracy in `alethical/tests/test_api_contract.py` |

Because the router's output is a label, prose quality buys it nothing, and its cost
is dominated by input tokens, so a stronger model is *cheaper* to upgrade there than
here — but there is no evidence it needs upgrading, because nothing has measured its
accuracy against a labeled set of hard questions. Two separate settings already
exist, which is the right shape. **The router keeps `gpt-4o-mini` until someone
measures it**, and that measurement is its own piece of work, not a rider on this
one.

The same reasoning applies in reverse to `_resolve_bill_by_content`, which reads the
formal summary rather than the plain-language one, on purpose
(`.claude/rules/grounded-answers.md` rule 9). That step is eval-gated by retrieval
quality, not answer quality, and this eval leaves it alone.

## 8. Running it

```bash
ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run python scripts/answer_eval.py snapshot
```

Read-only against production, once, to freeze the retrieval contexts. Needs
`OPENAI_API_KEY` for the twenty query embeddings only.

```bash
PYTHONPATH=. uv run python scripts/answer_eval.py run --run-dir /tmp/answer-eval
```

Generates, judges, and prints the scorecards. Answers and verdicts cache per model
and per judge in the run directory, so adding a candidate re-pays only for that
candidate. Generation runs serially on purpose, because concurrent requests would
inflate the latency numbers the bar scores against; judging runs concurrently,
because nothing about a judge's latency is measured.

The seven-arm, two-judge run in §12 — 140 answers and 280 judgments, twice over —
cost about **$11** end to end and took about 50 minutes, of which generation was
~25. Passing `--judges ""` generates and stops, which is how the calibration below
gets answers to hand-score before any verdict exists:

```bash
PYTHONPATH=. uv run python scripts/answer_eval.py run --judges "" --run-dir /tmp/answer-eval
PYTHONPATH=. uv run python scripts/answer_eval.py calibrate --emit --run-dir /tmp/answer-eval
PYTHONPATH=. uv run python scripts/answer_eval.py calibrate --run-dir /tmp/answer-eval
```

`calibrate --emit` writes blind worksheets; scoring them by hand produces
`alethical/eval/fixtures/judge_calibration.json`; `calibrate` then measures each
judge against that key, per dimension.

**A cheaper path exists and was rejected on quality, not price.** Both providers
offer a batch API at roughly half list price, which would take the run to ~$6.
Generation cannot use it — wall-clock is a scored dimension, and a batched call
measures the queue rather than the model — and judging cannot usefully use it
either, because the judge prompt is what gets iterated on and a turnaround measured
in hours makes iteration impossible. Half of $11 is not worth a day per attempt.

## 9. Is the writer weak, or under-informed? The passage-budget arm

A candidate's **passage budget** is part of its identity: `gpt-4o-mini@16` is a
different candidate from `gpt-4o-mini`, scored on its own row against snapshots taken
at 8 and 16 passages alongside production's 4. This separates the two explanations
for a bad answer, which no amount of model comparison can tell apart on its own:
*the writer is weak* versus *the writer was not shown enough*.

> **Since #868, `@N` moves a smaller knob than it did here.** Production no longer
> has one budget: an enumerate-everything question reads up to 20,000 words, and
> only a *specific* question keeps the fixed four passages. So `@16` now widens 6
> of the 20 fixture questions rather than all of them, and the arm is kept in §12
> as a control rather than as a candidate. The question this section asks has also
> largely been answered — see §12's recall table, where the same model handed the
> whole bill still reports 19 of 98 names, which is as clean a "the writer is weak"
> result as this eval can produce.

The measurement that motivates it, counted on HF 719 while snapshotting:

| Passages given | Words seen | Cities visible | Counties visible |
|---|---|---|---|
| **4** (production today) | 870 | 13 | **0** |
| 8 | 1,762 | 20 | 4 |
| 16 | 3,500 | 49 | 6 |
| the whole bill | 15,430 | **98** | **17** |

Two conclusions, and the second is the important one:

1. **At today's budget not a single county is visible.** Production is not being
   careless when it says none are named — it is reporting the only thing it can see.
   That is a structural problem, and no stronger writer fixes it.
2. **Even 16 passages shows 6 of 17 counties and 49 of 98 cities.** Widening the
   window narrows the error without making a complete list possible. So a wider
   window is not an alternative to the honesty gate above; anything short of the
   whole bill still needs the answer to say it is looking at part of it.

The number worth having from the comparison is therefore whether **the incumbent
model at a wider budget beats a premium model at today's budget**. If it does, the
decision is about how much text we send, not which model we buy — and those cost very
different amounts.

## 10. Results, Jul 31 2026 (first run) — nine candidates on the same 20 questions

> **Read this section as the control, not the answer.** Every number in it was
> produced against production's **old prompt** (the eval sent only the first half)
> **and its old retrieval** (a flat four passages for every question). Both were
> fixed the same day, and §12 re-runs the comparison against what production
> actually sends. This section is kept unchanged, and deliberately not updated in
> place, because a baseline that moves is not a baseline — the two runs are only
> worth having if you can see what changed between them.
>
> Its central conclusion survives and is worth carrying forward: **more context did
> not stop models overclaiming.** What §12 adds is that a coverage rule in the
> prompt does.

Full run: 180 answers, 360 blind judgments, ~$13. Raw numbers in the run
directory's `report.json`; re-derive with the command in §8.

### The headline: no candidate clears the bar, and the reason is not the model

| Candidate | Score /8 | Ships | Gate fails | Overclaimed | p50 s | p95 s | $/answer | Bar |
|---|---|---|---|---|---|---|---|---|
| `gpt-4o-mini` (today) | 3.45 | 50% | 13 | 8/10 | **1.99** | 4.66 | **$0.00020** | fail |
| `gpt-5-mini` | 4.25 | 60% | 10 | 7/10 | 2.62 | **10.19** | $0.00060 | fail |
| `gpt-5.1` | 4.10 | 60% | 13 | 7/10 | 2.48 | 7.14 | $0.00291 | fail |
| `claude-haiku-4-5` | 3.20 | 45% | 16 | 10/10 | 2.37 | 4.30 | $0.00182 | fail |
| `claude-sonnet-5` | 4.20 | 60% | 12 | 8/10 | 3.22 | 7.20 | $0.00760 | fail |
| `gpt-5.1+deep` | 3.55 | 50% | 15 | 9/10 | 2.80 | 6.80 | $0.00291 | fail |
| `gpt-4o-mini@8` | 3.80 | 45% | 12 | 8/9 | 1.45 | 4.43 | — | fail |
| `gpt-4o-mini@16` | 4.65 | 65% | 9 | 4/5 | 2.16 | 5.24 | — | fail |
| `claude-haiku-4-5@16` | 5.50 | 75% | 7 | 4/5 | 2.59 | 4.56 | — | fail |

**Every arm fails, and they fail on the same thing.** Broken down by cause, the
gate failures are overwhelmingly [#868](https://github.com/alethical-org/alethical/issues/868)'s
structural problem rather than bad writing:

| Failure | Range across the nine arms |
|---|---|
| Presented a partial list or count as complete | **4 – 10** |
| Denied something exists, on a partial reading | **2 – 6** |
| Made a claim the passages do not support (both judges agreeing) | 0 – 3 |

Two arms — `claude-sonnet-5` and `gpt-5-mini` — produced **zero** unsupported
claims across all 20 questions. **All nine arms declined correctly on 5 of 5**
questions the passages do not cover, so cite-or-refuse is intact everywhere.
The failure is not that the models make things up. It is that they state a
partial reading as the whole truth.

### Widening the window does not fix it

The overclaim rate is **flat** across passage budgets: 80% at 4 passages, 89% at 8,
80% at 16. A wider window reduces *how many bills are partial* — at 16 passages only
5 of 20 questions still have a partial context — but on the bills that remain
partial, models overclaim just as often.

> **The scores above were produced against a prompt production no longer sends, and the re-run below must fix that first** ([#868](https://github.com/alethical-org/alethical/issues/868), Jul 31 2026). This eval imports `RAG_CHAT_SYSTEM_PROMPT` by identity so it can never score a drifted *copy* — a good guard, and #868 slipped past it, because the drift is not a copy but a **layer production adds on top**. Production now composes that constant with a coverage rule that forbids exactly the overclaiming this section measures: on a partial read it says *"NEVER state or imply that the bill omits … something"* and *"NEVER give a total, a count, or a list you call complete"*, and on either read *"NEVER tell the reader your list is complete."*
>
> So **the 80% / 89% / 80% figures are the overclaim rate of an unprompted model**, which is the right number for the question this section asks (does more context fix it?) and the wrong one for "what will a reader see." Call `rag_chat_system_prompt(coverage)` (`alethical/api/routers/me.py`) instead of the constant; the frozen contexts here are partial reads, so `rag_chat_system_prompt(None)` is the matching prompt. Left as this eval's change to make rather than done in #868, because moving a published baseline mid-decision is worse than a recorded gap.
>
> Two things this does **not** change. The conclusion still holds — the fix is a layout-owned note, not a wider window — and it now holds for a second, independent reason: #868 measured that reading **all 102** passages of HF 719 still produced 26–35 of its 98 cities. And the shipped product is not relying on the prompt anyway: both overclaim shapes are removed in the answer path, so a model that ignores the instruction still cannot reach a reader (`.claude/rules/grounded-answers.md` rule 11).

`gpt-4o-mini@16` is the clearest demonstration. Given four times the text it
produced a **longer** list (28 items, up from 17) with a **stronger** completeness
claim, closing "this list includes both city and county grants for various
infrastructure projects as specified in the bill." More context made the wrong claim
bigger. Only `claude-sonnet-5` volunteered the truth unprompted: *"the provided
context does not include the full list of grants in the bill … there may be
additional cities and counties named elsewhere in HF 719."*

### Which model writes better, with the structural failure held out

Scoring only the **10 questions where the whole bill was in context** — so the
completeness gate cannot fire — isolates writing quality. Ranked by the **worse** of
the two judges, because a candidate that wins under one judge has not won:

| Rank | Candidate | Worse judge | Sonnet judge | gpt-5.1 judge | Unsupported claims |
|---|---|---|---|---|---|
| 1 | `gpt-5.1+deep` | **6.10** | 6.60 | 6.10 | 1 |
| 2 | `gpt-5.1` | 5.50 | 6.10 | 5.50 | 1 |
| 3 | `claude-sonnet-5` | 5.40 | **7.10** | 5.40 | **0** |
| 4 | `gpt-5-mini` | 4.80 | 7.00 | 4.80 | **0** |
| 5 | `claude-haiku-4-5` | 4.60 | 6.70 | 4.60 | 1 |
| 9 | **`gpt-4o-mini` (today)** | **0.80** | 5.90 | 0.80 | 2 |

**Today's model is last of the nine, under both judges.** That is the one ranking
result robust to the judge disagreement below, and it means there is real headroom.

### Read the middle of that table with caution

The two judges disagree more than the models differ. On the same answers,
`gpt-4o-mini` scores 5.90 from the Sonnet judge and 0.80 from the gpt-5.1 judge — a
5.1-point gap, against a 2.2-point spread between the best and worst *models* under
either judge alone. Exact agreement runs 35–65% and they split on the grounding gate
5–10 times per arm.

The gpt-5.1 judge is the more suspect of the two: it awards near-perfect graded
marks almost uniformly (`addresses` 2.0, `framing` 2.0, `plain` 2.0 for nearly every
arm) and then fails answers on the gates. A grader that does not discriminate on the
graded dimensions is not measuring them.

So: **first and last place are trustworthy; the ordering in between is not.**
Tightening it means a calibration pass — hand-score a sample, measure each judge
against it, and drop or re-prompt the one that diverges. That is the next piece of
work on this eval, and it is cheap.

### What to change, and what it costs

**Recommendation: `OPENAI_RAG_CHAT_MODEL=gpt-5.1`, left at its default reasoning.**

- It tops the conservative ranking (6.10 against today's 0.80) and beats today's
  model under **both** judges.
- It stays inside the latency budget: p50 2.80s, p95 6.80s against 5s and 9s. Note
  its *default* reasoning both scored higher and ran faster at p95 than forcing
  reasoning off, so send no reasoning parameter.
- One line of config, no code, trivially reversible.
- Cite-or-refuse is preserved (5 of 5).
- **It costs about 15× more per answer** — $0.0029 against $0.0002, or **$2.90 per
  thousand answers against $0.20**. Small in absolute terms; it multiplies with
  traffic in a way the one-off enrichment bill never did.

Two things to weigh against it:

- **`claude-sonnet-5` is the safer answer and the more expensive one.** Zero
  unsupported claims, the highest Sonnet-judge score, and the only arm that
  volunteered that its list was partial. But $0.0076 per answer (2.6× `gpt-5.1`,
  38× today), and **it is not reachable through this setting** — `me.py` posts to
  `api.openai.com`, so a Claude model needs a provider adapter of roughly the shape
  the eval already has.
- **`gpt-5.1` carries 12 statute citations across the fixture against today's 1.**
  That is a plain-language regression under
  [`grounded-answers`](../../.claude/rules/grounded-answers.md) rule 9, and the
  display cleaners only strip citations in positions where removal cannot break the
  sentence. Worth a prompt tweak alongside the switch.

**Sequencing: land [#868](https://github.com/alethical-org/alethical/issues/868)
first, then re-run this eval before committing to a model.** Not because the switch
is wrong, but because #868 widens the input for list questions from ~1,200 tokens to
~27,000, and `gpt-5.1` charges 8.3× more per input token than today's model. On that
worst case the per-answer input cost goes from about $0.004 to about $0.034. The
ranking may also move: this run shows it changes with passage budget. Deciding once,
after the input size is settled, beats deciding twice.

## 11. Calibrating the judges, Jul 31 2026 — measuring the graders against an answer key

§10 ended by saying the middle of its table could not be trusted and that the fix
was cheap. This is that work ([#878](https://github.com/alethical-org/alethical/issues/878)).

### The method, and the honest limit on it

23 answers from the post-#868 run were scored one at a time against §3's rubric
**before either judge had graded anything** — the verdict caches did not exist when
the scores were written, so the blinding is structural rather than promised. The
sample is every fixture question once with the seven arms rotated across them, plus
a second reading of SF 3899 and SF 624 on a different arm, and it is deterministic
so `calibrate --emit` reproduces exactly those pairs. The scores, with a sentence
of reasoning each, are committed at `alethical/eval/fixtures/judge_calibration.json`.

**Who wrote them matters and is recorded in the file.** They were scored by the
session doing this work — Claude Opus 5 — not by a human panel and not by a
majority of annotators. That bounds the result in one specific way: the key shares
a model family with one of the two judges, so "the Sonnet judge agrees with the key
more closely" is also what family bias would produce, and this key cannot on its
own tell those apart. What makes it worth having anyway is that most of its gate
calls are checkable rather than aesthetic — *is this sentence's content in the
passages* has an answer anyone can verify against the committed snapshot — and the
per-item notes name the passage or the labelled must-not-claim that decided each
one.

**And the sharpest finding does not depend on the key at all.**

### The gpt-5.1 judge was not measuring two of the four graded dimensions

It awarded `plain` = 2 to **136 of 140** answers and `framing` = 2 to **132**. A
single value handed to a one-sentence reply and to a ten-section wall of statute
citations is a constant, not a measurement, and no answer key is needed to see it —
which is why this, rather than any agreement percentage, is the finding to trust.

It also found **7 refusals where 35 were expected** (5 unanswerable questions × 7
arms). Reading its verdicts against the key showed why: it treated *"here is what
the text does say, but not the figure you asked for"* as an answer rather than a
decline. That breaks the refusal gate in both directions at once.

### What fixed it: procedures, not better descriptions

Four fields were rewritten from descriptions of a concept into steps to perform.
`plain` is now scored by subtraction against three named triggers (a statute
citation, a bill-number opening, undefined legal vocabulary) rather than by
impression. `declines` asks one question — *did the reader get the fact they asked
for?* — and states that explaining the gap is declining well, not answering. The
two absence fields share one test: *what is this sentence about, the bill or the
text you were shown?*

Agreement with the key, before and after, n = 23:

| Field | Sonnet judge | | gpt-5.1 judge | |
|---|---|---|---|---|
| | before | after | before | after |
| `grounded` | 91% | 91% | 87% | 83% |
| `declines` | 100% | 100% | **74%** | **100%** |
| `claims_completeness` | 100% | 100% | 83% | 83% |
| `asserts_absence` | 96% | 96% | 74% | 74% |
| `covers` | 96% | 96% | 96% | 83% |
| `addresses` | 91% | 91% | 87% | 96% |
| `framing` | 83% | 78% | 96% | 91% |
| `plain` | **74%** | **83%** | **56%** | **74%** |
| graded total /8 | 56% | **65%** | 48% | **56%** |

And the spread of each judge's marks, which is the number that shows whether a
dimension is being measured at all:

| Dimension | key | Sonnet before → after | gpt-5.1 before → after |
|---|---|---|---|
| `framing` | 0.20 | 0.59 → 0.76 | **0.00** → 0.20 |
| `plain` | 0.65 | 0.44 → 0.71 | **0.00** → 0.56 |

The two zeros becoming non-zero is the whole point. `gpt-5.1`'s `framing` spread
now matches the key exactly, and its `plain` spread went from a constant to 0.56
against the key's 0.65.

### What is still wrong, and why it does not reach a score

`gpt-5.1` still over-fires the two absence fields — 6 false positives on
`asserts_absence` and 4 on `claims_completeness`, out of 23. That looks bad and is
inert, for a reason worth checking rather than assuming: those fields are consulted
only when the context is partial (`honest_about_partial_reading` returns early
otherwise), and **40 of that judge's 42 overclaim flags land on complete-read
questions**, where the code never looks at them. The 2 that do reach the gate are
the same 2 the Sonnet judge flags.

The Sonnet judge moved the wrong way on `framing` — 83% → 78%, and its spread rose
to 0.76 against the key's 0.20, so it now over-deducts where it used to
under-deduct. That is the one dimension where the rewrite made a judge worse, and
it is recorded rather than tuned away, because tuning a rubric until both graders
match one key is how a key stops being independent.

### What this bought

The judges are now usable for the thing they could not do before: **rank the middle
of the field**. In §10 the same answers drew 5.90 from one judge and 0.80 from the
other. In §12 the largest per-arm mean gap is 1.0 of 8 and the smallest is 0.35.
Exact agreement is 25–70% (was 35–65%) — no better on that measure, and the reason
is visible in the table above: both judges now discriminate more, so they have more
room to differ by a point. A grader that says 2 to everything agrees with itself
beautifully.

**Read the ranking through the disagreement column, not around it.** The arm the
two judges agree about most (`gpt-5.1+deep`: 70% exact, 2 grounding splits) is the
one whose position is safest. The arm they agree about least (`claude-sonnet-5`:
25% exact, 7 grounding splits) is the one to read with most caution — and it is
also the arm one of the judges is a family member of.

## 12. Results, Jul 31 2026 (second run) — seven candidates, after #868

**This is a different measurement from §10, not a correction of it.** §10's numbers
were produced against production's old prompt *and* its old retrieval: every
question got four passages, and the eval sent only the first half of the system
prompt. Both are fixed here. §10 stands as the control; nothing below overwrites it.

Two arms from §10 are retired rather than re-run. `gpt-4o-mini@8` and
`claude-haiku-4-5@16` asked whether a wider *flat* budget helps, and #868 replaced
the flat budget for exactly the questions where it mattered. `gpt-4o-mini@16` is
kept as the one budget control, because widening still applies to the 6 questions
that stay partial.

### The scorecard

| Candidate | Score /8 | Ships | Gate fails | p50 s | p95 s | $/answer | Bar |
|---|---|---|---|---|---|---|---|
| `gpt-4o-mini` (today) | 5.90 | 75% | 4 | **2.00** | **4.19** | **$0.00066** | fail |
| `gpt-5-mini` | 6.40 | 85% | 1 | 3.12 | 7.85 | $0.00160 | fail |
| `gpt-5.1` (reasoning off) | 6.05 | 85% | 3 | 2.68 | 8.74 | $0.00788 | fail |
| **`gpt-5.1+deep`** | 6.70 | **95%** | 1 | 2.15 | 9.83 | $0.00740 | fail |
| `claude-haiku-4-5` | 5.95 | 80% | 4 | 2.37 | 6.56 | $0.00543 | fail |
| `claude-sonnet-5` | **6.80** | 90% | **0** | 3.47 | 8.33 | $0.02354 | **PASS** |
| `gpt-4o-mini@16` | 5.00 | 65% | 7 | 2.35 | 7.58 | $0.00077 | fail |

**`gpt-5.1+deep` is the arm production would actually get** from
`OPENAI_RAG_CHAT_MODEL=gpt-5.1`. `synthesize_grounded_answer` sends no reasoning
parameter, and `+deep` is the eval's name for exactly that; the bare `gpt-5.1` row
pins `reasoning.effort: "none"`, which is a configuration `me.py` cannot currently
produce. Worth stating because the two rows differ by more than the noise: 6.70
against 6.05, 95% shipping against 85%.

### Did the completeness gate failures drop? Yes, and for three reasons — one of which is not a fix

§10 counted **4–10 per arm** presenting a partial list as complete and **2–6 per
arm** denying something exists. Across all seven arms here there are **three**
such failures in total: one on `claude-haiku-4-5` and two on `gpt-4o-mini@16`. Five
of the seven arms overclaimed on **none** of the six questions that are still
partial reads.

The three causes, separated because they are not equally reassuring:

1. **Fewer chances to fail.** Partial reads fell from 10 of 20 questions to 6. Some
   of the drop is arithmetic.
2. **The prompt rule works.** On the 6 questions still partial, the overclaim count
   is 0 for five of seven arms. This is the real result and it belongs to #868.
3. **It is not the backstop doing it.** The eval now scores what
   `synthesize_grounded_answer` returns, guards included, so a guard rescue would
   flatter a model. It measured **0–1 guard edits per arm, 3 across 140 answers** —
   the prompt is reaching the models, not the regex catching them.

### The failure that moved, and the number no gate scores

Given all 98 city names and 16 county names in its context, each arm reports:

| Candidate | Cities named | Counties named | Recall |
|---|---|---|---|
| `gpt-4o-mini` (today) | **19**/98 | **1**/16 | **18%** |
| `gpt-5-mini` | 95/98 | 16/16 | **97%** |
| `gpt-5.1` | 77/98 | 15/16 | 81% |
| `gpt-5.1+deep` | 92/98 | 15/16 | 94% |
| `claude-haiku-4-5` | 76/98 | 4/16 | 70% |
| `claude-sonnet-5` | 71/98 | 12/16 | 73% |
| `gpt-4o-mini@16` | 53/98 | 6/16 | 52% |

**Today's model reports 19 cities — the same 19 as the original bug.** #868
delivered it 98 names and it printed the same answer, closing with *"Other
locations may also receive grants, but they were not specifically named in the
provided text"*, which is false of the text it was given. Every gate passes it: the
context was complete, so the honesty gate cannot fire, and the sentence is only
caught at all because it is a claim *about the context* that the context refutes.

This is the strongest single argument in the whole comparison, and it is not in the
score. **#868 bought the input; only a better model turns that input into an
answer.** The denominator is read off the snapshot by
`hf719_grant_recipients` (`alethical/eval/ground_truth.py`) and asserted against
the two independent hand counts already recorded there, so it cannot quietly drift.

### The omnibus worst case, which is where the money and the waiting are

94.6% of bills fit in a few hundred words. The ~100 that do not are where an
enumerate-everything question now sends up to 20,000 words, and a median over this
fixture is a median over short bills.

| Candidate | Slowest answer | vs its p50 | Input tokens | Cost of that one answer |
|---|---|---|---|---|
| `gpt-4o-mini` (today) | 18.7 s | 9.4× | 27,311 | $0.0043 |
| `gpt-5-mini` | **27.3 s** | 8.8× | 27,310 | $0.0109 |
| `gpt-5.1` | 23.1 s | 8.6× | 27,310 | $0.0561 |
| `gpt-5.1+deep` | **10.6 s** | 5.0× | 1,276 | $0.0095 |
| `claude-haiku-4-5` | 11.8 s | 5.0× | 30,224 | $0.0353 |
| `claude-sonnet-5` | 12.1 s | 3.5× | 45,903 | **$0.1531** |
| `gpt-4o-mini@16` | 29.5 s | 12.5× | 27,311 | $0.0046 |

**Every arm breaches the 9-second budget on its worst answer, including the one the
bar passes.** p95 over a 20-question fixture is the 19th-slowest, and only 2 of the
20 questions are omnibus, so p95 lands just underneath them. That is a hole in §3's
latency condition of the same shape as the hole in its honesty gate: the fixture is
too small at the tail for a percentile to see it. Read the worst-case column
alongside p95, not instead of it.

`gpt-5.1+deep` is the odd row and the interesting one: its slowest answer is not
the omnibus bill at all but a 1,276-token question, so its tail is reasoning
variance rather than input size — which is why it is both the slowest at p95 and
the fastest in the worst case.

### Plain language: the incumbent is the best writer, by a distance

| Candidate | Statute citations | Bill-code openings | Markdown the page cannot render | Facts carried |
|---|---|---|---|---|
| `gpt-4o-mini` (today) | **1** | 1 | 0 | 34/39 |
| `gpt-5-mini` | 16 | 0 | 0 | 37/39 |
| `gpt-5.1` | 21 | 1 | 1 | 31/39 |
| `gpt-5.1+deep` | 20 | 1 | 1 | 33/39 |
| `claude-haiku-4-5` | 12 | 1 | **18** | 34/39 |
| `claude-sonnet-5` | **24** | 0 | 0 | **38/39** |
| `gpt-4o-mini@16` | 2 | 2 | 0 | 30/39 |

Every candidate is a plain-language regression against today's model under
[`grounded-answers`](../../.claude/rules/grounded-answers.md) rule 9 — §10 measured
`gpt-5.1` at 12 citations against 1, and on the wider input it is 21. This is a
cost of upgrading, not a reason not to, but it needs a prompt line alongside any
switch rather than a note afterwards.

**`claude-haiku-4-5` writes 18 Markdown headings across 11 of its 20 answers.**
`AskAnswerScreen.tsx` strips `**bold**` and prints the rest verbatim — there is no
Markdown renderer — so those reach a reader as literal `###` characters. It is the
only arm that does this, which is exactly why an average would hide it and a choice
must not.

### Recommendation: `OPENAI_RAG_CHAT_MODEL=gpt-5.1`, reasoning left at its default

Same setting §10 recommended, re-tested rather than confirmed, and now resting on
different evidence.

- **It is first under both judges** — 6.65 from the Sonnet judge, 6.30 from the
  gpt-5.1 judge — and the only arm that is. That is §3's fourth condition, and it
  is the condition the calibration in §11 existed to make meaningful.
- **The judges agree about it more than about any other arm**: 70% exact agreement
  and 2 grounding splits, against 25% and 7 for `claude-sonnet-5`. Its position is
  the best-evidenced in the table.
- **95% ship-worthy**, the highest.
- **94% enumeration recall against today's 18%** — it is the fix for the failure
  #868 exposed and no gate scores.
- **Fastest worst case of any OpenAI arm**, 10.6 s against 18.7–29.5 s, with a p50
  of 2.15 s.
- **One line of configuration**, no code, revertible in seconds.
- **$0.0074 per answer against $0.00066** — 11× today, or $7.40 per thousand
  answers against $0.66. On the omnibus worst case $0.0095 against $0.0043, so the
  tail that costs the most time costs barely more money.

Said plainly, because it should not be buried: **no candidate clears all four of
§3's conditions.** `gpt-5.1+deep` has one gate failure and a p95 of 9.83 s against
a 9 s budget. `claude-sonnet-5` is the only arm with zero gate failures and the
only `PASS` in the table, and it fails the fourth condition instead.

### Why not `claude-sonnet-5`, which is the only row marked PASS

Its case is real: zero gate failures, the highest fact coverage (38/39), no
unrenderable markdown, and the second-fastest worst case. Four things count against
it, in descending order of how much they should matter.

1. **It loses under the second judge**, 6.60 to 4.55, and it is the arm the two
   judges agree about least in the whole table — 25% exact agreement, 7 grounding
   splits, the most of any arm. §3's fourth condition exists for precisely this
   shape, and the judge it wins under is from its own family.
2. **Its zero comes partly from the both-judges rule.** Grounding fails only when
   both judges agree it should. Sonnet has 7 disputed grounding calls and all 7
   resolved in its favour; under a stricter rule it would not be at zero. The
   hand-scored key independently marked one Sonnet answer ungrounded (SF 4138, where
   it states what a truncated exclusion clause excludes) that the gate passed.
3. **It is the worst offender on statute citations**, 24 against today's 1.
4. **It costs $0.0235 an answer — 36× today — and $0.153 for one omnibus answer.**

And it **cannot be selected by configuration at all.** `synthesize_grounded_answer`
posts to `api.openai.com` unconditionally, so `OPENAI_RAG_CHAT_MODEL` only ever
reaches OpenAI models. Choosing Sonnet means writing a provider adapter in
`alethical/api/routers/me.py` of roughly the shape `scripts/answer_eval.py`'s
`_anthropic_answer` already has: read a provider prefix off the setting, post to
`api.anthropic.com/v1/messages`, map the response back, and pin
`thinking: disabled` at effort `low` because adaptive thinking is on by default and
the reader is waiting. Both output guards and `rag_chat_system_prompt(coverage)`
must apply on the new path too. Call it half a day with tests — small, but a code
change with a deploy behind it, not a setting.

### The runner-up worth knowing about

**`gpt-5-mini` is the value pick and has the single best number in the comparison:
97% enumeration recall, 95 of 98 cities and 16 of 16 counties.** One gate failure,
85% shipping, inside both latency budgets at p50 3.12 s and p95 7.85 s, and
**$0.0016 an answer — 2.4× today, a fifth of `gpt-5.1`.** What keeps it off the top
line is that it is the *slowest* arm on the omnibus worst case at 27.3 s, and it
places fourth under the Sonnet judge. If the omnibus tail turns out to be rare in
real traffic, this is the better buy, and that is a question the logs can answer
that this fixture cannot.

### What is deliberately not being done here

**The live model is not being changed.** This section is a recommendation; the
switch is Eugene's, because it changes what every visitor reads and what every
answer costs. Nothing in this work modified `OPENAI_RAG_CHAT_MODEL` in any
environment.

## 13. What this bar does not cover

Named so nobody reads a passing score as more than it is:

- **Retrieval.** If the four passages are the wrong four, a perfect writer still
  produces a useless answer. That is [#400](https://github.com/alethical-org/alethical/issues/400).
- **Corpus freshness.** A stale record yields a confidently wrong answer that this
  eval would score highly, because the passages support it (`grounded-answers`
  rule 7).
- **Follow-up chat.** The bar scores one-shot answers. Multi-turn behaviour in the
  bill-scoped chat is covered by the contract tests, not here.
- **Citation rendering.** Whether the chips and anchors land correctly is the
  answer page's job.
