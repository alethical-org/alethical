# Legislator Campaign money tab delivery

This is the delivery checkpoint for [issue 2140](https://github.com/alethical-org/alethical/issues/2140),
updated 12 September 2026. A–F code changes are live; the historical replacement
remains stopped under its missing-record guard.
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
  6,412-request fetch completed. Publication is held because the fresh Board feed
  omits Action 4 Liberty PAC (41173), 2026. All 3 spaced retries returned the same
  empty response. The old published records remain unchanged. Both report checks
  and exact-version receipt-date carry-forward await safe publication.
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

The refund card is live in [pull request 2162](https://github.com/alethical-org/alethical/pull/2162),
following the source import in [pull request 2160](https://github.com/alethical-org/alethical/pull/2160)
and published-directory protection in [pull request 2161](https://github.com/alethical-org/alethical/pull/2161).
Eugene's 7-decision version and later source corrections govern the accepted drawing.

- [x] Use the accepted `Alethical UX (4).zip` refund drawing, with Eugene's message
  taking precedence over its illustrative data and superseded wording.
- [x] Render 1 all-years refund card directly below each confirmed committee's card,
  before outside spending. Preserve it when only the selected year has no figures;
  withhold it with unconfirmed, loading and failed whole-tab states.
- [x] Keep source-backed reported, not-published, not-matched and unavailable states
  distinct. Show an unpublished year only between matched years; omit unmatched years.
  Never add a total or guess an identity, a count, a copy date or a source address.
- [x] Use the exact accepted heading, explanation, table headings, notes and empty
  wording. Omit the drawing's extra registration line. Keep 3 table columns at phone
  width, an off-screen caption and proper column and year headers.
- [x] Load a fixture from the live response for 17868 and test real 2025 and 2021
  figures, missing-value wording, the conditional gap and 2 separately placed cards.
- [x] Update the profile reader guide and complete checks, release and live review.

Eugene approved both source corrections on 12 September: omit Abeler's 2016 row
because his oldest matching year is 2017; use Dibble (15667), whose matching 2015
and 2017 rows surround 2016, for the gap test. Abeler's 2024 row prints $10,508
and “Count not published”. A blank count is never a zero or an empty cell.

F now supplies the stored program-page address, actual newest copy date, and the
per-file married-couple-note flag. Source-only metadata enrichment for the 12 held
published candidate PDFs changed no figure, match, copy date or missing-year state.
All 2,608 frontend tests and 2,549 server tests pass, including 28 new rendered
refund cases. Type checking, pinned lint, the production build, current-head and
combined merge-queue checks passed. F is
[commit 71280542](https://github.com/alethical-org/alethical/commit/71280542096c1869f3663c9f9348134f66fd32e9),
with successful website and API releases.

Public production-origin responses passed all 5 Abeler, Dibble and Gottfried
samples. An independent live reader checked Abeler's unchanged all-years table,
Dibble's real 2016 gap, Gottfried's 2 cards in both 2024 and empty 2015, source
links, table semantics and 390/834/1280 widths. The in-app browser did not expose
new-tab activation; source destination and keyboard focus passed. The temporary
mixed-release source-link gap cleared after the API deployed and the canonical
2025 page reloaded.

## Final record

- [x] Comment on [issue 2140](https://github.com/alethical-org/alethical/issues/2140)
  with every pull request, live result, held portion and finding for the architecture owner.
- [x] Leave [campaign-finance-system-design.md](../architecture/campaign-finance-system-design.md)
  unchanged in this task; its owner receives findings through issue 2140.
- [ ] After all changes are live, give Eugene 1 complete prompt for Claude to review
  the approved decisions, implementation, checks, live results and remaining limits.

No paid run, real user message or destructive production change is authorized by this plan.

## Approved follow-on sequence

These jobs start only after A through F have merged, passed live checks and been
reported on [issue 2140](https://github.com/alethical-org/alethical/issues/2140).
The code-release gate is met by the [A–F live report](https://github.com/alethical-org/alethical/issues/2140#issuecomment-5649295250).
Eugene directed the historical replacement to stop and the other jobs to continue;
its data publication and comparison-count report remain held, not completed.
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
  architecture findings, then report completion of this set. The subsequently approved data-only jobs
  below follow this set; the accepted lobbying display is job 5f after 5e is live.


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
  No source substitution or preservation exception is approved. All 3 authorized
  retries returned the same 243-byte HTTP 200 response with empty 2026/2027
  arrays. C is stopped, with the exact responses, hashes, report and old record
  on [issue 2142](https://github.com/alethical-org/alethical/issues/2142#issuecomment-5649077696).
- F's data contract is saved in its own worktree
  `/private/tmp/alethical-2147-refund-card`, branch `codex/2147-legislator-refund-card`.
  It includes source metadata, all-year refunds for outside-year confirmed
  committees, and truthful failure states. 96 backend integration checks, 4 API
  conversion checks and frontend type checking pass. The card and source fields are live in [pull request 2162](https://github.com/alethical-org/alethical/pull/2162).
- F source enrichment completed for the 12 published candidate summaries. Only
  source metadata changed; the readback preserves all amounts, matches, copy dates
  and missing-year records. The API fields are live.
- Eugene approved the refund gap and missing-count corrections. E's optional
  grouped-page help-text proposal remains pending.
- A new attempted consultation with the permitted Claude session was rejected by
  automatic approval review for including run status and preservation instructions.
  No message from that attempt was sent; the assessment continues locally.
- Job 1 is assigned to internal worker `/root/refund_live_reader`, using a new
  worktree for [issue 2068](https://github.com/alethical-org/alethical/issues/2068).
  Root owns the delivery-record release in parallel; jobs 2 onward retain their order.


## Approved data-only queue after follow-on jobs 1 through 4

Eugene added these 4 enumerated jobs on 12 September 2026. Run in order after
follow-on jobs 1 through 4, each with its own worktree and pull request, Net and
Docs check lines, merge queue and live response check. These jobs change no page;
display work awaits a separate accepted Design brief. Do not edit the architecture
record. Send findings and completion, with the pull request and live result, to
each job's issue. Comment on issue 2140 after all 4 merge.

- [ ] 5a, [issue 2144](https://github.com/alethical-org/alethical/issues/2144): add
  `stated_by_kind` to committee finance and legislator campaign finance only when
  the year's stated-split check agrees. Serve the 5 filing lines from
  `cf_filing_figure`: individuals, lobbyist, committee_fund, party_unit, other
  contributions, with each filing total, matching itemized cash and difference.
  Candidate Committee contribution rows belong under party_unit, matching the
  filing's combined party-unit/terminating-candidate heading. Any negative
  difference yields `sources_disagree` with no figures. Pin 17868/2025.
- [ ] 5b, [issue 2146](https://github.com/alethical-org/alethical/issues/2146): import
  the HUD USPS ZIP crosswalk or USPS 3-digit prefix ranges into a manually refreshed
  reference table; record the chosen source and its date. On the same 2 responses,
  candidate committees only and only after an agreeing split check, serve
  `donor_states` for Individual-kind Contribution rows: distinct printed names and
  cash by state, including unknown for missing, unmatched or shorter-than-5-digit
  ZIPs, and Minnesota/other-states/unknown summary. Never serve ZIPs. Pin 17868/2025
  cash reconciliation and a 4-digit ZIP as unknown.
- [ ] 5c, [issue 2145](https://github.com/alethical-org/alethical/issues/2145): for
  each distinct printed individual contributor name in the committee-year, count
  other PCC candidate registrations with a Contribution under exactly that spelling
  in the same year. No normalization beyond payments-under-name. Serve distribution
  0, 1, 2, 3, 4+, numerator and denominator, and the top 5 ordered by count then
  name. Pin 17868/2025 and 2 spellings remaining 2 entries.
- [ ] 5d, [issue 2150](https://github.com/alethical-org/alethical/issues/2150): Eugene
  reversed the deferral of 2015–2021 official totals. Run one replacement for
  2015–2026 using the saved 1,603-filer directory. Retain independent checks,
  coverage-end guard, verdicts bound to both copies, receipt-date carry-forward,
  refreshed-file dates and the missing-record guard. For 2015–2021, where the
  stated-split comparison has no held report document, publish official Total
  contributions and Expenditures under their structural check and serve split
  state `unverifiable_no_report_document`, never shown. The request estimate is
  4 per filer per added segment, about 6,400–9,600 additional requests; post actual
  counts on issue 2150. This later authorization does not waive the currently
  held missing-record check for 41173/2026.

### Job 5e: current lobbyists and lobbying lookups

Eugene added job 5e after jobs 5a through 5d on 12 September 2026. This authorizes
lobbying data and server work only; the accepted lobbying display is the separate
job 5f after this data service is live. The queued work is [issue 2163](https://github.com/alethical-org/alethical/issues/2163)
in milestone `campaign finance`; close it with its own pull request and report live results. Keep the same
worktree, checks, merge queue, live-read and no-architecture-file-edit rules.

- Resolve the Board's [lobbying downloads](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/)
  links on every run by heading and row label. `Lobbyist Information` / `Active
  Lobbyists` is the current list; `Principal expenditures` contains the already
  loaded 2009-to-present file. Read `alethical/pipeline/lobbying_expenditures.py`
  and reuse its dated replacement shape. Run both sources in 1 job with 1 copy date.
- Store a lobbyist table with registration number, filed/formatted names and the
  3 name parts; store associations separately with registration number, integer
  entity ID, printed principal name and position. Discard Street, City, State,
  Zip Code, Telephone and Email Address at parse time and test their absence.
- Validate counts against the prior copy, unique registration numbers and every
  association's integer ID/name. Count unparsed entries; never silently drop them.
  The supplied September 12 source measurements, to be independently reproduced:
  1,665 lobbyist rows, association median 1, maximum 86, no empty associations.
- Prove associations' entity IDs against the principal spending snapshot: count
  distinct IDs that resolve and exact printed-name agreements. Only resolved IDs
  can serve a principal link; others have `no_spending_rows` and plain names.
- Prove live Lobbyist-kind contribution registration numbers against the current
  lobbyist list, counting resolved/unresolved numbers and differing typed names.
  Post both link proofs on the issue; the supplied 4-row sample is not the proof.
- Serve `/api/v1/lobbying/principals/{entity_id}` with yearly spending rows (year,
  total, 5 kinds; blank as null, .0000 as 0), today's registered lobbyists and their
  numbers, section states and copy date. No cross-year total.
- Serve `/api/v1/lobbying/lobbyists/{registration_number}` with filed name, current
  principals and link resolution, and all Lobbyist-kind Contribution rows matching
  that registration number, grouped by year and receiving committee with kind and
  linkability. No total; preserve both typed and list names when they differ.
- Serve `/api/v1/lobbying/summary` with distinct current registration count and
  principals having a latest-year spending row whose 6 amounts are not all blank,
  plus copy date. Add separate Lobbyists and Principals groups to campaign-finance
  search, exact match on filed name, counted independently.
- Use real fixtures: Kozak, Andrew (141), 3 payments to 17868 in 2025; the lobbyist
  with 86 associations must produce 86 rows; an absent registration returns
  `not_registered_today`. Document response blocks in the API record and report
  measured link proofs on the job's issue.


### Job 5f: lobbying pages after 5e is live

The accepted display build is [issue 2164](https://github.com/alethical-org/alethical/issues/2164),
in milestone `campaign finance`. It starts after the live check for
[issue 2163](https://github.com/alethical-org/alethical/issues/2163). Eugene's
12 September 2026 brief overrides both accepted Design rounds. The complete fixed
text and measurements are in `Alethical UX (5).zip` and `Alethical UX (6).zip`;
their separate extracted copies are under `/tmp/2140-lobbying-design-round-1/`
and `/tmp/2140-lobbying-design-round-2/`. Both use the same internal filenames,
so one round must never overwrite the other.

- Build the landing, both lists and both detail addresses under `/money/lobbying`,
  using only the trailing entity/registration number to resolve a detail address.
  Add both search groups, the sixth `/money` lane and the accepted expanded
  Lobbyists and Committees & Funds panels in both existing committee surfaces.
- Lists use numbered pages of 50 with page in the address and name filtering;
  only cards expand by 30. Counts state the complete population, distinct entity
  IDs for principals and separate names/payments on the Lobbyists tab.
- Keep employer text before expansion. Inside the panel show the registration,
  the differing registered name when applicable, and a link only for a number in
  today's list. Absent numbers say `not registered today`, with no link.
- The principal name comes from spending; differing list spelling gets its own
  line. List-only principals are counted across the union of both files, remain
  plain in list/search and carry the exact no-spending-rows sentence.
- A row with any later kind shows all 5 kinds even before 2024. Otherwise preserve
  the accepted pre-2024 merged-cell wording. Blank rows say `Not reported`;
  a filed .0000 is 0. Exclude all-blank rows from the landing spending count and
  choose the latest reported year from rows containing any amount.
- Preserve separate yearly spending, current relationships and donations. No
  cross-year/committee total, chart, ranking, trend, map or suggested money chain.
  Never print contact fields; use the shared actual source-copy date.
- Follow the accepted 768/1100 bands, at least 44-pixel controls, table captions
  and headers and semantic lists. Test real Kozak/17868 payments, 86 principals
  expanded in 30s, both list page-2 cases and a list-only principal in search.
- Remove the exact lobbying-under-development strip from every money page in the
  same release. Update the section guide and add a declared, indexed lobbying
  reader guide. Own worktree, PR, checks, merge queue and live review remain
  required; report on both issues 2164 and 2140. Architecture findings go to the
  issue, never into campaign-finance-system-design.md from this task.
