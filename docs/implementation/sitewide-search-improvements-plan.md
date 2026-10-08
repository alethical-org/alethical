# Sitewide search improvements

<!-- timeless-check-ignore: Dated implementation evidence and release checkpoints. -->

## Authorized finish and boundaries

The complete sitewide search audit scope is approved for implementation.
Implement the six proposed areas through a tested live website release. Phone
checks mean mobile browsers, including Safari on iPhone and Chrome on Android;
no native iOS or Android app is in scope. Outreach drafts remain private until
separate sending approval is granted. No paid recurring agent work, bulk paid
content generation, production record replacement, or new visual direction.

## Evidence, impact and prevention

- Public sitemaps list 18,562 unique addresses across seven children. The sampled
  66 responses have correct preferred addresses and allow indexing, but `/candidates`,
  two real candidate profiles, `/privacy` and `/terms` initially contain only loading
  text. `/candidates` is also absent from the fixed sitemap list. Root cause:
  their first-response handlers deliver headings only. Preserve the approved
  address-free candidate evidence, freshness warnings and privacy boundaries.
- Google’s submitted-page report updated 3 October shows 9.27K indexed and
  9.27K not indexed: 9,090 discovered, 97 crawled but not indexed, 82 soft 404,
  0 server failures. All 82 current examples return useful 200 responses with
  preferred addresses. A numbered bills address passes Google's live test even
  though the saved crawl says soft 404. Do not pad real short source-backed bills.
- Bing's root sitemap listed only the pages child. Submitting 6 missing children
  produced 7 successful sitemap receipts and 18.6K discovered addresses. Site
  Explorer reports 402 indexed, 27 excluded, 6 warnings and 0 errors, from 435
  known URLs. Its 6-month totals and Google's submitted-page population differ.
- The search report and links report justify strengthening useful existing records
  and seeking relevant Minnesota references. Changes must remain source-backed;
  search exposure or a short page alone is not evidence of a content defect.
- Google's complete 28-day Web window, 7 September through 4 October, reports
  145 clicks, 9,718 impressions, displayed click-through rate 1.5% and average
  position 7.8. Mobile contributes 59 clicks and 2,049 impressions. Its 285
  reported query rows account for only 21 clicks and 995 impressions; omitted
  queries cannot be classified as non-brand. The observed query evidence does
  not establish a misleading summary or justify keyword padding.
- Existing Cloudflare reader measurements for 30 September through 6 October
  show sitewide main content at 1,028 ms for the slower quarter boundary, with
  378 observations. Several profile and article families have fewer than 50
  observations. Extend the existing report to those families, keep its evidence
  floor, and avoid speculative speed rewrites or new tracking.
- Shared prevention: public navigation sitemap coverage; meaningful first responses;
  correct missing/private-page handling; bounded public-response checks after releases
  and daily; weekly technical evidence and monthly query/content/link review.

## Work sequence and owners

1. Lead (SEO) owns plan, browser account evidence, query and speed diagnosis,
   integration, independent acceptance review and live release.
2. Candidate-response helper owns candidate and legal first-response delivery,
   public navigation sitemap coverage and focused tests in an isolated worktree.
3. Search-health helper owns free bounded technical checks and their workflow/tests
   in a separate worktree. Reuse existing release and evidence retention machinery.
4. Minnesota-reference helper researches relevant citation destinations and prepares
   three private outreach drafts. It sends nothing and changes no website content.
5. Lead integrates accepted commits, implements only demonstrated further repairs,
   updates owning requirements and existing issues, runs relevant tests and browser
   checks, submits to the merge queue, waits for deployment and exercises live paths.

## Model selection

The lead recommends GPT-6.1 Sol high for the coupled website work. Bounded helpers
use GPT-6.1 Sol high with focused tests and lead review; Astra high is the strongest
credible alternative for unresolved judgment. Official OpenAI guidance read on
7 October supports Sol for complex coding and Astra for demanding reasoning; no
matched comparison establishes speed or quality equality. Reconsider on material
reasoning failures or evidence gaps, not routine I/O waits.

## Completion checks and remaining uncertainty

- Actual candidate facts, legal text and links are present before the app program runs.
- Privacy and unsupported records keep deliberate exclusions, 404 or 503 behavior.
- Public route coverage cannot silently omit a new shipped navigation destination.
- Scheduled checks cost no tokens or new service fees and retain failure evidence.
- Desktop and phone-browser paths remain readable, stable and usable.
- Current-head required checks, independent review and deployed-address checks pass.
- Google/Bing indexing and ranking remain search-engine decisions after our release.
- This primary Codex checkout is protected from removal; retain it if the app refuses
  supported archive after completion.

## Checkpoint

Branch `codex/sitewide-search-improvements`, base `5729ab64`.
Tracking: [issue 2501](https://github.com/alethical-org/alethical/issues/2501).
Candidate/legal first responses and free technical checks are integrated.
The independent phone-browser read found the dead Google privacy source link;
it now opens the official policy without changing words or visual direction.
Independent source acceptance covers durable pending notices, Retry-After
handling, fair bounded selection and a deployment-disabled state branch;
41 notice tests and 27 health tests pass. The public verification key is routed
only at its exact address. Full website tests pass 4,081 cases. The build with
public production settings uses 297,067 bytes against the 297,506-byte limit.
Local public browser stories pass 12 cases in Chromium and WebKit: desktop
keyboard use plus Android Chrome and iPhone Safari emulation with real touch
events, link taps and horizontal-overflow checks. A read-only test proxy supplies
the public API response to loopback without widening production browser access.
Physical phones remain untested. Firefox cannot start on this Mac because its
browser sandbox helper is denied; this is not a demonstrated website failure.
The same 12 browser stories pass on the live website, including both phone
browser emulations. A broader live response run passes 81 checks with 73 public
requests. The automatic release search-health run also passes.
The 3 outreach drafts remain private; the University of Minnesota official
reference service lists law-ref@umn.edu as its contact. Bing live fetches accept
1 bill, 1 legislator and numbered bill results, and reject a truly missing bill
with 404. Its 30-day All filter for 6 September through 5 October reports
9 clicks, 172 impressions and 5.23% click-through rate. Existing query evidence does not justify
rewriting truthful summaries to satisfy a provider's length recommendation.
The upload checks pass, including 4,224 server tests.
[Pull request 2508](https://github.com/alethical-org/alethical/pull/2508) merged
as release `4c30e9acf78ee66ac0967a91b17a4d51e272c9ae` on 7 October. That exact
commit reached the public website; its current-main tests and Reader completion
checks pass. Independent source acceptance on that exact release found no
material defect, missed affected use or missing prevention correction.

Trusted-main notice initialization saved 18,599 inventory entries and sent 0
old addresses. The automatic follow-up ran successfully without bulk submission.
The fixed state branch contains only its saved state and deployment-disabled
configuration. One deliberate notice for the changed `/candidates` first received
202, retained its retry, then received 200. This proves receipt, not indexing.

Fresh-context live reader review is partial: `/candidates` is readable on desktop,
and continuous pointer movement keeps its Search menu open above content. The
independent phone/detail/legal reading and a clean keyboard-menu test remain
unfinished. Browser access was refused because the administrator-enforced policy
could not be verified. No alternate browser route was used after that refusal.
The implementation is live, but final reader acceptance and working-folder
cleanup remain held until permitted browser access returns. Preserve the source,
private evidence and review progress; do not report full acceptance or close the
remaining review merely from the automated passes.

Weekly provider review and the monthly comparison in
[public-search-upkeep.md](../operations/public-search-upkeep.md) remain manual.
The first comparable 30-day Bing follow-up is 6 November. Private outreach drafts
are prepared; sending is still separately held. No paid recurring work was armed.
