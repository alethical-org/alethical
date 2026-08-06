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
- **Purple** = the excerpt's light-purple `#bda6ee` left rule + focus. Numbered citation squares
  are removed because they only repeated the passages' order.

## Do not touch
The "BILL" label, the summary paragraph text, the "Such as infinite scrolling…" gloss under
Addictive features, the bill badge's amber styling, the hero's left-column buttons, and everything
below the hero (Bill Activity, account card, finder band, footer).

## Deviation
You may deviate where you have good reason (a component reality, an a11y issue, a better in-repo
pattern) — but **list every deviation** (what the spec said, what you did, and why) in your final
response so we can fold it in or correct it.
