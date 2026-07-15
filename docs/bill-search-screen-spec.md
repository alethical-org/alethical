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
- **URL-addressable filters** — tracked in [#135](https://github.com/alethical-org/alethical/issues/135), split by milestone to keep v1 lean:
  - **v1 (inbound read):** the screen reads an inbound filter param on load (e.g.
    `?policy=education`) and applies it. Required because the Ask `bills-list` answer's
    "See all N {topic} bills in Search →" overflow ([#79](https://github.com/alethical-org/alethical/issues/79),
    grounded-ask §9.1) is cross-page navigation and can only target URL state
    (`.claude/rules/grounded-answers.md` #5). This slice lands with #79.
  - **v1.1 (full serialization):** all filters serialize *out* to the URL
    (`/bills?q=&chamber=&status=&policy=&omnibus=&session=&page=`) so reload, share, and
    back/forward reproduce the exact search. `webRoutes.ts` already serializes chat
    params — the same pattern extends here.

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
- **Omnibus pill** — a single prominent amber pill (capitol/gavel glyph + "OMNIBUS", fill
  `#fbf1e2` / border `#f0d6a8` / text `#8f5a12`) in the top row immediately after the bill
  pill, before the status word. Shown only when `is_omnibus` (surfaced per-bill on the
  `/bills` list item). One indicator only — it is not repeated in the meta block. (Text is
  darkened from the mockup's `#a76a1a`, which was 3.98:1 on the fill, to `#8f5a12` = 5.16:1
  to clear WCAG AA for 11px text.)
- **Bill title (short, plain-language)** — the card headline, largest text, clamped to 2
  lines. It leads with an AI-generated neutral `short_title` (`AIEnrichment`
  `bill_summary.short_title`) and falls back to the official statutory title when no
  `short_title` has been generated yet. The full official title always stays reachable via
  the headline's `aria-label` + web hover tooltip and on the bill detail page. (Rationale:
  `Bill.title` is an 827-char statutory run-on — no short title exists in any source — so a
  neutral generated headline is scannable while official data still leads on the detail
  page; Phase 1 clamp [#303](https://github.com/alethical-org/alethical/pull/303),
  short_title [#304](https://github.com/alethical-org/alethical/pull/304).)
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

**Actions**
- **Track button — auth-gated**, mirroring the answer/bill rail cards (`docs/mvp-redesign-plan.md`
  "Track stays auth-gated"; states owned by grounded-ask §9.2). Not a plain toggle:
  - Signed out: shows only "+ Track". Clicking triggers **intent-preserving sign-in**
    ("Sign in to track HF 2904"); after auth the user returns to this search with that
    bill's button affirmed. The affirmed state **never renders signed-out**.
  - Signed in: toggles "+ Track" ↔ "✓ Tracking".
  - Return-from-sign-in should land back on this search (its filter/scroll state
    preserved — `frontend-screen-system-design.md` line ~107; full URL restore is #135),
    not a generic dashboard.
- **Card link → bill Overview** (`/bills/:billId`), the detail screen (not yet redesigned;
  a Claude Design mock currently uses the Bill Votes frame as the stand-in target). This is
  distinct from the **roll-call chip → Votes tab** (`?tab=votes`) above — the chip is a
  deep link to the tab, the card link is to the bill's top-level detail.

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

Design against the **green / rounded / soft-shadow / bold-sans** direction
(`docs/mvp-redesign-plan.md` § Locked decisions; final visual mockups in Claude Design).
Design intent and the visual/interaction/accessibility rules are in `docs/design-principles.md`;
`apps/frontend/src/theme/tokens.ts` + `theme/primitives.tsx` are the implemented styling source of
truth. The green token flip has **landed** (PR [#67](https://github.com/alethical-org/alethical/pull/67)),
so this screen is both designed and built against the green tokens/primitives.
(`docs/aesthetics.md` is the retired Newsprint identity, kept for history only.)
