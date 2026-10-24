# Public-record updates: coverage and recovery

This is the operating review of the existing update work, not a claim that the
unfinished scheduler is live. [What runs, when, and what it costs](jobs-and-scripts.md)
owns the shipped job inventory. [Issue 2504](https://github.com/alethical-org/alethical/issues/2504)
and [draft pull request 2511](https://github.com/alethical-org/alethical/pull/2511)
own completion of the approved shared update system.

## Release and source evidence

On October 24, 2026, main was `902cd84b`. The shared update pull request remained
a draft at `bd466cdc`, last updated October 7. Its saved implementation plan reports
final recovery corrections awaiting combined checks and release. The old build
folder is missing; the committed branch remains available. An archived ingestion
chat is not a running owner. Restore committed work in an owned folder and inspect
current-main changes before resuming implementation; do not start a second scheduler.

The saved GitHub App setup still records a human identity step. That is historical
setup evidence, not a fresh claim that access is unavailable. The build must inspect
current installation and runtime settings before requesting human action.

The October 24 campaign collection
([run 40119861839](https://github.com/alethical-org/alethical/actions/runs/40119861839))
published neither totals nor payments. Before the scoped recovery below, a separate
read-only production query confirmed:

- Official totals and register: snapshot `115fa74f-de67-4317-b734-f7e1ae4397c6`,
  copied October 7; 1,613 registered filers. An unpublished directory refresh does not
  update the homepage count independently of this accepted snapshot.
- Listed payments: release `f09e9ba5-2692-404d-a0b2-9c7de70c2310`, copied October 9.
  The public committee-finance route returned this same release and copy time.
- The October 24 totals candidate had 5,329 filer-years against the earlier published
  snapshot's recorded 5,611. The archive's compressed hash, every response hash and
  parsed record hash reproduce. All 272 newly missing figure-bearing committee-years
  are 2026 records; every corresponding source response says
  "Data not available for 2026". This is observed source unavailability, not a
  demonstrated parser error. Why the Board's route now answers unavailable is not established.
- The new payment file also lost 2017 expenditure rows for registration 18127:
  577 vanished and 17 were added; 571 vanished rows, worth $770,306.14, had no
  matched replacement. This requires its own evidence, not a totals exception.

[Incident 2667](https://github.com/alethical-org/alethical/issues/2667) owns the
current state-money failure. Retaining the last accepted records prevents deletion;
it does not make those records current. Never mark the incident resolved merely
because the timer ran or one stage succeeded.

### Scoped totals recovery

The [recorded release decision](https://github.com/alethical-org/alethical/issues/2667#issuecomment-6389566384)
published totals snapshot `397b0667-5235-4624-80ba-afd4f550bf70`, copied October 24 at
19:07:49 UTC. The release contains 5,329 current filer-years plus 272 newly unavailable
and 46 former-filer records retained with their own original dates. All 5,647 loaded
committee-years were compared against the source and retention plan after publication;
amounts and provenance matched, and the prior baseline remained available for rollback.
The exception names the exact source hash and failed checks. It does not waive future
unexplained losses. Complete private backups and an isolated publication, pruning and
rollback rehearsal preceded the change.

The public response for registration 19081, year 2025, now returns reported spending
of $887.55 and an October 24 totals copy date. The payments release remains October 9.
The retained committee route keeps its October 7 date. Live review found that the
legislator route still applies the overall October 24 date to those older totals;
the scoped correction carries each committee-year date and shares a date only
when all displayed committees agree. Mixed or unknown dates stay beside their
own committee. Its deployment and live read-back remain part of recovery. The release's existing comparison
guard withholds derived splits while payment and totals generations differ; running
checks alone does not change their pairing or restore those splits.

The all-year checks for 2022–2026 are running. Saved-page clearing remains pending:
the local repair credential cannot purge Cloudflare, while the existing Actions job
has separately configured credentials previously proven on the live site. This is a
local recovery-route gap, not proof that scheduled clearing is unconfigured. Recovery
must use that existing route, prove the accepted clearing, and verify public responses
before marking the follow-up complete. No credential permissions are widened.

The newer totals resolve 3 of the 6 newly failing contribution comparisons. The other
3 (40745/2026, 41391/2026 and 80020/2026) still contradict the official totals and
report documents for the same periods. The 18127/2017 spending loss remains unexplained:
its catalogue lists original and amended reports, but the document route returned an
HTML error rather than either PDF. No payment exception or row deduplication was applied.
The shipped collector still releases all 3 payment files together. The approved
replacement lets each complete checked file update independently, with its own dates,
totals pairing and recovery obligations; incompatible combined calculations remain
withheld. [The owning release contract](../architecture/campaign-finance-system-design.md#41-the-cycle)
sets the required checks. Independent publication is not enabled by this review, and
no payment exception follows from the policy change.

The cited-source archive's October 19 red result
([run 39287503123](https://github.com/alethical-org/alethical/actions/runs/39287503123))
includes changed source bytes saved beside the earlier copies. A red result alone
does not establish a broken collector. Distinguish source changes requiring editorial
review, source access failures, and failed storage or processing before choosing a repair.

## Coverage by record type

The following describes current main and the existing approved completion work.
It does not authorize additional datasets or a new public timing promise.

| Record / reader feature | Shipped update path | Work required for the existing finish |
| --- | --- | --- |
| State campaign payments, totals and directory | Daily payments; totals after changed lists or weekly | Resolve exact failed source checks; finish saved publication follow-up and recovery; verify the public money pages and homepage count |
| Large-contribution notices | Daily October 20–November 6; weekly otherwise | Preserve election-window handling, detect new records and corrections, keep incomplete readings distinct from approved readings |
| Disclosure statements, filing dates and refunds | Wednesday statement catalogues; other work remains separate | Complete the draft's source-specific due times and amendment rereads; retain each record's own dates |
| Bills, actions, text and status | Hand-started collection; daily gap alarms | Activate approved phase-based collection; update search with accepted text and retire stale summaries |
| Roll-call votes | Daily missing-vote backfill | Recheck existing votes for corrections; discover new vote work from accepted bill actions |
| Legislator contacts, service and committees | Hand-started full refresh | Complete roster refresh with complete-response checks before removing members or memberships |
| Lobbyists, clients and spending | Hand-started paired publication | Complete daily paired collection, privacy checks, rollback and retryable page clearing |
| Candidates and election changes | Live official lookup on search, plus saved profile records | Detect official source changes without retaining visitor addresses; preserve reviewed identities and election boundaries |
| Address suggestions | Public address copy checked every 5 minutes and replaced after 12 hours | Keep separate from candidate, district and ballot freshness |
| District maps, ZIP references and session rollover | Reviewed source replacements | Detect new releases and hold promotion until mappings and coverage are verified |
| FCC advertising files | Daily collection for KSTP, KARE and KMSP | Join shared due-time and overdue reporting without creating a second collector; preserve review and publication boundaries |
| Article sources, guides and research | Weekly source-copy/change check plus link checks | Recover missed copies; distinguish changed source evidence from collector failure; editorial changes remain deliberate |
| Search, Ask, summaries and saved public pages | Gap alarms and publication-specific clearing | Make follow-up obligations durable; source-scoped dates; never let fresh unrelated records make old answers appear current |
| Private site measurements | Separate access checks and collection activation work | Keep operational measurements separate from public-record freshness and their existing access limits |

The approved bill intervals remain 4 hours during regular sessions, 2 hours during
special sessions, 4 hours for 14 days after adjournment, and weekly in the interim.
The owning [bill cadence decision](../architecture/bill-refresh-cadence-decisions.md)
defines the source load and freshness targets. Existing daily and weekly source
intervals are a baseline to deliver and measure, not evidence of instant updates.

## Why a clock alone is insufficient

On October 24, the campaign job configured for 15:30 UTC was created at 18:15 UTC.
The missing-vote job configured for 09:00 was created at 13:03; the FCC job configured
for 06:23 was created at 11:16; notices configured for 17:15 were created at 19:27.
These are workflow creation times, not proven worker start or publication times.

The existing draft uses an independent wake-up on the API and GitHub as a backup
clock. Dispatching to GitHub still depends on runner availability. A queued request
must never advance a successful-check date or count as a completed update.

Recovery must distinguish the official publication time when supplied, the first
successful observation, copying, validation, publication and public read-back. When
the source provides no publication timestamp, time since first observation is not
the full publication delay. Keep that unknown visible in measurements.

## Scope that remains separate

Federal Election Commission filings are not imported by current main or the draft
shared scheduler. The [approved money scope](../product-onboarding/product-scope.md)
limits money record pages to Minnesota Campaign Finance Board filings. Signed
research may cite other bodies under its existing source rules.

The October 24 screenshot concerns federal campaigns. The FEC's
[2026 pre-general calendar](https://www.fec.gov/help-candidates-and-committees/dates-and-deadlines/2026-reporting-dates/pre-and-post-general-reports-2026/)
confirms October 1–14 coverage and an October 22 filing deadline. This review does
not establish the post's individual campaign amounts or spending comparisons.

Adding Minnesota federal campaigns to record pages requires a separate scope
decision. It cannot be delivered by increasing the state collector's frequency.
Federal filing IDs, amendments and election-cycle totals must not be merged into
state registration numbers or calendar-year totals. The user chose to fix existing coverage first. Federal record pages remain a
separate proposal, not an approved addition.

The shared-refresh work also does not authorize more FCC stations, automatic
publication of extracted amounts, new hearing/statute products, 2015–2021 campaign
totals, automatic identity or donor-proof approvals, recurring paid summaries,
or real user notifications. Existing later feature approvals govern their own work.

## Completion order and acceptance

The user wants existing record types updated as quickly as safely possible after
the official source publishes them. This extends the freshness objective; it does
not establish that every source supports the same interval or authorize paid work.
The approved phase intervals above remain the fallback until a cheaper discovery
path is measured and its replacement recorded in the owning cadence decision.

1. Recover accepted state money first. Explain each failed check against retained
   official bytes. A totals repair may proceed independently of held payments only
   with unchanged payment identity, complete backups, guarded rollback, preserved
   per-record dates, and durable page-clearing and recheck obligations. Never waive
   unexplained row loss. Rechecks must cover every changed year, including 2023.
2. Complete the existing shared update work against current main. Reconcile its
   old migration numbering, preserve newer shipped FCC and source-date behavior,
   confirm current GitHub App installation, and exercise lost leases, duplicate
   delivery, partial failure, recovery and backup-clock paths before activation.
3. For each source, prefer an official change feed, release list, file metadata or
   bounded change check over repeatedly copying its entire history. Collect changed
   records promptly, and keep a periodic full comparison because change lists can
   miss corrections. Respect source limits, retry instructions and measured runtime.
4. Keep urgent records from waiting behind long work. Election-window notices, new
   votes and report releases need bounded independent work; sharing a clock must
   not let a full campaign scan block a short notice check. Preserve existing
   publication locks and safe complete-set replacement.
5. Make acceptance reach the reader. Copying records, validating them, publishing,
   rebuilding affected search data and clearing saved pages are separate steps.
   Persist unfinished obligations with publication, retry safely, then read the
   public result. Unrelated new data never refreshes an older record's date.
6. Measure delay separately for each source and feature. Use official publication
   timestamps when present and explicitly distinguish first observation otherwise.
   Include runner delay, database publication and public read-back. The current
   totals publisher calls `flush()` for each filing before adding its figures;
   the October 24 recovery observed those repeated database writes in flight.
   Measure and batch these writes where equivalent checks and atomic replacement
   can be preserved. A fast clock alone is not success.
7. Use official filing and release calendars to trigger bounded discovery near
   expected publication. Distinguish a missing source publication from a failed
   collection and from a filer who has not filed; never infer a late filing from
   our missing copy. Minnesota reports under section 10A.20 remain nonpublic until
   8 a.m. the day after their due date. For the October 26 pre-general deadline,
   begin discovery October 27 at 8 a.m. Central, then retry within source limits.
   Sources: [Board calendar](https://cfb.mn.gov/pdf/calendars/2026_senate_house_district_court.pdf)
   and [section 10A.20, subdivision 1b](https://www.revisor.mn.gov/statutes/cite/10A.20#stat.10A.20.1b).
8. Keep failures actionable in existing operational channels. Missing records, a
   held release and a missed clock need distinct states, an active response owner
   and a same-day response target during election windows. A saved owner name does
   not mean a session is running. No recurring paid AI or new user emails are
   authorized by this plan.
9. Keep research wording deliberate. Detect newer official records relevant to an
   article's sources and reporting period, then flag the article for review. A
   new copy time alone is not evidence that its claims changed. An amendment to an
   already covered period is a correction candidate, not a newer-period notice. New public notices
   need accurate source and period scope; never silently rewrite an article.

No calendar-wide release freeze is required. Each independent correction ships when
its own source, recovery and reader checks pass. Full activation remains unfinished
until enabled settings, real completed runs and public results are evidenced.
