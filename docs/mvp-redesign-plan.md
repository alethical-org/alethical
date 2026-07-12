# Alethical MVP redesign — decisions & open items

Running tracker for the IA + design-direction redesign (new top-nav IA + green
aesthetic + Ask AI as hero). Companion to `docs/v1-scope.md`. MVP only for now;
roadmap noted for direction.

## Locked decisions

- **MVP client = web only.** The MVP ships a responsive web app (desktop + mobile
  web). Native iOS and Android apps are deferred to post-MVP ([#91](https://github.com/alethical-org/alethical/issues/91));
  see `docs/v1-scope.md` § Frontend Scope. The frontend stays a shared Expo/React Native
  codebase, so mobile is a re-target later, not a rebuild — but nothing in the MVP build
  sequence below targets iOS/Android.
- **IA:** top nav `Search ▾ · Track ▾ · About ▾ · Sign in`, with dropdown
  subsections. Search and Track share one entity taxonomy. **The AI-answer feature is
  named "Grounded Ask" (feature / badge) and "✦ Ask" (the action, sparkle + verb) —
  never "Ask AI"** (ratified 2026-07-12, matching the v2 home design and
  `docs/ui-copy-guide.md`). **It is page-aware (resolves O10):** on the signed-out home
  there is no standalone top-level ask entry — the hero *is* the ask surface, and
  Search → Bills carries a **"Grounded Ask"** badge instead. On every non-home page the
  nav restores a top-level **✦ Ask** entry
  (`✦ Ask · Search ▾ · Track ▾ · About ▾ · [auth]`) so the ask path is always one
  click away. `ia.ts` keeps the `askAI` menu entry (it drives the non-home nav; render
  it as "✦ Ask"); the home nav omits it at render time. (This plan still uses "Ask AI"
  as an *internal* handle for the feature/route in places below — the user-facing name
  is Grounded Ask / ✦ Ask.)
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
  Legislators · Issues · Candidates**. Other roadmap registry entries stay hidden. Live
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
     `docs/grounded-ask-spec.md` §9.4 (layout-owned fixed copy), kept in sync as
     mocks refine. When mock copy and the spec diverge, reconcile the spec
     deliberately — the spec is the source of truth, not the mock.

  There is deliberately **no HTML-to-frontend conversion step**: the frontend is a
  shared Expo/React Native codebase, and RN doesn't render HTML/CSS — converted
  markup can't be lifted into components, and web-specific CSS can actively mislead.
  Engineers implement in the RN codebase from tokens + spec; the spec is the
  contract, the mock is the visual. Screenshot sets should cover every spec'd state
  (e.g. the five Answer-page states in `docs/grounded-ask-spec.md` §9.1, "The
  states"), not just the happy path — the states are the contract, and mocks tend
  to show only the golden screen.
- **Mobile is derived in-build, not separately designed (2026-07-12):** the Claude-design
  mocks are desktop-only (fixed ~1600px canvas, no breakpoints); MVP is responsive web,
  so mobile layouts are derived during implementation from the app's own responsive rules
  (`useResponsive`, existing screen patterns) — reflow multi-column sections to one column,
  nav dropdowns → mobile drawer, ~44px touch targets, and **no reliance on hover** (there is
  no hover on touch, so resting states must stand alone). Per-page mobile mocks are **not**
  commissioned; request a *targeted* mobile mock only if a specific section doesn't reflow
  cleanly. Codified in the `implementing-design-handoffs` skill (Responsive & touch). styling is fully centralized in `theme/tokens.ts` with zero
  hardcoded hex across the 24 screen/component files, so the green flip is a token-set
  swap, not a code migration. The MVP flip targets web; because the codebase is shared
  Expo/React Native, the same swap will re-skin the post-MVP iOS/Android clients for free.
- **Menu = typed registry:** codified in `apps/frontend/src/navigation/ia.ts`. Each
  item → `{ label, path, menu, availability: mvp|roadmap, authGated }`. MVP rendered;
  roadmap declared-but-hidden — except the curated "ON THE ROADMAP" items shown greyed
  in the menus (see the roadmap-items bullet above).
- **Track stays auth-gated.**
- **Search page split:** the current combined Bills+Legislators search becomes two
  dedicated pages. Bill search screen specified in `docs/bill-search-screen-spec.md`
  (three small backend deltas tracked in [#134](https://github.com/alethical-org/alethical/issues/134); browse rail deferred to [#130](https://github.com/alethical-org/alethical/issues/130)).
- **Sign-out UX / account menu:** "Sign in" button is *replaced* by an account menu
  (avatar ▾) when signed in — not a Sign-in→Sign-out toggle. Menu = Account, Tracked,
  Notification preferences, Sign out (see `ACCOUNT_MENU` in `ia.ts`). Resolves O9.
- **Logged-out Ask AI funnel (LOCKED):** anonymous visitors get one grounded, cited
  answer as a **stateless one-shot** (not a persisted `ChatSession`); follow-ups,
  history, and tracking gate behind sign-in. Preserve the question+answer through auth.
  **Lower the cold start:** seed the hero with 3–4 clickable example-question chips.
  Depends on real Ask AI (don't ship the teaser on stub embeddings). Interim hero
  behavior (Ask → sign-in) is fine until the backend un-stub lands.
- **Logged-out Track experience:** read-only shell with a value-prop empty state (not a
  hard redirect); the TRACK button triggers intent-preserving sign-in ("Sign in to
  track HF 1"); post-auth redirect returns the user to the exact action.
- **Search vs Track modes:** Search = "the library" (query/filter-forward, public);
  Track = "your space" (personalized activity dashboard, signed-in chrome).
- **Find My Legislator hero:** Option C — dedicated "Find your legislators" band directly
  below the hero with a Minnesota map motif + address/ZIP input; additive to the
  Search → Legislators menu entry. (Mockup in progress.)

## Build sequence

1. **Phase 0 — foundation:** IA/route registry (`ia.ts`, done) + expand `tokens.ts`
   into a real token + primitives kit (color scale/tints, radii, shadows, gradient,
   bold-sans display), old theme as default so nothing breaks.
2. **Backend track (parallel, no design dependency):** swap the Ask AI embedding stub
   for a real model + answer generation; ingestion data-quality/validation per
   v1-scope rubrics. The anonymous Ask AI teaser depends on this landing.
3. **Frontend track:** Option 1 (marketing hero, real primitives, placeholder copy,
   example-question chips, interim Ask → sign-in) → Option 3 (migrate app onto new IA +
   flip green tokens; includes the Search split) → Option 4 (real Ask AI demo + live
   one-free-answer funnel) emerges when the backend track meets the new components.

Rework fear is contained to 3 seams: (A) token/primitive vocabulary, (B) IA/nav shell,
(C) Ask AI model swap. Order = most-stable contract → least-stable surface.

## Route / IA registry (spec)

Source of truth: `apps/frontend/src/navigation/ia.ts` (`IA`, `ROUTES`, `REDIRECTS`,
`ACCOUNT_MENU`, selectors). Delivered additively; nothing consumes it yet.

**Path scheme:**

| Surface | Path | Notes |
|---|---|---|
| Ask AI | `/ask`, `/ask/new`, `/ask/sessions/:id` | redirect `/chat*` → `/ask*` |
| Search → Bills | `/bills`, detail `/bills/:billId` | redirect `/search` → `/bills` |
| Search → Legislators | `/legislators`, detail `/legislators/:legislatorId` | Find-My-Rep CTA; deep link `/find-my-legislator` (unchanged, avoids `:legislatorId` collision) |
| Track → Bills | `/track/bills` | redirect `/tracked` → `/track/bills`; auth-gated |
| About | `/about`, `/about/trust`, `/about/contact` | static |
| Auth / account | `/sign-in`, `/account`, `/account/notifications` | |
| Legal (footer) | `/privacy`, `/terms` | not in About menu |
| Roadmap (hidden) | `/search/{issues,policies,laws,candidates,news}`, `/track/{issues,policies,legislators,laws,candidates}` | declared, not rendered |

**Nav states:** logged out, **home** → `Search ▾ · Track ▾ · About ▾ · [Sign in]`
(no standalone ask entry — the hero is the ask surface, Search → Bills is
"Grounded Ask"-badged; per O10). Logged out, **non-home** →
`✦ Ask · Search ▾ · Track ▾ · About ▾ · [Sign in]` (Sign in = the single primary CTA).
Logged in → same menus + `[avatar ▾]` (ACCOUNT_MENU); Track submenus populate; the
✦ Ask entry drops its gate.

**webRoutes.ts / RootNavigator migration steps (apply during the frontend track — NOT now,
because it would break the running old-IA app before screens/tokens exist):**
1. Import `IA`/`ROUTES`/`REDIRECTS`; replace magic path strings in `targetFromPathname`
   and `pathnameFromNavigationState` with registry paths; honor `REDIRECTS`.
2. Add list routes `/bills`, `/legislators`; add `/ask`, `/track/bills`, `/about*`,
   `/sign-in`, `/account`.
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
- [ ] Ingestion data-quality + machine-readable validation reports (per v1-scope rubrics)

Frontend track (after Phase 0; parallel with backend track)
- [ ] Top-nav shell driven by the registry (desktop + mobile web)
- [ ] Migrate `webRoutes.ts` onto the registry + redirects
- [ ] Option 1 marketing hero: green primitives, placeholder copy, example-question chips, interim Ask → sign-in
- [ ] Find My Legislator Option C band + MN map (mockup in progress)
- [ ] Search split → `BillsScreen` + `LegislatorsScreen` + shared filter hook
- [ ] About static pages (About Us / Trust & Integrity / Contact Us); Trust page as real brand copy
- [ ] Account menu + nav-after-sign-in; move Privacy/Terms into footer
- [ ] Logged-out Track shell + intent-preserving TRACK sign-in + post-auth redirect
- [x] Green token flip (web; re-skins the post-MVP iOS/Android clients for free via shared tokens) — [#136](https://github.com/alethical-org/alethical/issues/136); landed with the signed-out home ship (PR #67)
- [ ] Upgrade Ask hero to the one-free-answer funnel when the backend un-stub is live

## Open items (still undecided)

| # | Item | Leaning / notes | When |
|---|------|-----------------|------|
| O8 | Anonymous Ask guardrails specifics | Rate-limit by IP/device + cache; cap at one free answer. | Ask AI impl |

**Resolved:** ~~O5~~ (curated "ON THE ROADMAP" group — see Locked decisions). ~~O9~~ (account menu). **O10 (standalone ask nav entry) — resolved 2026-07-09, naming ratified 2026-07-12:** the ask feature is page-aware — dropped on the signed-out home (hero is the ask surface; Search → Bills carries a "Grounded Ask" badge), restored as a top-level **✦ Ask** entry on every non-home page. See the IA locked decision above; implemented on the home/nav build ([#143](https://github.com/alethical-org/alethical/issues/143)).

## Roadmap (remembered for later)

- **Menu taxonomy expansion** — Search adds: Issues, Policies, Laws, Candidates,
  News & Media ("In the news", YouTube legislative sessions). Track adds: Issues,
  Policies, Legislators, Laws, Candidates.
- **Track → Legislators** = "follow a legislator" (activity notifications).
- **Optimistic local tracking pre-auth** — track before sign-in, persist on auth;
  higher conversion, more work.
- **Note:** Candidates + News & Media go beyond v1-scope's stated boundaries (campaign +
  social are explicitly out of scope there) — a conscious future mission expansion;
  keep out of the MVP data model so it doesn't leak scope.

## Applied v1-scope amendment (rationale)

`docs/v1-scope.md` § "AI and RAG Chat → In Scope" previously read
**"Signed-in-only grounded question answering."** The locked hero funnel deviates
from that, so this PR amended it to:

> Grounded question answering over Minnesota legislative data. Persistent chat
> sessions (history, follow-ups, saved context) are signed-in only. Anonymous
> visitors may receive a single stateless, rate-limited, cited answer as a
> conversion teaser — no session is persisted, and follow-ups, history, and
> tracking require sign-in.

Rationale: the cited-answer moment is the product's core proof ("Truth, Unconcealed");
gating it before the visitor experiences it suppresses adoption. The stateless one-shot
preserves the doc's real intent (sessions belong to signed-in users). Applied in this PR
alongside the plan-doc introduction (the Product Definition summary at `v1-scope.md:26`
was updated to match).
