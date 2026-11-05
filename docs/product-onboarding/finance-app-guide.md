# Alethical Finance app guide

<!-- describes: apps/finance/** -->

**Net:** Alethical Finance is the sign-in-only research site for law firms and their
political committees. With its signed-in screens on, a listed account researches bills,
legislators, committees and their money from Finance Home; a page not built yet answers
exactly like an unknown address. With them off, https://finance.alethical.com serves only
the landing page and sign-in.

The settled decisions are in
[alethical-finance-architecture.md](../architecture/alethical-finance-architecture.md). The
app is its own React web app in `apps/finance`, not a mode of alethical.com's app.

## The public site

Until Finance's signed-in screens are approved, the build setting `VITE_FINANCE_SCREENS`
stays off (anything other than `on`), and the app serves 3 addresses:

- **`/`, the landing page**, from the approved Design drawing "Product Landing" in the
  Alethical B2B project, word for word: the hero "Turn policy priorities into a focused giving
  strategy" with "Political intelligence for law firms and PACs"; the money / people and
  organizations / policy diagram with 24 unlabelled lines between neighbouring lists (none on a
  phone, where the lists stack); "The connections we make" with 3 lines; 4 record counts; the 3
  benefits under "What it does"; and "Sources and updates". The hero's background moves
  slowly and follows the pointer; it is still for a reader who asks for reduced motion. A slim
  bar with Sign in appears once the hero scrolls away.
- **The counts** are read live from `GET /api/v1/finance/landing/counts`
  ([alethical-finance-architecture.md §9, Landing-page counts](../architecture/alethical-finance-architecture.md#9-landing-page-counts)):
  campaign money records with their years; lobbying spending reports with how many
  organizations filed them and their years; bills held for the current Legislature; and TV
  station files with their years. A count the server cannot read has no tile, never a 0; when
  none can be read, the counts block is left out. "Sources and updates" names each source
  with the date its records were copied (bills: updated), in Minnesota time; a date the server
  cannot support is left out and the source stays named.
- Finance is a private beta. No **Request access** email action or closing access section
  appears on the landing page. With signed-in screens enabled, the hero has the only
  **Investor access** button, opening `/investor-access` directly. The header keeps **Sign in**,
  with 24px above its button and the wordmark aligned beside it; the slim scrolled bar keeps
  its compact spacing.
- **Sign in** opens `/sign-in`. After signing in, an account not on the access list sees the
  not-listed state at `/`; a listed account sees the landing page, because no signed-in screen
  is public yet.
- **`/sign-in` and `/auth/return`** work as described below.
- **Every other address** shows "We couldn’t find that page" with a link to the landing page,
  so no unfinished screen is public.

With `VITE_FINANCE_SCREENS` set to `on`, the app is the signed-in site described in the rest
of this guide. `/` stays the landing page for everyone, signed in or not, and Finance Home is
`/home` (Design decision D20: 1 address never shows 2 pages).

## Ways in (screens on)

- **Any Finance address.** A signed-out visitor is sent to `/sign-in`, which remembers the
  address so sign-in returns there. A return address is kept only when it is a built
  signed-in Finance page; anything else, another site included, returns to Finance Home at
  `/home` (to `/` while the screens are off).
- **`/sign-in`.** Google for listed team accounts during the private beta. Ordinary accounts
  have no Finance password or signup path. Shared research accounts enter through the landing
  page’s Investor access button. The emailed-code option stays off until the rollout. Each way
  is shown only once it works: Google once Supabase accepts
  Finance's return address (`VITE_GOOGLE_SIGN_IN`), because Google would otherwise hand the
  visitor back to alethical.com, and email once Alethical's code sending is switched on
  (`VITE_EMAIL_SIGN_IN`). With neither on, the page says "Sign-in to Alethical Finance is
  not open yet."
- **`/auth/return`.** Where Google brings the visitor back, to the Finance page they asked
  for. Finance's emails carry no link, so email sign-in never comes here. A sign-in token in
  the address, from any link, is never used: the page takes it out of the address bar at
  once, so a crafted link cannot sign a visitor into someone else's account. A failed Google
  sign-in returns to `/sign-in` with "Google didn’t finish. Try again, or use email." Opened
  any other way without a finished sign-in, the page says "That sign-in link didn’t work"
  and links back to sign-in.

## Shared research sign-in

Ordinary `/sign-in` has the heading **Sign in** and no investor option. The separate
`/investor-access` page has one **Investor access code** field and an **Enter** button
(**Opening…** while pending), with no separate heading. Both forms link the Alethical
Finance wordmark to the public homepage and keep the added top space:
12% of viewport height, bounded between 64px and 112px, in normal page flow so short
screens and keyboards can scroll. The investor field has 24px of space after the
wordmark. It shows the code as typed and disables automatic capitalization, correction and
spellcheck. The investor page asks for no email.
The server chooses the shared account through its private configuration. It accepts an operator-created research
account and returns to the requested browsing page. An invalid code, too many
attempts and unavailable service have distinct retry messages; fields stay filled
on failure and submission is blocked while sign-in is pending. Passwords are never
saved by the app. The account has no signup, reset or password-change control. Investor sign-out returns
to `/investor-access`; expiry or revocation returns there with the requested research
page preserved. Ordinary accounts keep `/sign-in` as their return path.

Search, filters, sources, profiles and research tools stay available. Editing links
and dedicated editing pages are hidden, with direct visits answering not found.
The server enforces the restriction independently. A research session persists in
the browser, rechecks on return to the tab, expires after 30 days and clears held
results on sign-out, expiry or refused access. Signing into an ordinary account
clears the research session; entering research access leaves the ordinary account.
See [shared research access](../architecture/alethical-finance-architecture.md#shared-research-access)
for the owning permission and password-management rules.

## Sign-in by emailed code

1. **Email:** the visitor types an address and presses Continue. An empty or malformed
   address shows "Enter an email address".
2. The app asks the server for a code (`POST /api/v1/finance/sign-in/code`). The server
   answers every address the same way, with a new challenge the app keeps, and Alethical
   emails an 8-digit code, with no link, only to a listed one, so the next screen says "If
   {address} has access to Alethical Finance, a code is on its way to it", never that a code
   was sent.
3. **Code:** the visitor pastes the code. The app sends it with the challenge from this
   tab's newest request (`POST /api/v1/finance/sign-in/verify`); the server returns a 1-time
   sign-in token that the app hands to Supabase. A request made again within 50 seconds, for
   example after a reload or Use another email, sends no new email, and the code already
   sent still works. Reloaded within the code's 10 minutes, the page opens at this step for
   the same address. A wrong, expired or used code shows "That code is wrong or expired.
   Enter the newest code or send a new one."; if the server cannot check it, "We couldn’t
   check the code. Try again." Send a new code waits 60 seconds between requests and shows
   the seconds left. Use another email goes back with the address kept. After a correct
   code, Continue stays busy until the access answer arrives; if access cannot be checked,
   the page offers Try again.

## After sign-in

- **Checking access…** shows while the server checks the list. Every Finance request checks
  it again, so a revoked account is refused on its next request. Returning to the tab, or the
  hourly sign-in refresh, re-checks quietly and keeps the page; a failed re-check keeps the
  last answer, and a refusal replaces the page at once. Every request gives up after 10
  seconds and offers Try again.
- **Listed account:** the dark navigation bar from the "Finance Nav" drawing: the
  ALETHICAL | Finance lockup (a link to Finance Home), the record families in this order:
  Money, Media buys, Lobbying, People, Legislation (the phone Menu lists the same order; a
  family whose page is not built yet is left out, never linked to a missing page), and the
  Account menu with Sign out. The current family is underlined. On a phone the families and
  Sign out sit in a Menu. The lockup returns to the main search on Finance Home. Both menus show the signed-in address for ordinary
  accounts and omit the shared address for investors. Escape or a press outside closes each menu.
  Sign out also forgets every answer and scroll position this browser held for the account.
- **Search suggestions** on Finance Home: from 2 typed characters, 1
  request per pause in typing to `GET /api/v1/finance/suggestions`; new typing cancels the
  older request immediately and its answer cannot replace the new query. This field reuses
  up to 20 successful queries for 60 seconds while mounted for the same account; nothing
  is saved to browser storage. Account changes, sign-out and access refusal clear them.
  Earlier suggestions stay visible with the searching or failure notice while an update
  waits or fails. Up to 3 rows each under People, Organizations,
  Committees, Bills and Payments under a name, each opening its page; a match whose page is
  not built yet is left out. "Searching…", "No matching suggestions" with "Try another name or
  bill number", and "Suggestions couldn’t load" are the panel's other states, each announced
  to screen readers. Arrow keys move through the rows and View all results, Enter opens the
  chosen row, Escape closes the panel; pressing Search opens `/search` with the typed words.
  Bill suggestions match the typed letters in the held title, short title or description,
  without spelling correction: `danc` can find “dance”, but `danch` cannot. Bill-number
  lookups remain exact. Name suggestions retain direct matches followed by likely
  spellings. The full results page retains its broader bill search.
- **Finance Home (`/home`)**: "Research public records" with the search field, and the 1
  header-corner action "Explore money connections" (a filled button beside the eyebrow and
  heading where they share a line, under the heading where they do not); under "Browse records", entrances into each built directory in this order (Legislators,
  Candidates, Lobbyists, Committees and funds, Party units, Vendors and payees, Lobbying
  organizations), each shown once its page is built; a card per built record family in the
  header's order (Campaign money, Media buys, Lobbying, People, Legislation); and "Sources
  and updates" naming each family's source with its copy or update date, read from the
  landing counts, below the first screen. Its sources keep their own order: the Campaign
  Finance and Public Disclosure Board (Campaign money, Lobbying), the Secretary of State
  (People), the Legislature (Legislation), then the TV stations (Media buys). Confirm identities, Check TV station files and
  Donors by employer are not entered from Home.
- **Not listed:** "This account doesn’t have access to Alethical Finance", the signed-in
  address, Switch account and Contact us (an email to ask@alethical.com). The page never
  says why, because the server never says. An account refused after having access in this
  session reads "This account does not have access to Alethical Finance" with "Results kept
  from this account are no longer shown": every held answer and unfinished entry is cleared.
- **Access cannot be checked:** "We couldn’t check your access" with Try again. A failed
  check never shows the no-access state.
- **Unknown address, or a page not built yet:** "We couldn’t find that page" inside the
  navigation, with Go to Finance Home.
- When the screen changes, keyboard focus moves to its heading and the page starts at the
  top; Back and Forward return to where the reader was on that page. Each sign-in step moves
  focus to its field.
- A link to a record carries the earlier page's own address (`?from=`), so the record's
  "Back to {page}" link reopens exactly that page, its tab, year and search included; up to
  3 earlier pages are kept. A link back to Finance Home names it by its heading, "Back to
  Research public records". The 5 destinations the top bar reaches (Campaign money,
  Media buys, Lobbying, People, Legislation) carry no return link. In-page choices (tab, year,
  sort, page, search) are kept in the address, so a copied link or a new tab opens the same
  view.

The shared tabs on Campaign money, Committee, Bill and Media buys scroll sideways when
needed. Selecting a tab or reaching it by keyboard brings it fully into view. Pointer
focus alone does not move a tab during a press, so one click or tap selects it. Existing
focus, hover and pressed treatments stay visible; this scroll never moves the page vertically.

## Addresses

The addresses follow Design's system map (decision D20), with the station-file pages under
Media buys: `/` (landing), `/home`, `/search`, `/organizations/:id`, `/money`,
`/money/recipients`, `/money/connections`, `/money/identities`, `/money/employers`,
`/money/employers/:name`, `/money/committees/:id`, `/money/names/:query`, `/money/races/:id`,
`/legislature/committees/:id/members`, `/lobbying`, `/lobbying/lobbyists/:id`,
`/lobbying/principals/:id`, `/media-buys`, `/media-buys/folders/:id`, `/media-buys/files/:key`,
`/media-buys/agencies/:name`, `/media-buys/stations/:id`, `/media-buys/check`, `/people`,
`/people/:id`, `/candidates/:id`, `/legislators/:id`, `/bills`, `/bills/:id`, `/votes/:id`.
Built: `/`, `/home`, `/sign-in`, `/investor-access`, `/auth/return`, `/search`, `/people`, `/people/:id`,
`/candidates/:id`,
`/legislators/:id`, `/money`, `/money/committees/:id`, `/money/names/:query`,
`/money/races/:id`, `/money/recipients`, `/money/connections`, `/money/identities`, `/money/employers`, `/money/employers/:name`,
`/legislature/committees/:id/members`, `/lobbying`, `/lobbying/lobbyists/:id`,
`/lobbying/principals/:id`, `/organizations/:id`, `/bills`, `/bills/:id`, `/votes/:id`,
`/media-buys`, `/media-buys/folders/:id`, `/media-buys/files/:key`, `/media-buys/agencies/:name`,
`/media-buys/stations/:id` and `/media-buys/check` (§ Research pages and § Media buys). Every other address answers "We
couldn’t find that page" until its screen is built (`BUILT` in `apps/finance/src/routes.ts`).
Every link is built from these patterns (`hrefFor`), is a real link that opens in a new tab and
copies, and works with Back and Forward. While the screens are off, only `/`, `/sign-in` and
`/auth/return` answer (§ The public site).

## Research pages

Money connections (`/money/connections`), opened from Finance Home's and Campaign money's
"Explore money connections", reads direct recorded
relationships from `GET /api/v1/finance/connections`. Search, year, relationship and the
selected name (`focus`) are server filters; a selected line stays in the address (`edge`),
with how many pages were loaded (`pages`, up to 10), so a return from a record reloads those
pages and restores it. Opened with no earlier page, it reads "Back to Research public
records", Finance Home. The page loads 100 relationships at a time: "Show
{n} more connections" adds the next min(100, remaining), and "{loaded} of {total}
connections loaded" appears once the selection is larger than 1 page. Map and Table read
the same loaded set. Map opens at every band, phone included, where the 3 columns stack
into 1 list so no name or line is cut; an explicit Table choice stays in the address
(`view=table`). Names and lines show hover, keyboard focus and a pressed state on touch,
and Enter or Space selects them; the selection panel lists the chosen name's own
connections with "Show connections" and "View source".

Each relationship keeps its own source, record count and date or filing-year period
("Filing year 2025"). A total is shown only when every amount is held and every date or
every filing year is; otherwise it reads "Incomplete" in the Amount column, "Missing
payment amount" elsewhere, or "Reporting period incomplete". Station-file lines carry no
amount. Sources are never added together and a line never claims that one payment funded
another. Printed names stay separate from confirmed people and organizations; only an
explicit target from the server opens a profile. Totals and counts cover only the
available sources; unavailable ones are named in "Some sources are unavailable · …". A
failed first load reads "We couldn’t load these connections", a failed next page "Some
connections could not be loaded", each with Try again and the loaded rows kept. When the
server stays busy through every retry while rows are on screen, "The service is busy. The
connections shown are the last loaded." keeps them with Try again. A selection the server
does not hold reads "This record is not held in the connections". Sources and updates
names each loaded payment file with its own copy date ("contribution file, copied Nov 3,
2026; expenditure file, copied Oct 9, 2026"), a copy date, not a reporting period. Under
each name and row, the held record kind and registration identify committees; confirmed
people and organizations show the exact spellings in the loaded relationships. Printed
names keep their donor, payee or agency role. A station file shows its saved date when
held. Outside-spending relationships show "Position as filed" and the count of records
whose position is not held, in Table, the selection panel and source evidence. These reads
do not write checks or confirmations.

Each page is built from its approved Design drawing and reads alethical.com's own records
through the shared API (`api.alethical.com`). Every page has a loading state, a failure with
Try again that never reads as an empty result, and a "no longer available" state for a record
the server does not hold. A page reached from another carries "Back to {page}" to exactly the
earlier view, except the 5 top-bar destinations. Routine sources and copy dates sit in
"Sources and updates" at the foot of the page, below the first screen. Money figures follow
[grounded-answers.md rule 12](../../.claude/rules/grounded-answers.md): a missing figure is
never $0 (a missing itemized figure reads "Not reported", a missing official report total
"Report total unavailable", a missing official spending total "We do not hold an official
spending total for this committee for this year", and a year an account holds no records for
"Not held"); an official report total and a sum of listed payments are separate figures; no
figure is ever added across committees or members.

- **Search results (`/search?q=`)**: People (sitting legislators and lobbyists), Organizations
  (lobbying principals), Committees, Bills and Payments under a name, each family loaded,
  counted and failed on its own ("At least {n}" when the server's count is capped). A name
  search runs from 3 characters. View all opens the rest of a family in place.
- **People (`/people`)**: people, candidacies and legislative service stay separate,
  searched by name or district and paged on the server, 10 a page. Record type is a row of
  choices. Candidates adds Election year (including Past candidates), Party as filed and
  Office; Legislators adds Service, party from the Legislature record and Chamber. All
  records has none, and switching type clears the other type's filters. Menu options come
  from the selected record type's held records. Every choice stays in the address, so
  Finance Home's `?type=legislators&service=current` and `?type=candidates` open those views.
  A candidacy's row names its election and seat ("2026 general · State Representative,
  District 56A"), each fact once even where the official record names the district twice;
  party prints only from the candidacy's filed record. A legislator's party comes only
  from the Legislature record. A district search shows the matching held service period,
  with its own seat, party and dates or session, not an unrelated latest seat. Former
  service requires a held service end; missing current membership never establishes it.
  A Person row shows its count of validated candidacy, service and lobbying records,
  including 0, never a count of payment records. Its note uses only the served newest
  candidacy year, first service and lobbyist link. Former, elected and unconfirmed service
  keep their profile status; no note is inferred from the count. Candidate and Legislator
  rows say "Linked to person profile" only when a validated link is served; otherwise they
  name their source.
  Each row still opens its own record, without choosing between multiple linked people.
  Record-type definitions sit under "About these records" below the results.
- **Legislator profile (`/legislators/:id`)**: current or former service (a former legislator
  carries no current title, party, district or committees), each confirmed campaign account
  with its own year and figures (its link opens that report on the committee page),
  spending by outside groups by contest, committees (each opening its members' accounts),
  chief-authored bills with held summaries, 20 a page using that list's own count, and
  related records as two-line links. A session with none says "No chief-authored bills with
  summaries are available for this session". Media buys follows Campaign finance.
- **Candidate profile (`/candidates/:id`)**: the held candidacy facts, the election and its
  result, and confirmed related records. The office and district print once each, as on
  People. Campaign finance and the header figures read only accounts confirmed for
  this candidacy’s held seat and election, excluding the person’s other races; a candidacy
  with none shows
  "No campaign committee is confirmed for this candidacy". An outside-spending contest
  heading opens Money by race only when the candidacy's register contest matches that
  contest's year, office and district. Media buys sits between Campaign finance and
  Election.
- **Matching station invoice**: a Committee expenditure links only to a checked invoice
  for that exact saved payment row. It opens the held file version and cited page, never
  a file guessed from its payee or amount. Missing, withdrawn or ambiguous evidence leaves
  no link; separate invoices remain on their own expanded payment rows.
- **Campaign money (`/money`)**: the committee register by kind (Candidate committees,
  Committees and funds, Party units), searched by name or registration number and paged on
  the server. Candidates has a Party menu drawn from exact filed parties; every tab has
  All registrations, Open registrations and Terminated registrations. All includes retained
  earlier rows, labelled "No longer listed in the current register", with their last-listed
  copy date when held; retention never means termination. Current rows show "Registered
  {date}" when held, "Open registration" without that date, "Terminated {date}", or
  "Registration status not held". Party prints beside candidate committee type only from
  the filed record. Each filter resets the page; changing tab clears Party. Sort by chooses
  names A to Z or numeric registration-number order. Earlier rows kept during a pending or
  failed change keep their own tab, registration, party and search labels. Other ways in opens Vendors and payees,
  Donors by employer and Money by race; About these records states the records' limits. Results stay on
  screen while an update loads or fails, with Try again.
- **Committee (`/money/committees/:id`)**: the registration's status, the official report
  figures for the chosen report (beginning balance, total receipts, contributions, total
  expenditures and ending balance as filed; the report stays in the address), itemized
  contributions in 5 tabs by donor kind, itemized expenditures and Contributions made, each
  name grouped with its own records and a sum only when every amount is present ("Incomplete" otherwise), sorted by
  total, payment date, name or record count, disclosure statements inside payment rows,
  large-contribution notices, statements not linked to a payment, independent expenditures,
  Media buys and related records in the side column, and source evidence for each payment.
  Name links keep the selected year. Inside the report figures, contributions by type as
  filed sets each filed line beside the itemized cash and the difference, as a chart or a
  table, only for the report the server's comparison matches ("A type breakdown isn’t
  available for this report" or "The sources disagree" otherwise). Under the payments, for
  the calendar year: individual contributions by state for a candidate committee (Minnesota,
  Other states and Unknown, each other state on request, assigned from filed ZIP codes), and
  donor names also at other candidate committees (exact printed names counted, the names
  with the most other committees each opening its payments under that name). Each says in
  its own words when it is not available, never $0; a year with no contribution records held
  shows neither. With no earlier page in the address, the return link reads "Back to
  Campaign money".
  Contributions made contains the outgoing rows filed as Contribution; Expenditures
  excludes those rows. Each tab shows its count of held payment rows for the selected
  year, including 0 when a completed read finds none. Unknown counts stay blank.
  Wrapped year buttons align under the first year button on Committee, legislator campaign
  accounts and committee members’ campaign accounts.
  Left and right buttons reveal hidden payment tabs without changing the selected tab or its
  results. Each button appears only when its side has hidden tabs.
  Counts and sums use the complete year, never a partially loaded list. A recipient's type comes only from its exact registration in the
  held register, with that register's copy date and source in the row's evidence; it is
  not a claim about the recipient's type in the payment year. An unknown type says "Type
  not given".
  Every held report name remains selectable. When figures cannot be matched, the page
  explains whether no financial figures are held, the figures lack a coverage end, the
  report lacks a cutoff, the dates differ, several reports share the cutoff, or the report
  is for a special election. It never borrows another report's figures or treats missing
  figures as proof the committee did not file.
  A source notice returned for the selected committee and year appears in Expenditures
  and Contributions made, using the server's exact words, because both read the spending
  file. It is absent from other tabs and is removed on a year or committee change; the
  frontend never infers a notice from the registration number or year.
  Money received that is not a contribution is not shown yet; it waits for its own drawing.
  A payment row has no Open race link: the server serves no checked race for a single
  payment. Matching station invoice appears only as described above.
- **Committee members' campaign accounts (`/legislature/committees/:id/members`)**: each
  member of a sitting legislative committee appears once, with every served role and the
  district for that committee’s session where available. Each has their own confirmed accounts and, for
  each account, the Total receipts, Total expenditures and Ending balance of its report for
  the chosen year as filed, with the report's name and period, read the way Committee reads
  them and never combined. A figure the report does not give reads "Report total
  unavailable", an account with no such report reads "No {year} report held", and a failed
  read, including one the server cannot find, fails that account alone with Try again. The return link appears only when the
  address names the earlier page.
- **Payments under this name (`/money/names/:query?role=`)**: every payment record filed under
  1 exact printed spelling, as a payee (campaign spending and outside spending listed
  separately, never added together), a donor or an employer, read from Finance's own
  `/finance/payments-under-name`, 200 at a time with the server's count of every record in
  scope. Strong full-name spelling variants load automatically after the exact spelling,
  each under its own original-spelling heading and count. Each record shows its date, amount,
  committee and source evidence (the saved source, its copy, the row, the
  employer and ZIP as filed where held, and the whole source row as SOURCE TEXT, 1 "label:
  value" line per column in the file's order, a date as the page prints dates, an amount with
  2 decimals ("1250.50") and a blank cell as "Not given"; the Board's file is linked only when no excerpt is held). A file our copy
  cannot read shows "We could not read this part of our records just now" in its section,
  never the failure line. Each committee link opens the tab
  holding that record's kind, the record's own filing year and the printed name. Browsing shows no identity-confirmation card or status. An address naming a filer and a file (Organization's
  "View payments") shows only that file and that filer's records, counted on the server, under
  "Showing records filed by {committee}, {file}" with Clear all. Later pages are read from the
  same copy of the Board's file; if the file has changed, the page says "The Board’s file
  changed. Reload the records." and "Reload the records" starts over. A new view that fails
  keeps the earlier records, labelled "{n} records under “{name}” in {year}", with the
  failure line and Try again. The address keeps the spelling exactly as printed; a spelling
  with spaces around it prints in quotes (“ Target ”), on this page and on Donors by employer
  and Vendors and payees. "Employer as filed" in the source evidence opens that spelling on
  Donors by employer. Similar donor, payee or employer names lists remaining spellings in the same role and
  filer/file scope, closest first with alphabetical ties, 1 initially then Show more.
  Strong spellings already displayed in main results are excluded before paging. Candidates
  span held years; each count uses the selected year, including 0. No confirmation status,
  amount or shared identity is inferred. Links preserve the filters and the starting name's return path. A different source copy
  is named beside the card; a matching copy uses the page's source information. A recognized
  file filter incompatible with the role gives an empty scope with Clear all, never an
  unfiltered list. Opened with no earlier page, it returns to Campaign money.
- **Donors by employer (`/money/employers`, `/money/employers/:name`)**: a search of the employer
  spellings donors printed (3 characters or more; shorter text opens that exact spelling), each
  with its donor-name count. The chosen spelling and strong employer variants load together,
  each donor shown once with payment records listed apart ("{n} payment records") with "Employer
  name as printed" on every row. Spellings kept after a failed new search name their own
  search ("{n} spellings matching “{words}”"); a failed read offers Try again.
  On a computer the list stays beside the chosen spelling; on a tablet or phone the spelling
  opens on its own with "Back to Employer spellings". Later donors and payments come from the
  same copy of the Board's file; if it has changed, "The Board’s file changed. Reload the
  records." offers a reload. No total is ever added across donors, and a donor's payments are
  never the employer's money. Opened with no earlier page, it returns to Search results.
- **Money by race (`/money/races/:id?year=`)**: 1 contest's candidate committees, each with its
  own reported total and itemized contributions and their periods, and outside spending by
  spender as a chart (For to the right, Against to the left) or a table, never added across
  committees. Each spender uses its own served amount status and payment dates; a missing
  amount or incomplete reporting period stays explicit, never borrowed from the contest.
  Its link opens that spender's own payment year. The same source rule applies to outside
  spending on Legislator profiles. The address names the contest (`house-34b`,
  `senate-41`, `governor`). The contest line names the office by its title ("State
  Representative · District 34B · 2026", "State Senator", "Governor" and the other statewide
  offices); a court seat keeps its seat label ("District Court · District 2 · Seat 14").
  Beside it, "General election · Nov 3, 2026" (or "Primary election", "Special election")
  appears only when the race read serves that contest's election, from the 1 held ballot
  that lists its seat; otherwise no election line is shown, and a date is never worked out
  from the calendar.
  Media buys follows outside spending. A year or office change keeps the last contest's
  figures on screen under their own year, dimmed with "Updating results…" while the next
  answer loads, and with "We couldn’t update these results" and Try again when it fails.
  With no earlier page in the address, the return link reads "Back to Campaign money".
- **Lobbying (`/lobbying`)**: registered lobbyists and principals, searched and paged on the
  server; each tab keeps its own Year and Sort in the address. Lobbyists show the campaign
  contributions matched to each registration in a completed calendar year ("No matching
  donation records", or "Amount unavailable" when any matching amount is missing), sorted by
  name or by amount with rows without an amount last. Principals show each year's own filed
  spending ("No spending report for {year}", never the latest total), sorted by spending or
  name. Missing figures stay explicit, never zero. A lobbyist row opens that year's
  contribution records; links keep the selected year, and old rows keep their own year while
  a new selection loads.
- **Lobbyist (`/lobbying/lobbyists/:id`)** and **Principal (`/lobbying/principals/:id`)**: a
  lobbyist's registration, the organizations it represented on the copy date (5 at a time with
  "Show more") and its matched campaign contribution records by filing year and committee,
  each committee with its total under the shared rule and a link to that committee's
  Lobbyists tab for the year and printed name (its "Back to Lobbyist" returns to the same
  year's records); a principal's total reported spending by year as a chart (a dashed gap for
  a year with no report held), its categories one click away in Table, the lobbyists
  listed for it, and Media buys below them. Opened with no earlier page, each returns to Lobbying.
- **Organization profile (`/organizations/:id`)**: 1 confirmed organization's lobbying,
  political giving and payments received, read only for the exact spellings and records its
  confirmations cover; group totals follow the shared rule, labelled by filing year when
  dates are incomplete. A merged record's address opens the surviving record; a split
  record's address asks which part was meant, with each part's reference and
  confirmed-record count. An unknown reference reads "No organization with this reference is
  in the current copy", with "Open Vendors and payees to search the held records". Media buys
  follows the profile sections, before Sources and updates.
- **Person profile (`/people/:id`)**: confirmed links to 1
  person's candidacies, legislative service and lobbying, their campaign finance, political
  giving and payments received, each event with its own source line. A merged record's
  address opens the surviving record; a split record's address asks which person was meant.
  Each election names its office, district and result status once. A status used as the
  event heading is not repeated beneath it; a distinct running or final-outcome heading
  keeps the result status in its detail. Media buys follows Campaign finance,
  before political giving. Opened with no earlier page, it returns to People.
- **Vendors and payees (`/money/recipients`)**: the server-paged directory of payees, searched
  by name, with All recipients, Confirmed vendors and Printed names, year, payment type and
  sort; each total under the shared rule ("Incomplete" under the amount heading, "Missing
  payment amount" on a phone row, "Reporting period incomplete", "Filing year" labels) and the
  source file under each kind. A printed name opens its payments in the payee role for the
  selected year. Where the server bounds totals, "Minimum amount ($)" and "Maximum amount ($)"
  narrow the whole set (each sent as the typed amount, "$" and commas stripped), with "Smallest
  total first"; text that is not an amount reads "Enter a valid amount", a reversed range
  "Minimum is more than maximum", and both keep the last valid results. Recipients whose
  totals are withheld are left out of a range and counted under the count line. Opened with no
  earlier page, it returns to Campaign money.
- **Confirm identities (`/money/identities`)**: "Names to review" lists exact printed names
  (donor, campaign payee and outside-spending payee, each file its own row) by money recorded
  under the name, with All names, Donor names or Payee names and Not confirmed, Confirmed or All,
  20 a page; a total follows the shared money rule ("Missing payment amount", "Reporting period
  incomplete", "Filing year 2025"). Opening a name shows every identity confirmed for some of its
  records ("Confirmed for {k} of {n} records"), the remaining records and "Suggested matches"
  (only identities already holding records of that spelling; Alethical never suggests by
  name), then "Records under this exact spelling", 50 a page on 1 copy of the Board's file, and
  the name's history with "View evidence". Every account can confirm selected records to an
  identity, create a person or organization, withdraw (with a reason), merge another record in
  after previewing the links that move, or split 1 into 2; each needs an evidence note that
  says more than the shared name, and a source, which is kept apart from the note. An
  identity is shown by its reference (ORG-0042 for an organization, PER-0042 for a person),
  or by its name while the server has not served one, never by its internal id. Merge and split history rows name the identities and keep the event's
  evidence and date, without record counts: the saved events do not hold counts at the
  time of the change, and current counts can change with later confirmations or source
  updates. A later merge keeps its own row naming the reference it now opens. A record count that rests on a Board file the server does not
  hold is never printed as 0 or as a partial sum: every row and History event stays and only
  the number is dropped ("Confirmed as {identity}", "withdrawn: {reason}", "confirmed
  records moved to {reference}", "These confirmed records will move from …", "{k} records
  selected" without "of n", and "Records covered" without its "N records"). History shows a
  loading bar while the identities it reads load, "We couldn’t load the history" with Try
  again when any of them fails (including a missing identity that a merge or split names), and "No
  confirmations or suggestions yet" only when every read finished and none returned an
  event. Linked histories are followed through repeated merges and splits, reading each
  identity once; an oversized history fails visibly instead of silently truncating.
  History also reads the original owners of withdrawn confirmations for that exact
  spelling, even when no current confirmation or selected-year source row remains. Those
  owners do not become current confirmations or merge choices. A split into more than 2 parts
  lists each part and reads "now opens a choice of all {n}". A legislator or public-person link is named by its role ("Legislative service",
  "Official IDs"), never by its internal id. A withdrawal of several confirmations sends 1
  request each; if a later one fails, the page refreshes (each one withdrawn leaves the
  confirmed card and gets its History withdrawal row), says "{k} of {n} confirmations were
  withdrawn. The other {m} were not saved. Your note is kept below." (each verb "was" for a
  count of 1) with Try again, and Try
  again sends only the rest. A selection is the server's record fingerprints, or "All
  records" / "{year} records", which the server resolves. "Saved" appears only after the
  server accepts; otherwise "Not saved. Your entries are kept." with Try again, "These
  records changed since this form opened…" or, after the Board's file is replaced, "Reload
  the records", which keeps the words and clears the selection. Unfinished entries are kept
  as 1 draft per name, role, action and target ("Unsaved draft", "Discard draft"). A
  contextual arrival names the spelling and its role (`?name=&role=`); a spelling with no
  records reads "This record is not held". It is entered only from its context, never from
  Finance Home.
- **Legislation (`/bills`)**: bills searched by words or number, with Session, Chamber and
  Status menus, 20 a page. The Session menu lists the sessions the server holds, the
  current one first; with 1 session held it shows 1 option.
- **Bill (`/bills/:id`)**: the plain-language title, Summary (with passages from the bill
  text), Actions (each with its date and chamber), Votes, Bill Text and Versions, chief
  author and co-authors, companion bill, the committee, official page, and each author's
  confirmed campaign accounts, with "No confirmed campaign account" where none is
  confirmed. Each printed action committee opens its members' campaign accounts only when
  that exact action carries a committee ID; names alone stay plain text. The side card uses
  the newest action that names a committee. Both links preserve the bill's current tab and earlier
  page in their return address. Opened with no earlier page, the bill returns to Legislation.
  The summary names the
  saved version it was written from ("Alethical summary of the 3rd engrossment version"),
  each passage carries that version's name, and "Read the bill text" opens that version at
  the quoted section, even when a newer version is current or another version shares its
  name (2 conference committee reports). When the summary is linked to
  no version the record still lists, or only to the moving "current" pointer or the
  session law, it reads
  "Alethical summary", the passages name no version, and "Read the bill text" opens the
  current text at the top: a quoted section is never looked up in another version. Bill
  Text opens the version the record marks current, by its own code, even when another
  version shares its name (2 conference committee reports); Versions lists 1 row per name,
  and that row is the current one. A version's name carries
  "version" once, as drawn ("Introduced version", "Bill text · introduced version"), never
  twice for a name that already says it ("Text of the current version not held").
- **Roll call (`/votes/:id`)**: the exact motion, date, recorded result and each member's
  recorded vote, filtered and searched in place. The roll call is read by its own id, which
  names its bill; an older link that also carries `?bill=` still opens. Opened with no
  earlier page, it returns to the bill's Votes tab.

Reads queue so that at most 4 run at once (a finished read hands its place to the next), because the shared API serves only 12 requests at
a time across both sites; a "busy" answer is retried after the server's suggested wait. Only
Finance's own routes (`/api/v1/finance/…`) carry the account's token; public reads carry
none.

## Limits and privacy

- Confirm identities writes through the server's identity routes; every account reads every
  note, source, reason and name typed there.
- Finance never links to alethical.com; a CI test fails if any app file names an
  alethical.com page. A check of the production build (`pnpm run check:built-links`) reads
  every text file Finance ships except source maps, code from `@alethical/shared` included.
  It fails on the alethical.com domain anywhere except an email address or
  `https://api.alethical.com`, and on a path that starts like an alethical.com page or
  redirect (`/money/`, `/bills/`, `/read/` ...) unless it is exactly 1 of Finance's own
  addresses. The only other path it allows is 1 of the 4 that Supabase's sign-in library
  writes after its own server's address (`/admin/users`, `/admin/generate_link`,
  `/admin/oauth/clients`, `/admin/custom-providers`). Contact actions use email addresses,
  and data comes from `api.alethical.com`.
- Every page is marked not to be indexed (`noindex`) in a response header and a meta tag.
  `robots.txt` allows crawling on purpose: a crawler that may not fetch a page never reads
  its `noindex`, and can list a linked address without its content. The server marks every
  Finance answer private and uncached, except the landing counts, which are the same for
  everyone.
- Finance prints US spelling ("organization"), including in the wording it imports from
  alethical.com's shared modules, which stay as alethical.com writes them: Finance's build
  rewrites only its own copy (`apps/finance/scripts/usSpelling.mjs`).
- The fonts (Inter, IBM Plex Mono, Space Grotesk) are served from Finance's own address,
  because the site's security policy loads nothing from font services.
- The sign-in session is kept in this browser under its own name, separate from
  alethical.com's. Sign out ends it in this browser only, and removes the saved session even
  when Supabase cannot be reached.
- Ordinary Finance accounts are Supabase accounts in alethical.com's sign-in project,
  so those sign-ins and Google users appear among alethical.com's accounts and sign-up
  figures. Shared research accounts remain separate from Supabase.
- The site runs at https://finance.alethical.com, the `alethical-finance` Vercel project,
  until alethicalfinance.com launches ([deployment.md § Alethical Finance](../operations/deployment.md#alethical-finance)).

## Media buys

The screens at `/media-buys`, `/media-buys/folders/:id`, `/media-buys/files/:key`,
`/media-buys/agencies/:name`, `/media-buys/stations/:id` and `/media-buys/check` read
Finance's private original-file routes (`/api/v1/finance/media-buys/…`). A TV station file
is keyed by its station and FCC source file id, never by its filename, and every link to
one names its exact saved version and page.

- **Media buys (`/media-buys`)**: TV political-ad files from KSTP-TV, KARE and KMSP-TV,
  browsed by TV station folders (Station, Year and Category menus), agency names, stations
  and years, with served totals on each tab. Word search filters the chosen tab; station
  rows name the years held. The tab,
  filters, words and page stay in the address. A safe earlier page adds its named return
  link; the top-level list has no invented return. Nested returns keep the nearest 3
  earlier pages with their filters and section anchors, dropping only the oldest link.
  A capped count says "At least"; a failed
  refresh keeps the earlier rows with Try again. About these records states the coverage
  limits, and Sources and updates names the date the station files were copied.
- **TV station folder (`/media-buys/folders/:id`)**: the files held, each with its saved
  versions, station upload date and the date those exact contents were first saved,
  and the folder's one checked connection, which never
  stands for each file inside it.
- **TV station (`/media-buys/stations/:id`)**: the station's counts once for all years (files
  held, unique file contents, files whose text could not be fully read, files we couldn't
  download, folders we couldn't list, with the 3 drawn notes on what they mean), then the
  same served counts per year, each year linking to its folders, and the other stations
  held. Unplaced collection failures remain under Year unavailable. Unique contents are
  never summed across years. Sources and updates shows the latest check date. Counts are
  files, never ads or money.
- **Printed agency name (`/media-buys/agencies/:name`)**: files under the exact spelling and
  strong spelling variants, exact first then A–Z, with each group's own count. A file/version
  appears once under its first matching spelling and lists others as “Also printed as”.
  Each file is marked Checked on its own agency-name check date in Minnesota time, Checked when
  no unique date is held, or Machine-read · Not checked. Addresses checked for it have their
  quoted text, date and View evidence at the exact version and page. Separate campaign
  and outside-spending payment searches under the name do not prove a file was paid. Similar agency names
  lists other exact held spellings, 1 initially with Show more, with file and station counts.
  Spellings leave this list only when their file groups are displayed; loading or failed
  groups keep their comparison links.
  A row says Checked on a date only when every represented file has a standing check
  on that same Minnesota day. Mixed or missing dates keep Checked; an unchecked file makes
  the row Not checked. Similar spelling establishes no shared identity or address. During a
  changed selection or failed read, kept names stay labelled with their original agency.
- **TV station file (`/media-buys/files/:key`)**: 1 saved version's original page images
  (version, page and zoom in the document bar; version and page in the address), checked
  facts and related records for that version only, each with View evidence, and its
  machine-read text marked Not checked. The evidence panel shows the saved quote and that
  page's machine-read text with the quote marked only where it appears exactly, or says
  that it isn't found or that the page has no text; Correct fact and Withdraw check sit
  inside it and open Check TV station files. Opening and closing evidence keeps the cited
  page. A link naming a version that is not held says "This version is not held" with
  Open the current version, and shows no checks. Images carry the account's access header,
  never a token in an address.
  An image that cannot load or decode uses the existing error and retry control,
  just like a failed request. Retry reads the same file, saved version and page.
  Changing page, version, API source or account discards the prior image. Finance's
  image policy allows these local Blob images; tokens never appear in image URLs.
- **Check TV station files (`/media-buys/check`)**: a queue of current versions with each
  file's reason and an "Unsaved draft" tag; the chosen file's page and machine-read text;
  suggestions read from that version (Use suggestion fills the form; Dismiss and Restore
  are local); Check a fact and Check a connection (committee, lobbying principal, printed
  issue or related TV station file, each previewed before saving); and the checks on this
  version, each with View evidence and withdrawal inside its row. A save is refused field
  by field before and after the server checks it, an exact duplicate reads "Already
  saved", "Saved" appears only after the write succeeds, and a failed write reads "Not
  saved. Your entries are kept." with Try again. A failed withdrawal keeps the check and
  the reason. Each file and version keeps 1 draft, with each mode's own entries, in this
  browser for this account. A link naming another version shows the version-mismatch
  notice and Check the current copy before any form opens.
- **Media buys card**: Committee (by registration number), Candidate (by candidacy),
  Principal (by entity number), Person and Organization (by the held profile's id),
  Legislator (by id or slug), and Money by race (by the contest's office, district and
  year, matched against checked elections) list TV station files with a checked connection
  to that record. Each opens its exact saved version and cited page, with "Back to" the
  record, under "KSTP-TV, KARE and KMSP-TV station files, not in money totals". Candidate,
  Person and Legislator profiles keep confirmed committees' files first, each under
  "Files with a checked connection to {committee}", separate from files naming the person.
  The latter heading says candidate only for a candidacy or a Person with held candidacy;
  Legislator says "TV station files that name this legislator". A file may appear in both
  source groups; the server's unique-file total counts it once. Organization files need
  no extra group heading. A matching name alone never establishes a connection. With none:
  "No TV station files have a checked connection to {name}"; a failed read says "We
  couldn’t load these TV station files" with Try again. The card is absent while the TV
  station file page is off.

Campaign money's Sort by control reads the whole register in name order or numeric
registration-number order; a choice resets the page and remains in the address.

### List copies and changed records

People, Vendors, Money connections, identity lists, Similar names and station-file lists
keep one server version for later pages of the same filtered list. A source change refuses
the next page: the previous results stay visible with “These records changed.
Reload the list. Previous results are shown.” Try again reloads page 1 without
combining old and new records. A filter change starts its own version. A normal
read failure keeps previous results with a notice and retry; an access refusal
clears held results and checks the account's access again.

Identity record replies separately name `history_identities` for withdrawn
confirmations under the exact printed spelling. Those owners are read for History
only; they do not become current confirmations or merge choices.

Committee's outgoing complete-year payment reads separately pin the first page's payment
and register version for all later pages. A changed version or failed page never produces a
partial year total; a previous complete year stays labelled with its own scope and retry.
An access refusal clears it. Source-version checks do not replace the separate file-copy
checks used by Payments under this name and identity record lists.
