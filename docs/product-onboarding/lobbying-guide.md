<!-- describes: apps/frontend/src/screens/redesign/LobbyingLandingScreen.tsx, apps/frontend/src/screens/redesign/LobbyingPrincipalsScreen.tsx, apps/frontend/src/screens/redesign/LobbyingLobbyistsScreen.tsx, apps/frontend/src/screens/redesign/LobbyingPrincipalScreen.tsx, apps/frontend/src/screens/redesign/LobbyingLobbyistScreen.tsx, apps/frontend/src/lib/lobbyingDirectoryCopy.ts, apps/frontend/src/lib/lobbyingRecordCopy.ts, apps/frontend/src/lib/lobbyingTypes.ts, apps/frontend/src/data/lobbying.ts, apps/frontend/src/data/moneyNameSearch.ts, apps/frontend/src/hooks/useLobbying.ts, apps/frontend/src/hooks/useLobbyingNameSearch.ts, apps/frontend/src/components/lobbying/LobbyingPageFrame.tsx, apps/frontend/src/components/lobbying/LobbyingSearchResults.tsx, apps/frontend/src/lib/lobbyingSearch.ts, apps/frontend/src/lib/lobbyingPageSnapshot.ts, apps/frontend/src/lib/lobbyingMetadata.ts, apps/frontend/src/components/lobbying/LobbyingDonationContext.tsx, apps/frontend/src/components/lobbying/LobbyingDonationControls.tsx, apps/frontend/src/components/lobbying/LobbyistDirectoryCard.tsx, apps/frontend/src/lib/lobbyingDonationDirectory.ts, apps/frontend/src/lib/lobbyingPanelCopy.ts, apps/frontend/src/navigation/webRoutes.ts, api/page.ts, api/sitemap.ts -->

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
| `/money/lobbying/lobbyists`                       | Registered lobbyists, with name search and annual donation order                     |
| `/money/lobbying/principals`                      | Distinct organisation IDs from either lobbying file                     |
| `/money/lobbying/lobbyists/<name>-<registration>` | Listed clients and separately filed donations under that registration   |
| `/money/lobbying/principals/<name>-<entity ID>`   | Official yearly spending and lobbyists listed for that organisation     |

Only the final number identifies a record. The readable name in an address does not
choose or join identities. Each address opens directly, without first visiting another
screen. `/money` has a sixth lane named Lobbying. `/money/search` adds 2 separately
counted groups, Lobbyists and Principals. The lobbying-under-development strip is removed
from all money screens in the same release.

The “Back to Lobbying” link on a lobbyist or principal record always opens
`/money/lobbying`. Its label names that destination, so it does not follow an earlier
browser-history entry.

## Search within lobbying

Individual lobbyist and principal records have Share controls; the landing and
chooser directories do not. The window names the kind of record, then shows its
title once and complementary context. Lobbyist context reflects registration
status; principal context names reported spending and listed lobbyists.
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
Every principal with spending rows and every currently registered lobbyist has its own
sitemap row too (`/sitemaps/lobbying-principals.xml`, `/sitemaps/lobbying-lobbyists.xml`);
a record reached under a mistyped name forwards to the source spelling's address. Each
lobbying page's browser-tab title names the state (“Kozak, Andrew — Minnesota lobbyist”), and
its description says what that kind of page shows and where the records come from
(`apps/frontend/src/lib/lobbyingMetadata.ts`).

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

## Annual donation order in the lobbyist directory

`/money/lobbying/lobbyists` adds Year and Sort by controls. Name A–Z remains the
default. Recorded donations can be ordered highest or lowest first for a completed
calendar year. The server orders the whole matching list before selecting 50 rows;
missing amounts follow supported amounts in either direction, with name and
registration number breaking ties. Search, year, sort and page stay in the address.
Changing a control returns to page 1. Filtered addresses are not indexed.

Each row opens that lobbyist's record with the same donation year selected.
The directory prints the selected year, the campaign source copy date and source
link separately from the lobbyist-list copy date. Its disclosure distinguishes
campaign donations from client lobbying spending and warns that these are sums of
held matching records, not complete giving totals. The supported-amount count
covers the whole name search, not just the visible page.

The name field sits above one results card. That card's header carries the result
count, Year and Sort by together: side by side on a computer, the count above the
2 controls on a tablet, and everything stacked on a phone. The count is the
results heading and announces its own change politely. Under it, inside the same
card, sit the amount limitation, the supported-amount count, the expandable
explanation with its source link, and the campaign file's copy date. The rows
follow, with name, client count, amount and arrow in aligned columns above the
phone band and wrapped beneath the name on a phone. Nothing repeats the chosen
order as a separate caption, because Sort by already names it.

Loading, a failed read and both empty results keep that header and limitation,
because they describe the list whatever it currently holds. A pending or failed
read prints no count and no supported-amount sentence, since neither has been
established; a completed search that matched nobody prints its real zero. A
failure keeps Sort by usable and keeps a year already chosen in the address
selected. Browser Back restores the search, year, order, page and the place in
the list.

A sum requires an exact registration-number match, Lobbyist contributor kind and
Contribution receipt kind. It uses the source year and preserves signed amounts,
repeated rows and declared goods-or-services values. Every receiving committee's
full-year itemized sum must agree within $0.01 with the same published contribution
snapshot's filing comparison, tied to the current filings snapshot, with a passed
self-test and a December 31 cutoff. A missing comparison, recipient, amount or
out-of-period payment withholds the donor's entire annual amount. A partially
pruned contribution snapshot withholds all amounts. State political contribution
refunds are not returned gifts and are not subtracted.

The year menu offers completed years with at least 1 supported amount; the latest
such year is the default. An explicitly requested unsupported completed year is
retained and explains its missing amounts. “No matching donation records” and
“Amount unavailable” never become $0. This approved directory order does not
rank influence, combine donors or join client spending to donations.

## The principal address

The page defines a principal as a person or organisation that funds lobbying and must
report its spending under Minnesota law. The heading names the Board entity ID and the
date the lobbying records were copied.

The first card prints each official yearly row, newest first. Its explanation says each
row is 1 calendar year, reports are due the following March and every figure comes from
the Minnesota Campaign Finance and Public Disclosure Board. The official
organisations-search source link sits in this card with the standard horizontal arrow.
The notes first explain the 5 categories, then explain rounding and filed `$0` values,
then explain why older spending was commonly reported under General. The “Not reported”
definition appears only when at least 1 amount is blank.

At 1100 pixels and wider, the figures use 7 labelled columns: Year, Total spent, PUC,
General, Legislative, Administrative and Metropolitan. Year and Total spent carry the
strongest weight, and 1 vertical line separates them from the 5-category breakdown. At
smaller widths, each year becomes a block with the year and Total spent on 1 line, followed
by 5 rows pairing each category label with its amount. Every width shows all 5 categories.
Total spent is the Board’s own figure; the screen adds no total across years. Whole dollars
cut off cents rather than rounding. A filed zero prints `$0`. Every blank amount says “Not
reported” and never becomes zero.

The annual report is due the following March. The downloaded file does not prove the day
each report was filed, so the screen says "with reports due the following March". It does
not claim every filing arrived by 15 March. The Board's 2026 calendar moved that year's
deadline to Monday 16 March.

The second card names lobbyists listed for this principal in records copied on the displayed
date, not the lobbyists from each spending year. The official lobbyist-search source link
sits before the full count. The first 5 rows appear immediately, and the reveal control
names the number it will add. When the association's printed principal name differs
from the spending file's name, the heading area says "Registered as {name} in the lobbyist
list". A successfully read empty list has its own no-lobbyist sentence; a failed read does
not claim an empty list.

At phone widths, Share sits below the copied-date line so the title, definition and date
each use the full content width. At tablet and computer widths, Share stays beside the
heading block.

## The lobbyist address

“Organisations represented” lists distinct principal IDs from the copied list, retaining the
source order. Its explanation uses the full card width. It starts with the whole count,
reveals 5 rows, then offers “Show 5 more clients” until all rows are visible. The list holds
no past clients. A registration missing from the copied list says “not listed on the copy
date”; it can still have older donations.

“Campaign donations filed under this registration number” is a separate card. It says that
campaign donations are separate from lobbying spending and the represented organisations.
It finds Contribution rows of Lobbyist kind by registration number, never by name. Rows are
grouped by year and receiving committee, with the committee's kind and a link only where
records support one. It reveals 5 payment rows at first and 5 more per selection.
Dates, amounts and donated-goods-or-services markers stay on the payment lines.
A differently typed donor name remains visible as "Filed as {name}". Repeated rows remain
separate payments. The Year control offers all years or a selected year and resets
the visible payment count to 5 when changed. The card adds no per-committee,
per-year or page total; the guarded directory amount above is the scoped exception.

There is no sentence joining a client's spending to a legislator. Listed clients and donations
are different records. Beyond the guarded annual donation order in the lobbyist
directory, no chart, ranking, map, trend or combined money total is drawn on the
lobbying screens.

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

The annual donation controls and source guard are tracked in
[issue 2292](https://github.com/alethical-org/alethical/issues/2292). The scoped
directory exception also appears in the campaign-finance architecture and grounded
answer rules; other lobbying surfaces retain their separate-record limits.
