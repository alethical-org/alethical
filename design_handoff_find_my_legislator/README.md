# BUILD HANDOFF — Find My Legislator (desktop + phone)

## ⚠ RECONCILED — AUG 7, 2:20 PM EDT · all 14 agreed, 6 corrections applied

Claude Code accepted all 14 outcomes and corrected five details. All six are now in the reference.

1. **Issue cap — the cause is unapproved free-text labels, not duplicate rows.** Chips draw only from the
   **26 approved canonical labels**, which caps the remainder at **"+20 more"** by construction. Our design
   already showed 6 + remainder; the rationale comment now records the real cause.
2. **The mangled address is not this page's bug.** The saved-address page preserves separators when the URL
   has them — the page that _creates_ the link is what's broken. Item withdrawn from this screen's scope.
3. **Congressional district: Cold Spring is MN-6**, confirmed. The lookup must read an explicit
   congressional map layer rather than inferring from number-only map results.
4. **No-committee card:** `COMMITTEES` heading + **"None recorded"** (15px, `#6f756f`). Demuth's official
   page genuinely has no committee section, so this is the honest display, not a data gap.
5. **Loading:** keep the one-line message and answer-shaped placeholders, but **delay the shimmer 250ms**.
   Cold lookups run ~3s; warm-cache returns under 0.5s, where a shimmer that appears and vanishes reads as
   a glitch.
6. **No-match copy is example-based:** _"Enter a house number and street name, like 350 S 5th St,
   Minneapolis, MN 55415."_ Their catch — the old line told the reader to pick from suggestions that, by
   definition, never appeared.
7. **Source line goes after the map AND the Census notice.** The reference had it before the notice;
   corrected on both frames.
8. **Party spelled out everywhere** — Republican / Democratic-Farmer-Labor. Already correct here as a
   labelled row; this settles the cross-screen question in favour of the long form.

**States: 10** (nothing entered · looking up · found · address choice · not recognized · outside Minnesota ·
location refused · seat vacant · rate limited · service down), plus map component variants. Any "8 states" or "9 states" reference
elsewhere is stale.

**Sample data is illustrative placeholder** — names, districts, counts and addresses. Do not reconcile or
reproduce. (Earlier "verified facts" wording referred to the sourcing of the examples, not to their being
production values.)

## Location-refused state — three live differences (AUG 7)

Copy is correct and stays.

1. **Remove the green-ruled card** — third state with the same fault. Fix the component once.
2. **Add the amber warning glyph** before "We couldn't use your location", and note this message belongs
   to the **location button**, not the address field: `aria-describedby` on _Use my location_. Today it
   sits between the two controls with no programmatic owner, so a screen-reader user can't tell which
   one failed.
3. **Clear the stranded field value.** Live shows an unrelated address in the field while reporting a
   _location_ failure — two failures at once, with guidance pointing at a field that isn't empty.
   Whichever action ran last owns the answer area: pressing _Use my location_ clears any address error,
   typing clears the location error. Never both.

The purple focus ring on _Use my location_ is our keyboard focus token (`#7c5cff`) and is correct — don't
change it.

## Outside-Minnesota state — two live differences (AUG 7)

Copy is correct and stays. The container and the inline message are wrong, identically to
not-recognized below:

1. **Remove the green-ruled card** around "Alethical only covers Minnesota…" — plain text on the page
   background, 17px/1.55 `#4f5651`, ~62ch. This is **one fix across every error state**: whatever
   component draws that ruled card should stop being used for guidance anywhere on this page.
2. **Add the amber warning glyph** before "That address is outside Minnesota" (14px, `#a76a1a`,
   aria-hidden); message 13.5px/600 `#a76a1a`, `aria-describedby`, announced, no terminal period.

Do **not** add a second "Minnesota" to the final sentence — "in the state" is deliberate so the name
appears once.

## Lookup-service-down state — no live capture; build to the design (AUG 7)

This state could not be reproduced on live, so it is **not** a live-vs-design diff. The reference is the
spec.

**Copy, exactly:**

- Inline: _Lookup unavailable right now_ (no terminal period)
- Guidance: _Your address is fine — a public lookup service isn't responding. Try again later._

Three deliberate choices, all load-bearing:

- **"Your address is fine" leads.** On any failure the reader assumes they typed something wrong. This is
  the one state where nothing about their input is at fault, and saying so first is the message's job.
- **Never name the service.** Two are called in sequence and the page often can't tell which failed;
  naming one is a claim we can't support.
- **"Try again later", not "Try again"** — there's no retry button and an immediate second press won't help.

**Treatment** inherits every error-state fix above: amber glyph, inline message tied to the field,
guidance as plain text on the page background (no card, no green rule, no heading), `role="alert"`.
**No buttons at all** — Find is still on screen and a "Try again" control would duplicate it. The map
shows its unresolved state: no pin, no shapes, and the helper says _click/tap the map to choose a
location_, never "drag the pin".

The amber glyph is right here even though the reader did nothing wrong — a neutral treatment would make a
total outage read as an aside. The copy carries the "not your fault" part.

## Too-many-lookups state — added AUG 7

This is separate from service down. The source answered, and Alethical's existing safety limit stopped
request 11 from the same public internet address inside 60 seconds.

**Copy, exactly:**

- Inline: _Too many lookups_ (no terminal period)
- Guidance: _Try again in up to 60 seconds_ (no terminal period)

The Find button shows the remaining seconds. Find and Use my location are both disabled until the
server's `Retry-After` wait reaches 0, because both controls use the same limited endpoint.

**Confirm back:** what does live show today when either service is unreachable? A raw error, a blank
answer area, or a spinner that never resolves would each be a separate defect.

## Seat-vacant state — three live differences (AUG 7)

Card order is correct (Senate left, House right).

1. **The district eyebrow is missing.** Live shows only "Seat vacant / No member currently holds this
   seat", so a reader can't tell _which_ of their two seats is empty — the entire point of showing a
   pair. Add the mono eyebrow at the top, same as the seated card: JetBrains Mono 11px/700, 0.14em,
   uppercase, `#4f5651` → "HOUSE DISTRICT 21A".
2. **It must not look like a member card that failed to load.** Live uses the solid white member card
   with nothing in it. Use the placeholder treatment: 1px **dashed** `rgba(17,21,15,0.22)`, radius 18,
   `#fbfcfd`, **no shadow**. The dashed edge is what reads as deliberately empty rather than broken.
3. **Don't stretch it to the sibling's height.** The grid stretches it to match the seated card, which is
   currently ~1,400px tall, so two sentences float in a white void. `align-items:start` on the grid,
   `min-height:240px` on the card, eyebrow top / text bottom via `margin-top:auto`. The uncapped issue
   chips on the seated card are the root cause of that height — capping at 6 fixes both.

The seated card beside it takes every found-card fix already specced; same component, listed once.

## Not-recognized state — four live differences (AUG 7)

Desktop and phone, identical faults.

1. **Remove the green-ruled card around the guidance.** Green is our forward-action colour, so a reader
   scanning for the green thing lands on the failure. Plain text on the page background — no card, no
   border, no left rule — 17px/1.55, `#4f5651`, ~62ch, sitting where an answer would.
2. **Replace live's copy.** "…then try again. If there's more than one match, choose your address."
   tells the reader to repeat what just failed, and its second sentence describes the address-choice
   list — a different state, which currently doesn't work at all. Settled copy, one sentence:
   _Enter a house number and street name, like 350 S 5th St, Minneapolis, MN 55415_
3. **Add the amber warning glyph** before "No match for that address" (14px, `#a76a1a`, aria-hidden).
   Today it's bold text alone, so the error depends on weight. Keep it tied to the field
   (`aria-describedby`) and announced; 13.5px/600 `#a76a1a`, no terminal period.
4. **Drop "neighborhood" from the subhead.** The service can't match one, so offering it is a promise we
   can't keep: _Enter a full street address. Minnesota's districts divide cities, so a city or ZIP alone
   can't identify your legislators._

## The address-choice state does not work on live — rebuild it (AUG 7)

State 4 of 9, and the one that rescues the most common near-miss: an address that matches several
Minnesota places. Reported from live as never appearing.

**Diagnostic needed first** — does the geocoder return the matches and we discard them, do we silently
take the first (a confident wrong answer, and the worst case), does a multi-match fall through to "No
match", or is the request never made? Test case: `2110 Ford Park` — house number + street, no city or
ZIP, exactly the ambiguous shape.

**Trigger:** only after Find/Enter, only on **more than one** Minnesota match. Never while typing — the
Census service matches complete addresses and has no autocomplete. 1 match → straight to found; 2–5 →
list them all; >5 → first 5, no pagination; 0 → the not-recognized state.

**Behaviour:** one keyboard-highlighted row, ↑/↓ to move, Enter or click to choose, Esc closes and
returns focus to the field. Choosing runs the lookup **immediately**. **The field keeps the reader's
original text** — never overwritten with the canonical address. Phone rows ≥44px. Real combobox
semantics (`role="combobox"` + `aria-expanded` + `aria-controls` → `role="listbox"`, rows
`role="option"` with `aria-selected`); without them a screen-reader user can't tell a list opened.

**Not on screen while open:** no legislator card, and the map is unresolved — no pin, no district
shapes. It's a lookup outcome, not a result.

## Card footer — desktop and phone (AUG 7)

1. **"View profile" is the card's one solid control**, not a bare text link. `#11150f`, white, radius 11,
   15px/700, min-height 44px, trailing **"→" text glyph** at weight 400. 16px below the contact block,
   left-aligned on desktop; **full-width, min-height 46px, "View full profile" on phone**. Live floats it
   beside the official-page link at equal weight on a different alignment — the two collide and neither
   reads as primary. They aren't peers: View profile is our destination, the official page leaves us.
2. **The official-page link is the last item in the contact stack**, not a sibling of the button — same
   left-aligned column as email, phone, office. On phone every link and the phone number carry
   `min-height:44px` as their own tap target.
3. **Label by chamber:** "Official Senate page" / "Official House page", never the generic "Official
   Legislature page" — the specific label says where the reader lands. Add the ↗ glyph (aria-hidden) plus
   a visually-hidden "(opens in a new tab)"; `target="_blank"`, `rel="noopener"`.
4. **Cards size to their own content** — `align-items:start` on the grid. Live stretches both to equal
   height, so the shorter card ends in ~200px of blank white that reads as content that failed to load.
   One member genuinely has more record than the other; that difference is honest.

## Found-state member card — seven live differences (AUG 7)

1. **Issue chips are green and uncapped.** Live renders mint-green pills, all of them (10+, three rows).
   Green is action-only — an issue label isn't an action. Use the Search Legislators grey chip
   (`#f1f1f4`, radius 8, 12–12.5px/600, `#4f5651`), **cap at 6**, then a plain grey "+N more" line
   (not a chip, not a link). Uncapped, the block pushes the contact details off the card.
2. **Party is a labelled row, not a bare "R" badge** — mono `PARTY` label over the value, paired with
   `RESIDENCE` in one flex row. **Spelled out**: "Republican", "Democratic-Farmer-Labor". A bare badge
   never tells the reader the value _is_ a party; the label does, matching Bill Detail.
3. **Title + district are one mono eyebrow** — `STATE SENATOR · SENATE DISTRICT 27` (JetBrains Mono
   11.5px/700, 0.12em, `#0f7a45`), not green Libre Franklin plus a grey second line.
4. **Heading is "COMMITTEES"**, not "COMMITTEES & LEADERSHIP" (a role appears on ~1 membership in 4).
   Role separator is a **comma**, not a middot; role in `#4f5651`.
5. **Bills authored is three lines** — `156 bills authored` / `Including 70 as chief author` /
   `94TH LEGISLATURE (2025–26)`. Drop "total": without the session line a reader assumes a career total,
   and "Including" says chief author is a subset where "·" doesn't.
6. **Election and term is one unlabelled sentence** — free text from the record, wildly variable; a
   labelled two-field block implies a structure the data doesn't have.
7. **Residence pairs with party**, and the whole labelled unit disappears when the city is absent.

## Looking-up state — one line, no card (AUG 7)

Measured on live, this state lasts **about 3s cold, under 0.5s warm**. Our earlier spec's two numbered steps and
"this may take a few seconds" were written before we knew the timing and are both wrong — nobody reads a
list that's gone in 800ms. Cut from the reference; live should match.

**Copy — one line, no subline, no list, no duration claim:** _Looking up your districts_
(live's second line, "Matching it to Minnesota districts…", is deleted).

**Visual — no card.** Spinner (18–20px, `#6f756f` arc on `#e2e5e4`, aria-hidden) + the line at 17px/700
desktop, 15px/700 phone, on **plain page background**. Live's bordered white card goes, same reason as
the not-recognized card. Below it, **shimmer skeletons shaped like the answer** — two side by side on
desktop, two stacked on phone — which show where the answer will land and stop the page jumping when it
arrives. Freeze under `prefers-reduced-motion`. Keep the polite status announcement.

## Not-recognized state — three live differences from the design (AUG 7)

1. **Remove the green left-rule card.** Live frames the guidance in a white card with a thick green left
   rule. Green is the forward-action colour (Sign in, Track, Copy) — framing a _failure_ in it is the one
   colour mistake this system can't make. Guidance is **plain text on the page background**: no card, no
   border, no rule, no fill, matching every other state on the page.
2. **Guidance copy is not ours.** Use exactly: _Enter a house number and street name, like 350 S 5th St,
   Minneapolis, MN 55415._ Live's "try again" tells the reader to repeat what
   failed. The example shows the complete address format without pointing to controls that are not on
   screen.
3. **Inline message needs its warning glyph.** Live renders "No match for that address" as bare bold
   text; ours carries a small amber glyph, so the error doesn't depend on weight or colour alone.

No terminal period on the inline message; the guidance sentence has one. Both surfaces.

## Mobile parity — every item applies to the phone

- **Remove the boxed placeholder** on phone too.
- **State outline + dim, and fit-the-whole-state** on the empty view — the phone map crops identically.
- **Credits are inside the map on phone** (overlaid top-left). Move them below it: anything inside the
  map's box is inside its tap target, so aiming for a credit link moves the pin — the easiest mis-tap on
  the screen.
- **Duplicate GIS credit:** the in-map overlay _plus_ a foot sentence "Minnesota district shapes are
  provided by Minnesota GIS." Keep the two links below the map and delete the sentence.
- **Helper copy has no terminal period:** "Tap the map to choose a location".
- **Subhead still says "neighborhood"** — on the never-show list. Use: _Enter a full street address.
  Minnesota's districts split cities, so a city or ZIP alone can't tell us who represents you._

### The phone map stays collapsed — confirmed

Not an oversight. At fit-Minnesota zoom on a 390px screen a tap lands ~20 miles from the intended house,
so the empty map isn't usable as an input until zoomed; in the found state, two fact-carrying member
cards are the answer and a permanent map pushes them down. Keep the toggle, collapsed by default,
remembered within the session.

## Map — state context at every zoom (AUG 7)

Two live captures showed the problem: at wide zoom five states share the frame and Minnesota is marked
only by a faint tile label; at mid zoom nothing on screen says Minnesota at all.

Draw two things, **both below the district shapes** in stacking order:

1. **State boundary in neutral ink** — `rgba(17,21,15,0.55)`, 2.5px, over a 5.5px white casing (the same
   casing the district lines use, so it survives land, forest and Lake Superior), round joins.
2. **A 40% white wash over everything outside the boundary**, via a mask of the state polygon —
   Minnesota becomes the lit shape and the neighbouring states recede.

- **Why both:** the outline alone only helps at wide zoom. At mid zoom the border is mostly off-frame, but
  the wash still reads as "you are inside the lit area." The wash is what answers _where am I_.
- **Why neutral, never green:** green is the House divider, purple the Senate boundary. A third hue reads
  as a third district, and a green state border invites reading the whole state as one district.
- **At block zoom** the border is usually off-frame and nothing renders — correct. The exception is an
  address near a state line (Moorhead, Winona), where it's the most useful thing on the map.
- **Check on real tiles:** the wash must stop cleanly at the water's edge or Lake Superior looks
  half-broken. Not provable on illustrative artwork.

### The empty map fits the whole state

Live opens on a crop of the centre-north, so a reader in Rochester or Marshall can't see their part of
the state. With no location chosen there's no district to fit, so **fit Minnesota** — whole state in
frame with padding, letterboxing the wide desktop box rather than cropping. (Reference uses
`preserveAspectRatio: meet` when empty, `slice` once a district is selected; in the build, fit the state
bounds rather than a fixed zoom — the right zoom differs between the desktop and phone maps.)

## Nothing-entered state — replace the boxed placeholder with the explainer sentence (AUG 7)

A **swap, not an addition.** Live draws a bordered panel with a pin glyph reading _"Your Minnesota
legislators will appear here."_ Remove the panel — border, glyph and copy. In its place, the plain
sentence on the page background:

> Every address has one House district and one Senate district — we'll show the legislator for each.

Libre Franklin 18px/400, `#4f5651`, left-aligned, max-width ~56ch, wraps naturally, **no container**.

- **Why the panel goes:** it's a result-shaped box reserving space for an answer that doesn't exist yet —
  ruled out for this state ("no result-shaped placeholder, no large empty gap waiting for results"). It
  also costs ~110px between the field and the map, pushing the map out of view in the one state where the
  map is the whole point. Every other state puts answer-area content on plain background, no container.
- **Why the sentence wins:** it makes the same promise _and_ adds what the reader doesn't have — two
  seats, one per chamber — which is why the two result cards make sense later. Live's version says only
  "here," and needs a drawn box to say it.
- **Word order:** "House … Senate" in prose is ordinary English collocation. Don't "correct" it to
  Senate-first to match the chips, cards and map — those are ordered by containment; prose isn't.

## Live defect fixes in this revision (AUG 6 2026 · 9:56 PM EDT)

1. **Issue chips cap at 6** + a quiet "+{N} more" caption below the row (plain text, not a chip/link).
   Live renders every label across ~190 bills — hundreds of chips per card. Omit the caption at ≤6.
2. **Party spelled out as a labelled row** — `PARTY / Democratic-Farmer-Labor` paired with
   `RESIDENCE / Minneapolis`. Replaces the bare "DFL"/"R" chip. No party colour. Label teaches that the
   value is a party; a labelled row also fits the 23-character name without dominating the identity row.
3. **"View profile" no longer collides with "Official Legislature page"** — the official page is an
   underlined green link on its own line; "View profile →" is a black button below it in normal flow.
   Nothing floated or absolutely positioned.

## What's in this bundle

- `NEXT Find My Legislator.dc.html` — desktop and phone frames, switched together by two preview bands.
- `support.js` — runtime.

## State inventory

**10 page states** (one band — desktop and phone move together):

| #   | State                           | Field shows                                    |
| --- | ------------------------------- | ---------------------------------------------- |
| 1   | Nothing entered                 | empty                                          |
| 2   | Looking up                      | 350 S 5th St, Minneapolis, MN 55415            |
| 3   | Found                           | 350 S 5th St, Minneapolis, MN 55415            |
| 4   | **Address choice**              | 350 5th St, Minneapolis, MN                    |
| 5   | Address not recognized          | 1428 Nonesuch Ave, Minneapolis, MN 55409       |
| 6   | Address outside Minnesota       | 1600 Pennsylvania Ave NW, Washington, DC 20500 |
| 7   | Location refused or unavailable | empty                                          |
| 8   | Seat vacant                     | 213 E Luverne St, Luverne, MN 56156            |
| 9   | Lookup service down             | 350 S 5th St, Minneapolis, MN 55415            |
| 10  | Too many lookups                | 350 S 5th St, Minneapolis, MN 55415            |

**Address choice is a lookup OUTCOME, not a typing state.** The Census address service matches complete
addresses — it offers **no autocomplete and no spelling correction**. The list appears only after Find
returns several Minnesota matches. Up to 5 choices, one keyboard-highlighted row, Arrow keys move,
Enter or click chooses, Escape closes, choosing starts the lookup immediately. **The field keeps the
reader's original text** — never replaced with the canonical address. Phone rows ≥44px. In this state
the answer area has no legislator result and the map has no pin or district shapes.

## What the prototype genuinely demonstrates

- Switching all 10 page states and both address-entry states on both frames.
- Suggestion list keyboard behaviour on desktop: ArrowUp / ArrowDown move the highlighted row, Enter
  chooses, Escape closes, click chooses — choosing moves straight to **Looking up**.
- Portrait failure fallback: an image that fails to load is replaced by the green-tint initials.

**Inert in the prototype** (visual only, no wiring): Find, Use my location, Sign in, menu, zoom,
View profile, and typing itself (the field is `readOnly`; its value is driven by the state bands).

## Accepted decisions

- **Bare member names** with the chamber title on its own line — "Esther Agbaje / State
  Representative", never "Senator Bobby Joe Champion / State Senator". Stored Senate names carry
  "Senator"; the build uses the normalized bare name or applies the same stripping rule.
  **Intentional screen difference:** the legislator profile destination keeps "Sen." in its header
  because it has no separate title line. Not redesigned by this work.
- **DISPLAY order is Senate → House; PROSE order is House and Senate.** Deliberate, not a slip:
  - _Display_ (district chips `SENATE 59 ▸ HOUSE 59B`, the two member cards with Senate first, the
    map's Senate outline around the House half) is ordered container-then-contained, because the
    layout is what shows the nesting.
  - _Prose_ keeps the natural English pairing — "House District 59B is one of two House districts
    inside Senate District 59", "one House district and one Senate district", "Minnesota House and
    Senate districts". Sentences read better House-first, and each of these already states the
    relationship in words, so word order doesn't have to carry it.
    Do not normalize one to the other.
- **Congressional district** shown as a quiet unlinked line, "Congressional district {number}", stored
  on each specimen's data object so it cannot drift: **Minneapolis 5 · Luverne 1 · Ely 8**. Settled
  exclusions hold — no congressional boundary, no member of Congress, no profile link, no work record.
  "Drop the congressional feature" in the map notes means drop its **geometry**, not this number.
- **Found heading:** "Your Minnesota legislators". Sentence-case page title "Find my legislator". No
  eyebrow, no breadcrumb, no "2 results", no result-shaped empty space before a lookup.
- **Bill totals** as three lines — "198 bills authored" / "Including 63 as chief author" /
  "94th Legislature (2025–26)" — SHORT year form, see the deviation below. Chief author is a subset,
  not an additional pile.
- **Two error layers, doing different work:** the **inline message names the problem** at the control
  that failed (tied via `aria-describedby`). The **answer area never restates it** — it leads straight with the
  **recovery guidance** inside `role="alert"`, followed by any action. There is **no heading and no
  eyebrow**: a heading would have paraphrased the inline sentence 200px below it, and an eyebrow
  ("WHAT TO TRY NEXT") only announced what the very next sentence already makes obvious. The guidance
  itself is the prominent line.
- **Vacancy:** House 21A shows "Seat vacant / No member currently holds this seat." No former member,
  candidate, election date, special-election copy, or prediction.
- **Party spelled out** — "Democratic-Farmer-Labor", "Republican" — never the DFL / R abbreviation,
  matching the site-wide convention already documented for the legislator profile and Bill Detail.
  This screen answers "who represents me" for readers who may know nothing about the Legislature, so
  an unexplained acronym is the wrong place to save space. Still a **neutral grey chip** — no red or
  blue anywhere. Set in Libre Franklin rather than the mono reserved for district codes, and allowed
  to wrap so the long form never overflows.
- **No "seat" jargon in explanatory copy.** "Who represents you" / "the legislator for each" instead.
  The vacancy card keeps the spec's exact "Seat vacant / No member currently holds this seat."

## Address requirement copy

> Enter a full street address. Minnesota’s districts split cities, so a city or ZIP alone can’t tell us who represents you.

Two short sentences: what to enter, and why a city or ZIP can't work. The address parts are **not**
enumerated — the placeholder (`350 S 5th St, Minneapolis, MN 55415`) demonstrates the exact format,
and the second sentence already names the failure mode, so listing "house number, street, city and
ZIP" repeated both. The placeholder stays a real example, as §2 requires. Measure capped at
`56ch` with `text-wrap:pretty`.

**Empty state** carries one quiet line and no eyebrow:

> Every address has one House district and one Senate district — we’ll show the legislator for each.

It teaches the one-of-each pairing (the thing readers most often don't know) and nothing else. An
earlier version opened with "Enter your street address above, or use your location", which repeated
both the instruction sentence and the two visible buttons. The field's
"STREET ADDRESS" label is **visually hidden, not removed** — the sentence above already says to enter
a street address, so showing it again was redundant, but the `<label for>` stays in the markup so the
field keeps its programmatic name for screen readers.

## The answer does NOT restate the address — and the field is never overwritten

Two rules:

1. **Never write the resolved address back into the field.** The reader's own input is the only thing
   they can check a wrong-but-plausible match against. Silently rewriting it removes the evidence.
2. **No "Matched to {address}" line.** An earlier pass added one, justified by the vacancy sample
   where the reader types `213 E Luverne St, Luverne, MN 56156` and the service returns
   `213 E LUVERNE ST, LUVERNE, MN, 56156`. That difference is only uppercasing and a comma — nothing
   about the address changed — so the line taught the reader nothing and read like a rendering fault.
   Removed. The address stays visible once, in the field.

## Illustrative sample scenarios

**350 S 5th St, Minneapolis, MN 55415** → House 59B **Esther Agbaje**, Senate 59 **Bobby Joe
Champion**, U.S. House district 5.

**213 E Luverne St, Luverne, MN 56156** (service returns `213 E LUVERNE ST, LUVERNE, MN, 56156`) →
House 21A **vacant**, Senate 21 **Bill Weber**.

> House 21A became vacant on June 21, 2026, when Joe Schomacker left office before the end of his
> term.

**Vacancy build invariant:** the local official district map resolves the district codes; current seat occupancy
comes from Alethical's canonical current-member roster. The local map supplies no member name and
must never override the roster. The live endpoint already follows this rule — preserve it.

## Issue labels — how the values were produced

The chips under **ISSUES ON BILLS AUTHORED** are issue labels attached to bills the member authored or
co-authored. They are not claims about personal priorities.

- No dedicated endpoint currently returns a member's top issue labels.
- The design values were calculated from each member's current authored and co-authored bill records
  using Alethical's canonical issue vocabulary.
- **Production should compute this server-side and return finished labels.** The phone must not
  download and aggregate roughly 200 bill records.
- The labels use the same authored-and-co-authored scope as the total above them.
- Bills may carry multiple issue labels, so issue counts do not sum to the authored total.

## Contact normalization rules

- Show a clean email address; strip `mailto:` before displaying or linking.
- Suppress contact-form URLs and absent values. Never a disabled email action, never an empty label,
  never a link to an official contact form, never an Alethical composer.
- Agbaje → `rep.esther.agbaje@house.mn.gov`; Champion → `sen.bobby.champion@mnsenate.gov`;
  **Weber → no email action** (his record provides a contact form).
- Phone and Capitol office shown when present. Alethical displays contact facts; it sends nothing.

## Official Legislature links

Current HTTPS pages in the design. Implementation must recognize a stored
`senate.leg.state.mn.us` `member_bio.php` URL, keep the same `leg_id`, and rewrite it to
`https://www.senate.mn/members/member_bio.html?leg_id={leg_id}`. Never open the retired HTTP address.
The official-page action looks identical on House and Senate cards; "View profile" remains the
separate Alethical destination.

## Capitol-office cleanup

Office block stays in the design; reuse the existing frontend cleaner. Never print the raw blob.
Remove stray asterisks, repeated phone/email lines, newsletter invitations (including the known Somali
and Spanish ones), meeting-request prompts, duplicate lines, "Toll Free:" lines, and leadership titles
scraped into the office field. Omit the block only when cleaning leaves no usable address.
Test examples: **Agbaje** (clean House baseline), **Weber** (clean Senate baseline), **Lisa Demuth**
(leadership title + toll-free), **Liz Boldon** (multilingual newsletter).

## Residence city

Verified cities are shown on the sample cards, and the card collapses cleanly when the city is absent
— no empty label, no dash, no invented value, no gap.

> Residence city is currently null on all 200 current service records. The field and backfill already
> exist, but the backfill has not populated production. Making the backfill land successfully is a
> shipping prerequisite.

This is a production-data gap, not permission to weaken the designed card.

## Four separate source statements — do not merge them

1. **OpenStreetMap tile credit** (map, when tiles are loaded)
2. **Minnesota Legislature GIS boundary credit** (map)
3. **Census API notice** — exactly: _"This product uses the Census Bureau Data API but is not endorsed
   or certified by the Census Bureau."_ Visible on desktop and phone, compact but readable, never
   hidden inside Privacy or another legal screen, and separate from both the map credits and the
   legislative source line.
4. **Legislative record source line** (below)

## Source line

`Source: Minnesota Legislature · revisor.mn.gov · Updated {date}` — "Minnesota Legislature" links to
https://www.leg.mn.gov/ and "revisor.mn.gov" to https://www.revisor.mn.gov/. The handoff shows the
literal `{date}` placeholder.

**The implementation date is one conservative page-level freshness value:** the oldest successful
refresh among displayed sources that record a refresh date (member roster, member details, committees,
service history, authorship totals). A value computed live from those records does not add a separate
date. Never browser time, mock creation time, or an unrelated corpus-wide timestamp. If an honest
value cannot be established, the build must not invent one.

## Accessibility built in

44px minimum phone targets **for every control this screen owns** — including the stacked contact
links (email, phone, Official House/Senate page), which are standalone block links in a flex column
and so get an explicit 44px hit height rather than relying on the WCAG inline-link exemption ·
16px phone input text · visible focus rings (`#7c5cff`, unclipped) ·
focus order matches visual order · `role="combobox"` with `aria-expanded`, `aria-controls`,
`aria-activedescendant` over a `listbox`/`option` list · label tied to the field · polite loading
status · `role="alert"` on answer-area errors · inline errors tied to the control via
`aria-describedby` · no meaning by colour alone (icon + text) · darker grey small labels ·
`prefers-reduced-motion` stops the spinner and shimmer · portraits are decorative
(`alt=""` + `aria-hidden`) since the name sits adjacent · external links carry a visually-hidden
"(opens in a new tab)".

## Build capability notes

**Already available:** browser location · address lookup · coordinate lookup · Minnesota validation ·
location-refused handling · outside-Minnesota handling · current House and Senate district lookup ·
portrait URL · party · chamber · district · phone · office source value · official profile URL ·
elected and term values · authored and chief-author totals · committee roles on member detail ·
service history on member detail · existing office cleaner.

**Needs wiring or correction:**

- Reuse the existing committee-role and service-history detail data in the lookup response.
- Make the residence-city backfill populate production, then include city in the lookup response.
- Add server-side member issue aggregation.
- Add address suggestions and their frontend agreement.
- Normalize stored senator names for the bare card headline.
- Normalize Senate official-page URLs.
- Normalize `mailto:` email values.
- Suppress contact-form URLs.
- Expand office cleanup for the 9 measured remaining records.
- Expose an honest page-level freshness value.
- Carry U.S. House district 5 (the quiet unlinked fact remains in the final design).

Committee roles and service history are **not** new data collection — the data exists; the lookup
response needs to reuse it.

## SUPERSEDED — the address field is not forgiving

\*\*## Below-field messages — exactly two tiers
Every message that can appear under the address field belongs to one of two treatments. Nothing else
goes in that slot.

| Tier             | Type                                                 | Used for                           |
| ---------------- | ---------------------------------------------------- | ---------------------------------- |
| **Neutral help** | Libre Franklin 14px / 400 / `#6f756f`                | mid-word hint, keyboard hint       |
| **Error**        | Libre Franklin 14px / 600 / `#a3421a` + warning icon | inline field error, location error |

Errors differ from help by **weight, colour and icon — never by size**, so the two read as one system
with one of them raised. The icon means the error never depends on colour alone.

**No message in this slot ends with a period** — help and errors alike. They are short labels beside a
control, not sentences. (Answer-area guidance IS a sentence and keeps its period.)

Previously the keyboard hint was JetBrains Mono 11px/700 uppercase in a different grey, which made two
pieces of neutral help in the same slot look like different classes of thing; mono uppercase is our
eyebrow/code treatment, not a treatment for a sentence. It now reads "Use **↑** and **↓** to move,
**Enter** to choose, **Esc** to close."

## Error states carry NO action buttons

An error renders as: a short inline message with a warning icon beside the failing control, then the
guidance sentence in the answer area. That is all — **one icon per error, and it lives inline**. The
answer area has no icon tile of its own: two warning marks for one error is repetition, and the inline
one is the one doing the work (tied to the control, and the reason the error does not depend on colour
alone). Inline messages carry **no
terminal period** (they are short labels beside a control, not sentences).

Every recovery action on this screen is already a visible control a few pixels above the message, so
an answer-area button only restates it:

| Would-be action           | Already on screen as                                     |
| ------------------------- | -------------------------------------------------------- |
| Edit address              | the address field, holding the reader's text             |
| Enter a Minnesota address | the same field                                           |
| Try location again        | the **Use my location** button                           |
| Try again                 | the **Find** button, with the address still in the field |

Do not add them back. If a future error has a recovery the visible controls genuinely cannot perform,
that one gets a button.

## Raising a disagreement

Items marked **[EUGENE]** in the prompt were requested or required by Eugene directly. If you disagree
with one, **raise it with Eugene, not back through us** — we implemented them because he asked and we
are not the decision-maker on them. Items marked **[US]** are ours; pushback on those belongs in your
reply as usual.

## Census notice — verbatim, do not shorten

"This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau."
Required wording, period included. The second clause is the disclaimer; without it the sentence reads
as a federal endorsement we do not have. Considered for shortening and deliberately rejected.

## Deviation — session year form (spec said long, we shipped short)

Your spec writes the session as **"94th Legislature (2025–2026)"**. We render **"94TH LEGISLATURE
(2025–26)"** — second year abbreviated, en-dash unchanged.

Why: the short form is our universal copy convention and has already been swept across every active
screen, so the long form here would make this the only page in the product spelling the biennium out.
Two forms of the same label on adjacent screens reads as a data inconsistency rather than a style
choice. Both renders (desktop + phone member cards) are affected.

**Tell us if the long form is deliberate build truth** — e.g. it is what the record actually returns,
or what other server-rendered labels emit — and we will adopt it and change the convention rather than
leave the two silently in conflict.

## Deviations, with evidence

0. **"U.S. House district 5" → "Congressional district 5", on its own line.** §6 suggests the "U.S.
   House" wording. On screen it renders inches from "HOUSE 59B" and the state-House card, so two
   different bodies both read as "House" — the exact confusion this screen exists to prevent.
   "Congressional" cannot be misread, and "Congress" is far more widely understood than "state House".
   Same fact, same quiet unlinked treatment, no link or record added.
1. **No local portrait assets in the bundle.** Requested in §14, but the design tooling cannot fetch
   remote binaries into the project, so the cards reference the official LRL thumbnail URLs directly
   (`https://www.lrl.mn.gov/legdb/MemberPhotos/ls94/thumbnails/…`). Consequence: portraits do not
   render offline from this bundle — the green-tint initials show instead. Local copies need adding at
   build time. Portrait box is the shipped 64×74 and is not enlarged on phone.

   **Fallback mechanism:** the portrait paints as a **background layer over the initials**, not as an
   `<img>` with an `onerror` handler. A missing or failed image simply doesn't paint and the initials
   underneath show through — no error handler that can throw, no broken-image glyph, and no request
   for an unresolved URL while the page streams.

2. **No issue chips on Bill Weber's card.** §11 supplies canonical labels for Agbaje and Champion
   only. Rather than invent a third set, his card omits the block — which also exercises the
   absent-data collapse the card is required to handle. Send his labels and they drop straight in.
3. **Phone menu button is 44×44, not the shipped 38×38.** §1 says use the shared order (done: logo →
   Sign in → menu) and §1/§23 both require every phone target to be ≥44px. The shipped shared
   component's menu button measures 38×38, so those two requirements conflict. I followed the 44px
   requirement here. **This makes the shared narrow-nav component the thing that needs changing** —
   raising it once fixes every narrow screen; leaving it makes this screen the odd one out. Same
   applies to the shared shell's Sign in button (83.8 × 37.5 as shipped) and its footer links (17px
   tall), which are below 44px on every mobile screen that reuses it.
4. **No U.S. House district on the vacancy sample.** §6 supplies district 5 for the Minneapolis
   address only; none was given for Luverne. Nothing is shown there rather than a guessed number.

## District locator map — final settled section

**Line treatment (settled).** The complete Senate outside boundary is drawn **once** as a solid purple
3px line with a white casing. Only the **internal division** between the two House districts shows as a
dashed green line with a white casing — achieved by stroking the House ring beneath the Senate stroke,
so every shared edge is covered and nothing is double-drawn. The selected House half carries a
translucent green fill. There is **no separate green ring** around the full House shape, and the
divider is never hand-drawn as a straight line — it is whatever part of the real House ring is not
shared with the Senate ring. The opaque "HOUSE nnA / NOT YOUR HOUSE DISTRICT" pill is the written cue.
House codes green, Senate codes purple.

**Prototype background is illustrative artwork** — unlabelled water, terrain and road texture, with no
place names. **Production loads real OpenStreetMap tiles.** The no-tiles fallback is visibly plainer
and drops only the OpenStreetMap credit.

**Map helper text follows the same selected-point condition as the pin**, so an empty or error map can
never mention moving a pin that does not exist: with no point, desktop reads "Click the map to choose a
location" and the expanded phone map reads "Tap the map to choose a location"; with a point, the
settled wording returns.

**Map interactions are visual-only in this prototype.** Map clicks, pin dragging, arrow-key movement
and zoom are not wired — Claude Code builds them to the behaviour specified here.

**Self-consistent variants.** Each specimen's House shape and code, Senate shape and code, other-House
code, pin, zoom, visible labels and spoken description all derive from one object, so the rural
specimen says HOUSE 03A / SENATE 03 / HOUSE 03B everywhere including its screen-reader description.

**Boundary source.** Real reduced official outlines, fitted to the Senate ring in a 300×288 box with
24px padding. Geometry from the official Minnesota district files stored with Alethical,
delivered **through Alethical's existing lookup response** — the browser never calls the commission
and never makes a second geometry request. The only added cost is the trimmed shapes sent to the
browser. Drop the congressional feature. Return only chamber, district code,
geometry type and coordinates. **Never** return or display the district service's member details —
that service supplies district codes and shapes only; Alethical's roster remains the source for who
holds a seat.

**Exactly two boundaries** are drawn: the selected House district and its containing Senate district.
The pin must sit inside both.

**Opening view = fit to the returned Senate boundary, 24px padding.** Never one fixed zoom. Expected
scales: compact Minneapolis ≈ 12 · Senate 21 ≈ 8 · largest rural Senate ≈ 6 · empty phone map fitting
Minnesota ≈ 5 (a taller desktop empty map ≈ 6). **Maximum zoom 15** — enough for a block-level check;
the old 18 limit is dropped because a 5-metre boundary allowance would look ~12px wrong there. Rural
openings show little street detail; that is honest, and no fake streets or place labels are drawn.

**Empty map:** fits the Minnesota outline. No district boundary, no district code or label, no pin, no
default Minneapolis position. Desktop click may select a point and start a coordinate lookup; on phone
it stays behind the collapsed map control. No other unresolved state reuses the found-state pin or
shapes.

**Selected location and view centre are separate** — the real change from the current component, where
the coordinate _is_ the centre and the pin is pinned mid-screen. Fitting, zooming and panning move the
view only. Clicking/tapping the map, or dragging/arrowing the pin, moves the location. The pin may sit
away from centre. **Zooming never moves the pin or starts a lookup.** The existing lat/long projection
is reusable; the shared state and gesture model are not.

**Pin interaction.** Visible mark stays compact; pointer target ≥44px. Exactly one lookup runs: after a
map click/tap settles, once when a drag ends, and 500ms after the final keyboard movement — never per
movement frame. When the pin reaches the view edge, pan enough to keep it visible. A pin moved outside
Minnesota uses the existing outside-Minnesota response _before_ calling the lookup services.

**Keyboard pin.** The pin is a real keyboard target: arrows move it by an amount scaled to the current
zoom, Shift+arrow moves farther, with a strong visible focus ring. Page scrolling is suppressed **only**
while the focused pin is handling those arrows. Desktop helper text names it — "Drag the pin, click the
map, or use the arrow keys to move it"; phone keeps "Drag the pin or tap the map to move it". The
address field is not a keyboard substitute: the map can select a rural crossroads or shoreline with no
street address.

**Separate controls.** Pin, zoom in, zoom out, and both credit links are **sibling** targets — never
nested inside the map's pin-moving element. Space/Enter on a zoom control or credit must never move the
pin. They may sit visually over the map; their interactive areas stay siblings. Phone targets ≥44px.

**Lines and colour (settled).** The **Senate outside boundary is solid purple**, drawn once with a
white casing. The **House internal divider is dashed green**, also cased. The **selected House half
carries a translucent green fill**. **Shared edges are drawn once** — the House ring is stroked beneath
the Senate stroke, so no edge is double-drawn and the divider is never hand-drawn. Pin = dark neutral
with a light centre. **Every House code is green, every Senate code purple**, including the
other-House pill. Green and purple identify **chambers, not parties** — no red or blue anywhere.
Stroke widths, dash spacing, labels, pin and controls use **screen-based sizes** so they do not shrink
with geography; verified at zoom 6 and zoom 12.

**Labels.** House and Senate legend pills retained. The other House half inside the Senate district
uses an **opaque white pill** reading the district code over "NOT YOUR HOUSE DISTRICT" — not "Not your
district", which is ambiguous while the reader is still inside that Senate district. The second line is
at least as readable as other map labels; no 7.5px text over a busy map. Check collisions among pin,
district labels, legend pills, zoom controls and credits.

**Phone map.** Available but **collapsed by default**. Found and vacancy: "Show district map" sits
below the two answer cards; expanded label becomes "Hide district map"; the map stays open when moving
the pin starts another lookup. Empty state: the control sits below the address actions. The control is
≥44px, reports expanded state (`aria-expanded`), and removes the collapsed map and its controls from
keyboard and screen-reader order. Trimmed geometry may arrive with the normal lookup response, but
**no street tiles download while collapsed**. The map is never removed from phones.

**Use my location** (control itself unchanged): a successful location becomes the selected coordinate,
runs the normal lookup, fits the returned Senate boundary, draws both boundaries and places the pin at
the returned point. Refusal, unavailability, or a point outside Minnesota uses the existing settled
location-error state — no invented pin or boundary, and never treated as a malformed address.

**While looking up.** A map movement starts the same page lookup flow as address selection. The map is
never replaced by a large spinner: structure stays stable, the selected pin stays visible, new
boundaries are not drawn until they resolve, and old boundaries are never left labelled as belonging to
the new point. The answer area owns the "Looking up" message.

**Credits.** Attribution follows whether **tiles are loaded**, never whether street artwork happens to
be drawn — tiles render at every scale, and at zoom 5–6 they carry water, terrain and place names
rather than streets. The OSM credit therefore shows on the empty Minnesota-fit map and the rural
specimen too; it is absent only in the tile-failure fallback, which is the one case with no tiles.
Whenever tiles are loaded: "© OpenStreetMap contributors" (grey `#6f756f`). Always:
"District boundaries: Minnesota Legislature GIS" (deep green `#0f7a45`). Each links to its official
source, both visibly underlined, both visible when the phone map is expanded, neither hidden behind
another control.

**Tiles.** The prototype uses **unlabelled illustrative artwork** — water, terrain and road texture
with no place names. **Production uses real OpenStreetMap tiles.** The **failure fallback is visually
plainer and omits the OpenStreetMap credit**, so it stays distinguishable from a legitimate rural view.
A map fallback, not a page state: keep both outlines, the pin, the neutral
background and all interactions; no broken-image marks; the legislator lookup does not become a failure.

**Geometry reduction (server side).** Max line error 5 m. Target both shapes together ≤200KB before
compression, ≤60KB after. Remove unused fields and cut coordinate precision _before_ allowing more shape
error. These are download targets, not correctness limits — **accuracy wins** when they conflict.

**Per-lookup safety checks**, run on the reduced shapes for the actual point: (1) reduced House covers
the point; (2) reduced Senate covers the point; (3) **a point exactly on a boundary counts as inside**;
(4) reduced House stays inside reduced Senate — and that check must **also treat shared-edge points as
inside**. Use a tolerance **at least as large as the shape-reduction allowance**. When hunting a real
containment failure, test only points that are **not on a shared segment**, or the shared boundary
itself will read as a false failure. On failure: retry with a smaller error allowance, reduce
the shared boundary identically where practical, fall back to the original shape. A rare accurate
response may exceed the size target. Do **not** use a global test demanding no nearby point ever changes
sides — any non-zero reduction creates a narrow differing strip; the lookup point and the
House-inside-Senate relationship are the invariants that matter.

**Current shape facts.** All official current shapes checked: 134 House, 67 Senate; every record has
exactly one polygon part and no interior hole. The bundled files use Polygon for these current shapes.
Build the one-ring path directly; keep a small general
parser for later parts/holes, covered by **one synthetic test** — do not let it delay the map.

**Large geometry fixtures:** Roseau (House 01A / Senate 01), East Grand Forks (House 01B / Senate 01),
Ely (House 03A / Senate 03). Known heavy shapes: House 03A 25,878 live points; Senate 01 20,399. The
heaviest House and Senate are not in the same lookup, so enforce reduction and safety on **every**
response rather than one precomputed "largest district". Do not make 134 automated calls to rank the
public service; request the official bulk extract if a full set is needed.

**Tile loading.** Replace the fixed 5×5 / 25-tile block. Calculate the rows and columns touching the
viewport, allow at most a 1-tile margin, never preload other zoom levels, load nothing while the phone
map is collapsed, keep the provider configurable, keep normal browser caching, add no no-cache headers.
The view-centre split must land **before** this calculation — the tile grid belongs to the view, not the
pin.

**OpenStreetMap policy.** `EXPO_PUBLIC_OPENSTREETMAP_TILE_URL` and `EXPO_PUBLIC_MAP_TILE_URL` remain
valid. On web the browser supplies its normal User-Agent and referrer; the deployed site currently sets
no Referrer-Policy header and no referrer meta, so the origin is sent today. **Record a deployment
check** so a future header change cannot silently strip it. Normal interactive viewing is acceptable;
bulk downloading, prefetching unseen areas and offline tile downloads are not.

**Visual checks:** urban ≈ zoom 12 and rural ≈ zoom 6 — boundary thickness, Senate dash pattern, pin
size, pin hit area, label size and padding, label collisions, zoom controls, credits, focus ring. Do not
tune only against Minneapolis.

## Working approach

Several separable pieces here — server-side issue aggregation, address suggestions, name/URL/email
normalization, office cleanup, the freshness value. The primary session should consider delegating the
independent ones to other sessions, coordinate and integrate their output, and match each to an
appropriate model tier (cheaper for mechanical normalization and cleanup, stronger where rework risk
is real).

## Source line — 17px left spacing

On desktop and phone the legislative source line takes `padding-left:17px`, so it starts inside the
optical left edge of the rounded card group above it. It stays **after the map and the Census notice**.
