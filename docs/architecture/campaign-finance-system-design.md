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

**Nothing in the download tells you it arrived complete.** There is no `Content-Length`; the
response is `Transfer-Encoding: chunked`, and a `Range` request is ignored (HTTP 200, not
206), so a download cannot be resumed either. Worse, a download number that no longer
resolves returns **HTTP 200 with a 39 KB HTML error page** typed `application/octet-stream`.
So a wrong or stale link fails silently, and two content checks are what catch it: the first
line must equal the expected column header exactly, and the `Content-Disposition` filename
names the file (`All - Itemized Contributions Received Of Over $200 - Campaign Finance.csv`).

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
A caption covering the whole record says *candidates*, because ballot-question committees
sit at $500. This is written down because the wrong version was drafted for a real screen
(Aug 2026) by someone reading the paragraph above, which stated the aggregate rule correctly
but never gave the period or the wording to use.

So a candidate's true total is: the itemized payments, **plus** a non-itemized figure that
exists only in the report. A page showing only the sum of visible rows understates the truth.

Filed reports live on the Board's report viewer and as PDFs. They are also the only source for
amendment ordering. **Never rebuild payment rows out of a PDF for any period the bulk files
already cover** — that is what the retired system did, and it is where its errors came from.

### 2.4 Federal

Federal Election Commission API, deferred (see the roadmap). Federal data does carry its own
transaction identifier on about 79% of rows, so when it is built it keys on that identifier
directly and rejects rows without one.

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
2. **Store the file whole** as a dated snapshot with a content hash. An identical hash to the
   previous snapshot means nothing changed; stop.

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
  non-itemized figure equals the total on the filing.
- Every registration number resolves to a known filer, or is reported as new.

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
*parsed rows* are pruned, and only for snapshots no published release references — the checks
in §4.3 compare against recorded measurements, not against old rows, so nothing needs the rows
of a superseded set. Pruning successful bodies to save space would give up exactly the record
this section exists to hold.

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
files at all; that needs the Board's registered-filer directory, which is an open route
([#1337](https://github.com/alethical-org/alethical/issues/1337)).

**People, employers and vendors have no identifier, and are never joined or split
automatically.** The retired system compared donor names exactly, so "Messinger, Alida" and
"Messinger, Alida R" were two different people. Loosening that into automatic matching trades
one wrong answer for another. Likely matches are surfaced for a person to confirm, and the
confirmed link is stored against the durable identifiers, not against a snapshot row.

A candidate joins an Alethical legislator only through a link a person has checked.

---

## 6. Amendments

A filing can be superseded. The Republican Party of Minnesota's 2025 report exists as an
original plus three amendments, each restating the same money.

- Every report row records its period and its version.
- Exactly one version per filer per period is the effective one. **A database index cannot
  enforce this on its own**: a partial unique index gives "at most one effective version", and
  nothing stops every version being marked ineffective, so the "exactly one" half has to be a
  check the importer runs and a test asserts. Deciding *which* version is effective is still an
  open route ([#1337](https://github.com/alethical-org/alethical/issues/1337)), so today this
  is a rule with nothing to apply it to.
- **Totals read only the effective version.** A query that filters by year alone will count a
  preliminary filing and its final replacement together, which is the specific mistake to
  design against.
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

**And when the reported total cannot be obtained, show no total.** §9 records that the bulk
route to filed reports is not yet established, so at first release the only figure we hold is
the sum of the payments we can name. Print that sum, labelled as named payments, with no
composition bar, because there is no whole to divide. Do not print a partial figure under a
caveat: a caveat under a large number loses to the large number, and the reader remembers the
figure. This is the state that ships until [#1337](https://github.com/alethical-org/alethical/issues/1337)
closes, so it is the primary case a design draws, not an edge one.

**A missing surface makes a claim too, so the tab always renders.** A legislator's campaign
money is a tab on the profile they already have, and it appears for every member whether or
not their committee link is confirmed yet ([#1354](https://github.com/alethical-org/alethical/issues/1354)).
Hiding it until the link is checked was proposed and **rejected**, and the reason is recorded
here so it is not reintroduced: two profiles side by side, one with a money tab and one
without, tell a reader the second member has no campaign money, when the truth is an
unfinished clerical task of ours. That is `.claude/rules/grounded-answers.md` rule 12's
missing-versus-zero failure moved out of a number and into the navigation, where no per-profile
wording can reach it. The count is also temporary and shrinking, so gating would build a
permanent mechanism to hide a problem that goes away: measured on 11 Aug 2026, a conservative
automatic match ties 111 of 200 sitting members, and most of the rest are nickname and
married-name cases a person resolves ([#1329](https://github.com/alethical-org/alethical/issues/1329)).
What the unconfirmed state must do instead is explain itself, and never render "no committee is
registered for this person" the same as "we have not confirmed which of their committees is
theirs to show".

**One legislator, several committees.** Minnesota registers a committee per office, so a person
accumulates them: 17 sitting members tie to more than one, and 8 have 2 or more active in
2025 or 2026 at once (measured 11 Aug 2026). So a confirmed link is one-to-many and carries
each committee's office and period, a figure says which committee it belongs to rather than
only which year, and **money from a race for another office never appears under a legislator's
profile** — outside spending on a city campaign is a real record, but placing it under a state
senator's name asserts something about their legislative work that no filing supports.

**Dates, three separate rules:**

- Each payment shows its own payment date and its source.
- Each total states the period it covers and its source.
- Each page shows one clearly labelled freshness date, consistent with
  [#861](https://github.com/alethical-org/alethical/issues/861).

**Missing versus zero.** A missing value reads "Not reported". A verified zero reads "0". A
candidate who genuinely raised nothing is not the same as one whose filing we do not have.

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

## 9. Open questions

**Owned, and blocking** ([#1337](https://github.com/alethical-org/alethical/issues/1337)).
Both are answered by one investigation, and §7's "two numbers" rule cannot be satisfied until
they are:

- Where filed reports and their non-itemized figures are fetched from, in bulk. The report
  viewer and PDFs are known; a machine-readable path is not. Without it a page can show the
  payments it can name but not the official total they sit inside.
- How to determine which amendment supersedes which, beyond reading the filing. Without it
  §6's "exactly one effective version" is a rule with no way to apply it.

**Unowned, and not blocking the first release:**

- Pre-2015 coverage, which the bulk downloads do not reach. The first release is 2015 onward,
  so this waits until a separate source is proven.
- Whether unions file anywhere reachable. They are not with the Board.
