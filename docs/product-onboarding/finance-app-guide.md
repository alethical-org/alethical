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
- **Request access** (in the hero and again near the end) opens a draft email to
  angel@alethical.com, copied to ask@alethical.com, with the subject "Alethical Finance access".
  Nothing is sent until the reader sends it.
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
- **`/sign-in`.** Google, or a code emailed to the address. There is no password and no way
  to create an account. Each way is shown only once it works: Google once Supabase accepts
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
  ALETHICAL | Finance lockup (a link to Finance Home), the record families (Money, Lobbying,
  People, Legislation, Media buys; a family whose page is not built yet is left out, never
  linked to a missing page), a search field with suggestions, and the Account menu with the
  signed-in address and Sign out. The current family is underlined. On a tablet the search
  field opens as a row under the bar from a search button; on a phone the families, the
  signed-in address and Sign out sit in a Menu. Escape or a press outside closes each menu.
  Sign out also forgets every answer and scroll position this browser held for the account.
- **Search suggestions** (the header field and Home's field): from 2 typed characters, 1
  request per pause in typing to `GET /api/v1/finance/suggestions`; an answer for an earlier
  query is dropped by its request id. Up to 3 rows each under People, Organizations,
  Committees, Bills and Payments under a name, each opening its page; a match whose page is
  not built yet is left out. "Searching…", "No matching suggestions" with "Try another name or
  bill number", and "Suggestions couldn’t load" are the panel's other states, each announced
  to screen readers. Arrow keys move through the rows and View all results, Enter opens the
  chosen row, Escape closes the panel; pressing Search opens `/search` with the typed words.
- **Finance Home (`/home`)**: "Research public records" with the search field, and the 1
  header-corner action "Explore money connections" (a filled button beside the eyebrow and
  heading, dropping under the heading on a tablet or phone), shown once Money connections is
  built; under "Browse records", entrances into each built directory (Legislators,
  Candidates, Lobbyists, Committees and funds, Party units, Vendors and payees, Lobbying
  organizations), each shown once its page is built; a card per built record family; and
  "Sources and updates" naming each family's source with its copy or update date, read from
  the landing counts, below the first screen. Confirm identities, Check TV station files and
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
  3 earlier pages are kept. In-page choices (tab, year, sort, page, search) are kept in the
  address, so a copied link or a new tab opens the same view.

## Addresses

The addresses follow Design's system map (decision D20), with the station-file pages under
Media buys: `/` (landing), `/home`, `/search`, `/organizations/:id`, `/money`,
`/money/recipients`, `/money/connections`, `/money/identities`, `/money/employers`,
`/money/employers/:name`, `/money/committees/:id`, `/money/names/:query`, `/money/races/:id`,
`/legislature/committees/:id/members`, `/lobbying`, `/lobbying/lobbyists/:id`,
`/lobbying/principals/:id`, `/media-buys`, `/media-buys/folders/:id`, `/media-buys/files/:key`,
`/media-buys/agencies/:name`, `/media-buys/stations/:id`, `/media-buys/check`, `/people`,
`/people/:id`, `/candidates/:id`, `/legislators/:id`, `/bills`, `/bills/:id`, `/votes/:id`.
Built: `/`, `/home`, `/sign-in`, `/auth/return`, `/search`, `/people`, `/people/:id`,
`/candidates/:id`,
`/legislators/:id`, `/money`, `/money/committees/:id`, `/money/names/:query`,
`/money/races/:id`, `/money/recipients`, `/money/employers`, `/money/employers/:name`,
`/legislature/committees/:id/members`, `/lobbying`, `/lobbying/lobbyists/:id`,
`/lobbying/principals/:id`, `/organizations/:id`, `/bills`, `/bills/:id`, `/votes/:id`,
`/media-buys`, `/media-buys/folders/:id`, `/media-buys/files/:key`, `/media-buys/agencies/:name`,
`/media-buys/stations/:id` and `/media-buys/check` (§ Research pages and § Media buys). Every other address answers "We
couldn’t find that page" until its screen is built (`BUILT` in `apps/finance/src/routes.ts`).
Every link is built from these patterns (`hrefFor`), is a real link that opens in a new tab and
copies, and works with Back and Forward. While the screens are off, only `/`, `/sign-in` and
`/auth/return` answer (§ The public site).

## Research pages

Each page is built from its approved Design drawing and reads alethical.com's own records
through the shared API (`api.alethical.com`). Every page has a loading state, a failure with
Try again that never reads as an empty result, and a "no longer available" state for a record
the server does not hold. A page reached from another carries "Back to {page}" to exactly the
earlier view. Routine sources and copy dates sit in "Sources and updates" at the foot of the
page, below the first screen. Money figures follow
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
  searched by name and paged on the server, 10 a page. Record type is a row of choices;
  Candidates adds an Election year menu (including Past candidates) and Legislators a
  Service menu; All records has none, and switching type clears the other type's
  filters. Every choice stays in the address, so Finance Home's `?type=legislators&service=current`
  and `?type=candidates` open those views. A candidacy's row names its election and seat
  ("2026 general · State Representative, District 56A"), each fact once even where the
  official record names the district twice; its party waits on the server. A legislator's party prints only where the
  Legislature record holds it. Former service requires a held service end; missing current
  membership never establishes it. Record-type definitions sit under "About these records"
  below the results. District search and the party, office and chamber menus wait on the server.
- **Legislator profile (`/legislators/:id`)**: current or former service (a former legislator
  carries no current title, party, district or committees), each confirmed campaign account
  with its own year and figures (its link opens that report on the committee page),
  spending by outside groups by contest, committees (each opening its members' accounts),
  chief-authored bills, 20 a page, and related records as two-line links.
- **Candidate profile (`/candidates/:id`)**: the held candidacy facts, the election and its
  result, and confirmed related records. The office and district print once each, as on
  People. Campaign finance shows the accounts confirmed for
  the legislator record the candidacy is connected to; a candidacy connected to none shows
  "No campaign committee is confirmed for this candidacy". Media buys sits between
  Campaign finance and Election.
- **Campaign money (`/money`)**: the committee register by kind (Candidate committees,
  Committees and funds, Party units), searched by name and paged on the server, with each
  registration's status ("Open registration", "Terminated {date}"). Sort by chooses names
  A to Z or numeric registration-number order. Other ways in opens Vendors and payees,
  Donors by employer and Money by race; About these records states the records' limits. Results stay on
  screen while an update loads or fails, with Try again.
- **Committee (`/money/committees/:id`)**: the registration's status, the official report
  figures for the chosen report (beginning balance, total receipts, contributions, total
  expenditures and ending balance as filed; the report stays in the address), itemized
  contributions in 5 tabs by donor kind and itemized expenditures, each name grouped with its
  own records and a sum only when every amount is present ("Incomplete" otherwise), sorted by
  total, payment date, name or record count, disclosure statements inside payment rows,
  large-contribution notices, statements not linked to a payment, independent expenditures,
  Media buys and related records in the side column, and source evidence for each payment.
  Name links keep the selected year.
  Money received that is not a contribution is not shown yet; it waits for its own drawing.
- **Committee members' campaign accounts (`/legislature/committees/:id/members`)**: each
  member of a sitting legislative committee with their own confirmed accounts and that
  year's report figures, read 1 member at a time and never combined.
- **Payments under this name (`/money/names/:query?role=`)**: every payment record filed under
  1 exact printed spelling, as a payee (campaign spending and outside spending listed
  separately, never added together), a donor or an employer, read from Finance's own
  `/finance/payments-under-name`, 200 at a time with the server's count of every record in
  scope. Each record shows its date, amount, committee, "Confirmed as {identity}" when its own
  fingerprint is confirmed, and source evidence (the saved source, its copy, the row, the
  employer and ZIP as filed where held, and the whole source row as SOURCE TEXT, 1 "label:
  value" line per column in the file's order, a date as the page prints dates, an amount with
  2 decimals ("1250.50") and a blank cell as "Not given"; the Board's file is linked only when no excerpt is held). A file our copy
  cannot read shows "We could not read this part of our records just now" in its section,
  never the failure line. Each committee link opens the tab
  holding that record's kind, the record's own filing year and the printed name. A card lists
  every identity whose confirmations cover records of the spelling, each "Confirmed for {k} of
  {n} records" over the selected year and filer, with its reference where one is held, or "No
  confirmed identity for this spelling". An address naming a filer and a file (Organization's
  "View payments") shows only that file and that filer's records, counted on the server, under
  "Showing records filed by {committee}, {file}" with Clear all. Later pages are read from the
  same copy of the Board's file; if the file has changed, the page says "The Board’s file
  changed. Reload the records." and "Reload the records" starts over.
- **Donors by employer (`/money/employers`, `/money/employers/:name`)**: a search of the employer
  spellings donors printed (3 characters or more; shorter text opens that exact spelling), each
  with its donor names and any confirmed records, and for the chosen spelling the donors who
  printed it, each donor's payments listed apart with "Employer name as printed" on every row.
  On a computer the list stays beside the chosen spelling; on a tablet or phone the spelling
  opens on its own with "Back to Employer spellings". Later donors and payments come from the
  same copy of the Board's file; if it has changed, "The Board’s file changed. Reload the
  records." offers a reload. No total is ever added across donors, and a donor's payments are
  never the employer's money.
- **Money by race (`/money/races/:id?year=`)**: 1 contest's candidate committees, each with its
  own reported total and itemized contributions and their periods, and outside spending by
  spender as a chart (For to the right, Against to the left) or a table, never added across
  committees. Each spender's amount is shown only when every payment has an amount and a date,
  and its link opens that spender's own payment year. The address names the contest (`house-34b`,
  `senate-41`, `governor`). The contest line names the office by its title ("State
  Representative · District 34B · 2026", "State Senator", "Governor" and the other statewide
  offices); a court seat keeps its seat label ("District Court · District 2 · Seat 14").
  Media buys follows outside spending.
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
  confirmed-record count.
- **Person profile (`/people/:id`)**: confirmed links to 1
  person's candidacies, legislative service and lobbying, their campaign finance, political
  giving and payments received, each event with its own source line. A merged record's
  address opens the surviving record; a split record's address asks which person was meant.
  Each election names its office and district once. Opened with no earlier page, it returns to
  People.
- **Vendors and payees (`/money/recipients`)**: the server-paged directory of payees, searched
  by name, with All recipients, Confirmed vendors and Printed names, year, payment type and
  sort; each total under the shared rule ("Incomplete" under the amount heading, "Missing
  payment amount" on a phone row, "Reporting period incomplete", "Filing year" labels) and the
  source file under each kind. A printed name opens its payments in the payee role for the
  selected year. Where the server bounds totals, "Minimum amount ($)" and "Maximum amount ($)"
  narrow the whole set (each sent as the typed amount, "$" and commas stripped), with "Smallest
  total first"; text that is not an amount reads "Enter a valid amount", a reversed range
  "Minimum is more than maximum", and both keep the last valid results. Recipients whose
  totals are withheld are left out of a range and counted under the count line.
- **Not built yet:** Money connections (`/money/connections`) and Confirm identities
  (`/money/identities`) each have a screen in the code but answer "not found"
  and are linked from nowhere until the pull request that aligns that screen with Design's
  current drawing turns its route on in `BUILT`.
- **Legislation (`/bills`)**: bills searched by words or number, with Session, Chamber and
  Status menus, 20 a page. The Session menu lists the sessions the server holds, the
  current one first; with 1 session held it shows 1 option.
- **Bill (`/bills/:id`)**: the plain-language title, Summary (with passages from the bill
  text), Actions (each with its date and chamber), Votes, Bill Text and Versions, chief
  author and co-authors, companion bill, the committee (printed by name: the bill records
  carry no committee id, so it opens its members' campaign accounts only when an action
  names one), official page, and each author's
  confirmed campaign accounts, with "No confirmed campaign account" where none is
  confirmed. Opened with no earlier page, it returns to Legislation.
- **Roll call (`/votes/:id`)**: the exact motion, date, recorded result and each member's
  recorded vote, filtered and searched in place. The roll call is read by its own id, which
  names its bill; an older link that also carries `?bill=` still opens. Opened with no
  earlier page, it returns to the bill's Votes tab.

Reads queue so that at most 4 run at once (a finished read hands its place to the next), because the shared API serves only 12 requests at
a time across both sites; a "busy" answer is retried after the server's suggested wait. Only
Finance's own routes (`/api/v1/finance/…`) carry the account's token; public reads carry
none.

## Limits and privacy

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
- Finance accounts are Supabase accounts in alethical.com's sign-in project, so a Finance
  sign-in, and anyone who presses Google there, appears among alethical.com's accounts and
  sign-up figures.
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
  and years, or searched by words; a search lists matching TV station files. The tab,
  filters, words and page stay in the address. A capped count says "At least"; a failed
  refresh keeps the earlier rows with Try again. About these records states the coverage
  limits, and Sources and updates names the date the station files were copied.
- **TV station folder (`/media-buys/folders/:id`)**: the files held, each with its saved
  versions and station upload date, and the folder's one checked connection, which never
  stands for each file inside it.
- **TV station (`/media-buys/stations/:id`)**: files held by year, each year linking to its
  folders, and the other stations held. Counts are files, never ads or money.
- **Printed agency name (`/media-buys/agencies/:name`)**: files under that exact spelling,
  each marked Checked or Machine-read · Not checked, addresses checked for it with View
  evidence at the exact version and page, and separate campaign and outside-spending
  payment searches under the name, which do not prove a file was paid.
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
  Principal (by entity number) and Money by race (by the contest's office, district and
  year, matched against checked elections) list the TV station files with a checked
  connection to that record, each at its exact version with "Back to" the page, under
  "KSTP-TV, KARE and KMSP-TV station files, not in money totals". A candidacy lists its
  confirmed committees' files first, each under "Files with a checked connection to
  {committee}", then "TV station files that name this candidate", never mixed. With none:
  "No TV station files have a checked connection to {name}"; a failed read says "We
  couldn’t load these TV station files" with Try again. The card is absent while the TV
  station file page is off. Person, Legislator and Organization profiles do not show it
  yet: the server lists connected files only for a committee, candidacy, principal,
  election, race or printed name, and each of those profiles covers several such records.
  A row opens the file's first page, not the page the check cites.

Campaign money's Sort by control reads the whole register in name order or numeric
registration-number order; a choice resets the page and remains in the address.
