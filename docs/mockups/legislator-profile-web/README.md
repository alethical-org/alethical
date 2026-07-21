# Handoff: Legislator Profile — WEB (LIVE)

## Overview
Individual legislator profile for Alethical, aggregating a member's public record —
identity, committees (with leadership), chief-authored bills, biography, and contact —
in plain language, with a link back to the official source. This is the **web/desktop**
build. Ships as a matched pair with the mobile build
(`design_handoff_legislator_profile_mobile/`).

Two chamber variants are included because chamber structure differs (see the spec):
- `LIVE Legislator Profile Senate web.dc.html` — Senate example: **Sen. Omar Fateh (DFL, District 62)**
- `LIVE Legislator Profile House web.dc.html` — House example: **Rep. Patti Anderson (R, District 33A)**

## About the design files & fidelity
Each `.dc.html` is a **design reference authored in HTML** (a Design Component rendered
by `support.js`) — not production code. Recreate in the Alethical codebase (React Native /
Expo + `theme/tokens.ts` and `theme/primitives.tsx`). **High-fidelity.** In the markup:
`<sc-for>`/`<sc-if>`/`{{ }}` = loop / conditional / binding. Full behavioral spec:
`LIVE-legislator-profile-spec.md` (in this bundle).

> **Before you build:** review this prompt, the spec, and both design files and flag
> anything — a better data source, a structural mismatch with the codebase, or a risk —
> before implementing. Let's refine together where it helps.

## Build ONE screen, chamber-parameterized
This is a single Legislator Profile screen driven by member data; the two files are the
same layout with chamber differences applied. Do NOT build two screens. The chamber
differences to parameterize (full detail in the spec):
1. **Legislative Service source.** Senate has a dedicated *Legislative Service* block →
   its own card. House embeds service in *Biographical Information* → pull Elected+Term
   from there AND surface the extra bio (occupation, education, family) in the Biography
   card.
2. **Chief-authored "See more" link.** Both chambers expose a per-member revisor
   chief-author list (`legid1`); wire each chamber's link.
3. **Source URL / photo / district format** differ per chamber (see spec).

## Legislative Service — multi-chamber model (critical)
`service = [{ label, elected }], term`. One "Elected to the {Chamber}:" line per chamber
tenure (chronological); `term` counts the CURRENT chamber only. Confirmed examples
(single-chamber Anderson; House→Senate Steve Green mem_id 1251) are in the spec — implement
the general model, not a single hard-coded row.

## Official source data used
Source of record: senate.mn `member_bio.html?mem_id=` / house.mn.gov `members/profile/`.
Per-member committee, service, contact, and portrait data are enumerated in the spec.
Portraits included: `uploads/62FatehOmar.jpg` (Fateh), `uploads/33A.gif` (Anderson).
**Bill numbers, co-author counts, and vote tallies in the mocks are illustrative** — wire
the real chief-authored reports from the revisor source at build.

## Assets & files in this bundle
- `LIVE Legislator Profile Senate web.dc.html`, `LIVE Legislator Profile House web.dc.html`
  — design references.
- `support.js` — DC runtime (not product code).
- `LIVE-legislator-profile-spec.md` — full behavioral spec + source data.
- `uploads/62FatehOmar.jpg`, `uploads/33A.gif` — member portraits.
- Icons are inline SVG. Nav/footer are shared with other product screens.
