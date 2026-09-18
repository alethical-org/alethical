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

## Current checkpoint

- Branch: `codex/lobbyist-donation-sort`; tracking [issue 2292](https://github.com/alethical-org/alethical/issues/2292).
- Live read on 18 September 2026: the 1,665-person roster supports 136 amounts for
  2025, with 105 unavailable amounts and 1,424 people without matching records.
  For 2024 the corresponding counts are 131, 100 and 1,434. The default is 2025.
- Campaign copy date is 1 September 2026; lobbying copy date is 13 September 2026.
- API source guard, full-result ordering and pagination implemented; 51 focused
  backend tests passed, including source disagreement and partial pruning.
- Frontend controls, saved addresses, first-response amounts and supporting-year
  links implemented. 3,383 frontend tests and type checks pass. The production
  build passes its asset, icon and first-load size checks.
- Independent integration review found an empty-year sentence and a New Year
  timezone mismatch; both are corrected with regression tests.
- Desktop and phone user-flow review is in progress.
- Product guidance and source rules now carry the narrow directory exception.
- No production data changes are part of this build.
- Remaining: finish checks, independent browser review, PR, merge queue,
  deployment, live exercise and release evidence.
