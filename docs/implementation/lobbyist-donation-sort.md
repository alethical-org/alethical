# Lobbyist donation sorting

## Authorization and scope

On 18 September 2026 Eugene said **“build”** after the proposal to add a year
selector, Name A–Z / Recorded donations highest first / Recorded donations lowest
first, and a selected-year amount on `/money/lobbying/lobbyists`. Each amount must
lead to its supporting donations on the lobbyist record. This is a scoped change
to the earlier prohibition on combined donation amounts and ranking. It does not
authorize client-spending rankings or any claim about political influence.

Delivery includes implementation, tests, browser review, pull request, release and
live checks. A missing drawing is not a dependency; reuse existing controls.

## Sequence

1. Establish usable annual coverage from the published records before choosing the
   default year. Owner: this task, with an independent read-only evidence review.
2. Implement the annual amount and whole-result sorting in the API, with tests for
   source identity, missing amounts, untrusted records and stable pagination.
3. Add the directory controls and donation-year links, including saved addresses,
   browser history, first-response content and mobile behavior.
4. Update the product guidance, review independently, run the required checks and
   drive the behavior in a browser.
5. Release through the merge queue and exercise the deployed behavior.

## Counting constraints

The campaign download can contain both original and amended donations, or omit
corrected rows. See
[campaign-finance-system-design.md, bulk-download amendment findings](../architecture/campaign-finance-system-design.md).
An unguarded sum must not ship. Removing identical rows is not a correction:
identical genuine donations occur too.

The implemented guard requires every recipient-year touched by a lobbyist's
donations to agree with that recipient's full-year filed report in the same
published contribution snapshot. A missing or failed comparison, missing amount,
missing recipient identity or payment outside the compared period withholds that
lobbyist's entire annual amount. The comparison must use the current filings snapshot, pass its self-test, end on
December 31 and match the direct itemized sum within $0.01. A partially pruned
contribution snapshot withholds every amount.

Match registration number, Lobbyist contributor kind and Contribution receipt
kind. Use the source's year. Preserve signed decimal amounts and repeated rows.
Include declared goods-and-services values, as the existing donation list does.
Do not subtract state political contribution refunds from donor payments.

No matching records is not $0. A missing amount is not $0. An unavailable source
is not an empty list. The default year must be completed and support comparison.
Any amount remains a sum of held matching records, never proof of complete giving.

## Release evidence

- Released on 18 September 2026 through [pull request 2293](https://github.com/alethical-org/alethical/pull/2293),
  closing [issue 2292](https://github.com/alethical-org/alethical/issues/2292).
  The initial public release serves [commit 06c3dcf7](https://github.com/alethical-org/alethical/commit/06c3dcf7e94d769641696dd93cc14163996e2598).
- Live read on 18 September 2026: the 1,665-person roster supports 136 amounts for
  2025, with 105 unavailable amounts and 1,424 people without matching records.
  For 2024 the corresponding counts are 131, 100 and 1,434. The default is 2025.
- Campaign copy date is 1 September 2026; lobbying copy date is 13 September 2026.
- API source guard, full-result ordering and pagination implemented; 51 focused
  backend tests passed, including source disagreement and partial pruning.
- Frontend controls, saved addresses, first-response amounts and supporting-year
  links implemented. 3,384 frontend tests and type checks pass. The production
  build passes its asset, icon and first-load size checks.
- Independent integration review found an empty-year sentence and a New Year
  timezone mismatch; both are corrected with regression tests.
- Desktop and phone browsing, both amount orders, search, pagination, Back and
  supporting-year links passed. Aafedt 2024 shows $2,500 matching 4 donation rows;
  2025 shows $2,000 matching 2 rows. Mobile source wrapping and select spacing
  corrected from the narrow-phone review. Source links fit within 320px, 390px
  and desktop viewports without horizontal overflow.
- Product guidance and source rules now carry the narrow directory exception.
- No production data changes are part of this build.
- The full backend suite passed 2,930 tests. Required checks passed on the final
  change and on the merge queue's combined revision.
- The [fallback release](https://github.com/alethical-org/alethical/actions/runs/35393979339)
  built the merged revision while Vercel reported a deployment outage. The build
  passed at 295,125 compressed program bytes against the 296,022-byte limit.
  Its automatic domain assignment stalled; the reviewed ready deployment was
  assigned to the existing production addresses with Vercel's alias command.
- Live API checks returned 131 supported amounts for 2024, correctly ordered in
  both directions. The highest amount was $11,450 and the lowest was $100.
- Live browser checks passed year selection, amount ordering, name search,
  supporting-year links, changing the donation year, and source-link wrapping at
  320px without horizontal overflow.

- Independent live reader review passed both amount orders, search, matching-year
  links and missing-amount labels. It found clipped sort-choice text at 320px.
  The shortened choices, “Donations: highest first” and “Donations: lowest first”,
  fit at 320px and 390px.
- The fallback workflow was cancelled after its completed deployment reached the
  public addresses, stopping the redundant wait for Vercel’s stalled automatic
  domain assignment. The apex address still redirects to `www.alethical.com`.

## Presentation refinement

Design drew the directory again as one results card. Eugene authorised the build on
18 September 2026 from `Alethical UX (24).zip` and its corrected handoff. The
refinement changes what the page looks like and never what it counts: no API,
schema, calculation or production-data change is part of it.

What moved. Year and Sort by leave the strip above the card and join the result
count in the card's header. The header arranges itself by band: 1 row on a
computer, count above controls on a tablet, everything stacked on a phone. The
amount limitation, supported-amount count, explanation control and campaign file
date move inside the same card, above the rows. The repeated order caption is
gone, because Sort by names the order 1 line away. Rows gain aligned name, client
count, amount and arrow columns above the phone band, a hover wash across the full
card width, and a bolder dollar figure beside a quieter year tail. Loading,
failure and both empty results now sit inside that same card under the same header.

Corrections the drawings do not carry. The real sort values stay `name`,
`donations_desc` and `donations_asc`. Every control stays available during loading
and after a failure; Year is disabled only when no year can be offered, and a year
already in the address is never blanked. A pending or failed read prints no count
and no supported-amount sentence, while a completed empty search prints its real
zero. “No matching donation records” and “Amount unavailable” stay apart and
neither becomes $0. Out-of-range routing, empty-page recovery and the pagination
rules are unchanged.

Two measured departures from the drawn values. The content column is 1000 wide as
drawn but starts at the shared header's own left edge rather than centred, because
the drawing's centred column came from its imitation header and the live header is
full width. The Year box is 164 wide rather than 128, sized to hold `Loading
years`, its own longest choice; at 128 the word `Unavailable` was cut off in a
browser.

Copy. Standalone single-sentence helpers lose their closing period, per
[ui-copy-guide.md](../design/ui-copy-guide.md): the registration date line, the
campaign file date, the supported-amount count and the field helper. The no-match
helper now uses a semicolon. The field helper and the no-match helper are shared
with `/money/lobbying/principals`, so both directories carry the corrected
punctuation.

Verification. Browser Back was measured rather than assumed: the address restored
all 4 values and the place in the list was lost, so the directory now uses the
shared `useHistoryScrollRestoration` hook, which the lobbying landing and record
pages already use. Search, clear, both amount orders, all supported years,
pagination, selected-year detail links, refresh, shared addresses, the disclosure,
keyboard reach and focus, loading, failure with retry, an empty search and an
empty numbered page were driven against production data. Widths checked: 1440,
1100, 1099, 900, 768, 767, 640, 390 and 320, with a long name, a 5-figure amount
and both missing-amount messages. Nothing clipped and nothing scrolled sideways.
The gap from the last content block to the footer measures 72 on a computer, 56 on
a tablet and 48 on a phone.

### Release evidence for the refinement

- Released on 18 September 2026 through [pull request 2299](https://github.com/alethical-org/alethical/pull/2299),
  serving [commit 6170fb59](https://github.com/alethical-org/alethical/commit/6170fb593f5fa728bd58cdc6303f098aa7b84f86).
  3,394 frontend tests, the type check and all 4 required checks passed.
- Live reads on https://www.alethical.com/money/lobbying/lobbyists: the card header
  prints the count as the results heading beside a 164-wide Year box and a 256-wide
  Sort by box; rows begin at x=85, 586, 756 and 1008 at 1440 and hold those column
  edges; no sideways scrolling at 1440 or 390; the stacked phone controls fill the
  card at 316 wide.
- Live behaviour: highest first leads with $14,600 for 2025 and $11,450 for 2024;
  lowest first leads with $100; the supported-amount count moves from 136 to 131
  with the year; a searched name reduces the count to 1 and the clear control
  restores the full list and the field's focus; the explanation opens in place with
  the Board's file link inside it; a row opens the record carrying the same year;
  and browser Back returns the year, the order and a 1,000-pixel scroll position.
- A lobbyist with no supported amount for the chosen year reads `Amount unavailable`
  rather than $0, which is the distinction the guard exists to keep.

### What an independent reader found afterwards

A reviewer with no knowledge of the code drove the page at 10 widths. Its 2 most
serious findings do not hold, and both were re-tested in a real browser rather than
dismissed:

- It reported that the explanation cannot be opened from the keyboard. Driven with
  Playwright, Enter opens the panel, Space closes it and focus stays on the control.
  The reviewer's tool delivered key events carrying an empty key name, which no
  browser treats as a press.
- It reported that browser Back loses the place in the list. Driven through the page
  the way a reader uses it, the place is restored exactly. It fails only for an
  address whose parameters were typed in an order the app does not produce, which is
  [issue 2303](https://github.com/alethical-org/alethical/issues/2303).

What it found that does hold is filed rather than fixed here:
[issue 2300](https://github.com/alethical-org/alethical/issues/2300) (the principals
field), [issue 2301](https://github.com/alethical-org/alethical/issues/2301) (the
pager's impossible page count and its 320-pixel wrap),
[issue 2302](https://github.com/alethical-org/alethical/issues/2302) (a name typed
first-name-first finds nobody), [issue 2303](https://github.com/alethical-org/alethical/issues/2303)
(Back and keyboard paging) and [issue 2304](https://github.com/alethical-org/alethical/issues/2304)
(4 wordings that can be misread).
