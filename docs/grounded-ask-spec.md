# Grounded Ask — Build Spec

Status: draft for engineering review
Owner: Eugene
Related surfaces: signed-out home (hero), chat

![Signed-out hero with Ask box and sample question chips](assets/grounded-ask-hero.png)

## 1. Goal and the promise this build protects

The signed-out home page hero ships this copy:

> **Grounded answers on Minnesota law**
> We read every bill so you don't have to — what it says, where it stands, and how everyone voted. Plain English, every answer linked to its source.

The subhead is a contract, not marketing: **no answer ships without a resolvable citation to its official source.** Everything in this spec exists to keep that sentence true when the hero's Ask box goes from bill-scoped chat to a general question box.

## 2. User-facing behavior

A signed-out visitor types a natural-language question into the hero Ask box. The system classifies the question, answers from ingested Minnesota data with citations, or honestly declines.

### Acceptance scenarios (the hero's sample chips — these are the tests)

| # | Question | Expected behavior |
|---|----------|-------------------|
| 1 | **What bills affect healthcare?** | List of current-session bills matching the topic (policy-area tag and/or keyword match), each with its AI summary line and a citation link to the bill's official page. |
| 2 | **Which legislators support affordable housing?** | Legislators who **authored or co-authored** bills matching the topic, with per-legislator bill counts and links to each legislator profile and the underlying bills. See framing rule in §4.3 — "support" must be reported as sponsorship/votes, never as inferred opinion. |
| 3 | **How did my legislator vote on cannabis?** | If the user's legislator is known (see §8 open question), the roll-call answer with vote position, tally, date, and a citation to the roll call's official record. If no roll call exists on matching bills, say so plainly and offer the chamber tally or the bill's status instead. |
| 4 | *Out of scope question (e.g., federal bill, statute lookup, "is this bill good?")* | Polite refusal that names what we do cover. No hallucinated answer. |

Every answer ends with tappable citations using the existing citation panel pattern (excerpt + highlighted passage where applicable + "Open official source").

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
Classify each Ask into: `bill_text` (RAG over a resolved bill) · `topic_bills` (scenario 1) · `topic_legislators` (scenario 2) · `legislator_vote` (scenario 3) · `refuse` (scenario 4). Bounded LLM classification step; low temperature; the router's output is a typed intent, not free text.

### 4.2 Structured-answer formatters (2–3 thin functions)
Each takes existing query results and produces a plain-English answer **plus a citations array** in the same shape `me.py` already emits (`citation_label`, `excerpt`, `url`, …):
- `topic_bills`: policy-area + keyword match → bill list with AI summary lines; cite each `Bill.official_url`.
- `topic_legislators`: join topic-matched bills → `Sponsorship` → legislators; cite `Legislator.profile_url` + underlying bills.
- `legislator_vote`: resolve legislator + topic → `VoteRecord` via `/legislators/{id}/votes` join; cite `VoteEvent.official_url`. Fallback ladder: individual vote → chamber tally (VoteEvent counts parse even when names don't match) → bill status.

### 4.3 Framing rule for "support" (scenario 2)
Grounded neutrality: the answer must say what the record shows — "authored or co-sponsored N bills on affordable housing," "voted yes on HF xxxx" — never "supports affordable housing" as an opinion claim. The word "support" in a user's question is interpreted as *sponsorship and/or yes-votes* and the answer says so explicitly.

### 4.4 Generalized citation source URLs
Today `me.py` hardcodes `url = bill.official_url`. Generalize: citation URL is chosen per source type — bill → `Bill.official_url`, roll call → `VoteEvent.official_url`, legislator → `Legislator.profile_url`. No citation without a resolvable URL.

### 4.5 Cite-or-refuse guardrail (router level)
Extend the existing empty-retrieval fallback into a hard invariant for all four answer paths:
- Every answer must carry ≥ 1 citation with a resolvable URL, or the system refuses.
- Add a retrieval-relevance threshold so weak matches refuse rather than stretch.
- Out-of-scope classes (federal, statutes, opinion/prediction, open web) refuse with a one-line statement of what Alethical does cover.

### 4.6 Entity resolution for legislators
Name/nickname → legislator id, tolerant of partial names and misspellings. `/search` and the name-matching in `votes.py` (`legislator_keys`, `build_legislator_index`) are starting points. "My legislator" resolution depends on §8.

## 5. Coverage spike — gate before full build

Half-day task against the live DB, before committing to the chip set:
1. What share of current-session bills with floor action have legislator-level `VoteRecord`s? (Check `no match` log rate from `votes.py`.)
2. Do policy-area tags + keyword search reliably surface bills for: healthcare, affordable housing, cannabis?

**Decision rule:** if individual-vote coverage is thin, reshape chip 3 to the chamber-tally form ("How did the House vote on cannabis?") — still cited, always answerable. If topic tags are weak for a term, tune the keyword backstop before launch.

## 6. Definition of done

- [ ] The three hero chips return correct, cited answers against production data (or the documented graceful fallback).
- [ ] Cite-or-refuse enforced on every answer path — no citation, no answer.
- [ ] Citation URLs resolve per source type (bill / roll call / legislator), never defaulting to an unrelated bill page.
- [ ] Out-of-scope questions refuse politely with scope statement.
- [ ] Scenario 2 answers use sponsorship/vote framing per §4.3.
- [ ] Existing bill-scoped chat is unchanged (regression: its citations still render and link).
- [ ] Coverage spike (§5) completed and chip set confirmed or reshaped.

## 7. Out of scope

Federal legislation · Minnesota Statutes corpus · opinion, prediction, or "is this bill good?" analysis · open-web retrieval · multi-model consensus. The refusal path names these as not-yet-covered rather than pretending.

## 8. Open questions

1. **"My legislator" on a signed-out page:** trigger the rep-lookup flow inline (address prompt) on first use, or seed the chip with a named legislator until the user runs Find My Legislator / signs in? Leaning: inline prompt reusing `POST /representative-lookups`.
2. Should Ask sessions for signed-out users persist (currently chat sessions require auth)? MVP lean: answer inline without saving; prompt sign-in to save/follow up.
3. Model/latency budget for the router step (one extra LLM call per question).
