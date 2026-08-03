<!-- describes: scripts/check_doc_sync.py -->

# Keeping docs current — what we decided and why

**Net:** We looked at four ways to automatically catch a doc that describes code it never
declared, measured each one against the real repo, and are **not making any of them a CI
gate**. The declared-coupling check we already have (`scripts/check_doc_sync.py`) stays as-is;
the gap it has is a **missing declaration**, and writing one is a one-line edit per doc. Two of
the four alternatives cannot see plain-English guides at all, one costs money in CI on a graph
we can't keep current, and the closest near-miss would newly fire on 20% of PRs with at least
36% of its new prompts triggered by plumbing — and a check people route around is worse than no
check.

**One option is deliberately left open rather than rejected: running that near-miss as a
non-blocking report instead of a gate.** We never measured that mode, and it is the strongest
remaining candidate. See "What we did not measure" below.

Evaluated [#917](https://github.com/alethical-org/alethical/issues/917), 2026-08-03. The
convention this serves is `.claude/rules/workflow.md` rule 6 (search for everything that still
describes the old behaviour); the human-facing version is "Keeping docs current" in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## The mechanism we have

A doc that describes behaviour names the code it describes, in its own text:

```
<!-- describes: path/to/YourScreen.tsx, path/to/your_router.py -->
```

**The paths in that example are deliberately made up.** `declared_couplings()` finds every
`describes:` comment anywhere in a doc's raw text, including one inside a code fence — it does
not parse Markdown. So an example naming a real file makes *this* doc declare that file, and a
PR touching it is then told to re-read a decision record that says nothing about it. The first
draft of this section used `SearchBillsScreen.tsx` and did exactly that.

`scripts/check_doc_sync.py` then fails any PR that changes a declared file without one
`Docs check:` line in the body saying what the author concluded. "None needed" passes — the
check forces the *look*, not an edit.

Measured on 2026-08-03: **9 of 47 docs** declare anything, and the check **fires on 26 of the
last 60 merged PRs (43%)**, naming 54 doc-review prompts in total.

## The gap, and what the evidence actually says about it

`plainBillSummary()` lives in `apps/frontend/src/lib/billDetail.ts`. Two docs describe its
behaviour — `docs/product-onboarding/search-bills-guide.md` and
`docs/product-onboarding/bill-search-screen-spec.md` — and **neither declares that file**.
A change to it passes CI while both docs describe the old behaviour. That gap is real.

Two findings reframe the case that was made for building something. Neither is an argument
*against* automating — see "What we did not measure" — but both remove a reason that was
offered *for* it:

**1. All four historical drifts would already be caught today.** Rule 6 names four drifts
that shipped this way. Every one of them touched a file that *is* declared:

| Drift | Shipped in | Files it changed | Declared? |
| --- | --- | --- | --- |
| AI SUMMARY eyebrow removed ([#345](https://github.com/alethical-org/alethical/pull/345)) | PR #345 | `BillResultCard.tsx` | yes |
| Filter description removed ([#709](https://github.com/alethical-org/alethical/pull/709)) | PR #709 | `searchPieces.tsx`, `SearchBillsScreen.tsx` | yes |
| URL filter serialisation ([#135](https://github.com/alethical-org/alethical/issues/135)) | PR #357 | `SearchBillsScreen.tsx`, `webRoutes.ts`, `types.ts` | yes (first) |
| "Passed both chambers" added ([#607](https://github.com/alethical-org/alethical/issues/607)) | PR #612 | `public.py`, `SearchBillsScreen.tsx`, `models.py`, `serializers.py`, … | yes (first two) |

That is not a coincidence: the declarations were written in response to the Jul 29 2026 audit
of those same four drifts, so they are fitted to them. It does mean the "we shipped drift this
way" evidence is **not** evidence that an undeclared coupling is the live failure mode — it is
evidence that having no check at all was.

**2. The knowledge graph's hit on the worked example is the declaration, not a discovery.**
The graphify build reaches `search-bills-guide.md` from `plainBillSummary()` only at
`--depth 2`, and the intermediate hop is `BillResultCard.tsx` — a file the guide **already
declares**. At `--depth 1` it names no doc at all. So the graph did not find an undeclared
coupling; it found a declared file plus one code-to-code import hop.

## The candidates, measured

Every mechanism below does the same job: decide **which doc to put in front of a human**. None
of them reads meaning, so none can tell whether a sentence went false. That matters for the
hard case rule 6 records — the sentence that went stale was a flat status claim
("the API path pays full list price") that never named the feature, so no pattern finds it and
only reading the section does.

### A. Knowledge-graph doc→code edges (`graphify`)

Where it would run: a graph build, then a check. Local today; CI would have to build it.

| | |
| --- | --- |
| Catches `plainBillSummary()`? | **No at depth 1** (zero doc hits). Yes at depth 2, but only via the already-declared file. |
| Catches the 4 historical drifts? | Yes — but so does the existing check. |
| Coverage | 26 direct doc→code edges across **7 of 47 docs**. |
| Depth-2 breadth | 102 of 205 code files reach ≥1 doc; mean 1.1 docs per file, max 8. |
| Depth-3 breadth | 159 of 205 files reach ≥1 doc; **mean 4.7, max 25** — unusable. |
| Per-PR firing | 17 of 60 merged PRs (28%), naming 24 docs — *less* than the declared check. |
| Cost | Code half is deterministic parsing: free, ~4s incremental. Doc half needed an LLM pass: 1.09M input + 0.166M output ≈ **$5.76** at Claude Sonnet 5 list ($3/$15 per million), ≈$3.84 at the intro rate through 2026-08-31, ≈$1.92 on Haiku 4.5. Per full build, in CI, per PR. |
| Reliability | Its own `GRAPH_REPORT.md` reports ~7% of doc→code links pointing at names that don't resolve. A 2026-08-03 Codex review found freshness checking compares only the mtime of the single file being read — blind to new files, deletions, and renames. |

**Verdict: no.** It costs money in CI, cannot be trusted to be current, and at the only depth
that catches the worked example it is doing something a free deterministic import walk does
better (candidate E).

### B. Plain symbol-mention grep, docs → code

Where it would run: free, in CI, on every PR.

**This one fails hardest on exactly the doc that drifts worst.**
`search-bills-guide.md` contains **one** backticked token that looks like a code identifier,
and it resolves to no definition. Its backticked tokens are search-query examples —
`school funding`, `tax`, `HF 2904` — not symbols. The sentence that describes
`plainBillSummary()` is pure prose: "A plain-language summary of what the bill actually does,
written to be readable." No grep finds a coupling there, because the doc never names the code.

Across all 47 docs: 642 backticked identifier mentions resolve to **192 (30%)** unique defining
files, 54 (8%) are ambiguous across files, and **396 (62%) resolve to nothing**.

**Verdict: no.** Blind to plain-English guides, which rule 6 says to check first.

### C. Completeness check — every doc naming a symbol must declare its file

Where it would run: free, in CI, on every PR (a lint on docs).

Same extraction as B, so the same blindness. Measured backlog: **25 of 47 docs would fire, on
93 (doc, undeclared file) pairs.** `grounded-ask-spec.md` alone accounts for 17.

Crucially, it fires **zero times** on `search-bills-guide.md` — the guide passes clean while
carrying the three false claims that motivated the whole convention.

**Verdict: no.** A 93-item backlog whose completion would still not have caught the case in
the issue.

### D. Null option — widen the declarations, keep the human sweep

Where it would run: nowhere new. One-line edits to docs, plus rule 6 as written.

Catches `plainBillSummary()` the moment `apps/frontend/src/lib/billDetail.ts` is added to the
two docs that describe it. Zero new false positives — the check's precision is whatever the
declarations say, which is a human judgment about what the doc claims.

### E. Declared globs plus one deterministic import hop

Not in the issue's list; the evidence pointed at it, so we measured it. If a doc declares
`BillResultCard.tsx` and that file imports `billDetail.ts`, treat `billDetail.ts` as described
too. Deterministic, free, no LLM, no graph, ~1s in CI.

| | |
| --- | --- |
| Catches `plainBillSummary()`? | **Yes** — names all three docs, including both target docs. |
| Expansion size | 606 first-party import edges; **+129 (doc, added file) pairs** across the 9 declaring docs. |
| Per-PR firing | Rises from 26/60 (43%) to **38/60 (63%)**. 12 PRs newly fire that were previously silent. |
| False positives | 69 newly-named (PR, doc) pairs over 60 PRs. **36% are triggered only by a hub file** — a change to `theme/primitives.tsx`, `data/types.ts`, `api/serializers.py` or `api/schemas.py` that cannot plausibly falsify the doc named. |

Two measured examples of the noise: PR #846 changed `alethical/api/serializers.py` and would
name **seven docs at once**; PR #847 ("Nav menus open when you point at them") would name the
Search Bills guide and spec because it touched a theme file.

**And no threshold fixes it.** The obvious repair is to exclude widely-imported plumbing. But
`billDetail.ts` **is** plumbing by that measure — it is the 9th most-imported file in the repo:

| Imported by | File |
| --- | --- |
| 52 | `apps/frontend/src/theme/tokens.ts` |
| 29 | `apps/frontend/src/data/types.ts` |
| 21 | `apps/frontend/src/hooks/useAppQueries.ts` |
| 19 | `apps/frontend/src/providers/AuthProvider.tsx` |
| 19 | `apps/frontend/src/navigation/links.ts` |
| **18** | **`apps/frontend/src/lib/billDetail.ts`** ← the one we want |
| **18** | `apps/frontend/src/hooks/useResponsive.ts` ← pure layout plumbing |

Any cutoff that admits `billDetail.ts` admits `useResponsive.ts`, which is tied with it
exactly. The property that makes `plainBillSummary()` worth catching — many surfaces depend on
it — is the same property that makes a dependency rule noisy. Graph shape cannot separate
"shared behaviour that docs describe" from "shared plumbing that docs don't", because the
difference is what the doc claims, not how the code is wired.

**Scope of that last claim.** What the numbers disprove is a **global import-in-degree cutoff**,
because the file we want and a file we don't are tied at 18. They do not test path or directory
exclusions, type-only imports, changed-symbol analysis, a hand-kept behaviour-hub allowlist, or
a plumbing denylist. Any of those could still work; none was measured.

**Verdict: no as a gate. Yes as a one-time lead list** run by a person against the 129 pairs,
who keeps the ones that are real and discards the plumbing. Whether it also deserves to run as
a recurring non-blocking report is genuinely open — see below.

## Decision

**Take D. Build nothing.** Widen the declarations by hand and keep rule 6's human sweep.

The reasoning, shortest form: the check we have already puts a doc in front of a human on 43%
of PRs, and its precision comes from a human deciding what each doc claims. Every automatic
widening we measured either cannot see plain-English guides (B, C), costs money in CI on a
graph we can't trust to be current (A), or buys the one case we know about at the price of
newly firing on 20% of PRs with at least 36% of its new prompts triggered only by plumbing (E).
The specific failure in front of us is that two docs are missing one filename — and the fix for
a missing declaration is to write the declaration.

**Take D as the gate decision, not as the whole answer.** Building nothing *blocking* is well
supported. Ruling out every recurring, non-blocking aid is not, and this doc originally read as
if it did.

**What follows from this:**

- ~~Add `apps/frontend/src/lib/billDetail.ts` to the `describes:` comments of
  `docs/product-onboarding/search-bills-guide.md` and
  `docs/product-onboarding/bill-search-screen-spec.md`.~~ **Done**
  ([#918](https://github.com/alethical-org/alethical/issues/918)); #917 put declaration edits
  out of its own scope.
- ~~Run the import-hop expansion (candidate E) **once, by hand**, over the 129 pairs, and adopt
  the ones a person judges real.~~ **Done** (same issue) — 39 of 131 adopted; see the next
  section.
- Leave `scripts/check_doc_sync.py` alone. Still true — #918 changed no code.

## The by-hand pass, as run ([#918](https://github.com/alethical-org/alethical/issues/918), 2026-08-03)

**39 of 131 pairs adopted, 92 rejected.** The expansion re-measured at **131** pairs rather
than 129; the two extra are `__init__.py` package files this parser resolves and #917's did
not, and both were rejected anyway.

The test each pair was judged against — rule 6's "could a sentence in this doc now be wrong?"
— needed one sharpening before it could be applied consistently, because on a bare reading
almost everything passes. **Adopt when the doc holds a sentence whose truth depends on that
file's specific behaviour**: a named symbol, an enumerated list, a described interaction, a
stated payload or display rule. **Reject when the doc's only tie to the file is** (a) generic
infrastructure the doc never characterises, (b) a bare pointer to where the code lives, or
(c) a claim so general that only a redesign could falsify it — and that redesign would
necessarily touch an already-declared file.

Test (c) is the one that did the most work. Most of what the expansion surfaces is a doc
*pointing at* a file rather than *claiming* something about it, and a pointer cannot go stale.

**This is candidate E's precision, and it is not the same number as the 36% above.** Watch the
denominators, since mixing them is the error #920 came back to fix. The **36%** is
firing-weighted: the share of 69 newly-named *(PR, doc)* prompts over 60 PRs that only a
plumbing file triggered. The **30%** here is candidate-weighted: the share of 131
*(doc, added file)* declaration proposals a person kept. E is a lead-list generator, so 30%
is the figure that describes it as one — **70% of what it proposes is wrong**, which is
roughly two rejections for every keep.

**Three findings worth keeping:**

1. **"Plumbing" is a property of the pair, not of the file.** #917 named
   `apps/frontend/src/hooks/useResponsive.ts` as pure layout plumbing, and for
   `search-bills-guide.md` it is — that guide makes no claim about screen width. Three specs
   *do*: `grounded-ask-spec.md` states the rail collapses "below 1100px" and the file defines
   `isDesktop: width >= 1100`. So it was adopted for three docs and rejected for the rest.
   Same story for `alethical/api/serializers.py`, #917's flagship noise case: rejected where
   a doc merely reads serialized output, adopted for the three that enumerate payload fields
   or name the file outright ("Status key derived at serialization from action text").
2. **A design doc's aspirational sections are not claims.** `backend-api-system-design.md`
   names `auth.py`'s behaviour under "Recommended approach" and `schemas.py`'s under "Rules".
   Neither can be falsified by changing the code, because neither describes the code. Its
   *shipped-shape* passages are a different matter and were adopted.
3. **One hop does not reach everything a doc claims.** `data-ingestion-onboarding.md` makes
   detailed claims about `alethical/api/routers/me.py` (`build_query_embedding`, the offline
   hash fallback) and `alethical/api/services/representative_lookup.py` (both hop URLs, four
   env-var override names) that no pipeline file imports, so the expansion never offered
   them. Both were added on top of the 131. A mechanical lead list finds what the code wires
   together; only reading the doc finds what the doc asserts.

**Measured cost.** Per-PR firing rises from **25/60 (42%)** to **34/60 (57%)** — against the
**63%** #917 projected for adopting the expansion wholesale. (The 25 is a re-measurement of the
same pre-change declarations against a `--limit 60` window that had moved on by a day, so it
reads 25 where the figure above reads 26. Same measurement, later sample.)
No single added declaration is a runaway: the heaviest is `lib/billDetail.ts` at 8 of 60 PRs
per doc, which is the intended effect rather than noise, and `serializers.py` costs 2 of 60.

**What this settles, and what it does not.** It does not reopen the gate decision: a mechanism
whose proposals are 70% wrong cannot be the thing that blocks a merge, and nothing here
disputes that. It does settle the precision gap "What we did not measure" recorded — E's
precision is 30%, no longer unknown.

**For the non-blocking-report option that is still open, the 30% cuts both ways, and the second
half is the one that decides it.** A report nobody has to obey can carry a 70% miss rate; that
is what a lead list is. The harder problem is that this pass took **reading eight docs
end to end, 4,216 lines**, to sort 131 proposals — the judgment is not in the graph, it is in
knowing that "below 1100px" is a claim and "the implemented styling source of truth" is a
pointer. A report re-proposing the same 92 rejected pairs every month would be re-asking a
question already answered at that price, so if it is ever built it needs to remember what was
declined, not just recompute the hop.

**What would change this decision.** Reconsider if a drift ships from a coupling that no doc
declared *after* the declarations have been widened — that would be evidence the human sweep
is the bottleneck rather than the declaration list. A second signal: if declaring docs grows
past roughly 20 of 47, hand-maintaining the lists gets harder and candidate E's noise ratio is
worth re-measuring against a larger declared base.

Waiting for a drift to ship is a poor experiment, though, because the experiment is a public
error. #918's by-hand review was the cheaper version of the same test, and it has now run: it
produced a real precision number for candidate E — **30%** — prospectively, without anything
going stale first. See "The by-hand pass, as run" above.

The "roughly 20 of 47" trigger is closer than it was: that pass took declaring docs from 9 to
10, and more than doubled the globs they carry (52 → 90 firings over 60 PRs).

## What we did not measure

Three gaps, recorded so nobody reads this doc as more conclusive than it is. A 2026-08-03
adversarial review (Codex) found all three.

- **Candidate E as a recurring non-blocking report.** It was only ever measured as a blocking
  gate. As a report it costs nothing, blocks nobody, and cannot be routed around because there
  is nothing to route around. This is the strongest remaining option and it is still untested
  — but #918 found the thing that would decide it, and it is not the false-positive rate: see
  "The by-hand pass, as run" on why a report has to remember what a person already declined.
- ~~**The other 64% of candidate E's new prompts.**~~ **Settled by
  [#918](https://github.com/alethical-org/alethical/issues/918).** All 131 pairs were judged
  and E's precision is **30%** (39 kept). The 36% figure stands as written — a lower bound on
  firing-weighted noise, not a false-positive rate — and is a different denominator from the
  30%, which "The by-hand pass, as run" spells out.
- **Whether the existing check's 43% firing rate produces good reviews.** 43% measures reach,
  not whether anyone read the whole doc. Rule 6 already records two PRs that edited the right
  doc and still shipped a contradiction one section away. Nothing here measures how often a
  `Docs check:` line reflects a real read.

One framing correction while we are at it: the four historical drifts being already-covered is
**neutral evidence, not evidence against automating**. The declarations were fitted to those
drifts after the fact, so they say nothing about how often a *future* undeclared coupling
appears. This doc's original wording treated it as an argument for building nothing; it isn't
one, and the case for D rests on the measurements instead.

## Reproducing the measurements

Nothing here is a judgement call about numbers, so all of it is re-derivable:

- Declaring docs and per-PR firing: `scripts/check_doc_sync.py`'s own `declared_couplings()`,
  applied to `gh pr list --state merged --limit 60 --json number,title,files`.
- Historical drifts: `gh pr view <n> --json files` for PRs 345, 709, 357, 612.
- Graph depths: `graphify affected "plainBillSummary()" --depth 1` (no doc hits) and
  `--depth 2` (two docs, via `BillResultCard.tsx`); breadth from a BFS over
  `graphify-out/graph.json`.
- Graph build cost: `graphify-out/cost.json` (1,090,637 input + 166,026 output tokens).
- Symbol resolution and import in-degrees: backticked-identifier extraction over `docs/**.md`
  against a definition index of the 205 first-party code files.
