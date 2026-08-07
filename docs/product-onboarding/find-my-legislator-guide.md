# How Find My Legislator works (plain-English guide)

<!-- describes: apps/frontend/src/screens/FindMyLegislatorScreen.tsx, apps/frontend/src/components/MapPinPicker.tsx, apps/frontend/src/components/find/RepresentativeCard.tsx, apps/frontend/src/lib/findMyLegislator.ts, apps/frontend/src/navigation/ia.ts, apps/frontend/src/navigation/webRoutes.ts, apps/frontend/src/data/api.ts, apps/frontend/src/hooks/useAppQueries.ts, alethical/api/routers/public.py, alethical/api/services/representative_lookup.py, alethical/api/serializers.py -->

**Find My Legislator** tells you which current Minnesota state senator and state
representative serve one location. It also shows the location's state House, state
Senate, and U.S. congressional district numbers.

You do not need an account. Open **Search → Find My Legislator**, use the finder on the
home page, or go straight to `/find-my-legislator`.

---

## 1. Search with a street address

Enter a full Minnesota street address, then choose **Find**. Pressing Enter does the
same thing.

- Include a house number and street name. A city or ZIP code alone is not enough
  because a city or ZIP can cross district lines.
- Include `MN`, especially when the city name also exists in another state. Alethical
  will not use the Minnesota-only backup search unless the address says Minnesota.
- Commas, periods, repeated spaces, and common street abbreviations do not have to be
  perfect. `4255 215th St E Farmington MN 55024` and
  `4255 215th St E, Farmington, MN 55024` are treated as the same address.
- A small 1-character typo in a street word of 5 or more characters can still match.
  This covers 1 added, missing, changed, or swapped character, such as `215ht` for
  `215th`.
- The house number must be exact. Alethical will not quietly move you to a nearby
  number or a different street.

Alethical first asks the U.S. Census Bureau for the address as entered. If that does not
find it, Alethical checks Minnesota's official statewide address list. It looks for the
exact house number and closest safe street name, then uses the ZIP, city, street ending,
and direction to rank the official matches.

If 1 address is clearly closest, Alethical uses it. If several official addresses are
equally close, **Choose your address** appears with up to 5 choices. Click or tap the
right one. With a keyboard, use the up and down arrows, Enter to choose, or Escape to
close the list.

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

- Use **+** and **−** to zoom.
- Drag the map to move around.
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
- **Lookup unavailable right now:** A public government address or district service did
  not answer. The address itself may be fine. Try again later.
- **Seat vacant:** The district was found, but no current member holds that seat.

While a lookup is running, the page says **Looking up your districts** and shows 2
placeholder cards. The page does not show an old address result as if it belonged to a
new typed address.

---

## 6. Sources and privacy

The lookup uses public records and public map services:

- the U.S. Census Bureau turns a typed address into a map point;
- the Minnesota Geospatial Information Office supplies the backup statewide address
  list;
- [Minnesota's Legislative Coordinating Commission](https://gis.lcc.mn.gov/) supplies
  the state House and Senate district lines;
- an official 2022 congressional district map stored with Alethical supplies the U.S.
  congressional district number; and
- [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) supply the
  background map.

What happens to the location data:

- A typed address is sent to the U.S. Census Bureau without an Alethical account ID.
- If the Census search fails, the Minnesota backup receives only the house number and
  street name, not the city or ZIP.
- A successful address, browser location, or map point sends its latitude and longitude
  to Minnesota's Legislative Coordinating Commission to find the state districts.
- The lookup does not require sign-in and does not read your Alethical account.
- Alethical does not offer a button that saves this address or point to your account.
- A typed address appears in the page's browser link so the lookup can reload. Copying
  or sharing that link also shares the typed address. Browser-location and map-point
  coordinates are not added to the link.

The full record of what Alethical keeps and shares is in
[`docs/product-onboarding/user-data-retention-policy.md`](user-data-retention-policy.md)
(What we keep about readers).

---

## 7. Important limits

- Minnesota only.
- A full street location is required. City, ZIP, county, neighborhood, and landmark
  searches do not identify a district.
- A near match is accepted only under the narrow rules above. This is not a general
  guess at what an address might mean.
- Results depend on public government services. A temporary failure can block a lookup.
- The page shows current state legislators from Alethical's official-record database.
  Contact details or committee facts may be missing when the source record is missing.
