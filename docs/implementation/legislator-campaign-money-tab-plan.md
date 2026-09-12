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

Direct peer consultation is permitted whenever useful, and only in the existing
Claude conversation “candidate donor profile”.
The revised corrections currently have no outstanding disagreement.

## Added refund card, F

Eugene added this delivery on 12 September 2026 and replaced its initial brief with
the 7-decision version. Implementation starts only after the import for
[issue 2147](https://github.com/alethical-org/alethical/issues/2147), currently
[pull request 2160](https://github.com/alethical-org/alethical/pull/2160), is merged
and its populated `refunds` response is live. This dependency does not pause the
historical filings refresh.

- [ ] Use the accepted `Alethical UX (4).zip` refund drawing, with Eugene's message
  taking precedence over its illustrative data and superseded wording.
- [ ] Render 1 all-years refund card directly below each confirmed committee's card,
  before outside spending. Preserve it when only the selected year has no figures;
  withhold it with unconfirmed, loading and failed whole-tab states.
- [ ] Keep source-backed reported, not-published, not-matched and unavailable states
  distinct. Show an unpublished year only between matched years; omit unmatched years.
  Never add a total or guess an identity, a count, a copy date or a source address.
- [ ] Use the exact accepted heading, explanation, table headings, notes and empty
  wording. Omit the drawing's extra registration line. Keep 3 table columns at phone
  width, an off-screen caption and proper column and year headers.
- [ ] Load a fixture from the live response for 17868 and test real 2025 and 2021
  figures, missing-value wording, the conditional gap and 2 separately placed cards.
- [ ] Update the profile reader guide and complete checks, release and live review.

Two source corrections await Eugene's answer: applying the between-matches rule omits
2016 from Abeler's card because no earlier Senate-committee row matches; the drawing's
2015 row is illustrative. The 2024 candidate file supplies $10,508.22 and no count;
the proposed count-cell wording is “Count not published”. This proposal leaves the
reported amount visible.

The import's reviewed response currently supplies file names and copy dates but no
stored program-page address or per-file married-couple-note flag. Those inputs must
be supplied from the import before the card can print the required source link and
conditional note. The card must not invent them from a filename or year.

## Final record

- [ ] Comment on [issue 2140](https://github.com/alethical-org/alethical/issues/2140)
  with every pull request, live result, held portion and finding for the architecture owner.
- [ ] Leave [campaign-finance-system-design.md](../architecture/campaign-finance-system-design.md)
  unchanged in this task; its owner receives findings through issue 2140.
- [ ] After all changes are live, give Eugene 1 complete prompt for Claude to review
  the approved decisions, implementation, checks, live results and remaining limits.

No paid run, real user message or destructive production change is authorized by this plan.

## Approved follow-on sequence

These jobs start only after A through F have merged, passed live checks and been
reported on [issue 2140](https://github.com/alethical-org/alethical/issues/2140).
The current task owns all 4, in this order, with 1 pull request per job, each from
its own worktree off current `origin/main`, through the merge queue and a live check.
Every pull request carries `Net:` and `Docs check:` lines. The campaign-finance
architecture record stays unchanged; proposed changes go on each job's issue.

- [ ] Job 1, [issue 2068](https://github.com/alethical-org/alethical/issues/2068):
  reduce the first payments read or warm it so a cold read fits its deadline.
  Any remaining read failure uses the existing load-failed state, never the empty
  donation sentence. Pin failed-read rendering and check MN DFL State Central's
  live committee page.
- [ ] Job 2: open a dedicated issue, then reuse B's contribution-kind chart,
  non-itemized slice, 5 fixed tabs, conditional Other tab and grouped outside
  spending on `/money/committees/<slug>`. Keep its Year, Track, Share and Filings
  controls. Its own committee needs no legislator-confirmation gate, and committees
  are never added together. Shared elements use shared words. Update the campaign
  money section reader guide and close the issue with this job's pull request.
- [ ] Job 3, [issue 2126](https://github.com/alethical-org/alethical/issues/2126),
  [issue 2070](https://github.com/alethical-org/alethical/issues/2070) and
  [issue 2012](https://github.com/alethical-org/alethical/issues/2012): record cold
  and warm production loads for the sample profile tab and busiest committee on
  issue 2126 before changing code. In order, separate day-lived dated figures from
  the 60-second ownership answer without changing the 20-minute confirmation expiry;
  remove committee sentences from the initial address-reader import chain; and load
  the code shared by 2 screens with those screens. Measure after each step and post
  before/after results on its issue. Only production measurements may set the
  first-load size limit. Deliver the 3 ordered changes in this job's single pull request.
- [ ] Job 4, [issue 1662](https://github.com/alethical-org/alethical/issues/1662):
  before the next scheduled refresh, re-download the 3 bulk files and 20 already-held
  reports across kinds and years. Compare records and document bytes; report row
  counts, columns, amounts, amendment handling, changes and unchanged fields.
  Make no production data change. File each loader/check-breaking difference with
  evidence as a separate issue. State on issue 1662 whether the next refresh is safe.
- [ ] After job 4's report, comment on issue 2140 with all 4 pull requests and any
  architecture findings, then stop. Lobbying waits for its separate design brief.


### 12 September follow-up checkpoint

- [Pull request 2161](https://github.com/alethical-org/alethical/pull/2161) is live at
  `f97afbde708cc7bfa17688704092653ba043d6fe`; refund matching and registration-year
  filtering follow the published directory even while a newer copy is quarantined.
- C finished all 6,412 official requests without retries or source errors. The
  retained replacement has 1,603 filers, 5,639 committee-years, 86,646 figures and
  36,655 report catalogue entries. Publication is held by the missing-record check:
  Action 4 Liberty PAC (41173) has no 2026 figures in the current Board totals feed.
  Its public termination PDF is still readable and states $103.93 receipts and
  $1,030 spending, whereas the old saved totals reported $0 and $60 through May 31.
  No source substitution or preservation exception is approved. The historical
  helper is finishing the complete impact comparison and source diagnosis.
- F's data contract is saved in its own worktree
  `/private/tmp/alethical-2147-refund-card`, branch `codex/2147-legislator-refund-card`.
  It includes source metadata, all-year refunds for outside-year confirmed
  committees, and truthful failure states. 96 backend integration checks, 4 API
  conversion checks and frontend type checking pass. The card itself is not built.
- F source enrichment completed for the 12 published candidate summaries. Only
  source metadata changed; the readback preserves all amounts, matches, copy dates
  and missing-year records. The API fields will become visible when F ships.
- Eugene's answers on Abeler's unbracketed 2016 row and the missing 2024 count remain
  pending, as does E's optional grouped-page help-text proposal. A scope addition
  does not answer those questions.
- A new attempted consultation with the permitted Claude session was rejected by
  automatic approval review for including run status and preservation instructions.
  No message from that attempt was sent; the assessment continues locally.
- The 4 follow-on jobs remain gated on A–F live completion and the final
  [issue 2140](https://github.com/alethical-org/alethical/issues/2140) report.
