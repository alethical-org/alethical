# Bill search screen spec

Status: v1 build spec. Companion to `docs/mvp-redesign-plan.md` (§ "Search page split")
and `docs/grounded-ask-spec.md` (the Ask answer pages link into this screen). Durable
answer/citation invariants live in `.claude/rules/grounded-answers.md`.

## Goal

Split the combined Bills + Legislators search into two dedicated screens. This spec
covers the **bill search screen** (`/bills`); the legislator screen follows separately.
Search is "the library" — query/filter-forward, public, no auth. The screen surfaces
more of the legislative record we already ingest, and keeps official data visually
distinct from AI-generated analysis (`docs/v1-scope.md` § Frontend Expectations).

## Route and URL-addressable state

- Route `/bills`; detail `/bills/:billId`. Redirect `/search` → `/bills`
  (`docs/mvp-redesign-plan.md` route table).
- **All filter/query state serializes into the URL** (`/bills?q=&chamber=&status=&policy=&omnibus=&session=&page=`).
  This is a hard requirement, not a nicety: the Ask `bills-list` answer's
  "See all N {topic} bills in Search →" link (grounded-ask §9.1) is cross-page
  navigation and can only target URL state, per `.claude/rules/grounded-answers.md` #5.
  Reloading or sharing a filtered search must reproduce it.

## Page anatomy (top → bottom)

1. **Header** — H1 "Search bills"; a quiet secondary link "Looking for a legislator?
   Search legislators →" to the other split screen. No coverage claims in the subhead:
   search only surfaces AI-summarized bills, so copy may not say "every Minnesota bill"
   (`.claude/rules/grounded-answers.md` #6).
2. **Search bar** — placeholder "Search by keyword or bill number (e.g. HF 2904, SF 1832)".
   The bill-number example depends on number search shipping ([#134](https://github.com/alethical-org/alethical/issues/134)); if that slips, drop the example.
3. **Filter row** — every filter is real and applies server-side (see below).
4. **Results header** — total count · fixed "Sorted by latest action" label ·
   "Data as of {date}" provenance strip.
5. **Single full-width results column** of bill cards (the "library" list; no side rail
   in v1 — browse-by-policy-area rail deferred to [#130](https://github.com/alethical-org/alethical/issues/130)).
6. **Pagination** — Previous · "Page N of M" · Next (server-backed `limit`/`offset`,
   advances on `has_more`; must not slice a bounded list locally).

## Filters (all backed by today's API)

| Filter | Control | API param |
|---|---|---|
| Keyword / bill number | search input | `q` (title/description today; + bill number via [#134](https://github.com/alethical-org/alethical/issues/134)) |
| Chamber | segmented All / House / Senate | `chamber` |
| Status | dropdown: All / Proposed / In Committee / Passed House / Passed Senate / Signed into Law / Vetoed | `status` |
| Session / year | dropdown | `session` |
| Omnibus | toggle "Omnibus only" | `omnibus` |
| Policy area | selectable pills **with live bill counts** ("Education 214") | `policy_area` (counts from `GET /policy-areas`) |

No author filter and no user-facing sort control in v1 (order is fixed to latest
legislative action — hence the fixed "Sorted by latest action" label). Both are
possible on the ingested data but out of scope for this screen.

## Bill result card

Two tiers: a **primary** tier for scanning, a **secondary** meta block one glance below.

**Primary**
- **Bill pill + status/progress** — the bill identifier ("HF 2904") with the status word
  ("In Committee") beside a compact 5-step progress motif matching the bill's legislative
  stages: Proposed → In Committee → Passed House → Passed Senate → Signed into Law, with
  Vetoed as a distinct terminal state. Chamber is not repeated as a word — HF/SF encodes
  it. (Status key derived at serialization from action text; `serializers.py`.)
- **Official bill title** — the card headline, largest text. (Today's card leads with the
  summary and omits the title; official data leads.)
- **AI summary** — 2–3 lines under a small "AI SUMMARY" eyebrow label, so official record
  and AI analysis are distinguishable at a glance. (`AIEnrichment` `bill_summary`.)

**Secondary meta block**
- **Chief author (linked) + co-author count** — "Author: Patti Anderson · +42 co-authors"
  (`Sponsorship` chief_author; count from `BillStats.sponsor_count`).
- **Latest action + date** — "Latest action: Referred to Ways and Means · Mar 12, 2026"
  (`BillAction` / `Bill.latest_action_at`). More informative than a bare status word and
  explains the list ordering.
- **Policy-area pills** — up to 3.
- **Roll-call chip** — "N roll calls", shown only when votes exist, links to the bill's
  Votes tab (`/bills/:billId?tab=votes`; the tab ships in v1 per grounded-ask §9.3).
  Puts "how everyone voted" one click from search.
- **Omnibus badge** — only when `is_omnibus`.

**Actions** — Track button (unchanged behavior); whole card → bill detail.

**Deliberately excluded:** key points (too heavy to scan), version count (low value),
per-card official-source links (provenance lives one click away on detail). Keep it a
card, not a dashboard.

## Empty / no-results state

Calm no-results state: "No bills match your search", a recap of active filters, and a
"Clear filters" action. No "Ask AI instead" cross-sell — a failed keyword search routed
into Ask could end in a refusal, which `.claude/rules/grounded-answers.md` #2 forbids
inviting.

## Backend deltas required ([#134](https://github.com/alethical-org/alethical/issues/134))

The screen assumes three small additions to `GET /api/v1/bills`:
1. **Bill-number search** — `q` matches `file_type`+`file_number` / `bill_key`, not only
   title/description.
2. **Total result count** — for "312 bills" and "Page N of M" (today only `has_more`).
3. **"Data as of" timestamp** — latest succeeded `IngestionRun.finished_at`, for the
   provenance strip (also needed by the Ask answer pages, grounded-ask §9.2).

Everything else on this screen runs on the current API.

## Out of scope for this screen

- Browse-by-policy-area side rail — [#130](https://github.com/alethical-org/alethical/issues/130) (v1.1).
- User-facing sort control and author filter (data supports both; not needed to launch).
- Bill export.

## Aesthetic

Match the green / rounded / soft-shadow / bold-sans language established across the
current redesign frames (`docs/mvp-redesign-plan.md` § Locked decisions). Note:
`docs/aesthetics.md` still documents the superseded "Newsprint" style — it does not
govern this screen.
