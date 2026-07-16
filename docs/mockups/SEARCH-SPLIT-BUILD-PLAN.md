# Search split — executable build plan (Search Bills + Search Legislators)

Companion to `search-bills/` and `search-legislators/` (per-page specs + BUILD-NOTES).
This is the file-by-file plan for building the matched pair on the green design system.
Branch: `feat/search-bills-legislators-screens` (off `origin/main`).

## Architecture decision (low-risk, additive)
The new screens are **full-page root-stack screens** with the shared `TopNav` chrome
(like `screens/redesign/HomeSignedOutScreen.tsx`) — NOT inside `MainTabs`. So we add
`/bills` + `/legislators` **additively**; the old combined `SearchScreen` (in `MainTabs`,
URL `/search`) keeps working until the global rail→TopNav migration. Nav variant on these
pages = `"page"` (shows the top-level ✦ Ask entry, per the IA locked decision).

## Reuse decisions (don't rebuild what exists)
- **Scaffold**: `PageBackground` → root `View` → `ScrollView` (`scroll`/`scrollContent`)
  → hero wrapper (gradient + masked dot overlay) containing `<TopNav variant="page" …>`
  → results section (`Container`, white) → `<Footer>`. Copy the exact pattern from
  `HomeSignedOutScreen` lines ~906-925 + its `heroGradientWeb`/`heroDotsWeb`.
- **Primitives** (`theme/primitives.tsx`): `Container`, `TopNav`, `Footer`, `PrimaryButton`,
  `GoogleButton`, `Logo`. Tokens (`theme/tokens.ts`) already cover the whole palette
  (green ramp, `purple` for AI/focus, `status.*` for vetoed/progressEmpty, gradients,
  shadows). Add tokens only if a literal value is missing.
- **Field focus**: reuse `theme/fieldFocus.ts` (`useFieldFocus`, `fieldFocusRing`,
  `fieldOutlineReset`) for the purple search-bar focus ring.
- **Hooks** (`hooks/useAppQueries.ts`): `useBills`, `useLegislators`, `usePolicyAreas`,
  `useSessions`, `useMeta`, `useTrackedBills`, `useToggleTrackedBill`; `useAuth` for
  sign-in + tracking gate; `trackSignInReturnTo` from `navigation/webRoutes`.
- **Filter controls**: the existing `SearchFilterPanel` already wires chamber segmented +
  status/session dropdowns + omnibus toggle + policy pills to real data. The bills hero
  filter row mirrors it; the legislators row is a subset (chamber + party + session, NO
  status/omnibus/policy). Build a hero-styled filter row in the shared search module rather
  than forcing the Card-wrapped panel into the hero.

## New files
1. `components/search/searchPieces.tsx` — shared search building blocks:
   - `SearchPageShell` — the scaffold above; props: `heroChildren`, `children` (results),
     `onNavigate`, `onSignIn`, `onAsk`, `openMenu` state.
   - `SearchHero` — H1 + cross-link (Bills⇄Legislators) + search bar (icon, placeholder,
     purple focus, green Search button; legislators variant adds the "Find by address" link).
   - `ChamberSegmented`, `FilterDropdown` (statuses/parties/session), `OmnibusToggle`,
     `FilterPill` (policy/area pills w/ mono count) — hi-fi styled.
   - `ResultsHeader` (count + sort label + "Data as of {date}"), `NoResults`
     (dashed card + active-filter chips + black "Clear filters"), `Pagination`.
2. `components/search/BillResultCard.tsx` — hi-fi bill card (see spec `search-bills/README.md`).
3. `components/search/LegislatorResultCard.tsx` — hi-fi legislator card.
4. `components/search/SignInModal.tsx` + `ReturnToast.tsx` — bills-only intent-preserving
   Track sign-in (reuse `GoogleButton`). Legislators screen has NO follow/modal/toast.
5. `screens/redesign/SearchBillsScreen.tsx` — composes shell + hero + bill cards + states.
6. `screens/redesign/SearchLegislatorsScreen.tsx` — composes shell + hero + legislator cards.

## Data mapping + interim behavior (from grounding, 2026-07-15)
- **Bill card**: `identifier` (code badge), `aiAnalysis.summary` (AI SUMMARY; genuine —
  falls back to `title`), `status` (label + tone), 5-step progress **derived client-side
  from `status`** (see helper below — honest, matches the badge, no #295 dependency),
  `sponsorNames`/`chiefSponsorIds` (author link), `rollCallCount` (pill → `/bills/:id?tab=votes`),
  omnibus badge (from topics/flag if present), policy chips (`aiAnalysis.policyAreas`).
  "+N co-authors" only if a count is available (else omit) until #295.
- **Legislator card**: initials from `name`, `party` chip (map `D`→"DFL" for display until
  #296 serves raw DFL; neutral, no partisan color), `chamber · district`, role line =
  **chamber-derived title** ("State Senator"/"State Representative"), committee chips from
  `committees` (up to 2 + "+N more"), activity line "{n} bills authored" (real after #291/
  PR #299 merges; may read 0 until then). NO follow.
- **Session label**: from `useSessions` (DB serves "94th Legislature (2025-2026) Regular
  Session"). **Sort**: bills = "Sorted by latest action"; legislators = "Sorted by name (A–Z)".

## Status → progress stage helper (client-derived, bill card)
Map lowercased `bill.status` keyword → `{ index 0-4, tone }`:
`vetoed` → tone `vetoed`, 4 green + final red; `signed`/`law` → index 4, tone green (all 5);
`senate` → 3; `house` → 2; `committee` → 1; else (`proposed`/default) → 0; tone neutral for
0-3. Segment colors: on `brand.base` (#2ed47e), off `status.progressEmpty`, vetoed-final
`status.vetoedStep`.

## Routing (increment after screens compile)
- `navigation/types.ts`: add `Bills` + `Legislators` root-stack route params (`{ q?: string }`).
- `navigation/RootNavigator.tsx`: register `SearchBillsScreen` + `SearchLegislatorsScreen`
  as root-stack screens (like `Home`/`FindMyLegislator`).
- `navigation/webRoutes.ts`: parse+serialize `/bills` (list) and `/legislators` (list);
  honor `REDIRECTS` `/search` → `/bills` (registry already declares it). Keep `/bills/:id` +
  `/legislators/:id` detail routes intact.
- Wire nav: on both new screens `handleNavigate` routes search-bills→Bills,
  search-legislators→Legislators, find-my-legislator→FindMyLegislator, track-bills→Tracked,
  `onAsk`→Ask; the two hero cross-links navigate Bills⇄Legislators. Update
  `HomeSignedOutScreen.handleNavigate` (lines 842-859) + the capability cards (1029-1043)
  so Bills/Legislators go to the new routes instead of collapsing to `Search`.

## Responsive + interaction
- Mock is desktop (~1600px); derive mobile: single column, filter row wraps, legislator
  grid 2-col → 1-col, touch targets ~44px, no hover-only affordances (cards need resting +
  `:active`). Dropdowns: close via document pointerdown listener / `Modal`, never a
  full-screen click-away overlay (RN-Web stacking trap, #171). Guard web-only CSS with `isWeb`.

## Verification (design-build step 9)
`just up` → `http://localhost:8081/bills` and `/legislators`. Compare states to the specs
(desktop + mobile): results, no-results, pagination, (bills) Track sign-in modal + toast,
hero focus ring, cross-links. Run `design-audit` for live-only a11y/interaction. Then
`just lint` **and** `just format` (CI runs repo-wide `prettier --check .`). Verify the
Vercel preview, then PR (closes the split item; stale-reference check per workflow rule 6).

## Sequence (commit at each)
1. ✅ Land bundles in `docs/mockups/` + BUILD-NOTES.
2. ✅ This plan.
3. `searchPieces.tsx` (scaffold + hero + filter controls + states).
4. `BillResultCard` + `LegislatorResultCard` (+ SignInModal/ReturnToast).
5. `SearchBillsScreen` + `SearchLegislatorsScreen` (compose; typecheck).
6. Routing (types/RootNavigator/webRoutes + home nav wiring).
7. Live verify + design-audit + lint/format; fix.
8. PR for review.
