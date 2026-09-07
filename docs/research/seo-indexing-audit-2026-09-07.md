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

Checkpoint: own branch `codex/sitewide-seo-september`, based on `2e477141`.
Repairs tracked in [issue 2013](https://github.com/alethical-org/alethical/issues/2013).
Implementation in progress:

- This task owns `api/page.ts`, endpoint tests, decisions and release.
- Snapshot helper owns `pageSnapshot.ts` and its tests: 2 chief-authored bill links
  on profiles, plus the existing races and outside-spending links on `/money`.
- Delivery helper owns `api/sitemap.ts` and its tests: add outside spending.
  Its next bounded work shares existing `/about` and `/about/contact` wording
  between their screens and first-response snapshots, with dedicated tests.
- Bill-load helper is read-only: assess whether handing the already-read bill
  payload to the browser can safely remove a second request and loading state.

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

## Primary guidance

- [Google's page indexing report](https://support.google.com/webmasters/answer/7440203?hl=en).
- [Google's crawling guidance](https://developers.google.com/crawling/docs/crawl-budget):
  availability, duplicate addresses, demand and useful content are separate factors.
- [Google's JavaScript troubleshooting](https://developers.google.com/search/docs/crawling-indexing/javascript/fix-search-javascript).
- [Google's people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).
