# How Find My Legislator works (plain-English guide)

<!-- describes: apps/frontend/src/screens/FindMyLegislatorScreen.tsx, apps/frontend/src/components/MapPinPicker.tsx, apps/frontend/src/components/find/RepresentativeCard.tsx, apps/frontend/src/lib/findMyLegislator.ts, apps/frontend/src/navigation/ia.ts, apps/frontend/src/navigation/webRoutes.ts, apps/frontend/src/data/api.ts, apps/frontend/src/hooks/useAppQueries.ts, alethical/api/routers/public.py, alethical/api/services/representative_lookup.py, alethical/api/serializers.py -->

**Find My Legislator** tells you which current Minnesota state senator and state
representative serve one location. It also shows the location's state House, state
Senate, and U.S. congressional district numbers.

You do not need an account. Open **Search → Find My Legislator**, use the finder on the
home page, or go straight to `/find-my-legislator`.

---

## 1. Search with a street address

The page says: **Enter a full street address. Cities and ZIP codes can cross district
lines.** This same instruction appears at phone and wider screen widths.

Start with a house number and at least 2 street-name characters. After a short pause,
**Suggested addresses** shows up to 5 active addresses from Minnesota's
official statewide list. A numbered street can start suggesting after its first digit.
City and ZIP are optional, but adding either can narrow or reorder the choices.

Choose an address to put its full official form in the box and find its legislators in
the same step. Or enter a full Minnesota street address and choose **Find**. Pressing
Enter does the same thing.

- Include a house number and street name. A city or ZIP code alone is not enough
  because a city or ZIP can cross district lines.
- Suggestions are Minnesota-only, so they do not need `MN`. Include `MN` for a full
  manual search, especially when the city name also exists in another state.
- Commas, periods, repeated spaces, and common street abbreviations do not have to be
  perfect. `4255 215th St E Farmington MN 55024` and
  `4255 215th St E, Farmington, MN 55024` are treated as the same address.
- A small 1-character typo in a street word of 5 or more characters can still match.
  This covers 1 added, missing, changed, or swapped character, such as `215ht` for
  `215th`.
- Common direction order does not have to match the official record. For example,
  `350 S 5` can suggest an address stored as `350 5th Street South`.
- The house number must be exact. Alethical will not quietly move you to a nearby
  number or a different street.

Alethical first asks the U.S. Census Bureau for the address as entered. If that does not
find it, Alethical checks Minnesota's official statewide address list. It looks for the
exact house number and closest safe street name, then uses the ZIP, city, street ending,
and direction to rank the official matches.

A brief timeout or server error gets 2 quick retries. If Census still does not answer,
Alethical uses Minnesota's address list instead of ending the lookup immediately.

If 1 address is clearly closest, Alethical uses it. If several official addresses are
equally close, **Choose your address** appears with up to 5 choices. Click or tap the
right one. With a keyboard, use the up and down arrows, Enter to choose, or Escape to
close the list.

Both address lists use the same keyboard, mouse, and touch behavior. Moving with the
arrow keys or hovering highlights the current choice. Alethical never chooses a
suggestion without the reader's click, tap, or Enter key.

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

Click or tap anywhere inside Minnesota on the district map. The lookup runs at once for
that point, so there is no second button to press.

- Use **+** and **−** or 2 fingers on a phone or trackpad to zoom.
- Drag the map with a mouse or 1 finger to move around.
- Drag the selected pin, or use its arrow keys, to adjust the location.
- On a phone, choose **Show district map** first. The page remembers whether you left
  the phone map open for the rest of that browser tab.

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

Some fields are absent when the official record does not provide them. If a seat is
vacant, the page says **Seat vacant** instead of inventing a member.

This page finds Minnesota state legislators. It shows the U.S. congressional district
number, but it does not show a member of Congress.

---

## 5. What the messages mean

- **No match for that address:** The public address sources could not find 1 safe
  Minnesota match. Check the house number and street name, include `MN`, and try the
  full city and ZIP.
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
- **No matching Minnesota addresses yet:** Keep typing.
- **Address suggestions are unavailable:** The official suggestion list did not answer.
  The **Find** button and **Use my location** still work.

While a lookup is running, the page says **Looking up districts** and shows 2
placeholder cards. The page does not show an old address result as if it belonged to a
new typed address.

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

On phones and computers, the 3 map credit lines begin below the first map view. They
remain available by scrolling farther down the page.

What happens to the location data:

- A typed address is sent to the U.S. Census Bureau without an Alethical account ID.
- While suggestions are open, Minnesota's address service receives the exact house
  number and the street-name prefix. It does not receive the city or ZIP. The same
  service later receives the house number and street name if Census search fails.
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
  spend the 10 full lookups. The browser waits 300 milliseconds after typing stops and
  reuses a recent suggestion result for 60 seconds.
- Results depend on 2 public government address services. Both must remain unavailable
  after their retries before a temporary source failure blocks an address lookup.
- The page shows current state legislators from Alethical's official-record database.
  Contact details or committee facts may be missing when the source record is missing.
