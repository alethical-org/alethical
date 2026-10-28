# Alethical Finance app guide

<!-- describes: apps/finance/** -->

**Net:** Alethical Finance is the sign-in-only research site for law firms and their
political committees. Today its public address, https://finance.alethical.com, serves only
the landing page and sign-in; every other address says the page cannot be found. Behind a
build setting, the same app checks a signed-in account against Finance's access list and
shows Finance Home and every signed-in page built so far from Design's approved drawings; a
page not built yet answers exactly like an unknown address.

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
- **Request a demo** (in the hero and again near the end) opens a draft email to
  angel@alethical.com, copied to ask@alethical.com, with the subject "Alethical Finance demo".
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
  visitor back to alethical.com, and email once the server's code route ships
  (`VITE_EMAIL_SIGN_IN`). With neither on, the page says "Sign-in to Alethical Finance is
  not open yet."
- **`/auth/return`.** Where Google, and a first-time address's emailed confirmation link,
  bring the visitor back, to the Finance page they asked for. A failed Google sign-in returns
  to `/sign-in` with "Google didn’t finish. Try again, or use email." An emailed link carries
  its 1-use token after `#`, so it never reaches a web server; the page removes it from the
  address bar at once and uses it only when the visitor presses Continue under "Finish
  signing in", because mail filters that open links would otherwise use it up first. A used
  or expired link says so and offers sign-in again.

## Sign-in by emailed code

1. **Email:** the visitor types an address and presses Continue. An empty or malformed
   address shows "Enter an email address".
2. The app asks the server for a code (`POST /api/v1/finance/sign-in/code`). The server
   answers every address the same way and emails a code only to a listed one, so the next
   screen says "If {address} has access to Alethical Finance, a code is on its way to it",
   never that a code was sent. That route is not live yet: its release waits on a decision
   about how codes are sent ([#2755](https://github.com/alethical-org/alethical/pull/2755)),
   so until then the code screen cannot be reached.
3. **Code:** the visitor pastes the code; the app accepts any length the email carries.
   A wrong or expired code shows "That code is wrong or expired. Enter the newest code or send
   a new one." Send a new code waits 60 seconds between requests and shows the seconds left.
   Use another email goes back with the address kept. After a correct code, Continue stays
   busy until the access answer arrives; if access cannot be checked, the page offers Try
   again.

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
- **Finance Home (`/home`)**: "Research public records" with the search field; under
  "Browse records", entrances into each built directory (Legislators, Candidates, Lobbyists,
  Committees and funds, Party units, Vendors and payees, Lobbying organizations) and the
  actions Explore money connections, Confirm identities and Donors by employer, as printed,
  each shown once its page is built; a card per built record family; and "Sources and
  updates" naming each family's source with its copy or update date, read from the landing
  counts, below the first screen.
- **Not listed:** "This account doesn’t have access to Alethical Finance", the signed-in
  address, Switch account and Contact us (an email to ask@alethical.com). The page never
  says why, because the server never says.
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
Built so far: `/`, `/home`, `/sign-in` and `/auth/return`; every other address answers "We
couldn’t find that page" until its screen is built (`BUILT` in `apps/finance/src/routes.ts`).
Every link is built from these patterns (`hrefFor`), is a real link that opens in a new tab and
copies, and works with Back and Forward. While the screens are off, only `/`, `/sign-in` and
`/auth/return` answer (§ The public site).

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
