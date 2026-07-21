# NEXT Legislator Profile (web) — spec notes (design-side source of intent)

Decisions from design (Jul 2026). Claude Code owns repo work; this file records
rules to bake into the handoff. Source of record = the official chamber profile
(e.g. Senate `member_bio.html?mem_id=…`).

## Purpose
Aggregate a legislator's public record — identity, committees (with leadership),
bills led, and service history — in plain language, with a link back to the
official source. Value-add over the official page: bills + votes + context in one
place.

## Identity / hero
- Name as the official title form ("Sen. Omar Fateh").
- District line **place-led, spelled out**: `{City} · {Chamber} District {n}`
  (e.g. "Minneapolis · Senate District 62"). NOTE divergence: the Bill Profile
  rail uses the compact "Minneapolis (SD 62)"; reconcile the two later.
- Party **spelled out** ("Democratic-Farmer-Labor", not "DFL") site-wide.
- **Portrait** from the official source photo (framed `<img>`, not the drop-slot).
- **"← All legislators"** breadcrumb → legislators directory (LIVE Search
  Legislators). Directory cards → this profile (round-trip both ways).

## Committees — show leadership
Render the member's real committee assignments, and surface **leadership roles**
as a badge on the row: **Chair** / **Vice Chair** (green-tint pill). Non-leadership
rows are plain. (Fateh: Higher Education — Chair; Human Services — Vice Chair;
Health and Human Services; State and Local Government.)

## Legislative Service — MULTI-CHAMBER model (important, CONFIRMED)
The official "Legislative Service" block is an **ordered list of election lines**
plus a Term, NOT a single elected value. Match the source order exactly.

- **Data model:** `service = [{ label, elected }], term` — render each line as
  **`{label}:` `{elected}`**, then a single **`Term: {term}`**. Do NOT hard-code a
  single "Elected" row.
- **`label` names the chamber the member was elected TO:** `"Elected to the House"`
  / `"Elected to the Senate"` — this is the educational piece (WHICH chamber/role,
  not a bare "Elected"). Use the chamber-qualified label even for single-chamber
  members.
- **One `{label}` line per chamber tenure**, in chronological order (earliest
  first). Re-election years are comma-joined on the SAME line as their initial
  election for that chamber.
- **`term` counts the CURRENT chamber only** — prior-chamber terms are NOT added in.
- Do not restate the role ("State Senator") in this block — the hero carries it.

**Single-chamber member** (e.g. Rep. Patti Anderson, House 33A, id 15610):
  - `Elected to the House: 2022`
  - `Term: 2nd`

**Multi-chamber member — served House, then moved to the Senate** (Sen. Steve
Green, mem_id 1251, Senate 02 — CONFIRMED against the source page): five House
terms, then elected to the Senate:
  - `Elected to the House: 2012, re-elected 2014, 2016, 2018, 2020`
  - `Elected to the Senate: 2022`
  - `Term: 1st`  ← 1st = current SENATE term; the five House terms are NOT counted.

The mobile screen demonstrates BOTH live via the preview-state band (House —
Rep. Anderson / Senate — Sen. Green).

## Contact
Capitol office + phone, then a single **"Official Senate profile →"** link to
the source `member_bio` page. (Email/newsletter/legislative-assistant intentionally
dropped — keep it to source-of-record + a deep link.)

## Authored Bills
- **Legislative-session filter** on the section header: current session live
  ("94th Legislature (2025–2026)"); past sessions listed but de-emphasized as
  roadmap (archive incl. retired legislators is future — never "coming soon").
- Show 2 bills, then **"See more"**.
- Bill code badge = FILLED amber (bill/law-code token), per CLAUDE.md.
- Co-authors shown only when present.

## On the roadmap (grouped, clearly not-live)
Both future features live in ONE bottom "On the roadmap" zone. Treatment: a single
gray mono eyebrow "ON THE ROADMAP" (JetBrains Mono 700, `#6f756f`) above a hairline
divider — NOT a bold black h2 (that over-weights not-yet-live features vs. real
record sections). Subtitle non-committal: "Features we plan to build." NEVER
"coming soon"/"SOON"; never a delivery commitment (see CLAUDE.md roadmap rule). Two
de-emphasized dashed cards, laid out as a horizontal 2-up pair.
1. **Claim this profile (Zillow-style).** Claiming links the legislator to the
   **existing** record (do not restate "never a separate profile" — implied). Once
   verified against official legislative records, a claimed legislator can: manage
   their biography, write up the bills they've worked on, and add their own context
   alongside the public facts. (Match these verbs to the claim modal's three rows.)
2. **Vote explanations ("Why the votes?").** Framed as an OPTION, never a guarantee:
   "Once claimed, a legislator will have the option to explain any vote they cast."
   The explanation layer lives on the profile. Reciprocal "jump from a vote to here"
   link on Bill/Votes pages is the other half (not yet wired).

## "See more" button (chief-authored bills)
- Full-width outline button, centered content, label **"See more"** + a long
  right-arrow SVG. Arrow: `viewBox 0 0 33 24`, path `M3 12 H28 M20 5 L28 12 L20 19`,
  rendered at ~22×16 with `display:block` so it optically centers on the label's
  x-height (flex `align-items:center`). Same arrow on both chamber variants.
- **Each chamber's** "See more" links to that member's official revisor chief-
  author list (see Senate/House difference #2 below). Same arrow on both variants.

## Senate vs House — structural differences
1. **Legislative Service location.** Senate bio has a dedicated *Legislative
   Service* block → its own card. House embeds it in *Biographical Information*
   (Occupation / Education / Elected / Term / Family) → pull Elected+Term into the
   Service card AND surface the extra bio (occupation, education, family) in the
   Biography card. Senate bios don't expose that structured occupation/education.
2. **Chief-authored link.** BOTH chambers expose a per-member revisor chief-author
   list (House via `status_result.php?…legid1={id}`; Senate via
   `revisor.mn.gov/bills/status_result.php?body=Senate&…legid1={legid}`). Wire each
   chamber's "See more" to its own revisor link. (Earlier note that "Senate has none"
   was WRONG — corrected.)

3. **Source URL.** Senate `senate.mn/members/member_bio.html?mem_id={memId}`;
   House `house.mn.gov/members/profile/{id}`.
4. **Photo.** Senate: senate.mn headshot. House:
   `house.mn.gov/hinfo/memberimgls94/{district}.gif` (full-size `/members/profile/photo/{id}`).
5. **District format.** Senate numeric (62); House numeric+letter (33A). Both
   render place-led + spelled out, party spelled out.

## Example members / official source data used
- **Senate — Sen. Omar Fateh (DFL, District 62, Minneapolis):** mem_id 1247.
  Committees: Higher Education (Chair), Human Services (Vice Chair), Health & Human
  Services, State & Local Government. Elected 2020, re-elected 2022; Term 2nd.
  Senate Bldg. Rm 3219, 651-296-4261. Portrait `uploads/62FatehOmar.jpg`.
- **House — Rep. Patti Anderson (R, District 33A, Dellwood):** id 15610. Committees:
  Fraud Prevention & State Agency Oversight Policy (Vice Chair), Taxes,
  Transportation Finance & Policy. Elected 2022; Term 2nd. Business owner; B.A. U of
  M, M.A. Hamline; married, 6 children. Centennial Office Bldg. 2nd Floor,
  651-296-3018. Portrait `uploads/33A.gif`. Chief-authored revisor link legid1=15610.
- Bill numbers/co-author counts/vote tallies in both mocks are **illustrative** —
  wire real chief-authored reports from the revisor source at build.

## Bundle note (when we DO hand off)
When a handoff bundle is assembled for these screens, include: this differences
section, the official source info per member, and the member portrait file attached
in the bundle. (Bundles not created yet — do not assemble until asked.)
