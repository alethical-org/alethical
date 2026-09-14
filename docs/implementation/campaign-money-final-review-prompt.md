# Campaign money final review prompt

Net: Review the live campaign-money and lobbying work; the 2 source replacements remain held.

## Prompt

```text
Review the live campaign-money work to find any remaining correctness or reader problem. This is a review, not authorization to build, refresh data or contact another session. Return only what you disagree with and your recommended correction, ranked by harm. Do not repeat the accepted work or give an all-clear for areas you did not inspect.

The lobbying display release is 4a4c8c21084795539f13d9de52e61017427b2347, live on 14 September 2026. It follows the live donation-card and lobbying-data releases. The delivery record lists the earlier A–F builds, the 4 follow-on jobs, the data-only additions and their live reports:
https://github.com/alethical-org/alethical/blob/main/docs/implementation/legislator-campaign-money-tab-plan.md
The coordinating issue is https://github.com/alethical-org/alethical/issues/2140

The latest completed work:
1. Documentation releases: https://github.com/alethical-org/alethical/pull/2200 and https://github.com/alethical-org/alethical/pull/2206
2. Accepted list spacing, ordinary-weight second lines and notes, neutral outside-spending labels, fixed tablet/computer label and amount columns, and 15px phone small text: https://github.com/alethical-org/alethical/pull/2203 closes https://github.com/alethical-org/alethical/issues/2199
3. Separate copy dates for payment files and report totals across every existing download-note consumer: https://github.com/alethical-org/alethical/pull/2202 closes https://github.com/alethical-org/alethical/issues/2192
4. Source-backed historical candidate calendars and past-tense historical notes: https://github.com/alethical-org/alethical/pull/2204 closes https://github.com/alethical-org/alethical/issues/2194
5. Filing contributor lines, individual contribution states and exact shared printed names: https://github.com/alethical-org/alethical/pull/2207 closes https://github.com/alethical-org/alethical/issues/2205
6. Current lobbyists and represented organisations, copied with yearly lobbying spending as 1 release: https://github.com/alethical-org/alethical/pull/2208 closes https://github.com/alethical-org/alethical/issues/2163
7. Lobbying landing, directories, records, search groups and donation-panel links: https://github.com/alethical-org/alethical/pull/2209 closes https://github.com/alethical-org/alethical/issues/2164

Review the decisions and the code, including those we consider settled. If a product decision should change, give Eugene the reason and concrete replacement before treating it as permission. The product values remain accuracy, plain language and a link to the source. A missing fact cannot become zero or an allegation that a committee did not file.

Important display decisions to preserve or challenge explicitly:
- The main chart shows shares of cash contribution dollars, with distinct printed-name counts beside kinds. Payment counts and name counts are different. Itemized rows and non-itemized money remain distinct. A calendar Year is not a claim to reproduce 1 filing period. Goods and services stay separately shown and are excluded from the chart and the 3 donation-card cash comparisons.
- Official totals publish on structural checks, including a present, well-formed coverage end within the requested year. The contribution check gates the derived named/non-itemized split; the spending check independently gates the comparison note beside the official spending total. A reader_unproven document check does not hide a structurally valid official total. Check verdicts bind to both current source copies; neither check passing implies the other passed. A totals-route fallback to a later report cannot authorize figures for an earlier year.
- A summary card shows figures stated by the filing. A sum calculated from listed payments stays beside those rows. Missing official spending has no invented amount; an official zero stays a zero. Outside spending is separate from a committee's own money, and committees are never added together.
- Registered candidate committees remain grouped under Committees & Funds in the donor browser. Other kinds are handled if present. Exact printed-name lookup does not establish that 2 spellings are the same person.
- Donut slices, legend squares and year-mix bars use the same solid kind colours: Individuals #149d5b, Lobbyists #1f8fe6, Committees & Funds #7c3aed, Party Units #e56b12, Other kinds #d6336c, Non-itemized #899087. No texture or pattern. Outside Supporting/Opposing labels use neutral outline/fill treatments and registered spender links remain links.
- Refunds span every matched year independently of the selected Year. A missing count prints Count not published, never 0. An unpublished year appears only between 2 matching years. Abeler has no 2016 row because his oldest match is 2017. The real Dibble 2015/2017 rows test the intervening 2016 case.

Source-date result now live:
Both /api/v1/legislators/{id}/campaign-finance and /api/v1/committees/{registration_number}/finance serve nullable filings_copied_at. It comes from cf_filing_current.snapshot_id joined to cf_filing_snapshot.fetch_completed_at. A newer unpublished copy, publication time, report receipt date or payment-file date cannot replace it. The request's pinned database view keeps figures and date together.
The live sample serves payment files copied 2026-09-01T18:33:35.639027Z and report totals copied 2026-08-12T21:34:26.606333Z. The visible line is:
“We downloaded Minnesota’s payment files on Sep 1, 2026 and its report totals on Aug 12, 2026. Neither is the period the money covers.”
Older responses retain the truthful 1-date fallback. The note stays at the foot of the money tab, before the site footer, at 15px/400 in #4f5651. Both committee and full-payment initial HTML print the 2 dates. A stale dated cache briefly used the fallback and then refreshed normally.

Calendar result now live:
22 preserved official PDFs support 84 transcribed report rows for regular candidate classes across 2015–2026. Report dates and conditions are literal source readings, not calculations from election cycles. A known historical schedule stays known after its final deadline; upcoming-report fields remain null. Special elections and missing committee-year evidence keep separate unknown states. A House-only calendar cannot classify a Senate election report.
Source record: https://github.com/alethical-org/alethical/blob/main/docs/evidence/campaign-finance-calendars.md
Abeler's 2022 note says he was on that year's ballot; 2021 and 2025 say he was not. The outside-spending empty sentence includes the off-ballot clause for 2025.

Donation cards now live on the legislator tab and committee page:
The filing's 5 contributor lines, state breakdown and names shared with other candidate committees read stated_by_kind, donor_states and name_connections already served. Abeler 17868/2025 has filing/itemized/difference totals $97,703 / $67,100 / $30,603. The last figure matches the lead chart's Non-itemized contributions.
The filing's party-unit line includes terminating candidate committees. The donor browser keeps those under Committees & Funds. The explicit note accounts for 1 closing-committee payment of $500 and names both destinations. Multiple payments use the longer count form. These are payments, not a count of committees.
The location card has Minnesota 71 names/$38,700, other states 0/$0 and unknown 3/$1,250, totaling 74 names/$39,950. It is absent on political-fund and party pages. No postcode is rendered, including hidden labels or attributes.
The shared-name card has 19 of 74 names and distribution 55 / 11 / 5 / 1 / 2. It claims exact spelling, never identity, with the caveat beside the headline and 5 neutral greys. Held sentences do not imply failure to file. Loading, failed, empty and withheld states are tested separately. The server currently gates filing-line figures to candidate committees; the frontend preserves that actual source restriction rather than inventing fund figures.

Lobbying now live:
- /money/lobbying
- /money/lobbying/principals and /money/lobbying/lobbyists, with numbered pages of 50 and page in the address
- /money/lobbying/principals/<readable-name>-<entity ID>
- /money/lobbying/lobbyists/<readable-name>-<registration number>
- Lobbyists and Principals search groups at /money/search, the sixth /money lane, and registration links inside expanded Lobbyists donation rows on legislator and committee pages
Only the trailing positive number resolves a record. Principal links exist only where the ID resolves in the spending copy; principals found only in the lobbyist list remain plain text in directories and search. Committee & Funds donation rows keep their committee link in the expanded panel. The old under-development strip is removed from the money surfaces.

Both lobbying files were copied on 2026-09-13T23:41:21.934688Z into release 70f958f3-e559-4b1b-8cc0-1edd60422799: 1,665 current lobbyists, 5,395 associations and the unchanged 17,842 spending rows for 2014–2025. The latest-year count is 1,748 principals in 2025 whose 6 amounts are not all blank. The union directory contains 3,443 principal IDs; the spending copy contains 3,184. Contact fields are dropped before storage.
The full ID proof found 1,832 distinct association IDs: 1,573 resolve to spending and 259 do not; 1,562 resolved IDs have exactly matching names and 11 have different names. Across 22,352 Lobbyist-kind contribution rows, 16,394 resolve to the current list and 5,958 do not, including 16 with no number. Of the resolved rows, 3,473 carry a different typed name. A current-only register does not establish past registration status.
Kozak, Andrew (141) has 13 distinct current principals and 240 held contribution rows. The 3 payments to committee 17868 in 2025 are $200, $100 and $100; repeated date/amount is not deduplicated. Larson, Daniel G (9865) has 86 principals, shown 30, 60, then 86 in its card. List pages still use numbered 50-row pages. Donation source dates remain separate from the current lobbying copy date.
Yearly spending preserves blank as Not reported and a filed .0000 as $0. Whole dollars cut cents. A pre-2024 row shows all 5 kinds whenever any later kind is present, including a stated zero; otherwise it uses the accepted merged-cell sentence. No total across years or committees, chart, ranking, trend, map or causal chain is added. Current clients and donations are 2 separate cards.

Release evidence:
The display release passed 2,910 frontend tests, 2,791 server tests, TypeScript, formatting and the combined merge-queue checks. The final code measured 338,828 compressed bytes on hosted production against the unchanged 339,072 ceiling. Before the final 2-line card-spacing fix, the same source measured 338,820 in hosted production and 338,978 in hosted preview. The checker now uses actual bytes, removing the invalid fixed +542 adjustment, and tests reject a real 1-byte excess in both settings states. Local figures do not authorize release. The public site serves that merged commit at all 5 route types, both page-2 lists and the Abeler sample. The actual public production build also measured 338,828 bytes. Independent browser checks cover the phone, tablet and computer bands, actual record links, separate count rows and 30/60/86 card expansion.
The financial contribution release remains af236cca-a4f8-4efe-9a3a-025259ea380e. No historical-total or payment-file replacement was published by these display releases.

Remaining work and boundaries:
- The grouped payments-under-one-name page is live with the fixed help paragraph retained as requested. The delivery record still marks an optional replacement paragraph about group links and subtotals as awaiting approval. Treat that as a wording proposal, not unfinished implementation or permission to replace fixed copy.
- Historical official totals remain stopped on https://github.com/alethical-org/alethical/issues/2142 and https://github.com/alethical-org/alethical/issues/2150. Preserve the published record and the complete saved replacement. All 3 authorized Action 4 Liberty PAC retries are exhausted. A later termination report covers a different period and cannot replace the earlier record. Reading complete financial-summary documents, including balances and coverage end, is new ingestion work requiring Eugene's explicit go.
- The payment replacement remains stopped on https://github.com/alethical-org/alethical/issues/2171. Its 2024 section loses 905 rows and $874,589.24. The read-only follow-up screened the 38 net-loss counts and examined 4 reports in depth; it is not a complete reconciliation. The findings and parser correction are here: https://github.com/alethical-org/alethical/issues/2171#issuecomment-5655320945 . No finding waives the preservation check.
- Lobbying data and pages are complete. PDF export and All Years/Compare remain outside this delivered scope. This review grants no additional build or data-replacement permission and schedules no paid run.

No edits to docs/architecture/campaign-finance-system-design.md. Put any proposed architecture correction on the relevant issue for its owner. Prose and layout changes are easy to reverse; replacing source data is consequential and still held.

For each disagreement, give the source or code evidence, the reader harm, the exact recommended change and how to test it. Separate a demonstrated defect from an untested possibility. Inspect the current primary source rather than accepting this report as proof. End with only the concrete remaining action, if one exists.
```
