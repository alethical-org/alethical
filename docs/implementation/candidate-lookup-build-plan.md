# Candidate lookup: build and release plan

<!-- describes: alethical/pipeline/candidate_catalogue.py, alethical/pipeline/candidate_ballot.py, apps/frontend/src/lib/candidateSearchState.ts, apps/frontend/src/components/candidates/CandidateSearchContent.tsx, apps/frontend/src/components/candidates/candidateFlow.ts, apps/frontend/src/screens/CandidatesScreen.tsx, apps/frontend/src/screens/CandidatePreviewScreens.tsx, apps/frontend/src/lib/candidateLookupAvailability.ts, apps/frontend/src/lib/staticPageMetadata.ts, apps/frontend/src/navigation/webRoutes.ts, api/page.ts, apps/frontend/metro.config.js -->

**Net:** The complete public candidate lookup, claim review and campaign statement
workflow is implemented. [Issue 147](https://github.com/alethical-org/alethical/issues/147)
records the hosted checks and live release evidence. The original preview remains `http://localhost:19047/candidates`.
The current behavior is owned by [How Find My Candidates works](../product-onboarding/find-my-candidates-guide.md).

The dated sections below retain the earlier decisions and checkpoints. Eugene's latest
instruction to finish the complete working feature supersedes the earlier interim stops;
the active scope and verification checkpoints are recorded at the end of this plan.

Owner: Codex task **candidate lookup** (`01a0f355-a105-7543-8036-7c5274c0d5b7`).
Tracking: [Search candidates and candidate profiles](https://github.com/alethical-org/alethical/issues/147).

## Authorization and boundaries

On 30 September 2026 Eugene instructed: “give design prompt then start building
everything possible efficiently until designs are ready”. This authorizes the
independent build work and its checks. New visual choices wait for returned drawings
and review. Providing the Design prompt does not send it to Design.

Later on 30 September Eugene corrected the destination scope, in this order:

1. “its a public page which Find my candidates in nav should go to (see task building nav)”
2. “go”
3. “remove private labeling”

This authorizes the public `/candidates` destination and removal of private labeling.
The navigation's **Find my candidates** link goes to `/candidates`; the separate
navigation task owns that integration. The accepted `/candidates` title remains
**Find My Candidates**. The public destination must not collect an address before a
real service is connected or substitute illustrative records for real candidates.
Development review retains **ILLUSTRATIVE DATA** so examples cannot be mistaken for
official records. Earlier private-release boundaries below are dated history, not a
continuing hold on the public destination.

Eugene's next instruction was: “eval why and when records are not avail and explain
to me, are we able to see everyone running for the nov election now? based on MN
public data, research more if needed to find everything the State informs”. That
research is separate from opening the destination. The public notice is **Candidate
records are not available on Alethical yet**, describing Alethical's unconnected
service rather than claiming Minnesota has not published records. Source research
must establish actual November coverage before promising everyone is included.

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
`/candidates`, plural. The homepage candidate button uses **Find My Candidates**;
the Search menu row uses **Find my candidates**. Homepage address handoff and working
lookup remain future integration. The separate navigation work owns the latest menu
layout and supporting text. The older planned `/search/candidates` entry remains inactive.

## Build order and ownership

| Work                                                             | Owner                           | Starts after                                                      | Completion check                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Official filing and boundary source research                     | `candidate_sources` helper      | Now                                                               | Primary URLs, formats, source scope, actual access and local gaps recorded                                                |
| Strict election-file parser and offline retained import          | `candidate_foundation` helper   | Now                                                               | Real source excerpt, malformed-response rejection, election separation, immutable replay and coverage tests               |
| Temporary browser search state                                   | `candidate_search_state` helper | Now                                                               | Old responses cannot replace newer searches; retry retains coherent results; clearing removes private state               |
| Source review, integration, documentation and independent review | Current task                    | Each result                                                       | Read actual source and code; focused checks; safe release of dormant foundation                                           |
| Public `/candidates` destination                                 | Current task                    | Authorized by Eugene's later correction                           | Production route and HTTP response succeed; truthful unavailable notice, official link, no address collection or examples |
| Navigation link to `/candidates`                                 | Separate navigation task        | Its authorized navigation build                                   | Find my candidates opens the public destination                                                                           |
| Real search/results and homepage address handoff                 | Current task                    | Reviewed drawings and source contract                             | Desktop/phone browser journeys; keyboard, slow/failure/retry and privacy checks                                           |
| Candidate profiles and claim management                          | Current task                    | Profile/claim design review and settled identity/evidence rules   | Public record remains immutable; account separation and claim-review checks                                               |
| Real candidate-data activation                                   | Current task                    | Local coverage, source retention, freshness and end-to-end checks | Live supported-address lookup produces sourced candidates and honest gaps                                                 |

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

The planned homepage integration hands the address to `/candidates` through temporary memory. Returning
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

## Holds on real data and claims

- Full original-filing imports, county/city/school-board matching and freshness rules
  need source proof before activation.
- The candidate list is not an official sample ballot. General-election results must
  not include everyone who filed for a primary.
- The public `/candidates` destination is authorized with its current unavailable
  state. Real search, source-backed profiles and homepage address handoff still need
  functional source-backed destinations. Do not advertise the unavailable state as
  a working address lookup.
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

### Earlier private release checkpoint, 30 September 2026

Search/profile components, private routes, preview data and the inactive source
parser were released through [pull request 2438](https://github.com/alethical-org/alethical/pull/2438).
The previous foundation was released through
[pull request 2428](https://github.com/alethical-org/alethical/pull/2428).
Public navigation, homepage activation, claims and production source connection were
not part of that release. The task retained the working development preview and the
next source-backed integration step. Original filing access, retained evidence,
supported local coverage and freshness remained unresolved; claims also awaited an
ownership-verification policy. The later public-destination approval above supersedes
the destination-only restriction, preserving the data and claim checks.

At that release the private development preview ran at `http://localhost:19047/candidates` from this
worktree. It labeled records **PRIVATE DRAFT · ILLUSTRATIVE DATA** and stated that
entered addresses stay in the browser rather than claiming a real mapping request.
The production resolver excludes both private review modules from export, and the
release-asset check rejects illustrative records or controls in any exported program.

Acceptance repairs preserve the reviewed design: retain a newly typed address while
an older request is pending; cancel that older request; preserve the old address and
election beside old rows; retain the grey coverage panel; print **1 ticket listed**;
and use the leading back arrow. Shared input focus and link-arrow components supply
the existing approved treatments. No further drawing is required for these repairs.

Release checkpoint: the current-main upload checks passed 3,519 backend tests and
3,870 website tests. The final affected parser check passes 45 tests and routing/
candidate checks pass 148 tests. Formatting, backend lint, database type checks and
website type checks pass. Production contains no illustrative candidate records.
A hosted preview exceeded the unchanged startup-size limit by 104 bytes before the
shared navigation reduction merged. Candidate route builders now compile out of
production; after rebasing onto the new shared navigation, the local export is
296,476 bytes against the unchanged 296,881-byte limit. Hosted preview passed its
own size check at 296,464 bytes, preserving the same limit. A password-bearing fake URL in a rejection test triggered the secret
scanner; the test now uses a password-free user-info URL, still rejected by the same
rule. The new commit history passes the scanner without exclusions.
The fresh user-path review passed keyboard and touch suggestions, explicit choices,
profile/back/direct links, unknown records, reload/clear, slow edits, failed replacement
and retry, rapid election changes and narrow screens. An initially blank response area
now states **No candidate records to show for this address and election**, without
claiming nobody filed. The correction passed a fresh browser review at desktop and
phone widths. Actual operating-system phone keyboard occlusion remains untested.
On 30 September 2026, website and server both reported release
`4f4ab204193f9b36db0e9d3231542c6275c5d361`. The live `/candidates` and example-profile
addresses returned 404 with that same website release and no illustrative records.
The final independent visitor review passed after deployment.
The accepted preview stayed at its original address; its worktree remained
available while Eugene reviewed it. Final release evidence and visitor acceptance are
recorded on [issue 147](https://github.com/alethical-org/alethical/issues/147).

## Public-destination build checkpoint, 30 September 2026

The later public build adds the normal `/candidates` route in every build and public
page metadata. Without development review enabled, the `/candidates` page shows its
title, Minnesota outline, **Candidate records are not available on Alethical yet**,
and **Minnesota sample ballot information**. No address box, election selector,
candidate-service request or example result is exposed. The public server returns
200 at `/candidates` and 404 for illustrative candidate-profile addresses, including
when a development review setting is accidentally present in production.

The development review removes **PRIVATE DRAFT**, preserving **ILLUSTRATIVE DATA**
and the explanation that example names are not candidate records. Production export
continues to exclude the example-record module. This checkpoint describes the build
underway; it is not evidence of deployment. The current release still needs normal
tests, production-export checks, hosted checks, deployment and live acceptance.

The [Find My Candidates guide](../product-onboarding/find-my-candidates-guide.md)
describes the public destination, official ballot link, current source-connection
limit, review states and address handling. The latest source research and future live
integration must update this checkpoint without rewriting the dated earlier release.

## November public-source review, 30 September 2026

The [Secretary of State's candidate filing search](https://candidates.sos.mn.gov/CandidateFilingSearch.aspx)
currently names the 3 November 2026 general election. It offers 4 distinct downloads:
all filings for federal/state/county offices, all filings for local offices,
general-election candidates for federal/state/county offices, and general-election
candidates for local offices. Use the general-election set for November results;
all filings are not a November ballot list. The filing search says withdrawn
candidates are removed. A later source snapshot must therefore not silently overwrite
the earlier retained evidence.

The [Secretary of State's ballot guidance](https://www.sos.mn.gov/elections-voting/whats-on-my-ballot/)
says sample-ballot information is posted about 45 days before an election and may
be missing for some local elections. When a local sample is unavailable, the guidance
directs readers to the city, town or school district holding that election. The 45-day
guidance does not explain Alethical's current unavailable notice: the official
November ballot service already supplies records, as the sample-ballot evidence
above shows. Alethical still needs to connect and retain that source for its own
working search.

3 official MyBallot responses retrieved on 30 September all carry election ID
`8334` and date `11/03/2026`. Their ballot-row counts include named candidates,
WRITE-IN placeholders and questions; they are not candidate counts:

| Official response                                                                                                            | Precinct             | Ballot rows | Local contests present                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| [Minneapolis range 316911](https://myballotmn.sos.mn.gov/api/PollingPlaceData/GetPollingPlaceData?prodAddressRangeId=316911) | MINNEAPOLIS W-3 P-12 | 101         | County commissioner, sheriff, attorney and SSD #1 at-large school board                               |
| [Eagan range 364000](https://myballotmn.sos.mn.gov/api/PollingPlaceData/GetPollingPlaceData?prodAddressRangeId=364000)       | EAGAN P-17           | 87          | County sheriff and attorney, Eagan mayor and council                                                  |
| [Cook range 801](https://myballotmn.sos.mn.gov/api/PollingPlaceData/GetPollingPlaceData?prodAddressRangeId=801)              | COOK                 | 78          | County offices, soil/water supervisors, Cook mayor and council, and ISD #2142 school-board District 2 |

Each response also supplies 1 sample-ballot entry. These 3 locations establish
available November state and local data, including school-board subdistrict detail;
they do not establish coverage for every Minnesota address. Raw address-range and
polling-place response data is not copied into this repository or published as a
visitor record.

The [2026 federal and state write-in request form](https://www.sos.mn.gov/media/3008/request-write-in-votes-be-counted-for-federal-and-state-office.pdf)
allows requests through 15 October 2026 at 5:00 p.m. for write-in votes to be counted
separately at the 3 November election. This is a federal/state deadline, not a
general rule for every local office. As of 30 September, it also prevents treating
today's records as a final list of every possible write-in candidate. The candidate
ballot parser's exclusion of unnamed WRITE-IN placeholders remains correct;
placeholders are not named candidate records.

Real source connection is the next implementation work, not an unapproved product
choice. Source retention, election matching, privacy, honest local gaps and freshness
remain completion checks. None of these measurements establishes statewide
completeness or authorizes claims about everyone running.

## Full working feature resumed, 30 September 2026

Eugene explicitly corrected the artificial stop: “i told you earlier to build
eveyrthing including what you have NEXT. build evveyrhting means everything to be
fully working, the ideal build, why didnt you start it?” He then instructed:
“update rules so you would have not stopped in this type of scenario given what I
instructed, and then keep building through the end”. These instructions carry the
existing full build through real data, profiles, claims, testing, release and live
acceptance. The temporary public notice and completed research were checkpoints,
not completion. Earlier implementation holds are replaced by the concrete checks
below. Candidate-specific paid services remain the explicitly later phase.

Current branch: `codex/147-complete-candidate-lookup`, same isolated checkout and
original preview `http://localhost:19047/candidates`.

1. Connect official current November ballots to full-address lookup. Match exact
   official address ranges, never ZIP alone; use bounded source requests and
   retain only sanitized public candidate evidence. Keep addresses out of logs,
   URLs, stored accounts and saved public records. Show source failures and missing
   local coverage honestly. Do not claim every Minnesota race is covered.
2. Activate the approved search/results and election-specific public profile
   screens, preserve temporary search state and stable updates, and wire homepage
   and navigation wording to actual working lookup.
3. Add claim requests to existing accounts. Public filing evidence establishes
   candidacy, not ownership. A signed-in applicant supplies a public campaign or
   filing reference and a private explanation. An Alethical administrator must
   independently verify candidate identity/control through an official published
   contact channel and record the evidence before approval. A public certificate
   alone is insufficient. No automatic email send or automatic approval is added.
4. An approved owner can maintain clearly labeled candidate-supplied text without
   editing official names, office, party, election or source facts. Withdrawal,
   rejection, revocation, account deletion and concurrent changes must be safe.
   Provide working applicant status and administrator review, with no private
   evidence exposed publicly. Candidate claims do not block voter lookup.
5. Test exact addresses and local contests, source outages and election mismatch,
   direct/back profiles, private-data handling, claim ownership, administrator
   access, races between requests, and phone/desktop flows. Apply additive schema
   changes only after migration and access-isolation tests pass.
6. Complete current-main checks, independent review, release and real deployed
   user-path tests. Keep this plan and issue147 current; no ready step becomes an
   unowned “Next” item. Only a real access, safety or new user-owned decision can
   block its affected work; continue the independent work.

Work ownership: source-backed server lookup and production search/profile wiring
run in separate helpers. The current task owns database changes, claims, combined
acceptance and release. A separate helper corrects the canonical working rules
without delaying this build.

### Integration checkpoint

The live source requires `Accept: text/plain`. Requesting `application/json` returns
JSON encoded inside a JSON string; the parser intentionally continues to require the
ordinary official object. Exact source range checks succeeded in Minneapolis, Eagan
and Cook. The public University of Minnesota address `326 17th Ave SE, Minneapolis,
MN 55414` succeeds with and without ZIP. City-hall examples not present in the official
residential range table honestly return no match.

The public form at the original preview returned real state, county and school-board
races. Acceptance found and corrected a source-wide coverage caveat being formatted as
one missing office, judicial offices grouped under local offices, and check dates shown
in UTC instead of Minnesota time. Full source labels sort alphabetically because the
source supplies no separate surname; joint-ticket labels remain intact.

The saved global completion rule is merged in
[tool-settings pull request 47](https://github.com/euglopi/tool-settings/pull/47) and active
in the linked local Codex and Claude rules. This checkpoint does not finish the candidate
build. Claims, homepage integration, independent acceptance, full checks and live release
remain actively owned in this task.

### Complete-build verification checkpoint

The homepage now submits a real lookup and carries successful results or address
choices to `/candidates` in temporary memory. The initial HTML also links to the
public destination. The generic address placeholder replaces a city-hall example
that is absent from Minnesota's residential street ranges. The Minnesota outline
retains the supplied desktop/tablet treatment and is omitted on phone.

Security review corrections now preserve apartment/unit input through no-ZIP
matching, require confirmation of complete geocoded addresses, and distinguish
malformed source data from an unmatched address. Private database failures are
replaced with a generic response before the original exception can reach runtime
logs. Staff review identifies the confirmed account email receiving ownership.

The complete backend suite passed 3600 tests. Separate source, claim and migration
checks include concurrent ownership/revocation, privacy boundaries, rollback and
RLS. The migrated and declared database shapes match: 101 tables, 1127 columns.
The homepage passed 174 focused tests and actual desktop/tablet/phone checks,
including a real home-to-results lookup at the original preview address.

Final rendered account-change clearing, Minnesota election-evening behavior,
independent visitor review, current-main export, hosted checks and live release
remain part of this same active build, not a deferred scope or a new approval.

### Final local acceptance, 30 September 2026

Independent security and signed-out visitor reviews accepted the working feature.
Address confirmation without a ZIP, failed lookup and retry, direct public profiles,
back navigation, signed-out claim entry, keyboard focus, and phone/tablet layouts
passed at the original preview. Both address forms grow to show long addresses.
Same-account sign-in refresh preserves an unsaved campaign draft; changing accounts
still clears private state and cancels pending work.

After rebasing onto current main, all 3985 frontend tests passed across 320 files.
The production web export passed its local first-load check at 296623 bytes of
297506. Hosted builds must pass their own measured limit. Completed sign-in and
real candidate claims were deliberately not submitted during public browser testing;
authenticated claim, ownership and statement behavior is covered by isolated tests.

The release owner carries the tested change through upload checks, hosted checks,
merge, deployment and live user-path checks. The linked issue holds their exact
commit and deployment evidence rather than treating a local checkpoint as live.


## Public design release, October 1, 2026

Eugene authorized “set. build through live deployment without stop”. The pinned
input is Alethical UX (51).zip; the complete scope and independent coverage review
are recorded in [Candidate design acceptance](candidate-design-release-acceptance.md).
Public search/profile drawings and homepage candidate-search copy are implemented;
claim/manage redraw remains excluded. Existing staff-reviewed ownership is preserved.

The release includes group disclosure/jump controls, subordinate Judges, exact
source sharing, coherent election updates, the redesigned public record and
campaign/report states, and confirmed legislator connections with official portraits.
The reviewed identity register enables 7 current saved records without a database
migration or production data replacement. Unsupported identities remain unlinked.
The original preview remains http://localhost:19047/candidates. The public design
release is live through [pull request 2463](https://github.com/alethical-org/alethical/pull/2463),
with the live-review court-label correction in
[pull request 2466](https://github.com/alethical-org/alethical/pull/2466).
Both website and API report
[commit 2db25f2f](https://github.com/alethical-org/alethical/commit/2db25f2f11f392a16a86a68ac6eb9c5574a583f7).
All 3,650 backend and 4,012 frontend tests pass. Independent live browser review
covered homepage-to-results, group controls, profile/back navigation, phone/tablet
layouts and unknown profiles. All 7 reviewed legislator connections and official
portrait URLs respond correctly. The exact live paths, corrections and limits are
saved in [Candidate design acceptance](candidate-design-release-acceptance.md#live-acceptance-october-1-2026).


## Address suggestions consultation, October 8, 2026

Review only; no new application build is authorized by this consultation. Eugene
requested direct consultation in the existing Alethical UX project and then
explicitly authorized continuing the chat. The original supplied brief is
`/Users/eug/.codex/attachments/5e85f9b9-3c6b-4258-ac22-11e0049793b5/Pasted text.txt`.
Design's first response is the top reply card in
[Alethical UX Prompt.dc.html](https://claude.ai/design/p/e592f874-1b47-4dda-a8d9-2e9f086f2bac?file=Prompt.dc.html).
Two subsequent chat exchanges accepted the corrections below. They supersede
conflicting details in that reply card. This is a proposed approach, not a record
that application behavior or approved product requirements have been changed.

- Evidence: candidate and legislator forms differ in debounce, selection,
  guidance and styling. Existing candidate guide activates the first option;
  Design reports its current drawing opens without an active option. The proposed
  no-active-option behavior must update the written requirement during an approved build.
- Affected uses: candidate entry, candidate Change address and Find my legislator.
  Share presentation/interaction, preserving their separate services, matching,
  source notices, privacy boundaries and ambiguous-address confirmation.
- Proposed behavior: house number plus 2 street-name characters or first numbered
  street digit; 180ms pause; at most 5 Minnesota suggestions; newest request only.
  No active option on opening; Down/Up select first/last and wrap; Enter submits
  typed input unless an option is active. Hover grey, keyboard active green;
  hover never changes the keyboard target and green wins on overlap.
- Preserve Design's panel, pin, row spacing and full wrapped address treatment.
  Entry fields/buttons are 60px; Change address remains a 56px field with 52px
  button. Label and hint precede the field. Normal rows use fill, with an active
  outline in forced-colors mode. Suggestions remain above ordinary content and
  below dialogs, with pointer access across the panel.
- Completed clicks/taps select, never initial touch-down. Preserve scrolling and
  cancellation, first-tap selection and a stable Search button through dismissal.
  A focus event with null relatedTarget must not erase an in-progress tap.
- Phone: reveal only as needed after keyboard resize, keep label clearance of
  12px when feasible, and stop unsolicited adjustments after manual scrolling.
  Deliberate arrow navigation still reveals the active row. No inner list scroller.
- Preserve autofill submission from the current field, US suffix normalization,
  units/directions/ZIP+4, latest-request handling and drafts on failure. Carry a
  typed unit only after establishing the same base location, respecting supplied
  city/state/ZIP. Never append a unit to an unrelated address or silently change it.
- Optional suggestion failure stays quiet; submitted search retains errors/retry.
  Find my legislators uses Finding… in a steady button. First-load placeholders
  only when no usable results exist; later searches retain old results and their
  true address/context until the replacement succeeds.
- Spoken counts on each opening and count changes while open, silent on closing.
  Neutral wording by default; keyboard guidance follows actual input method, not
  attempted screen-reader detection. Reuse readable autofill styling and preserve
  system high-contrast colors.
- Prevention: shared component checks for typing/autofill/edit/Enter, stale answers,
  click versus scroll/cancel, failed searches, unit mismatch, wrapped text, layering,
  keyboard and screen-reader use. Real iPhone/Android keyboard and accessibility
  behavior remains untested until the authorized implementation is exercised.
- Separate exposure: sign-in restoration can reset candidate input; tracked in
  [issue 2529](https://github.com/alethical-org/alethical/issues/2529), not fixed by
  this list change. Removing legislator addresses from URLs is a separate proposed
  privacy change requiring its own product approval.
- Owner: current Codex task candidate lookup. Review outcome: no remaining material
  disagreement on the proposed approach; implementation and device checks are pending.


### Build authorization and model selection, October 8, 2026

Eugene said "build", then interrupted to ask which tier should build it. The
approved address-suggestions scope now includes implementation, tests, browser
review, Design record updates and verified live release. The separate sign-in
restoration issue and legislator URL privacy change remain outside this scope.

Recommendation: gpt-6-astra with high reasoning. Strongest practical alternative:
gpt-6.1-sol with high or xhigh reasoning. Visual decisions are settled, but the
lead still owns shared browser event ordering, autofill, asynchronous request
replacement, address identity/unit preservation and accessible phone behavior.
Current official OpenAI model-selection and Astra guidance (read October 8)
positions Astra for demanding reasoning, coding and computer use; high is supported
by the receiving host. High is the task judgment for these interacting constraints;
there is no task-specific comparative measurement proving speed or equal quality.
The choice does not claim Astra can substitute for unavailable physical devices.
Sources: https://developers.openai.com/api/docs/guides/model-selection and
https://developers.openai.com/api/docs/models/gpt-6-astra .
No application edits started before the tier question. Resume the authorized build
when the user's setting discussion is complete; do not require another build go.

### Active build and acceptance order

The build authorization supersedes the review-only status above. Eugene subsequently
said: "test what you can and then deploy live before I can test on actual phones,
right?" Available automated and computer-browser checks precede deployment; his
physical iPhone/Android checks follow the live release. Neither emulation nor
synthetic input is evidence that real keyboard saved-address suggestions were tested.

Implementation is on `codex/shared-address-suggestions`, based on current main.
The frontend worker owns the shared field/list, both integrations and focused tests;
the lead owns the guides, Design record update, independent review and release.
Steps: implement with focused tests; review integration and browser flows; complete
required checks; merge and deploy; exercise live search; retain exact phone-test gaps
for Eugene. No worker changes the separate sign-in restoration or URL privacy scope.


### Shared address design comparison and prevention

Tracked in [issue 2535](https://github.com/alethical-org/alethical/issues/2535).
The supplied `Pasted text.txt` has SHA-256
`17bc69f8af917bff748d33e11c2ca2f0e99c1f426b03ee654a9579780d4cac9e`.
The accepted sources are the address controls in `Candidates search.dc.html`,
`LIVE Find My Legislator.dc.html`, and the 2 direct consultation clarifications
recorded above. The 768px and 1100px layout boundaries remain unchanged.
The comparison covers these control sections in visual order:

| Section | Required outcome | Evidence to collect |
| --- | --- | --- |
| Heading, field label and hint | Plural legislator heading; Full street address; surface-specific city/ZIP hint above field | Rendered entry and Change address at phone, tablet and computer widths |
| Field | Entry 60px; compact 56px; full wrapping, saved-address readability, purple typing focus | Dimensions, long text, browser-filled current value and keyboard submit |
| Optional suggestions | 180ms eligibility trigger; at most 5; singular/plural heading; quiet empty/failure; latest text only | Focused tests and partial-typing browser paths |
| List position and rows | Overlay at field width on larger screens; inline on phone; 8px gap; approved pin, padding, type and fills | Rendered list, row hit targets and overflow checks |
| Selection and dismissal | No initial selection; independent mouse/keyboard states; wrapped arrow navigation; completed tap; no scroll selection; Escape/Tab/outside | Focused event tests and browser keyboard/click paths |
| Submit buttons | Entry 60px and compact 52px; first click delivered; stable busy label/spinner; no repeated submission | Busy and first-click tests; actual browser submit |
| Source and results context | Preserve distinct sources/privacy; retain previous success and its address during replacement/failure | Integration tests, guides and search-result browser paths |
| Address identity | Preserve US-suffix handling, units, direction and ZIP+4; never transfer a unit across different supplied locations | Matching-boundary tests and displayed/submitted equality |
| Phone access | Small necessary reveal, manual-scroll suppression, arrow reveal, no inner list scroller | Browser narrow widths plus explicit physical-phone follow-up |
| Spoken state | Neutral count on opening and count change; silent closing; valid combobox/list relationships | Accessibility attributes and announcement tests |

The independent reviewer checks the source-to-requirement coverage and the shared
implementation for missing affected uses. The shared field is the prevention
mechanism for divergence between the 3 forms; their lookup services and ambiguity
confirmation remain separate. Browser checks do not establish physical keyboard,
VoiceOver or TalkBack behavior. Those limits remain explicit after deployment.

### Shared address acceptance

The current-main frontend suite passes 4,225 tests across 334 files.
The required upload check also passes all 4,602 backend tests. TypeScript, frontend
formatting, documentation checks and the production web build pass. The production
build measures 296,135 first-load bytes against the 297,506-byte limit. Independent
source review found no remaining actionable frontend defects. A fresh-context
browser reviewer exercised candidate and legislator searches at 390px, 900px and
1440px, including partial typing, keyboard selection, click selection, typed Enter,
country suffixes, Change address, dismissal, retry and retained result context.
Physical iPhone/Android keyboards and VoiceOver/TalkBack remain untested.

The selected legislator suggestion initially showed coordinates as its result
address. The implementation now binds the selected readable street address to its
exact request and preserves that address with retained results. Focused tests and
the fresh browser review cover the correction.

The candidate example at 350 S 5th St, Minneapolis, MN 55415 cannot match the official
candidate address ranges even when submitted directly without a suggestion. On
2026-10-08 the official SOS GetStreets response for ZIP 55415 had 44 ranges, and
the sole 5TH ST S range (316911) covered only even house 600. The mapping service
suggests 350, but candidate lookup requires the separate SOS range. Preserve safe
no-match rather than borrowing another address's ballot; this source limitation
is independent of the shared control.

Design updated `Candidates search.dc.html`, `LIVE Find My Legislator.dc.html` and
the shared-address section of `build-facts-candidates.md` in Alethical UX. The lead
inspected the rendered controls and read the saved notes. The candidate apartment
specimen was corrected to an explicit matching S direction with 1 suggestion;
uncertain unit transfer omits the optional suggestion and leaves typed submission
available. No additional address confirmation flow was introduced.
