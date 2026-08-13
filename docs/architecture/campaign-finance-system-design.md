# Campaign Finance System Design

Status: approved design, not yet built

*How Minnesota campaign-finance records enter Alethical and how they may be displayed. The
policy decision that allows this work is [#1269](https://github.com/alethical-org/alethical/issues/1269);
the boundaries it set are in `docs/product-onboarding/product-scope.md` § "Not built yet —
ingestion" and § "Not built yet — source-backed public influence records". The plain-language
version of the plan, for people who do not read design docs, is
[`docs/product-onboarding/campaign-finance-roadmap.md`](../product-onboarding/campaign-finance-roadmap.md).*

**Net:** Fetch Minnesota's official campaign-finance downloads whole, store each fetch as a
dated snapshot, and publish the newest snapshot that passes its checks by replacing the
previous one entirely. Never merge new rows into old ones. Show what the filings record;
never assert that one payment caused another action.

**Scope: money filed with the Minnesota Campaign Finance and Public Disclosure Board, and nothing
else.** Minnesota state races, Minnesota candidates, Minnesota committees and party units. Money
filed with any other agency is out of scope, is not read, is not stored, and is not named anywhere —
not in a page, a filter, a chip, an empty state, a search placeholder, a roadmap line, or a
"coming soon". A surface says what this record **is**; it never lists what it is not, because naming
an absence advertises a thing we do not have (`.claude/rules/grounded-answers.md` rule 2, never
advertise what you can't answer, and rule 6, copy claims match shipped capability). Eugene's call,
12 Aug 2026, tightening an earlier "deferred" framing that had begun to read as a promise.

---

## Who edits this document

**One session owns it. Every other session sends findings instead of editing.** Eugene's
decision, 11 Aug 2026. Three sessions wrote this file inside three hours; nothing collided,
because each edited a different section, and that is exactly why it went unnoticed that two
decisions were taken against text which had already been replaced. One session recommended
keeping downloaded files in the database an hour after its own merged work had settled on
Supabase Storage; another merged a display rule that a third had already measured to be wrong.

- **The owner today** is the session titled **`1328 Finish the campaign finance loader`**
  (`e8c5a620-e1d7-417c-ac06-8273a0b416f3`), appointed by Eugene 13 Aug 2026. Copy a title
  verbatim from the live task list; the first version of this line named a title that did not
  exist, because the owner described its own role instead of reading its title, and 2 sessions
  could not find it.
- **The pen passes; it never lapses (Eugene, 13 Aug 2026).** The rule as first written said to ask
  Eugene when the named session is gone, and that is exactly what went wrong: `design IA` finished
  and 4 measured corrections then sat in issue comments where no builder reads them, including a
  wrong number in this file that others were budgeting against. So **if the named session is not in
  your live list, you may take the pen**: name yourself here in the same commit as your edit, and
  say which issue the measurement came from. One editor at a time is the point; a specific person
  is not.
- **Why one editor still, with this much concurrency.** 41 worktrees in this repo carried a commit
  within the last few hours when this was checked (13 Aug 2026), against the 3 sessions whose
  collision produced the rule. The case for it is stronger than when it was written, which is why
  the fix above is a handover and not a relaxation.
- **If you are another session:** post your measurement or recommendation as a comment on the
  issue you are working, then message the owner. Do not open a pull request against this file.
- **Send the wording you would have written**, not just the finding. The owner lands it and
  attributes the measurement to your issue, so nothing waits on a rewrite and the document
  keeps one voice.
- **This is about the document, not about your work.** Nobody needs permission to measure
  something, change code, or decide inside their own issue. What routes through one editor is
  the text here, because this file is what later sessions treat as settled.

---

## 1. Why this design, in one paragraph

A working implementation of this product already exists, built on Base44 at
alethicalfinance.com, and it is being retired. It is worth knowing what went wrong there,
because two of its failures shaped every decision below. Its importer checked only the first
1,000 stored records when looking for an existing match and never compared incoming rows
against each other, so **241,258 of its 954,188 money rows repeat another row's fingerprint**.
Separately it discarded fields the source actually provides: **half its rows carry no date**
even though the state's own download dates every row. Both failures come from the same root,
which is merging rows one at a time into a growing table using a key reconstructed from the
row's own contents. This design removes that root rather than defending against it.

Full findings, measured from that system's exported data and code:
`docs/research/base44-campaign-finance-findings.md`.

---

## 2. Sources

All Minnesota sources are free, need no key, and publish as CSV.

### 2.1 Campaign finance

Landing page: `https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/`

**Resolve the download link from that page on every run.** Each file sits behind a
`?download=<number>` link. Those numbers were stable across the days we tested and on both
of the Board's hostnames, but a saved number that silently starts pointing at a different
file is a worse failure than one that breaks loudly, and the page costs one request to read.

**The number is signed, and all 3 of the numbers we want are negative** — the contributions
"All" file is `?download=-2113865252`. A `download=(\d+)` pattern drops the minus sign and
resolves a different address, so match `-?\d+`. Every link on the page is an
`<a class="csvFile">` inside a table whose first cell is the filer category and whose
`<h1>` names the dataset, so resolve on those two labels rather than on position.

The page offers 23 files: 3 datasets across 8 filer categories (7 for independent
expenditures, which has no candidates file). **The 3 "All" files contain every row of the
other 20**, so fetch 3 files, not 23. Re-verified 11 Aug 2026 by downloading all 23 and
comparing parsed rows as duplicate-preserving multisets, in both directions: every row of
every category file appears in its "All" file at the same multiplicity, every header matches,
and no "All" row is absent from the union of its categories.

| dataset | rows on 11 Aug 2026 | columns | bytes | covers |
|---|---|---|---|---|
| Itemized contributions received over $200 | 583,152 | 15 | 82.6 MB | 2015 to present |
| Itemized general expenditures and contributions made over $200 | 377,860 | 18 | 67.1 MB | 2015 to present |
| Itemized independent expenditures over $200 | 41,130 | 19 | 9.1 MB | 2015 to present |

Columns on the contributions file: recipient registration number, recipient, recipient type,
recipient subtype, amount, receipt date, year, contributor, contributor registration number,
contributor type, receipt type, in-kind flag, in-kind description, contributor zip,
contributor employer.

Three things that file **does not** have, each of which changes the design:

- **No record identifier.** The state publishes no per-transaction id, which is why §4 keys
  on the snapshot rather than on the row.
- **No city or state**, only a zip, and 9,007 zips are shorter than five characters. Store
  zips as text. (Most of those have lost a leading zero; that a given short value did is an
  inference, not something the file states.)
- **No small-donor detail.** See §2.3.

**And one thing it has that the name does not suggest: rows that are not contributions.** The
`Receipt type` column carries 4 values, and 6,809 of the 583,152 rows on 11 Aug 2026 (1.2%) are
`Miscellaneous`, `Miscellaneous Income` or `Loan Payable` rather than `Contribution`. The filing
reports those on separate schedules and §9.1's route reports them as separate lines, outside the
contribution totals. **Filter to `Receipt type = 'Contribution'` before comparing anything against
a reported contribution figure.** Measured across every sitting legislator's 2025 year-end report:
including them makes our itemized sum disagree with the filing on 19 of 202 legislator-years, and
filtering brings that to 3. Senator Lindsey Port's committee (18466) is the plain case: a $5,000
row typed `Miscellaneous` with contributor type `Self` is a loan from the candidate to her own
committee, carried on the filing as `Schedule A2 - LP`.

**Two things about the expenditures file, both of which change what a comparison means.** First,
**the `Amount` column is the filing's *total*, not its *paid* column.** A filing prints paid, unpaid,
in-kind and total for every row. Measured on filer 17709, where they differ: the filing's paid column
sums to $10,062.18 and its total column to $9,956.91, and only the total matches our 108 rows
exactly. Comparing against the paid column produces false mismatches in both directions, 28 of each
on that filer alone. Second, **`Type` has 6 values and a candidate and a party unit use different
ones for the same thing.** Across all years: `General Expenditure` 148,735, `Campaign Expenditure`
129,237, `Contribution` 61,840, `Non-Campaign Disbursement` 35,844, `Ballot Question Expenditure`
1,274, `Other Disbursement` 930. In 2025 candidate committees filed 6,781 rows typed
`Campaign Expenditure` and **none** typed `General Expenditure`; party units filed 7,524 the other
way round. **So filtering on either label alone silently drops a whole filer kind** — the same shape
of trap as the `Receipt type` rule below.

**The download does not reliably carry amendments, on both sides of the ledger.** Where an amendment
changed a filing's rows, the bulk file still holds the set from before it. Confirmed on money out as
well as money in: filer 17709's outgoing rows match amendment 0 exactly at 108 rows and $9,956.91,
and fall 14 rows short of amendments 1 and 2, which is the same behaviour its incoming rows showed.
For contributions specifically: Measured on 3 filers on 11 Aug
2026, against amendments received between 27 March and 25 July 2026: our rows match the **original**
filing exactly for HRCC (20010; 743 rows, $1,488,168.08) and for filer 19043 (35 rows, $14,250.00),
and match it but for one extra row for filer 17709. It surfaces rarely because most amendments leave
contributions alone: 85 of 202 sitting-legislator 2025 year-ends are amended and 82 still reconcile
against the latest version. Whether the export ever incorporates an amendment is not established.

**That 1.2% is not evenly spread, and it is heaviest exactly where it matters most.** Share of
2025 rows that are not `Contribution`: candidate committees **0.36%**, committees and funds
**0.79%**, party units **6.57%**. So the filter is roughly 18 times more load-bearing for party
units and caucuses than for candidates — the filers whose money reaches candidates, and whose
figures the roadmap calls the story. Anyone reading "1.2% of rows" and assuming it is spread
evenly will under-weight this rule for the filers it protects most.

**Nothing in the download tells you it arrived complete.** There is no `Content-Length`; the
response is `Transfer-Encoding: chunked`, and a `Range` request is ignored (HTTP 200, not
206), so a download cannot be resumed either. Worse, a download number that no longer
resolves returns **HTTP 200 with a 39 KB HTML error page** typed `application/octet-stream`.
So a wrong or stale link fails silently, and two content checks are what catch it: the first
line must equal the expected column header exactly, and the `Content-Disposition` filename
names the file (`All - Itemized Contributions Received Of Over $200 - Campaign Finance.csv`).

**The export is byte-unstable: the same data arrives in a different row order every time.** 3
downloads of the independent-expenditures file seconds apart on 11 Aug 2026 returned 3 different
sha256 hashes at an identical byte size (9,080,784) holding an identical duplicate-preserving
multiset of 41,130 records, with 35,905 of the 41,130 positions holding a different record; the
contributions file behaved the same way, 583,152 records with 511,066 positions differing. So a hash
of the response bytes identifies *the bytes we received* and can never answer *did the data change*.
Sameness is decided on an order-independent hash of the records — the per-record digests, sorted —
and §4.1's "an identical hash to the previous snapshot means nothing changed" refers to that hash,
never to the bytes.

**A server error is a retry, not a stale link.** The contributions download returned HTTP 500 on
one attempt on 11 Aug 2026 and succeeded on the next two from the same unchanged link. Re-resolve
and retry before concluding a link has moved; the content checks above are what distinguish a
genuinely wrong file from a bad minute.

**The files are not valid CSV, and the choice of parser changes the data.** The Board escapes
a double quote inside a quoted field with a **backslash**, which RFC 4180 does not allow:
`"Amazon.com, 1.5\" Micro Rod"`, `"\"The Light We Carry\" by Michelle Obama"`. In the
expenditures file the same two characters also appear where the backslash is literal trailing
data and the quote genuinely closes the field (`…Design services for mailers \",2024,…`), so
no mechanical rule can read both correctly. Measured on the 11 Aug 2026 files:

| parser setting | contributions | expenditures | independent |
|---|---|---|---|
| Python `csv` default | 583,152 rows, none ragged | 377,860 rows, none ragged | 41,130 rows |
| `strict=True` | **18 records rejected** | **17 records rejected** | no errors |
| `escapechar="\\"` | **200 rows damaged** | **392 damaged**, 38 still error | 16 damaged |
| substitute `\"` → `""` | 18 rows correctly recovered | **42 records destroyed** | no change |

`escapechar` eats backslashes that are real data: `Self Employed\tMedical Practice` becomes
`Self EmployedtMedical Practice`. So **parse with the default reader and change nothing**: it
is the only setting that keeps every row in every file with every field in its correct column.
The cost is a stray backslash or trailing quote inside one free-text field (in-kind
description, purpose) on 36 contribution and 74 expenditure records; it never reaches a name,
amount, date, registration number or zip. Two consequences: a parse error can never be the
truncation guard (§4.3's count and size bands are all there is), and the count of affected
records is recorded per snapshot so a change in the Board's export shows up as a number rather
than as silent corruption.

**Amounts carry four decimal places** (`250.0000`), and four expenditure rows are finer than a
cent, so a two-decimal column would round real money. The independent-expenditures file prints
two decimals and sometimes omits the integer part (`.51`).

**`Year` is a separate claim from the date, not a copy of it.** It disagrees with its row's own
date year on 234 contribution and 468 expenditure rows, so both are stored. What the field
means beyond that is not established here.

### 2.2 Lobbying

Landing page: `https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/`

Principal expenditures, 2015 to present, plus lobbyist and lobbying-entity registration.
Minnesota publishes the lobbyist-to-client relationships here that the retired system was
almost entirely missing (it held 63 relationships for 1,709 lobbyists).

### 2.3 Filed reports, and the $200 rule

**The threshold is on a donor's cumulative giving within the calendar year, not on each
payment.** The statute is Minnesota Statutes [10A.20 subd. 3(c)](https://www.revisor.mn.gov/statutes/cite/10A.20),
which itemizes each contributor whose gifts "in aggregate within the year exceed $200 for
legislative or statewide candidates or more than $500 for ballot questions". 327,759 of the
583,152 contribution rows are individually under $200, the smallest being one cent: those are
later payments from donors who had already crossed the threshold. What the bulk files
genuinely cannot contain is money from donors who **never** crossed it. That appears only as
a single summary line on the filed report.

**So no surface may say that gifts of $200 or less are never named.** More than half the
itemized rows are gifts of $200 or less, and saying otherwise tells a reader that a named
$50 payment cannot exist when 327,759 of them do. The claim a page may make is about the
donor's yearly total: "donors who gave $200 or less in total for the year are never named."
**Mind the boundary in shorter labels too.** The statute says *exceed*, so a donor whose yearly
total is exactly $200.00 is never named and belongs in the unnamed bucket. A row label reads
"donors who gave $200 or less for the year", never "donors under $200" — that phrasing shipped
into a design prompt from this session on 11 Aug 2026 and had to be corrected on the screen.
A caption covering the whole record says *candidates*, because ballot-question committees
sit at $500. This is written down because the wrong version was drafted for a real screen
(Aug 2026) by someone reading the paragraph above, which stated the aggregate rule correctly
but never gave the period or the wording to use.

**The unnamed money is a single line on the filing, and the Board says so in its own words.**
Its candidate handbook: "Contributions from donors who have given $200 or less, in total,
should be added together and listed as a lump sum on the committee report to the Board." That
lump sum is the figure §9.5 recovers.

So a candidate's true total is: the itemized payments, **plus** a non-itemized figure that
exists only in the report. A page showing only the sum of visible rows understates the truth —
by 36.5% of what sitting legislators raised in 2024 and 41.3% in 2025, measured in §9.5.

**§9 establishes where those official totals come from and how to fetch them.** Filed reports
also live on the Board's report viewer and as PDFs, though most PDFs older than 2023 are not
served (§9.4). **Never rebuild payment rows out of a PDF for any period the bulk files already
cover** — that is what the retired system did, and it is where its errors came from.

---

## 3. Three record types, never confused

| type | what it is | example |
|---|---|---|
| **Report** | A filing, with its period, its version, and a link to the source document | RPM 2025 year-end, Amendment #2 |
| **Payment** | One itemized transaction inside a period | $500 from a named donor on 4 Mar 2025 |
| **Reported figure** | An official total or subtotal stated on a filing | "Total contributions received: $862,214.83" |

**A reported figure is never stored as a payment.** The retired system stored non-itemized
summary lines as if they were transactions, which is how a $1.06 "donation" with no donor
appeared in its data. A summary belongs to its report.

---

## 4. Ingestion: snapshot and replace

This is the one place campaign finance departs from every other source in the pipeline. Bills,
legislators and votes are fetched per record and updated in place. Campaign finance fetches
whole files and replaces whole sets.

### 4.1 The cycle

1. **Fetch** the current link for each file from the landing page, then download it.
2. **Store the file whole** as a dated snapshot with a content hash. An identical **record-set**
   hash to the previous snapshot means nothing changed; stop. Not the byte hash, which differs on
   every download because the export shuffles its rows (§2.1). One body is kept per distinct record
   set rather than per download, and every download is still recorded in `cf_fetch_observation` with
   its own byte hash, so 7 to 10 GB a year of reshuffled duplicates is not stored to preserve
   information that is already held.

   **This step has no facility to use yet, which an earlier version of this document got
   wrong.** It said "through the existing `SourceArtifact` retention path", and
   `SourceArtifact` does not retain bodies: `storage_path` is a synthetic string
   (`minnesota-live/{digest}`, `alethical/pipeline/minnesota.py`), nothing ever writes bytes
   there, and the repo has no object storage of any kind. The repo says so itself —
   `scripts/repair_companion_links.py` explains that a companion link could not be repaired
   because "`source_artifact` keeps a path and a hash, not the XML body". So §4.3's promise to
   retain a failed download for diagnosis needs a real store, and building one is part of this
   work rather than a thing to reuse. Note also that the existing `content_hash` helper hashes
   *decoded text*; raw-file identity must hash the response bytes.

   `docs/architecture/layer-1-source-ingestion-system-design.md` Stage 2 already requires an
   "immutable object storage path" for raw artifacts, and
   `docs/product-onboarding/product-scope.md` lists object storage for raw artifacts, so this
   is an unbuilt requirement rather than a new one. **§4.5 settles where these files live**;
   the general facility for every other source is
   [#1346](https://github.com/alethical-org/alethical/issues/1346).
3. **Validate** (§4.3). A snapshot that fails is kept for diagnosis and never published.
4. **Publish** by replacing the previous published set entirely.

   **The reader's half of that contract, in one place.** A request resolves one release id and uses
   it for all 3 datasets, because re-resolving per query can hand back a mixed set: each statement
   sees the newest committed state. And an id held longer than one further publish resolves to no
   rows (§4.5 keeps one spare generation, not more), so re-resolve rather than caching one.

**Related files release together.** Contributions, general expenditures, independent
expenditures and the reports that cover the same period form one release. Files fetched on
different days must never be shown together, or a committee's spending will be from a
different day than its income.

### 4.2 Why replace rather than merge

The state publishes no transaction identifier, and two payments can legitimately be identical
— same donor, same day, same amount. So no key built from a row's contents can tell a genuine
repeat payment apart from a re-import of the same row. Merging therefore cannot be made
correct; it can only be made careful, which is what failed before.

**How common this is, measured on the 11 Aug 2026 downloads.** Counting rows whose every
parsed field matches another row's, a single official download contains **20,524 repeated
copies**: 9,322 across 6,464 groups in contributions, 10,041 across 6,975 in expenditures,
1,161 across 884 in independent expenditures. The largest group is the **same row 119 times**
— Republican Party of Minn, "Zachary, Wivoda", $30.00, 2019‑08‑31. Any key derived from row
contents would delete 20,524 rows the Board published.

Note what that does and does not establish. It proves the official file publishes repeated
rows; it does not prove each copy is a separate real-world payment, and nothing available to us
could tell the difference. That is the point: there is no trustworthy identity here, so the
rows are reproduced as published and a citation points at the row, rather than us deciding
which copies are real.

Replacement dissolves the problem. Re-running an unchanged file is a no-op because the hash
matches. A changed file produces a new snapshot that supersedes the old one whole. There is no
row-level merge, so there is no row-level duplicate.

Within a snapshot a row is identified by `(snapshot_id, row_number)`. That pair traces a
displayed figure back to a line in a specific downloaded file. It is **not** a durable identity
across snapshots, and nothing may depend on it as one.

### 4.3 Validation, before anything is published

A snapshot must pass all of these:

- Parses completely, with the expected columns present.
- Row count is within a sane band of the previous snapshot. A sudden collapse means a
  truncated download, which is the failure most likely to look like real data.
- No blank dates in a dataset that had none before.
- Reported totals reconcile: for a sample of committees, itemized payments plus the
  non-itemized figure equals the total on the filing. **A reconciliation that comes out
  negative is a failure, not a figure to clamp** — §9.5 measures how often that happens and why.
- Every registration number resolves to a known filer, or is reported as new.
- The totals service passes its own checks, which are stricter than these because it answers
  HTTP 200 to several kinds of failure. §9.3 lists them, and they stop a release rather than
  degrading it.

### 4.4 What survives replacement

Because the published set is rebuilt, nothing human may live on an imported row. Sort human
decisions into three kinds and never mix them:

- **Links between things with durable identifiers** survive normally. A candidate joins a
  legislator through the state registration number and Alethical's own legislator id. Both
  persist across snapshots.
- **A note about one specific payment** belongs to the snapshot it was written against and
  stays there. It must never silently reattach to a similar-looking row in the next download.
- **A correction meant to apply every time** becomes a written, tested rule in the importer,
  never a hidden edit to an official row.

### 4.5 Where the downloaded files live, and for how long

**The Board publishes no archive, so our copy is the only record of what Minnesota published
on a given date.** The 23 download links never change; the file behind each one is replaced as
it grows. There is no dated URL, no "as of" parameter, and no way to ask for last week's
version. The contributions file held 583,120 rows on 10 August 2026 and 583,152 on 11 August.
So a file we fail to keep is not re-fetchable — asking again returns a different file.

That is what makes retention a correctness requirement rather than housekeeping: §4.2 traces a
displayed figure to `(snapshot_id, row_number)`, which resolves to a line in a specific
download, and it resolves to nothing if that download is gone.

**Primary store: a private Supabase Storage bucket** (`raw-source-files`), reached over the S3
protocol. Each body is written once under a content address (`campaign-finance/<dataset>/
<sha256>.csv.gz`), so nothing is ever overwritten and no version history is needed.

- Reached with **Storage-scoped S3 credentials**, not a service-role key. Those bypass row
  security *within* Storage but cannot touch the database, so a leak cannot reach any data.
  Env: `SUPABASE_STORAGE_S3_ENDPOINT`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`.
- **Gzipped with `mtime=0`**, so compressing the same input twice produces identical bytes and
  an unchanged file can never look like a new one. 159 MB of CSV becomes 28 MB.
- Bodies exceed Supabase's 6 MB basic-upload recommendation (18.3 MB and 8.8 MB), so uploads go
  through the S3 multipart path. Measured 11 Aug 2026: 18.3 MB in 9 seconds, read back
  byte-identical, and the decompressed bytes hashed equal to the original file.
- **Upload and verify the object before writing the database row.** An orphaned object is
  recoverable; a row pointing at a missing object destroys the evidence it claims to have.
- Store both hashes (raw and compressed), both sizes, the compression method and the object key
  in Postgres. Hash the **response bytes**, never decoded text — the existing `content_hash`
  helper takes a string and must not be reused for file identity.

**Why not the database.** Our Supabase Pro plan includes 100 GB of file storage against 8 GB of
database disk, and production already uses about 3 GB of that 8. Keeping every dated file is
roughly 7 to 10 GB a year, which exceeds the database allowance within months while sitting
inside the file allowance for over a decade. Beyond the included amounts, files cost $0.0213
per GB against $0.125 for database disk. Large bodies in Postgres also ride along in every
backup and restore.

**Second copy: Cloudflare R2.** Supabase's own documentation is explicit that "database backups
do not include objects you store via the Storage API", so the bucket is not covered by anything
that protects the database. A free scheduled job mirrors each new object to R2 after it lands.
Cloudflare is already ours (`alethical.com`'s DNS, with a scoped token in the gitignored
`.env`), R2 includes 10 GB free then $0.015 per GB, and egress is free so a restore costs
nothing. Both stores speak S3, so the mirror is one copy step rather than a second integration.

**What is lost if both copies are lost, stated plainly.** Every parsed row and every file hash
live in Postgres and are covered by database backups, so no displayed figure disappears. What
disappears is the ability to show the source bytes behind a figure and to diagnose a
quarantined download. Today's files remain downloadable from the Board; what could never be
rebuilt is what the Board published on a past date.

**Retention: keep every successful body and every quarantined one, indefinitely.** Only
*parsed rows* are pruned — the checks in §4.3 compare against recorded measurements, not against
old rows. But a **superseded set keeps its rows until the publish after next**, one generation
rather than none, because a reader does need them briefly: a request resolves the live release in
one statement and asks for rows in the next, so deleting the previous set the instant a new one
lands returns zero rows to a request that started moments earlier, which a page renders as "this
committee has no payments" (`.claude/rules/grounded-answers.md` rule 12, missing versus zero). One
spare generation is **241 MB measured** (#1328, 13 Aug 2026, summing the 3 row tables' live sets
in production). An earlier 51 MB in this sentence counted one dataset rather than the set. Pruning successful bodies to save space would give up exactly
the record this section exists to hold.

"Every body" means one per distinct set of records, not one per download. Because the export
shuffles (§2.1), keeping every download would store the same data repeatedly in a different order;
`cf_fetch_observation` keeps each download's own byte hash and size, so what Minnesota served on a
given date is still on the record. And a set whose rows were pruned is rebuilt **from the retained
body**, never from a fresh download: today's file holds the same records in a different order, so
renumbering from it would leave every `(snapshot_id, row_number)` citation pointing at a different
line of the file a reader is shown.

The general facility is [#1346](https://github.com/alethical-org/alethical/issues/1346): no
source in this repo retains bodies today, though `layer-1-source-ingestion-system-design.md`
Stage 2 and `product-scope.md` both require it. Campaign finance is the first source to do it,
and does it this way.

---

## 5. Identity

**Registered filers join by registration number, never by name.** Candidates, committees,
funds and party units all carry one.

**Do not read the filer's kind off the number.** An earlier version of this document said
Minnesota routes them by numeric range — 10000–19999 a candidate committee, 20000–29999 a
party unit, 30000 and above a political committee or fund. The source contradicts that. In the
11 Aug 2026 contributions download **4,672 rows carry a type that disagrees with their own
number's band**: 2,873 say `PTU` with a number of 30000 or above, and 1,799 say `PCF` with a
number in 20000–29999. The Libertarian Party of Minnesota is registration **40858** with type
`PTU`. So the file's type column is what to believe for that row, and the bands are a rough
hint at best. What a filer's settled classification is cannot be answered from the payment
files at all; that needs the Board's registered-filer directory, and §9.7 establishes the route
to it.

**People, employers and vendors have no identifier, and are never joined or split
automatically.** The retired system compared donor names exactly, so "Messinger, Alida" and
"Messinger, Alida R" were two different people. Loosening that into automatic matching trades
one wrong answer for another.

**What that rule costs, measured, because a surface has to be honest about it** (#1331, 13 Aug
2026, against production release `3f2bdf90`). Alida Messinger reaches 3 printed strings in the
same download: "Messinger, Alida" (121 payments to 39 committees), "Messinger, Alida R" (10 to
6) and "Messinger, Alida Rockefelle" (4 to 1). A page following the first shows 121 payments and
is silent about **$2,033,000** reachable under the other 2. So the rule is right and the silence
is not: a surface listing one string may not imply it is the whole of a person's giving. The same
file also holds "Messinger, William Frye" beside "Messinger, Wiiiam Frey", which is why the rule
holds anyway -- those 2 are indistinguishable from one misspelling and from 2 real people, and
nothing available to us settles which. Likely matches are surfaced for a person to confirm, and the
confirmed link is stored against the durable identifiers, not against a snapshot row.

A candidate joins an Alethical legislator only through a link a person has checked.

### 5.1 What counts as a confirmed match

Built in [#1354](https://github.com/alethical-org/alethical/issues/1354):
`alethical/pipeline/legislator_committee_match.py` proposes,
`scripts/review_legislator_campaign_committees.py` asks, and
`legislator_campaign_committee` holds what a person answered. Every measurement below is that
work's, taken against the 11 Aug 2026 itemized-contributions download.

**A confirmed match is a row a named person wrote, and nothing else is one.** No score, no
threshold and no agreement between rules ever produces a link. The proposer's output is a
question; the table holds the answer, with who answered, when, and the committee name they read.
Two things the database enforces rather than trusting code to: `reviewed_by` is `NOT NULL` with no
default, so a link nobody signed cannot exist; and a partial unique index makes a *confirmed*
registration number appear once in the whole table, so one person's money cannot be published
under two legislators' names. The same number may be **rejected** for several legislators, which
is what ruling out a shared surname looks like, and rejections are kept so the proposer stops
re-suggesting them and so "checked, not theirs" never reads as "nobody has looked".

**The reason this is a person's job is not that a name match might be wrong. It is that if it is
wrong, nothing downstream will ever notice.** Measured on the totals route: the financial response
carries no registration number, no committee name, and no filer identifier of any kind, so two
different filers return structurally identical documents differing only in their amounts (§9). There
is no field to check the link against, no reconciliation that would fail, and no check anywhere later
in the pipeline that could catch it. The money would render perfectly, dated correctly, reconciled
against a real filing — **under the wrong person's photograph**. That is why the identity is the
registration number, why the link is a row a person wrote, and why it is never re-derived from a name
at query time.

**One named person stays the rule, and a second reviewer was considered and rejected.** Two people
reading one committee name share the whole of their evidence and so share its mistakes: the
ambiguous cases are ambiguous because a name genuinely is, not because a reader might be careless.
What is independent of the reviewer is the sources, so `verify` re-checks every confirmed link
against the registered-filer directory (§9.7), against which party's units pay the committee, and
against the committee's own published name, which can change between downloads. A wrong link
therefore surfaces when the evidence shifts rather than waiting for somebody to re-read the roster.
It reports and never repairs: a contradiction wants a person's eyes, and a rename is reported as
what changed rather than as a mistake.

**`verify` runs on its own account, whether or not anything is confirmed to check
([#1398](https://github.com/alethical-org/alethical/issues/1398)).** It has no schedule of its
own — it rides inside the campaign-finance load (#1328's `load_campaign_finance`), every time
that load runs, reading the contributions file that run already downloaded and the
registered-filer directory (§9.7) that run's sibling filings pipeline (#1408) already holds in
`cf_filer`, so it never triggers a second fetch of either. It never blocks that load: the money
data a run publishes is correct whether or not a committee's identity changed, so a contradiction
is filed or updated as a GitHub issue instead, using the same alerting `gh` already does for the
sibling ingestion jobs. Zero confirmed links — true of every database until the first review
sitting lands — is a pass, not a failure.

**One legislator holds several committees, so the link is one-to-many** (§7, Display rules, has
the counts). A legislator whose second committee were refused would show one year of money and
silently drop the rest.

**The registration number is the identity; the name is only evidence.** Within one download each
number carries exactly one name, and the Board publishes a committee's *current* name against all
of its history — so a committee that renames between years is invisible in a snapshot, and the
name stored on a link is a note about what the reviewer read rather than a fact about the
committee. A later download showing a different name for the same number is a thing to notice, not
a contradiction.

**A proposal may only be called strong when the source states every part of it.** The two name
facts Minnesota publishes are the given name itself and a nickname it prints in parentheses or
quotes ("Baker, David (Dave)", 92 committees; 'Gordon, James "Jimmy"', 5). Anything else — a
shortening we inferred, a legislator known by a middle name, a bare initial — is our guess about
how names work, and a guess is the thing a person is being asked to check. On top of that, a
strong proposal needs the committee's office suffix to be the chamber the member sits in,
contributions inside the current session's years, no generational suffix present on one side only,
exactly one candidate for that legislator, and no other sitting member with a source-stated claim
on the same committee.

**Matching names means matching words, not first letters.** An earlier version compared only the
first word of each given name, which made "Dibble, D Scott Senate Committee" and a hypothetical
"Dibble, D Steven" equally confident for Senator D. Scott Dibble, because both first words are
"d". A single letter separates nobody, so at least one word of more than one letter has to be
present on both sides; initials are then compared where they count as the weak evidence they are.

**A word in our own record that the committee name never confirms holds a proposal back.**
`surname_keys` deliberately offers every trailing run of a legislator's name, which is what finds
"Van Binsbergen, Scott House Committee" for a member production stored as first "Scott Van" and
last "Binsbergen". The cost is that a *shorter* key can find a different person: Senator Erin K.
Maye Quade generates the key "quade", so an unrelated "Quade, Erin" would match her on an exact
given name, and the leftover "maye" in our record is the only thing that gives it away. So a
leftover word of more than one letter is a reason. A middle *initial* the Board omits is not —
"Senator Mark T. Johnson" against "Johnson, Mark Timothy" identifies one man, and demoting on a
dropped initial would cost half the Senate for nothing. This is why María Isa Pérez-Vega goes to a
person: the Board files "Perez-Vega, Maria" and drops the "Isa".

**Another committee sharing the surname is a reason even when it was too stale to show.** A
surname pool too large to read is capped to its recent members, and that cap runs before the
more-than-one-candidate check — so it could hide the alternatives from a proposal that then looks
certain. The case that bites: a legislator's own committee goes quiet while a namesake's stays
active, leaving the namesake standing alone. The existence of another person with the surname is
therefore itself a reason, and the count is always printed.

**What no rule can reach, stated plainly.** The contest check above can only see *sitting*
legislators, and a committee row carries no district. So a former or unsuccessful candidate with
the same name, same chamber and current activity is indistinguishable from the sitting member on
the evidence in these files, and if the member's own committee is absent, the stranger's will look
like a strong proposal. Nothing in the payment files fixes that, which is the reason the answer is
a person's and not a rule's. **The directory closes it**: Patti Anderson sits in House 33A, and
"Anderson, Paul H House Committee" is registered to House 12A, so the Board itself separates them.
What survives is narrower — a committee absent from the directory gets no corroboration either
way, and 1,057 of the 1,732 candidate committees are absent, because it lists current
registrations and older ones fall off.

**The directory carries district and party, and it is now wired into the proposer.** §9.7's
`all-registered-candidates` holds `District` on 728 of its 777 rows and `Party` on all 777
(measured 11 Aug 2026). Measured against the shipped code rather than projected: it takes the
cases needing a person to read alternatives from 92 to **56**, and every one of the 56 that remain
has two or more surviving committees — a real choice about which of a member's own committees to
show, not a failure to identify them. The answer is still a person's; the reading is just shorter.
A `--no-filer-directory` switch on the review script reproduces the without-directory column on
demand, so the attribution is checkable rather than asserted.

**A district is a strong key for a sitting member and a weak one for a predecessor.** Someone who
held this seat before, for this party, carries the same office, district and party as its current
holder, so seat agreement separates a stranger in another district but not a predecessor in the
same one — and a same-surname predecessor is the father-and-son confusion this section exists to
prevent. The directory's own `Incumbent` flag closes it: it marks the current holder of the seat a
row *seeks*, so a predecessor's row is not flagged for the seat their successor now holds. Seat
agreement therefore counts as settled only when the Board also says this candidate holds the seat.
Measured 11 Aug 2026, 15 of the 144 confident proposals were exposed to this — the ones confident
*only* because the directory named the seat — and all 15 sit on a row flagged as the current
holder, so the guard costs nothing and the counts are unchanged.

A committee whose registration is closed, or which the Board does not flag as the seat's current
holder, is **not ruled out** — it is only not treated as settled. Paul Novotny's House 30B row is
flagged incumbent *and* terminated and is genuinely his. Ruling those out would discard members'
own earlier committees.

**A directory row answers one question only: whose committee this is.** It clears an inferred
given name, an unexplained word in our record, and a generational suffix on one side only, because
those are all that same question in different clothes. It clears nothing else — a committee for a
different office stays a different race whoever it belongs to (§7), a quiet committee stays quiet,
and two surviving committees stay a choice only a person may make. A mutation test found that
nothing in 60 existing tests stopped the directory from clearing the *different-office* reason,
which it must never do, because the directory's office field and the committee name's own office
suffix are separate and can disagree; there is a test for it now.

**The `Incumbent` flag is used in one direction and forbidden in the other, and the two are easy
to mistake for a contradiction.** As corroboration that a row *already matching a member's seat*
belongs to that seat's current holder, it holds: a false positive would mean the Board flagging
someone as incumbent of a seat they do not hold. As a test for whether a member has any committee
at all, it fails, because it misses 5 sitting members. Different question, different failure mode,
and the paragraph above depends on the first while the paragraph below rules out the second.

**Presence in that directory is the test for whether a committee exists at all, and the
`Incumbent` flag is not.** All 200 sitting members appear in it, so **"no committee is registered
for this person" is a state a sitting member's profile never reaches** (§7 relies on this). The
flag does not survive contact: it marks 209 distinct people holding one committee each, of whom
only 198 are legislative — the rest are 4 district court, 4 supreme court, and one each for
attorney general, secretary of state and governor. And it does not reliably follow a seat: 5 of
our 200 have no incumbent-flagged live filer in their own seat (Dippel, Novotny, Perryman, Reyer,
Wolgamott), Reyer's live `Reyer, Liz Senate Committee` (19263) carries `Incumbent = 0` while she
sits in House 52A, and Novotny's flagged row is the file's single terminated incumbent. Never use
the flag to establish that somebody has no committee.

**Office and given name are evidence, never filters.** Discarding on either loses real money. Liz
Reyer sits in the House and holds two committees: "Reyer, Lizabeth House Committee" (382
contribution rows) and "Reyer, Liz Senate Committee" (45). Filtering to her own chamber drops the
Senate one; filtering to her spelled first name drops the House one, which is the larger. So every
plausible committee is shown with its office and period, and a person decides.

**A generational suffix on one side only always goes to a person.** A Jr and a Sr of one name is
precisely the confusion this section exists to prevent. Minnesota puts the suffix on either side
of the comma — the surname in "Holmstrom Jr, Michael Senate Committee", the given name in "Backer,
Jeff W Jr House Committee" — so both are read. **"V" is not treated as a suffix**: every "V" in
the 11 Aug 2026 file is a middle initial ("Nelson, Michael V"), never "the fifth".

**One check comes from outside the names, and it can only ever make us more cautious.** Which
party's units paid a committee is independent of every name rule, because it is a different column
of the same row. Party units that state their own party in their registered name ("Cass County
RPM", "44th Senate District DFL") are counted; a filer whose name states no party is not
classified, because asserting one would be a claim the source never makes
(`.claude/rules/grounded-answers.md` rule 3). Across the 108 committees these rules proposed
confidently *before the filer directory was wired in*, 100 carry such money and its party agreed
with our own record on **all 100**, with 0
disagreements — and all 19 disagreements anywhere in the run fell on a namesake rather than on a
name that actually matched. So a disagreement holds a proposal down to review; agreement is
recorded as support and promotes nothing. This is identity evidence only. That a county party paid
a committee helps say *whose* committee it is, and says nothing about what the money bought.

**Coverage is two different numbers, and confusing them is the failure to avoid.** How much the
proposer narrowed down is not how much a person has checked. Measured against production's 200
sitting members, with §9.7's directory wired in: **144 matched, 56 ambiguous, 0 unmatched** —
every sitting member has at least one proposal — and **0 confirmed**, because nothing is linked
until someone answers. Without the directory the same code reads 108 and 92, reproducible with
`--no-filer-directory`. A surname
pool too large to show is capped and the number hidden is printed, because silently cutting the 31
committees named Johnson would read as having considered them all.

**The hard cases are enumerated rather than discovered late**, all of them real on 11 Aug 2026: a
nickname no rule reaches (production's "Liish Kozlowski" is the Board's "Kozlowski, Alicia"); a
legislator known by a middle name ("Bjorn Olson" is "Olson, Christian Bjorn"); two sitting members
sharing a surname in the same chamber (Patti and Paul Anderson, whose pool also holds a former
senator's two "Anderson, Paul Senate Committee" rows); a committee named for another office the
member sought (Lisa Demuth's "Demuth, Lisa Gov Committee", 936 rows); two committees with the same
name in the same office under different numbers ("Gottfried, David House Committee", twice); and a
surname our own record splits wrongly (production stores "Scott Van Binsbergen" as first "Scott
Van", last "Binsbergen", while the Board files "Van Binsbergen, Scott"), which is why a
legislator's name is keyed under every split of it rather than under the stored one.

---

## 6. Amendments

A filing can be superseded. The Republican Party of Minnesota's 2025 report exists as an
original plus three amendments, each restating the same money.

- Every report row records its period and its version.
- Exactly one version per filer per period is the effective one. **A database index cannot
  enforce this on its own**: a partial unique index gives "at most one effective version", and
  nothing stops every version being marked ineffective, so the "exactly one" half has to be a
  check the importer runs and a test asserts.
- **The effective version is the highest amendment index for the key (filer, filing year,
  report type, special-election flag)**, deduplicating the index list first. §9.6 carries the
  evidence, the one malformed index list found, and the reason the "Amendment" checkbox printed
  on the document must not be used instead.
- **Totals read only the effective version.** A query that filters by year alone will count a
  preliminary filing and its final replacement together, which is the specific mistake to
  design against. §9.6 names a second, larger double-count underneath it: a year's reports all
  restate everything since 1 January, so they overlap even before amendments are considered.
- Superseded versions stay visible and readable. They are part of the record.

---

## 7. Display rules

These bind any surface showing this data. The rules about what may be *asserted* live in
`.claude/rules/grounded-answers.md` rule 3 (grounded neutrality) and rule 12 (campaign
finance display); this section covers what must be *shown*.

**Two numbers, both correct.** The reported total and the sum of listed payments are different
figures and both appear. The difference between them is usually legitimate small-donor money,
not an error and not missing data. A page must say what the difference is rather than leaving
a reader to assume one number is wrong.

Measured across sitting legislators' committees, the unnamed share is 36.5% of the 2024 total
and 41.3% of 2025, with the median committee at 40.3% and 36.1% (§9.5). **Roughly 4 dollars in
10 have no name attached on a typical profile**, so a treatment tuned for a thin remainder is
wrong for almost every member. The extreme is also real: Senator John Marty's committee reported
$13,900.48 for 2025 against a single named payment of $1,000.

**Take both ends of a period from the filing.** Almost every report runs from 1 January (§9.6),
but a special-election filer's regular series begins where the special series stopped, and the
pair itself does not always start the year: filer 19223 reports from 11 July 2025, which is 5
days before it registered, while a filer that registered in March still reports from 1 January
(§9.5). **No surface may hardcode 1 January as the period start**, or label a figure "2025" when
it means 11 July to 31 December. This is the rule a design is most likely to get wrong from
reading §7 alone, because §9.6's 1 January statute is stated plainly and its exception is one
clause inside a paragraph about something else.

**The total is reported; the split into itemized and not-itemized is computed. Decided this
way deliberately.** §9 establishes that the route returns the filing's own total, so the large
number on a card can never disagree with the filing, because it *is* the filing's number. The
filing also states its own itemized and non-itemized subtotals, but only on the report document,
one request per filing and only for 2023 onward (§9.4). So the split is derived — reported total
minus the rows we hold — and that derivation reproduced the filing's stated split to the penny
everywhere it was checked at full precision (§9.5). **The reason this is safe is a check, and the
check has already earned itself**: a shortfall in our rows lands silently in the "not itemized"
figure, and the only failure that announces itself is the gross one, where the subtraction goes
negative (10 of 407 committee-years, all special-election candidates, §9.5). So each release
compares the derived split against the filing's own stated split for **every** filer-year on
screen, not a sample, and a mismatch blocks publication under §4.3 exactly as a negative result
does (mechanics and why not a sample: §9.4).

Run for the first time across the full 2025 population, that check found the derivation wrong for
19 of 202 legislator-years, from a column nobody had read: 1.2% of the rows in the file called
"itemized contributions" are not contributions at all (§2.1). Filtering them out leaves **3**, and
those 3 are precisely the silent case — the filing itemizes more than our rows hold. Omar Fateh's
committee is the sharpest: the filing itemizes $2,300.00 for 2025 and we hold no rows at all, so a
card would have shown every dollar of it as unnamed small-donor money. **So until a filer-year
passes this check, its split is not published**, and "we hold no itemized rows" is never rendered
as "this money had no names".

**A figure may not be rendered for a requested year unless the returned coverage end falls inside
that year. This is a guard, not a caption.** The totals route **ignores the year you ask for when
that year has no report, and returns the most recent report's figures instead** — HTTP 200, no
marker, nothing in the response different except its coverage-end date. Measured on 8 filers with a
2025 report and no 2026 report: all 8 answered a 2026 request with their 2025 figures, byte for byte
(§9.1). So the coverage-end date is the only thing standing between a page and **printing last
year's money under this year's heading**, which is the worst output this product can produce: a
wrong number that looks exactly like a right one. Check it first, then print it beside the figure.

**Three of §7's empty-year states never fire if a build trusts that route.** A member not on this
year's ballot, a member whose committee has closed, and a member whose report is late are all
populations whose request for this year returns last year's money. Each is drawn as an empty
treatment, and each would instead show a full, confident, stale total. The states are right; the
trigger is what has to change, and the trigger is the coverage-end check above.

**When the totals route fails, keep the last accepted figures and their existing date.** §9.3
makes an undocumented route's failures stop a release rather than degrade it, and answers several
kinds of failure with a success status. So a card needs no "temporarily unavailable" state for
this: it shows the figures we last accepted, dated honestly as of when they were accepted. Older
and labelled beats blank, and both beat a number we cannot stand behind.

**And where the official total is not available, show no total at all.** This paragraph said the
opposite until [#1337](https://github.com/alethical-org/alethical/issues/1337) closed a few hours
after it was written: the route in §9 does supply the official total for the regular report
series, so **the two-number card is the ordinary case a design draws, not a later upgrade.**
What remains is a real gap, and it is per filer-year rather than product-wide. Special-election
candidates file a second report series that the route does not return, so the subtraction goes
negative on 10 of 407 measured committee-years, and §9.5 is explicit that a negative result is a
failed reconciliation rather than a number to clamp. For those filer-years, and for any the
route does not cover, print the named payments alone, labelled as named payments, with no
composition bar, because there is no whole to divide. Never print a partial figure under a
caveat: a caveat under a large number loses to the large number, and the reader keeps the figure.

**That last gap is closing, so do not design around it as permanent.** §9.5 now records both of a
special-election filer's report series as fetchable, with their periods adjacent in all 5 filers
measured, so once the assembly of the two is built those 10 committee-years show a real total like
everyone else. Until it is built they read "Not reported"; what they must never do is show the
regular series alone as though it were the year, which for filer 18453 would have printed $317.20
against a true $283,287.13.

**A missing surface makes a claim too, so the tab always renders.** A legislator's campaign
money is a tab on the profile they already have, and it appears for every member whether or
not their committee link is confirmed yet ([#1354](https://github.com/alethical-org/alethical/issues/1354)).
Hiding it until the link is checked was proposed and **rejected**, and the reason is recorded
here so it is not reintroduced: two profiles side by side, one with a money tab and one
without, tell a reader the second member has no campaign money, when the truth is an
unfinished clerical task of ours. That is `.claude/rules/grounded-answers.md` rule 12's
missing-versus-zero failure moved out of a number and into the navigation, where no per-profile
wording can reach it. The count is also temporary and shrinking, so gating would build a
permanent mechanism to hide a problem that goes away: the shipped proposer narrows 200 sitting
members to **144 matched and 56 ambiguous, with 0 unmatched**, and each of the 56 is a choice
between two or more of that member's own committees rather than a failure to identify them (§5.1).
**The number a page may print is the confirmed count, and today that is 0**, because a proposal is
a question and only an answer is a link. Two earlier figures are superseded and recorded so nobody
reads a drop as a regression: an independent estimate of 111
([#1329](https://github.com/alethical-org/alethical/issues/1329)), and 108 from the same code
before §9.7's filer directory was wired in.

So on the day this ships the unconfirmed state is not an edge case, it is the tab: **all 200
profiles show it**, and they drain one at a time as answers land. The 144 and 56 describe how hard
each review is, never what a reader sees. Read those two numbers in the wrong order and a design
budgets its care for 56 exceptions against 144 populated pages, when the truth on launch day is
200 unconfirmed pages and none populated.
What the unconfirmed state must do instead is explain itself, and never render "no committee is
registered for this person" the same as "we have not confirmed which of their committees is
theirs to show".

**A claim about the population belongs on exactly one surface, and a per-member surface speaks only
about that member.** This is the rule that keeps the coverage count from needing a second design when
it stops being zero. The count is inherently a statement about all 200, so it lives where a reader
meets the whole set — the money landing page — and it requantifies as answers land. A member's own
page says nothing about the other 199: not "no figures are on any profile", not "every profile starts
here", not "this is true of everyone today". Those sentences are true at zero and false the moment the
first confirmation lands, so they are written with an expiry date built in. **The wording to reach for
is the one that is equally true at 0 confirmed, at 144 and at 199**: we have not confirmed which
committee is this member's, so no figures are shown here, and that is our work rather than a fact
about them. Written once, it never needs a partial variant, and no page can contradict another as the
number moves. Decided 12 Aug 2026 while resolving where the zero-confirmed fact belongs; it is also
why the legislator directory carries no money caveat at all (that page shows no money, so a caveat
there would advertise an absence).

**On a sitting member's profile, only the second of those two ever happens.** All 200 sitting
members appear in the Board's registered-filer directory (§5.1), so a member with no registered
committee is not a case the profile tab reaches, and its unconfirmed state can say the true and
narrower thing: their committees are on file and we have not yet confirmed which is theirs. The
"none registered" state still belongs to a standalone money page for someone we hold no
legislator record for. The three states a surface must keep apart are therefore **nobody has
looked yet**, **checked, and none of their candidate committees is theirs**, and **linked** —
which §5.1's table already distinguishes without a fourth value, because a rejection is stored
rather than discarded.

**And rejecting every proposal for a sitting member is not "no committee is registered" — it is an
unexplained contradiction, and no reader-facing card may state it as a fact.** The two claims are
about different things: rejections are about the committees we found and proposed, while "none is
registered" is a claim about the Board's records, which for all 200 sitting members is false (§5.1).
So a member with every proposal rejected means their committee exists and we did not surface it,
which wants a person's attention rather than a card. The "none registered" card is honest only on a
standalone money page for someone we hold no legislator record for.

**What shipped for the period stamp is richer than the rule above, and the rule is the floor.** The
built panel binds four facts that move with the record — the period, which report it comes from, the
day we checked, and the next date something is due — and deliberately shows **no date range at all**
in the two variants where no period is covered, rather than falling back to a year label. Anyone
rewriting this paragraph should read what shipped first.

**The next-due date may be a served fact rather than a transcribed one.** The panel's fourth fact was
specified against a hand-kept table of filing calendars, because which calendar a member is on is not
in any data we hold ([#1375](https://github.com/alethical-org/alethical/issues/1375)). §9.4 now records
the Board answering it per filer instead: asking for a report that is not out yet returns the date it
will be. So the "Not reported" state can name a real date without anyone classifying members onto
calendars. Measured on 6 filers, one report type and one day, so **build the state to take a date it
may not get**: a member whose release date we cannot obtain shows no date rather than a guessed one,
which is the rule that already applied when the calendar was the source.

**And there are two dateless cases, not one.** A report **not yet due** yields a date. A report
**overdue** yields none — measured, and it never yields a stale one (§9.4) — and that filer is the one
a reader is most likely to misread, because a blank where a date belongs reads as concealment. The
honest line there is that the report is late, which §9.6's null `amendments` array lets a page know
without a document request and without guessing. Wording for that case belongs to the money tab.

**One legislator, several committees.** Minnesota registers a committee per office, so a person
accumulates them: 17 sitting members tie to more than one, and 8 have 2 or more active in
2025 or 2026 at once (measured 11 Aug 2026). So a confirmed link is one-to-many and carries
each committee's office and period, a figure says which committee it belongs to rather than
only which year, and **money from a race for another office never appears under a legislator's
profile** — outside spending on a city campaign is a real record, but placing it under a state
senator's name asserts something about their legislative work that no filing supports. A search
result therefore resolves a name to a *committee*, not to a person: the same file holds
`Fateh, Omar Senate Committee` and `Fatehi, Leili House Committee`, one character apart and two
different people, which is the concrete case behind §5.

**Never rank, total or sort members by amount for the current year.** Sitting members are on two
different filing calendars, so on any day in 2026 a side-by-side list compares one member's
part-year total against another member's — **and the second figure is not blank, which is worse
than the version of this rule that stood here until 12 Aug 2026.** That version reasoned from a
blank. There is none: a member with nothing filed for this year answers with last year's money
(§9.1), so an unguarded list would put two members side by side, both figures confident, both
looking current, covering **different periods**, with nothing on screen to say so. The rule was
right and its stated reason described a failure that does not occur. Verified by reading the
Board's own calendars
on 11 Aug 2026: a member on the 2026 ballot filed a pre-primary report on 27 Jul covering 1 Jan
to 20 Jul and files a pre-general on 26 Oct (`cfb.mn.gov/pdf/calendars/2026_senate_house_district_court.pdf`),
while a member **not** running files nothing covering 2026 money until the year-end report due
**1 Feb 2027** (`cfb.mn.gov/pdf/calendars/2026_candidates_not_running.pdf`, whose only 2026
entry is the *2025* year-end report due 2 Feb). A ranking built from that is a comparison of
filing schedules wearing the costume of a comparison of money, and it reads as authoritative.
Show each member's figures with their own period instead.

**Independent spending needs the same confirmed link a member's own money does.** Measured
across all 2,674 independent-expenditure rows for 2025 and 2026 ([#1329](https://github.com/alethical-org/alethical/issues/1329)):
every row names an affected *committee*, 2,670 carry that committee's registration number, and
**none names a person**. So no surface may promise "money spent about this legislator" before
their committee link is confirmed, and a state without the link is genuinely empty rather than
partly filled.

**One freshness date is not a coverage period, and in 2026 they are far apart.** A page may
carry the release's freshness date; it may never present that date as the period the money
covers, because the period is per member and always earlier. This matters most at launch:
nothing new publishes between **21 Jul and 26 Oct 2026**, so a September launch shows figures
that stop in July, on the far side of an 11 Aug primary that none of them reflect. Copy that
implies currency has to survive that gap (`.claude/rules/grounded-answers.md` rules 6 and 7).

**Dates, three separate rules:**

- Each payment shows its own payment date and its source.
- Each total states the period it covers and its source.
- Each page shows one clearly labelled freshness date, consistent with
  [#861](https://github.com/alethical-org/alethical/issues/861).

**Missing versus zero.** A missing value reads "Not reported". A verified zero reads "0". A
candidate who genuinely raised nothing is not the same as one whose filing we do not have.

**A closed committee is a fifth state, and it is the one a reader is most likely to read as
concealment.** A sitting member's committee can be terminated mid-year, and then the year is empty
for a reason none of the other states describes: not a reported zero, not a report still to come,
not a report due next February, and nothing to do with our own confirming. Paul Novotny sits in
House 30B and his committee terminated **28 July 2026** with zero 2026 contributions, its last
payment dated 17 Nov 2025. So the page says the committee closed, and says when. **The year control
makes it sharper**: his 2025 holds money and his 2026 holds none, so a reader switching years watches
money disappear, and the explanation has to be on the screen they land on rather than inferable from
the one they left. Population unsized — termination is not in the bulk downloads and costs one
catalogue request per filer ([#1415](https://github.com/alethical-org/alethical/issues/1415)) — but
one confirmed case in an election year is enough to require the wording.

**Separate transfers, never a chain.** Money is fungible. That a party gave a caucus $100,000
and the caucus later gave a candidate $5,000 are two documented facts. That the same dollars
travelled is not a fact and no filing establishes it. Show each transfer with its own amount,
date and source. A network view may show the shape; it may not imply continuation.

---

## 8. Row counts are measurements, not requirements

Every count in this document is what a file held on the date given. The contributions file
held 583,120 rows on 10 August 2026 and 583,152 on 11 August. It grows daily. No count here
is a target, a test fixture, or a thing to assert; each is evidence for the design, and the
snapshot model exists precisely because these numbers move.

---

## 9. Filed reports: where the official totals come from

The two questions this section used to leave open ([#1337](https://github.com/alethical-org/alethical/issues/1337))
are answered. §7's "two numbers" rule can be satisfied.

**The Board runs a per-filer totals service, and it has already resolved the amendment.** So
the official total is fetchable, and for the reports it covers nothing on our side decides
which version supersedes which. It does not cover everything (§9.5), and it is undocumented
(§9.3), so both of those are constraints on the design rather than footnotes.

Every measurement below was taken against the Board's own service on 11 August 2026. Where a
figure comes from a sample rather than a population, the sample is named.

**The standing rule for everything in this section, because every failure it has shown us answers
200 and looks like data.** A stale year, five refusal shapes, a wrong `period` code, an empty body:
none of them arrives as an error.

> Nothing from this route may be displayed on the strength of the request alone. Where the response
> carries a field that independently confirms what was asked — the coverage end for the period, a
> `%PDF` header for a document — **that field is the gate and the request is not**. Where it carries
> none, the guarantee has to come from the request instead, and must be stated as such. The financial
> response identifies no filer, so which committee a figure belongs to rests entirely on the
> registration number we sent: it is carried through from a human-confirmed link (§5.1) and never
> re-derived from a name at query time.

The second half of that is not a hedge. Measured across four requests, the financial response carries
**no registration number, no committee name, and no filer identifier of any kind** — filers 11880 and
18472 return structurally identical documents differing only in their amounts. So a rule promising
that a field always confirms the request would create false confidence exactly where none is
available, which is why both halves are stated.

### 9.1 The route

`POST https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/<viewer>/api`

| filer kind | `<viewer>` |
|---|---|
| candidate committee | `candidates` |
| party unit | `party-unit` |
| political committee or fund | `political-committee-fund` |

Form-encoded body — one filer, one two-year window per call:

```
id=11880
year=2025
year_data[ElectionSegmentStartDate]=2024
year_data[ElectionSegmentEndDate]=2025
tabname=financial
```

**A `Cookie` header naming `PHPSESSID` is required, and it is not a session.** Omit it and the
server answers **403** with an Apache HTML error page. In the requests tested, `PHPSESSID=`
with an empty value answered 200, and so did `PHPSESSID=zz`, while `Cookie: x=y` still answered
403. No login, token, `Referer`, `User-Agent` or `X-Requested-With` changed any outcome. That
is an observed effect, not a published contract: the Board could start checking the value at
any time, and every request would then 403 (§9.3).

**Sending the same parameters as a GET query string returns HTTP 200 and `[]`.** Omitting both
`year_data` values returns HTTP 200 and `{"tabcontent":"<p>No information found for
Financial</p>"}`. Whether each `year_data` value is independently required was not tested.
Both are silent false passes of the kind §2.1 already documents for the bulk downloads, and
they are why §9.3's content checks are not optional.

The response is `{"tabcontent": "<table>…</table>"}` — **money inside an HTML table inside
JSON.** This investigation found no structured counterpart. Other tabs on the same endpoint do
return structured data alongside their HTML (`tabname=reports_data` returns the report
catalogue §9.6 relies on), and the separate list service in §9.7 returns pure JSON, so the
absence here is specific to the financial tab rather than to the Board's site. Every row is
`<th>label</th><td>$amount</td>`.

All 407 measured sitting-legislator committee-years carried the same 17 lines: beginning cash
balance, most recent report through, individuals / lobbyist / committee-fund / party-unit /
other contributions, public subsidy payments, loans payable income, miscellaneous income, total
receipts, campaign expenditures, noncampaign disbursements, other expenditures, total
expenditures, ending cash balance, unpaid bills and loans. **Three of those labels embed a
date** ("Ending cash balance as of 12/31/2025"), and the date is not always 31 December — one
committee-year read 11/16/2025 — so match on the label's stem, never on the whole string. The
12 sampled party units and 12 sampled committees or funds carried a single "Contributions
received" line in place of the five contributor-type lines, plus their own disbursement
categories; rarer labels were not ruled out.

**That stem rule is for the cash-balance figures, not for a period end. The period end is a
served field.** The report catalogue (`tabname=reports_data`, §9.6) returns **`CutOffDate`** per
report as a clean value — `2026-07-20 00:00:00` — so nothing needs a date parsed out of a label to
know when a period ended. Read as an instruction to implementers, the paragraph above looked like
the only route to one, and it is not.

**It is never empty: 0 of 1,707 reports**, across 130 legislator committees and filing years 2009 to
2026, including 1,041 reports from before 2023. Checked for null and for whitespace-only, because an
absent value in a fixed field list arrives as an empty string rather than a missing key. So a surface
that cannot resolve a period **end** is a defensive state rather than an observed one; a surface that
cannot resolve a **start** is the ordinary fallback, since no start is served at all.

**The catalogue's full field list, so what it does not carry is settled rather than unchecked.**
Per report: `RegisteredEntityID`, `RegisteredEntityType`, `ReportType`, `FilingYear`,
`as_2DigitYear`, `ReportName`, `PrePrimaryReport`, `PreGeneralReport`, `YearEndReport`,
`SpecialElectionindicator`, `SpecialElectionDistrict`, `TerminationDate`, `TerminationYear`,
`District`, `NoticePeriod`, `CutOffDate`, `amendments`. **No period start is served anywhere**, and
`NoticePeriod` is a flag reading `1` rather than a date.

**`TerminationDate` and `TerminationYear` belong to the registration, not to the report they arrive
on, so they are the same field §5.1 uses and not a second source for it.** One value is repeated onto
every report row: 28 of 28 rows null for filer 11880, 13 of 13 null for 18453, and all 16 rows for
18472 carrying `2026-07-28`. **That repetition is a trap.** Filer 18472 has reports back to 2019 and
every one of them carries the 2026 termination date, so read as "this report terminated the
committee" it is wrong on 15 of 16 rows. It means "this registration is terminated, as of this date",
and says nothing about the report it is attached to. §7 turns the same fact into a display state.

**Read termination from any row, and never infer it from `TerminationYear`.** It is present on every
report row of a terminated filer, not only the final one: across 12 filers carrying one, 16 of 16,
17 of 17, 8 of 8, 6 of 6 and so on. So a profile takes it from whatever year's row it already holds
and needs no extra query. And `TerminationYear` is **never** set while `TerminationDate` is empty — 0
cases in 1,707 rows — so the date is the field to read and the year is a derivative of it.

**A terminating committee files its final report at termination, not at the period's end, and that
confirms §9.6's null-array signal rather than breaking it.** Filer 18472's 2026 year-end is catalogued
with a cutoff of 12/31/2026 and serves a real document today, months early, carrying
`amendments: ['0']`. So `['0']` means *filed* even while the nominal period is still open, which is
exactly what the signal claims; a null array still means never filed. This was checked specifically
because it looked like a counter-example.

**Each contributor-type line is that schedule's itemized plus non-itemized total, from the
effective version.** Checked line by line against the documents for two filers. Senator Scott
Dibble's committee (15667), 2024: the route's individuals $4,869.59 equals the report's
$2,600.00 itemized plus $2,269.59 non-itemized; lobbyist $200.00 equals $0.00 plus $200.00;
committee/fund $750.00 equals $250.00 plus $500.00. Its campaign expenditures and noncampaign
disbursements match their schedules the same way.

**"Most recent report through" is the figure's coverage end, and it is the only guard against
publishing the wrong year entirely.** State the guard before the caption, because the caption is
what it looks like and the guard is what it does.

**The route ignores the year you ask for when that year has no report.** It answers 200 with the
most recent report's figures instead: no status, no empty block, no marker, and nothing in the
response different except this field. Measured on 8 filers holding a 2025 report and no 2026 report
at all, each queried at both years:

| filer | 2025 answer | 2026 answer |
|---|---|---|
| 16697 | through 12/31/2025, $22,502.00 | identical |
| 17075 | through 12/31/2025, $12,050.00 | identical |
| 17532 | through 12/31/2025, $10,940.00 | identical |
| 17686 | through 12/31/2025, $3,550.30 | identical |
| 17860 | through 12/31/2025, $0.00 | identical |
| 18020 | through 12/31/2025, $8,886.63 | identical |
| 18157 | through 12/31/2025, $4,970.00 | identical |
| 18168 | through 12/31/2025, $14,329.00 | identical |

8 of 8, and filer 18472 the same: a 2026 request returns 12/31/2025 and $9,455.00. **Note filer
17860**: a genuine reported $0.00 for 2025, returned again for 2026, so the failure is not detectable
by treating zero as absent either.

**So the rule is: a figure may not be rendered for a requested year unless the returned coverage end
falls inside that year.** Otherwise the year has no data and §7's empty state applies. Then, and only
then, print this date beside the figure — which is also what makes §7's no-ranking rule enforceable
per figure rather than per page.

**And this route does not return a terminating committee's final report**, even where the catalogue
serves that report's document today (§9.6). So the population §7 most needs an empty state for is
exactly the population this route answers with stale money.

### 9.2 What it costs, and how far back it reaches

Median response 0.36 seconds over 20 timed calls. At the 0.25-second spacing used throughout
this investigation, **209 sitting legislators take about 2 minutes and roughly 1,600 filers
across all three kinds take about 16 minutes.** It is still 1,602 separate requests.

Roughly 1,200 requests were made to the Board across about two hours on 11 August 2026 with no
refusal, no throttling and no block observed. That is evidence about that day's behaviour, not
a rate limit we have been told.

It reaches back further than anything else we have. For filer 12604, totals were returned for
every two-year window tested from 2026 down to **2009** — against bulk downloads that start in
2015 and report PDFs that start in 2023 (§9.4). Only that one filer was walked back that far.

### 9.3 It is undocumented, so the checks are the design

The Board publishes no promise that this route exists, keeps its address, keeps its request
fields, keeps the cookie behaviour, or keeps the table's shape. **HTTP 200 therefore cannot
count as success.** A release that reads these totals must stop entirely — not degrade — when
any of the following fails:

- The response parses as JSON and carries `tabcontent`.
- The requested calendar year appears as a block heading.
- Every label is one this design knows, no label is missing, and no label repeats.
- Every value parses as money.
- A fixed set of test filer-years still returns the figures recorded here, including the two
  amendment cases in §9.6, which is what detects a silently changed resolution rule.
- Totals have not moved more than a sane band from the last accepted release, per §4.3.
- The returned coverage end falls inside the year that was requested (§9.1). This is the check that
  catches the route's own most dangerous behaviour, so it belongs in the release gate and not only in
  the display layer.

**Four content shapes for this route, and only one of them is data.** The normal answer is 17
labelled rows, about 4,325 characters. `No information found for Financial` comes back when
`year_data` is omitted. A bare `[]` comes back from a GET. And **an unknown filer id fails loudly**,
which is the one piece of good news here: 151 characters reading `Data not available` for each year,
returned identically for id `99999` and for id `0`, and clearly distinguishable from a real answer.

**Keep the raw response bytes for every accepted release**, in the store §4.5 defines. If the
Board's HTML changes later, a published figure cannot otherwise be traced to the response that
produced it.

**When the checks fail, keep publishing the last accepted totals with their existing freshness
date and withhold the new ones.** There is no second bulk source to fall back to: the report
PDFs cannot serve the population (§9.4), and no other route carries these figures.

**A refresh takes minutes, and an amendment can land inside that window.** A filer read at the
start and a filer read at the end may sit on either side of a new filing. This is the same
hazard §4.1 already rules on for the bulk files, and the same answer applies: the totals fetch
is part of one dated release, and figures from different fetches are never shown together.

### 9.4 Report PDFs are a fallback, not a route

The Board's pages link a PDF for every report back to 2009. Many of those links do not work,
and they fail in the way §2.1 warns about: **HTTP 200 with a 30,424-byte HTML page** and no
error status. Reproduced from the Board's own page in a browser with its own session, so this
is the source's gap and not our misuse of it.

Of a random 110-report sample drawn from a 1,005-report catalogue, **27 returned a PDF and 83
returned HTML.** By kind: pre-general 0 of 30, pre-primary 7 of 25 (only the current cycle's),
year-end 20 of 55. By filing year, everything sampled from 2026, 2025 and 2023 was served;
2024 gave 5 of 19; **2022 and earlier gave 0 of 69.** Walking year-end reports back one year at
a time on two filers, retrying each, puts the boundary at 2023: 2023 through 2025 served, 2022
and earlier not. That boundary was established for year-end reports on those two filers only.

The request, when it works:

```
POST https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF
searchType=Candidate&downloadpdf=true&year=25&type=pcc&period=YE
  &se=0&regnum=20008&amend=2&disc=&date=&show=0
```

`type` is `pcc`, `ptu` or `pcf`; `period` is `C` (pre-primary), `E` (pre-general) or `YE`
(year-end); `se` is the special-election flag. **Check that the body starts with `%PDF`** —
nothing else in the response distinguishes a document from the error page.

**`period` takes the catalogue's own `ReportType` verbatim. Those three values were an incomplete
list, not a restrictive one.** The catalogue returns three more across 1,707 legislator reports — `A`
(31, pre-primary under an older name, "2010 15th Day Pre-Primary"), `B` (31, pre-general under an
older name) and `G` (1) — and **all three return real PDFs**: `A` and `B` on filer 19273's 2026
reports, `G` on filer 19259's, at 17,170, 17,644 and 19,750 bytes. So those 63 reports are reachable,
and an earlier version of this paragraph called them a third cause of a missing prior figure. They are
not. Pass through whatever type the catalogue names.

**There are five soft-failure shapes, all HTTP 200, and only one of them is HTML.** The 30,424-byte
HTML page above is one. The rest:

- `File requested has not been released.  Try back on 02/02/2027 at 8am` — plain text, 68 bytes. The
  report exists and is scheduled. Returned for a 2026 year-end on 5 of 6 filers tested.
- `The file requested has not been released.  Files are available at 8am following the due date.  If
  you believe that this report should be available please contact the board.` — plain text, 172 bytes,
  returned for `period=C` on a filer whose 2026 pre-primary is type `G`, so **this is also what a
  wrong `period` code looks like**: not an error, a polite plain-text no.
- `Requested file not found.` — plain text. What an **overdue** report returns. Measured across every
  2026 pre-primary report in a 1,707-report catalogue, cutoff 20 Jul and due 27 Jul, read 16 days
  after the deadline: 97 served a real PDF, 2 gave this line (filers 18530 and 18767, unchanged when
  retried at `amend=0`), and **0 returned a stale "try back on" a date already past**. That last count
  is the one that matters, because a stale future-tense date would be worse than no date at all.
- An **empty body**, 0 bytes, on one 2014 year-end.

**The third of those is the genuine third cause of a missing prior figure**, and it is worse than the
one it replaced, because **a check testing "is the body HTML" passes four of the five as success**, and
one testing "did I get bytes back" passes four as well. §9.4's `%PDF` rule catches all five. It has now
earned itself three times in two days, each time against a shape nobody had imagined.

**And the same failure hands us a served release date, per filer, per report.** "Try back on
02/02/2027" against a calendar due date of 1 Feb 2027, with the second variant stating the rule
outright: files are available at 8am following the due date. That looked like a per-filer answer to the
question [#1375](https://github.com/alethical-org/alethical/issues/1375) was opened to hand-transcribe.
**It is not, measured on the full population (#1375, 13 Aug 2026): 1,261 filers carry a catalogued 2026
pre-primary and not one filer of any kind carries a 2026 pre-general, though it is due 26 Oct.** Nothing
served can name the next report, so the hand-transcribed calendars were necessary after all and shipped
in [#1481](https://github.com/alethical-org/alethical/pull/1481). The served date remains useful for the
report it does name. Limits worth
keeping in view: 6 filers, one report type, one day, and an undocumented route. **The sixth filer is
the corroboration worth noticing** — 18472 returns a real 2026 year-end PDF because a terminating
committee files its final report early, which is §7's closed-committee state arriving independently
from a different route.

**The per-filing route is a validation path, not a display path.** §9.5 derives the non-itemized
figure by subtraction, and a subtraction that comes out *positive but short* publishes silently: a
gap in our rows lands in the "not itemized" bucket and looks ordinary. So each release compares the
derived split against the filing's own stated split, and §4.3 blocks publication on a mismatch.
**Check every filer-year on screen, not a sample.** The population is one report per sitting
legislator per year, about 209 documents and roughly 420 requests for a single year, which runs in
one pass; a sample sized for a random failure rate is the wrong instrument here, because the failure
this guards against is narrow rather than systemic and only checking a filer catches that filer.
Measured on the full 2025 population, 199 of 202 ordinary legislator-years reconcile exactly and
the 3 that do not are all short in our rows, the direction nothing announces. Special-election
filers are excluded from this comparison and handled by §9.5, since their regular report covers
only part of the year.

**A filer-year whose rows match a superseded version is a failure, not a pass.** §9.1's route
returns the effective version's totals while the bulk file may hold the superseded version's rows
(§2.1), so subtracting one from the other produces a figure belonging to no filing. This is §6's
rule reaching the display through the data rather than through a query, and it is the main thing the
split check catches in practice. The instinct to relax the check here is the wrong one: "our rows
match the original exactly" sounds like a reconciliation that passed and is the clearest evidence
that it did not.

**The checker validates itself before it may block anything.** Read the figures by schedule code,
never by position: a filer with no lobbyist money has no `A1 - LOB` block, and a position-based
read returned $20,754.27 for a filer whose reported figure is $6,002.62. The self-test is exact and
costs nothing extra, because each contributor-type line the route returns equals its
`Schedule A1 - <code>` block's itemized plus non-itemized total. When the parser's figures and the
route's disagree, the parser is wrong and the check reports itself broken rather than failing the
release.

Three parser bugs have been caught this way, and the third is the one that argues hardest for the
rule: an expenditure parser returned **zero rows for all 4 filers**, which looks exactly like the
data being absent rather than like a bug, and the cause was a pattern that assumed contribution
row shape (expenditure rows put the purpose text between the date and the amount). A wrong number
invites suspicion; "no data at all" invites a conclusion about the source. None of the three was
found by reading the code.

**The self-test is sharper for candidates than for party units, and the parser trap is the reverse.**
A candidate committee's route response carries up to 5 contributor-type lines, each of which must
match its own named schedule, so a parser error is caught per schedule. A party unit returns one
combined "contributions received" line against its single `Schedule A1 - CR`, so there is one number
to agree on: the test still catches a broken parser but can no longer say which schedule broke.
Against that, **a party-unit document is where a heading-relative parser fails silently.** In the
Republican Party of Minnesota's 2025 report the schedule heading sits at line 104 and its totals at
line 1,924, because every itemized donor sits between them. Reading totals from near a heading works
on small candidate reports and finds nothing on a large party unit.

**Scaling it to every filer is the same job, three times over.** Most filers have no activity in a
given year: 200 party units and 283 committees and funds have 2025 rows, against 299 and 526
registered, so with the legislators a full 2025 pass is about **692 filers**. Document availability
is *better* on that side, not worse — 56 of 56 sampled year-end reports served, against the
wholesale pre-election failures §9.4 records for candidates.

**The amendment marker cannot be backfilled before 2023.** Superseded report documents are served
for 2023 onward only, so an older figure carries no "previously reported as" marker. Its absence in
an older year means the document is unavailable, never that the report was never amended.

### 9.5 The non-itemized figure, and where the route is not enough

Rule 12 of `.claude/rules/grounded-answers.md` needs both numbers on the page. The route gives
the official total; the non-itemized figure is that total minus the itemized rows we hold.

**The subtraction reconciles exactly where it was checked at full precision.** Republican Party
of Minnesota (registration 20008), 2025: our itemized rows sum to $170,053.52 cash and
$5,751.39 in-kind, and the report states exactly those two figures as its itemized totals. The
report states $578,590.42 non-itemized, and $170,053.52 + $578,590.42 = $748,643.94, which is
what the route reports as contributions received. That is one committee-year at full precision;
the formula was not validated for every filer-year.

**How much money it recovers, across sitting legislators' committees:**

| | our itemized rows | official total | difference | share of official |
|---|---|---|---|---|
| 2024, 200 committee-years | $4,112,295.10 | $6,474,414.12 | $2,362,119.02 | 36.5% |
| 2025, 207 committee-years | $6,320,211.90 | $10,764,744.54 | $4,444,532.64 | 41.3% |

The **median** committee's own share was 40.3% in 2024 and 36.1% in 2025, so this is not a few
large committees pulling an aggregate. Senator John Marty's committee (11880) is a plain case:
one $1,000 itemized row for 2025 against an official $13,900.48.

Those differences are the plain population totals. Summing only the committees where the
official total exceeds our rows gives $2,535,932.08 and $4,636,791.82; the gap between the two
ways of counting is the negative cases below, and both figures are recorded here so a later
recount can tell which was meant.

**The subtraction goes negative on 10 of 407 committee-years, and a negative result is a failed
reconciliation, not a number to clamp.** §4.3 already says a failed reconciliation blocks
publication; that applies here. Do not print the derived figure for those filer-years.

**Every one of the 10 is a special-election candidate, and that is the cause.** A candidate who
runs in a special election files a whole second report series, flagged
`SpecialElectionindicator = 1`, and **this route reports only the regular series.**

**Both reports are fetchable, and together they are the year — but only from the special series'
own start.** Measured across 5 special-election filers (18453 in 2024; 19193, 19205, 19223,
19229 in 2025), each series serves a PDF at its highest amendment index, and **the regular
year-end begins the day after the special series ends in all 5**. Filer 18453, 2024: the special
series covers 1 January to 25 November and states $171,992.26 itemized and $110,977.67
non-itemized; the regular year-end covers 26 November to 31 December and states $250.00 and
$67.20; the route returns $317.20, which is exactly the regular pair, and our bulk rows sum to
$172,242.26, which is exactly $171,992.26 + $250.00. **The bulk file covers both series; the
route does not.**

**The pair does not always start on 1 January, and the start is served nowhere.** 3 of the 5
begin on 1 January; 19229 begins on its registration date and 19223 begins on 11 July, **5 days
before it registered**, while 19205 registered on 20 March and still reports from 1 January. So
a surface prints the period read off the report and never says "2025" where it means "11 July to
31 December 2025". §9.1 records the catalogue's full field list: there is no start date in it.

**But it appears to be derivable, on one confirmed case.** The regular series looks to begin the
day after the latest special-election cutoff. Ann Johnson Stewart's 2024 catalogue entries carry
`CutOffDate` 2024-07-30, 2024-10-22 and 2024-11-25 with `SpecialElectionindicator = 1`, and
2024-12-31 with the flag clear; 25 Nov + 1 day is 26 Nov, which is exactly the start this section
documents for her regular year-end. The flag separates the two populations at read time, so no
stored marker is needed to know which rule applies, and for every other filer the start is 1 January
by statute (§9.6) rather than by assumption. **Confirmed on one filer-year only** (§9.9), so treat it
as an observation to verify across the population before a build depends on it — and note it is the
sort of rule that would fail silently, since a wrong start still renders as a plausible date range.

**Read the figures by schedule code, never by position.** Each contributor-type line equals its
`Schedule A1 - <code>` block's itemized plus non-itemized total, confirmed line by line against
the route for filer 19223. A filer with no lobbyist money has no `A1 - LOB` block, so the blocks
sit at no fixed offset; reading by position returned $20,754.27 for a filer whose reported figure
is $6,002.62.

So for a special-election filer the year's official total is assembled from both series' reports
(§9.4). It may never be printed from this route alone, and until that assembly is built the year
reads "Not reported" rather than showing the regular series as if it were the whole year.

**11 of 418 requested committee-years returned no financial block at all.** That is consistent
with a committee that filed nothing, but the response alone cannot tell that apart from a bad
request or a changed route, because both also answer 200 with no block. Corroborate against the
filer's report list (§9.6) before showing "Not reported".

### 9.6 Which version is effective, and the bigger trap underneath it

**A year's reports nest.** Before amendments matter at all: every report in a calendar year
restates everything since 1 January, so a year's reports are overlapping snapshots, not
consecutive periods.

Minnesota Statutes 10A.20 subd. 4 (Period of report): "A report must cover the period from
January 1 of the reporting year to seven days before the filing date, except that the report
due on January 31 must cover the period from January 1 to December 31 of the reporting year."
The Board says it again in plain words in its candidate handbook: "Each reporting period
includes all contributions received during the year, not just the contributions received since
the last report," and "The report must include all transactions from January 1 through the
cutoff date of the reporting period." Confirmed in the data: Representative Greg Davids'
committee (12604) filed three reports for 2024, cut off on 22 July, 21 October and 31 December,
all three beginning 1 January.

So within a completed regular series the year-end report is the final snapshot and the
pre-election reports are earlier partial ones. Adding a year's reports together counts most of
the money three times. Special-election series (§9.5), years still in progress, and years with
no year-end report each need handling of their own.

**Which amended version is effective.** For the filers and years the route covers, it has
already decided, and that is the answer we use. Two cases where the versions disagree, each
checked against the documents:

- Republican Party of Minnesota, 2025: the route reports general expenditures of $647,671.22.
  Amendment #2 states $647,671.22; the original and Amendment #1 state $646,371.22.
- Dibble's committee (15667), 2024: the route reports $4,869.59 of individual contributions.
  Amendments #1 to #3 state $2,600.00 itemized plus $2,269.59 non-itemized; the original states
  $2,194.59 non-itemized. The route matches the amendments.

In both, the route matches the highest-numbered version. Two checked filings are not proof of
its behaviour across all 367 multi-version reports, which is why §9.3 makes both of these
standing test cases.

**We still need the rule ourselves**, for three things the route cannot do: assembling a
special-election year (§9.5), citing the document a figure came from, and satisfying §6's
requirement to record the effective version and keep superseded ones readable. **The rule is
the highest amendment index for the key (filer, filing year, report type, special-election
flag).** The evidence:

- `tabname=reports_data` on the same endpoint returns, per report, an `amendments` array. It is
  highest-first in **366 of 367** multi-version reports in the 1,005-report catalogue.
- **One call returns a filer's whole history, not the year you asked for.** A 2025-scoped request
  for filer 11880 comes back with 28 reports spanning 2009 to 2026, so 130 calls covered 1,707
  reports. Scope the year on the way out, never in the request.
- **A null `amendments` array marks a report as never filed, and that is the cheap way to know a
  report is late.** Every filed report carries at least `['0']`. 3 rows of 1,707 carry null instead:
  the 2 filers whose 2026 pre-primary was 16 days overdue when it was measured, and one 2014
  year-end. So "this report is late" is answerable from the same call that supplies `CutOffDate` and
  `ReportType`, with no document request and none of §9.4's five soft failures to interpret. **2 for 2
  on the current period and untested historically**: the 2014 row returns an empty body, and since
  §9.4 establishes that documents are not served before 2023, that case cannot separate "never filed"
  from "too old to serve". One known-late 2023 or 2024 report would settle it.
- **Its report keys collide across filers, and the collision is silent.** Keying a collection on a
  report's own hash alone collapsed 130 filers to 29 and 1,707 reports to 57, with no error and no
  duplicate warning — a small number that reads as a small population. Key on `(filer, hash)`. This
  cost one measurement a near-miss: a correct finding on a thirtieth of the sample claimed for it.
- The exception is filer 17868's 2015 pre-special-election report, whose array is
  `['1','0','1','0']` — **duplicated entries**. Deduplicate before taking the maximum, and do
  not treat this catalogue as a clean version ledger.
- "Received by the Board" rises with the index in **21 of 21** version sets that could be
  tested. Five more could not be, and nothing before 2023 could be tested at all, because those
  documents are not served (§9.4). No contrary case was found; that is not the same as none
  existing.

**Do not use the "Amendment" checkbox printed on the document.** Davids' 2024 year-end has it
ticked on index 0 and clear on index 1; one of the 21 sets tested (filer 18760's 2024 year-end)
has it clear on all five versions.

**Versions are alternatives and never add up.** All three of the Republican Party's 2025
versions state the same 1 January balance of $2,130.77 and the same $748,643.94 of
contributions; only an expenditure line differs. Checked on those three versions only.

**367 of 1,005 catalogued reports (36.5%) carry at least one amendment**, and one report has
seven versions. This is ordinary, not an edge case.

### 9.7 The filer directory, which also settles §5

The same service publishes the registered-filer lists in bulk. The Board's own page states
"List data is updated nightly"; that schedule was not independently measured.

`POST https://cfb.mn.gov/reports/api/`, same `PHPSESSID` requirement, form-encoded:

```
action=grid_data
data[action]=all-registered-candidates
data[type]=current-lists
data[params][0]=all
```

`data[action]` is one of `all-registered-candidates` (777 rows on 11 Aug 2026),
`all-registered-ptus` (299), `all-registered-pcfs` (526), or the three current-report lists
`candidate-reports`, `ptu-reports` and `pcf-reports`. `action=grid_info` returns the column
names and the viewer URL templates. **Omitting `data[params][0]=all` returns `false`, not an
error** — another silent failure to check for.

**A candidate row carries these 11 columns**, which is worth stating because two of them close
questions elsewhere in this document: `RegisteredEntityFullName`, `RegisteredEntityID`, `Party`,
`OfficeSoughtFullName`, `District`, `RegistrationDate`, `TerminationDate`, `Incumbent`,
`CandidateFullName`, `DistrictKey`, `OfficeKey`. **`RegistrationDate` and `TerminationDate` are here
for every filer in a single call**, which is why sizing the closed-committee state
([#1415](https://github.com/alethical-org/alethical/issues/1415)) turned out to be one request
rather than 200: 1 of the 162 sitting members resolvable by district and surname has a closed
committee, and 0 have closed one and opened another. That leaves 38 unresolved by that match, which
is the match failing rather than members proven to hold no committee.

So termination is **three views of one fact**, not three sources: registration-level here,
repeated onto every report row in §9.1's catalogue, and cited in §5.1. Comparing them corroborates
nothing.

The candidate directory carries an `Incumbent` flag, 209 rows on 11 August 2026, which is how
the sitting legislators measured above were selected. **Do not read that flag as "sitting
legislator" — §5.1 measures both ways it fails**: only 198 of the 209 are legislative seats, and
5 of our 200 sitting members have no flagged live filer in their own seat at all. It also carries
`District` on 728 of 777 rows and `Party` on all 777, which are the fields §5.1 now uses. §5 says a filer's settled classification
"needs the Board's registered-filer directory, which is an open route" — this is that route.

### 9.8 Still open, and not blocking the first release

- Pre-2015 itemized payments, which the bulk downloads do not reach. Note that §9.1's totals do
  reach back to 2009, so a page can state what a committee raised in 2012 without being able to
  name a single donor for that year.
- Whether unions file anywhere reachable. This investigation found no Board route for them.

### 9.9 Checks this design asks for that were not run

Recorded as not run, never as passed:

- **§4.3's reconciliation across a sample of committees** was run for contributions only. The
  expenditure side has been reconciled for the 4 filers of
  [#1386](https://github.com/alethical-org/alethical/issues/1386) and for no others.
- **Party-unit and committee/fund label sets** come from 12 filers of each kind, not from the
  populations of 299 and 526.
- **Amendment ordering before 2023** could not be tested, because the documents that would
  prove it are not served.
- **Rate limits, blocking and error behaviour under load** were not tested deliberately; the
  ~1,200 requests in §9.2 are an observation, not a probe.
- **Whether the route resolves amendments correctly in general** rests on two checked filings
  plus the standing test cases §9.3 requires. It is not established across the 367
  multi-version reports.
- **The adjacency of the two report series** (§9.5) was measured on 5 filers, not on all 10
  negative committee-years, and on no year before 2024.
- **Deriving a special-election filer's period start** from the day after the latest
  special-election `CutOffDate` (§9.5) is confirmed on **one** filer-year, 18453 in 2024. A wrong
  start renders as a plausible date range rather than as an error, so this needs confirming across
  the population before a build relies on it.
- ~~**Whether the PDF route accepts `period=A`, `B` or `G`** (§9.4) is untested, one request.~~ **Run,
  and all three serve real PDFs** (§9.4), so `period` passes the catalogue's `ReportType` through
  rather than choosing among three. What is still untested is whether the served release date behaves
  as "due date plus one" beyond the 6 filers, 1 report type and 1 day it was measured on.
- **Whether a null `amendments` array means "never filed" outside the current period** (§9.6) is
  untested. It is 2 for 2 on reports overdue today, and the one historical case cannot be separated
  from §9.4's pre-2023 document boundary. One known-late 2023 or 2024 report settles it.
- ~~**The computed itemized split against the filing's own stated split** (§7) reconciled on 2
  filer-years at full precision.~~ **Run since** (§9.4): for the 2025 sitting-legislator population
  in full — 208 of 209, one having no 2025 year-end report, of which 199 of 202 ordinary
  legislator-years reconcile and the 3 that do not are all short in our rows — and for a **28-filer
  sample** of party units and of committees and funds, reconciling 27 of 28 and 28 of 28, with all
  56 report documents served. The single party-unit failure is **HRCC (20010), the House Republican
  Campaign Committee**: its filing itemizes $1,493,418.08 against our $1,488,168.08, short by
  exactly $5,250.00, the same silent direction as the 3 legislator cases — and **diagnosed since**
  ([#1386](https://github.com/alethical-org/alethical/issues/1386)): 3 of those 4 are the
  pre-amendment export of §2.1, and the fourth is a coverage gap particular to one committee. The
  expenditure side has since been checked for those same 4 filers, which confirmed the pre-amendment
  cause on money out as well and found a second unexplained gap: HRCC is missing 3 outgoing payments
  worth **$21,940.32**, present in no version of its filing. Both unexplained gaps need the Board
  itself and sit with Eugene. Those two samples establish that the comparison works and the documents
  are there; they do **not** establish a failure rate for either kind, and HRCC is one hit rather than
  a measured rate. The check has not run for any year before 2025, nor for any filer outside those
  samples; the expenditure side has run for those 4 filers only and for no others.
- **The closed-committee count** (§7's fifth state) is 1 sitting member of the **162** resolvable by
  district plus surname, with 0 having closed one committee and opened another, read off one nightly
  directory snapshot. The 38 unresolved are that match failing, never members shown to hold no
  committee, so the count is a floor rather than a population figure
  ([#1415](https://github.com/alethical-org/alethical/issues/1415)).
- **Whether a member ever held a committee that both opened and closed between two of our
  snapshots** cannot be answered at all: §4 replaces whole sets, so nothing records a registration
  that appeared and vanished between them. Not a launch concern, and the place a retention question
  would land if one is ever needed.

Codex reviewed this section adversarially before it was committed and could not reach
cfb.mn.gov from its own environment, so its objections about rate limits, blocking and current
response contents are unverified by it as well as by us.
