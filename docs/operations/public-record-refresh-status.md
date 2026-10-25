# Public-record updates: coverage and recovery

This is the operating review of public-record updates. [What runs, when, and what it
costs](jobs-and-scripts.md) owns the job inventory and [the build plan](../implementation/sitewide-record-refresh.md#source-cadence-lanes-and-clearing)
owns each job's cadence. [Issue 2504](https://github.com/alethical-org/alethical/issues/2504)
tracks the shared update system and [incident 2667](https://github.com/alethical-org/alethical/issues/2667)
the state-money recovery.

## Current state

The shared updater is deployed: [pull request 2511](https://github.com/alethical-org/alethical/pull/2511)
(schema `0074_source_refresh`), website page clearing
([pull request 2716](https://github.com/alethical-org/alethical/pull/2716)) and the source
reader corrections that followed ([2719](https://github.com/alethical-org/alethical/pull/2719),
[2720](https://github.com/alethical-org/alethical/pull/2720),
[2721](https://github.com/alethical-org/alethical/pull/2721),
[2722](https://github.com/alethical-org/alethical/pull/2722),
[2724](https://github.com/alethical-org/alethical/pull/2724)). The shared updater was activated on October 25, 2026. GitHub
`SOURCE_REFRESH_FAMILIES` and Railway `ALETHICAL_SOURCE_REFRESH_FAMILIES` both hold
`["campaign","notices","legislative","lobbying","supporting","fcc"]`.
`SOURCE_REFRESH_BILL_EMBEDDINGS_APPROVED=true` retains the existing changed-text
search approval; recurring summaries and user emails remain disabled in the worker.
Railway `ALETHICAL_SOURCE_REFRESH_DISPATCH_ENABLED=true` enables the existing API's
60-second wake, with the hourly GitHub clock as backup. The matching legacy
scheduled collectors are disabled by the same family list; manual repairs remain
available. [The activation and rollback procedure](source-refresh-dispatch.md#staged-family-activation)
keeps these settings paired.

Bill discovery completed in
[run 40195099730](https://github.com/alethical-org/alethical/actions/runs/40195099730),
with a saved source attempt from 12:54:02 to 12:54:05 UTC. This quiet recent-action
check does not claim a full historical inventory refresh or an embedding call.
Railway deployment `165ccb8a-a3a6-40a7-88bf-8e6a9df4564a` succeeded; the first
independent automatic dispatch was recorded at 13:00:07 UTC. A dispatch is not a
completed collection. Notices, campaign-list discovery, roster-source discovery,
lobbying-source discovery and map-source discovery have completed automatic checks.
The first automatic FCC turn is still running; activation acceptance remains open
on [issue 2504](https://github.com/alethical-org/alethical/issues/2504) until its
source outcome and remaining clearing obligations are evidenced.

Verification turns on October 24–25, 2026:

- Published: lobbying release `f96cc067-bdb2-4126-9145-36cec6e3d742` (1,670 lobbyists);
  roster, contacts, service and committees for all 200 members; payment release
  `5643b07b-2ce6-4f17-a746-4ec34eb51927`, in which contributions (copied October 24,
  Minnesota time) and outside spending (copied October 24) each replaced their own
  slot while general spending kept its October 9 copy.
- Checked with nothing new: campaign lists, notices, filing dates, candidates, sessions,
  ZIP references, refunds.
- Checked and marked for review: maps and donor evidence (expected review results);
  FCC (9 files the FCC lists but does not serve); votes (20 roll calls whose journal
  names miss their own tallies, [issue 2723](https://github.com/alethical-org/alethical/issues/2723)).
- Held: general spending, because the 2017 file for registration 18127 lost 571
  unmatched rows worth $770,306.14; no waiver exists and its source cause is unknown.

Each change cleared Cloudflare's saved API answers and the website's saved pages.

### State money recovery

The [totals decision](https://github.com/alethical-org/alethical/issues/2667#issuecomment-6389566384)
published totals snapshot `397b0667-5235-4624-80ba-afd4f550bf70` (copied October 24,
5,329 current filer-years plus 272 newly unavailable and 46 former-filer records with
their own earlier dates). All-year checks for 2022–2026 ran on the pinned PDF reader:
money in 5,300 agree, 63 disagree, 810 not checked, 296 reader unproven; money out 4,648
agree, 211 disagree, 1,304 not checked, 800 reader unproven. Saved pages were cleared
([run 40141114543](https://github.com/alethical-org/alethical/actions/runs/40141114543))
and the recovery obligation is recorded complete.

The [contribution decision](https://github.com/alethical-org/alethical/issues/2667#issuecomment-6391976015)
published the newer contributions file with exactly 3 named exceptions (40745/2026,
41391/2026, 80020/2026); each difference equals 1 listed row to the cent and the reason
is unknown. Those 3 committees show both figures and withhold their derived splits.
After that publication, money in compared 5,282 agree, 81 disagree. General spending
comparisons stay withheld until its file is accepted again.

## Coverage by record type

All 6 families are enabled. The middle column records the prior schedule, which
resumes if its family is disabled. This review does not authorize
additional datasets or a new public timing promise.

| Record / reader feature | Older schedule (until its family is on) | Shared updater path, verified in production |
| --- | --- | --- |
| State campaign payments, totals and directory | Daily payments; totals after changed lists or weekly | Lists every 15 minutes; collection on a change or daily; each payment file updates on its own; bounded checks only while a checkable file is owed |
| Large-contribution notices | Daily October 20–November 6; weekly otherwise | Every 15 minutes in election months, else hourly; weekly correction rereads |
| Disclosure statements, filing dates and refunds | Wednesday statement catalogues; other work separate | Weekly statement rereads; recent filing dates hourly and all dates daily in bounded turns; refunds monthly |
| Bills, actions, text and status | Hand-started collection; daily gap alarms | Dated actions every 5 minutes while sitting, 15 in the interim; full inventory at the approved phase interval; changed text updates search |
| Roll-call votes | Daily missing-vote backfill | Hourly missing votes and correction rereads; journal mismatches go to review |
| Legislator contacts, service and committees | Hand-started full refresh | Roster PDF checked every 15 minutes; full refresh every 4 hours with complete-response checks |
| Lobbyists, clients and spending | Hand-started paired publication | Download links every 15 minutes; full paired file publication hourly |
| Candidates and election changes | Live official lookup plus saved profile records | Hourly source-contract check for review; no visitor address kept |
| Address suggestions | Copy checked every 5 minutes, replaced after 12 hours | Unchanged; separate from candidate, district and ballot freshness |
| District maps, ZIP references and session rollover | Reviewed source replacements | Map releases checked hourly, ZIP and sessions daily; replacements stay reviewed |
| FCC advertising files | Daily collection for KSTP, KARE and KMSP | Hourly turns of the same 3-station collector; unserved files go to review |
| Article sources, guides and research | Weekly source-copy/change check plus link checks | Unchanged |
| Search, Ask, summaries and saved public pages | Publication-specific clearing | Every accepted change clears Cloudflare and the website's saved pages; a failed clear stays owed and is retried |
| Private site measurements | Separate access checks | Unchanged; kept apart from public-record freshness |

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

The deployed updater uses an independent wake-up on the API and GitHub as a backup
clock. Dispatching to GitHub still depends on runner availability. A queued request
must never advance a successful-check date or count as a completed update.

Recovery must distinguish the official publication time when supplied, the first
successful observation, copying, validation, publication and public read-back. When
the source provides no publication timestamp, time since first observation is not
the full publication delay. Keep that unknown visible in measurements.

## Scope that remains separate

Federal Election Commission filings are not imported by the deployed shared
scheduler. The [approved money scope](../product-onboarding/product-scope.md)
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
