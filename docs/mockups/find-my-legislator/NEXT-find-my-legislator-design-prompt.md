# Claude Design prompt — Find My Legislator (new screen: desktop + phone)

Paste everything below the line into Claude Design. Everything in it is decided: the data
behind every element is confirmed in our database or from a free public source we already
call, and the things we can't back are listed as exclusions rather than questions.

Written 2026-08-05. Grounding source of truth: `alethical/api/routers/public.py`
(`/representative-lookups`), `alethical/api/services/representative_lookup.py`,
`alethical/api/serializers.py`, `.claude/rules/grounded-answers.md`,
`docs/product-onboarding/mvp-redesign-plan.md`, `docs/product-onboarding/user-data-retention-policy.md` §2.3.

---

## Design Find My Legislator — the last Alethical screen still wearing the old skin

Alethical is a Minnesota legislative record product: we show people what their legislature
is actually doing, in plain language, and every fact points back to an official source.

**Find My Legislator** answers one question: *who represents me at the Minnesota Capitol?*
A person types their street address and gets back the two people who hold their seats — one
State Representative (House) and one State Senator (Senate) — plus the district numbers
those seats belong to.

Every screen around it has been redesigned (home, Search Bills, Search Legislators, Bill
Detail, Legislator Profile, Tracked Bills). This one has not, and it now receives real
traffic from the home page. It reads as a different product: grey utility cards, a
monospace input, a plain draggable map, results as bare text. Design it to belong to the
same family as **Search Legislators** and the home page's green "Find My Legislator" band.

Design **both a desktop layout (~1600px) and a phone layout (~390px)** for every state
listed below.

### How people arrive

1. **From the home page's green "Find My Legislator" band.** They already typed an address
   and pressed **Find**. They land here with that address in the field and the lookup
   already running. This is the main entrance, and it means the first thing they see is
   usually *work in progress*, not an empty form.
2. **From the nav**, Search ▾ → Find My Legislator. Empty field, nothing typed.
3. **From the Search Legislators hero's "Find by address" link** (pin icon).
4. **From a shared link.** The address lives in the web address
   (`/find-my-legislator?address=350+S+5th+St...`), so a result can be sent to someone else
   and it re-runs for them.

### The states to design (desktop + phone for each)

1. **Nothing entered yet.** Address field, the reason a full street address is needed, a
   "use my location" affordance, and the map.
2. **Looking up.** Two public services are called in sequence (an address-to-coordinates
   step, then a coordinates-to-district step), so this can take a couple of seconds. Design
   the waiting state as part of the result area, not as a spinner that replaces the page.
3. **Found — both seats filled.** The normal, most important state.
4. **Address not recognised.** The address service matches a house number plus a street. A
   city name alone, or a ZIP alone, returns nothing. The message has to teach the fix
   without scolding.
5. **Address is outside Minnesota.** We only cover Minnesota.
6. **Location refused or unavailable.** The person pressed "use my location" and the
   browser said no, or their location came back outside Minnesota.
7. **Seat vacant.** The districts resolve but one of the two seats has no seated member. One
   card is present, one is not. Design what stands in for the missing one.
8. **The lookup service is down.** One of the two public services is unreachable. Nothing is
   wrong with what they typed, and they should be told that.

### What we can put on screen — all of this is confirmed real

**The place and the districts**

- The address as the official address service corrected it (e.g. typed "350 s 5th st
  minneapolis" → "350 S 5TH ST, MINNEAPOLIS, MN, 55415").
- **House district code** — a number plus a letter, e.g. `59B`.
- **Senate district code** — a number, e.g. `59`. Each Senate district contains exactly two
  House districts, which is worth making legible: this is the fact that surprises people.
- **The real outline of the district.** The Minnesota state source we already call returns
  the actual boundary shape of both the House and the Senate district for a point. So the
  map can show the true district outline with the address pinned inside it, rather than
  today's generic map with a loose pin. Design for both outlines being available (they
  nest).
- **The US House district number** is also returned (e.g. `5`). We have no page for members
  of Congress and no record of their work, so it may appear only as a quiet fact with no
  link, or not at all. Your call whether it earns the space.

**Each of the two people** (both cards carry the same fields)

- Official portrait photo. 200 of 206 members have one; 6 do not, so design an initials
  fallback (Search Legislators already uses a green-tint initials avatar).
- Full name.
- Party, as a **neutral grey chip** reading "DFL" or "R". Never red or blue — this is a
  standing product rule, not a taste preference.
- Their title from their chamber: "State Senator" or "State Representative".
- Their district code.
- The city they live in.
- Committees they sit on, and the leadership role where they hold one ("Chair", "Vice
  Chair", "Co-Chair", "Ranking Minority Member"). 160 of 613 memberships carry a role.
- **Bills they authored** — a total count and a chief-author count. Use the words *author*
  and *co-author*; never "sponsor".
- Which election put them in, and which term they are serving (e.g. "Elected 2020,
  re-elected 2022", "2nd term"). Free text from the official record, so lengths vary a lot.
- Email, phone, and their Capitol office address.
- A link to their official page on the Legislature's own site.
- A link to their profile inside Alethical, which is the deeper destination: their bills,
  committees, and record.

### Address suggestions as you type — design this

As the person types, show up to 5 matching Minnesota street addresses under the field.
Picking one fills the field and runs the lookup immediately. Design:

- the suggestions list under the field (address line, city, ZIP),
- the highlighted row as someone arrows down the list with a keyboard,
- the quiet state when nothing matches yet (no scary empty box while they are mid-word).

### The map — design this

Today the whole map is one big clickable surface, with the zoom buttons and the map-credit
link sitting **inside** it. That is invalid on the web and breaks keyboard use. Design the
map with:

- the district outline drawn, the address pinned inside it,
- a map that can always be dragged to explore, plus a pin that can be dragged and a map that
  can be clicked to move the pin (moving the pin re-runs the lookup for that spot),
- zoom controls and the map-credit link as **separate controls beside or over the map**,
  never inside the map's own clickable area,
- a phone treatment. The map is the least important thing on a phone and the address answer
  is the most important, so decide whether it appears above the answer, below it, or behind
  a "show map" control.

### What must not appear

Each of these would advertise something we cannot do, which is the one thing this product
never does.

- **No city names or ZIP codes as examples, placeholders, or suggestion chips.** The address
  service cannot resolve them, so any such suggestion leads straight to a failure. The home
  page's city chips were removed for exactly this reason.
- **No "save this address" or "my legislators" for later.** Saving an address has never been
  built and no address has ever been stored.
- **No "here's how your legislators voted on this bill".** Roll-call votes are not linked to
  individual members yet.
- **No vote-count statistic on the cards.** That number is 0 for every member in our data.
- **No "email your legislator" composer or contact form.** We can show their email and
  phone; we do not send anything on anyone's behalf.
- **No election, candidate, or campaign information.** Not in this product yet.
- **No red or blue party colouring** anywhere, including the map.

### Accessibility to bake in

- The address field gets a clearly visible focus ring, and text at least 16px on phones so
  iOS does not zoom the page when it is tapped.
- Error text sits next to the field it belongs to and is readable without relying on colour.
- Every tap target on a phone is at least 44px.
- The suggestions list is fully usable from a keyboard: arrow to move, Enter to choose, Esc
  to close.
- The map's zoom controls and credit link are each their own keyboard stop.

### Consistency

Match the shipped redesign exactly: the shared top nav (logo + ALETHICAL, Search / Track /
About, green Sign in button or account chip), the light gradient background with the dot
texture, Libre Franklin for display and UI, JetBrains Mono for codes and small labels,
18px-radius white cards with the soft shadow, green accents, the neutral grey party chip.
The two legislator cards here should read as close relatives of the Search Legislators
cards, not as a new card species.

### One source line at the foot

The same string used everywhere else in the product:
"Source: Minnesota Legislature · revisor.mn.gov · Updated {date}".

---

## Notes for our side (not part of the prompt)

**Small build work this design implies.** The lookup response already carries photo, party,
chamber, district, elected/term, email, phone, office address, official profile link, and
the authored/chief-authored counts. Two additive changes are needed to serve everything
above: pass committee names + roles into the two legislator payloads (the Search
Legislators query already does this), and add the represented city (it exists on the bill
sponsor payload, not yet on this one). The district outline shapes are returned by
`gis.lcc.mn.gov` on the call we already make and are currently discarded — passing them
through is a serializer change, not a new data source.

**Address suggestions source.** Verified 2026-08-05: `photon.komoot.io` (OpenStreetMap
data, no API key) returns house-number-level Minnesota addresses for partial input when
biased with a Minnesota bounding box. Free and keyless, rate-limited by fair use, so
self-host if traffic grows. This closes the "how" on
[#53](https://github.com/alethical-org/alethical/issues/53).

**Folds in two open issues.** [#53](https://github.com/alethical-org/alethical/issues/53)
(autofill the address as you type) and
[#882](https://github.com/alethical-org/alethical/issues/882) (the map's zoom buttons sit
inside the map's own button, which browsers may not render) are both answered by this
design rather than patched separately.
