# Election finance comparison

Authorized November 11, 2026: deliver Minnesota election/race comparisons through
source collection, reviewed Design drawings, implementation, safe release and live
verification. Owner: Election finance comparison, Codex chat
`01a1b12c-cb88-7112-a09f-36ca15693289`.

## Required outcome

Readers select an exact election and race, see every candidate and reported votes
down to the precinct, then compare separately labelled direct contributions,
campaign expenditure and documented outside support/opposition. Each figure opens
its source and retains its period, version and availability. Missing is not zero.
No calculation claims spending caused an outcome. A factual support/outcome count
counts distinct candidacies, preserves pending outcomes and defines its scope.

## Release order: V1, V1.1, V2 video, V1.2, V3

Release the approved working screens and Jeremy's campaign expense/public subsidy
report as V1. Screens may release with the checked data already available, but that
early release does not by itself finish Jeremy's data request. V1 follows an 80/20
delivery priority: make the screens live first, then deliver the main party spending,
subsidy, payee, Minnesota/out-of-state, exclusion and source-backed CSV comparisons.
Prioritize newer available Board filings/amendments and unresolved nonjudicial
candidate/account links. Rank other recoverable gaps by their effect on the report's
amounts and conclusions, not only record counts. Judicial coverage, complete street
addresses and small reconciliation gaps can remain explicit follow-up items; they
must not block the useful report. Unknown amounts stay unknown, never assumed small.
Distinguish an unfinished check from information not published or unavailable in the
source. Do not use the percentage checked within collected reports as a measure of
complete candidate or filing coverage. Finish the report's live reader journey and
independent acceptance, notify the user with the live result, then continue to V1.1.

V1.1 closes material gaps in Jeremy's report: remaining candidate/account matches,
available newer filings and amendments, and any other gap that could change the main
comparisons. Prioritize unresolved nonjudicial candidacies and party-comparison
uncertainty, then remaining judicial candidate coverage within the Board report's
scope. Account for every missing candidate with checked records or an evidenced
availability status; unavailable or not-yet-checked records are not zero spending.
Do not promise financial records that the source has not published. Notify after the
V1.1 result is live and independently checked, then continue to the V2 report video.

V1.2 closes lower-impact remaining report gaps: available street detail when geography
is already known, small measured expense/subsidy discrepancies and authorized usability
refinements from report review. Investigate unknown impact before assigning this
priority; a material gap belongs in V1.1. Do not manufacture separate work or delay a
ready correction just to preserve version labels. If earlier work resolves a V1.2
item, record it as completed there. V1.2 follows V2 so the useful report video reaches
Jeremy before these smaller refinements finish. Notify when the V1.2 report result
is live and independently accepted, then continue to V3 planning and build. No new
approval is required between these approved versions.

The legacy Board race comparison has a separate source-read follow-up in V1.2:
`election_finance_reads` obtains account quote proofs through
`election_account_reviews.applicable_accounts`, whose quote reader can treat an
operational storage failure as unavailable evidence. Propagate a request-scoped
failure marker through that path and test retryable failure, genuine missing proof
and exact-version recovery. This is separate from Jeremy's expense report reader;
the expense recovery checks do not establish coverage of that legacy path. No live
occurrence or amount affected has been established.

V2 is the approved live-product walkthrough video for Jeremy's report only, using
the completed V1.1 journey, female ElevenLabs narration and selective explanatory
captions/annotations. Show the main questions, filters, comparisons, payee exclusions,
source inspection and CSV, with accurate limits. Deliver the checked video and notify
the user, then continue to V1.2; public posting or sending it to other people remains
separate authorization.
Do not make full election coverage or a wider election-results video a V2 dependency.

V3 is full election coverage. After V2 and V1.2 are complete, propose V3's own 80/20 priority
breakdown, smaller releases, dependencies, acceptance checks and remaining source
gaps. Present and record that plan, then start its build under the user's explicit
advance approval of the lead's 80/20 plan. No further go is required within the
approved full-election scope; new product choices, spending and source/safety holds
remain separate. Preserve all wider local/federal/outcome scope and prepared work
until V3 reaches its turn. Notify after each release is live and checked, and give
periodic ballpark progress for the active release with remaining work and uncertainty.
The V3 planning boundary does not hold the approved V1-series or V2 work. Follow the shared
[early working release rule](https://github.com/euglopi/tool-settings/blob/main/shared/guides/build-completion.md).

The first screen release must provide a usable report journey: candidate and party totals,
public subsidy, payee details and filed addresses, location comparison, manual payee
exclusions, source evidence and CSV download. Show a short scoped notice that data
work continues, alongside actual coverage and source dates. Keep unavailable values
and partial totals explicit. Do not hold this working Board-report release for
exhaustive local/federal recovery, every certified outcome or video production.
Source, identity, amendment, access, review, rollback and live-check requirements
still apply to every included record and released action.

## Election scope

Initial source scope is the November 3, 2026 Minnesota general election. Recover
officially available candidate and result records for that election. Financial
coverage follows each actual filing authority and available period; do not claim
state Board files cover federal or every local campaign. Do not expand historical
coverage or invent further reports from Angel's still-pending research.

## Required campaign expense report

The required deliverable also includes a repeatable report from the latest available
2026 Minnesota Campaign Finance Board filings: candidate, filed party, public
subsidy received, and campaign expenses grouped by payee with available filed
address and purpose. Provide Republican/Democratic comparisons, separate other
parties, nonpartisan candidates and unknown parties, subsidy totals, and
Minnesota/out-of-state/unknown payee-address breakdowns. Retain the complete baseline alongside an explicitly adjusted view
excluding Comcast, Facebook, Google and an agreed list of additional media companies.
The additional companies and alias/intermediary rules remain unresolved.

Every total retains its period, source and effective amendment. Do not add overlapping
cumulative reports, count outside spending as the candidate's own expenses, or treat
unpaid amounts as paid. Keep non-itemized amounts and missing addresses visible;
recover available original evidence without inventing payees or street addresses.
Address geography describes the filed address, not where work or economic benefit
occurred. Subsidy receipts and expenses do not trace particular subsidy dollars to
particular vendors. A policy assessment needs the actual bill and its question.

Choosing a reporting period uses only its explicitly selected effective reports,
including after candidate search, payee drilldown, pagination and CSV export.
Candidates without a matching selected report remain visible with the report gap;
their later reports never silently enter the comparison. Latest available reports
is a separate choice. Identical named periods can share a menu choice across
account-specific filing codes, while each account keeps its own source and amendment.
The selection mode participates in the response version, including an empty selection.

The shared name search filters the candidate and payee lists independently; report
totals keep the complete selected scope. CSV retains that scope and the exact search
text, marking matching candidate and payee/payment rows separately. Candidates with
missing reports can still match. Excluded payees remain in the baseline, marked as
excluded from the adjusted view. Name search never changes account ownership or
allocates shared money.

Retained Board report responses identify their verified PDF bytes as PDF, so the
evidence view can open the cited page. Direct downloads keep a descriptive filename;
other retained source types remain downloads, with the same access and source checks.

A temporary failure to read retained evidence fails the request with a safe retry
action; it never yields a successful report with fewer accounts or lower totals.
Previous figures remain visibly previous during recovery, with current exports
disabled. Confirmed missing or invalid evidence still produces the existing scoped
gap. Every recovery checks the source bytes afresh.

Candidate party comes from the exact retained official election record that holds
the value; its literal value and source remain available. Local candidate rosters
without a party column cannot supply that field: retain the official result-row
source when it supplies the local nonpartisan value. A differing campaign-account
party stays separately sourced.
The report evidence view opens the exact retained party source. Show a row locator
only when held; an unavailable locator never becomes an invented row number.
Financial totals count each selected account/report once. Classify a shared account
using all source-valid memberships before applying race, candidate or party display
filters. Conflicting memberships do not justify assigning its money to either party
or dividing it between candidates. Unassigned account money and missing candidate
party are distinct gaps; candidate counts and unique account counts remain distinct.
The money-only "Party cannot be assigned" row does not count candidates again;
its empty candidate-count cell has the accessible description "Not applicable".
A candidate filter keeps the "Shared campaign account" label and, for conflicting
ballot parties, "Shared account, different ballot parties". Evidence retains all
source-valid memberships used to classify that account.

A checked report total can remain available when its itemized expenses do not
reconcile. Unreconciled rows stay out of checked itemized, location and adjusted
totals; show the affected gap and known subtotal with coverage for each measure.
Beside the party comparison, identify reports omitted from adjusted totals and link
to each original, so an unavailable detail set cannot look like a payee exclusion.
Each report's exact original, period, amendment and copy date belong in its evidence
view. The page footer groups publishers and datasets without repeating hundreds of
report links or implying that reports with different copy dates were copied together.

The report and downloadable detail are acceptance requirements alongside the full
election comparison. The visible report download is CSV, for spreadsheet analysis.
JSON remains available through the authenticated API, without a user-facing format
choice.
Display amounts and missing values follow the product-wide [whole-dollar and
unavailable-value rules](../design/ui-copy-guide.md#display-dollar-amounts-without-cents).
Exact calculation inputs and analysis exports retain cents; rendered money drops them
without rounding. The new rule replaces earlier exact-cents screen instructions.
Remove the JSON button with the released drawing corrections.
New Finance report layouts need reviewed drawings; data
collection, checked calculations and exports do not depend on those drawings.
Reuse the existing page's design file and approved components where applicable.
The user released the collected corrections and authorized the full build on
November 12 with “go list, build everything - full build”. Apply and review those
corrections before dependent expense UI implementation; independent work continues.
Design work uses the
Chrome profile signed in as `alethicaldev@gmail.com`. Sources unavailable at the
report cutoff stay pending; recoverable collection gaps remain unfinished work.

## Required live-product walkthrough video

V2 follows the completed V1.1 report, before V1.2, and shows only the real live-product journey
for Jeremy's campaign-expense request. The current chat owns its specification,
production and final review. The approved scope includes the journey, female
ElevenLabs narration and caption treatment below. No further spec approval is needed.
Follow the shared
[spec-before-design rule](https://github.com/euglopi/tool-settings/blob/main/shared/guides/spec-before-design.md):
spec-before-design sequence using this approval; the existing product build continues.

The approved journey starts with the requested report, then demonstrates how to:

1. Select the 2026 election and available reporting periods; identify actual filing
   coverage, amendments and remaining gaps.
2. Compare candidates, party, campaign expenses and public subsidy received, including
   Republican/Democratic totals and the other supported party categories.
3. Inspect spending by payee, filed address and purpose; compare Minnesota, out-of-state
   and unavailable locations.
4. Exclude selected payees, including the requested media companies, and compare the
   complete baseline with adjusted results. Show that subsidy totals stay unchanged.
5. Open the exact supporting filing and download the usable CSV for further analysis.

Election-result, precinct and funder-outcome demonstrations are outside this V2 video.

Use a female voiceover from ElevenLabs with existing credits, under the approved
[media-tool rule](https://github.com/euglopi/tool-settings/blob/main/shared/PERSONAL_RULES.md#public-copy).
Select the exact voice during production. Caption treatment: optional full
narration captions in readable phrases, with brief on-screen callouts only when they
add useful meaning; no duplicate text or word-by-word animation. Choose duration,
chapters and a usable delivery format within this scope. Existing credits are authorized;
extra purchases or plan changes require separate authorization.

Independent scripting and media planning may run alongside the product build only
when they do not delay the higher-priority report. Final capture requires the completed,
checked live journey and actual
records. Use the approved product design and plain language; show sources and material
gaps. Do not imply that subsidy dollars are traced to a vendor, that a filed address
proves where work occurred, that spending caused a win or loss, or that the findings
justify a bill without the bill and an appropriate analysis.

Acceptance covers every requested question, usable visible actions and export,
readable screen detail, accurate synchronized narration/captions, source-date agreement,
and a complete watch-through of the exported file. Preserve original footage and
final media under the [video workflow](../operations/video/README.md). Do not record
credentials or unrelated private material. Production and delivery do not themselves
authorize public upload or sending the video to other people.

## Ownership and open choices

Reuse supported filing import/reconciliation functions. This task owns the minimum
durable candidacy/account review contract needed by the comparison; the navigation
task will reuse it. Their broader builds remain stopped. This task may implement
and run the bounded source work needed for this comparison; it does not redesign global navigation, rich profiles,
committee officers, general uploads or Media Buys.

The transition into Currently elected, its certification threshold, departure and
appointment rules remain product decisions. Store supported outcome and term facts
without resolving those categories or calling incoming winners already serving.
Additional report measures remain open. The comparison can proceed independently.

## Delivery sequence and evidence

1. Inventory official and held sources, preserve originals and hashes, reconcile
   all available race/precinct records and record gaps and source dates.
2. Define repeat-safe, versioned election/result storage and exact identity links;
   reuse finance periods and amendment rules. Validate source bytes before release.
3. Supply source-checked content to the existing Alethical B2B Design project in a
   fresh chat. Review drawings, states, notes and rules before dependent UI work.
4. Build the comparison and source drilldowns; test source failures, corrections,
   overlapping filings, zeros, missing values and ambiguous links.
5. Validate a real race end to end, independently review, release with a concrete
   restore path, and verify live access and the full reader journey.
6. After the checked V1.1 report, capture Jeremy's requested report journey,
   produce narration/captions and deliver the reviewed V2 video, then finish V1.2.
   Propose the V3
   full-election coverage priorities and smaller releases, then begin the build under
   the user's advance approval, preserving all source/review/release gates.

## Status

### Full post-election analytics build

The authorized finish includes all available Minnesota November 3, 2026 state,
federal and local race and precinct records, matching campaign filings, descriptive
funder outcomes and repeatable comparisons. The released comparison below is a
milestone, not completion of that finish. An explicitly labelled recoverable gap
remains unfinished collection work. Unpublished sources remain pending with their
actual authority, period and next expected filing event; they never become zero.

The current chat retains these work packages. The release order above governs:
V1, V1.1, V2 report video, V1.2, then the V3 coverage plan and build.

| Work | Prerequisite | Acceptance evidence |
| --- | --- | --- |
| Results, state filings, federal/local filing inventories | Retained release manifests | Expected-versus-held records by authority, race, precinct and period; dated official sources |
| Collection and repeat-safe refresh adapters | Accepted per-source identity, period and amendment rules | Original bytes and hashes, exact parsed values, recoverable gaps collected, failures retry without duplicates |
| Supported outcomes | Exact-race authority evidence | Certification, recount and tie states stay distinct; no winner inferred from ranking or elapsed time |
| Spending and funder analytics | Reviewed identities and source versions | Direct contributions, campaign spending and outside support/opposition remain separate; distinct candidacies and pending outcomes reconcile |
| Reports, filters and dated exports | Stable API and reviewed design | Candidate, race, district, funder and reporting-period journeys; each figure opens its source; documented purpose and vendor detail |
| Independent acceptance and release | Integrated implementation and corrected findings | Requirement-to-evidence checklist, current-head checks, reversible publication and live review |
| V2 report walkthrough video | Approved report-video spec; completed, checked V1.1 journey for final capture | Jeremy's requested expense/subsidy comparisons demonstrated; readable footage, accurate voiceover/captions and reviewed final export |

PAC-only totals require an evidenced committee classification. Board political
committees/funds and party units are not silently relabelled PACs. Reported
calendar-year amounts do not become general-election-only spending. Spending
around a race is not apportioned to precincts without a source that supports it.
Exports preserve source versions, actual periods, availability and outcome status.
No export action publishes social content or sends prospective-client outreach.

Federal memo entries retain their literal amounts, dates and source as supplemental
detail. They are not added to committee payments or spending totals. An original
purchase date can precede the report containing its reimbursement; it does not become
the reimbursement date. Source-marked federal memos have explicit nonadditive metadata,
and their candidate association requires checked account coverage of the containing
report. Other authorities do not inherit federal memo semantics. See the FEC's
[memo-entry explanation](https://www.fec.gov/updates/check-the-box-to-report-memo-entries-2/)
and [staff-reimbursement guidance](https://www.fec.gov/help-candidates-and-committees/filing-reports/staff-reimbursements/).
An external account review may cover a continuous interval supported by several
checked report covers for that exact account. Every day must be covered; missing days
and missing cover evidence stop confirmation. This supports quarterly reports without
adding their figures or treating one representative report as full-cycle evidence.

Federal and local report figures retain their source-native measure, currency and
period beside each value. They do not inherit Board expense or public-subsidy column
headings. Itemized native payments, nonadditive memo detail and cover totals remain
separate views. Mixed-authority summaries never add them to a single Board total.
Each coverage count names its authority scope; account-report counts are not candidate
counts. Exact filed address bindings supply location groups, with unknowns preserved.

Funder analytics keep exact authority/account identity and the source's explicit
support or opposition classification. Own-campaign vendor payments do not establish
outside support. Where periods overlap, currencies differ or multiple native report
contexts cannot be combined, show separate report amounts and a concise reason for
the unavailable aggregate. CSV exports retain the complete checked baseline, mark
which detail rows match the selected filters and exclusions, and open the exact source
through the authenticated Finance route without embedding credentials.

The race CSV includes own-account payment detail from selected reports. Account-holder
and target candidacies have separate columns; one physical payment appears once even
when both relationships are checked. A missing target stays blank, and filed addresses
retain their literal text without inferring a street or city. A report with unknown
amendment status is available only through explicit exact-document selection; its
payments remain nonadditive and do not enter checked expense or funder totals.

The background helpers report to this chat. One writer owns each file or shared
resource; up to three independent helpers work alongside the lead. New visual
choices retain Design review. The separate People/navigation work, incoming
officeholder membership rules and additional measures from Angel's research stay
with their existing decisions and owners.

### Expanded build checkpoint, November 12, 2026

The expanded expense, public-subsidy, payee, funder and mixed-authority report
paths are implemented on the build branch, not released. Checked visible source
readings have a separate append-only history; blanks, redactions, unreadable fields
and unknown report versions remain explicit and nonadditive. The current local
context adapter covers the checked Crow Wing form structure. Independent sections
inside bundled PDFs and bounded large-file preparation/replay are implemented and
tested locally. Reusable recipient and publisher proofs now replay exact retained
chains, bind the selected election date, and preserve source withdrawal and
historical-version checks. Independent retained-evidence checks cover the code;
actual section acceptance, candidate identity and evidenced local amendment
decisions remain required work before full local coverage. Public section evidence
keeps the opening page separate from each figure's page and never presents a
computed section key as a publisher-issued account number.

The static Itasca and Otter Tail listing profiles keep each physical report's
account separate while a fully checked publisher list can establish a shared
report-selection group. Default expense and export selection chooses one latest
eligible report in that group; explicit older inspection remains available without
adding overlapping reports. Certificates are separate evidence, not zero spending.
All offered links and relevant outside text must be accounted for. Duplicate
publisher names or links to the same request hold the derived group. A publisher's
person label cannot override a contrary checked Candidate mark, and both the
publisher office and checked cover office must match the reviewed ballot office.
Missing optional companion evidence removes the derived selection, while healthy
own-report figures and independently checked candidate links remain available.

The Olmsted expense-attachment profile requires two distinct checked readings, an
exact publisher-listed report family and a complete checked Disbursements item
area on the primary report. The supplement retains its own absent identity fields;
its payment rows are associated with the containing report only through that proof.
Source evidence includes the parent section, supplement rows and exact catalogue
links. The cited catalogue's URL, publisher, copy date and media type must match
its checked acquisition, just as the two report originals must. Unknown report
versions remain explicit and nonadditive. Source withdrawal,
changed capture metadata or a competing parent item removes the affected detail
without turning an unrelated healthy parent figure into missing data. The normal
synthetic integration checks do not admit an actual retained filing or establish
complete local coverage.

The bounded JPEG reading path preserves the exact original image and native-pixel
field coordinates. Image downloads retain their media type; they are not converted
into replacement PDF originals. These source capabilities do not by themselves
establish a checked candidate, effective report or complete filing coverage.

The combined disposable-database check reproduces the published result fingerprint,
5,023 races and 140,815 precinct/race records, then replays 389 existing Board
account decisions and 14 federal fixture decisions. Expense reads, full JSON/CSV
exports, sampled Board originals and all 14 selected federal financial originals
pass without production changes. Every returned filing download matches its retained
original hash. Both application phases stayed below the 1.5 GiB memory bound and
the owned test database closed cleanly. This proves the integration path, not
complete source coverage, new identity approvals or deployed access.

Local discovery retains its original denominator of 1,941 routing groups and
7,458 candidacies. Numeric school district identifiers alone are insufficient:
school group 0001 includes both ISD 1 and SSD 1, which require distinct typed
recipient scopes. Publisher identity, filing responsibility, campaign identity,
source reading and effective report version remain separate checked relationships.
Original capture metadata stays private; public evidence downloads contain only
the appropriate original documents, never cookies or private collection records.

The expanded release, full source reconciliation, live review and narrated
walkthrough remain unfinished. The earlier live comparison is described below.

### Released comparison milestone

The comparison code merged in [PR 2944](https://github.com/alethical-org/alethical/pull/2944).
The production API runs merge `be942f16` with migration `0093_election_comparison`.
The source collections are published and the Finance build is live at
[alethicalfinance.com](https://alethicalfinance.com/money/races/attorney-general?election=mn-2026-11-03-general&race=dc88f14ef11f28d4e295a4a63037a0d11a280df59304c670c9116102b1cf37f7).
Authenticated live acceptance passed on November 11, 2026. The official return files reconcile 5,023
races, 8,002 named candidacies and 140,815 precinct/race records within their feeds.
84 single-seat precinct/race totals exceed the separately reported voter count;
preserve those figures and scoped discrepancies. Within-feed agreement does not
establish independent canvass validation or certification.

The complete candidacy inventory routes own-campaign reports to 523 state Board,
21 federal and 7,458 local filing authorities. Local candidate reports and
Board-reported outside spending remain separate coverage lanes. A retained scoped
collection holds 400 latest committee PDFs and 842 catalogue reports; the remaining
442 catalogue entries have explicit figure gaps. This is source availability, not
400 confirmed candidate links or complete election spending. Explicit review has
confirmed 389 candidacy/account relationships; 134 Board candidacies retain
unresolved or unrecovered account evidence. Actual report periods,
effective amendments, original bytes and source locators remain separate from
explicit account-review decisions. Matching names never confirms a relationship.

Versioned result storage, scoped financial collection storage and authenticated
read APIs passed 251 focused backend tests before the latest UI source routes.
The latest report/outside-read checks passed 71 tests, including received dates,
local roster encoding, absent candidates, filtered payments and original CSV
access. The Finance suite passes 976 tests; the production bundle compiles.
These checks are separate from the browser and live acceptance recorded below.

An actual disposable PostgreSQL/API run checked all 5,023 race counts, all 4,105
attorney-general precincts and the 19 retained result sources. A separate full
finance run verified all 400 original PDFs, 894 supporting sources, 842 stored
report versions and all 389 reviewed candidacy/account links. Repeated staging and
review requests did not duplicate records. Each linked candidate read returned
exact stored figures, the reviewed directory name, actual report dates and received
date. Production staging and publication now retain those generations and all 389 reviewed
account decisions. All 1,311 unique originals have hash-verified primary and mirror copies.

Account reviews are append-only, require retained ballot, Board-directory and
report-cover evidence, preserve predecessor decisions and dated attribution, and
explicitly handle withdrawal and compatible candidacies. Read versions use all
visible relevant decisions, not a maximum sequence ID that misses late commits.
Original evidence remains behind Finance authentication.

Design's second drawing and final notes were received from the existing Alethical
B2B project, in Money by Race.dc.html. The remaining wording decisions are resolved:
account cards use directory names; payment evidence may use plain labels while the
original CSV preserves exact columns and values. The new UI uses exact report
cents, separate support/opposition groups, paged precincts, retained-source panels,
explicit gaps and the existing calendar-year entry. Browser acceptance against
actual retained data and the reviewed drawing passed before release. Global navigation and
Angel's future repeatable report layouts remain outside this build.

The production outside-spending snapshot and the retained research CSV have the
same parsed record-set hash and 45,741 records, including 4,961 for 2026. Their byte
hashes differ. Reuse the current publication and its own retained original; do not
replace the global money release solely to match research download bytes. Production has migration `0093_election_comparison`.

The production row audit accounts for all 4,961 reported 2026 outside-spending
records exactly once: 4,243 attributed records ($61,022,940.25), 717 records without
a confirmed account ($2,265,348.44), and 1 record outside the checked account period
($249.29). The buckets total $63,288,537.98, with no missing amounts or overlapping
claims. These amounts include political committees/funds and party units; they are
not a PAC-only or complete election-cycle total. All 45,741 records in the retained
CSV were compared field by field with their stored source record numbers. Source
downloads can order the same records differently: evidence uses each retained
original's own record numbers.

The prepared Finance build was promoted after source publication. The scoped
withdrawal dry run matched both published pointers and preserved history. Federal
reports and local portal records not yet collected remain uncollected, not
unavailable or zero. Detailed source, review and release receipts remain private.

The [source and release operating contract](../operations/election-finance-comparison.md)
owns staging, explicit account decisions, publication and restoration commands.

Completion requires expected-versus-held coverage by election, race, jurisdiction,
precinct and filing period; duplicates, missing files, unresolved matches and
unpublished sources; reproducible displayed figures; current-head checks; reviewed
Design and live verification. A successful download or passing tests alone do not
establish completeness.

### Independent review corrections, November 11, 2026

The merged build includes these independently accepted corrections. Source availability for every referenced account
review now participates in comparison versions, including historical and
supplemental evidence. Dated payments outside checked account intervals have a
separate source drilldown and remain excluded from attributed totals. Typed ballot,
register and cover quotes are validated against retained evidence before recording
a decision. A repeatable read-only release audit accounts for every spending row
once against current applicable decisions. Independent review accepted these backend corrections after 14 checks and an exact
comparison of every payment row against an independent audit.

154 focused backend tests passed after the source and interval fixes; the added
partition test passed separately. The 11 comparison UI tests pass, including the
excluded-payment source, failed source restoration, nearby live-search results and
pagination focus. A reproduced changed-snapshot failure now reloads the election
and precinct reads together while retaining the selected race and page.
The production bundle compiles. The fresh full-corpus run has 62 passing checks, including revalidation of all 389
account requests and an exact partition of all 4,961 current-year payment rows.
The full-corpus receipt passed and its owned disposable database was removed.

Design reviewed desktop, tablet and phone built screens. Accepted corrections
restore the About section, group files beneath their publishers, preserve separate
copy dates, avoid repeated chart labels, keep dates and precinct names intact, and
use shared chevrons. Payments outside checked dates appear separately by candidate;
only individual rows show amounts, so support and opposition are not combined.
The last visual correction adds a clear fixed-column boundary when the precinct
table scrolls. A reproduced page-overflow defect was fixed by containing hidden
source labels inside that scroll region. Design accepted the corrected build with
no material visual defects remaining.

Browser checks verified independent precinct and finance failures and recovery,
exact payment-source restoration, keyboard table scrolling, live search, source
panels, and pagination focus. Real touch and a screen-reader session are not
claimed. Independent review also reproduced a campaign-report opening crash caused by
conditional hooks in the evidence builder. Those unused hooks were removed; the
open/close regression now keeps the comparison mounted and its vote figures intact.
Current-head CI passed and Finance is live. A fresh independent browser review
verified Attorney General totals, report evidence and original downloads, precinct
source lines, paging, live search, Ada's multi-seat totals and local filing gaps,
and Meg Luger-Nikolai's excluded February 9 payment. Parent review checked the live
report open/close and focus return, unknown-race handling, restored totals,
signed-out access and noindex headers. Downloaded report and CSV hashes match the
retained originals. Source evidence uses production record 1619 for the excluded
payment; the research copy's record 1650 has identical values in all 19 fields.
The downloads order their records differently. No material defect remained in these checked journeys.

Live review used the existing desktop browser at 125% zoom. Phone/tablet layout,
independent failures, retry and changed-version recovery were checked before release;
production fault injection, real touch and a screen-reader session are not claimed.
This milestone is delivered; the full analytics build above remains unfinished.
Chat, working folder and local branches are retained for follow-up.
