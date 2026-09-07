# Site Metrics measurement rebuild

Net: Restore trustworthy public measurements and add account growth plus a private aggregate leadership report.

Approved by Eugene on 7 September 2026. Implementation includes tests, browser checks, review, release, and live checks. The supplied screenshots are examples, not source data.

## Scope and decisions

1. Repair Checkly availability, event-time team exclusion, false search successes, official source coverage, and controlled-test contamination.
2. Show actual Supabase account creation totals and confirmed/unconfirmed counts, with an explicit surviving-account limit. First local provisioning is separately named accounts first used, never sign-ups. Preserve future anonymous first-use and follow-creation counts after removal. Show each true history start; never reconstruct deleted accounts from surviving rows.
3. Align measurement periods and Cloudflare sample meaning. Separate historical performance from post-release quality. Investigate the Vercel traffic surge without assuming that it is bots.
4. Name money and reading traffic, record money search results, and count current bill/committee following plus future follow creation history.
5. Build private aggregate leadership measurements with server-side admin access, using existing approved access rules. Do not add cross-visit individual tracking, private-interest lists, revenue claims, fabricated cost data, or visitor-to-signup conversion.
6. Own definitions, source health, regression prevention, integration, and release. Use existing visual patterns for established figures. Request Design only for an unresolved new presentation or interaction.

## Delivery graph

| Job | Owner and allowed files | Prerequisites | Completion check | Integration order |
| --- | --- | --- | --- | --- |
| Browser collection | counting_audit, isolated collection branch; TrafficAnalytics, siteMetricEvents, bill/legislator/money search screens and focused tests | approved fixed event names | identity transitions, waiting/zero/error/positive searches, filters, official hosts, suppressed QA uploads | first repair release |
| Speed source | performance_audit, isolated performance branch; traffic-performance endpoint and focused tests | official schema and sample population | 30-day bounds, supported navigation population, valid sample threshold and source failures | first repair release |
| Account/follow history | account_history_build, isolated accounts branch; site_metrics router, transactional auth/follow hooks, new aggregate service/models/migration/tests | common exclusion contract | duplicate identities, rollback, concurrent increments, deletion/unfollow retention, UTC hour cutoffs, migration round trip | backend before public consumer |
| Availability and destinations | main, isolated main branch; traffic-uptime, traffic, source tests | current Checkly response and Vercel filter semantics | genuine fixtures, partial failures, monitor identities, freshness, bucket arithmetic | first repair release |
| Public figures and definitions | main; lib/traffic types, TrafficScreen, focused UI checks, operating/privacy guidance | endpoint contracts | phone/desktop, unknown vs zero, history coverage, exact copy and current totals | after each matching endpoint |
| Private leadership report | main; new admin aggregate service/route/screen and tests | reusable admin guard from task new acct visibility; settled data contracts | unauthorized denied, aggregate only, no false history or fake costs | after public/backend repair |
| Independent release review | fresh read-only helper | implemented changes and local checks | production/privacy/migration review; browser use without implementation context | before merge |

One writer per file. Helpers commit in isolated worktrees and do not release. Main integrates and owns current-main verification and publishing. The separate task `new acct visibility` owns `/admin/users`, admin access, shared account classification and navigation; this rebuild does not duplicate its identity list or alerts.

## Counting contract

- Public activity windows end at the last completed UTC hour, matching page views. Current account/follow inventory is as of the response time.
- Future creation counts use anonymous hourly totals, aggregated into public periods. Public responses do not expose hourly small groups or individual interests.
- Newly recorded histories have an explicit start. A prior-period comparison is absent until the entire prior period is covered.
- A fixed action name plus a short-lived per-action retry identifier is allowed. No search words, addresses, account IDs, persistent visitor identifiers or IP history are added to anonymous events.
- Existing event history may contain old counting errors and cannot be selectively corrected. Record definition-change dates rather than silently claiming clean historical comparisons.
- Team/test classification is shared across public counts and private admin views. Admin permission is a separate decision and must not be granted by the analytics exclusion flag.
- Cross-visit returning-reader measurement remains a privacy decision. The report can show current account growth, saved-item counts, anonymous useful actions, source freshness and source health without it.

## Status

- [x] Live/source audit completed, implementation approved.
- [x] Isolated branches created and independent helpers started.
- [ ] Source repairs and creation-history contracts implemented.
- [ ] Common team/test classification reconciled with prior explicit exclusions.
- [ ] Public additions and private aggregate report implemented.
- [ ] Authoritative source definitions, missing states and limitations updated.
- [ ] Focused and full checks, migration review, desktop/phone browser checks.
- [ ] Pull requests, current-main checks, release and live verification.

## Safety gates and unresolved evidence

- Saved Checkly private access cannot be read back from Vercel; the public Checkly status source is healthy. Diagnose the private request through safe logs or use the validated same-provider public source explicitly, not invented availability.
- Exact historical deleted sign-up/follow totals cannot be recovered from current inventory. Current surviving Supabase creation counts can decrease after account deletion; private and public wording must state this. First-use history is a different measurement, not a workaround label for sign-ups.
- Provider bot filtering does not establish that every visit is human. No investor audience or conversion claim follows from anonymous visit estimates alone.
- No new vendor purchase, paid recurring agent job, real-user notification, destructive production rewrite, or undisclosed cross-visit tracking is authorized by this build.
