# Election comparison sources and release

This is the operating contract for the election comparison in Finance. The
[implementation plan](../implementation/election-finance-comparison.md) records
delivery status. These commands do not authorize a refresh or establish that a
particular set of files is complete. Start with the
[source refresh guide](production-ingestion-refresh.md), verify the current
owner and deployed migration, and retain receipts in private task storage.

## Separate records, explicit relationships

- An election key includes date and stage. A race includes the source office and
  jurisdiction. A candidate identifier is scoped to that race; names alone are
  never an identity key.
- Results retain original source bytes, race totals and precinct records in one
  generation. Candidate and write-in rows keep the source's meaning. The highest
  vote count is not proof of a certified winner. Expected canvassing authority and
  a scheduled meeting are not certification evidence.
- Financial collections retain report catalogues, effective amendments, actual
  reporting dates, original PDFs and figure evidence. They have their own release
  pointer and do not replace the global campaign-finance publication.
- A confirmed account relationship requires an explicit review of retained ballot,
  registration and report-cover evidence for an exact candidacy and dated scope.
  Proposals are not confirmations. A changed source identity fails closed until
  reviewed. Withdrawal and replacement append a decision; they never erase history.
- Cash, in-kind amounts and unpaid spending retain their source categories. Unpaid
  spending included in a reported total is not added again. Contributions received,
  campaign expenditures and outside support/opposition are separate measures.
- A reporting calendar year is not a complete election cycle. Preserve every
  figure's actual period. A later filing or amendment can replace a displayed
  report, but earlier versions remain retained and addressable.

## Prepare and stage results

### Collect local and federal discovery sources

`scripts/collect_election_sources.py` captures an explicit private JSON manifest
of source requests. Each entry has a unique `id`, exact `url` and operator-checked
`allowed_hosts`. Begin with links published by the actual authority or an official
directory. A directory link is a discovery lead, not proof of the correct filing
recipient or a candidate relationship. Cross-host redirects remain failed attempts
until the destination is checked and explicitly included in the manifest.

```sh
uv run python scripts/collect_election_sources.py \
  --manifest "$source_requests" --directory "$new_private_capture_folder"
```

The collector uses at most four downloads and one request per host, including
redirect destinations. It retains exact content-addressed bodies and an append-only
attempt ledger. Restarting with the same folder verifies and reuses successful
bodies and retries failures. Use a new folder for a fresh dated observation; a
resumed old capture is not a freshness check. HTML links are retained as leads;
they are never followed automatically. The command does not parse money, confirm
identity, stage data, or publish it. A 404, access error, changed redirect, incomplete
page or collection limit is a failed route, not evidence that no filing exists.

Reconcile all expected candidacies and authorities with the discovery manifest,
then collect and validate each available filing and relevant canvass. Successful
page counts do not establish report or outcome completeness.

`scripts/election_comparison.py prepare` reads an already retained source folder
and hash manifest. It downloads nothing and writes a new receipt. The receipt path
must not exist. Use `--include-local` for the full Minnesota main-and-local corpus;
without it, only the main result files are in scope.

```sh
uv run python scripts/election_comparison.py prepare \
  --directory "$result_sources" --manifest "$result_manifest" \
  --election-id 201 --election-date 2026-11-03 --stage general \
  --include-local --output "$new_result_receipt"
```

The source election ID and date above identify the initial 2026 general-election
scope, not a default for future imports. Validate the manifest and source status
for each run. Inspect excluded question/response rows, source reconciliation,
unknown authority and precinct-voter discrepancies before accepting the output.
Within-feed reconciliation does not establish independent canvass validation.

Replace `prepare` with `stage` and add `--target production --execute` only for an
authorized release. Staging retains and reads back source bytes before committing
the complete generation. It does not make a generation visible to readers.

## Prepare and stage report collections

`scripts/stage_election_finance.py prepare` rebuilds a collection from the retained
catalogues, directory and PDF bodies. It checks money against the documents, rather
than trusting an edited derived JSON file. The roster folder must contain
`source-manifest.json` and `cand.txt`, plus the retained local roster for full local
coverage. Unlike the results command, it does not accept a separate roster-manifest
filename. This financial importer currently supports the 2026 general election
and source election ID 201; the result command's other stage options do not imply
financial support for those elections.

Use a new output path for each full collection JSON. `--output` writes that JSON
before execution, can overwrite an existing file, and is not a success receipt.
Capture standard output separately; only the post-commit receipt's `executed: true`
establishes successful staging.

Optional `--identity-manifest PATH` retains additional Board candidate-information
or economic-interest responses. A registered campaign site may support an exact
name variation only through its retained Board officers link and original bytes.
These sources supplement the required directory and report cover; they never
confirm a candidate relationship automatically.

```sh
uv run python scripts/stage_election_finance.py prepare \
  --directory "$finance_sources" --roster-directory "$result_sources" \
  --directory-file "$candidate_directory" \
  --directory-metadata "$candidate_directory_metadata" \
  --output "$new_collection_json"
```

Replace `prepare` with `stage` and add `--target production --execute` to retain
and stage the checked collection. Originals may remain retained after a later
staging failure; retry from the same verified files. Do not remove retained
objects to force a retry. Check the resulting collection fingerprint and counts.

Account review requests are separate private JSON files, passed to
`scripts/review_election_account.py --request PATH`. The default validates request
shape offline; it does **not** validate retained evidence. `--target production
--execute` validates evidence, locks the account, checks the expected predecessor
and commits the append-only decision. A repeated request returns its original
decision and whether a newer decision has superseded it. It never reactivates an
old confirmation. Supplied ballot rows are checked at their retained line;
committee-register quotes must match the original JSON columns and exact account
row; report-cover quotes must match retained parsed cover fields. These checks do
not replace the accountable identity decision. Keep reviewer identity and private
reasoning out of public copy.

Typed identity quotes use exact retained Board officers-response excerpts or a
registered site's single HTML title, with its retained account-specific parent
link. A report excerpt uses the exact collection, account, PDF page and native
text line. Neither path performs OCR or turns a matching quote into a candidate
identity decision. Excerpt source links use the PDF route and remain private until
their collection is published; changed bytes or account membership invalidate
the affected comparison.

## Publish and restore

Record both current pointers before publishing. Compare-and-swap publication
refuses if another writer changed a pointer since it was inspected. The previous
generations remain available for restoration and historical evidence links.

```sh
uv run python scripts/election_comparison.py publish \
  --snapshot-id "$result_snapshot" --expected-previous "$previous_result" \
  --target production --execute

uv run python scripts/stage_election_finance.py publish \
  --collection "$finance_collection" --expected-current "$previous_collection" \
  --target production --execute
```

For first publication, results use the literal `none` for `--expected-previous`;
finance uses `--expect-empty` instead of `--expected-current`. An older snapshot or
collection requires `--restore`, with the *current* pointer supplied as the
expected value and the retained prior generation supplied as the destination.
Do not guess a current pointer or remove history to make a comparison pass.
For a first publication, there is no prior result to restore; prepare a scoped
pointer-removal transaction and its saved read-back before release if withdrawal
is needed. Removing a current pointer does not erase the first-publication marker
or previously published source access.

## Federal and local finance generations

`scripts/review_external_election_finance.py` keeps preparation, account review
and publication separate. `stage` accepts `--input`, `--original-manifest` and
`--source-directory`; each manifest entry names a single retained file and its
SHA-256 hash. `review` accepts one exact account decision through `--input`.
`publish` accepts `--generation` and either `--expected-current` or
`--expect-empty`; `--restore` names an already retained prior generation. Every
operation defaults to a shape check only. `--target production --execute` takes
the production writer lease and performs the appropriate retained-source checks
before committing. A shape-check receipt is never evidence acceptance.

Staging checks the complete generation and original source bindings, then seals
the stored children against mutation. Publication and restoration recheck the
complete generation and actual original bytes. Candidate relationships retain
the exact authority, source candidate/account identifiers, ballot and issued
designation, plus their reviewed interval. Names alone do not join records.
An optional dated federal designation can narrow that interval: the checked
Form 2 signature and principal-account name, or the checked Form 1 identity dates,
set an earliest source assertion date. That date does not establish legal
inception or continuous effect. Each attributed cumulative figure must fit wholly
within the reviewed interval; source periods outside it remain unassigned.

Source-native amounts, paid/unpaid/in-kind categories, currency, memo detail and
amendments stay separate. Preserve native report totals when detail cannot be
reconciled; do not silently manufacture itemized totals or allocate a shared
account between candidates. Filed addresses support address-location comparisons,
not claims about where services were delivered or who ultimately benefited.

### Local source readings and unknown amendments

A checked reading binds the retained original, exact page and field, literal text,
unit and value or gap. Blank, redacted, unreadable, ambiguous, unchecked and absent-unit
fields stay distinct; none becomes zero. Candidate/account identity and the
applicable dates need their own checked evidence. Public source views and CSV keep
the gap and locator; a blank quotation stays blank, never replaced by a label.

A local payment address uses a separate checked `payment_address` binding, leaving
existing payment facts and quotes unchanged. Its optional `as_filed` value keeps
the exact visible text and line breaks through reports, source panels and CSV.
Do not label an unparsed address as a missing street. Derive state and ZIP only
from one terminal uppercase USPS state/territory token followed by a complete ZIP
or ZIP+4; keep street and city unparsed. Other forms retain their literal text
with unknown geography. No vendor lookup, hidden text or payee-name inference
supplies an address. An unchecked address cannot supply this supplemental binding;
blank, ambiguous, unreadable and redacted observations retain their distinct
states without a positive address claim. Address support does not resolve a
candidate, report-period or amendment hold.

A checked money field may show exactly two raised cents digits after explicit
whole dollars, with or without a decimal point. Normalize those digits while
preserving the literal source text. A terminal dash, mixed or incomplete digits,
or an uncertain field never supplies inferred cents. Normalization support does
not approve a reading; each changed value needs a new checked receipt.

Native PDF text is not proof that words are visibly readable. Every admitted field
must match an individually checked visible field, including its page, literal and
value. Hidden text beneath a publisher's redaction stays out of displayed quotes
and extracted report data. Redacted fields retain an empty literal and a gap state.
Original source bytes remain unchanged; retaining an original does not certify
that its publisher removed hidden text.

Reading coordinates follow the full rendered page after its declared rotation.
The bounded native reader obtains MediaBox dimensions separately from CropBox;
text returned with that geometry is discarded, never treated as a checked quote.
PNG bytes and the render profile stay unchanged. A corrected dimension can differ
from an older receipt, including at fractional-point rounding boundaries. Explicit
render replay rejects that mismatch; never rewrite a sealed receipt. Review a new
receipt through the normal correction history. Ordinary source reads verify bytes
and checked heads without rendering each page again, so a known bad checked head
must be withdrawn or corrected explicitly.

An exact catalogued document does not establish its amendment relationship to
other documents. Such local reports and payments carry `effective: null`,
`version_scope: exact_document` and `amendment_status: not_established`. Explicit
document inspection and source exports remain possible. Automatic latest-report
selection and additive candidate, party and funder totals require `effective: true`.
Unknown amendments are never labelled superseded; they stay excluded with the
reason “Amendments not established”. A checked source-version relationship is
needed to remove that hold. This hold does not finish recoverable filing coverage.

Candidate detail exposes the reviewed account's own payments under the selected
filing, separately from spending for or against a candidate. Scope each list to
that account, authority and exact report; changing the filing resets its open
list and page. Unknown amendments remain inspectable with the report's exclusion
notice, without entering additive totals or acquiring a support/opposition label.
Each payment opens its own retained source, including the filed address and
report period. Source loss or a withdrawn reading/account review removes the
affected detail and invalidates an older pinned view through the existing gates.

A primary exact-document report with checked name and ordered dates may retain
a missing report type or its literal Amended type. Neither establishes the latest
version. Missing dates and unsupported supplement relationships still prevent
report and figure extraction; the checked source reading can retain those gaps.

A local campaign name may identify its candidate through a separately checked
source statement. The fixed adapter supports the complete `PERSON for OFFICE`
statement with a checked Candidate mark, or the complete repeated-person
`PERSON( Campaign Fund of PERSON )` statement. It preserves the account's original
name, ambiguous marks and unissued identifiers. The existing dated account review
requires a unique exact ballot person, matching office and typed filing recipient,
plus evidence covering that review's full interval. A relationship-only report
remains a dependency in current and historical views. County geography alone does
not establish a filing recipient; special-district roles need their own supported
source relationship. These checks do not establish report versions or campaign
continuity across separate source sections.

Each request includes its actual source-proof outcomes in its version. A later
failed proof cannot change the returned figures under an unchanged version.
Ordinary reads isolate unavailable proofs so unrelated healthy records remain
available; staging and publication still require the complete evidence set.

Bundled PDFs use section readings (`mn-local-source-reading:v2`). A section has
one stable cover-page region and explicitly bounded cover/continuation regions.
Every field must fit its own section; overlapping checked sections and a checked
whole-document reading cannot coexist. Moving the cover anchor cannot bypass
that check. Withdraw the old reading explicitly before replacing its scope.
Review and publication require Read Committed transactions so waiting for a
review lock cannot retain an older decision snapshot. Ordinary pinned reads may
still use Repeatable Read.

Section preparation and review support freshly verified, request-owned PDF files
up to 64 MiB, with a 64 MiB unique-original closure. The older byte interface
keeps its 16 MiB bound. Streamed proofs check stored and original lengths and
hashes, reject malformed or concatenated gzip streams, and remove owned files
and handles on exit. At most 4 proof contexts reserve 128 MiB raw and 256 MiB
compressed space per process. A busy file budget returns a retryable failure;
it never marks a source missing or changes a report version. This file proof
does not approve origin, candidate identity, visible fields or report versions.

Real-source replay tests in `test_election_local_context.py` and
`test_election_source_provenance.py` require the private source folder named by
`ALETHICAL_RETAINED_LOCAL_EVIDENCE`. Their exact optional CI cases are listed in
`alethical/tests/expected_skips.json`; synthetic recipient and source guards run
without that folder. Before accepting retained-source work, run both modules with
the folder set, retain the named test results, and require no skips. A green CI run
alone does not prove those real sources were checked.

### Local publisher and acquisition checks

`review_election_source_provenance.py` prepares or records explicit private source
checks, dry by default. Executing a review changes only append-only source history;
it never confirms a campaign account or publishes money. Acquisition evidence is
bounded exact collector-record bytes stored privately, separate from public source
documents. Direct captures, observed response redirects and older from/to-only
observations remain distinct. Absent headers, methods and copy dates are not invented.

A `local_filing_context:v1` section reading cites a checked typed recipient root
and the exact ordered acquisition, link and offered-form steps to its document.
Official directory categories and original election rows establish the recipient;
an identical numeric district identifier never merges ISD and SSD. Portal account
selection must keep the same issued account and supported recipient through the
catalogue and PDF. Fixed parsers replay observed navigation without executing script.
An unissued physical section has a document-and-section key, not an invented
publisher account number. Existing Crow Wing context receipts remain supported.

Public reads label these physical accounts as report sections and retain the
original hash and section opening page. A figure's checked page takes precedence
over that opening page; an opening-page fallback requires the same original.
Missing publisher report numbers stay missing. Expense reports retain this
identity. Expense and race CSVs leave the publisher Account or Account ID cell blank
and put the derived key in the explicitly named Internal account key column. Issued account
numbers and older publisher catalogue groups keep their existing meanings.

At staging, publication, account review and public reads, the new recipient root's
election date must equal the selected ballot snapshot's actual date. A matching
year alone is insufficient. Previously admitted mismatches are withheld from both
current and historical views and change the report version. Standalone source
review can check other elections; a report's covered dates remain independent of
the election date, so a historical report is not rejected solely for its period.

Reading review and strict publication take sorted provenance locks before reading
locks, then reread current decisions. Every transitive public original must belong
to the selected generation and pass fresh file proof. Source corrections,
withdrawals, loss and recovery participate in report versions and invalidate the
affected current and historical relationships. Private capture bytes and reviewer
records never enter public evidence or downloads. Temporary file capacity remains
retryable, distinct from missing source evidence. These checks establish source
origin and section scope only; candidate identity and effective amendments remain
separate decisions.

## Fresh source reads

Election analytics readers share a process-wide pool of 16 source workers. Each
request keeps at most 64 MiB of compressed originals and starts with an empty
cache; no source-availability decision survives the request. Repeated uses of an
original within that request share its bytes, then perform their own hash, length
and source-role checks. Interrupted readers cancel queued work and drain started
work before removing their temporary files.

These readers use a 16-connection storage client with a 10-second connection
timeout, 30-second read timeout and 1 attempt per request. Ingestion clients keep
their existing settings. Source loss changes the report version and withholds the
affected figure; retry starts a fresh check. A storage-only timing does not prove
full report latency or deployed capacity.

Large originals are checked sequentially within one request so it does not exhaust
its own file budget. Large local PDFs reopen as bounded verified files only while
an adapter uses them. They are not retained as whole byte strings between candidate
checks. Coverage rows stay with their candidate rather than being repeated as a
full election-wide array on each expense-report page. Collection work notes are
private; public gaps describe missing records or figures. A currently confirmed
campaign account replaces a stale unmatched collection status without implying
that its reports or figures are complete.

## Publisher inventory and filing versions

Raw local report facts keep unknown amendment status unless a separate checked
proof establishes a version. The supported Hennepin profile checks the whole
offered listing, its exact account selectors, every linked document and each
checked report period/type. A missing, duplicate, competing, amended or unresolved
member prevents the derived claim. Catalogue labels do not fill missing cover
fields or establish a candidate identity.

Successful proof means the only offered version of that report family in the
retained listing, as of the listing's actual copy time. It does not establish that
no later amendment exists. `version_as_of` retains that date; `version_sources`
retains the listing and every companion's exact URL, individual copy time and
source location. All of those source metadata must match the verified generation,
including the listing. A later PDF download never acquires the earlier listing
date. Prior-year companion documents prove the inventory and do not become
current-election money rows.

Strict stage/publication replays the full proof. Public readers complete the
optional check before creating the response version. A withdrawn reading, missing
companion or changed proof removes only the derived version claim and changes the
pin; independently supported raw account facts and amounts remain available.
Capacity failures stay retryable. Current and historical selectors follow the same
rules, and restoring exact proof produces a fresh checked response. Report options,
candidate cards, expense reports, funder records and CSV evidence keep the dated
qualification and source links together.

## Outcome decisions

`scripts/review_election_outcome.py --request PATH` checks request shape by default.
Adding `--target production --execute` validates retained bytes and quotations and
records an append-only decision for the exact snapshot and race. The receipt names
the decision and its predecessor; a replay does not reactivate a superseded one.
Source capture uses the separate `--capture-url`, `--publisher-url`,
`--publisher-host` and `--authority` path. Capturing a canvass or publisher page
does not approve its interpretation. Do not convert a leading vote count or an
expected canvass date into a declared or certified outcome.

Scanned certifications use the existing section-v2 checked-reading path with
`document_kind: outcome_certification` and no financial `source_context`. The
outcome capture still establishes the exact publisher, original and authority.
Reading approval establishes only the quoted text and its location, not the
meaning of the election result. Outcome evidence selects a resolved certification
text field by its immutable reading hash, field ID, page and exact bounds. The
quote must equal that field's text. Office, election, jurisdiction and candidate
bindings remain separate exact checks. Financial-report readings cannot supply
these outcome quotes.

Outcome admission locks current reading heads before recording the race decision.
Ordinary readers check current and historical reading dependencies in one batch
without rendering pages. A current failed or withdrawn reading withholds its
claims; a historical failure changes that race's version without suppressing a
healthy replacement. Other races' versions remain separate. Public evidence keeps
the page, bounds and quote, with no private reading IDs or review notes. Source
capacity returns retryable HTTP503 with `Retry-After: 1`; it never creates missing
coverage or a new report version. Each new request and final freshness check starts
with fresh source bytes.

Race exports reuse one bounded source cache across the initial detail and precinct
pages. Their final freshness check starts a separate read scope, so a source lost
while exporting prevents delivery of a stale file.

Aggregate write-in rows retain their votes with a blank candidate ID when the
source assigns none. They never acquire a named candidacy or outcome. Named
candidate rows retain their roster citation; separate nonadditive Evidence rows
identify the exact summary records or complete precinct rows supporting each
vote total. Aggregate rows cite those vote records directly, never an absent
roster entry. Unknown votes stay blank, and repeated proof does not repeat or add
the numeric total.

Precinct exports bind a raw candidate-order code within its exact race, checking
the candidate's name, party, aggregate status, source hash and source-row
membership. Conflicting identities stop the export. Older rows without a join key
keep their source values and an explicit unlinked-ID gap; names alone never supply
an ID. PDF outcome page and field locations belong only to that PDF's Evidence
row. Its separate publisher link keeps its own source identity without inheriting
the PDF coordinates.

## Acceptance before calling the comparison complete

1. Reconcile expected and held races, candidacies, precincts, authorities and filing
   periods. Explain gaps individually where a source can be recovered. A failed
   request or conservative matcher is not proof that no filing exists.
2. Trace a real race from displayed figures to retained source rows and PDF pages.
   Check exact candidacy, office, jurisdiction, stage, dates and account decisions.
3. Account for every outside-spending source row once, including unknown targets,
   missing amounts/dates and legitimate duplicate-looking rows. Keep party units
   separate from political committees/funds and candidate campaign spending. Run
   `uv run python scripts/audit_election_attribution.py --election ELECTION_KEY
   --target production --output NEW_PRIVATE_RECEIPT.json` against the published
   sources and current reviews. The read-only audit retains every row number,
   current decision IDs and source versions, separates unlinked accounts, missing
   dates and dates outside reviewed intervals, and fails on multiple current
   candidacy claims or unreconciled counts/amounts. Repeat after source or review
   changes; a previous receipt does not cover a new publication. Reconcile its
   row IDs and exact amounts with the retained original before acceptance. Downloads
   with the same parsed record-set hash can have different row orders. Resolve each
   record number against its own retained snapshot, rather than reusing a research
   download's ordinal.
4. Verify authenticated source access, historical versions, sign-out boundaries,
   independent result/report/outside-source failures, retry and changed-version
   handling. No figure becomes zero because its source is missing or unavailable.
5. Review the rendered comparison and current-head checks, publish only the
   accepted generations, and inspect the live reader journey. Imported counts or
   passing tests alone do not prove complete coverage.

The initial scope has uncollected federal and local campaign reports. Their filing
authorities must remain visible. A Board outside-spending record about a local
candidate does not make the Board the authority for that candidate's own campaign.
The comparison supports descriptive spending/outcome findings. Claims about
spending changing an outcome require a separate method and evidence.
