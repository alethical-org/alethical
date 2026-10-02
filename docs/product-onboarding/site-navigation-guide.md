<!-- describes: apps/frontend/src/navigation/ia.ts, apps/frontend/src/navigation/webRoutes.ts, apps/frontend/src/theme/primitives.tsx, apps/frontend/src/components/auth/AccountControl.tsx, apps/frontend/src/components/auth/AccountMenuIcon.tsx -->

# How the top bar works (plain English)

**Net:** Most pages carry the same bar: **Money · Search ▾ · Blog · About ▾**, then **Sign in**, or
your account control once you are signed in. The bar is drawn from one typed list of pages
(`apps/frontend/src/navigation/ia.ts`), so a page is in the bar because that list says so, and
addresses are resolved by one router (`apps/frontend/src/navigation/webRoutes.ts`).

The private `/comment-emails` screen is an exception: it carries only the linked
wordmark and the reader's email stop choices, without the normal bar or footer.
Readers reach it through a private email link, not the account menu. See
[editorial-comments-guide.md](editorial-comments-guide.md#stopping-emails).

The public `/services` presentation is also an exception. It has 1 dark header
with a home-linked wordmark, Services, Partners, Early work and Contact Us. It uses
the standard dark footer after Delivery and pricing. Other addresses keep the
shared navigation described here. See [services-guide.md](services-guide.md).

## What is in the bar

- **Money** is a plain link to `/money`, before Search. It uses the same direct-link
  treatment as Blog. Neither direct destination carries a NEW label.
- **Search ▾** opens a dropdown of 4 live rows, each with a one-line description: **Bills and votes**
  (`/bills`), **Legislators** (`/legislators`), **Find my candidates** (`/candidates`), and **Find my legislators** (`/find-my-legislator`).
  The candidate row says **See who is running for office in your area** on desktop; phone rows have no supporting descriptions.
- **Blog** is a plain link, not a dropdown. It opens the `/blog` page, which lists Alethical's
  own research, short posts and guides.
- **About ▾** opens **About us** (`/about`), **Campaign services** (`/services`), and
  **Contact us** (`/about/contact`).
  Each desktop row has its approved picture: people, a briefcase, and an envelope.
  The About dropdown fits its contents; neither dropdown has a pointer notch.
- **Sign in** is the account action when you are signed out. Every shared desktop bar
  uses a white outlined button; the drawer has its own full-width green button. Pressing it opens the sign-in
  dialog over the page you are on (`docs/product-onboarding/sign-in-guide.md`); there is no
  sign-in page to route to.
- **The account control replaces Sign in once you are in**: an avatar on a
  desktop-width browser. On phones the account entry in the drawer opens a sheet. It holds a **Tracked**
  row, with the combined count of bills and committees you follow, leading to `/tracked`,
  then **Add a password** or **Change password**, **Email preferences** leading to
  `/email-preferences`, and **Sign out**. Password actions appear when email/password
  sign-in is enabled; an account whose sign-in methods are not yet known says **Password**.
  Approved administrators see an **Admin** group between Email preferences and Sign out,
  with **User Accounts** (`/admin/users`), **Site Metrics** (`/admin/site-metrics`),
  **Operations** (`/admin/operations`), and **Candidate requests** (`/admin/candidate-claims`), in that order. These navigation labels
  do not authorize changes to report-page copy.
  Desktop and phone use this same order. The signed-in profile supplies
  the menu hint; older responses use a separate access check. Every private read
  still requires a fresh permission check.
  The private report contains combined measurements, not a reader activity list. Being
  excluded from traffic counts does not grant administrator access. See
  [How private account visibility works](admin-users-guide.md) and
  [How Site Metrics works](traffic-guide.md).

## Inside the account menu

The account menu uses matching outline pictures for Tracked, password, email, and sign out.
Every action label has the same bold weight and size within its layout band. Tablet
keeps its existing bottom sheet but uses the desktop action text size; phone action
text is larger. The desktop popover has room for longer labels.
The Admin group has 1 divider above its label and no divider between its 3 links.
Empty icon spaces keep its labels aligned with the ordinary actions.
The count uses Libre Franklin with equal-width digits, and expands to fit the full number.
It appears only after both the bill and committee lists have loaded and the total is positive.
The password dialog keeps its own larger lock and success check mark.

Hovering over a row gives it a light grey background. Keyboard focus has 1 purple outline
outside the whole row, following its corners. The scrolling menu leaves room around the
rows so their outlines are not cropped. The separate sign-out button also has room for its
outline outside its border. A mouse click or touch does not add a keyboard-only outline.
Phone password and Email preferences rows keep their right-pointing arrows.

While signing out, the button says **Signing out…**, keeps its picture and size, and accepts
no second request. Its text and picture become muted, and screen readers hear the busy state.
If signing out fails, plain red text appears above the same button, now labelled
**Try again**: “We couldn’t sign you out. Check your connection and try again.”
The message remains visible while retrying. Each failed attempt is announced again without
moving keyboard focus or briefly hiding the message. Closing and reopening clears the old
failure. A successful sign-out removes the signed-in controls.

On desktop, the menu measures its actual resting contents, including loaded counts
and password labels. The footer containing Sign out stays in place when an error appears;
the rows above it give up the needed room and scroll to their end. A small shade at the top
shows when rows have scrolled. No empty error space is held at rest. Rows keep at least 44px
of visible space; enlarged text can grow the menu rather than be clipped. If the screen cannot
fit that larger menu, the menu itself scrolls. Changing screen size recalculates the available room.

On phones and tablets, the bottom-anchored sheet grows upward for the message within the available screen. On short screens, Close
stays visible while the account actions scroll by the added height before the browser paints.
The scroll area owns side padding so the sign-out outline is not cropped. Its button
reserves space for the longest state label even when text wraps. Close uses the matching sign-in
panel's pointer-hover treatment and a keyboard-only focus outline.

## The name of `/money`

**Money in politics** is the destination name for `/money`. Use those exact words
in the signed-in homepage money card's button, the `/money` heading, browser
title and shared-link title, and every link or empty-state button returning to
`/money`, including campaign and lobbying pages. A browser title may append the
site name in the usual format.

**Money** is the shorter name in the shared website navigation only. Eugene approved
this scope on 30 Sep 2026: “move money in politics submenu (under Search menu) out into
its own "Money" section left of "Search" in nav on web”. Money opens `/money` directly
on desktop and in the phone drawer; it is not a dropdown and is not a Search child.
The order is Money, Search, Blog, About. This navigation exception does not rename
the `/money` page, its browser or shared title, or other return links. The signed-out
homepage button has its own approved wording, described next.

**Follow the money** remains the homepage money card's headline, an invitation rather
than a second destination name. The signed-in button beneath it says **Money in
politics**, without “Explore”. The signed-out homepage button says **Search the
money records**, approved on 30 Sep 2026. This exception applies only to that
homepage action and does not rename `/money` or its return links. **Campaign money**
remains the narrower name on legislator and
committee tabs that show campaign records rather than the whole `/money` section.

## The greyed "ON THE ROADMAP" group

Under Search's live rows sits a muted group of pills that cannot be pressed: **Claimed profiles · News · Ask AI**. They name work that is planned, not built, and a pill never
leads anywhere. “Claimed profiles” names the planned searchable directory at
`/search/claimed-profiles`; individual candidate-profile claims are already available
from `/candidates/<id>`. Only Search carries this group. Every other planned page in the list stays
declared but unshown, so a roadmap pill may only stand in for a menu a reader can open.

## What is deliberately not in the bar

- **No Ask entry.** The bar and the phone drawer are Ask-free on every page. Ask is reached from
  the Home hero and from actions on bill pages, profiles, and answers
  (`docs/product-onboarding/grounded-ask-spec.md`). The grey **Ask AI** roadmap pill is the one
  place the words "Ask AI" appear, because it names a separate future capability; the shipped
  feature is **Grounded Ask**, and the verb is **Ask** (`docs/design/ui-copy-guide.md`).
- **No personal group.** Tracking lives behind the account control, so the bar shows the same
  4 top-level destinations whether or not you are signed in.

## On a phone

Below 1100 pixels wide the dropdowns become a drawer opened from the bar.
Below 768px the drawer covers the whole screen and hides the underlying page and
its logo. The drawer has its own symbol and a full-size Close menu button.
Clicking or tapping anywhere above the first horizontal line, including the
symbol and blank space, closes the phone drawer. The X remains its keyboard
close control; closing restores focus to Open menu. This larger closing area
applies below 768px, without changing the tablet drawer or moving its links.
The phone bar has the wordmark and menu button; sign-in and account actions are
reachable inside the drawer. From 768px to 1099px the drawer is a fixed-width panel on
the right, with the underlying page dimmed. Both layouts scroll internally. Search's and About's
rows sit under their group headings; Money and Blog each have a direct top-level row.
Money comes before Search, and Blog follows Search. Both direct rows use the existing
Blog row's taller touch target, dividing lines and right-pointing arrow. The roadmap pills appear below in a
larger touch size, and the account card sits in the drawer's footer and opens the phone sheet.
The card has a pale background, a border, the account name and email, and an upward arrow.
The drawer header, scrolling links and fixed footer each own their padding;
short screens can scroll through every roadmap pill without moving the footer.
Every row is at least 44 pixels tall, and nothing depends on hovering.

## Addresses that forward

A page IS its address, and old addresses keep working:

- `/search`, with any filters in the address, opens `/bills` with the same filters applied.
- `/read`, `/reports`, `/money/reports` and `/reading` open `/blog` directly and permanently.
- Retired `/read` article, collection, topic and set addresses open their matching `/blog` address directly, keeping valid query choices and article anchors. Older article forwards also target `/blog` directly.
- `/chat`, `/chat/new`, `/chat/sessions/{id}`, and `/account` open Home; those screens have no
  shipped page (`.claude/rules/grounded-answers.md` rule 8).
- `/tracked` is a real page: signed in, your tracked bills; signed out, a card inviting you to
  sign in, never a bounce to Home.
- `/site-metrics` temporarily forwards (307) to `/admin/site-metrics`. Both addresses require administrator access.
- `/admin/metrics` opens Site Metrics at `/admin/site-metrics`; Operations is at `/admin/operations`.
- `/admin` opens `/admin/users`, the private account list for approved administrators.
- An address that is not a page shows the missing-page screen
  (`docs/product-onboarding/sharing-guide.md`, "What search engines get").

## Look and feel

Open dropdowns stay in front of the page content beneath them. Moving from Search
or About into its dropdown and between rows keeps the dropdown open and lets each
row receive the pointer. Page images and buttons must not cover or block the rows.
In short windows, the dropdown scrolls within the space above the screen's bottom
edge so every row remains reachable without moving the page behind it.

The bar follows the site's visual rules in `docs/design/design-principles.md`; exact colours,
sizes, and spacing live in code (`apps/frontend/src/theme/tokens.ts`), never in a document.

## Navigation design accepted 30 September 2026

Desktop links and the account control sit at the right edge, with the wordmark
at the left.
Money, Search, Blog and About keep their
existing order. The account avatar opens the same popover; signed-out readers use
the white outlined Sign in action throughout the shared bar. The drawer Sign in
action remains green regardless of the page underneath. Every wordmark remains a link to Home.

Search's Bills and votes row says “Read bill summaries, check their status, and see
how legislators voted”. Find my legislators retains “Enter your street address to
see who represents you”. About uses sentence case: About us, Campaign services and Contact us.
Opening Search or About turns only its upward arrow green; the word keeps its resting colour.

Find my candidates sits immediately before Find my legislators, with “See who is
running for office in your area” on desktop and a green NEW label on both surfaces.
The `/candidates` destination is public and accepts a full street address for the
supported Minnesota election. Official-source results link to public candidate
profiles. Claiming requires an existing account and independent staff review.
Illustrative records remain limited to an explicit development preview.

The account menu retains Tracked and its combined bill-and-committee count.
The handoff's Tracked Bills label and its claim that only bills can be followed
were outdated. Password wording still follows the account's actual sign-in methods.
Unknown administrator permission shows the ordinary menu until access is allowed.
Existing hover, keyboard-only focus, dismissal and sign-out failure behavior remain.
Escape closes a desktop navigation dropdown and returns focus to its trigger.
Opening Sign in from the drawer waits for the drawer to close and restore its
menu opener, so closing Sign in returns keyboard visitors to Open menu.
