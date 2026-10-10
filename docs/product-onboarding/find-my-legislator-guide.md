# How Find my legislators works (plain-English guide)

<!-- describes: alethical/api/services/address_format.py, apps/frontend/src/lib/currentAddressInput.ts, apps/frontend/src/lib/addressSuggestion.ts, apps/frontend/src/components/address/*.tsx, apps/frontend/src/components/home/HomeLegislatorFinder.tsx, apps/frontend/src/screens/FindMyLegislatorScreen.tsx, apps/frontend/src/components/MapPinPicker.tsx, apps/frontend/src/components/find/RepresentativeCard.tsx, apps/frontend/src/lib/findMyLegislator.ts, apps/frontend/src/navigation/ia.ts, apps/frontend/src/navigation/webRoutes.ts, apps/frontend/src/data/api.ts, apps/frontend/src/hooks/useAppQueries.ts, alethical/api/routers/public.py, alethical/api/services/representative_lookup.py, alethical/api/serializers.py -->

**Find My Legislator** tells you which current Minnesota state senator and state
representative serve one location. It also shows the location's state House, state
Senate, and U.S. congressional district numbers.

You do not need an account. Open **Search → Find my legislators** or go straight to
`/find-my-legislator`. The signed-in homepage also has this finder; the signed-out
homepage has **Find my candidates**.

---

## 1. Search with a street address

The heading is **Find my legislators**, followed by **See who represents you in
the Minnesota House and Senate**. This introduction uses the same responsive
size, color and heading gap as the candidate introduction. The visible field label is **Full street
address**, 8px above the box. **A city or ZIP code alone cannot identify your
legislators** opens the notes at the foot of the page instead, and the field's
screen-reader description still names it, so a screen reader hears it while typing.
The signed-in homepage's separate finder retains its own introduction.

Start with a house number and at least 2 street-name characters. `350 S` is not enough,
because `S` could mean South or the start of a street name. `350 Su` can start a named-
street search, and `350 S 5` can start a numbered-street search. The first eligible
input starts immediately; continuing edits share a request after a 180-millisecond
typing pause. An edit after at least 180 milliseconds of idle time starts immediately. Pasting, dropping or accepting a browser-provided replacement also starts immediately. Spaces before or after the same address reuse its pending request or recent successful reply; spaces within the address remain distinct.
The shared address component shows **Suggested address** for 1 choice or
**Suggested addresses** for 2 to 5 active Minnesota addresses. City and ZIP are
optional, but adding either can narrow or reorder the choices. Slow, failed or empty
optional suggestions stay quiet; **Find** still searches the typed text.
The field can reuse an exact successful input for 60 seconds, keeping at most 8
entries only in that mounted field’s memory. Clearing the field, starting a search,
changing its suggestion source or leaving the form clears these entries. No
address suggestions are saved in browser storage or a shared server cache.
The shared suggestion service filters active status and state locally to reduce the
source query wait. If the source reports omitted rows, it retries with both filters
at the source so excluded records cannot crowd out valid choices. House, state,
street, direction and unit matching remain unchanged. Census and Minnesota address
requests reuse a connection within each server worker without retaining cookies,
credentials, queries or responses.

Suggestions come from Alethical's own copy of Minnesota's published address
file when a usable copy is available. The server switch
(`ALETHICAL_ADDRESS_SUGGESTION_INDEX_ENABLED`) is on in production. The
server downloads the whole public file every 12 hours, checks it before using it, and
never uses a copy more than 24 hours after its download. Typing then gets suggestions
from the copy without asking the state's service. A missing, expired or damaged copy,
more than 5,000 matching rows, or no usable match asks the state's live service
instead. The state compiles the file from the counties that take part and updates it
about every 3 months, so a newly added or removed address can lag the live service by
the state's own delay plus up to 24 hours of ours. The copy holds public address
records only, never what readers type.

The same printed address can carry more than 1 official map point, for example 1 per
unit. A suggestion from the copy, or one whose printed address has more than 1 point,
is offered once. When chosen, the server checks the exact chosen text, including any
apartment or ZIP+4 detail the reader typed, against Minnesota's current address points
before finding districts. When every current point has the same single House, Senate
and congressional answer, the result uses the point nearest the suggestion. A point on
a district border has no single answer. When the points disagree, the page refuses to
guess (see **What the messages mean**). When the check cannot settle the point,
Alethical searches the chosen text as if it were typed. Pointing at, pressing or
arrowing to such a suggestion starts this check early, for at most 2 suggestions per
typed address, so a choice made after a glance usually finishes sooner. A reader whose
browser asks to save data, or reports a slow connection, skips the early check; the
choice itself still runs it. Each early check counts toward the lookup limit below.

No row is selected on opening. Down starts at the first row and Up at the last;
both wrap. Enter chooses an active keyboard row, otherwise it searches the typed
address. Hover is grey and never changes the keyboard choice, which is pale green.
Escape, Tab and an outside click close the list and keep the text. Keyboard focus
stays in the field. System high-contrast mode adds an outline to the active row.
A screen reader hears the count on every opening and count change while open.

A completed click or tap fills the box and starts the search. Touch-down, scrolling
and cancelled gestures do not select. Focus changes cannot swallow the first tap
or move **Find** between press and release. New text clears old choices; old replies
cannot replace current suggestions or reopen a dismissed list. External Find, location
and map searches also keep suggestions closed when loading ends or the returned
address changes; editing or freshly focusing the address field enables them again.

A filled address box shows a 44px **Clear address** button (×), including saved
browser addresses. Clearing empties and focuses the box without searching, dismisses
choices and ignores older lookup or location replies. Existing successful results
remain. Address-specific errors disappear; service failures remain without marking
the cleared box invalid. The reserved button space stays when empty or busy.
This finder does not select all on focus or add Cancel.

The field and buttons have a 60px minimum height. Full addresses wrap. Computer and
tablet suggestions overlay content 8px below the box and stay exactly its width;
on phones they sit in the page flow before the full-width buttons. The page scrolls
all rows into reach without an inner list scroller. Necessary opening or delayed
keyboard-resize scrolling keeps the label visible. Manual scrolling suppresses
further unsolicited movement until the list closes; arrow navigation still reveals
the selected row. The browser's readable saved-address styling and system contrast
colors are retained.

Typed units carry only onto a confidently matching full base location, respecting
supplied city, state and ZIP as well as house number, street and direction. An
uncertain match cannot silently remove or transfer a unit. A different returned
unit stays visible for explicit selection, and displayed and submitted choices agree.

Keyboard and button submission read the address visible in the box, including a
saved browser address filled just before submission. Entering or leaving the box
also brings a browser-filled value into its current state. If that value replaced
the text used for an older suggestion, choosing the old suggestion searches the
newly visible address instead of selecting an unrelated location.

- Include a house number and street name. A city or ZIP code alone is not enough
  because a city or ZIP can cross district lines.
- Suggestions are Minnesota-only, so they do not need `MN`. Include `MN` for a full
  manual search, especially when the city name also exists in another state.
- Commas, periods, repeated spaces, and common street abbreviations do not have to be
  perfect. `4255 215th St E Farmington MN 55024` and
  `4255 215th St E, Farmington, MN 55024` are treated as the same address.
- The Minnesota address parser accepts a final **United States**, **United States
  of America**, **US**, **USA**, **U.S.** or **U.S.A.** after a complete street
  address, state and ZIP. Spaces, commas, periods, semicolons, colons and dashes may separate or
  follow that label; balanced parentheses may surround the label. A final comma,
  period, semicolon or colon without a country is also
  accepted. Line breaks, tabs and repeated spaces are treated as spaces. House
  numbers, units, directions and ZIP+4 remain intact; other countries and unknown
  trailing words are not removed to force a match.
- A small 1-character typo in a street word of 5 or more characters can still match.
  This covers 1 added, missing, changed, or swapped character, such as `215ht` for
  `215th`.
- Common direction order does not have to match the official record. For example,
  `350 S 5` can suggest an address stored as `350 5th Street South`.
- While typing, a lone street-name word that is also a street type, such as
  `1006 Summit`, still offers matching streets. This suggestion-only allowance
  does not relax the checks on a submitted address.
- The house number must be exact. Alethical will not quietly move you to a nearby
  number or a different street.

Alethical first asks the U.S. Census Bureau for the address as entered. If that does not
find it, Alethical checks Minnesota's official statewide address list. It looks for the
exact house number and closest safe street name, then uses the ZIP, city, street ending,
and direction to rank the official matches.

A brief timeout or server error gets 2 quick retries. If Census still does not answer,
Alethical uses Minnesota's address list instead of ending the lookup immediately.
The formatting cleanup also applies to that Minnesota fallback and the Minnesota
street-only retry sent to Census. It does not change which source is tried first
or the matching rules below.

An official answer that says its row list was cut short never counts as proof of a
single address: Alethical asks again with the service's full 2,000-row allowance and
reports the service as unavailable if the answer is still cut short. When rows printing
the same address carry map points in different districts, Alethical shows **No match
for that address** rather than choosing one.

If 1 address is clearly closest, Alethical uses it. If several official addresses are
equally close, **Choose your address** appears with up to 5 choices. Click or tap the
right one. With a keyboard, use the up and down arrows, Enter to choose, or Escape to
close the list. The page shows the movement hint only when the list has at least 2
choices.

The submitted **Choose your address** confirmation keeps its existing selection
treatment and keyboard guidance. It is separate from typing suggestions. Neither
list chooses an address without a completed click, tap or explicit Enter selection.

After a successful search, the address box and the page's browser link use the official
address that was found. For example, a safe typo match replaces the typo instead of
leaving it in the box or link.

Alethical refuses to guess when the official result list is incomplete or no safe match
stands out.

---

## 2. Use your browser location

Choose **Use my location** and allow location access when your browser asks.

The browser supplies 1 latitude and longitude. Alethical checks that point against the
Minnesota district lines. The street address box is not used.

If the browser blocks location access, cannot get a location, or reports a point outside
Minnesota, enter a street address instead.

---

## 3. Choose a point on the map

The map stays visible on phones and computers. Directly below it, a computer says
**Drag the map to explore, then use + and − or 2 fingers on a trackpad to zoom**. A phone says
**Drag the map with 1 finger to explore, then use + and − or 2 fingers to zoom**. The larger line
below says **Click the map where you live to see your House and Senate legislators** on
a computer and uses **Tap** on a phone. None of these 4 lines ends with a period. Click or tap
anywhere inside Minnesota. The lookup runs at once for that point, so there is no second button.
These 2 lines stay the same after an address, saved lookup, or map point loads.

- Use **+** and **−** or 2 fingers on a phone or trackpad to zoom.
- Drag the map with a mouse or 1 finger to move around.
- Drag the selected pin, or use its arrow keys, to adjust the location.

Moving or zooming the map changes the view without changing the selected location
or starting another lookup. Moving the pin with arrow keys starts a lookup 500
milliseconds after the last movement; holding Shift moves the pin farther.

If the background map images fail to load, the district lines, pin, and controls
remain usable on a plain background. The OpenStreetMap credit appears when its
images load; district-source credit stays visible in either case.

After a match, the map draws the House and Senate district lines around the selected
point. The district cards stay visible while a moved pin is being checked. If the new
point fails, the page keeps the earlier cards and says it could not update the districts.

---

## 4. What a match shows

The result starts with:

- the state Senate district;
- the state House district nested inside it; and
- the U.S. congressional district number, when available.

The page then shows a card for the current state senator and a card for the current state
representative. A card can include:

- name, photo, office, district, party, and city of residence;
- legislative service and current term;
- up to 3 current committee assignments;
- bills authored and bills led as chief author in the named Legislature;
- issues found on bills the member authored;
- phone, email, and office address;
- a link to the member's official Minnesota Legislature profile; and
- **View profile**, which opens Alethical's full legislator page.

The card shows at most 6 issue labels, followed by **+N more** for the remainder.
These labels describe the member's authored bills, not inferred personal priorities.

Some fields are absent when the official record does not provide them. If a seat is
vacant, the page says **Seat vacant** instead of inventing a member.

This page finds Minnesota state legislators. It shows the U.S. congressional district
number, but it does not show a member of Congress.

---

## 5. What the messages mean

- **No match for that address:** The public address sources could not find 1 safe
  Minnesota match. Check the house number and street name, include `MN`, and try the
  full city and ZIP.
- **We couldn’t safely identify your districts from this address:** Minnesota's
  current records give this address points in different districts, or a point on a
  district border, so Alethical will not guess. It says **Check your full street
  address, or choose where you live on the map**.
- **That address is outside Minnesota:** Alethical only covers Minnesota state
  legislative districts.
- **We couldn't use your location:** The browser blocked location access, could not get
  a point, or returned a point outside Minnesota. Enter a street address instead.
- **Too many lookups:** The page has reached the 10-lookups-per-60-seconds safety limit
  for the public internet address making the requests. It says **Try again in up to 60
  seconds** and counts down on the Find button. The message has no ending period.
- **Lookup unavailable right now:** Both public government address sources did not
  answer, or a local district file could not be read. The address itself may be fine.
  Try again later.
- **Seat vacant:** The district was found, but no current member holds that seat.

While an address lookup runs, **Find** changes to **Finding…** with a spinner in
the same-sized button and a polite waiting announcement. The first search shows
2 placeholder cards. Later searches retain successful results with their original
address and district context until replacement succeeds. A failure keeps those
results with the error and a retry action; only the latest request can replace them.

The placeholder animation waits 250 milliseconds, so a quick result does not flash
an animation on screen.

---

## 6. Sources and privacy

The lookup uses public records and public map services:

- the U.S. Census Bureau turns a typed address into a map point;
- the Minnesota Geospatial Information Office supplies the backup statewide address
  list;
- [Minnesota's Legislative Coordinating Commission](https://gis.lcc.mn.gov/) supplies
  the state House and Senate district lines stored with Alethical;
- an official 2022 congressional district map stored with Alethical supplies the U.S.
  congressional district number; and
- [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) supply the
  background map.

On phones and computers, the notes at the foot begin below the first map view, under a
thin grey line, in this order: the address help line, **© OpenStreetMap contributors**,
**District lines from Minnesota’s Legislature**, and the Census notice. They remain
available by scrolling farther down the page. Every line is the same size (14px, grey
`#4f5651`, 6px apart). The 2 links are green and semibold, with the shared arrow 6px after
the last word; on pointer hover the words turn black and underline while the arrow stays
green. Each link tells screen readers it opens in a new tab.

The complete Census notice reads: **This product uses the Census Bureau Data API
but is not endorsed or certified by the Census Bureau**.

What happens to the location data:

- A typed address is sent to the U.S. Census Bureau without an Alethical account ID.
- While suggestions are open, Minnesota's address service receives the exact house
  number and the street-name prefix. It does not receive the city or ZIP. The same
  service later receives the house number and street name if Census search fails.
- When the address copy answers a suggestion, typing sends nothing to Minnesota's
  address service. Choosing a suggestion that needs the current-records check, or
  pointing at one, sends its house number and street name to that service.
- A successful address, browser location, or map point is checked against official
  district files stored with Alethical. Its latitude and longitude are not sent to the
  Minnesota Legislative Coordinating Commission.
- The lookup does not require sign-in and does not read your Alethical account.
- Alethical does not offer a button that saves this address or point to your account.
- The address in the box appears in the page's browser link so the lookup can reload.
  After a successful match, both use the official address that was found. Copying or
  sharing that link also shares that address. Browser-location and map-point coordinates
  are not added to the link.

The full record of what Alethical keeps and shares is in
[`docs/product-onboarding/user-data-retention-policy.md`](user-data-retention-policy.md)
(What we keep about readers).

A later program-download failure does not automatically reload a working visit.
Failed screens or sections use the existing failure message and an explicit
**Reload page** action. Browser Back can return to earlier screens without
discarding their in-memory state. An explicit reload still follows this finder's
existing address-in-the-link behavior. See
[page-load-performance-decisions.md, Recover failed downloads without losing a working visit](../operations/page-load-performance-decisions.md#recover-failed-downloads-without-losing-a-working-visit).

---

## 7. Important limits

- Minnesota only.
- A street location is required for the final result. City, ZIP, county, neighborhood,
  and landmark searches do not identify a district.
- A near match is accepted only under the narrow rules above. This is not a general
  guess at what an address might mean.
- The browser shares identical requests already in progress and reuses a successful
  result for 60 seconds. Failed results are not reused.
- The public endpoint accepts 10 lookup requests from 1 public internet address in 60
  seconds. The browser blocks both lookup buttons for the remaining wait after the
  endpoint returns that limit.
- Suggestions have their own 60-requests-per-60-seconds limit, so normal typing does not
  spend the 10 full lookups. First input and edits after an idle period start immediately;
  continuing edits wait 180 milliseconds after typing stops. The browser cancels
  obsolete suggestion requests when the text changes.
- Results depend on 2 public government address services. Both must remain unavailable
  after their retries before a temporary source failure blocks an address lookup.
- The page shows current state legislators from Alethical's official-record database.
  Contact details or committee facts may be missing when the source record is missing.
