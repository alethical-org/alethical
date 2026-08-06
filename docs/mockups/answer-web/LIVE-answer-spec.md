<!-- LANDED COPY — received Jul 31 2026, kept as the artifact as received. -->

> **Correction received Jul 31 2026 (Eugene), after this bundle was written — web and mobile.**
> The meta line under the question in this bundle reads `2025–2026 LEGISLATIVE SESSION · AS OF
> JUL 30, 2026`, and the foot of the page repeats that date as "Updated Jul 30, 2026". That
> prints one date twice, and dating the *answer* overclaims: an answer can never be fresher
> than the bill record it came from. **Build it as: meta line = the session alone, no date; the
> page's only date is the standard source line at the foot, carrying the answering bill's own
> record date (the same value the bill's page shows), never a generation timestamp.** Same on
> mobile — the header's separate date line beside Share goes, the session text stays.
> Everything else in this bundle stands. Full reasoning and the other build decisions:
> `docs/product-onboarding/grounded-ask-spec.md` §9.5 (The chip-reached answer page — decided
> web design), and the general rule in `docs/design/ui-copy-guide.md` § Dates on a page.

# LIVE Answer (web) — spec notes for handoff

Design-side source of intent for the **Answer** screen (the page a sample question chip
on Bill Detail leads to). Claude Code owns all repo/PR work; this file records the
decisions so they are built correctly up front.

Supersedes the in-scope parts of `NEXT-Ask-answer-spec.md`. See "Deferred to roadmap"
at the bottom for what that older file still describes but is **not** being built now.

---

## Scope (agreed 2026-07-31)

**In scope**
- The answer page reached from a **sample question chip** on Bill Detail (web + mobile).
- **Signed-out only.** Every state on this screen is the signed-out state.
- Sample/suggested question chips as the ONLY interactive way to ask anything.

**Out of scope — do not build**
- **Freeform ask on this page.** No question input, no Ask button, no composer of any
  kind on the answer screen. The full-width query field the current live answer page
  shows at the top is removed.
- **Sign-in / account flows.** No account gate, no "Continue with Google", no signed-in
  variant of any region. The nav **Sign in** button stays (it is global nav chrome, not
  part of the answer flow) but nothing on this page depends on auth.
- Follow-up threads, saved history (see Deferred).

---

## Page structure (top to bottom)

1. **Nav** — global, unchanged.
2. **Answer header** on the gradient wrapper:
   - Back link: **"← Back to {CODE}"** (e.g. "← Back to HF 719") returning to the bill
     whose chip produced this answer. Required: the chip is the only entry point, so
     the page must offer the way back.
   - **H1 = the question, verbatim**, 42px/1.08/800/−0.02em. No bill-code prefix.
   - Meta line: `2025–2026 LEGISLATIVE SESSION · AS OF {MON D, YYYY}`
     (13px/500/0.06em, `#6f756f`). No bill code — the back link and the bill card
     already carry it.
   - **Share** button at the right, bottom-aligned to the header rule.
   - Header closes with a **1px `rgba(17,21,15,0.1)` hairline** across the 1240px
     content width — the same rule Bill Detail's tab row sits on. Content begins
     **40px** below it (not 74px; not the ~90px the live bill page currently has).
3. **Answer body**, white panel, `40px 56px 8px`, two columns `1.4fr / 1fr`, gap 56px,
   max-width 1240px:
   - **Left:** the answer, then the bill card, then "Ask another question".
   - **Right:** the cited-sections rail, **sticky at `top:24px`**.
4. **Source line** — `Source: Minnesota Legislature · revisor.mn.gov · Updated {date}`,
   mono grey, 52px above with a hairline. Same as every product page.
5. **Footer** — global, unchanged.

**No preview-state band.** With sign-in out of scope there is no demo state to toggle,
so the band is omitted rather than left decorative.

---

## The answer itself

- Rendered as **plain statements**, in Bill Detail's Key-points treatment where the
  answer is a set of points: 8px round ink `#11150f` bullet, 19px/500/1.5 text `#2c322c`,
  15px between items.
- **No heading above it.** The H1 question is the heading. Do NOT add "Key points" —
  that phrase means *the main things this bill does*, and an answer is usually a slice
  of the bill, not a summary of it.
- **No inline citation chips.** Earlier drafts embedded numbered purple chips in the
  prose. Removed: the cited sections live in the rail only, exactly as Bill Detail
  separates "Key points" from "From the bill".
- **List answers render as a multi-column index, alphabetised.** When the answer is an
  enumeration of names (cities, agencies, districts), lay it out as a 3-column grid
  (`grid-auto-flow:column`, 7 rows), 16px/500, gap `9px 28px`, sorted A→Z, **unnumbered**
  — the lead sentence carries the count ("Nineteen cities are named for infrastructure
  grants:"). Live renders these as a 19-row numbered list in bill order, which is tall
  and unscannable when you are looking for one name.

---

## Cited sections rail — "From the bill"

- Heading **"From the bill"** (22px/800) with a right-aligned **"Cited Sections"** label
  (mono 12px/700/0.06em `#6f756f`) carrying the **green circle-check** (`#149d5b`). This
  is Bill Detail's signed-off treatment — never drop the check. **No count** in the label.
- Cards are Bill Detail's excerpt cards exactly: background `#f7f9f8`, border
  `1px solid rgba(17,21,15,0.08)`, radius 14, padding `14px 16px`, **no shadow**.
  **The whole card is the link** to the passage in the bill's Bill Text tab.
- **Hover / focus lifts, never tints:** background → `#ffffff`, border-color → `#5b30d6`,
  plus one tight ring `0 0 0 3px rgba(91,48,214,0.14)`. No outer bloom. Transition .15s.
- Each card carries ONE purple mono chip: `Art. 1, Sec. {N} · {Section title} →`
  (bg `#f0ebfc`, border `#d8c9f7`, text `#5b30d6`, mono 13px/700, radius 7, padding
  `3px 9px`, trailing "→" glyph at weight 400). Sentence case on the title.
- Quotes below the chip: `padding-left:12px`, `border-left:3px solid #bda6ee`, italic,
  14px/1.5, `#4f5651`. The chip-to-first-quote gap is 8px; later quotes in that section
  are 15px apart. **No quotation marks** — the rule and the italic already mark them as quoted.
- Where the bill text carries a grant label and amount, keep them ahead of the sentence
  (`Freeport; I-94 Interchange | 6,000,000 — For a grant to…`).
- **Truncation ends at a whole word with an ellipsis.** Live currently cuts mid-word
  ("and drinki", "of a ca", "the intersecti") — do not reproduce that.
- **Do not print the source's metadata prefix.** Live prefixes every quote with
  `Bill: HF 719 Article: ARTICLE 1 APPROPRIATIONS Section: Sec. 24. PUBLIC FACILITIES
  AUTHORITY`. The purple chip already states the location; printing it again wastes the
  card and pushes the actual quote out of view.
- **Single-bill only** (see Deferred for the multi-bill case).

---

## The bill card

Built on the **Search Bills result-card** structure, reconciled for this page.

Row 1 (flex, gap 12, wrap):
- **Filled amber code badge** — bg `#fbf1e2`, border `#f0d6a8`, text `#a76a1a`, mono
  15px/700, radius 7.
- **Ghosted amber OMNIBUS tag** when the bill is an omnibus — transparent bg, border
  `#e3c17f`, text `#a76a1a`, radius 8, with the omnibus glyph. Ghosted (not filled)
  because a filled code badge shares the row.
- **Stage label + 5-step progress bar** — "Signed into Law" green `#149d5b` 15px/700;
  bars 26×8, radius 4, `#2ed47e` on / `#e2e5e4` off / `#e5484d` terminal-red if vetoed.
- **Track button, right-aligned** (`margin-left:auto`) — **dashed border**
  `1px dashed rgba(17,21,15,0.3)`, white fill, text `#4f5651` 14px/700, radius 12,
  padding `10px 18px 10px 15px`, "+" icon, hover → border and text `#11150f`.
  The dash marks it as a roadmap feature; identical to the Search Bills card.

Then:
- **Title** (21px/800) — the bill's **plain title** ("Statewide Capital Projects and
  Bonding Bill"), linking to the bill page. **Never the full official title** ("A bill
  for an act relating to state government; authorizing spending to acquire…") — live
  prints eleven lines of statute citations here.
- **Plain-language summary** (15px/1.55, `#4f5651`). Kept deliberately: the answer is a
  slice of the bill and never says what the bill *is*.
  (Reconciliation note: when the answer itself is a bill summary, drop this paragraph —
  do not print the same content twice on one screen.)
- Hairline, then the meta rows (14px, label grey + bold value):
  `Chief author: {Title} {Name} →` · `Latest action: {action} {date}` · `Effective: {value}`.
- **Issue chips** — title case, bg `#f1f1f4`, text `#4f5651` 13px/600, radius 8,
  padding `6px 12px` — followed by the green-tint **"{N} votes"** chip
  (bg `#e4f8ee`, text `#149d5b`) linking to the bill's Votes tab.

**Not on this card:** a separate "Bill overview →" or "View bill →" link (the title is
the link), and the chamber/status caps line (the stage label replaces it).

---

## "Ask another question"

- Section heading **"Ask another question"** (22px/800) — a real heading, matching
  "Key points" / "From the bill". **Not** a mono all-caps eyebrow: in this product mono
  eyebrows are reserved for the small labels inside the facts rail (WHERE IT STANDS,
  CHIEF AUTHOR, ISSUES).
- Below it, **suggested question chips only** — no field. Chip = 13px/500 `#4f5651`,
  white, border `1px solid rgba(17,21,15,0.12)`, radius 999, padding `8px 14px`.
- **Hover is purple, not green:** border and text `#5b30d6` + ring
  `0 0 0 3px rgba(91,48,214,0.14)`. This is the canonical chip hover site-wide.
- **Chips size to their own label:** `display:inline-flex; max-width:100%;
  white-space:normal; overflow-wrap:anywhere` in a `flex-wrap` row. Chip labels are
  generated from bill topics and run long ("Which legislators authored Capital
  Investment And Bonding bills?") — they must wrap and grow, never overflow the pill.

---

## Share

- **Share button, not "Copy link", and it lives in the header — not at the foot of the
  page.** Bill Detail's exact treatment: white, border `1px solid rgba(17,21,15,0.16)`,
  radius 12, 16px/600, three-node share glyph, padding `12px 20px 12px 17px`, hover
  border `rgba(17,21,15,0.32)` + bg `#f7f8fa`. Bottom-aligned to the header hairline,
  the same way Share sits on Bill Detail's tab rule.
- Opens the **same anchored popover**: title "Share this answer", the canonical answer
  URL in a mono readonly field with a green **Copy** button that becomes **Copied**, then
  a **SHARE TO** row of 44px circular social buttons (LinkedIn · X · Facebook · Email)
  on `#f1f1f4`. A transparent fixed backdrop and a × close it. `cardPop` 0.16s in.
- **Overlay layering (REQUIRED):** the Share wrapper is `position:relative; z-index:60`;
  the popover is `position:absolute; z-index:1` within it; the backdrop is
  `position:fixed; inset:0; z-index:0`. Sibling content below must not create a
  competing stacking context (no gratuitous `position:relative;z-index`, `transform`, or
  `opacity` layers) or the popover opens behind the answer body. This exact bug has
  shipped twice (Legislator Profile session filter; Bill Search "Sorted by" menu).
- Copy link is **inside** the share sheet, one action among several — not a standalone
  button on the page.

---

## Accessibility (shipping defaults — verify before done)

- Global focus ring in `<style>`: `2px solid #7c5cff`, offset 2px, `!important`, on
  `a/button/input/textarea/select/[tabindex]/[role="button"]:focus-visible`. `#7c5cff`
  (not `#5b30d6`) because it must clear 3:1 on the dark footer too.
- Every control is a real `<button>`/`<a>`; icon-only controls (close ×, social) carry
  `aria-label`; the share popover is a labelled `role="dialog"`.
- Faint grey text on light is `#6f756f` — never `#9aa39e` or `#7c847f` (both fail AA).
- Dark ink on green fills, never white-on-green.
- The cited-section cards' affordance is not hover-only: each is a real link, so it is
  reachable and activatable by keyboard and touch.

---

## Copy conventions

- `2025–2026 LEGISLATIVE SESSION` — keep "legislative", keep the years.
- One-line captions take **no terminal period**; multi-sentence body keeps normal
  punctuation. Unit nouns after a number stay lowercase ("2 votes", "Nineteen cities").
- Bill summaries lead with what the bill does — never open with the bill number, never
  cite raw statute locations.
- Trailing directional arrows are the **"→" glyph** in the control's own font at weight
  400 — never a fixed-size SVG (it renders as a stub near the cap line).

---

## Live → design deltas (diffed 2026-07-31 against the live answer page)

Named explicitly so they are fixed up front rather than discovered after deploy:

1. Live shows a **freeform query field with a green Ask button** at the top of the answer
   page — remove (out of scope).
2. Live source quotes carry the **raw metadata prefix** (`Bill: HF 719 Article: …
   Section: …`) — remove; the purple chip states the location.
3. Live source quotes **cut off mid-word** — truncate at a word boundary with "…".
4. Live's bill card leads with the **full official title** — use the plain title.
5. Live's sources are labelled **"SOURCES"** in mono caps with numbered cards — use
   "From the bill" + "Cited Sections ✓" and the purple chip anatomy.
6. Live's follow-ups are labelled **"CONTINUE"** in mono caps with green arrow links —
   use the "Ask another question" heading and the standard pill chips with purple hover.
7. Live's **"Copy link"** sits at the very bottom — replace with Share in the header.
8. Live has **no back link** to the originating bill — add it.
9. Live's answer body and header have **no separating rule** and a large soft gap —
   add the header hairline; content starts 40px below it.

---

## Deferred to roadmap (do NOT build now)

- **Freeform questions and answers** of any kind on this screen.
- **Sign-in, accounts, follow-up threads, saved history.** The auth-gating model in
  `NEXT-Ask-answer-spec.md` (top field ungated / follow-ups gated / signed-out chips +
  Google button) describes that future state and is **not** in this handoff.
- **Multi-bill answers.** Everything here assumes one bill. When an answer cites sections
  from more than one bill, the rail heading must change from "From the bill" to
  **"Cited sections"** and each card must carry its own amber bill-code badge — otherwise
  the reader assumes every quote came from the single bill shown on the left.
- **Track** — present but dashed (roadmap), consistent with Search Bills.
