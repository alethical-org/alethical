# Legislator Campaign money tab delivery

This is the delivery checkpoint for [issue 2140](https://github.com/alethical-org/alethical/issues/2140),
updated 12 September 2026. The redesign is a local preview, not the published profile.
The accepted work is 4 separate changes, each with its own pull request and live check.

## Completed server change

- [x] Group outside spending by spender and direction without changing raw payment rows.
- [x] Pin grouped and expanded records to the same published copy.
- [x] Test grouped counts and amounts against raw rows, pass the required checks,
  and check the production response.

This change is live in [pull request 2152](https://github.com/alethical-org/alethical/pull/2152),
covering [issue 2143](https://github.com/alethical-org/alethical/issues/2143).

## Profile redesign sequence

- [x] Read the accepted drawing, its build facts, the existing display rules and both
  complete reader guides before changing the profile.
- [x] Load complete lists before presenting their counts, totals or chart. Filter
  donation lists to Contribution records. Preserve every payment and exact printed name.
- [x] Add searchable, sortable, expandable categories, the donor-kind chart and a
  separate history for each committee. Keep a committee's money separate from every other
  committee and from outside spending.
- [x] Add grouped outside spending with complete expanded payments from the same copy.
- [x] Keep category and sort choices across a year change. Reset search, expanded rows,
  show-more and the open sort menu.
- [x] Preserve whole-tab loading, failure and expired-confirmation behavior. Withhold
  outside spending independently when its committee confirmation expires.
- [x] Print a shared download date only when displayed records support the same date;
  otherwise provide an explanation and a refresh control.
- [x] Test real Abeler records for 2025, 2026, 2021 and 2024 at phone, tablet and desktop
  widths. Check keyboard tabs, sorting, row expansion, real committee links and the
  browser's accessibility tree. Repair the phone money-column overlap.
- [x] Finish the accepted type sizes and repeat affected visual checks. Keep all year
  buttons inside the phone width rather than clipped by an ancestor.
- [x] Load the donation browser when the Campaign money tab opens. Separate the shared
  year control and color map so committee pages do not pull the entire profile into the
  first download. The production-build check passes at 390,440 bytes against its
  392,321-byte allowance, including its existing 542-byte hosted-settings allowance.
- [ ] Save the change as a draft pull request with the reader-guide updates. Run the
  full frontend checks, production build and current-head GitHub checks.
- [ ] Resolve the recorded drawing/brief disagreements before publishing the affected
  pieces. The [chart and amount-format questions](https://github.com/alethical-org/alethical/issues/2140#issuecomment-5646690898)
  remain open; a preview is not approval of either choice.
- [ ] Merge through the queue after the answers are implemented, check the live profile,
  and remove this task's branch and worktree.

The complete frontend suite passed 2,516 tests after the final type-size and download
changes. Type checking, package compatibility, the production build and the check against
adding a person's committees together also passed. Current-head GitHub checks belong in
the pull request's validation record.

## Separate held changes

- [ ] [Issue 2151](https://github.com/alethical-org/alethical/issues/2151): the existing
  Expenditures wording conflicts with the accepted request. Keep that piece held at the
  [wording decision](https://github.com/alethical-org/alethical/issues/2140#issuecomment-5646640387),
  then implement and test it in its own pull request.
- [ ] [Issue 2142](https://github.com/alethical-org/alethical/issues/2142): the historical
  loader replaces the held totals and the current filer directory differs from the held
  directory. No historical production write has run. Resume only after the
  [historical-load decision](https://github.com/alethical-org/alethical/issues/2140#issuecomment-5646646652),
  with preservation and rollback tests before publishing checked 2022 and 2023 records.

## Final record

- [ ] Comment on [issue 2140](https://github.com/alethical-org/alethical/issues/2140)
  with every pull request, live result, held portion and finding for the architecture owner.
- [ ] Leave [campaign-finance-system-design.md](../architecture/campaign-finance-system-design.md)
  unchanged in this task; its owner receives findings through issue 2140.

No paid run, real user message or destructive production change is authorized by this plan.
