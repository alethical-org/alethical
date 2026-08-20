# How the Home screen works

<!-- describes: apps/frontend/src/screens/redesign/HomeSignedOutScreen.tsx, apps/frontend/src/components/home/*.tsx, apps/frontend/src/hooks/useAppQueries.ts, apps/frontend/src/hooks/useTrackedBillsLastVisit.ts, apps/frontend/src/lib/homepage.ts, apps/frontend/src/lib/sessionWatch.ts, apps/frontend/src/lib/trackedBillsLastVisit.ts, apps/frontend/src/theme/pageBackground.ts, scripts/check_home_hero_card_literals.py, .github/workflows/home-hero-card-facts.yml -->

The Home screen gives a new reader 3 clear ways into Alethical: search the public
record, open a current bill, or find the legislators for a Minnesota address. It
does not offer a free-form question box because reader-written questions are not a
live feature.

## The opening section

- **Search Bills** opens the default bill search page.
- **Search Legislators** opens the legislator directory.
- **The campaign-money card** is the right-hand half of the opening section for a
  signed-out reader, and its own band below the hero for a signed-in one. A
  signed-in reader's right-hand slot already holds their tracked bills, and a
  pitch must not take that away. On a phone it is the third item in the search
  cluster, because its own action is a third search.
- The card's count is read live from the register on every load. If the register
  does not answer, the whole line disappears: never a zero, never a dash, never a
  remembered number. While it loads, a grey bar stands in its place.
- The count says "registered campaigns, parties, and funds" and counts campaign
  filers only. Lobbying is a separate register we do not hold, so the word
  "registered" is what stops the number reading as the size of both.
- The card never says an entry is tied to the filing it came from. The published
  rows carry no reference to the report they were filed on, so that link cannot be
  built. It says the figures are read from the filings instead, and
  `src/components/home/__tests__/moneyPromoCopy.test.ts` fails if that sentence
  drifts back.
- The tracked-bills card is titled **Legislative session watch**. The longer name
  is deliberate: sitting next to the account menu, "Session" alone reads as a
  login session.
- The example answer card shows what a cited answer looks like. It is an editorial
  example about HF 4138, not a generated answer or a promise that a reader can ask
  any question from Home. It sits in its own section below the hero, headed "What
  an answer looks like", with the sample question as body text under that heading.
  The question is deliberately not a heading: as one, screen-reader heading
  navigation announced a single bill as a section of the homepage with nothing
  marking it as an example.
- The headline reads "Grounded answers on Minnesota politics". It said "on Minnesota
  law" until the money section was added to the page; "politics" is the wider word
  because the page now covers campaign money as well as legislation. The headline is
  written in 4 places and all 4 must match: both hero layouts in
  `HomeSignedOutScreen.tsx`, `homePageSnapshot()` in `lib/pageSnapshot.ts`, and the
  pre-rendered copy baked into `public/index.html` that a crawler reads before any
  JavaScript runs. A test pins the last one against the first three.
- The supporting sentence names what the record covers — bills, where they stand,
  how legislators voted, and the money: who gives, who spends, who gets paid, and
  who lobbies — and says every claim links to the official record. It does not
  promise that every question can be answered.
- The money half of that sentence runs ahead of what a reader can reach today, and
  that is deliberate rather than an oversight. Minnesota publishes lobbyist and
  lobbying-entity registration, the lobbyist-to-client relationships, and principal
  expenditures, and loading them is a named item on the campaign-money plan
  (`docs/product-onboarding/campaign-finance-roadmap.md`, "8. Lobbying"). The money
  section carries its own under-construction notice, so a reader is told where the
  gap is.

The example answer card keeps 1 divider, a linked bill code, the signed and effective
dates, the chief author, both chamber vote totals, a plain-language summary, up to 3
cited passages, and 1 link to the bill page. Amber marks bill identity, green marks
links and verified citations, and purple is reserved for cited locations and focus.

The card's wording is editorial, but every stated bill fact must stay true. The free
check in `scripts/check_home_hero_card_literals.py` compares the card with Alethical's
published record every month and whenever the card or check changes
(`.github/workflows/home-hero-card-facts.yml`).

## When the tracked-bills check fails

The signed-in hero asks once whether any tracked bill moved, and that request does
not try again on its own. Before this state existed, one failure left the hero
saying "Checking your tracked bills…" with a spinner forever, which looks exactly
like a slow load and never resolves.

- The card now says **"We couldn’t check your tracked bills"**, with a **Try
  again** button, and the hero headline reads "We couldn’t check your tracked
  bills just now". "Just now" is deliberate: it says this attempt failed, not that
  something is wrong with the reader's account.
- The wording says plainly that nothing was lost. Their bills are still tracked;
  the list of what moved is the part we could not reach.
- It uses amber, not red, and the same amber as the bill-code badge. Nothing is
  broken for the reader, so an error colour would overstate it.
- The "All tracked bills" link is hidden in this state, because we cannot say what
  is in that list right now.
- This is a separate state from the waiting one, not a variant of it. Waiting says
  we are working and fixes itself; this says we stopped and nothing else will
  start again.

## Bill activity

The activity lists come from the current Legislature's records. They are not chosen
by hand.

- **Recently Passed** includes enacted bills, ordered by their latest action. Web
  shows 2 and phone shows 1.
- **Recently Introduced** is ordered by introduction date. Web shows 3 and phone
  shows 1.
- A card uses **Updated {date}** when its newest action would only repeat the status.
  Otherwise it uses **Latest action: {action} · {date}**.
- **See more** and **See all** open the default bill search page with no hidden
  filter or scroll target.

The mobile **In the News** list is different. An editor chooses its bill ids and
their order (`IN_THE_NEWS` in `HomeSignedOutScreen.tsx`), while each card's title,
status, date, and summary still come from that bill's real record. The current pins
are HF 4138 and SF 856. The first replaced a design placeholder that named the wrong
bill.

## Signed-in opening section

Signing in changes only the opening section. The rest of Home stays the same.

- A reader with tracked bills sees what changed since the last visit to the tracked
  list.
- Reading the Home card does not mark those changes as seen. Opening the tracked list
  does.
- A reader tracking nothing gets a link to the bill activity already on Home, not a
  dead end.

## Small screens

Phone Home is an intentional one-column layout, not a squeezed desktop page. Its
order is opening section, In the News, bill activity, Find My Legislator, and footer.
The old account promotion remains removed until sign-in leads to a useful signed-in
destination.

The black dotted texture behind the opening section is absent below 768px and present
at 768px or wider. The green dotted texture behind Find My Legislator remains at every
width. The page keeps enough space while records load so later sections do not jump.

## Lasting source of truth

This guide owns Home's product behavior. The shared visual rules live in
[`design-principles.md`](../design/design-principles.md), and the exact implemented
values live in `apps/frontend/src/theme/tokens.ts` and
`apps/frontend/src/screens/redesign/HomeSignedOutScreen.tsx`. Design previews are
temporary working files and are not permanent product records.
