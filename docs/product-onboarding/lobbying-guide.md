<!-- describes: apps/frontend/src/screens/redesign/LobbyingLandingScreen.tsx, apps/frontend/src/screens/redesign/LobbyingPrincipalsScreen.tsx, apps/frontend/src/screens/redesign/LobbyingLobbyistsScreen.tsx, apps/frontend/src/screens/redesign/LobbyingPrincipalScreen.tsx, apps/frontend/src/screens/redesign/LobbyingLobbyistScreen.tsx, apps/frontend/src/lib/lobbyingDirectoryCopy.ts, apps/frontend/src/lib/lobbyingRecordCopy.ts, apps/frontend/src/lib/lobbyingTypes.ts, apps/frontend/src/data/lobbying.ts, apps/frontend/src/data/moneyNameSearch.ts, apps/frontend/src/hooks/useLobbying.ts, apps/frontend/src/hooks/useLobbyingNameSearch.ts, apps/frontend/src/components/lobbying/LobbyingSearchResults.tsx, apps/frontend/src/lib/lobbyingSearch.ts, apps/frontend/src/lib/lobbyingPageSnapshot.ts, apps/frontend/src/lib/lobbyingMetadata.ts, apps/frontend/src/components/lobbying/LobbyingDonationContext.tsx, apps/frontend/src/lib/lobbyingPanelCopy.ts, apps/frontend/src/navigation/webRoutes.ts, api/page.ts, api/sitemap.ts -->

# How the lobbying pages work

Net: `/money/lobbying` shows who was registered to lobby Minnesota when the displayed
files were copied, which organisations they represented, and what those organisations
report spending in each year.

The Board calls a person or organisation that funds lobbying and must report its spending
under Minnesota law a **principal**. The lobbyist list and the yearly spending file are
different records, copied together with
1 displayed date. Campaign donations come from a separate file with its own copy date.
The source and recovery process is described in
[lobbying-source-import.md](../operations/lobbying-source-import.md).

## Addresses and entry points

| Address                                           | What it shows                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `/money/lobbying`                                 | Search, 2 directory links, source date, source link and coverage limits |
| `/money/lobbying/lobbyists`                       | Everyone in the copied lobbyist list, by filed name                     |
| `/money/lobbying/principals`                      | Distinct organisation IDs from either lobbying file                     |
| `/money/lobbying/lobbyists/<name>-<registration>` | Listed clients and separately filed donations under that registration   |
| `/money/lobbying/principals/<name>-<entity ID>`   | Official yearly spending and lobbyists listed for that organisation     |

Only the final number identifies a record. The readable name in an address does not
choose or join identities. Each address opens directly, without first visiting another
screen. `/money` has a sixth lane named Lobbying. `/money/search` adds 2 separately
counted groups, Lobbyists and Principals. The lobbying-under-development strip is removed
from all money screens in the same release.

## Search within lobbying

Individual lobbyist and principal records have Share controls; the landing and
chooser directories do not. The window names the kind of record, then shows its
title once and complementary context. Lobbyist context reflects registration
status; principal context names reported spending and current registered lobbyists.
[How sharing works](sharing-guide.md) owns the shared controls and destinations.

Submitting the name field on `/money/lobbying` keeps the reader on that address and
stores the submitted query in `q`. Search needs at least 3 characters and runs on
Search or Enter. Typing alone does not submit. A shorter submission keeps the last
results under their original query heading and shows “Enter at least 3 characters”.

Lobbyists appear before Principals, with up to 5 rows per group. Each group carries
its own exact count, including zero when the search succeeds without matches. A
failed group carries its own retry and no count. A successful group stays available
when the other fails. Searches use separate lobbying list requests; campaign searches
run only after “Search all money records for “{query}”” is opened.

“View all matching lobbyists” and “View all matching principals” retain the submitted
query in their full directory links. The ordinary browse cards open unfiltered lists;
they condense below results and stack on phones. “Clear search” removes the query,
restores the starting view and focuses the field. Old responses cannot restore cleared
results or replace a newer search. Refresh and browser history preserve the submitted
query; returning from a result restores the saved scroll position.

Principal rows display their stated latest year when available. A principal found only
in the lobbyist list remains unlinked and explains why there is no spending page.
Distinct alternate registered spellings appear beneath the spending-file name, matched
by official entity ID within the same pair of source files, never by similar names.
The registered spellings do not broaden the directory’s existing filed-name filter.

The opening says “Find registered lobbyists, the organisations they represent, and what
those organisations report spending on lobbying in Minnesota.” The field label says
“Search lobbying records,” its placeholder says “Search by name,” and the helper says
“Find lobbyists or organisations using all or part of a name.” A spelling reminder appears
only after a search has no matches. The Lobbyists card defines lobbyists as “People
registered to influence government decisions on behalf of others.” The Principals card
defines principals as “People or organisations that fund lobbying and must report their
spending under Minnesota law.” The Lobbyists card says “LOBBYISTS LISTED”; the Principals
card says “ORGANISATIONS REPORTED SPENDING FOR {year},” so its count cannot be mistaken for
the larger directory population. The source card says “RECORDS LAST COPIED” and “These
records come from the Minnesota Campaign Finance and Public Disclosure Board.” It links to
the official downloads using the shared horizontal arrow. The page leaves 56 pixels between
the information cards and footer on phones, 72 on tablets and 88 on desktop.
Counts and supporting explanations are at least 15 pixels; controls are at least
44 pixels tall. A short live announcement describes search changes while result links
remain ordinary links within list items.

## The 2 directories

Both directories show 50 rows per numbered page. Each one labels its field for the kind of
name it accepts, uses “Search by name” in the field, and says “Enter all or part of a name.”
The typed name and page number stay in
the address as `q` and `page`, including Back and Forward. The name box filters the filed
name; it does not offer a guessed spelling. Ordinary Previous and Next links work before
the app starts, and `/sitemap.xml` names every numbered page, so each one is reachable
without walking there. An unfiltered page beyond the served whole count is not found.

The Lobbyists directory defines lobbyists, says who they represent in these records, and
dates the copied registration list. Its rows say “client listed” or “clients listed.” The
Principals directory explains the Board’s word, says that it combines names from different
reporting years and the dated lobbyist list, and distinguishes its total from the Lobbying
page’s named-year spending count. A row with spending says “Latest spending year in these
records: {year}.”

The showing line uses the whole served count, for example
"Showing 51–100 of 1,665 registered lobbyists". Page counts are never added across kinds.
Changing the name does not draw the previous search's empty statement under the new name.

Principals include IDs found only in the copied lobbyist list. Such a row is plain text, in both
the directory and search, with "No spending rows in the Board's file through {latest year},
so no page to open". A link requires spending rows under the same entity ID. The displayed
record name comes from the spending file where that file holds the principal.

## The principal address

The page defines a principal as a person or organisation that funds lobbying and must
report its spending under Minnesota law. The heading names the Board entity ID and the
date the lobbying records were copied.

The first card prints each official yearly row, newest first. Its explanation says each
row is 1 calendar year, reports are due the following March and every figure comes from
the Board. It also says a shown `$0` is a filed value while “Not reported” means the file
leaves the value blank. The official organisations-search source link sits in this card
with the standard horizontal arrow. The 7 wide columns are
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

The second card names lobbyists listed for this principal on the displayed copy date, not
the lobbyists from each spending year. The full count appears before the first 5 rows.
“Show 5 more lobbyists” reveals the next 5 inside the card. When the association's printed
principal name differs
from the spending file's name, the heading area says "Registered as {name} in the lobbyist
list". A successfully read empty list has its own no-lobbyist sentence; a failed read does
not claim an empty list.

## The lobbyist address

“Organisations represented” lists distinct principal IDs from the copied list, retaining the
source order. Its explanation uses the full card width. It starts with the whole count,
reveals 5 rows, then offers “Show 5 more clients” until all rows are visible. The list holds
no past clients. A current registration
missing from the held list says “not listed on the copy date”; it can still have older donations.

“Campaign donations filed under this registration number” is a separate card. It says that
campaign donations are separate from lobbying spending and the represented organisations.
It finds Contribution rows of Lobbyist kind by registration number, never by name. Rows are
grouped by year and receiving committee, with the committee's kind and a link only where
records support one. It reveals 5 payment rows at first and 5 more per selection.
Dates, amounts and donated-goods-or-services markers stay on the payment lines.
A differently typed donor name remains visible as "Filed as {name}". Repeated rows remain
separate payments. No amount is added per committee, year or page.

There is no sentence joining a client's spending to a legislator. Current principals and
donations are different records. No chart, ranking, map, trend or combined money total is
drawn on the lobbying screens.

## Expanded donation rows elsewhere

On legislator and committee Campaign money views, the Lobbyists tab keeps each printed
name, employer and payment count. Expansion adds the held registration and
"See who {name} represents" when the copied list resolves it. A changed name reads
"Registration {n} · registered as {list name}". An absent registration reads
"Registration {n} · not listed on the copy date" without a link.

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
9865 has 86 clients, revealed 5 at a time. Tests also cover both directory page-2
responses, an active-list-only principal, a blank spending row, a real zero, earlier rows
carrying later kinds, and failure versus absence. A repeated committee-link lookup was
removed only after its observed recipient numbers were shown to prove the same links in
the same pinned contribution copy.

Docs check: This guide describes the display and source states delivered by
[issue 2164](https://github.com/alethical-org/alethical/issues/2164) and the copied-date and
education corrections in [issue 2241](https://github.com/alethical-org/alethical/issues/2241).
It adds no policy or changes to the protected campaign-finance architecture record.
