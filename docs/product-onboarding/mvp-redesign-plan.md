# Alethical MVP redesign — decisions & open items

Running tracker for the IA + design-direction redesign (new top-nav IA + green
aesthetic + Ask AI as hero). Companion to `docs/product-onboarding/product-scope.md`. MVP only for now;
roadmap noted for direction.

## Locked decisions

- **MVP client = web only.** The MVP ships a responsive web app (desktop + mobile
  web). Native iOS and Android apps are not built yet ([#91](https://github.com/alethical-org/alethical/issues/91));
  see `docs/product-onboarding/product-scope.md` § Frontend Scope. The frontend stays a shared Expo/React Native
  codebase, so mobile is a re-target later, not a rebuild — but nothing in the MVP build
  sequence below targets iOS/Android.
- **IA:** top nav `Search ▾ · Track ▾ · About ▾ · Sign in`, with dropdown
  subsections. Search and Track share one entity taxonomy. **The AI-answer feature is
  named "Grounded Ask" (feature / badge) and "Ask" (action verb) — never "Ask AI"**
  (ratified 2026-07-12, matching the v2 home design and
  `docs/design/ui-copy-guide.md`). **The global menu is Ask-free on every page** (revised
  2026-08-07): the old page-aware top-level **✦ Ask** link was removed from non-home
  pages. Ask stays reachable through the home hero and contextual actions on bills,
  profiles, and answers. The grey **Ask AI** roadmap pill remains the one scoped naming
  exception because it is inert and describes a separate future capability.
- **MVP surface:** Ask AI; Search → Bills, Legislators ("Find My Legislator");
  Track → Bills; About → About Us, Trust & Integrity, Contact Us; Sign in.
  Everything else in the menus is roadmap.
- **Aesthetic:** green / rounded / bold-sans / soft-shadow. Loose and non-binding
  until firmed; final visual mockups handled separately in Claude design.
- **Final designs land one page at a time, superseding the seven comps per page:**
  the seven HTML comps under `docs/mockups/` on the design-system branch
  ([#67](https://github.com/alethical-org/alethical/pull/67)) were *aesthetic
  direction*; the actual per-page UI arrives as refined Claude-design mockup
  screenshots, and once a page's final design exists it supersedes that page's comp
  as the visual reference (the comp stays as provenance for the tokens). First final
  design: home signed-out (2026-07-09 refinement — full page + the three nav-dropdown
  states). The tokens + primitives foundation extracted from the comps persists;
  each page build tops it up with whatever new tokens/components its final design
  needs.
- **Roadmap items in menus = curated, greyed "ON THE ROADMAP" group (resolves O5):**
  the v2 home design shows the Search and Track dropdowns with a greyed, non-navigable
  **ON THE ROADMAP** group beneath the live entries, rather than hiding all roadmap
  items. The curated sets differ per menu: **Search → Issues · Candidates**; **Track →
  Legislators · Issues · Candidates · Campaign Finance**. Other roadmap registry entries stay hidden. Live
  entries keep icon + one-line description — **Search:** Bills (with a **"Grounded Ask"**
  badge) · Search Legislators · Find My Legislator; **Track:** Bills.
- **Mockups → frontend handoff (no HTML conversion step):** when the Claude-design
  mockups finalize, they hand off to implementation as three artifacts, in value order:
  1. **Final screenshots per screen and state** — shared via Drive for human review.
     (Anything embedded in this public repo instead must be vetted first — mock
     screenshots pair real legislator names with fabricated records.)
  2. **Design tokens** — exact colors, type scale, spacing, radii per component —
     landing as code in `apps/frontend/src/theme/tokens.ts` on the design-system
     branch ([#67](https://github.com/alethical-org/alethical/pull/67), which also
     keeps the raw HTML comps under `docs/mockups/` as the versioned visual
     reference). `tokens.ts` is itself the token sheet; don't hand-maintain a
     parallel human-readable one — generate it from the file if ever needed.
  3. **Final copy strings verbatim** — for the Ask surface these live in
     `docs/product-onboarding/grounded-ask-spec.md` §9.4 (layout-owned fixed copy), kept in sync as
     mocks refine. When mock copy and the spec diverge, reconcile the spec
     deliberately — the spec is the source of truth, not the mock.

  There is deliberately **no HTML-to-frontend conversion step**: the frontend is a
  shared Expo/React Native codebase, and RN doesn't render HTML/CSS — converted
  markup can't be lifted into components, and web-specific CSS can actively mislead.
  Engineers implement in the RN codebase from tokens + spec; the spec is the
  contract, the mock is the visual. Screenshot sets should cover every spec'd state
  (e.g. the five Answer-page states in `docs/product-onboarding/grounded-ask-spec.md` §9.1, "The
  states"), not just the happy path — the states are the contract, and mocks tend
  to show only the golden screen.
- **Mobile is derived in-build, not separately designed (2026-07-12):** the Claude-design
  mocks are desktop-only (fixed ~1600px canvas, no breakpoints); MVP is responsive web,
  so mobile layouts are derived during implementation from the app's own responsive rules
  (`useResponsive`, existing screen patterns) — reflow multi-column sections to one column,
  nav dropdowns → mobile drawer, ~44px touch targets, and **no reliance on hover** (there is
  no hover on touch, so resting states must stand alone). Per-page mobile mocks are **not**
  commissioned; request a *targeted* mobile mock only if a specific section doesn't reflow
  cleanly. Codified in the `design-build` skill (Responsive & touch). styling is fully centralized in `theme/tokens.ts` with zero
  hardcoded hex across the 24 screen/component files, so the green flip is a token-set
  swap, not a code migration. The MVP flip targets web; because the codebase is shared
  Expo/React Native, the same swap will re-skin the native iOS/Android clients for free whenever they are built.
- **Menu = typed registry:** codified in `apps/frontend/src/navigation/ia.ts`. Each
  item → `{ label, path, menu, availability: mvp|roadmap, authGated }`. MVP rendered;
  roadmap declared-but-hidden — except the curated "ON THE ROADMAP" items shown greyed
  in the menus (see the roadmap-items bullet above).
- **Track stays auth-gated.**
- **Search page split:** the current combined Bills+Legislators search becomes two
  dedicated pages. Bill search screen specified in `docs/product-onboarding/bill-search-screen-spec.md`
  (three small backend deltas tracked in [#134](https://github.com/alethical-org/alethical/issues/134); browse rail deferred to [#130](https://github.com/alethical-org/alethical/issues/130)).
- **Sign-in experience (SHIPPED, Aug 2026 — [#1006](https://github.com/alethical-org/alethical/issues/1006)):**
  one reusable, intent-aware Google sign-in surface — a centered overlay on a
  desktop-width browser, a bottom sheet on a phone, from a single component
  (`components/auth/SignInDialog.tsx`), opened app-wide by
  `useSignInModal().openSignIn({ intent, returnTo, billId, scrollY })`. The three previously
  inert nav "Sign in" buttons now open it; so does a signed-out Track tap, which returns
  to the exact page and scroll position and finishes the track with no second click
  (`docs/product-onboarding/bill-tracking-spec.md`). Design and
  deviations: `docs/mockups/sign-in/`. Gate scope is **bill tracking only**. Vote records
  are public, so there is no legislator-votes sign-in intent.
  No copy anywhere mentions an email or push alert: sending is not built
  ([#36](https://github.com/alethical-org/alethical/issues/36)).
- **Sign-out UX / account menu (SHIPPED, revised Aug 2026):** the "Sign in" button is
  *replaced* by an account control when signed in — not a Sign-in→Sign-out toggle. Three
  placements: an avatar + first name pill with a dropdown on desktop, an avatar opening a
  sheet on the phone top bar, and a row in the phone drawer's footer. The menu is
  **header + Sign out only**. The original plan's "Account, Tracked, Notification
  preferences" rows were dropped: the built Account page is pre-redesign, fixture-wired,
  and its URL already redirects Home, so a row would point at a broken surface. The unused
  `ACCOUNT_MENU` constant that described those rows was removed with #1006. Resolves O9.
- **Chat and Account are off the sidebar and the phone tab row (Aug 2026).** Both are
  pre-redesign screens; with sign-in live, a link to either would land someone on a page we
  stopped maintaining. Their URLs already redirect Home. This bullet used to close with
  "Bill-scoped chat is untouched — it opens from a bill page, not from a tab", which was
  **false**: `webRoutes.ts` redirects `/chat/new` and `/chat/sessions/{id}` to Home too, and
  the bill-page entry it named was deleted with `BillDetailScreen.tsx`
  ([#1071](https://github.com/alethical-org/alethical/pull/1071)). The chat screen and its
  server endpoints still work; only the way in is gone. Tracked in
  [#1032](https://github.com/alethical-org/alethical/issues/1032); the detail lives in
  `.claude/rules/grounded-answers.md` rule 8.
- **Logged-out Ask AI funnel (LOCKED):** anonymous visitors get one grounded, cited
  answer as a **stateless one-shot** (not a persisted `ChatSession`); follow-ups,
  history, and tracking gate behind sign-in. Preserve the question+answer through auth.
  **Lower the cold start:** seed the hero with 3–4 clickable example-question chips.
  Depends on real Ask AI (don't ship the teaser on stub embeddings). *Status (Jul 14,
  2026, PR #227):* the interim Ask → sign-in behavior is retired — hero submits route
  to the `/ask?q=` answer page; topic → bills questions get the real cited answer,
  and not-yet-shipped intents get an "ON THE ROADMAP" state. The one-free-answer cap
  and rate limiting (O8, #98) are still open — anonymous asks are unmetered today.
- **Logged-out Track experience:** read-only shell with a value-prop empty state (not a
  hard redirect). Bill tracking began as a not-yet-live roadmap feature (decided Jul 2026),
  but is now **live**: the shared `BillTrackButton` (`useBillTracking`) is functional
  everywhere it appears — the Bill Profile header (web + mobile), bill cards, the home feed,
  Ask answers, legislator profiles, and the Tracked list. A signed-out tap opens sign-in
  over the current page, then returns to the same page and scroll position and completes
  the track; signed in, it toggles the bill on the watchlist and reads "Tracked"
  (`docs/product-onboarding/bill-tracking-spec.md`).
  The old inert `RoadmapTrackButton` was retired. The intent-preserving sign-in +
  post-auth return-to-action flow is shipped on all of these surfaces. The Tracked page
  itself is now the redesign too (`screens/redesign/TrackedBillsScreen.tsx`): full-bleed
  top-nav chrome like the /bills pages, the same `BillResultCard` list, and a value-prop
  sign-in card when signed out. The old sidebar `TrackedScreen` was deleted. This closes
  [#976](https://github.com/alethical-org/alethical/issues/976).
- **Search vs Track modes:** Search = "the library" (query/filter-forward, public);
  Track = "your space" (personalized activity dashboard, signed-in chrome).
- **Find My Legislator hero:** Option C — dedicated "Find your legislators" band directly
  below the hero with a Minnesota map motif + street-address input; additive to the
  Search → Legislators menu entry. Shipped, and wired to the Find My Legislator screen
  in [#873](https://github.com/alethical-org/alethical/issues/873).
  **A street address, not a ZIP or a city:** Minnesota legislative districts are drawn
  below city level. The lookup first uses the US Census one-line matcher, retries the
  house and street with Minnesota when a commonly used city or ZIP hides the postal
  match, then falls back to Minnesota's public statewide address points
  (`alethical/api/services/representative_lookup.py`). A city name or a bare ZIP still
  has no house and street to locate, so neither the field's placeholder nor any suggestion
  chip may offer one (`.claude/rules/grounded-answers.md` rule 2). On the full finder page,
  an exact house number plus a partial street name now opens up to 5 active official
  Minnesota address choices; selecting one runs the lookup immediately. The band's original
  city-name chips were removed for exactly this reason.
- **Search Bills / Search Legislators — design-review decisions (2026-07-15):** the split
  (`SearchScreen` → `BillsScreen` + `LegislatorsScreen`, per the build-sequence + route
  scheme below) is now driven by a matched pair of high-fidelity Claude-design drafts
  (`design_handoff_search_bills`, `design_handoff_search_legislators`). Design-review
  grounded every element against the DB/API; the resolved calls:
  - **Bills screen ships largely as drawn** — real data backs search, chamber/status/
    session/omnibus filters, policy pills **with real counts** (`/policy-areas`), the
    per-bill **AI summary** (genuine `AIEnrichment`, not the official digest), Track +
    Google sign-in, author/latest-action, roll-call **count**, pagination, data-as-of.
  - **Session label is the 94th, not the 89th.** DB stores "94th Legislature (2025-2026)
    Regular Session" (`pipeline/minnesota.py:706-711`, `pipeline/sessions.py`); the draft's
    "89th" was factually wrong. Always spelled out in full with years.
  - **Roll-calls pill links to the bill's votes tab** (`/bills/:id?tab=votes`), not a
    standalone roll-call page (deferred, #38) — keeps it URL-addressable (grounded-answers
    rule 5).
  - **Companion-bill link cut** for the first ship — schema has `companion_bill_id` but no
    API serves it and population is unverified. Tracked as **#293**.
  - **Sort:** ships **"Sorted by latest action"** (the only order the API supports today);
    "by legislative progress" (the draft's label) is a fast follow — **#292**.
  - **Legislators screen — four ungrounded draft elements resolved:**
    - **Follow (cut).** Follow-a-legislator is #151 (v2) and depends on notifications
      (#36); removed the Follow button, its sign-in modal, and its toast. Screen ships as a
      browsable directory (whole-card link to the profile).
    - **Focus-area filter pills (cut).** No legislator topic/focus data exists; counts were
      invented. Keep the **Chamber** + **Party** filters (both backed).
    - **Activity line → "{n} bills authored" only.** "Signed into law this session" isn't
      computed; dropped. The authored count itself is currently **0 for everyone** — a real
      attribution bug fixed via **#291** (blocks this line).
    - **Role line → chamber-derived title** ("State Senator" / "State Representative").
      Committee `role` ("Chair") is never ingested (always null); dropped. Committee **chips**
      stay (needs committee names added to the `/legislators` list serializer — small).
    - **Party shows "DFL"** (DB stores the raw MN abbreviation; the live "D" is a frontend
      `toParty` collapse to adjust). Neutral chip, no partisan color (grounded-answers
      rule 3).
  - **Nav scope (sequencing):** build both screens with the shared TopNav (works signed-out
    + signed-in); the global left-rail → TopNav migration of the rest of the signed-in app
    (Home, Tracked, Chat, Account) is a separate fast-follow with its own designs — not this
    pass.
  - Drafts are still iterating in Claude Design; these are the change requests relayed back.
  - **Backend data priority (2026-07-15):** the two search screens take priority over all
    other deferred backend/records work. Only **three real-data blockers** remain, across
    two independent, parallel serializer lanes; everything else on the deferred list was cut
    from these screens or is unrelated and ranks below them.
    - **Lane A — bills serializer** (`bill_list_stmt`, `bill_status_key*`, `serializers.py`
      bill items): [#292](https://github.com/alethical-org/alethical/issues/292) (progress
      sort) shipped as PR #297 (CI-green, ready to merge) →
      [#295](https://github.com/alethical-org/alethical/issues/295) (real per-bill progress
      bar + co-author count; today the list bar is a hardcoded `defaultProgress()`). Run #295
      **after #297 merges** — same lane, don't run concurrently or branch off #297.
    - **Lane B — legislator directory serializer** (`public.py`/`serializers.py` directory,
      `models.py legislator_directory_stmt`):
      [#291](https://github.com/alethical-org/alethical/issues/291) (authored-count bug — every
      card reads "0 authored bills"; blocks the activity line; **in flight**) →
      [#296](https://github.com/alethical-org/alethical/issues/296) (committee-name chips + show
      "DFL" not "D"). Run #296 **after #291 merges** — same lane.
    - Lanes A and B are independent and run in **parallel**. Deferred past both screens:
      [#293](https://github.com/alethical-org/alethical/issues/293) (companion, cut element,
      data unverified), #38 (vote-detail page — roll-call *count* is already backed, pill →
      `/bills/:id?tab=votes`), [#151](https://github.com/alethical-org/alethical/issues/151)
      (follow legislators, cut), #36 (notifications, unrelated).

## Build sequence

1. **Phase 0 — foundation:** IA/route registry (`ia.ts`, done) + expand `tokens.ts`
   into a real token + primitives kit (color scale/tints, radii, shadows, gradient,
   bold-sans display), old theme as default so nothing breaks.
2. **Backend track (parallel, no design dependency):** swap the Ask AI embedding stub
   for a real model + answer generation; ingestion data-quality/validation per
   product-scope rubrics. The anonymous Ask AI teaser depends on this landing.
3. **Frontend track:** Option 1 (marketing hero, real primitives, placeholder copy,
   example-question chips, interim Ask → sign-in) → Option 3 (migrate app onto new IA +
   flip green tokens; includes the Search split) → Option 4 (real Ask AI demo + live
   one-free-answer funnel) emerges when the backend track meets the new components.

Rework fear is contained to 3 seams: (A) token/primitive vocabulary, (B) IA/nav shell,
(C) Ask AI model swap. Order = most-stable contract → least-stable surface.

## Route / IA registry (spec)

Source of truth: `apps/frontend/src/navigation/ia.ts` (`IA`, `ROUTES`,
`ACCOUNT_MENU`, selectors). Delivered additively. `webRoutes.ts` owns routing and
redirects directly; the unused `REDIRECTS` constant was removed (it never fed the
router and had diverged from the live redirect behavior).

**Path scheme:**

| Surface | Path | Notes |
|---|---|---|
| Ask AI | `/ask`, `/ask/new`, `/ask/sessions/:id` | redirect `/chat*` → `/ask*` |
| Search → Bills | `/bills`, detail `/bills/:billId` | redirect `/search` → `/bills` |
| Search → Legislators | `/legislators`, detail `/legislators/:legislatorId` | Find-My-Rep CTA; deep link `/find-my-legislator` (unchanged, avoids `:legislatorId` collision) |
| Track → Bills | `/tracked` | live nav entry (#976); `/tracked` resolves to the Tracked page (sign-in card when signed out), no longer redirected to Home; auth-gated |
| About | `/about`, `/about/trust`, `/about/contact` | static |
| Auth / account | none — sign-in is a dialog, not a page | #1006: `openSignIn()` opens it over whatever page you are on, so there is nothing to route to and nothing to come back from. `/account` still redirects Home |
| Legal (footer) | `/privacy`, `/terms` | not in About menu |
| Roadmap (hidden) | `/search/{issues,policies,laws,candidates,news}`, `/track/{issues,policies,legislators,laws,candidates}` | declared, not rendered |

**Nav states:** logged out, every page →
`Search ▾ · Track ▾ · About ▾ · [Sign in]` (Sign in = the single primary CTA).
Logged in → the same menus + `[avatar ▾]`; Track submenus populate. The desktop menu
and mobile drawer are both Ask-free on every screen. Ask remains available through
in-page actions, and the Search menu keeps its grey, inert **Ask AI** roadmap pill.

**webRoutes.ts / RootNavigator migration steps (apply during the frontend track — NOT now,
because it would break the running old-IA app before screens/tokens exist):**
1. Import `IA`/`ROUTES`; replace magic path strings in `targetFromPathname`
   and `pathnameFromNavigationState` with registry paths. (Redirects for retired
   routes like `/search` → `/bills` are handled inline in `targetFromPathname`; the
   unused `REDIRECTS` constant was removed.)
2. Add list routes `/bills`, `/legislators`; add `/ask`, `/track/bills`, `/about*`.
   (No `/sign-in` route in the end — #1006 shipped sign-in as a dialog over the current
   page. `/account` stays a redirect to Home.)
3. Replace the tab-based shell with a top-nav shell (desktop) driven by `MENUS` +
   `visibleMenuItems`; derive mobile nav likewise.
4. Split `SearchScreen` → `BillsScreen` + `LegislatorsScreen`; extract a shared
   `useSearchFilters` hook + `<SearchFilterBar>` (O2).
5. Add static About screens; render the account menu from `ACCOUNT_MENU`.

## To-do / work items

Phase 0
- [x] IA/route registry (`ia.ts`)
- [x] Account-menu contents (O9)
- [ ] Expand `tokens.ts` → token scale/tints, radii, shadows, gradient, bold-sans display + primitives kit (Surface/Card/Button/Pill/Chip/NavBar), old theme as default — part of [#136](https://github.com/alethical-org/alethical/issues/136)

Backend track (start now — long pole, no design dependency)
- [ ] **Ask AI un-stub:** replace `demo-minilm-1536` / `_deterministic_embedding` in
  `pipeline/rag_ingest.py` with a real embedding model + real answer generation
- [ ] Anonymous Ask guardrails: rate-limit by IP/device + cache; cap at one free answer (O8)
- [ ] Ingestion data-quality + machine-readable validation reports (per product-scope rubrics)

Frontend track (after Phase 0; parallel with backend track)
- [ ] Top-nav shell driven by the registry (desktop + mobile web)
- [ ] Migrate `webRoutes.ts` onto the registry + redirects
- [ ] Option 1 marketing hero: green primitives, placeholder copy, example-question chips, interim Ask → sign-in
- [x] Find My Legislator Option C band + MN map — shipped; Find wired to the lookup and
      the screen's URL made shareable (#873, #764)
- [x] **Find My Legislator screen redesign:** the full page now carries the accepted desktop
      and phone layouts, address choices, browser location, real district boundaries,
      representative details, all lookup failures, and a shareable address-only URL. The
      homepage band is an entry point only. The full page adds partial-address suggestions;
      both paths use temporary location handoff. Coordinates and location failures are never
      stored in the URL.
      Saving an address stays out (`docs/product-onboarding/user-data-retention-policy.md`
      §2.3).
- [x] Search split → `SearchBillsScreen` + `SearchLegislatorsScreen` + shared filter hook —
  shipped, and the legacy combined `SearchScreen` retired (#313); driven by the 2026-07-15
  design-review decisions (Locked decisions above). Follow-ups tracked separately:
  #291 (authored-count bug), #292 (progress-sort), #293 (companion link)
- [ ] About static pages (About Us / Trust & Integrity / Contact Us); Trust page as real brand copy
- [x] Account menu + nav-after-sign-in — [#1006](https://github.com/alethical-org/alethical/issues/1006); Privacy/Terms in the footer still open
- [x] Logged-out Track shell + intent-preserving TRACK sign-in + post-auth redirect — #976 and [#1006](https://github.com/alethical-org/alethical/issues/1006)
- [x] Green token flip (web; re-skins the native iOS/Android clients for free via shared tokens) — [#136](https://github.com/alethical-org/alethical/issues/136); landed with the signed-out home ship (PR #67)
- [ ] Upgrade Ask hero to the one-free-answer funnel when the backend un-stub is live
      — *partially delivered by PR #227 (topic → bills answers live from the hero);
      still missing: the one-free-answer cap + rate limiting (O8, #98) and the
      remaining answer paths (#79)*

## Open items (still undecided)

| # | Item | Leaning / notes | When |
|---|------|-----------------|------|
| O8 | Anonymous Ask guardrails specifics | Rate-limit by IP/device + cache; cap at one free answer. | Ask AI impl |

**Resolved:** ~~O5~~ (curated "ON THE ROADMAP" group — see Locked decisions). ~~O9~~ (account menu). **O10 (standalone ask nav entry) — superseded 2026-08-07:** the page-aware **✦ Ask** link shipped in the home/nav build ([#143](https://github.com/alethical-org/alethical/issues/143)) and was later removed from every global menu. See the IA locked decision above.

## Roadmap (remembered for later)

- **Menu taxonomy expansion** — Search adds: Issues, Policies, Laws, Candidates,
  News & Media ("In the news", YouTube legislative sessions). Track adds: Issues,
  Policies, Legislators, Laws, Candidates.
- **Track → Legislators** = "follow a legislator" (activity notifications).
- **Optimistic local tracking pre-auth** — track before sign-in, persist on auth;
  higher conversion, more work.
- **Note:** Candidates + News & Media go beyond product-scope's stated boundaries (campaign +
  social are explicitly out of scope there) — a conscious future mission expansion;
  keep out of the MVP data model so it doesn't leak scope.

## Why anonymous visitors get one cited answer

`docs/product-onboarding/product-scope.md` § "AI and RAG Chat" lets anonymous visitors receive a
single stateless, rate-limited, cited answer, while persistent chat (history, follow-ups,
saved context) stays signed-in only. The reason: the cited-answer moment is the product's
core proof ("Truth, Unconcealed"), so gating it before a visitor experiences it suppresses
adoption. The stateless one-shot keeps the "sessions belong to signed-in users" intent
without hiding the proof behind sign-in.
