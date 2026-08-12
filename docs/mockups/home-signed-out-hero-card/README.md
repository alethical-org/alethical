# Handoff — Home hero ANSWER CARD refinements (web, signed out)

> **Repo context** (added on landing, 2026-08-04). Tracked design reference for the
> **signed-out home hero answer card** — refinements on top of the v2 home page
> (`docs/mockups/home-signed-out-v2/`, which stays as the frozen v2 handoff). This bundle
> is authoritative for the hero answer card and supersedes v2's answer-card description.
> Built in React Native in `apps/frontend/src/screens/redesign/HomeSignedOutScreen.tsx`
> (the `AnswerCard` component); tokens live in `apps/frontend/src/theme/tokens.ts`. The
> `.dc.html` is the *values + state + copy* reference, **not code to port**. The card is a
> static marketing illustration built from real data — not a generated answer — so it is
> deliberately not reconciled with `.claude/rules/grounded-answers.md`.
>
> **The card's facts are literals on purpose, and a scheduled check keeps them true**
> (added 2026-08-12, [#1467](https://github.com/alethical-org/alethical/issues/1467)).
> The wording, the two-column meta and the choice of three quoted passages are editorial
> calls no API response can make, so the built card writes HF 4138's signing date,
> effective date, chief author, both chamber vote totals and all three excerpts as
> literals. `scripts/check_home_hero_card_literals.py` compares every one of them against
> the published record monthly and on any PR touching the card
> (`.github/workflows/home-hero-card-facts.yml`), and files an issue when one drifts —
> which is what makes a literal safe here.
>
> **This bundle is what the card must look like. Do not edit these requirements to match
> an implementation that dropped one of them.** [#1450](https://github.com/alethical-org/alethical/pull/1450)
> replaced the card's designed content with the saved public bill response, deleted the
> vote column and the cited-sections stack for lack of a data source, and rewrote this
> file in the same commit to describe the smaller card — so nothing recorded that the
> design had lost anything. Reverted in
> [#1467](https://github.com/alethical-org/alethical/issues/1467). If live data cannot
> supply a designed element, prove the fact exists nowhere in our API before removing it
> (it did exist: the vote totals are served at `/api/v1/bills/{id}/votes`), and take the
> removal to Eugene rather than to this file.

**Screen:** signed-out homepage, WEB. **Scope:** the hero **answer card** (the demo card on the
right that shows a grounded answer) ONLY. The hero's left column (Search Bills / Search Legislators
buttons) and everything else on the page are unchanged. **Do NOT touch the bill-code badge's amber
styling — it is already correct on live.**

## What's in this bundle
- `LIVE Home web signed out.dc.html` — the target mock. Authoritative for the **design only**.
  The card's bill content (HF 4138, dates, votes, excerpts) is **illustrative placeholder** — do
  not reconcile or reproduce it.
- `NEXT-home-spec.md` — spec notes; see the **"Hero answer card"** section for the anatomy + rules.

## The delta (answer card, top → bottom)
1. **Cited-sections header** → "CITED SECTIONS" + green circle-check; remove the statute number
   from the label (was "Cited ✓ Section 325M.40").
2. **Section titles** → drop the "3(b) — / 5(a) — / 4(a) —" subsection prefixes; plain-language
   names only (Parental consent / Addictive features / Privacy by default).
3. **Excerpts** → remove the surrounding quotation marks from all three italic excerpts.
4. **Footer** → remove the external "View bill text →" + "revisor.mn.gov" caption; replace with a
   single internal **"View bill profile →"** to our bill profile. Route the HF badge to that same
   profile (badge + link agree) — **without** changing its amber styling. The external source-text
   link ("Read the full law" / "Read the bill text") lives on the bill profile, not here.
5. **Companion bill** → remove the "Companion bill SF 4696 →" meta line.
6. **Vote counts** → move "House 132–2 · Senate 66–0" into the right meta column under Chief
   author (two balanced columns: left = Signed/Effective, right = Chief author/votes); delete the
   standalone row.
7. **Dividers** → keep only the labeled "BILL" divider; remove the plain hairline between the bill
   facts and the summary.
8. **Spacing** → ~22px above the summary paragraph (was ~14px) to replace the removed hairline.

## Color roles (don't regress to the wrong token)
- **Amber** = bill-code identity (HF badge — already live, don't touch).
- **Green** = actions/links and the cited/verified ✓ check.
- **Purple** = citation chips + focus. Numbered citation squares are removed because they only
  repeated the passages' order; quoted excerpts use italic grey type with no decorative rule.

## Do not touch
The "BILL" label, the summary paragraph text, the bill badge's amber styling, the hero's
left-column buttons, and everything below the hero (Bill Activity, account card, finder band,
footer). The "Such as infinite scrolling…" gloss is flush left, roman 14px/1.45 in `#6f756f`,
with a 10px gap above it.

## Deviation
You may deviate where you have good reason (a component reality, an a11y issue, a better in-repo
pattern) — but **list every deviation** (what the spec said, what you did, and why) in your final
response so we can fold it in or correct it.
