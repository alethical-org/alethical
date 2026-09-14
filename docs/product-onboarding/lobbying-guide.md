<!-- describes: apps/frontend/src/screens/redesign/LobbyingLandingScreen.tsx, apps/frontend/src/screens/redesign/LobbyingPrincipalsScreen.tsx, apps/frontend/src/screens/redesign/LobbyingLobbyistsScreen.tsx, apps/frontend/src/screens/redesign/LobbyingPrincipalScreen.tsx, apps/frontend/src/screens/redesign/LobbyingLobbyistScreen.tsx, apps/frontend/src/lib/lobbyingDirectoryCopy.ts, apps/frontend/src/lib/lobbyingRecordCopy.ts, apps/frontend/src/lib/lobbyingTypes.ts, apps/frontend/src/data/lobbying.ts, apps/frontend/src/hooks/useLobbying.ts, apps/frontend/src/lib/lobbyingPageSnapshot.ts, apps/frontend/src/lib/lobbyingMetadata.ts, apps/frontend/src/components/lobbying/LobbyingDonationContext.tsx, apps/frontend/src/lib/lobbyingPanelCopy.ts, apps/frontend/src/navigation/webRoutes.ts, api/page.ts, api/sitemap.ts -->

# How the lobbying pages work

Net: `/money/lobbying` shows who is registered to lobby Minnesota, which organisations
they represent today, and what those organisations report spending in each year.

The Board calls an organisation that pays for lobbying a **principal**. The current
lobbyist list and the yearly spending file are different records, copied together with
1 displayed date. Campaign donations come from a separate file with its own copy date.
The source and recovery process is described in
[lobbying-source-import.md](../operations/lobbying-source-import.md).

## Addresses and entry points

| Address | What it shows |
| --- | --- |
| `/money/lobbying` | Search, 2 directory links, source date and coverage limits |
| `/money/lobbying/lobbyists` | Everyone in the current lobbyist list, by filed name |
| `/money/lobbying/principals` | Distinct organisation IDs from either lobbying file |
| `/money/lobbying/lobbyists/<name>-<registration>` | Current principals and separately filed donations under that registration |
| `/money/lobbying/principals/<name>-<entity ID>` | Official yearly spending and lobbyists currently registered for that organisation |

Only the final number identifies a record. The readable name in an address does not
choose or join identities. Each address opens directly, without first visiting another
screen. `/money` has a sixth lane named Lobbying. `/money/search` adds 2 separately
counted groups, Lobbyists and Principals. The lobbying-under-development strip is removed
from all money screens in the same release.

## The 2 directories

Both directories show 50 rows per numbered page. The typed name and page number stay in
the address as `q` and `page`, including Back and Forward. The name box filters the filed
name; it does not offer a guessed spelling. Ordinary Previous, Next and numbered links
make every directory page reachable before the app starts. An unfiltered page beyond
the served whole count is not found.

The showing line uses the whole served count, for example
"Showing 51–100 of 1,665 registered lobbyists". Page counts are never added across kinds.
Changing the name does not draw the previous search's empty statement under the new name.

Principals include IDs found only in the active list. Such a row is plain text, in both
the directory and search, with "No spending rows in the Board's file through {latest year},
so no page to open". A link requires spending rows under the same entity ID. The displayed
record name comes from the spending file where that file holds the principal.

## The principal address

The first card prints each official yearly row, newest first. The 7 wide columns are
Year, Total spent, PUC, General, Legislative, Administrative and Metropolitan. Total spent
is the Board's own figure; the screen adds no total across years. Whole dollars cut off
cents rather than rounding. A filed zero prints `$0`. A blank value never becomes zero.
An entirely blank row says "Not reported" across its figure columns.

Before 2024, absent later kinds share the sentence "Not broken out by these kinds before
2024". Any row carrying one of the later 3 kinds prints all 5 kinds, whatever its year.
Every 2024-or-later row also prints all 5 kinds, with blank cells labelled honestly.
On a phone the table has Year and Reported spending columns, keeping all the same figures.

The annual report is due the following March. The downloaded file does not prove the day
each report was filed, so the screen says "with reports due the following March". It does
not claim every filing arrived by 15 March. The Board's 2026 calendar moved that year's
deadline to Monday 16 March.

The second card names lobbyists registered for this principal **today**, not the lobbyists
from each spending year. The full count appears before the first 30 rows. "Show the next
30" reveals more inside the card. When the association's printed principal name differs
from the spending file's name, the heading area says "Registered as {name} in the lobbyist
list". A successfully read empty list has its own no-lobbyist sentence; a failed read does
not claim an empty list.

## The lobbyist address

"Represents today" lists distinct principal IDs from the current list, retaining the
source order. It starts with the whole count, reveals 30 rows, then offers "Show the next
30" until all rows are visible. The list holds no past clients. A current registration
missing from the held list says "not registered today"; it can still have older donations.

"Donations filed under this registration number" is a separate card. It finds Contribution
rows of Lobbyist kind by registration number, never by name. Rows are grouped by year and
receiving committee, with the committee's kind and a link only where records support one.
Dates, filed employer text, amounts and donated-goods-or-services markers stay on the
payment lines. A differently typed donor name remains visible. Repeated rows remain
separate payments. No amount is added per committee, year or page.

There is no sentence joining a client's spending to a legislator. Current principals and
donations are different records. No chart, ranking, map, trend or combined money total is
drawn on the lobbying screens.

## Expanded donation rows elsewhere

On legislator and committee Campaign money views, the Lobbyists tab keeps each printed
name, employer and payment count. Expansion adds the held registration and
"See who {name} represents" when the current list resolves it. A changed name reads
"Registration {n} · registered as {list name}". An absent registration reads
"Registration {n} · not registered today" without a link.

A missing number or failed lookup never means not registered. Several registration
numbers under the same printed name receive separate contexts, with no guessed identity.
Committees & Funds use the same expanded panel shape and their known committee links.

## Source states and reading aids

Loading and failed requests have their own messages and retry controls. A failed read
does not print a no-record statement. The 1 lobbying copy date describes both files;
the separate campaign-donation copy date never borrows that date. No address, postcode,
telephone or email field is stored by the active-list parser or exposed by these screens.

Layouts change at 768 and 1100 pixels. Controls are at least 44 pixels tall, explanatory
text is at least 15 pixels on a phone, and digits use equally wide figures. Tables have
captions and row/column headers. Collections are lists, and plain records have no dead link.

## Real checks

The 13 September 2026 pair has 1,665 lobbyists and 5,395 listed associations. The union
directory has 3,443 principal IDs. The latest reported spending year is 2025, with 1,748
principals having at least one stated amount. These are dated checks, not fixed page copy.

Kozak, Andrew (141) has 3 separate payments to committee 17868 in 2025. Registration
9865 has 86 principals, revealed as 30, 60 and 86. Tests also cover both directory page-2
responses, an active-list-only principal, a blank spending row, a real zero, earlier rows
carrying later kinds, and failure versus absence. A repeated committee-link lookup was
removed only after its observed recipient numbers were shown to prove the same links in
the same pinned contribution copy.

Docs check: This guide describes the display and source states delivered by
[issue 2164](https://github.com/alethical-org/alethical/issues/2164). It adds no policy or
changes to the protected campaign-finance architecture record.
