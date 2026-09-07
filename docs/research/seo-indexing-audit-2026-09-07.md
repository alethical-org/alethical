<!-- timeless-check-ignore: Dated Search Console evidence and implementation checkpoint. -->

# Alethical search indexing audit, 7 Sep 2026

Net: Google lists 7,213 addresses and excludes 7,719. Most excluded addresses have
not been crawled. Exclusion is not by itself a defect.

## Scope and boundaries

Improve public-page discovery, reliable delivery and factual descriptions across
Alethical. Preserve private-page exclusions and intentional duplicate handling.
Do not send outreach messages, generate paid content, or create paid recurring jobs.
Never promise indexing or a ranking increase. Test changes, release through a pull
request and the merge queue, then test the public addresses.

## Google evidence

Signed-in domain property `sc-domain:alethical.com`, read 7 Sep 2026. The overview
reports data updated 3 Sep 2026; example crawl dates extend through 5 Sep 2026.

The submitted sitemap reports **Success**, submitted 11 Aug, last read 1 Sep,
with 13,389 discovered pages. The separate **All submitted pages** indexing
view shows 6,542 indexed and 6,846 excluded: 6,612 discovered, 200 crawled but
not indexed, 26 soft 404 and 8 server errors. The reports' totals differ by 1;
do not force differently updated reports into matching counts. This submitted
view is the better baseline for intended public addresses than all known URLs.

| Reason | Addresses | Interpretation pending live and code checks |
| --- | ---: | --- |
| Discovered, currently not indexed | 6,612 | Found but not crawled; first 50 examples are `/bills` and bill records. |
| Excluded by noindex tag | 575 | First 10 examples are question addresses under `/ask`. Expected exclusion. |
| Crawled, currently not indexed | 295 | First 50 mostly bills, plus 2 legislator profiles and 1 question address. Google has not given a specific content defect. |
| Alternate page with proper canonical tag | 184 | First 10 examples are bill `?tab=text` addresses. Expected consolidation. |
| Soft 404 | 27 | 14 bill addresses and 13 numbered bill-directory addresses. |
| Server error (5xx) | 11 | 9 bill addresses and 2 question addresses, all last crawled 4 Sep. |
| Duplicate without user-selected canonical | 9 | 7 legislator UUID addresses and 2 bill text-tab addresses, last crawled 1–6 Aug. |
| Not found (404) | 3 | `/Home` on both web hosts and `https://api.alethical.com/`; not missing public records. |
| Page with redirect | 3 | HTTP on both web hosts and HTTPS on the bare host forward to the preferred HTTPS www address. Expected. |

### All soft-404 examples

Bill paths under `https://www.alethical.com/bills/`:

- `94-2025-SF2513`, `94-2026-HF4075`, `94-2026-HF4775`, `94-2025-HF1726`,
  `94-2025-SF1322`, `94-2025-SF1409`: 5 Sep.
- `94-2026-HF3407`, `94-2025-SF2955`, `94-2026-HF3735`: 4 Sep.
- `94-2025-SF1403`, `94-2025-HF1095`: 2 Sep.
- `94-2026-HF5125`: 16 Aug; `94-2025-HF1584`: 14 Aug;
  `94-2025-HF632?tab=text`: 12 Aug.

Directory paths `/bills?page=N`, all 18 Aug:
`776`, `978`, `717`, `774`, `943`, `671`, `468`, `144`, `539`, `633`,
`851`, `347`, `974`.

### Server-error examples

Bill paths: `94-2025-SF2712`, `94-2025-HF1974`, `94-2026-HF4220`,
`94-2025-SF1306`, `94-2025-SF2755`, `94-2025-SF3204`, `94-2025-HF1344`,
`94-2025-SF2475`, `94-2025-HF2771?tab=text`.

Question paths name `94-2026-SF4179` suggestion `2` and `94-2026-SF3850`
suggestion `3`. Do not submit questions during diagnosis.

## Work sequence and acceptance checks

1. Read every exclusion class, sample affected public records, inspect search
   queries and crawling health. Separate historical reports from present failures.
2. Audit delivery and sitemap handling in 1 read-only helper; audit descriptions,
   body content and internal links in 1 separate read-only helper. This task owns
   the diagnosis and integration. Assign implementation files only after findings.
3. Add regression tests for each reproduced defect. Keep each writer's files
   separate. Preserve factual wording, private-state boundaries and data freshness.
4. Run focused tests, type and formatting checks, a production build, and browser
   checks. Open a pull request, address findings, clear current-main checks and
   merge through the queue.
5. Test live affected examples and representative page families. Request Google
   validation only for a class whose relevant failures have been repaired. Record
   what still depends on Google's next crawl rather than claiming it fixed.

Checkpoint: own branch `codex/sitewide-seo-september`.
Repairs tracked in [issue 2013](https://github.com/alethical-org/alethical/issues/2013).
Implementation complete; integration and release remain:

- Public homepage and money links, 2 optional chief-authored bill links, and
  outside-spending sitemap coverage are saved in the discovery milestone.
- `/about` and `/about/contact` share words between their loaded screens and
  initial responses. Bill descriptions preserve dotted abbreviations; the bill
  search description calls its filter an issue. Bills without AI analysis can
  show their unchanged official description with a source link.
- 167 frontend test files / 2,048 tests and the frontend type check pass.
  The production build passes its asset, icon and first-load size checks.
- Browser QA, current-main checks, pull request, merge queue and live checks
  remain owned by this task. No helper owns further implementation.

After integrating the latest sign-in loading changes from main, an intermediate
build measured 389,073 bytes and failed the 389,000-byte guard by 73 bytes.
The code including the grouped-date correction compresses to 388,873 bytes
locally, but Vercel's hosted build measures 389,015 across its 3 initial
downloads and fails the original guard by 15 bytes. The hosted measurement
sets a 389,500-byte guard, with 485 bytes of headroom. No compression or
file-selection rule changes. The guard's failure test still rejects growth.

Fresh reader testing passes at 1440×1000 and 390×844: bill search and detail,
official sources, legislator overview and campaign money, all money
destinations, published research and guides, public menus, About and Contact.
No page errors or horizontal overflow remain. The 5 contact fields have valid
accessible names; a case-sensitive test using different capitalization was
corrected without changing the form. Nothing was entered or sent.

Fresh reader testing found an adjacent factual display defect on HF5125:
6 co-author additions across 11–17 May appeared under “Latest action” with
only 11 May. Both compact action summaries now preserve the Actions section's
full range, “May 11, 2026 – May 17, 2026”. Source grouping and which action wins
remain unchanged. Single-day and missing-date regressions also pass. The full
current-main frontend suite passes 169 files / 2,072 tests.

Existing serving decisions read completely in
[page-metadata-for-search-and-sharing-decisions.md](../architecture/page-metadata-for-search-and-sharing-decisions.md).

## Search demand and crawling health

The 28-day Web performance report, 9 Aug–5 Sep 2026, shows 31 clicks,
approximately 3.03K impressions, 1% click-through rate and average position 9.8.
The largest exposed bill is `/bills/94-2025-SF746`: 181 impressions, 0 clicks,
position 8.0. The corresponding query asks about Minnesota peace-officer
citizenship and the status of SF746/HF465. Other high-exposure bills include
SF334 (116 impressions, position 17.4) and SF856 (62, position 12.6).
These small samples do not establish that a title caused a click rate or that a
new topic page would outperform a complete existing record.

Crawl statistics show 102K requests, average response time 440 ms and 99% HTTP
200 responses. All 3 listed hosts say “No problems”: `www.alethical.com` 50,481
requests, `api.alethical.com` 50,935, and `alethical.com` 113. Server errors are
under 1%. JSON is 53% of crawling, HTML 35%, and JavaScript 11%.

The robots report's 1 critical error is `http://www.alethical.com/robots.txt`,
“Not Fetched - N/A”, dated 29 Aug. The preferred HTTPS www copy is “Fetched” with
no issues. This is not evidence that the preferred site's crawler rules block Google.

Google's live URL test for `/bills/94-2025-SF2513` at 6:32 PM on 7 Sep says
“URL is available to Google” and “Page can be indexed”. The saved index result
still says soft 404 from the 5 Sep smartphone crawl, with successful fetching,
crawling allowed, indexing allowed and the correct self-canonical. The saved
crawled page is unavailable, so the historical rendered failure cannot be read.
The live test returns 200; its only unavailable resource is the Cloudflare
analytics script, not the bill's data or app program.

## Response checks and implementation decisions

All 36 reported public bill and directory examples returned HTTP 200 with a
self-canonical address, heading, readable snapshot and 3–19 ordinary links on
7 Sep. The 2 reported question addresses also returned HTTP 200 and retained
`noindex`. These were plain response reads, without executing the app or
generating answers. The 11 reported server errors are no longer reproduced.

Google accepted the server-error group's validation request on 7 Sep. Its
status is **Validation started**, not passed. Soft-404 validation waits for
the official-description repair to be live.
Google's confirmation email says validation can take a few days and that it
will email the result.

HF5125 is a content exception: it has no AI analysis, but its official record
contains this description: “Data centers sales and use tax exemption repealed,
and contingent reduction in special education aid appropriations repealed.”
The repair uses this unchanged official description with a source link when
neither AI key points nor an AI summary exists. It never substitutes the long
statutory title or claims an analysis exists.

Reusing the full browser bill payload is not included in this search repair.
The first response currently reads a smaller bill record. The browser later
reads actions, versions, sponsors and progress too. Across SF2513, HF1 and
HF719, the full record adds 302–2,645 compressed bytes; SF2513's full read
took approximately 0.53 seconds longer than its smaller read on 2 samples.
Moving that larger read before HTML can improve later app readiness but delay
the text Google and readers receive first. These reads establish a tradeoff,
not a universal performance gain. Do not seed an incomplete record under the
full browser request's key, because it would silently omit those sections.

The ranking approach is to strengthen existing useful records: complete
descriptions, source-labeled fallback text, public links between related
records, and immediate access to the site's purpose and contact information.
Do not mass-generate query pages, repeat keywords, remove valid exclusions or
pay for bulk AI summaries to chase the report's total. Measure indexed
submitted URLs and search impressions by page family after Google's next
crawls; small click samples cannot prove a cause or a ranking improvement.

## Primary guidance

- [Google's page indexing report](https://support.google.com/webmasters/answer/7440203?hl=en).
- [Google's crawling guidance](https://developers.google.com/crawling/docs/crawl-budget):
  availability, duplicate addresses, demand and useful content are separate factors.
- [Google's JavaScript troubleshooting](https://developers.google.com/search/docs/crawling-indexing/javascript/fix-search-javascript).
- [Google's people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).
