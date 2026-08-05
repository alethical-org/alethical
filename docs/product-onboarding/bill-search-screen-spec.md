# Bill search screen spec

<!-- describes: apps/frontend/src/screens/redesign/SearchBillsScreen.tsx, apps/frontend/src/components/search/BillResultCard.tsx, apps/frontend/src/lib/hotIssues.ts, apps/frontend/src/components/search/searchPieces.tsx, apps/frontend/src/components/billDetail/BillTrackButton.tsx, apps/frontend/src/hooks/useBillTracking.ts, apps/frontend/src/hooks/useDebouncedSearchCommit.ts, apps/frontend/src/hooks/useResponsive.ts, apps/frontend/src/lib/billDetail.ts, apps/frontend/src/lib/sessionLabel.ts, apps/frontend/src/navigation/ia.ts, apps/frontend/src/navigation/links.ts, alethical/api/routers/public.py, alethical/api/issue_taxonomy.py, alethical/api/serializers.py, alethical/pipeline/policy_area_counts.py -->

Status: v1 build spec. Companion to `docs/product-onboarding/mvp-redesign-plan.md` (§ "Search page split")
and `docs/product-onboarding/grounded-ask-spec.md` (the Ask answer pages link into this screen). Durable
answer/citation invariants live in `.claude/rules/grounded-answers.md`.

## Goal

Split the combined Bills + Legislators search into two dedicated screens. This spec
covers the **bill search screen** (`/bills`); the legislator screen follows separately.
Search is "the library" — query/filter-forward, public, no auth. The screen surfaces
more of the legislative record we already ingest, and keeps official data visually
distinct from AI-generated analysis (`docs/product-onboarding/product-scope.md` § Frontend Expectations).

## Route and URL-addressable state

- Route `/bills`; detail `/bills/:billId`. Redirect `/search` → `/bills`
  (`docs/product-onboarding/mvp-redesign-plan.md` route table).
- **URL-addressable filters** — tracked in [#135](https://github.com/alethical-org/alethical/issues/135), split by milestone to keep v1 lean:
  - **Shipped (inbound read):** the screen reads an inbound filter param on load (e.g.
    `?policy=education`) and applies it. Required because the Ask `bills-list` answer's
    "See all N {topic} bills in Search →" overflow ([#79](https://github.com/alethical-org/alethical/issues/79),
    grounded-ask §9.1) is cross-page navigation and can only target URL state
    (`.claude/rules/grounded-answers.md` #5). This slice lands with #79.
  - **Shipped (full serialization):** every filter serialises *out* to the URL
    (`/bills?q=&chamber=&status=&issue=&omnibus=&session=&sort=&page=`) so reload, share,
    and back/forward reproduce the exact search. #135 closed; the route params are the
    single source of truth in `SearchBillsScreen.tsx` (only the search-box draft and the
    issue-list expander stay local). Note the issue param is `issue=` (comma-joined
    canonical issues), not the `policy=` this spec first sketched.

## Page anatomy (top → bottom)

1. **Header** — H1 "Search bills"; a quiet secondary link "Looking for a legislator?
   Search legislators →" to the other split screen. No coverage claims in the subhead:
   search only surfaces AI-summarized bills, so copy may not say "every Minnesota bill"
   (`.claude/rules/grounded-answers.md` #6).
2. **Search bar** — placeholder "Search by keyword or bill number". The example bill
   numbers the first draft carried were dropped once number search shipped
   ([#134](https://github.com/alethical-org/alethical/issues/134)): the plain placeholder
   already names both inputs.
   Below the field, one helper line, no terminal period, "every" bold:
   "Results update as you type — bills match **every** word". It does not repeat "try a
   keyword or a bill number" — the placeholder directly above already says that.
3. **Filter row** — every filter is real and applies server-side (see below). The issue
   pills sit under their own mono "ISSUES" section heading, on its own line above the
   pills so every pill row starts at the container's left edge.
4. **Active-filter chip row** — one removable, facet-colour-coded chip per active filter,
   ending in a filled black "Clear all" pill. No mono "FILTERS" label: the chips
   self-label ("Chamber: House"), so the row carries `role="group"` +
   `aria-label="Active filters"` for screen readers instead.
5. **Results header** — one prose count line, "{N} bills as of {date}" (singular "1 bill"
   at one result; the date trails the unit noun in the same span, one word space apart, no
   separator glyph) · the sort control. Deliberately **no** prose description of the active
   facets: the chip row above already names every one of them, and the session clause that
   closed that sentence duplicated the always-visible session dropdown. The provenance date
   is ordinary prose, not a standalone uppercase mono "AS OF …" stamp.
   Sort sits on the **right** of the header strip on web; on mobile it moves to its own
   left-aligned row 18px below the count line, where a right-hung control read as scattered
   in a narrow column.
6. **Single full-width results column** of bill cards (the "library" list). No side rail, and
   that is now the settled layout rather than a deferral: browse-by-policy-area
   ([#130](https://github.com/alethical-org/alethical/issues/130), closed Jul 24 2026)
   shipped as the **ISSUES pill section in the filter row** above — item 3 — not as a rail
   beside the results.
7. **Pagination** — Previous · "Page N of M" · Next (server-backed `limit`/`offset`,
   advances on `has_more`; must not slice a bounded list locally). A page change
   scrolls the **results header** (item 5, the one-line "{N} bills · Sorted by …"
   row) to the top of the viewport (smooth, ~20px of air on web / ~12px on mobile),
   with the first result card directly beneath it, and moves keyboard focus there.
   The header — not the first card — is the anchor: it re-confirms the sort on
   every page and gives a clean "top of results" line for one line of cost. The
   filter stack (chip row, chamber/status/session, issue pills) stays scrolled off
   — that is what the reader already set. The new "Page N of M" is announced via
   `aria-live`. This is the shared `usePaginatedListScroll` hook wired through the
   `Pagination` control, so it fires on Previous/Next only — never on a filter,
   sort, or search keystroke. Any new paged list inherits it the same way.

## Copy punctuation on this screen

One-line captions, helper lines, chip / badge / button labels and value+unit readouts take
**no terminal period**, and a unit noun after a number stays lowercase ("10,000 bills",
never "10,000 Bills"). Multi-sentence body paragraphs keep normal punctuation — the
no-results explainer below is the reference case.

## Menus must open in front of the results

Every menu on this screen — status filter, session filter, sort — uses one recipe, because
this class of bug has shipped twice (the Legislator Profile session filter, and this
screen's sort menu opening *behind* the first result card):

- the trigger's positioned wrapper: `position: relative; z-index: 40`
- the menu itself: `position: absolute; z-index: 1` inside that wrapper
- rows and cards below must not create a competing stacking context — no gratuitous
  `position: relative` + `z-index`, `transform`, or `opacity` on the results list (a plain
  `box-shadow` is fine; it creates no stacking context)
- if a menu ever has to escape an `overflow: hidden` ancestor, portal it to the body rather
  than only raising `z-index`

react-native-web stamps `position: relative` + `z-index: 0` on *every* View, so the results
header itself carries `z-index: 40` — otherwise the sort control's wrapper is trapped in the
header's stacking context and, as an earlier sibling, paints under the card list.

## Filters (all backed by today's API)

| Filter | Control | API param |
|---|---|---|
| Keyword / bill number | search input | `q` — matches title/description by word: exact, common word-forms (plurals/-ing/-ed), and typo-tolerant (fuzzy matching applies to words of 5+ letters). Ranked best-match-first, with title matches weighted over description ([#573](https://github.com/alethical-org/alethical/issues/573)) — but that ranking is `sort=relevance` only, which is where a query defaults; see the Sort order row. A bill number ("SF 334", "334") is an exclusive ID lookup, not free text ([#134](https://github.com/alethical-org/alethical/issues/134)/[#569](https://github.com/alethical-org/alethical/pull/569)) |
| Chamber | segmented All / House / Senate | `chamber` |
| Status | dropdown: All statuses / Signed into Law / Passed both chambers / Passed Senate / Passed House / In Committee / Introduced / Vetoed (most-progressed first, matching `sort=progress`; "Passed both chambers" landed with [#607](https://github.com/alethical-org/alethical/issues/607)) | `status` |
| Session / year | dropdown: every ingested session, newest first, plus two inert greyed-out prior bienniums. Reads as its years ("2025–2026 Legislative Session"), except a special session, which keeps those words ("2025 First Special Session") — years alone cannot tell it apart from the biennium it sits inside ([#746](https://github.com/alethical-org/alethical/issues/746)) | `session` |
| Omnibus | toggle "Omnibus only" | `omnibus` |
| Policy area | selectable pills **with live bill counts** ("Education 214") | `policy_area` (counts from `GET /policy-areas`) |
| Sort order | "Sorted by" dropdown: Best match (offered, and the default, only while a keyword query is present) / Legislative progress / Latest action, plus an inert "Most tracked" roadmap row | `sort` — `relevance` / `progress` / `latest_action` |

Each sort option must genuinely reorder the results, so keyword relevance is applied
**only** to `sort=relevance` ("Best match"). The API originally prepended relevance to
*every* ordering whenever a query was present ([#726](https://github.com/alethical-org/alethical/pull/726)), with two consequences: "Best match" and
"Legislative progress" were **byte-identical on every query** (the frontend also mapped its
`best` key to `sort=progress`, so they sent the same request), and "Latest action" only
reordered *within* bands of equal relevance — measured on the production corpus that ranged
from no visible change at all ("social media minors", a bill-number lookup) to one swapped
pair ("guns"). Omitting `sort` on a free-text search still ranks best-match-first, so
relevance stays the search default for every API caller ([#573](https://github.com/alethical-org/alethical/issues/573)).

No author filter in v1 — possible on the ingested data, but out of scope for this screen.

## Bill result card

Two tiers: a **primary** tier for scanning, a **secondary** meta block one glance below.

**Primary**
- **Bill pill + status/progress** — the bill identifier ("HF 2904") with the status word
  ("In Committee") beside a compact 5-step progress motif matching the bill's legislative
  stages: Introduced → In Committee → Passed House → Passed Senate → Signed into Law, with
  Vetoed as a distinct terminal state. Chamber is not repeated as a word — HF/SF encodes
  it. (Status key derived at serialization from action text; `serializers.py`.)
- **Omnibus pill** — a single prominent amber pill (capitol/gavel glyph + "OMNIBUS", fill
  `#fbf1e2` / border `#f0d6a8` / text `#8f5a12`) in the top row immediately after the bill
  pill, before the status word. Shown only when `is_omnibus` (surfaced per-bill on the
  `/bills` list item). One indicator only — it is not repeated in the meta block. (Text is
  darkened from the mockup's `#a76a1a`, which was 3.98:1 on the fill, to `#8f5a12` = 5.16:1
  to clear WCAG AA for 11px text.)
- **Hot-issue flag** — a **neutral** pill ("🔥 Hot issue", fill `#f1f1f4` / border
  `rgba(17,21,15,0.08)` / text `#4f5651`, radius 999, 13px/700) shown only on bills the
  editor has flagged. Never amber — amber is reserved for bill-code identity, and a hot
  issue is an editorial flag, not a code. On web it sits in the card's top-right group to
  the left of the Track button (~16px gap), same row; on mobile it sits on the right of the
  identity row. The flagged set is the **same editorial list that drives the home Bill
  Activity / In the News cards** (`apps/frontend/src/lib/hotIssues.ts`,
  `HOT_ISSUE_BILL_KEYS`) — data-driven, not hardcoded per card — so a bill flagged for the
  home shows the flag in search results too. Off by default (`hotIssue` prop).
- **Bill title (short, plain-language)** — the card headline, largest text, clamped to 2
  lines. It leads with an AI-generated neutral `short_title` (`AIEnrichment`
  `bill_summary.short_title`) and falls back to the official statutory title when no
  `short_title` has been generated yet. The full official title always stays reachable via
  the headline's `aria-label` + web hover tooltip and on the bill detail page. (Rationale:
  `Bill.title` is an 827-char statutory run-on — no short title exists in any source — so a
  neutral generated headline is scannable while official data still leads on the detail
  page; Phase 1 clamp [#303](https://github.com/alethical-org/alethical/pull/303),
  short_title [#304](https://github.com/alethical-org/alethical/pull/304).)
- **AI summary** — 2–3 lines, no eyebrow label. (`AIEnrichment` `bill_summary`.) Always
  present *on this screen*, because its backing query still requires one
  (`bill_list_stmt` gates on `Bill.has_current_summary`) — but the shared card itself no
  longer guarantees a summary line, and omits it entirely rather than falling back to the
  official statutory title when a surface hands it a bill with no summary yet
  ([#1007](https://github.com/alethical-org/alethical/issues/1007), the Tracked page). Read
  this bullet as this screen's contract, not the component's. This
  originally specified a small purple "AI SUMMARY" eyebrow so official record and AI
  analysis were "distinguishable at a glance". That label was removed for a cleaner card in
  [#345](https://github.com/alethical-org/alethical/pull/345), and **the removal is the
  settled decision** ([#731](https://github.com/alethical-org/alethical/issues/731), closed
  Jul 29 2026 as not-planned). Two arguments carried it, and both are worth keeping here
  because this is the kind of line someone will otherwise "restore" as a bug fix:
  - Nothing is actually confusable. The bill page names its source in plain sight
    ("Source: Minnesota Legislature · revisor.mn.gov"), official text sits in its own
    **Bill Text** section quoted at length, and generated answers must carry a citation or
    not appear at all (`.claude/rules/grounded-answers.md` #1). A badge adds no separation
    that the page's structure does not already provide.
  - A label on every card in a long list is visual weight spent on a distinction the
    reader is not at risk of getting wrong. The plain-language summary *is* the product's
    value; annotating it with provenance chrome works against reading it.

  So `docs/product-onboarding/product-scope.md` (§ Frontend Expectations, "Clear
  distinction between official data and AI-generated analysis") is satisfied **structurally
  — by named sources, a separate official-text section, and the citation contract — not by
  per-element badges.** Read it that way before adding provenance chrome to any surface.

**Secondary meta block**, in render order:
- **Chief author (linked)** — "Chief author: Rep. Patti Anderson" (`Sponsorship` chief
  author, scoped to *this file's own chamber* via `chiefAuthor`, so a Senate file shows its
  Senate chief and not the House companion's author — the companion-contamination case).
  **No co-author count.** This line first specified "Author: Patti Anderson · +42
  co-authors" with the count from `BillStats.sponsor_count`; the shipped card carries
  neither the shortened label nor the count, and co-authors live on the bill page instead.
  Renders "Chief author: Unavailable" when the file has no chief on record.
- **Latest action + date** — "Latest action: Referred to Ways and Means · Mar 12, 2026"
  (`BillAction` / `Bill.latest_action_at`). More informative than a bare status word and
  explains the list ordering. The label is the curated plain-language action matching the
  bill's Actions tab, paired with the date of *that same* action rather than the bill's
  generic timestamp.
- **Effective date** — "Effective: August 1, 2026", or "various dates" for an omnibus whose
  sections start on different days. Shown **only** when the backend set `effective_date`,
  which it does solely for enacted bills with a date it can ground in the bill's own text or
  actions (`docs/product-onboarding/grounded-ask-spec.md` decision 8a covers the same line
  on the Ask answer page's bill card; resolution in `resolve_effective_date`,
  `alethical/api/routers/public.py`). Never inferred from the Minn. Stat. 645.02 default, so
  a law with no stated date simply omits the line.
- **Policy-area pills** — up to 3.
- **Roll-call chip** — "N roll calls", shown only when votes exist, links to the bill's
  Votes tab (`/bills/:billId?tab=votes`; the tab ships in v1 per grounded-ask §9.3).
  Puts "how everyone voted" one click from search.

**Actions**
- **Track button — now live, Aug 2026 ([#976](https://github.com/alethical-org/alethical/issues/976)).**
  The Track button is functional: it renders as a solid **ink** fill (background `#11150f`,
  white label with a leading "+" that flips to a check when tracked, 1px `#11150f` border,
  radius 10px, hovering to `#2c322c`) via the shared `BillTrackButton` (`useBillTracking`),
  used identically on the answer/bill rail cards and home. A signed-out tap routes through
  sign-in and returns to the bill at `?track=1` to complete the track; signed in it toggles
  the bill on the watchlist and reads "Tracked". This reverses the Jul 2026 roadmap-preview
  decision, where the button was an inert `aria-disabled` preview. Ink is the color role
  reserved for Track (green stays for other forward actions). The Track **nav** dropdown
  already offered Bills as a live entry; the on-card button now agrees. The Tracked page
  rebuild that #976's remaining part called for has since shipped
  ([#986](https://github.com/alethical-org/alethical/pull/986)), closing #976. On the card,
  the tap is swallowed (`pressInsideLink`) so it toggles instead of following the card's link
  to the bill.
- **Track stays off this screen's phone layout — and that is now a choice this screen makes,
  not something the card lacks** ([#1007](https://github.com/alethical-org/alethical/issues/1007)).
  `BillResultCard`'s phone layout used to render no Track control at all, so every surface
  using the card was Track-less on a phone; it now honours the same `showTrackButton` prop
  the desktop layout does, in its own third header row. This screen keeps passing
  `showTrackButton={isDesktop}`, so the crowded-top-row decision of
  [#596](https://github.com/alethical-org/alethical/pull/596) is unchanged here. Surfaces
  that do not pass the prop (the Tracked page, the Ask answer card) now show it on a phone,
  where a 44pt-minimum `size="mobile"` button is used rather than the 39px `size="card"`.
- **Card link → bill Overview** (`/bills/:billId`), the detail screen (not yet redesigned;
  a Claude Design mock currently uses the Bill Votes frame as the stand-in target). This is
  distinct from the **roll-call chip → Votes tab** (`?tab=votes`) above — the chip is a
  deep link to the tab, the card link is to the bill's top-level detail.
- **The card is a real `<a href>`, not a pressable div.** Right-click → "Open link in new
  tab", ⌘/Ctrl-click, middle-click and "Copy link address" all work on it, and the URL
  shows in the browser's status bar on hover; a plain left click is still a client-side
  transition with no page reload. Via the shared `linkProps` / `routePath` helpers
  (`apps/frontend/src/navigation/links.ts`), which generate the `href` from the same
  route → path switch the address bar uses, so a card's link and the URL it lands on
  cannot drift apart.
- **The controls inside the card stay plain pressables** — chief author, roll-call chip,
  Track. An `<a>` nested in an `<a>` is invalid markup and reads as one confused control
  to a screen reader, so each uses `pressInsideLink` instead: it cancels the click so the
  surrounding card's URL is not followed on top of the control's own action. Their own
  new-tab behaviour needs the card markup restructured (stretched-link overlay) and is
  tracked in [#760](https://github.com/alethical-org/alethical/issues/760).

**Deliberately excluded:** key points (too heavy to scan), version count (low value),
per-card official-source links (provenance lives one click away on detail). Keep it a
card, not a dashboard.

## Empty / no-results state

Calm no-results state, in four parts and nothing else: the icon, a heading, one line of copy,
and one button. No recap of the active filters — the real, removable chips sit ~90px above in
facet colour with working ✕ buttons, so a non-interactive echo below invites a click that does
nothing, sits *below* the line telling you to remove filters *above*, and disagreed with the
real row (it listed the legislative session, which is always active and can only be changed,
never cleared).

The copy **branches on how many filters are active**, because one generic message is wrong in
the most common zero-result state — a typo'd search with nothing else applied — where it names
a filter stack the user never built. The count is already computed for the chip row. None of
the three states takes a terminal period.

| Active filters | Heading | Subtitle |
| --- | --- | --- |
| 2 or more | No bills match all of these filters | Remove filters above, or clear them all, to widen your search |
| 1, the search term | No bills match “{query}” | Try fewer or different words, or check the spelling |
| 1, a single facet (issue / chamber / status / omnibus) | No bills match that filter | Try a different one, or clear it to see every bill |

"All of these filters" names the actual cause — the **intersection**. Not "your search" (points
at the query when the filter stack is usually the culprit), not "your filtered search"
(product-speak, names no cause), not "all of these search filters" ("search filters" is two
words doing one word's job, and the query *is* one of the chips). The 2+ subtitle says "filters"
plural on purpose: with several stacked, removing one often still returns zero, so a singular
instruction sets the user up to fail on the first try. The query heading takes
`overflow-wrap: anywhere` so a long search term cannot overflow the card.

The button is the same **black pill labelled "Clear all"** as the chip row's, because it is the
same action and both are on screen at once (shape and label conventions:
`docs/design/design-principles.md` §2, The green visual system — Shape). No "Ask AI instead"
cross-sell — a failed keyword search routed into Ask could end in a refusal, which
`.claude/rules/grounded-answers.md` #2 forbids inviting.

## Backend additions this screen needed — all three shipped ([#134](https://github.com/alethical-org/alethical/issues/134))

Written as pending requirements; kept as a record of what `GET /api/v1/bills` gained, because
each is still the thing the screen depends on:
1. **Bill-number search** — `q` matches `file_type`+`file_number` / `bill_key`, not only
   title/description. Shipped, and tightened to an *exclusive* ID lookup in
   [#569](https://github.com/alethical-org/alethical/pull/569) — see the Filters table.
2. **Total result count** — for "312 bills" and "Page N of M", where the endpoint previously
   returned only `has_more`. Shipped: the response carries `total`.
3. **"Data as of" timestamp** — latest succeeded `IngestionRun.finished_at`, for the
   provenance strip (also used by the Ask answer pages, grounded-ask §9.2). Shipped as
   `data_as_of`, and it is what the results header's "as of {date}" prints.

Everything else on this screen runs on the current API.

## Out of scope for this screen

- **Meaning-based search and natural-language questions — Grounded Ask's job, not this box.** The search box matches the *words* you type (now word-form- and typo-tolerant, [#573](https://github.com/alethical-org/alethical/issues/573)); finding bills by *concept* when the words differ (e.g. "school money" → a bill that says "fund") or answering a full question ("what bills help teachers?", "how did my rep vote on housing?") is `docs/product-onboarding/grounded-ask-spec.md` (§3.1 natural-language Ask box, §4.1 router intents). This is why there is deliberately no "Ask AI instead" cross-sell from a failed search (see Empty / no-results state above; `.claude/rules/grounded-answers.md` rule 2).
- Browse-by-policy-area **as a side rail** — still out of scope, and now permanently: [#130](https://github.com/alethical-org/alethical/issues/130) (closed Jul 24 2026) delivered the capability as the ISSUES pill section in the filter row instead, so the results column stays full-width (Page anatomy items 3 and 6).
- Author filter (data supports it; not built). The user-facing sort control **shipped** in [#610](https://github.com/alethical-org/alethical/issues/610) — see the Filters table above.
- Bill export.

## Aesthetic

Design against the **green / rounded / soft-shadow / bold-sans** direction
(`docs/product-onboarding/mvp-redesign-plan.md` § Locked decisions; final visual mockups in Claude Design).
Design intent and the visual/interaction/accessibility rules are in `docs/design/design-principles.md`;
`apps/frontend/src/theme/tokens.ts` + `theme/primitives.tsx` are the implemented styling source of
truth. The green token flip has **landed** (PR [#67](https://github.com/alethical-org/alethical/pull/67)),
so this screen is both designed and built against the green tokens/primitives.
