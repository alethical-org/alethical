# Discoverability build and remaining holds

Owner: AEO workshop + socials. The build shipped in
[PR 2693](https://github.com/alethical-org/alethical/pull/2693) and is live on
www.alethical.com. Rows below state live results and the acceptance still open.
Routine choices and existing-account access are delegated; required host
confirmations remain host boundaries.
Tracking: [discoverability delivery issue](https://github.com/alethical-org/alethical/issues/2686).

## Scope and current state

| Item | Intended result | Current state and remaining acceptance |
| --- | --- | --- |
| B1 | Private search baseline and discovery-gap diagnosis | Google export, Bing export (keywords, page traffic, Copilot citation counts) and a dated Google indexing snapshot are retained privately; incomplete period and row coverage stays marked. All 26 bills absent from the summary-filtered directory lack returned summary data but have working public pages and official links. All 11 articles have internal links and sitemap entries. |
| B2 | Shared organization identity, article data and truthful dates | Live. The About page serves Organization data; all 11 articles (6 research pieces, 5 guides) serve Article data with their publication date, naming Alethical as author where attribution is known and leaving it absent otherwise; the event page serves the approved replay description. |
| B3 | Subject descriptions for research pieces | The Money Only Goes One Way subject line is live with its original dates and unchanged share text. The 5 Short posts stay on their current wording: their review fingerprints require genuine new review evidence, and no guard or approval record changes. |
| B4 | Provider receipts and authorized technical submissions | Unfinished: Search Console and Bing Webmaster receipts for the changed pages. A receipt never proves indexing. No new account or outreach. |
| B5 | Useful votes and actions in initial bill HTML | Live. The first response for HF 719 carries Senate 60–7 and House 122–11 final passage with procedural motions labelled separately; the loaded page refreshes from the data service with no failure notice. Refresh failures retain last-loaded history with retry. Unfinished: ingestion-to-visible propagation through both caches is not observed; a test stack has neither production cache, so it is measured at the next routine ingestion run. |
| B6 | Consistent crawler preferences | Live robots rules allow search and user-question crawlers and Google-Extended, and disallow training-only crawlers. |
| B7 | Evidence-based diagnosis of 11 articles | Reachability reviewed; missing demand and indexing metrics remain unknown. Accuracy corrections are private proposals, not silent article rewrites. |
| B8 | Curated questions and private weekly search collection | Collection, storage and access are built and switched off. The live data service reports its database at migration 0071, which adds the collection table. Unfinished: activation needs the production writer credential and a measured database capacity figure, then 1 live collection and retention receipt before any schedule. |
| B9 | Evidence rules and publishing checks in their owning guides | Shared evidence rules merged in [tool-settings PR 105](https://github.com/euglopi/tool-settings/pull/105). |
| B10 | Private monthly report with honest coverage | Aggregate report and independent retention cleanup are built. No crawler source is proven; missing coverage is not zero. Unfinished: activation follows B8's first successful collection. |
| B11 | Source-backed answer audit before and after | The pre-release audit is retained privately: 31 captured answers (ChatGPT 12, Perplexity 12, Gemini 7) with per-question accuracy and citation scores. 5 Gemini questions are unavailable behind an automated-traffic check that is not solved; Claude is unavailable because account-level preferences replace the answer. No paid API or recurring AI task. Accuracy is scored on required facts only, separately from whether Alethical appears. Unfinished: the repeat follows observed recrawl of the changed pages. |
| B12 | AI referral counts by host | Live. Signed-out requests and invalid sessions are refused, responses are private and never cached. Unfinished: an authorized administrator read is not yet observed live. No crawler, unique-person or engagement claim. |
| B13 | Consume separate security result | Security policy and runtime chain have a separate owner. This build does not duplicate the exception or bypass its guard. |
| B14 | Project social guide and curated questions | Live in [social publishing](social-publishing.md) through [PR 2695](https://github.com/alethical-org/alethical/pull/2695). |
| B15 | Drawn and built About facts block | Live. The section follows the approved Design drawing with its agreed copy changes, and the build is checked at the 3 layout bands with visible keyboard focus and 44-pixel targets. |
| B16 | Neutral directory-entry drafts | Private candidates prepared. Named Wikidata searches find no matching item; independent coverage is unverified. Nothing submitted. |

## Existing holds

Shorts section, remaining phone/Instagram work, new pieces and publishing cadence,
translations, separate short pages, Reddit, external-source registrations, outreach
and Google Business Profile stay held. About and directory drafting are build
items, not duplicate holds. No agent creates accounts. Raw searches, query/page
pairs, inquiries and audit answers stay private. No recurring token use, paid
logging or new paid service is armed.

## Dependencies and prevention

- Initial and loaded bill views share the actual response payloads, classifiers,
  source links and missing/error distinctions. Only recorded members are named;
  absent/excused members are not inferred. Shared table rendering escapes text and
  links cells accessibly. No request for every bill is needed to render one.
- Bill source and HTML cache allowances add to 16 minutes for a newly delivered
  page. This is a contract bound, not observed ingestion-to-visible proof. Existing
  open history remains readable during failed refresh with an explicit notice.
  A unit test alone never establishes real provider cache behavior.
- Organization identity is shared; publication, event, replay and checking dates
  retain their separate meanings. Private/noindex pages emit no structured data.
- Search reads remain private and bounded. Provider failure preserves the last
  successful sample. Independent deletion reports missing/stale/overdue cleanup;
  successful collection alone does not prove retention.
- Reports distinguish numerator, denominator, period, caps, lag and source. Monthly
  snapshots are not summed across overlapping windows. Browser beacons cannot
  count crawlers that run no page program.

Owning requirements: [page metadata decisions](../architecture/page-metadata-for-search-and-sharing-decisions.md),
[bill detail](../product-onboarding/bill-detail-guide.md),
[private search upkeep](public-search-upkeep.md), and
[publishing workflow](blog-publishing.md). Independent reviews cover missing uses,
privacy, failure recovery and prevention before release. The owner keeps final
review of the live result.
