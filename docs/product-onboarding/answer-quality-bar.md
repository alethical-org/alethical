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

**It passes trivially when the whole bill was in context** — 9 of the 16 fixture
bills, and 94.6% of the corpus by the #868 session's count. A complete list *is*
complete when every section was read, and an absence *is* an absence. The gate only
bites on the long bills where four passages are a sample.

How much of the bill the writer saw is **derived from the snapshot, not
hand-labeled**, so it stays correct when the passage budget changes.

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

## 9. Is the writer weak, or under-informed? The passage-budget arm

A candidate's **passage budget** is part of its identity: `gpt-4o-mini@16` is a
different candidate from `gpt-4o-mini`, scored on its own row against snapshots taken
at 8 and 16 passages alongside production's 4. This separates the two explanations
for a bad answer, which no amount of model comparison can tell apart on its own:
*the writer is weak* versus *the writer was not shown enough*.

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

## 10. Results, Jul 31 2026 — nine candidates on the same 20 questions

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

## 11. What this bar does not cover

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
