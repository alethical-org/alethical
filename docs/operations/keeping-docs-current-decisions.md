<!-- describes: scripts/check_doc_sync.py -->

# Keeping docs current — what we decided and why

**Net:** We looked at four ways to automatically catch a doc that describes code it never
declared, measured each one against the real repo, and are **not building any of them**. The
declared-coupling check we already have (`scripts/check_doc_sync.py`) stays as-is; the gap it
has is a **missing declaration**, which is a one-line fix per doc, not a missing algorithm.
Every automatic alternative we measured either misses the case that matters or fires on
roughly one-in-three PRs for plumbing reasons, and a check people route around is worse than
no check.

Evaluated [#917](https://github.com/alethical-org/alethical/issues/917), 2026-08-03. The
convention this serves is `.claude/rules/workflow.md` rule 6 (search for everything that still
describes the old behaviour); the human-facing version is "Keeping docs current" in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## The mechanism we have

A doc that describes behaviour names the code it describes, in its own text:

```
<!-- describes: apps/frontend/src/screens/redesign/SearchBillsScreen.tsx, ... -->
```

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

Two findings reframe how much it justifies, though, and both cut against building something:

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

**Verdict: no as a gate. Yes as a one-time lead list** run by a person against the 129 pairs,
who keeps the handful that are real and discards the plumbing.

## Decision

**Take D. Build nothing.** Widen the declarations by hand and keep rule 6's human sweep.

The reasoning, shortest form: the check we have already puts a doc in front of a human on 43%
of PRs, and its precision comes from a human deciding what each doc claims. Every automatic
widening we measured either cannot see plain-English guides (B, C), costs money in CI on a
graph we can't trust to be current (A), or buys the one case we know about at the price of a
third of its firings being plumbing noise (E). The specific failure in front of us is that two
docs are missing one filename — and the fix for a missing declaration is to write the
declaration.

**What follows from this:**

- Add `apps/frontend/src/lib/billDetail.ts` to the `describes:` comments of
  `docs/product-onboarding/search-bills-guide.md` and
  `docs/product-onboarding/bill-search-screen-spec.md`.
  Tracked in [#918](https://github.com/alethical-org/alethical/issues/918) — deliberately not
  done here, since #917 put declaration edits out of scope.
- Run the import-hop expansion (candidate E) **once, by hand**, over the 129 pairs, and adopt
  the ones a person judges real. Same issue.
- Leave `scripts/check_doc_sync.py` alone.

**What would change this decision.** Reconsider if a drift ships from a coupling that no doc
declared *after* the declarations have been widened — that would be evidence the human sweep
is the bottleneck rather than the declaration list. A second signal: if declaring docs grows
well past 9 of 47, hand-maintaining the lists gets harder and candidate E's noise ratio is
worth re-measuring against a larger declared base.

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
