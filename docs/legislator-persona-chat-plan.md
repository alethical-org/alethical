# Legislator persona chat — plan & open items

**Net:** We built a working proof-of-concept that lets someone "chat with" a real
Minnesota legislator (currently only Isaac Schultz), grounded in that legislator's
public record. It is an **internal demo only** — a throwaway standalone web page, one
hardcoded person, no grounding guardrails beyond the prompt, and no consent to simulate
a real living politician. This doc is the running tracker for turning it into something
that could safely ship: what's decided, what has to be built, and what must be settled
before any real user sees it.

Companion to `docs/persona-rag-chatbot-research.md` (the research behind these
decisions) and governed by `.claude/rules/grounded-answers.md` (the cite-or-refuse and
grounded-neutrality invariants that any generated-answer surface must honor).

Status as of 2026-07-17: **proof-of-concept on branch `legislator-chat-unify`,
untracked.** Not merged, not routed into the product, not for real users.

---

## What exists today

The proof-of-concept is one file, `alethical/api/routers/legislator_chat.py`:

- **One hardcoded legislator.** `ISAAC_SCHULTZ_ID` — picked because he has the richest
  record in the corpus (50 sponsorships, 51 votes), so the demo exercises the fullest
  possible grounding. (The code comment says "119 in the DB"; production now holds **412
  legislators, 206 with sponsorship records** — the comment is stale.)
- **Corpus-stuffing, not retrieval.** `format_record_context` flattens the legislator's
  entire bill record (sponsorships, votes, summaries, key points, policy areas) into the
  system prompt. No retrieval step — the whole record goes in every time.
- **Prompt-only grounding.** `SYSTEM_PROMPT_TEMPLATE` instructs the model to ground in
  the record, bans invented biography/party-platform filler, and — deliberately — tells
  it to connect questions to **thematically related** bills rather than requiring an
  exact keyword match.
- **Self-reported citations.** The model emits a `SOURCES: <bill keys>` line;
  `parse_answer` resolves those keys to `Bill.official_url` pills and strips any inline
  keys from the prose. Nothing verifies a cited bill actually supports the sentence.
- **A refusal path.** `LEGISLATOR_CHAT_REFUSAL` ("I don't have a public record on
  that.") when nothing in the record relates.
- **A standalone HTML page.** `render_chat_page` + `_PAGE_STYLES` + `_PAGE_SCRIPT`
  (~290 lines) render a complete self-contained page with inline CSS and vanilla-JS
  `fetch` — it does **not** use the Expo/React Native frontend the rest of the product
  is built in. Heavy "AI SIMULATION" framing throughout (badge, disclosure, page title).
- **Persistence.** `LegislatorChatSession` / `LegislatorChatMessage` tables
  (migration `0002_legislator_chat.py`) store sessions and messages with `citations` and
  `was_refusal`.
- **Model.** OpenAI `gpt-4o-mini` via the Responses API (`OPENAI_RAG_CHAT_MODEL`).

---

## Locked decisions

- **Internal demo only until authorization is settled.** No route from the real product
  into this surface. The hardcoded ID + standalone page + "AI SIMULATION" framing are
  the wall. See Open dependency D1.
- **Wire into the Expo frontend; the standalone HTML was a mistake** (Joe, 2026-07-17).
  The self-contained server-rendered page duplicates chat UI the product already has and
  can't ship as-is. The target is a real React Native screen reusing existing chat
  patterns; the router keeps only its JSON endpoints.
- **Multi-legislator, not hardcoded** (Joe, 2026-07-17). The demo should let the user
  pick from legislators who have enough record to ground answers (206 have sponsorships).
  The router logic is already `legislator_id`-parameterized — only `create_session` and
  `chat_page` pin the constant.
- **Grounding is a structural problem, not a prompting problem** (from
  `docs/persona-rag-chatbot-research.md` §5, Citation accuracy). Guardrails go in code
  (retrieval + verification), not just in the system prompt.

---

## Build sequence

Each item has a verification check. Ordered by dependency, not necessarily by ship order.

### 1. Multi-legislator selection — Net: let the user chat with any legislator who has enough record, not just Schultz.

**Tracking:** [#388](https://github.com/alethical-org/alethical/issues/388) · PR [#382](https://github.com/alethical-org/alethical/pull/382) (built, CI green).

- Replace the hardcoded `ISAAC_SCHULTZ_ID` in `create_session`/`chat_page` with a
  chosen `legislator_id` carried on the session.
- Gate the pickable set to legislators with a meaningful record (e.g. has sponsorships
  and/or votes) so answers can actually ground — a sparse-record legislator produces
  constant refusals (this is *why* the demo started with the max-data legislator).
- **Verify:** create a session for several different legislators, confirm each grounds
  in its own record and a no-record legislator refuses cleanly.

### 2. Retrieval instead of corpus-stuffing (RRF hybrid) — Net: stop dumping the whole record into the prompt; fetch only the bills relevant to the question, combining keyword and semantic search.

**Tracking:** [#389](https://github.com/alethical-org/alethical/issues/389) · PR [#383](https://github.com/alethical-org/alethical/pull/383) (built vector-only, CI green). Full RRF layer deferred to [#380](https://github.com/alethical-org/alethical/issues/380); depends on real embeddings [#105](https://github.com/alethical-org/alethical/issues/105); threshold tuning with [#255](https://github.com/alethical-org/alethical/issues/255).

- **Do not act yet** (Joe, 2026-07-17) — sequence after the risk blocker (item 3) is
  understood together with this.
- Hybrid retrieval via Reciprocal Rank Fusion (keyword `tsvector` + vector `pgvector`),
  per `docs/persona-rag-chatbot-research.md` § Addendum (Hybrid retrieval / RRF). Note
  the addendum's caveat: a single legislator's corpus is tens-to-low-hundreds of bills —
  small enough to try vector retrieval first, measure for missed lexical matches (bill
  numbers), then adopt RRF only if justified. Index choice (IVFFlat vs HNSW) is separate
  from RRF and shouldn't be bundled.
- **Verify:** retrieval returns the right bills for a set of test questions, including
  ones that require a lexical (bill-number) match vector search alone would miss.

### 3. Blocker on loose thematic grounding — Net: the "connect to any thematically related bill" instruction is the biggest hallucination risk; constrain it so the model can't attach a bill the record doesn't actually support.

**Tracking:** [#390](https://github.com/alethical-org/alethical/issues/390) · PR [#384](https://github.com/alethical-org/alethical/pull/384) (built, CI green).

- The loose-connection instruction feeds **character/persona hallucination** (RoleBreak,
  TimeChara — `docs/persona-rag-chatbot-research.md` §1) and post-hoc citation
  (up to 57% of citations are rationalized after the fact — §5).
- Constrain grounding to the retrieved candidate set (from item 2) rather than free
  thematic association across the whole record.
- **Verify:** an off-topic question that has only a tenuously-related bill in the record
  refuses (or answers without over-claiming) instead of fabricating a position.

### 4. Post-hoc citation verification — Net: don't trust the model's self-reported sources; check in code that each cited bill actually backs the claim before showing it as a source.

**Tracking:** [#391](https://github.com/alethical-org/alethical/issues/391) · PR [#385](https://github.com/alethical-org/alethical/pull/385) (built, CI green). Threshold (0.25) tuning with [#255](https://github.com/alethical-org/alethical/issues/255); depends on real embeddings [#105](https://github.com/alethical-org/alethical/issues/105).

- In `parse_answer` (or a new verification step after it), for each cited bill key
  measure semantic overlap between the claim sentence(s) and the bill's
  `summary`/`key_points` (embedding cosine similarity or a lightweight LLM entailment
  check). Drop or flag citations below threshold. Per
  `docs/persona-rag-chatbot-research.md` §5 (Citation accuracy is structural): models
  cite the right *document* but not the right *span*, so span accuracy must be verified
  programmatically.
- **Verify:** a deliberately mis-cited answer (bill key that doesn't support the claim)
  has that citation dropped/flagged rather than rendered as a green source pill.

### 5. Frontend integration — Net: build the real in-app screen and delete the throwaway HTML page.

**Tracking:** [#392](https://github.com/alethical-org/alethical/issues/392) · PR [#386](https://github.com/alethical-org/alethical/pull/386) (built, CI green; live viewport QA pending). Orphaned dead helpers noted for cleanup.

- New React Native screen reusing existing bill-scoped chat patterns
  (`ChatSessionScreen.tsx`), calling the JSON endpoints through the app's `api.ts` /
  `useAppQueries` layer instead of raw `fetch`.
- Delete `render_chat_page` + `_PAGE_STYLES` + `_PAGE_SCRIPT`; the router keeps only
  `/sessions` and `/messages`.
- Any linked location (a chosen legislator, a session) must be URL-addressable
  (`.claude/rules/grounded-answers.md` rule 5).
- **Verify:** the screen works on the dev server across mobile + desktop web viewports;
  the standalone route is gone and nothing references it.

### 6. Cite-or-refuse acceptance coverage — Net: bring persona-chat answers under the same automated grounding contract as the rest of the product, so a careless prompt edit can't silently ship an ungrounded claim.

**Tracking:** [#393](https://github.com/alethical-org/alethical/issues/393) · PR [#387](https://github.com/alethical-org/alethical/pull/387) (built, CI green — suite passes in CI).

- Once persona chat is a real generated-answer surface,
  `.claude/rules/grounded-answers.md` rules 1 (cite or refuse) and 3 (grounded
  neutrality) apply. Add acceptance tests alongside `alethical/tests/test_ask_scenarios.py`:
  every non-refusal answer resolves ≥1 citation to an official source URL; the refusal
  path stays intact (guard against `LEGISLATOR_CHAT_REFUSAL` drifting out of sync with
  the system prompt so `was_refusal` silently goes False).
- **Verify:** the new tests fail if an answer ships without a resolvable citation, or if
  the refusal string stops matching.

---

## Open dependencies (must be settled before real-user exposure)

### D1. Legislator/office authorization & consent — BLOCKING
Simulating a real, named, living politician carries **legal/reputational** risk distinct
from ordinary hallucination: defamation/misattribution (putting a view in his mouth he
doesn't hold — including positions he stated in news/press that aren't in our record),
right-of-publicity (using a real person's identity without authorization), and
documented public backlash (2024-primary chatbot-clone incidents —
`docs/persona-rag-chatbot-research.md` § Addendum, Real-world risk calibration). The
research doc flags this as the unresolved dependency and recommends reading two papers
**before any decision on real-user exposure**: "Clones in the Machine: A Feminist
Critique of Agency in Digital Cloning" (arXiv 2504.18807) and "From Persona to
Personalization" (arXiv 2404.18231) — `docs/persona-rag-chatbot-research.md` § Caveats.

**Nothing ships to real users until this is resolved.** Items 1–6 are safe to build
behind the internal-demo wall in the meantime.

### D2. Record completeness / freshness
Answers are only as good as the ingested record, and the record is *only* sponsorships,
votes, and bill summaries — not floor speeches, press releases, or news statements. A
position stated outside our sources can be silently misrepresented. Ties to
`.claude/rules/grounded-answers.md` rule 7 (answerable means ingested and fresh).

---

## Known cleanup

- Stale comment in `legislator_chat.py`: "119 in the DB" → 412 legislators (206 with
  sponsorships) in production as of 2026-07-17.

---

## References

- `docs/persona-rag-chatbot-research.md` — research: persona hallucination, role/persona
  separation, structured identity grounding, citation-as-architecture, RRF addendum.
- `.claude/rules/grounded-answers.md` — cite-or-refuse (rule 1), grounded neutrality
  (rule 3), URL-addressability (rule 5), corpus currency (rule 7), follow-up chat as a
  standing capability (rule 8).
- `alethical/api/routers/legislator_chat.py` — the proof-of-concept.
- `alethical/alembic/versions/0002_legislator_chat.py` — session/message tables.
- `apps/frontend/src/screens/ChatSessionScreen.tsx` — existing chat UI to reuse.
