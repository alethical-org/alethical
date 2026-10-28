# Alethical Finance app guide

<!-- describes: apps/finance/** -->

**Net:** Alethical Finance is the sign-in-only research site for law firms and their
political committees. Its web app opens with sign-in, checks the account against Finance's
access list, and then shows the navigation and an address for every page. The pages
themselves wait for Design's final drawings; until then each address shows its title and
says it is waiting for its design.

The settled decisions are in
[alethical-finance-architecture.md](../architecture/alethical-finance-architecture.md). The
app is its own React web app in `apps/finance`, not a mode of alethical.com's app.

## Ways in

- **Any Finance address.** A signed-out visitor is sent to `/sign-in`, which remembers the
  address so sign-in returns there. A return address is kept only when it is a Finance page;
  anything else, another site included, returns to Finance home.
- **`/sign-in`.** Google, or a code emailed to the address. There is no password and no way
  to create an account. Until Supabase accepts Finance's return address, the Google button is
  hidden (`VITE_GOOGLE_SIGN_IN` is `off`), because Google would otherwise hand the visitor
  back to alethical.com.
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
- **Listed account:** the navigation (Campaign money, Lobbying, People, Legislation, Media
  buys) and the Account menu, which shows the signed-in address and Sign out. The current
  section is marked in the navigation. Escape or a press outside closes the menu.
- **Not listed:** "This account doesn’t have access to Alethical Finance", the signed-in
  address, Switch account and Contact us (an email to ask@alethical.com). The page never
  says why, because the server never says.
- **Access cannot be checked:** "We couldn’t check your access" with Try again. A failed
  check never shows the no-access state.
- **Unknown address:** "We couldn’t find that page" inside the navigation.
- When the screen changes, keyboard focus moves to its heading; each sign-in step moves focus
  to its field.

## Addresses

The addresses follow Design's system map, with the station-file pages under Media buys:
`/`, `/search`, `/organizations/:id`, `/money`, `/money/recipients`, `/money/connections`,
`/money/committees/:id`, `/money/names/:query`, `/money/races/:id`, `/lobbying`,
`/lobbying/lobbyists/:id`, `/lobbying/principals/:id`, `/media-buys`,
`/media-buys/folders/:id`, `/media-buys/files/:id`, `/media-buys/agencies/:name`,
`/media-buys/stations/:id`, `/media-buys/review`, `/people`, `/people/:id`,
`/candidates/:id`, `/legislators/:id`, `/bills`, `/bills/:id`, `/votes/:id`. Every address
is a real link: it opens in a new tab, copies, and works with Back and Forward. The public
product landing page has no address yet, because the final domain is not chosen.

## Limits and privacy

- Finance never links to alethical.com; a CI test fails if any app file names an
  alethical.com page. Contact actions use email addresses, and data comes from
  `api.alethical.com`.
- Every page is marked not to be indexed (`noindex`), `robots.txt` disallows everything, and
  the server marks every Finance answer private and uncached.
- The sign-in session is kept in this browser under its own name, separate from
  alethical.com's. Sign out ends it in this browser only, and removes the saved session even
  when Supabase cannot be reached.
- Finance accounts are Supabase accounts in alethical.com's sign-in project, so a Finance
  sign-in, and anyone who presses Google there, appears among alethical.com's accounts and
  sign-up figures.
- The site runs at a Vercel preview address in the `alethical-finance` project until the
  final domain is chosen ([deployment.md § Alethical Finance](../operations/deployment.md#alethical-finance)).
