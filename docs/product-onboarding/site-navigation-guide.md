<!-- describes: apps/frontend/src/navigation/ia.ts, apps/frontend/src/navigation/webRoutes.ts, apps/frontend/src/theme/primitives.tsx, apps/frontend/src/components/auth/AccountControl.tsx -->

# How the top bar works (plain English)

**Net:** Every page carries the same bar: **Search ▾ · Read · About ▾**, then **Sign in**, or
your account control once you are signed in. The bar is drawn from one typed list of pages
(`apps/frontend/src/navigation/ia.ts`), so a page is in the bar because that list says so, and
addresses are resolved by one router (`apps/frontend/src/navigation/webRoutes.ts`).

## What is in the bar

- **Search ▾** opens a dropdown of 4 live rows, each with a one-line description: **Bills**
  (`/bills`), **Money in politics** (`/money`, with a small green NEW chip), **Legislators**
  (`/legislators`), and **Find My Legislator** (`/find-my-legislator`).
- **Read** is a plain link, not a dropdown. It opens the `/read` page, which lists Alethical's
  own research and guides, and it carries the green NEW chip while the section is new.
- **About ▾** opens **About Us** (`/about`), **Site Metrics** (`/site-metrics`), and
  **Contact Us** (`/about/contact`).
- **Sign in** is the one primary button when you are signed out. Pressing it opens the sign-in
  dialog over the page you are on (`docs/product-onboarding/sign-in-guide.md`); there is no
  sign-in page to route to.
- **The account control replaces Sign in once you are in**: an avatar with your first name on a
  desktop-width browser, an avatar that opens a sheet on a phone. It holds a **Tracked Bills**
  row, with the count of bills you track, leading to `/tracked`, and **Sign out**.

## The greyed "ON THE ROADMAP" group

Under Search's live rows sits a muted group of pills that cannot be pressed: **Candidates ·
Claimed Profiles · News · Ask AI**. They name work that is planned, not built, and a pill never
leads anywhere. Only Search carries this group. Every other planned page in the list stays
declared but unshown, so a roadmap pill may only stand in for a menu a reader can open.

## What is deliberately not in the bar

- **No Ask entry.** The bar and the phone drawer are Ask-free on every page. Ask is reached from
  the Home hero and from actions on bill pages, profiles, and answers
  (`docs/product-onboarding/grounded-ask-spec.md`). The grey **Ask AI** roadmap pill is the one
  place the words "Ask AI" appear, because it names a separate future capability; the shipped
  feature is **Grounded Ask**, and the verb is **Ask** (`docs/design/ui-copy-guide.md`).
- **No personal group.** Tracking lives behind the account control, so the bar shows the same
  3 groups whether or not you are signed in.

## On a phone

Below 768 pixels wide the dropdowns become a drawer opened from the bar. Search's and About's
rows sit under their group headings, Read is a single row, the roadmap pills appear below in a
larger touch size, and the account row sits in the drawer's footer and opens the phone sheet.
Every row is at least 44 pixels tall, and nothing depends on hovering.

## Addresses that forward

A page IS its address, and old addresses keep working:

- `/search`, with any filters in the address, opens `/bills` with the same filters applied.
- `/reports` and `/reading` open `/read`.
- `/chat`, `/chat/new`, `/chat/sessions/{id}`, and `/account` open Home; those screens have no
  shipped page (`.claude/rules/grounded-answers.md` rule 8).
- `/tracked` is a real page: signed in, your tracked bills; signed out, a card inviting you to
  sign in, never a bounce to Home.
- An address that is not a page shows the missing-page screen
  (`docs/product-onboarding/sharing-guide.md`, "What search engines get").

## Look and feel

The bar follows the site's visual rules in `docs/design/design-principles.md`; exact colours,
sizes, and spacing live in code (`apps/frontend/src/theme/tokens.ts`), never in a document.
