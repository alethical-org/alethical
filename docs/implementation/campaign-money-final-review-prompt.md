# Campaign money final review prompt

Net: Review the completed source-date, calendar and layout release, with the donation cards and lobbying queued separately.

## Prompt

```text
Review the live campaign-money work to find any remaining correctness or reader problem. This is a review, not authorization to build, refresh data, resume lobbying or contact another session. Return only what you disagree with and your recommended correction, ranked by harm. Do not repeat the accepted work or give an all-clear for areas you did not inspect.

The current combined release is 76ea5041386e02fce68d2a8edd97e45e32ef927d, live on 13 September 2026. The delivery record lists the earlier A–F builds, the 4 follow-on jobs, the data-only additions and their live reports:
https://github.com/alethical-org/alethical/blob/main/docs/implementation/legislator-campaign-money-tab-plan.md
The coordinating issue is https://github.com/alethical-org/alethical/issues/2140

The latest completed work:
1. Documentation release: https://github.com/alethical-org/alethical/pull/2200
2. Accepted list spacing, ordinary-weight second lines and notes, neutral outside-spending labels, fixed tablet/computer label and amount columns, and 15px phone small text: https://github.com/alethical-org/alethical/pull/2203 closes https://github.com/alethical-org/alethical/issues/2199
3. Separate copy dates for payment files and report totals across every existing download-note consumer: https://github.com/alethical-org/alethical/pull/2202 closes https://github.com/alethical-org/alethical/issues/2192
4. Source-backed historical candidate calendars and past-tense historical notes: https://github.com/alethical-org/alethical/pull/2204 closes https://github.com/alethical-org/alethical/issues/2194

Review the decisions and the code, including those we consider settled. If a product decision should change, give Eugene the reason and concrete replacement before treating it as permission. The product values remain accuracy, plain language and a link to the source. A missing fact cannot become zero or an allegation that a committee did not file.

Important display decisions to preserve or challenge explicitly:
- The main chart shows shares of contribution dollars, with distinct printed-name counts beside kinds. Payment counts and name counts are different. Itemized rows and non-itemized money remain distinct. A calendar Year is not a claim to reproduce 1 filing period.
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

Release evidence:
All 3 code changes passed their full checks, the combined merge-queue checks, and website/API deployment. Each exact branch was measured on the host with production settings and public-domain promotion disabled before entering the queue. The final public first download is 338,170 bytes against the unchanged 339,072 ceiling. Local build counts and fixed local-to-host adjustments did not authorize release.
A fresh live reader passed 375/900/1440 layouts, keyboard tabs, name search, expand/collapse, 2025 show-more from 10 to all 74 names, spender navigation, the 2-date note, 2021/2022/2025 schedule wording and the 2024 refund row.
Public API reads covered all 12 Abeler year selections and 3 Gottfried selections. They retain financial release af236cca-a4f8-4efe-9a3a-025259ea380e. Abeler's 2025 money-in, money-out, split, refunds and 3 data-only blocks are unchanged before/after. Calendar and date deployment replaced no financial data.

Remaining work and boundaries:
- The 3 displays for the filing's 5 contributor lines, donor states and shared printed names are authorized under https://github.com/alethical-org/alethical/issues/2205 using Alethical UX (17).zip. They start after this documentation release merges. Their server data is live. They are not part of the completed release described here.
- Historical official totals remain stopped on https://github.com/alethical-org/alethical/issues/2142 and https://github.com/alethical-org/alethical/issues/2150. Preserve the published record and the complete saved replacement. All 3 authorized Action 4 Liberty PAC retries are exhausted. A later termination report covers a different period and cannot replace the earlier record. Reading complete financial-summary documents, including balances and coverage end, is new ingestion work requiring Eugene's explicit go.
- The payment replacement remains stopped on https://github.com/alethical-org/alethical/issues/2171. Its 2024 section loses 905 rows and $874,589.24. The read-only follow-up screened the 38 net-loss counts and examined 4 reports in depth; it is not a complete reconciliation. The findings and parser correction are here: https://github.com/alethical-org/alethical/issues/2171#issuecomment-5655320945 . No finding waives the preservation check.
- Lobbying data https://github.com/alethical-org/alethical/issues/2163 follows the live donation cards, then pages https://github.com/alethical-org/alethical/issues/2164 follows the live data. Eugene authorized finishing that sequence. This review grants no additional build or data-replacement permission and schedules no paid run.

No edits to docs/architecture/campaign-finance-system-design.md. Put any proposed architecture correction on the relevant issue for its owner. Prose and layout changes are easy to reverse; replacing source data is consequential and still held.

For each disagreement, give the source or code evidence, the reader harm, the exact recommended change and how to test it. Separate a demonstrated defect from an untested possibility. Inspect the current primary source rather than accepting this report as proof. End with only the concrete remaining action, if one exists.
```
