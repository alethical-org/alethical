# Independent campaign payment files

<!-- describes: alethical/pipeline/campaign_finance.py, alethical/pipeline/campaign_finance_reader.py, alethical/pipeline/campaign_finance_refresh.py, alethical/pipeline/campaign_finance_recheck_batches.py, alethical/pipeline/campaign_finance_check_identity.py, alethical/api/services/committee_stated_verdicts.py, scripts/refresh_campaign_finance.py -->

Owner: payment-file builder, with integration, deployment and live acceptance owned by
[issue 2504](https://github.com/alethical-org/alethical/issues/2504).
The working folder and branch remain available for follow-up.

## Approved outcome and boundaries

Each complete contributions, expenditures or independent-expenditures file may replace
its own accepted slot after its checks pass. A held sibling keeps its rows, receipt,
copy time and totals pairing. Existing exact exceptions stay exact. No row merging,
deduplication, new exception, federal expansion, added source, automatic review approval,
real-user send or unauthorized spending is part of this work.

The parent owns production work. This branch prepares code, migration, tests and a
reviewable pull request. Deployment waits for the parent's current old-code full money
check to finish and for integrated scheduler acceptance.

## Impact and prevention

Cause: the earlier all-file release rule let 1 refused historical spending file block
all other checked files. A single release date and totals pairing made independent
replacement unsafe: old spending would inherit a new date and a comparison could join
incompatible copies.

Correction: an immutable 3-slot manifest names each accepted snapshot, record hash,
actual complete-read receipt, its exact run and byte hash, copy time, fetch start, totals pairing and publication
checks. The reader validates identities, hashes, dates, complete parsing and actual
receipt/run/byte-hash relations. A malformed nonempty manifest is refused; `{}` alone is the legacy
rolling-deployment shape. Reordered bytes may renew a slot's date only after the same
parsed records pass a new complete source read. Replaying a held replacement never
renews the carried slot.

Forward validation also reads inherited exceptions from the accepted release's
manifest, never the mutable validation field on a reused snapshot. The first forward
publication freezes a legacy current release's real receipt/check evidence before
changing any reused snapshot's validation. Exact rollback therefore restores the
original proof and the next writer inherits only that restored proof.

Prevention: pointer changes and per-file follow-up obligations share a transaction.
Date-only reconfirmation clears pages without adding a PDF check and preserves checks
already owed. Each unfinished source stays held. Each unfinished checked file keeps
its own pending entry; 1 successful sibling cannot erase it. Saved-page clearing and
source publication are separate completion steps.

## Consumer inventory

| Consumer | Inputs and allowed combination | Dates and protection |
| --- | --- | --- |
| Committee and legislator finance | Separate contribution, general-spending and independent-spending buckets; never net or sum the 3 files | Per-file map; pinned and unpinned resolvers share manifest proof |
| `campaign_finance_reader.money_rows` | One SQL union returns separate labelled aggregates for contributions and general spending | Input snapshot IDs resolved once; no cross-file arithmetic |
| Non-itemized split | Contributions subtracted from the committee's official total for its exact period | Contributions slot must pair with live totals; existing per-filer withholdings remain |
| Donor states and contribution-kind split | Contributions and official report lines, only after an agreeing exact-period verdict | File/totals pairing, cutoff and active-reader proof required |
| General spending comparison | Expenditures and the exact official report period | Held file paired to older totals stays untested against newer totals; no borrowed proof |
| Money lists, donor/vendor name groups and text snapshots | 1 payment file per list/group | That file's copy time; failed refresh retains old rows with old dates |
| Money landing and leadership freshness | Independent counts and source dates; no combined payment total | Exact 3 timestamps only for a shared API aggregate; UI may group equal displayed Minnesota dates |
| Race money | Contributions only, alongside separately sourced official filer facts | Contributions copy time |
| Outside spending, named outside spenders and legislator independent spending | Independent-expenditures file only | Independent file copy time; confirmed committee-link privacy unchanged |
| Lobbying donations and donor evidence | Contributions plus the exact approved evidence/totals versions | Contributions copy time; existing source-bound publication and withholding unchanged |
| Committee name/kind and year availability | Existence/identity lookups across files, with existing source precedence | No arithmetic across files; precedence is not a freshness assertion |
| Large-contribution notices and disclosure-statement links | Exact donor/date/amount matches to contributions; no merged amount | Notice/listing dates stay separate; statements use their exact displayed listing records, never an unrelated scan |
| TV-ad links and review | Exact expenditure snapshot and row number | Accepted receipt date for that expenditure snapshot; never snapshot creation time |
| Refund account matches | Exact published register snapshot and its matching filer rows in 1 statement | Pruning cannot empty a separately resolved register; stored match generation and existing review rules stay distinct |
| Register counts and homepage facts | Register facts and independent row counts remain separate | Register's own source dates and per-file payment map; no newest-date borrowing |
| Sitemap | Addresses only for money routes, with no campaign-file last-modified assertion | No copy date to change |
| Signed research and exports | No dynamic campaign payment-version consumer found in the current source inventory | Static signed research is not silently refreshed; new such consumers must bind exact inputs |

Repository search covers direct row-table readers, release models, raw release queries
and stored-verdict readers. Similar wording alone does not establish shared input.
The shared SQL union is allowed because it labels independent results; it does not
create a figure from incompatible files. Any new cross-file calculation must prove
exact versions and compatible reporting periods or withhold its result.

## Bounded check turns

`refresh_campaign_finance.py --collect-only` publishes whole validated sources and
clears public pages promptly, leaving PDF comparisons pending. It does not retry hours
of older comparisons before collecting current records.

`--recheck-limit 10 --recheck-seconds 120 --recheck-requests 10` takes the same money
writer lease for 1 turn, checks at most 10 exact committee-years for 1 owed file, and
releases it. The turn caps source requests including retries and interrupts slow
network or parsing work at its elapsed-time budget. Its lease expiry is the time budget
plus 120 seconds, so a crashed short turn does not retain a 6-hour collection hold.

Progress binds the exact file, paired/live totals, all supported years, deterministic
ordered target population and reader code/dependency fingerprint. A changed input or
reader resets progress. Each idempotent verdict commits before its cursor advances;
a crash may repeat its last item but cannot skip it. Whole-file completion requires
every target. A valid comparison whose newly read PDF could not be kept remains
visible, but its item/cursor and file obligation stay unfinished and the command
reports failure for retry. The full wrapper likewise reports retention failure.
Full and bounded runners both refuse an unestablished empty target population. A missing document is an explicit `not_checked` verdict, not a passed
source check. An unpaired held file performs no pointless PDF work and remains pending.

Each new verdict stores its reader fingerprint. Once a new checker activates its
fingerprint, APIs and coverage counts reject older-reader and legacy-null verdicts,
including during a partial rerun. Old responses remain readable before that activation
during rolling deployment. The activation and every verdict commit also record saved-page
clearing, so a crash cannot strand old cached proof without an obligation.

Exit 75 means a successful bounded turn has more exact-input work. Exit 1 means a
failure or an unpaired held file; its reason remains visible. Exit 0 means no checks are
owed or the whole remaining file work completed. Scheduler collection priority wins
between check turns; a successful continuation must not inherit a 30-minute dispatch
cooldown. An ambiguous queued dispatch keeps its duplicate protection.

Residual latency: the totals collector still fetches 1 whole validated snapshot, up to
the existing source budget. Splitting that fetch needs separate resumable-source proof;
it does not justify overlapping publications or weakening completeness. Notice and
other source lanes may run independently under shared host pacing.

## Retention and rollback

Payment pruning keeps every snapshot named by the live and retained rollback release.
Totals pruning also keeps any totals snapshot named by those manifests. Exact rollback
restores all 3 slots, receipts, dates, pairings and accepted checks; it verifies retained
rows before moving the pointer and records follow-up work without inventing a source
read. Legacy carry requires a real accepted receipt from its original run/window.

## Acceptance checkpoint

Local full backend verification passed 5,263 tests across 186 files in 3 independent
local Postgres runs. Subsequent focused checks cover the final reader-proof guard and
command edges. The frontend passed 4,912 tests and TypeScript. Independent source review
accepted the receipt, inherited-check, lease and evidence-retention corrections, with
39 focused tests passing. The migration upgrade/downgrade/upgrade and exact rollback
cases run on isolated local databases.

Parent owns combined scheduler CI, deployment, remaining interactive/live review and
final fresh-context app acceptance. The bounded default HTTP path requires the shared
request limiter and migrations 0073/0074 from the scheduler change before activation.
The parent's old-code production check must finish before migration or activation.
No production source file or configuration was changed here. Delivery preparation is
complete; working folder and branch are retained for follow-up.
