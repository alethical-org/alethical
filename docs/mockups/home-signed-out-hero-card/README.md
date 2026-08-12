# Handoff — Home hero BILL CARD refinements (web, signed out)

> **Repo context** (added on landing, 2026-08-04). Tracked design reference for the
> **signed-out home hero bill card** — refinements on top of the v2 home page
> (`docs/mockups/home-signed-out-v2/`, which stays as the frozen v2 handoff). This bundle
> is authoritative for the hero bill card and supersedes v2's answer-card description.
> Built in React Native in `apps/frontend/src/screens/redesign/HomeSignedOutScreen.tsx`
> (the `AnswerCard` component); tokens live in `apps/frontend/src/theme/tokens.ts`. The
> `.dc.html` is the *values + state + copy* reference, **not code to port**. The card is a
> current saved bill record — not a generated answer. Its visible record fields must follow the
> public bill response rather than copying the mock's illustrative values.

**Screen:** signed-out homepage, WEB. **Scope:** the hero **bill card** on the right ONLY. The
hero's left column (Search Bills / Search Legislators
buttons) and everything else on the page are unchanged. **Do NOT touch the bill-code badge's amber
styling — it is already correct on live.**

## What's in this bundle
- `LIVE Home web signed out.dc.html` — the target mock. Authoritative for the **design only**.
  The running card gets its bill facts from the saved public bill response, not from the mock's
  illustrative placeholder content.
- `NEXT-home-spec.md` — spec notes; see the **"Hero bill card"** section for the anatomy + rules.

## The delta (bill card, top → bottom)
1. **Record fields** → render the bill code, status, effective date, chief author, and summary from
   the saved public bill response. Omit a field the response does not provide.
2. **Unsupported detail** → omit vote totals and statutory excerpts. The small public response does
   not prove a complete, current version of either on Home.
3. **Footer** → remove the external "View bill text →" + "revisor.mn.gov" caption; replace with a
   single internal **"View bill profile →"** to our bill profile. Route the HF badge to that same
   profile (badge + link agree) — **without** changing its amber styling. The external source-text
   link ("Read the full law" / "Read the bill text") lives on the bill profile, not here.
4. **Companion bill** → remove the "Companion bill SF 4696 →" meta line.
5. **Dividers** → keep only the divider below the headline; remove the plain hairline between the bill
   facts and the summary.
6. **Spacing** → ~22px above the summary paragraph (was ~14px) to replace the removed hairline.

## Color roles (don't regress to the wrong token)
- **Amber** = bill-code identity (HF badge — already live, don't touch).
- **Green** = actions/links.
- **Purple** = focus.

## Do not touch
The bill badge's amber styling, the hero's left-column buttons, and everything below the hero
(Bill Activity, account card, finder band, footer). The bill headline and every bill field are
allowed to change when the saved public response changes.

## Deviation
You may deviate where you have good reason (a component reality, an a11y issue, a better in-repo
pattern) — but **list every deviation** (what the spec said, what you did, and why) in your final
response so we can fold it in or correct it.
