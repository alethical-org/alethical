# Grounded Ask — Build Spec

Status: draft for engineering review
Owner: Eugene
Related surfaces: signed-out home (hero), chat

![Signed-out hero with Ask box and sample question chips](assets/grounded-ask-hero.png)

*Note: the mock above shows the full chip set including the vote chip — that chip and the word "votes" in the placeholder are **v1.1**; see Phasing in §2.*

## 1. Goal and the promise this build protects

The signed-out home page hero ships this copy:

> **Grounded answers on Minnesota law**
> We read every bill so you don't have to — what it says, where it stands, and how everyone voted. Plain English, every answer linked to its source.

The subhead is a contract, not marketing: **no answer ships without a resolvable citation to its official source.** Everything in this spec exists to keep that sentence true when the hero's Ask box goes from bill-scoped chat to a general question box.

## 2. User-facing behavior

A signed-out visitor types a natural-language question into the hero Ask box. The system classifies the question, answers from ingested Minnesota data with citations, or honestly declines.

The v1 hero placeholder reads **"Ask about any Minnesota bill or legislator…"** — deliberately *not* "votes," which is a v1.1 capability (see Phasing below). The placeholder must never advertise an intent the router can't answer.

### Acceptance scenarios (the hero's sample chips — these are the tests)

| # | Question | Expected behavior |
|---|----------|-------------------|
| 1 | **What does SF 2310 do?** *(any resolvable HF/SF number or recognizable bill title)* | Bill-text RAG answer using the existing pipeline, with citations to the retrieved passages and the bill's official page. |
| 2 | **What bills affect healthcare?** | List of current-session bills matching the topic (policy-area tag and/or keyword match), each with its AI summary line and a citation link to the bill's official page. |
| 3 | **Which legislators support affordable housing?** | Legislators who **authored or co-authored** bills matching the topic, with per-legislator bill counts and links to each legislator profile and the underlying bills. See framing rule in §4.3 — "support" must be reported as sponsorship/votes, never as inferred opinion. |
| 4 | *Vote question (e.g., "How did my legislator vote on cannabis?")* | **v1: honest deflection** — the router recognizes the intent and answers: vote-by-vote answers are coming soon, and every roll call is already on the bill's page (link the bill's Votes tab when the bill resolves). Never a partial or unverified vote answer. **v1.1: the full cited answer** — vote position, tally, date, citation to the roll call's official record; if no roll call exists, say so and offer the chamber tally or bill status. |
| 5 | *Out of scope question (e.g., federal bill, statute lookup, "is this bill good?")* | Polite refusal that names what we do cover. No hallucinated answer. |

Every answer ends with tappable citations using the existing citation panel pattern (excerpt + highlighted passage where applicable + "Open official source").

### Phasing — v1 vs. v1.1

**v1 (launch):** router (§4.1) · bill-text RAG path · topic → bills · topic → legislators · refuse + vote deflection (§4.5) · generalized citation URLs (§4.4) · **bill** resolution only (HF/SF-number regex + fuzzy title match).

**v1.1 (fast follow, gated on the §5 coverage spike):** the `legislator_vote` answer path · person entity-resolution (§4.6) · the "my legislator" location prompt (§8.1) · the vote chip returns to the hero — in chamber-tally form first if individual-vote coverage turns out thin.

Rationale: the vote path stacks the three hardest problems (person resolution, roll-call coverage, signed-out location capture), while every v1 path is a thin formatter over queries that already exist. Roll calls still ship in v1 on the bill page's Votes tab, so the hero's "how everyone voted" stays true product-wide — users can *see* every vote; conversational vote answers arrive in v1.1.

## 3. Already built — do not rebuild

| Capability | Where | Notes |
|---|---|---|
| Bill-scoped RAG chat with citations | `alethical/api/routers/me.py` — `create_chat_message` (~line 440), citation build (~470–481), `synthesize_grounded_answer` (~82–127) | Retrieval over `RagChunk`/`RagChunkEmbedding` scoped by `subject_bill_id`; empty retrieval already falls back to `RAG_CHAT_FALLBACK`. |
| Citation UI (tap → highlighted passage → "Open official source") | `apps/frontend/src/screens/ChatSessionScreen.tsx` (`HighlightedCitationText`, source link ~470–494); `Citation` type in `apps/frontend/src/data/types.ts` | Reuse as-is for the new surface. |
| Bill query surface with filters | `alethical/api/routers/public.py` — `bills()` (~249), `status_filter_clause` (~164), `/policy-areas` (~216), `/search` (~668) | Chamber, policy area, status, session, omnibus already supported. |
| Legislator-level vote records | `alethical/pipeline/votes.py` — House HTML + Senate PDF roll-call parsing, name matching, writes `VoteEvent` (with `official_url`) + `VoteRecord` | Tally counts parse even when individual name-matching fails; failures logged as `no match`. |
| Per-legislator votes endpoint | `alethical/api/routers/public.py` — `/legislators/{id}/votes` (~549) | |
| Sponsorship data | `alethical/db/models.py` — `Sponsorship` (~401); `/legislators/{id}/bills` (~529) | Powers scenario 2. |
| Representative lookup (address/pin → districts → legislators) | `alethical/api/services/representative_lookup.py`; `POST /representative-lookups` (~595) | Powers "my legislator" once location is known. |
| Source URLs per entity | `alethical/db/models.py` — `Bill.official_url` (~322), `VoteEvent.official_url` (~456), `Legislator.profile_url` (~257) | The citation targets for §4.4 already exist on every relevant model. |

## 4. What to build

### 4.1 Question router
Classify each Ask into: `bill_text` (scenario 1) · `topic_bills` (scenario 2) · `topic_legislators` (scenario 3) · `legislator_vote` (scenario 4) · `refuse` (scenario 5). Bounded LLM classification step; low temperature; the router's output is a typed intent, not free text. All five intents are classified in v1 — `legislator_vote` maps to the deflection response (§4.5) until v1.1 ships the real path.

### 4.2 Structured-answer formatters (2–3 thin functions)
Each takes existing query results and produces a plain-English answer **plus a citations array** in the same shape `me.py` already emits (`citation_label`, `excerpt`, `url`, …):
- `topic_bills`: policy-area + keyword match → bill list with AI summary lines; cite each `Bill.official_url`.
- `topic_legislators`: join topic-matched bills → `Sponsorship` → legislators; cite `Legislator.profile_url` + underlying bills.
- **(v1.1)** `legislator_vote`: resolve legislator + topic → `VoteRecord` via `/legislators/{id}/votes` join; cite `VoteEvent.official_url`. Fallback ladder: individual vote → chamber tally (VoteEvent counts parse even when names don't match) → bill status.

### 4.3 Framing rule for "support" (scenario 2)
Grounded neutrality: the answer must say what the record shows — "authored or co-sponsored N bills on affordable housing," "voted yes on HF xxxx" — never "supports affordable housing" as an opinion claim. The word "support" in a user's question is interpreted as *sponsorship and/or yes-votes* and the answer says so explicitly.

### 4.4 Generalized citation source URLs
Today `me.py` hardcodes `url = bill.official_url`. Generalize: citation URL is chosen per source type — bill → `Bill.official_url`, roll call → `VoteEvent.official_url`, legislator → `Legislator.profile_url`. No citation without a resolvable URL.

### 4.5 Cite-or-refuse guardrail (router level)
Extend the existing empty-retrieval fallback into a hard invariant for every answer path:
- Every answer must carry ≥ 1 citation with a resolvable URL, or the system refuses.
- Add a retrieval-relevance threshold so weak matches refuse rather than stretch.
- Out-of-scope classes (federal, statutes, opinion/prediction, open web) refuse with a one-line statement of what Alethical does cover.
- **Vote deflection (v1):** questions classified `legislator_vote` get an honest not-yet — vote-by-vote answers are coming soon, and every roll call is already on the bill's page (link the Votes tab when the bill resolves). Never a partial or unverified vote answer.

### 4.6 Entity resolution
**v1 — bills only:** HF/SF-number regex plus fuzzy title match (via `/search`). This is all the v1 paths need — `topic_legislators` reaches legislators through sponsorship joins, not name lookup.

**v1.1 — people:** name/nickname → legislator id, tolerant of partial names and misspellings. `/search` and the name-matching in `votes.py` (`legislator_keys`, `build_legislator_index`) are starting points. "My legislator" resolution depends on §8.1.

## 5. Coverage spike — the v1.1 gate (not a v1 launch blocker)

Half-day task against the live DB. Runs in parallel with the v1 build; its findings decide *how* the vote path ships in v1.1:
1. What share of current-session bills with floor action have legislator-level `VoteRecord`s? (Check `no match` log rate from `votes.py`.)
2. Do policy-area tags + keyword search reliably surface bills for: healthcare, affordable housing, cannabis? *(This half is v1-relevant — if a launch chip's topic is weak, tune the keyword backstop before launch.)*

**Decision rule:** if individual-vote coverage is thin, the returning vote chip ships in chamber-tally form ("How did the House vote on cannabis?") — still cited, always answerable — and upgrades to individual votes as coverage improves.

## 6. Definition of done

### v1 (launch)
- [ ] The three v1 hero chips (SF 2310 / healthcare / affordable housing) return correct, cited answers against production data.
- [ ] Cite-or-refuse enforced on every answer path — no citation, no answer.
- [ ] Vote questions get the deflection response with a working bill-page pointer — never a partial vote answer.
- [ ] Citation URLs resolve per source type (bill / legislator), never defaulting to an unrelated bill page.
- [ ] Out-of-scope questions refuse politely with scope statement.
- [ ] "Support" questions use sponsorship/vote framing per §4.3.
- [ ] Placeholder copy matches capability ("bill or legislator" — no "votes").
- [ ] Existing bill-scoped chat is unchanged (regression: its citations still render and link).
- [ ] Topic-tag half of the coverage spike (§5.2) done for the launch chips' topics.

### v1.1 (fast follow)
- [ ] Coverage spike (§5.1) completed; vote-chip form decided (individual vs. chamber tally).
- [ ] `legislator_vote` path live with `VoteEvent.official_url` citations and the §4.2 fallback ladder.
- [ ] Person entity-resolution and "my legislator" location prompt shipped with it.
- [ ] Vote chip restored to the hero; placeholder updated to include votes.

## 7. Out of scope

Federal legislation · Minnesota Statutes corpus · opinion, prediction, or "is this bill good?" analysis · open-web retrieval · multi-model consensus. The refusal path names these as not-yet-covered rather than pretending.

## 8. Open questions

1. **(v1.1) "My legislator" on a signed-out page:** trigger the rep-lookup flow inline (address prompt) on first use, or seed the chip with a named legislator until the user runs Find My Legislator / signs in? Leaning: inline prompt reusing `POST /representative-lookups`. Deferred with the vote path — no v1 decision needed.
2. Should Ask sessions for signed-out users persist (currently chat sessions require auth)? MVP lean: answer inline without saving; prompt sign-in to save/follow up.
3. Model/latency budget for the router step (one extra LLM call per question).
