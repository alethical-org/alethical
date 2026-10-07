# Public search upkeep

<!-- describes: scripts/check_public_search_health.py, .github/workflows/public-search-health.yml, scripts/report_page_speed_by_address.py, scripts/notify_changed_public_pages.py, .github/workflows/public-change-notices.yml -->

## Outcome and limits

Keep public pages easy to discover and useful to read, without weakening source
accuracy, privacy or the approved website. Mobile checks cover mobile browsers
including Safari on iPhone and Chrome on Android, not native apps.

A correct response or sitemap proves that an address is available for discovery.
It does not prove that Google, Bing or another provider indexed or ranked it.
The providers decide that. Their reports lag, use different coverage populations
and sometimes show rounded counts. Record the property, report update date,
filter, denominator and sampling scope beside every provider figure.

[Page metadata decisions](../architecture/page-metadata-for-search-and-sharing-decisions.md)
own first-response content, canonical addresses, descriptions and exclusions.
[Reader completion checks](reader-completion-checks.md) own live release proof.
[Jobs and scripts](jobs-and-scripts.md) own triggers, inventory and running costs.

## Ranked work

| Priority | Work | Completion condition |
| --- | --- | --- |
| 1 | Deliver existing public candidate facts and legal text before the website program loads; include `/candidates` in discovery | Useful initial text, accurate sources and missing/unavailable/private responses, focused tests and desktop/mobile-browser checks |
| 2 | Repair demonstrated provider discovery gaps and notify actual public changes | Bing receipts for missing sitemap sections; truthful bounded IndexNow notices with durable state |
| 3 | Prevent technical regressions | Daily and release checks, broader weekly rotating sample, retained failure evidence |
| 4 | Improve existing explanations and search descriptions where query evidence shows a real gap | Source-backed useful edits that preserve the approved subject and first-summary-sentence rule; compare results after provider lag |
| 5 | Seek useful Minnesota citations | 3 private researched drafts; external sends remain separately authorized, no paid listings, link trades or bulk outreach |
| 6 | Repair demonstrated reader delays | Existing private aggregate speed data plus browser timing; retain measurement floor and avoid speculative rewrites |

## Daily and after releases: automatic, free checks

The **Public search health** workflow runs at 17:17 UTC and after successful
trusted-main **Reader completion checks**. It reads robots instructions, the
7 sitemap children, important public destinations and a bounded record sample.
It requires meaningful initial text, correct preferred addresses and indexing
instructions; missing records and private views keep their deliberate treatment.
Failures retain a JSON artifact for 35 days. It makes no AI calls, uses no
credentials and creates no daily issue or message for a person to review.
GitHub's normal failed-run notification is the fallback for a broken technical check.

Record query variants have a separate, strict check path. Discovery still rejects
record queries; passing a variant never admits it to a sitemap. The variant checks
require useful initial content, an indexable 200 response and exactly 1 preferred
address pointing to the base record. Known saved-data keys and payload years must
match the requested record and year. Optional legislator/payment data that the page
server omitted is recorded as `not-served`, not proof of correct year or direction.

At most 9 daily or 14 Monday variant reads share the existing 160-request,
300-second and 4 MiB-per-response limits. Committee, payment, legislator, race and
bill-text views rotate weekly. Race variants use the current year, matching their
sitemap inventory; older years need not contain the same seats. A failed variant
selection is retained as a failed check without skipping missing/private checks.
The 4 fixed October incident examples remain until Google's corresponding error
validation passes; remove that temporary list in a reviewed change, retaining the
rotating coverage and offline regression tests.

A release remains incomplete until its intended commit has reached the public
website and changed reader paths work. The search check records the served commit
but deliberately does not replace the release ancestry checks.

## Weekly: broader technical coverage and provider evidence

Every Monday the automatic search-health run samples more records across all
sitemap families, with deterministic rotation. This covers more of the inventory
without requesting every record every day.

A human or an explicitly started coding task reviews Google Search Console and
Bing Webmaster Tools once weekly while a coverage repair is being evaluated.
Compare indexed, discovered-not-indexed, crawled-not-indexed, soft-404 and server
failure trends. Inspect a few new or changed examples from affected families.
Read **All known pages** as well as **All submitted pages**, and keep their counts
separate. The latter excludes many query variants and old addresses; a clean
submitted-pages report does not establish that Google saw no sitewide errors.
For a historical soft-404 whose public response is now useful, run the provider's
live inspection and compare its rendered content with the current response.
Do not invent extra text to satisfy an arbitrary minimum word count.
Start validation once a demonstrated cause is repaired, or after affected examples
and representative Google live tests pass with no evidence of an ongoing failure.
When historical logs cannot establish the cause, state that explicitly. Do not
restart validation daily,
repeatedly submit unchanged addresses, or treat a successful live test as indexing.
A reported failure with no current response defect remains a provider follow-up,
not permission for unrelated data regeneration.

## Monthly: relevance, clicks, citations and speed

Compare the latest complete 28-day window with the previous complete 28-day
window, noting source lag, seasonality and small counts. Record query, destination,
impressions, clicks, click-through rate and average position. A low click count
at a low position does not by itself demonstrate misleading page wording.
Prioritize queries that match the website's real records and explanations.
Improve an existing useful page before creating another page for the same question.
Keep dates, coverage limits, official citations and AI disclosures; do not fabricate
research, keywords, schema fields, reviews or claims of complete coverage.

Review the 3 researched Minnesota resource destinations privately. Update their
published contact routes and check the proposed public resource still fits.
No outreach, form submission, link exchange or paid listing is armed automatically.

Use `scripts/report_page_speed_by_address.py --days 28 --json` with existing
read-only Cloudflare settings. Compare actual reader document loads and in-page
clicks separately from automated clients, by public address family. Fewer than
50 observations means insufficient evidence, not a zero speed score. Trace a
slow reader path before changing code. Browser layout and keyboard checks remain
part of any affected website release.

Weekly/monthly provider, content and citation judgment is an operating cadence,
not a recurring AI task. No token-consuming automation or paid service loop is
created by this work. [Technology health](technology-health.md) retains its
existing monthly tools/security check and [published piece link checks](../../.github/workflows/published-piece-links.yml)
retain their existing free weekly source checks.

## Search providers and automatic change notices

Serve the same useful public content to people and search crawlers. Keep public
search bots crawlable; preserve intentional training-bot exclusions and private
`noindex` views. Google uses the existing sitemap and crawlable links. Bing's
submitted child sitemaps are a discovery repair, not evidence of indexed pages.

[IndexNow](https://www.indexnow.org/documentation) permits notices for changed
public addresses. Notify only newly added or removed inventory entries and entries
whose valid source-backed `lastmod` advances. Seed the first baseline without
submitting the existing inventory. Do not manufacture daily modification dates.
A durable trusted-main state tracks the inventory and unaccepted pending notices;
missing/corrupt state fails closed rather than silently resetting and losing changes.
The public verification text file is a protocol ownership proof, not a secret.
HTTP 200 is receipt and 202 means key validation is pending. Neither proves indexing.

The **Public changed-page notices** workflow follows a successful trusted-main
search-health run, or an explicit hand run on `main`. It uses only GitHub's
short-lived workflow token and the public ownership key. Initialize once with
`gh workflow run public-change-notices.yml --ref main -f initialize=true`.
The first run sends 0 existing addresses. Later runs fail closed on a missing,
corrupt or unsafe state rather than treating the inventory as new.

Saved inventory and pending receipts live in `state.json` on the fixed
`codex/indexnow-state` branch. Its only companion is a fixed `vercel.json` with
`git.deploymentEnabled: false`, so saving search state cannot launch website
previews. The tool requires that protection before any baseline read or update.
It changes no `main` files and compares GitHub's saved-file identity before writes.
Pending changes are saved before any provider notice, and attempts are saved
before sending. A crash can repeat a bounded notice; it cannot silently erase an
unaccepted change. Reports are kept for 35 days, including failure receipts.

Each run allows at most 100 notices, 160 public reads and 300 seconds of public
checking, with bounded response and saved-state sizes. The selection cursor
rotates past unavailable entries so one broken address cannot hold every later
notice. Newly added or modified entries need a useful, indexable 200 response
with their own preferred address; removed entries need a real 404 or 410.
Redirects and outages do not count as removals. A 429 provider reply preserves
the queue and honors a valid `Retry-After` date or number of seconds from receipt;
other unaccepted notices remain queued with the normal retry pause.

This inventory-based tool cannot detect body edits on fixed pages without
`lastmod`, a backward source date, or an address removed into a redirect. Those
need a real release/change event or deliberate reviewed notice, not a made-up
modification date. Technical checks and weekly provider inspections cover these
remaining limits. Initialization must not be used as a bulk re-submission route.

Google's [AI search guidance](https://developers.google.com/search/docs/appearance/ai-features)
uses the same foundational public search requirements. No special AI-only page,
search markup or duplicated keyword material is required. The normal website,
accurate readable content, useful links and supported structured data remain the
shared foundation. Other engines have their own crawl/index decisions; do not
promise full coverage from Bing's receipts alone.
