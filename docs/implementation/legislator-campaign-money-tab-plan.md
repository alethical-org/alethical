# Legislator Campaign money tab delivery

This is the delivery checkpoint for [issue 2140](https://github.com/alethical-org/alethical/issues/2140),
updated 12 September 2026. The redesign and official-only spending cards are live.
The accepted work includes the profile, outside spending, spending-card correction,
historical totals and payments grouped by name, each with a pull request and live check.

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
- [x] Scope that date to payment files. Report totals are copied separately; the
  payment-file date never dates report coverage checks or the register. Carry the same
  wording through the profile, committee views and first served response.
- [x] Test real Abeler records for 2025, 2026, 2021 and 2024 at phone, tablet and desktop
  widths. Check keyboard tabs, sorting, row expansion, real committee links and the
  browser's accessibility tree. Repair the phone money-column overlap.
- [x] Finish the accepted type sizes and repeat affected visual checks. Keep all year
  buttons inside the phone width rather than clipped by an ancestor.
- [x] Load the donation browser when the Campaign money tab opens. Separate the shared
  year control and color map so committee pages do not pull the entire profile into the
  first download. The production-build check passes at 390,330 bytes against its
  392,321-byte allowance, including its existing 542-byte hosted-settings allowance.
- [x] Save the change as [pull request 2153](https://github.com/alethical-org/alethical/pull/2153) with the reader-guide updates. Run the
  full frontend checks, production build and current-head GitHub checks.
- [x] Resolve the recorded drawing/brief disagreements before publishing the affected
  pieces. The [chart and amount-format questions](https://github.com/alethical-org/alethical/issues/2140#issuecomment-5646690898)
  were approved on 12 September 2026: chart categories match donor tabs, with candidate
  committees in Committees & Funds, and the existing whole-dollar formatter remains.
- [x] Merge through the queue after the answers are implemented and check the live profile.
- [ ] Remove the completed build branches and worktrees after the remaining deliveries.

The complete frontend suite passed 2,550 tests after integrating the approved spending
and source-date wording, and the backend suite passed 2,451 tests. Type checking, package compatibility,
the production build and the check against
adding a person's committees together also passed. Current-head GitHub checks belong in
the pull request's validation record. The final singular-count correction passed its
24 focused checks and the complete required checks on the current head and combined
merge commit. Both production deployments succeeded for
[commit c72997ae](https://github.com/alethical-org/alethical/commit/c72997ae5f5d6d43778cea766d35f5fb67412223).
An independent live browser check passed the chart controls, registered committee
link, 2024 singular count, 2021 absent spending amount, source-date sentence and
375-pixel layout.

## Final palette

The 12 September ruling replaces the earlier palette and any texture proposal.
The donut, its legend and the named-donation history use one shared colour map:
Individuals `#149d5b`, Lobbyists `#1f8fe6`, Committees & Funds `#7c3aed`,
Party Units `#e56b12`, Other kinds `#d6336c`, Non-itemized contributions `#899087`.
Only categories present in the source produce slices; changing colours never adds
records or separates candidate committees from Committees & Funds.

Slices are solid with a 3-unit white gap in the donut's 180-unit drawing box.
History segments have 2-pixel white gaps. Legend markers are borderless 14-pixel
squares with 3-pixel corners. Tertiary text is `#6b716b`; links are `#0f7a45`,
hover borders `#28bf71` and focus outlines `#7c5cff`. Search-field focus keeps the
site's `#5b30d6`. The six slice colours' lowest contrast against white is 3.259:1,
which rounds to the brief's 3.26:1. The palette tests cover all kinds and all 12 years.

## Separate approved changes

- [x] [Issue 2151](https://github.com/alethical-org/alethical/issues/2151):
  [pull request 2155](https://github.com/alethical-org/alethical/pull/2155) is live and
  supersedes the named-payment card figure shipped by
  [pull request 2154](https://github.com/alethical-org/alethical/pull/2154).
  Missing official totals print only the approved absence sentence; calculated sums
  remain beside payment rows. Official zero remains visible with its own explanation.
  The correction is integrated into the released profile redesign.
- [ ] [Issue 2142](https://github.com/alethical-org/alethical/issues/2142): replace
  the full filings copy through the existing loader for 2022–2026 and the intact saved
  directory of 1,603 filers. No separate protected historical store. Preserve the
  missing-record and coverage-end guards. Bind both comparison checks to both current
  source copies before publication, then rerun each independently for all 5 years.
  Official totals remain visible under structural checks; the PDF checks govern only
  the derived split and spending comparison. Carry known receipt dates forward before
  the previous generation is removed. Refresh only filing-source dates, not bulk-payment
  dates. [Pull request 2156](https://github.com/alethical-org/alethical/pull/2156)
  carries the safeguards and merged as
  [commit 4f9d589e](https://github.com/alethical-org/alethical/commit/4f9d589eecc00fb12e0c70dd834422d13990d195).
  All deployment and recovery gates passed. The 8-filer source rehearsal made 32
  Board requests in 19.4 seconds and preserved all 5 amendment test figures. The
  full 1,603-filer fetch is running, targeting 6,412 filer requests. Both report
  checks and exact-version receipt-date carry-forward follow publication.
- [x] [Issue 2141](https://github.com/alethical-org/alethical/issues/2141): finish the
  accepted payments-under-one-name view, grouped by year and filing committee, including
  source-backed filer kinds and continued groups when another page of payments loads.
  [Pull request 2158](https://github.com/alethical-org/alethical/pull/2158) is live at
  [commit 536f92a8](https://github.com/alethical-org/alethical/commit/536f92a83e0ff53aa49a90790664fc7e4bea9866).
  After integrating current main, 2,478 frontend and 2,455 backend tests passed;
  the combined merge-queue checks and both production deployments also passed.
  Missing registration numbers never produce a guessed distinct-filer count or
  subtotal. All 29 live Nystrom source rows match the saved real-row fixture.
  An independent browser read checked Nystrom, 500 Facebook vendor payments and
  all 854 Facebook independent payments, including completed pagination, served
  and absent filer kinds, keyboard links and all 3 layout bands. Header links open
  the full committee record without a selected-year query, as accepted.

The original payment-page help paragraph was kept unchanged under E's fixed-copy
instruction. A proposed replacement describing group-name links and group subtotals
is awaiting Eugene's answer; its wording is not changed without that answer.

Direct peer consultation is permitted only for a new disagreement with the revised
corrections, and only in the existing Claude conversation “candidate donor profile”.
The revised corrections currently have no outstanding disagreement.

## Final record

- [ ] Comment on [issue 2140](https://github.com/alethical-org/alethical/issues/2140)
  with every pull request, live result, held portion and finding for the architecture owner.
- [ ] Leave [campaign-finance-system-design.md](../architecture/campaign-finance-system-design.md)
  unchanged in this task; its owner receives findings through issue 2140.
- [ ] After all changes are live, give Eugene 1 complete prompt for Claude to review
  the approved decisions, implementation, checks, live results and remaining limits.

No paid run, real user message or destructive production change is authorized by this plan.
