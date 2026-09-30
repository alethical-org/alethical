# Candidate lookup: build and release plan

<!-- describes: alethical/pipeline/candidate_catalogue.py, apps/frontend/src/lib/candidateSearchState.ts -->

**Net:** Build the record-handling and temporary search-state foundation while the
candidate search drawings are prepared. Public launch still depends on reviewed
screens, supported local election areas, and retained official records.

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
`/candidates`, plural. The homepage button and Search menu row say **Find my
candidates**. The menu row sits above **Find My Legislator**; desktop supporting text
is **Enter your street address to see who has filed to run**. Mobile has no supporting
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
