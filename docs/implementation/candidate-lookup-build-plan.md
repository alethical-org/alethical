# Candidate lookup: build and release plan

<!-- describes: alethical/pipeline/candidate_catalogue.py, alethical/pipeline/candidate_ballot.py, apps/frontend/src/lib/candidateSearchState.ts, apps/frontend/src/components/candidates/CandidateSearchContent.tsx, apps/frontend/src/components/candidates/candidateFlow.ts, apps/frontend/src/screens/CandidatePreviewScreens.tsx, apps/frontend/src/lib/candidateLookupAvailability.ts, apps/frontend/metro.config.js -->

**Net:** The dormant record-handling foundation has been released. Build the reviewed
search and read-only profile screens in a private development preview. Public launch
still depends on supported local election areas, retained official records, freshness,
and end-to-end source checks.

Owner: Codex task **candidate lookup** (`01a0f355-a105-7543-8036-7c5274c0d5b7`).
Tracking: [Search candidates and candidate profiles](https://github.com/alethical-org/alethical/issues/147).

## Authorization and boundaries

On 30 September 2026 Eugene instructed: “give design prompt then start building
everything possible efficiently until designs are ready”. This authorizes the
independent build work and its checks. New visual choices wait for returned drawings
and review. Providing the Design prompt does not send it to Design.

The earlier meeting scope is street address → relevant filed candidates → claimable
candidate profiles. County, council, and school board offices are part of the intended
feature. Paid candidate services are separate later work. Browsing needs no account;
any eventual claim uses the existing account system. The claim-verification method,
private-evidence retention, and final launch geography remain unresolved. Do not build
an ownership shortcut based on possession of a publicly available filing certificate.

This follows the [product scope's candidate-data direction](../product-onboarding/product-scope.md)
and the [existing address-privacy policy](../product-onboarding/user-data-retention-policy.md).
The meeting notes and Eugene's instructions supply the narrower address-search scope;
the older saved requirements do not settle candidate claim verification.

The homepage and navigation have separate active design work. This branch does not
edit their components while that work continues. The candidate destination is
`/candidates`, plural. The homepage button and Search menu row say **Find My
Candidates**. The menu row sits above the existing legislator lookup; desktop supporting
text is **Enter your street address to see who’s running in your area**. Mobile has no supporting
text. The older planned `/search/candidates` entry remains inactive until rollout.

## Build order and ownership

| Work | Owner | Starts after | Completion check |
| --- | --- | --- | --- |
| Official filing and boundary source research | `candidate_sources` helper | Now | Primary URLs, formats, source scope, actual access and local gaps recorded |
| Strict election-file parser and offline retained import | `candidate_foundation` helper | Now | Real source excerpt, malformed-response rejection, election separation, immutable replay and coverage tests |
| Temporary browser search state | `candidate_search_state` helper | Now | Old responses cannot replace newer searches; retry retains coherent results; clearing removes private state |
| Source review, integration, documentation and independent review | Current task | Each result | Read actual source and code; focused checks; safe release of dormant foundation |
| Public search/results, homepage and menu integration | Current task | Reviewed drawings and source contract | Desktop/phone browser journeys; keyboard, slow/failure/retry and privacy checks |
| Candidate profiles and claim management | Current task | Profile/claim design review and settled identity/evidence rules | Public record remains immutable; account separation and claim-review checks |
| Public activation | Current task | Local coverage, source retention, freshness and end-to-end checks | Live supported-address lookup produces sourced candidates and honest gaps |

Each helper has separate new files. Current task owns shared-file integration,
documentation, commits, pull requests, and release. No recurring agent or paid data
purchase is authorized by this plan. No production dataset is replaced in this phase.

## Source and identity contract

The Secretary of State election-results `cand.txt` is a selected-election candidate
list, not the original candidate-filing search export. The 2026 primary and general
files are separate sources:

- [11 August primary candidate file](https://electionresultsfiles.sos.mn.gov/20260811/cand.txt)
- [3 November general candidate file](https://electionresultsfiles.sos.mn.gov/20261103/cand.txt)
- [3 November local candidate file](https://electionresultsfiles.sos.mn.gov/20261103/LocalCandTbl.txt)

On 30 September the [November reporting site](https://electionresults.sos.mn.gov/20261103)
is marked **TEST RESULTS**. Imports remain staged and cannot authorize public
candidate claims until reconciled with official filing records. A results-file
listing is not itself proof of a filing, withdrawal, or advancement.

The [2026 supporting-file layout](https://electionresults.sos.mn.gov/Results/MediaFileLayout/Index?erselectionId=201)
defines separate 7-column state/county and local schemas. Import by explicit
source kind rather than guessing from column count. Candidate IDs repeat across
counties; keys must include election, source kind, county, office, and candidate ID.
County `88` means statewide **or multi-county**, never statewide eligibility by
itself. Local school numbers need their district type and jurisdiction context;
independent and special school districts can share a number.

The original [filing-export layout](https://candidates.sos.mn.gov/Media/MediaFileFormat.txt)
is a different format and includes residence information. Do not feed it to the
results-file parser or publish residential/contact fields merely because they are
present in an official download. The current importer accepts only the minimal
candidate lists.

The [filing search](https://candidates.sos.mn.gov/CandidateFilingSearch.aspx) offers
separate filing and general-election downloads. Reading works in Chrome, but clicking
the general-election download reached a CAPTCHA on 30 September. No challenge was
completed or bypassed, and no original filing export was obtained. A permitted
download or another official source is still needed for reconciliation.

The existing campaign-finance reader keeps only office/name/party. Candidate lookup
must retain source candidate ID, office ID, county ID, party ID, full source label,
row number, source URL, retrieval time, and original-file hash. IDs retain leading
zeros. Do not infer cross-election person identity or link campaign registrations to
candidates by name alone. A campaign-finance account is not proof of ballot candidacy.

Keep original bytes before producing normalized records. Reject malformed, empty,
HTML/error, or internally conflicting imports. A repeated import must validate the
retained content rather than trusting an existing filename. Files from different
elections cannot overwrite each other. A disappeared row is not proof of withdrawal.

Only provable office/district relationships may produce matches. State House `1A`
must not match `11A`. Statewide eligibility, local district boundaries, and judicial
districts must each come from supported evidence. Unsupported offices remain retained
as source evidence rather than being silently discarded or guessed into a race.

Coverage is explicit. No imported rows, missing district boundaries, and unavailable
records are not authoritative empty races. An empty-race claim needs complete,
election-specific source evidence. A first parser capable of state matches does not
satisfy the intended local-office launch scope.

## Local boundary evidence, 30 September 2026

The [SOS precinct map service](https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_sos/bdry_votingdistricts/FeatureServer/0?f=json)
includes county, municipality, legislative, county-commissioner and ward identifiers,
but no school district. Its native coordinates are EPSG 26915. Any retained map needs
an explicit election-valid date and source hash; a download date alone is not enough.

The [MDE school map service](https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mde/bdry_school_district_boundaries/MapServer/0?f=pjson)
provides whole school district polygons with type (`sdtype`), number (`sdnumber`) and
name. It does not provide school-board electoral subdistricts. [Minneapolis's official
2026 filings](https://vote.minneapolismn.gov/candidates/candidate-filings/) distinguish
school-board Districts 1, 3 and 5 from at-large positions. A whole-school-district
match therefore cannot assign every board contest. Keep unresolved subdistrict races
out of address-specific results and show a coverage gap.

## Search and privacy contract

Use the existing government address suggestions and safe-match behavior. Do not depend
on current legislators being present to resolve a candidate search. The future public
lookup accepts address information in a request body and returns private, non-cached
responses. Addresses and coordinates must not enter URLs, metrics, logs, saved-account
records, campaign tools, or browser persistent storage.

The homepage hands the address to `/candidates` through temporary memory. Returning
from a candidate profile restores the current search during that app lifetime. A hard
reload or new tab can ask for the address again. Changing address or election retains
the previous successful result as one labelled unit while a newer result loads.
Never combine old rows with the new election label. A late response cannot replace
the latest request or restore cleared private state.

## Using the private importer

`python -m alethical.pipeline.candidate_catalogue` accepts an already downloaded
file. It does not fetch records, create database rows or publish a candidate page.
Use `--source-kind cand` for `cand.txt`, or `--source-kind local_cand` for
`LocalCandTbl.txt`. The exact official source URL must agree with the election date
and selected format. Supply the real retrieval time including its timezone.

An import saves original bytes and a checked JSON record together under the election,
source kind and file hash. Replay uses the same metadata and revalidates the retained
bytes; it does not silently refresh the first retrieval date or overwrite evidence.
Every output carries `publication_status: staged_only`. Import success never proves
that all races or candidates are covered.

The browser-state helper receives a lookup function supplied by its future caller.
Keep one instance above the homepage, search and profile routes. The helper does not
make network calls, resolve ambiguous addresses, or implement the drawn controls.

## Release holds

- Full original-filing imports, county/city/school-board matching and freshness rules
  need source proof before activation.
- The candidate list is not an official sample ballot. General-election results must
  not include everyone who filed for a primary.
- Public search and profile routes, homepage marketing and menu activation wait for
  functional destinations. Do not advertise this dormant foundation as live lookup.
- Candidate statements, uploaded evidence, verification emails, claim approvals and
  paid services are not implemented by the foundation.

## Progress

- Started from `origin/main` at `9474b8b6fe9186d2b9dd456f94b63f5f9b3982d8` on
  `codex/147-candidate-lookup-foundation` in the current task's isolated checkout.
- Delivered the `/candidates` search/results Design prompt in chat; it includes
  desktop, tablet, phone, ambiguity, partial coverage, election switching, and failures.
- Built the 2 offline source parsers, retained snapshots, exact state-race matching,
  and temporary browser search state. No public route, account claim, database table
  or source publication was added.
- Whole downloaded lists parse without dropping rows: 1,378 general state/federal/county
  rows, 367 primary rows, and 6,624 local rows. Every catalogue remains `staged_only`;
  all local matches remain unsupported rather than guessed.
- Search-state checks pass all 23 cases, including stale responses, failures, retries,
  cancellation callbacks, listener failures and address erasure. TypeScript and
  selected-file formatting pass.
- Backend parser, replay and integrity checks pass all 27 cases. Saved folders must
  agree with their election, source kind and original-file hash. Independent review
  accepted the corrected foundation. Required upload and hosted checks remain.

## 30 September: reviewed screens and private build

Eugene then instructed **“bd unless you need drawings”**. The latest completed design
is `Alethical UX (45).zip`. Search/results and read-only source profiles are build-ready.
Claims, management, campaign statements and services remain held. No additional drawing
is needed for the settled search/profile corrections described here.

- Build actual app components and lazy route wrappers for `/candidates` and
  `/candidates/<election-specific-record-id>`.
- Require both development mode and `EXPO_PUBLIC_CANDIDATE_LOOKUP_PREVIEW=true`.
  Production remains off even if someone sets the review flag.
- Use clearly labeled illustrative records only in the private development preview.
  There is no live candidate API or production candidate data replacement.
- Keep entered addresses, matched addresses and search results in memory. Route
  parameters, browser storage and profile URLs carry no address. Reload clears search
  state; profile return in the same app preserves coherent results.
- Read-only profile election comes from that record, independently of the search
  election. Unknown records show not found. No claim, owner or error-report control is
  shown until its supporting policy or destination exists.
- Omit unavailable filing dates and filing authorities. Preserve neutral party labels,
  source links and per-race checked dates. Use the current shared navigation across
  screen widths, including the drawer below 1100 pixels.
- Preserve previous results and their election label while replacements load. Failures
  keep usable results and retry. Only the latest request can replace displayed records.

### Official sample-ballot source evidence

The [official Minnesota sample-ballot website](https://myballotmn.sos.mn.gov/) uses
`/api/Streets/GetStreets?ZipCode=<zip>` and
`/api/PollingPlaceData/GetPollingPlaceData?prodAddressRangeId=<id>`.
The ZIP table supplies number bounds, parity, full street directions, suffix and unit
fields. Require exactly 1 complete match; unresolved units or multiple matches must
remain unresolved. Postal city is not municipality: a SHAKOPEE postal range returned
JACKSON TWP. P-1. Never assign city races from the postal name.

The current response supplies election ID `8334`, 3 November 2026, plus exact-precinct
ballot records, county, commissioner and school-subdistrict context. The shipped source
has no election-list or direct candidate-profile request. Reject a response for a different
requested election. Retain a separate public candidate index before supporting direct
profile requests; exclude voter addresses, range IDs and visitor-to-candidate associations.

Office/candidate codes collide across districts: `5000/9001` identifies different names
in SSD #1 and ISD #720. Preserve exact office title, district type, county and election.
The source's `SchoolDistrictId` is an internal selector ID, not the district number.
Exclude ballot questions and WRITE-IN placeholders. Governor names are 1 official joint
label; splitting on “and” does not establish separate person identities.

The [official Minneapolis W-3 P-12 sample ballot](https://myballotmn.sos.mn.gov/file/SampleBallotPdf/30AD9581-E181-40C9-B086-61E8974F220F.pdf)
has 2 pages, SHA-256
`7339516b10160e81122d6f7f05c43a8c86fd928a80c93842845f882fdafe9cea`.
It agrees with the source's governor tickets, Senate 59, House 59B and 4 SSD #1 at-large
school-board candidates for 2 seats. This proves ballot candidacy for those records,
not an original filing date or permission to control a candidate profile.

[The Secretary of State's ballot guidance](https://www.sos.mn.gov/elections-voting/whats-on-my-ballot/)
says some local sample ballots may be unavailable. Empty or unavailable source data
must not mean no candidates. The offline parser and strict range matching remain
inactive pending source retention, broader reconciliation, coverage and launch checks.

### Current checkpoint

Search/profile components, private routes, preview data and source parser are being
built and checked in `codex/147-candidate-search-build`. The previous foundation was
released through [pull request 2428](https://github.com/alethical-org/alethical/pull/2428).
Public navigation, homepage activation, claims and production source connection are
not part of this release. This task owns browser acceptance, independent review,
checks, release and the next source-backed integration step.

The private development preview runs at `http://localhost:19047/candidates` from this
worktree. It labels records **PRIVATE DRAFT · ILLUSTRATIVE DATA** and states that
entered addresses stay in the browser rather than claiming a real mapping request.
The production resolver excludes both private review modules from export, and the
release-asset check rejects illustrative records or controls in any exported program.

Acceptance repairs preserve the reviewed design: retain a newly typed address while
an older request is pending; cancel that older request; preserve the old address and
election beside old rows; retain the grey coverage panel; print **1 ticket listed**;
and use the leading back arrow. Shared input focus and link-arrow components supply
the existing approved treatments. No further drawing is required for these repairs.

Release checkpoint: 3,512 backend tests passed before the reserved write-in-code
correction; the affected parser's final 45 tests pass. The complete website suite
passed 3,852 tests; source-disclosure correction has its own focused check. Formatting,
backend lint, database type checks and website type checks pass. The production export
passes the unchanged startup-size limit and contains no illustrative candidate data.
The fresh user-path review passed keyboard and touch suggestions, explicit choices,
profile/back/direct links, unknown records, reload/clear, slow edits, failed replacement
and retry, rapid election changes and narrow screens. An initially blank response area
now states **No candidate records to show for this address and election**, without
claiming nobody filed. The correction passed a fresh browser review at desktop and
phone widths. Actual operating-system phone keyboard occlusion remains untested.
Current-main release remains in progress.
