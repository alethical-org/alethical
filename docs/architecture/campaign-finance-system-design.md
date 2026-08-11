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

The page offers 23 files: 3 datasets across 8 filer categories. **The 3 "All" files contain
every row of the other 20**, verified by matching every row, so fetch 3 files, not 23.

| dataset | rows on 11 Aug 2026 | covers |
|---|---|---|
| Itemized contributions received over $200 | 583,152 | 2015 to present |
| Itemized general expenditures and contributions made over $200 | (fetch to measure) | 2015 to present |
| Itemized independent expenditures over $200 | (fetch to measure) | 2015 to present |

Columns on the contributions file: recipient registration number, recipient, recipient type,
recipient subtype, amount, receipt date, year, contributor, contributor registration number,
contributor type, receipt type, in-kind flag, in-kind description, contributor zip,
contributor employer.

Three things that file **does not** have, each of which changes the design:

- **No record identifier.** The state publishes no per-transaction id, which is why §4 keys
  on the snapshot rather than on the row.
- **No city or state**, only a zip, and 9,007 zips have lost a leading zero.
- **No small-donor detail.** See §2.3.

### 2.2 Lobbying

Landing page: `https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/`

Principal expenditures, 2015 to present, plus lobbyist and lobbying-entity registration.
Minnesota publishes the lobbyist-to-client relationships here that the retired system was
almost entirely missing (it held 63 relationships for 1,709 lobbyists).

### 2.3 Filed reports, and the $200 rule

**The threshold is on a donor's cumulative giving, not on each payment.** 327,759 of the
583,152 contribution rows are individually under $200, the smallest being one cent: those are
later payments from donors who had already crossed the threshold. What the bulk files
genuinely cannot contain is money from donors who **never** crossed it. That appears only as
a single summary line on the filed report.

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
2. **Store the file whole** as a dated snapshot with a content hash, through the existing
   `SourceArtifact` retention path. An identical hash to the previous snapshot means nothing
   changed; stop.
3. **Validate** (§4.3). A snapshot that fails is kept for diagnosis and never published.
4. **Publish** by replacing the previous published set entirely.

**Related files release together.** Contributions, general expenditures, independent
expenditures and the reports that cover the same period form one release. Files fetched on
different days must never be shown together, or a committee's spending will be from a
different day than its income.

### 4.2 Why replace rather than merge

The state publishes no transaction identifier, and two payments can legitimately be identical
— same donor, same day, same amount. The Republican Party of Minnesota's 2025 filing contains
exactly that, twice. So no key built from a row's contents can tell a genuine repeat payment
apart from a re-import of the same row. Merging therefore cannot be made correct; it can only
be made careful, which is what failed before.

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

---

## 5. Identity

**Registered filers join by registration number, never by name.** Candidates, committees,
funds and party units all carry one. Minnesota routes them by numeric range: 10000–19999 is a
candidate committee, 20000–29999 a party unit, 30000 and above a political committee or fund.

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
- Exactly one version per filer per period is the effective one.
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
