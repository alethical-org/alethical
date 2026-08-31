# The revised nav — verification shots for #1698

Frozen record. Six screenshots taken while verifying
[#1698](https://github.com/alethical-org/alethical/issues/1698), kept because the claims
they prove are not things a test can show: that the new Reports row draws its icon rather
than an empty tile, that the phone drawer has lost its "More Tracking" chip, and that the
account menu's new count is a number when we have one and nothing at all when we do not.

Taken against the local dev server at a 1440-wide computer viewport and a 390-wide phone
viewport, in headless Chrome driven over the DevTools protocol so every press is a real
pointer event. Page data came from the production read API through a local GET-only proxy.
The signed-in account is invented (`Jordan Reyes`, `jordan@example.com`) and was served by
that same proxy alongside a watchlist of a chosen size, so no real person's account was
read or shown. The watchlist size is what drives the two count states below.

| File | What it shows |
| --- | --- |
| `nav-search-menu-desktop-1440px.png` | The Search menu. Row 2 now reads **Money in politics** with its NEW pill and the new description, in its unchanged position. The roadmap row below is four chips — Candidates · Claimed Profiles · News · Ask AI — with no "More Tracking". |
| `nav-reports-menu-desktop-1440px.png` | The new **Reports** group, second in the bar between Search and About, holding one row: **Campaign money**, with the NEW pill on the row and a bar-chart glyph in its icon tile. An empty tile here is the failure this shot rules out. |
| `account-menu-with-count-desktop-1440px.png` | The account menu with **Tracked Bills** above the password row, a divider between them, and the count right-aligned in mono. There is no Account row. |
| `account-menu-no-count-desktop-1440px.png` | The same menu for a reader who tracks nothing: the label alone. No zero, no dash, no spinner. The menu looks identical while a count is still on its way, which is the point. |
| `nav-drawer-groups-phone-390px.png` | The phone drawer: SEARCH · REPORTS · ABOUT · ON THE ROADMAP, then the account card. No Yours group, no row descriptions on the phone, and the roadmap chips are the same four. |
| `account-sheet-with-count-phone-390px.png` | The phone account sheet, same rows in the same order as the computer popover, with the 56px-tall Tracked Bills row and its count. |

These are a dated record of one verification run, not a description of current behaviour,
so they carry no `describes:` comment and are not kept in step with the code. What a test
can pin is pinned: the menu shape and the roadmap chips in
`apps/frontend/src/navigation/__tests__/webRoutes.test.ts`, the count's two absent cases in
`apps/frontend/src/lib/__tests__/trackedState.test.ts`, and the shelf's addresses old and
new in both of those plus `apps/frontend/src/lib/__tests__/pageEndpoint.test.ts`.
