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

Initial source scope is the November 3, 2026 Minnesota general election. Recover
officially available candidate and result records for that election. Financial
coverage follows each actual filing authority and available period; do not claim
state Board files cover federal or every local campaign. Do not expand historical
coverage or invent further reports from Angel's still-pending research.

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

## Status

In progress: comparison UI, browser acceptance and release preparation. No production data import
or comparison UI release has occurred. The official return files reconcile 5,023
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
These checks do not establish browser or live acceptance.

An actual disposable PostgreSQL/API run checked all 5,023 race counts, all 4,105
attorney-general precincts and the 19 retained result sources. A separate full
finance run verified all 400 original PDFs, 894 supporting sources, 842 stored
report versions and all 389 reviewed candidacy/account links. Repeated staging and
review requests did not duplicate records. Each linked candidate read returned
exact stored figures, the reviewed directory name, actual report dates and received
date. No production migration, account decision or publication has occurred.

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
actual staged data and the reviewed drawing is in progress. Global navigation and
Angel's future repeatable report layouts remain outside this build.

The production outside-spending snapshot and the retained research CSV have the
same parsed record-set hash and 45,741 records, including 4,961 for 2026. Their byte
hashes differ. Reuse the current publication and its own retained original; do not
replace the global money release solely to match research download bytes. The
production schema remains at 0092_mail_file_reuse, so migration 0093 is still needed.

Remaining work: finish the real outside-spending and browser journeys; review each
changed state across the three layout bands; obtain independent final review;
release the code, stage retained sources and explicit reviewed decisions, publish
scoped pointers with restoration receipts, and verify live. Federal reports and
local portal records not yet collected remain uncollected, not unavailable or zero.
Current source artifacts, failed attempts and detailed audit records remain in
private task scratch storage.

The [source and release operating contract](../operations/election-finance-comparison.md)
owns staging, explicit account decisions, publication and restoration commands.

Completion requires expected-versus-held coverage by election, race, jurisdiction,
precinct and filing period; duplicates, missing files, unresolved matches and
unpublished sources; reproducible displayed figures; current-head checks; reviewed
Design and live verification. A successful download or passing tests alone do not
establish completeness.

### Independent review corrections, November 11, 2026

The build remains unreleased. Source availability for every referenced account
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
Current-head CI, production release and live verification remain outstanding.
