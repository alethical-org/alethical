# NEXT Bill Detail — spec notes (design-side source of intent)

Decisions from the full-build interview (Jul 2026). Claude Code owns repo work;
this file records rules to bake into the handoff.

## Purpose
Help a non-political user quickly understand what the bill really says —
fast snapshot first, deeper read on scroll. Readability/scanning over dense text.

## Tabs
**Summary / Actions / Votes / Versions** (no Authors tab). Versions is LAST —
deliberately de-prioritized (low-traffic, power-user reference).
- Summary = default tab. Deep link pattern: `/bills/sf-2310?tab=votes`.
- **Chief author lives in the right-rail facts card** (web), not the top info
  strip — the strip is just the eyebrow + companion. Co-authors DE-emphasized
  (count only). (Mobile keeps author in the header for now — revisit.)
- **Eyebrow = `{CHAMBER} · {years} LEGISLATIVE SESSION`** (e.g. "SENATE · 2025–2026
  LEGISLATIVE SESSION"). "Legislative" is KEPT before "session" — educational for
  non-political readers (REVERSES the earlier drop rule; see CLAUDE.md). Only NEXT Bill
  Detail mobile is updated so far; web + other screens still read "{years} SESSION" —
  migrate separately. The Search session
  PICKER keeps the full "94th Legislature (2025–2026) Regular Session" option
  labels (it names/distinguishes each Legislature — allowed).

## Summary tab — hierarchy
The cited **Key points ARE the plain-language summary** — one structured,
scannable, cited overview, NOT a prose paragraph duplicated by bullets.
1. **Key points lead** (web): bulleted major provisions in plain language, each
   with a purple citation chip (round ink bullets; chips visible, enlarged tap
   area on mobile) — points + citations together, the structured snapshot.
2. "From the bill" excerpt cards (chip tap highlights the matching card) — deeper
   detail/evidence.
3. Facts rail (right): WHERE IT STANDS, CHIEF AUTHOR, COMPANION BILL, ISSUES,
   OFFICIAL SOURCES.
- **Redundancy removed (web):** the standalone plain-language prose paragraph was
  dropped — it restated the bullets on the same view. The cited bullets carry the
  plain-language meaning AND the citations. (Chose this over collapsing into
  prose-with-inline-citations, which would weaken the structured overview.)
- **Mobile** keeps the plain-language paragraph as supporting context AFTER the
  bullets (small-screen scan flow); revisit when mobile is aligned.
- **No "AI SUMMARY / every point cited" eyebrow** — contextual minimalism, the
  purple citation chips already show it's cited. Just do it, don't label it.
- Key-point bullets are **round, ink `#11150f`** (not green squares).
- **"From the bill" excerpt cards match the home hero badge:** purple number
  chip + short descriptive label, italic green-left-border quote. NO "Section"
  word in each card, NO page number, NO per-card revisor line. A single **"Cited
  Sections ✓"** label (mono grey + green circle-check) sits beside the "From the
  bill" heading — no enumerated § numbers (the per-card chips carry traceability).
- Heading is **"In plain language"** (aligns with home hero "Plain language").
- **ISSUES** (not "Policy areas"): the category is called *issues* universally.
- **OFFICIAL SOURCES rail:** `revisor.mn.gov` is written ONCE for the block (not
  repeated under each link).
- **Chamber-labeled bill section** (above Chief Author). Label "SENATE BILL" /
  "HOUSE BILL"; left: non-clickable code badge "SF 2310" (code only) in the
  **refined amber chip** (`#fbf1e2`/`#f0d6a8`/`#a76a1a` — the same lighter amber as
  the OMNIBUS tag; pops against the cool chips; code vs omnibus distinguished by
  content, not weight) + "Bill overview →" + state-dependent
  "Read the full law →"/"Read the bill text →". Right: "COMPANION → House (HF
  100)" (off to the right, when present). No revisor.mn.gov tag; no separate
  Official Sources block. The rail's WHERE IT STANDS owns status: **status label
  FIRST** (16px, semantic green/grey/red), **then the progress bars** (matches
  the home card order) + date.
- **Affects statutes REMOVED** from the primary card → roadmap (power-user).
- Full bill text is NOT embedded; official source links instead.

## Source line (all tabs)
Every tab ends with one quiet source line — mono grey, `margin-top:52px` +
hairline top border so it sits subtly on its own: Summary/Versions "Source:
Minnesota Legislature · revisor.mn.gov"; Actions "…bill status records…"; Votes
"…roll-call records…". No ↗ arrow after revisor (quieter).
Full action history timeline (introduced → referrals → readings → passage →
signing), amendments folded in with outcomes.
- **Dot legend** (quiet row at top): ● enacted milestone · ● recorded vote (black)
  · ○ procedural step · ● failed/not adopted (red). No prose clarifier about dots-
  vs-pills — the two are visually self-evident and a sentence there reads cluttered/
  redundant (removed). Green/red are reused across dots and ADOPTED/NOT ADOPTED
  pills intentionally (good=green/bad=red is reinforcing).

### Dot taxonomy — EXPLICIT RULE (implement deliberately, don't classify by example)
Dot chosen by what the action DOES, not its wording:
- **Green** = consequential legal state-change (Signed, Law effective).
- **Black** = a recorded roll-call vote (has a tally).
- **Hollow/procedural** = step with no vote and no change in legal force
  (introduced/first reading, referrals, re-referrals, committee report,
  **Presented to the Governor** — a handoff, not yet a legal change).
- **Red** = a failed vote or a not-adopted amendment.
Confirmed deliberate: "Presented to the Governor" hollow, "Signed" green —
consistent across the whole milestone pathway. Amendment outcome rides the
ADOPTED/NOT ADOPTED PILL, a separate axis from the dot.

### Future / scheduled actions (EXPLICIT RULE)
- Actions dated AFTER the data snapshot ("now" = the Last-updated date) render as
  **SCHEDULED, not completed**: dashed green-ring dot (vs. filled green), a
  "SCHEDULED" badge, and a muted grey title. Newest-first ordering floats them to
  the top of the timeline. Legend gains a "Scheduled" swatch.
- Applies to ANY future-dated action — most commonly a **delayed / phased
  effective date** (a provision taking effect months after signing), also future
  scheduled steps. Production: `upcoming = actionDate > today`. Demonstrated by
  SF 2310's "Automatic expungement begins · Jan 1, 2027" phased milestone
  (mock "now" = Mar 21, 2026).
- **Plain-language key** (bottom) — MOCK is a STATIC per-bill stand-in. Production
  must **generate the key dynamically** from terms actually present in each bill's
  action rows, matched to a maintained MN-legislature term dictionary (so
  conference committee, veto override, suspension of rules, division of a question,
  etc. get entries automatically). **Completeness is all-or-nothing:** any term
  rendered in a row but missing from the dictionary must be caught (lint/log) —
  partial glossing is worse than none. Mock now covers all terms visible in the
  three demo bills (added *repassed*, *concurrence*). **Supersession:** once inline
  hover/tap tooltips (roadmap) ship, they REPLACE the standalone bottom key — never
  maintain both.
- Freshness stamp relabeled **"LAST UPDATED {date}"** (was "AS OF", which read as
  stale-data sitting above 2025 events). Applied to Actions + Votes.
- Declined the optional chamber color-lean (#5): the "Senate floor"/"House floor"
  subtitles already carry chamber, and a color lean would collide with the dot
  color language.

## Versions tab
Bill versions (introduced / engrossments / as amended) each linking to the
official source. No embedded text.

## Votes tab
- Roll call is emphasized over co-authors. Highly visual green/red member
  indicators (visual inspo file from user: uploads/ — see build).
- Vote labels are **Yes / No** everywhere (never Yea/Nay) — plain-language.
- **Expanded roll call is GROUPED BY PARTY** — a Democratic-Farmer-Labor block and
  a Republican block. Party comes from a REAL 2025–2026 roster map (Republican
  surname sets per chamber; everyone else DFL) so seat counts match the real
  chamber (Senate 34 DFL / 33 R) and the sections are trustworthy. Each block
  header shows **seats + the party's Yes–No split** (green Yes · red No), which
  quantifies the crossover story. **Crossover votes** (against the party majority)
  also carry a small amber dot. NOTE: party is hardcoded in the mock — production
  wires real member party from the roster/API.

## v2 consolidation pass (NEXT Bill Detail web v2.dc.html)
A "systematize what was designed screen-by-screen" pass across all four tabs:
- **Teaching-intro pattern on ALL four tabs** — one plain-language sentence at the
  top of each tab saying "what am I looking at," same voice/position. Summary
  ("The essentials of the bill in plain language…") and Actions ("Every official
  step this bill has taken, newest first…") added to match the Votes + Versions
  intros.
- **One glossary mechanism** — a single hover treatment (`abbr[data-term]`, dotted
  underline + native tooltip) replaces the mixed patterns (Actions' 2-col
  definition grid → one "hover any underlined term" line). Build target: a shared
  term dictionary that auto-tags every insider term with this same treatment
  wherever it appears. **Mobile/a11y: MUST be tap-to-reveal, not hover** — native
  `title`/hover doesn't fire on touch and hover-only violates our no-affordance-
  only-in-hover rule. Production: tap the dotted term → inline/popover definition
  (tap-away dismisses); hover is a desktop enhancement, not the only path.
- **Green-usage split** — interactive INLINE text links get `a[data-tlink]` solid
  underline (green + underline = clickable); status/outcome greens (Signed-into-Law
  label, PASSED pill, Yes votes, enacted dots) stay green WITHOUT underline;
  block/card links (version rows) keep border-hover + arrow instead of underlining
  the whole card. So "clickable" always reads clickable and never blurs with
  green status.
- **Arrow (→) vs. underline (mutually exclusive affordances):** INLINE text links
  use the underline ONLY, no trailing arrow (removed from Bill overview / Read the
  full law / Read the bill text / companion — the arrow left an un-underlined gap
  and doubled the affordance). The arrow (→ or chevron icon) is reserved for
  NON-underlined links: whole-card/CTA targets (version rows) and directional nav.
  So a link shows exactly one affordance: underline (inline) OR arrow (card).
  Pill/chip links (roll-call member names) use their button background as the
  affordance — neither underline nor arrow. Applies to every inline text link on
  every tab.
- **State-aware link** — already one rule (see naming rules above); v2 leaves it as
  the single source to fold into a component at build.
REMAINING for build (token/component level, not per-screen): the shared glossary
dictionary + auto-tagging, and promoting the state-aware link to one component.

### Official-link naming rules (consistent everywhere — rail + Versions rows)
- **"Bill overview →"** = the bill's revisor STATUS/overview page (not a text
  document). Used once in the rail "THIS BILL" section.
- **"Read the full law →"** = the ENACTED text — a signed bill's Session Law /
  chapter (state-aware: only when `status === 'signed'` / the version `isLaw`).
  Used in the rail (readLabel) AND on the Versions "Session Law" row.
- **"Read the bill text →"** = the bill DRAFT text for anything not yet law
  (in-progress bills in the rail; engrossments + "As introduced" rows on Versions).
- Verb is **"Read"** everywhere (never "View") for these document links; "Bill
  overview" is the only one that isn't a "Read the …" because it's a status page,
  not a document. One state-aware component should own this logic + wording at build.
- **Authoring-party framing (one line on the Votes header, NOT per card):** "Chief
  author is {party} — {party} members largely backed this bill and {other} largely
  opposed it; amendments from the other side can flip that. The • marks members who
  crossed their party." Describes the BILL's overall pattern (not a per-vote
  promise) and explicitly flags that opposition-pushed amendments invert the split
  (e.g. the delay-retail amendment: DFL mostly No, R mostly Yes). Dot key folded in
  here only — no per-card footer. Party from the chief author's party.
- **Collapsed bar uses the full-chamber denominator** — green Yes + red No +
  neutral remainder for non-voters (a 34–32 in a 67-seat Senate shows the missing
  member, not a fully-filled bar). Conditional: an all-voted roll (34–33 = 67) has
  no neutral segment. The abstention count is stated inline next to the tally
  ("34–32 · 1 didn't vote") so the gray gap is explained without expanding.
- PARKED (future): a **threshold tick mark on the bar** showing where the pass line
  sits (e.g. the 34-vote constitutional majority) — powerful for close votes, adds
  complexity; not this round.
- **Independent card toggles** (not an accordion): expanding one roll does NOT
  collapse others, so two roll calls compare side by side. Each open card keeps its
  OWN filter + search state (per-roll openRolls/rollFilters/rollSearches maps).
- **Vote-ID is a link** ("Senate Vote 512" → official record on revisor).
- **Pass/fail is per-roll**, not one threshold: final passage / concurrence / veto
  override = constitutional majority; amendments & procedural = majority of those
  present and voting. Production must apply the correct threshold per motion type.
- **Crossover = voting against your OWN party's majority position on THAT vote** —
  computed per vote from each party's actual majority (which side most of that
  party voted), NOT a hardcoded "DFL=Yes" expectation. Must stay correct when a
  party's majority is No, or on bipartisan votes. (Mock constructs crossovers so
  they read right; production must derive them.)
- **Single source of truth:** the crossover dots and the header Yes–No splits MUST
  derive from the same per-member vote data so they can never drift apart (dot
  count = that party's minority-side count). True in the mock (one members array).
- **Validation guard:** sum-check every render — each block's Yes+No (+ didn't
  vote) must equal that party's seat count, and Yes(DFL)+Yes(R) must equal the
  recorded Yea (same for No/Nay); impossible combinations must surface as errors,
  not silent bad renders. (Mock logs a console.warn; production should hard-fail
  in dev / flag the record.)
- **Empty states:** hide (never show "0") — the "Didn't vote" filter tab appears
  only when absent > 0; the "Crossed party lines" key appears only when the roll
  has ≥1 crossover; search filters across BOTH party blocks while preserving the
  grouping (never flattened to one list).
- **Filter row = All · Yes · No** (+ **Didn't vote** ONLY when absent > 0 — hidden
  at zero), each showing its live count. Replaces the old static caption.
- **Search-by-name field** in the filter row narrows the roster live within the
  open roll.
- **Each member chip is a link** to that legislator's profile (whole pill
  clickable; hover cue on the border).
- **Per-vote one-liner** under each motion: plain "what this vote decided"
  (e.g. "Passed the bill in the Senate", "Rejected the push to delay retail sales").
- Party + per-member vote are generated in the mock (stable hash → party;
  votes party-aligned to the exact tally with forced crossovers). PRODUCTION uses
  REAL party + vote data.
- **DEFERRED (roadmap): rich per-member hover card** (title, district w/ place,
  author/co-author status on this bill, committee tags + more). Reasons it wasn't
  built in the mock: (1) hover-only rich data violates our no-affordance-only-in-
  hover a11y rule — the chip-as-link already gives touch/keyboard users the full
  profile; (2) fabricating committees/titles for 201 members is data slop. Build
  in production from real data WITH a non-hover path (the pill link IS that path).
- High-level vote summary (tally, PASSED/FAILED, green/red proportion bar) +
  expandable full roll call.
- "Your legislators voted…" pinned on roll calls when signed in with saved
  district (from Find My Legislator). Signed out → blurred teaser + account CTA
  (the page's conversion hook; business goal is converting to paid accounts —
  no paid tier exists yet).
- Notable "no" votes identifiable at a glance without heavy reading.

## Mobile ordering
Lead with key points / AI overview; roll call toward the BOTTOM of the page.

## Header — title-first (stable across tabs)
The **bill title is the hero** (top-left). Under it, one line: **session year**
("2025–2026 LEGISLATIVE SESSION") + OMNIBUS tag. NO status in the header — it is
integrated fully into the rail's WHERE IT STANDS (stage label beside the progress
bars). Header is identical on every tab (no shift); other tabs don't repeat
status since Summary is the default landing tab. Bill code lives in the rail BILL
section. Deep-link removed.

## Chief author display (web rail)
Fields are **labeled** "Party" and "District":
- **Party** spelled out (DFL → "Democratic–Farmer–Labor", R → "Republican",
  I/Ind → "Independent"; Independent is the fallback so an edge-case member never
  breaks the label).
- **District** place-led, code in parens ("Minneapolis (SD 62)"; bare number =
  Senate SD, number+letter = House e.g. "44A").
Co-authors sit **top-right of the CHIEF AUTHOR section header** ("+N co-authors"),
de-prioritized and away from the author's name/party/district. (Mobile author
display deferred with the rest of the mobile pass.)

## Rail "THIS BILL" section (identity + official links)
Section label is chamber-specific: **"SENATE BILL" / "HOUSE BILL"** (teaches
SF=Senate / HF=House). Left group: **non-clickable code badge** "SF 2310" (code
only — chamber lives in the label) in the **refined amber chip** `#fbf1e2`/`#f0d6a8`/`#a76a1a` (a lighter amber that
pops against the cool green+purple chips). The **code badge is FILLED** amber; the
**OMNIBUS tag is a transparent/ghosted amber outline** (`transparent`/`#e3c17f`/
`#a76a1a`) — same hue, distinguished by fill (solid code vs ghosted omnibus), so
they don't collide where adjacent (home/search). Black/ink stays reserved for Track. → **"Bill overview →"** link (goes to that badge's revisor page)
→ state-dependent text link (enacted → "Read the full law →"; in progress / not
law → "Read the bill text →"). Right group: **COMPANION "House (HF 100) →"**
(green link, off to the right, when present). No revisor.mn.gov tag; no separate
Official Sources block. (Standing: **black/ink filled badge-buttons are reserved
for Track features** — don't reuse ink fills for other chips.)

## Tracking — REMOVED from bill detail
No Track/Tracking controls on this page (header, votes empty state, etc.).
Tracking still lives on Search and Tracked Bills. Deferred to roadmap. The
sign-in modal now has ONE intent: `votes` ("see your legislators"). No toast.

## Logo
Nav uses the canonical two-peaks mark (assets/alethical-favicon.svg geometry) in
ink `#11150f` on the light product surface, wordmark ink — one lockup. (Replaces
the old three-bar glyph.)

## Ask integration
"Ask about this bill" included (placement: in-flow, NOT a persistent right-rail
module on every tab). Routes to Ask pre-scoped to the bill; free/ungated per Ask spec.
The in-committee no-votes empty state uses an **Ask** CTA (not tracking).
- **"Cited Sections ✓"** label is right-aligned in the "From the bill" heading
  row (heading left, label right at the card column's edge — matches the section-
  header pattern used elsewhere: title left, meta right).
- **Ask module** = **white card with a soft ambient shadow**
  (`0 10px 30px rgba(17,21,15,0.08), 0 2px 8px rgba(17,21,15,0.05)`) that lifts it
  off the page; white field (border-defined) inside. Purple only on the Ask button
  + chip-hover glow.

## Demo states (preview band)
Signed (SF 2310) / In Committee / Vetoed. Status label is "Introduced", never
"Proposed".

## Build decisions (Jul 2026 full build)
- **No separate chamber-summary cards.** Every roll card carries the high-level
  summary itself: motion, PASSED/FAILED, tally, and a green/red proportion bar —
  expandable to the full member grid. (Avoids repeating the same tally twice.)
- **Roll call grid** (visual inspo: uploads/rollcall_inspo-1784294218456.jpg):
  member chips grouped into DFL / Republican blocks — green ✓ Yes / red ✕ No /
  grey – didn't vote — so red "no" chips pop against the green mass. All/Yes/No/
  Didn't-vote segmented filter (with live counts) + search-by-name; chips link to
  profiles; crossovers marked with an amber dot. One roll open at a time; web
  defaults first roll open, mobile defaults all closed. (Mobile still on the
  OLD flat-chip version — parity update is on the roadmap.)
- **Vetoed bills:** passage roll calls keep PASSED badges (they did pass); the
  veto is carried by the status pill, LATEST ACTION line, and a red terminal
  event in Actions. Never relabel a passed roll because of a later veto.
- **Actions timeline:** newest first; dots encode kind (green = signed/effective,
  red = veto/not-adopted, black = floor vote, hollow = procedural). Amendments
  fold in with ADOPTED / NOT ADOPTED (+tally) badges. "View roll call" on a vote
  row deep-opens that roll on the Votes tab (web).
- **Sign-in modal has ONE intent** (intent-preserving): `votes` ("Sign in to see
  your legislators" → returns with district revealed). Tracking removed.
- **No-votes empty state** (in-committee bills) uses an Ask CTA — no tracking.
- **Mobile is one scrolling page** (no tabs): sticky jump chips (Summary ·
  Actions · Votes · Versions) anchor-scroll; the heavy Votes section sits near
  the bottom (per requirement) and the low-value Versions list is last (mirrors
  the web tab order). Sign-in is a bottom sheet inside the phone frame.

## Mobile refinement pass (Jul 18, 2026) — SUPERSEDES stale mobile notes above
Re-aligned mobile to the "understand it fast, bullets first, citations visible,
excerpts later" priorities. These decisions override the earlier "mobile keeps
the plain-language paragraph", "mobile still on the OLD flat-chip version", and
"independent card toggles" notes **for mobile**.
- **Verbatim excerpts REMOVED from mobile summary.** The "From the bill" quote
  cards (full statutory quotes + the citation-chip → excerpt highlight) are gone —
  they were the "quoted excerpts from official text" + "deep links to exact
  passages" the user scoped as LATER. Roadmap: bring back verbatim excerpts +
  jump-to-passage as an advanced source feature. Web still shows excerpt cards for
  now (not touched this pass) — revisit for parity.
- **Citations now = always-visible `§section · label` chip per key point** (mono,
  purple `#5b30d6`/`#f0ebfc`/`#d8c9f7`, NON-interactive). Satisfies "citations
  remain visible + traceable" without hosting quotes. Data: each point carries a
  `src` string (e.g. "§ 342.10 · Licenses"; non-statute sources like "Veto letter"
  show the label alone). The bare `[n]` number + `activeCite` highlight mechanism
  was removed. When passage deep-links ship, this chip becomes the link.
- **One-line lede replaces the meta key-points intro** — a per-bill "what this
  bill does" sentence (`b.lede`) leads, then the cited bullets. Non-redundant
  nuggets from the dropped paragraph are folded in: committee lede = "…still in
  committee, so the numbers may change"; vetoed lede = "…passed by both chambers,
  then vetoed"; vetoed bullet 3 now carries the override rule ("an override would
  take a two-thirds vote in each chamber").
- **Standalone plain-language paragraph DROPPED on mobile** (was redundant with
  the bullets — same rule already applied on web). The cited bullets + lede carry
  the plain-language meaning.
- **Votes intro slimmed to one line** + a **collapsible "How to read a roll call"**
  (holds the roll-call definition + the authoring-party pattern narrative). A
  **tiny always-visible "• crossed party lines" legend** sits beside the toggle so
  the amber crossover dots stay self-explanatory while scanning without expanding
  anything. The per-roll crossover footer was removed (single source now).
- **Roll cards = accessible accordion.** Header is a real `<button
  aria-expanded>` (was a clickable `<div>` — an a11y defect); the expanded panel
  (filters/search/party blocks) is a SIBLING of the button (interactive controls
  can't nest inside a button). **One open at a time on mobile** (opening one closes
  others; `openRolls` holds a single key). The record-ref ("Senate Vote 512") is
  plain text in the header now (was a nested link — invalid inside a button).
- **Jump chips have scroll-spy.** IntersectionObserver (root = the phone scroll
  container, `rootMargin: -88px 0px -55% 0px`) tracks the section nearest the top
  and highlights its chip (dark fill + `aria-current`); clicking a chip also sets
  it active optimistically. Anchors + `scroll-margin-top:64px` still drive the jump.
- **Section order CONFIRMED: Summary → Actions → Votes → Versions.** Votes stays
  3rd ("roll call toward the bottom" satisfied) rather than dead-last, so the page
  doesn't end on a long expandable roll; Versions (short/archival) closes it.

## Share (copy link + social) — added Jul 18, 2026 (web + mobile in sync)
Sharing a specific bill is a primary action (send to friends / reps / constituents),
so it gets a persistent, obvious home in the **bill header** (above the tabs on web;
top bar on mobile) — NOT buried in a menu — and stays reachable from every tab/section.
- **Copy link is the PRIMARY action** (most people just want the URL); social buttons
  are secondary. Panel order: title → URL field → Copy → social row.
- **Social set (order) = LinkedIn · X · Facebook · Instagram · Email** (professional/civic-appropriate;
  all have clean monochrome brand glyphs + real share-intent URLs). Rendered as
  **monochrome ink glyphs on `#f1f1f4` circles** (no full-color icons — brand-consistent,
  avoids slop). LinkedIn kept for policy/professional sharing; deliberately NOT a big
  always-visible colored icon row.
- **Deep link shared = `https://alethical.com/bills/{slug}`** (the bill, NOT the current
  tab — share the bill, not a view). Production: canonical bill URL.
- **Share intents:** X `twitter.com/intent/tweet?text={code — title · Alethical}&url=`;
  Facebook `sharer.php?u=`; LinkedIn `sharing/share-offsite/?url=`; Email `mailto:` with
  subject = "{code} — {title}", body = title + url + "via Alethical". `target=_blank
  rel=noopener` on the three web intents; email is `mailto`.
- **Copy interaction:** click Copy → `navigator.clipboard.writeText(url)` → button swaps
  to a green "Copied"/"Link copied" confirmation with a check, auto-reverts after ~1.9s
  (`copied` state + timeout). Green fill (`#2ed47e`/`#06231a` ink) = action, dark-ink-on-green
  per system.
- **Web = anchored popover** opened by a "Share" button at the **right end of the tabs row**
  (bottom-aligned, sitting just above the tab underline) — deliberately NOT on the title row
  (kept it off the H1 so it reads subordinate to the title, and away from the nav Sign in button
  it was crowding). Matches the account-button chrome: white, `rgba(17,21,15,0.16)` border, 12px
  radius. Inline URL field + Copy button; a transparent fixed backdrop closes on outside-click;
  × also closes. `z-index:60` wrapper so the popover clears the summary/tabs.
- **Mobile = bottom sheet** (reuses the sign-in sheet pattern: `ovFade`+`sheetUp`, rounded
  to the phone frame) opened by a **Share button on the status row**, right-aligned beside the
  stage pill ("Signed into Law" · Share). It is NOT beside the title (a button there forced the
  act name to wrap and stole width from long names) and NOT in the top bar (crammed the ALETHICAL
  logo + Sign in + menu). The status-row slot keeps the title full-width for long names and reads
  subordinate to it. Follows the mobile field-stacking rule: full-width read-only URL field
  (`data-glow-field`), full-width green **Copy link** button BELOW, then the social row (52px
  targets). Tap-outside or × closes.
- **Instagram has NO web link-share intent** — the button is present for parity but a real IG
  "share a link" URL doesn't exist. Mock points it at `instagram.com`; PRODUCTION should copy
  the link + open the Instagram app (or a story/DM composer), matching native IG sharing.
- **Legislator Profile has the same Share** (web hero: a white "Share" button beside the green
  "Ask about this legislator" CTA, anchored popover; same 5 social + copy-link). Shares
  `https://alethical.com/legislators/{slug}`, title = "{Name} — {party}, {chamber} District {n}".
- **a11y:** every control is a real `<button>`/`<a>` with an `aria-label`; social targets 44px
  (web) / 52px (mobile); inherits the global focus ring. The purple share-glyph tile in the
  mobile sheet header uses the citation-purple family (decorative, not an action color).
- Share glyph = three connected nodes (universal "share"), ink on light / purple in the sheet
  header tile only.

## Mobile refinement pass 2 (Jul 18, 2026)
- **Rail progress bar ("WHERE IT STANDS") REMOVED on mobile.** Redundant with the top
  status pill (a signed bill's all-green bar just restated "Signed into Law") and the
  Actions timeline (which carries pipeline position for in-progress bills). Rail now leads
  with the date only — EFFECTIVE (signed) / LATEST ACTION (in progress/vetoed). Status stays
  the top header pill; effective date stays in the rail (not promoted to the header).
- **Chief author matched to web:** labeled **Party** / **District** fields (grey label + ink
  value); **co-authors detached** to the top-right of the CHIEF AUTHOR header ("+N
  co-authors"), away from the name/party/district.
- **Ask field = white** (border-defined, matches web/home — not grey) and restructured to a
  **full-width field with a full-width Ask button BELOW** (mirrors home-mobile hero) so the
  placeholder never truncates in the narrow column. Description unified to the concise "No
  account needed — answers cite the bill text." (web updated to match).
- **Mobile field + chip interaction standard (SHIPPING DEFAULT — apply first pass):** (1) **ANY mobile field with a submit/action button** (search, ask, finder, forms — not just
  ask) STACKS: full-width field, full-width action button BELOW — never an inline button beside
  the input in the narrow column (it truncates the placeholder; home-mobile hero pattern). One
  consistent field+button treatment across every mobile screen. Fields glow purple on focus/tap via
  `data-glow-field` (`:focus-within` → border `#5b30d6` + `0 0 0 4px rgba(91,48,214,0.14)`).
  (2) **Interactive pill chips/buttons glow purple on BOTH hover and tap-hold** (`style-hover`
  `0 0 0 3px rgba(91,48,214,0.16)`; `style-active` `0 0 0 4px rgba(91,48,214,0.22)`) — nav/jump
  chips, Ask chips, glossary terms, roll filters, the "how to read" toggle (the Ask button
  darkens instead). (3) **Selected chips do NOT glow** — selected = solid black fill (nav,
  active filter, open toggle) or purple tint (active glossary); the glow is reserved for
  un-selected hover/press feedback, so purple never fights the black selection.
- **Actions:** dropped "newest first" (ordering is visually evident); more breathing room
  around the dot legend; the **plain-language key is separated by whitespace**, not a hairline
  (the old `border-top` collided with the vertical timeline line).
- **Votes:** description matched to web's concise "Each recorded roll call lists how members
  voted." The **"how to read a roll call" panel no longer repeats** that definition — it
  carries only the authoring-party pattern. The crossover dot is explained solely by the
  always-visible "• crossed party lines" legend (removed the duplicate "amber dot marks…"
  clause + the color word — the dot reads brownish, so naming it "amber" invited a mismatch).
  **"Your legislators"
  card/teaser moved BELOW the roll cards** (content leads; personalization/CTA follows).
- **Source line consolidated to ONE** at the very bottom (under Versions); the per-section
  Votes source was removed — mobile is a single scroll, so one page-level citation covers it.
- **Copy:** "legislative session" RESTORED on this screen (educational) — eyebrow reads
  "{CHAMBER} · 2025–2026 LEGISLATIVE SESSION". Rule reversed in CLAUDE.md; other screens to
  follow separately.
- **Key-points type tier:** key-point bullets = **19px medium**, the shared "primary content"
  size (action titles, roll motions) — NOT larger than other sections. Key points leads by
  ORDER + treatment (round ink bullets, citation chips, lede, spacing), not by an oversized
  font. Scale: 26 (h2) > 19 (primary content) > 16 (intros/lede) > 13 (mono meta).
- **OMNIBUS badge = GHOSTED amber** (transparent + `#e3c17f` outline + `#a76a1a` text),
  matching web + the CHAPTER law chip; FILLED amber stays the bill CODE badge only. Mobile
  OMNIBUS was filled — corrected. Universal amber fill-vs-ghost rule now lives in CLAUDE.md
  (Search Bills + design-system doc + an old CC prompt still show filled — pending migration).
- **Web citations (excerpts kept):** key-point **bullets are clean plain text** — no number or
  chip (a purple number on the bullet implied a false link to the purple section chips below).
  The **"From the bill" cards carry the citations**: section+topic chip (e.g. "§ 295.81 Retail tax" — dot removed, matching
  mobile) + verbatim quote — no number, no black-bold label. Citations stay visible/
  traceable via the cards, which sit directly under the key points. Mobile keeps its bullets clean too
  and groups the section chips into a **"CITED SECTIONS" strip below the key points** (chips
  only, no quotes — so they don't distract while reading the bullets); web uses the "From the
  bill" cards. Same chip vocabulary, layout-placed. **Both the web "From the bill" header and
  the mobile "CITED SECTIONS" label carry the green circle-check (✓, `#149d5b`)** — keep it on
  any cited-sections label. The mobile strip chips show the section **number + name with the dot removed**
  (e.g. "§ 342.10 Licenses") — dropping the "·" trims width so more fit per row.
