# The Answer Quality Bar — what makes a generated answer good enough to ship

<!-- describes: alethical/eval/answer_eval.py, alethical/eval/fixtures/answer_questions.json, scripts/answer_eval.py, alethical/api/routers/me.py -->

> **Net:** Every word of every AI answer a reader sees is written by one model, and
> until now we had no way to say whether a different model would write better ones.
> This document defines "good enough" concretely enough to score, so "upgrade the
> model" becomes a measurement instead of a hunch. The eval that implements it is
> `alethical/eval/answer_eval.py`, run by `scripts/answer_eval.py`. Filed as
> [#865](https://github.com/alethical-org/alethical/issues/865).

## 1. What is being measured, and what is deliberately not

One function writes the prose for **both** places a reader meets a generated
answer: `synthesize_grounded_answer` (`alethical/api/routers/me.py`) serves the Ask
answer page (`alethical/api/routers/ask.py`) and the signed-in bill-scoped chat. So
one model choice moves both surfaces, and one eval covers both.

That function takes a question plus four already-retrieved bill passages and
returns prose. **The passages are the input, not the thing being tested.** The eval
freezes them: one snapshot of production's retrieval is taken once, committed to
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
candidate. A full five-model, two-judge run costs roughly **$2.40** and takes about
25 minutes; generation runs serially on purpose, because concurrent requests would
inflate the latency numbers the bar scores against.

## 9. What this bar does not cover

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
