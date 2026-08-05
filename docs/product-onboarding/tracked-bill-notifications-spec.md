# Tracked-bill notifications — scope, design, and costings

<!-- describes: alethical/api/services/notifications.py, alethical/pipeline/minnesota.py, apps/frontend/src/screens/AccountScreen.tsx, apps/frontend/src/data/mockData.ts, apps/frontend/src/lib/trackedBillsChanges.ts -->

**Net:** Tracking a bill promises we will tell you when it moves, and today we tell
nobody anything. This doc is the plan for closing that — what an email would say, how
often, what it costs, and how a live send is kept from firing before it has been proven.
**Nothing here is built.** The spend decision at the end is Eugene's.

This is the design half of
[#36](https://github.com/alethical-org/alethical/issues/36). It is a plan, not a
record of shipped behaviour: everything in "What exists today" is verified against the
code and the production database as of **2026-08-05**; everything after it is proposed.

---

## 1. What exists today — verified, not assumed

The issue's own history says slice 1 (recording) shipped in
[#282](https://github.com/alethical-org/alethical/pull/282) and that only delivery
remains. **That is wrong.** Recording does not work either, for three independent
reasons, and they compound: fixing any one of them alone still sends nothing.

### 1.1 Gap one — nothing calls the recorder

`record_bill_status_change` (`alethical/api/services/notifications.py`) has no caller
anywhere in the codebase except its own test file
(`alethical/tests/test_notifications.py`). The ingestion pipeline writes a bill's status
at `alethical/pipeline/minnesota.py:1761` and never tells the notification service:

```python
bill.current_status = latest_action.get("action_text") if latest_action else None
```

### 1.2 Gap two — the recorder reads a column nothing populates

Even wired into ingestion, it would still record nothing. It early-returns when the
status code is unchanged:

```python
if old_status_code == new_status_code:
    return []
```

Those values come from `Bill.current_status_code`. **That column is NULL on all 10,517
production bills**, and no code in the repository writes it — the only mentions are the
model definition, an index, and the original migration. So both sides are `None`, they
compare equal, and the function returns an empty list on every call it will ever
receive.

| Column | Populated in production (of 10,517 bills) |
| --- | --- |
| `current_status_code` | **0** |
| `current_status` | 10,517 |
| `status_key` | 10,517 |

`current_status_code` is dead weight. Removing it is filed separately as
[#1054](https://github.com/alethical-org/alethical/issues/1054) and is not needed to
ship notifications — the design below simply stops reading it.

### 1.3 Gap three — a user with no preference row is silently excluded

`record_bill_status_change` only queues an event for a user who already has a
`NotificationPreference` row with `channel = email`, `is_enabled = true`, and a
frequency other than `disabled`. Nothing creates that row automatically, and no shipped
screen lets a person create one.

Production today: **5 user accounts, 1 notification-preference row.** So even with gaps
one and two fixed, 4 of 5 real users would receive nothing and no error would be raised
anywhere. Absence of a row reads as "no thanks" — a choice nobody made.

### 1.4 The preferences API has no caller either

`GET`/`PUT /me/notification-preferences` (`alethical/api/routers/me.py:736-784`) work
and are covered by contract tests. Nothing in the app calls them:

- `AccountScreen.tsx` imports `getNotificationPreference` and
  `updateNotificationPreference` from `apps/frontend/src/data/mockData.ts`, not from
  `apps/frontend/src/data/api.ts`. The toggles write to an in-memory object and are lost
  on reload.
- `apps/frontend/src/data/api.ts` has no notification function at all.
- The fixture's shape (`billUpdates` / `weeklyDigest` / `hearingAlerts`) does not match
  the API's (`channel` / `frequency` / `is_enabled`), so this was never a wiring
  oversight — the two were designed apart.
- `/account` is excluded from the web route table as an "old-design or auth-gated
  surface with no shipped route" (`apps/frontend/src/navigation/webRoutes.ts:118-120`).

### 1.5 What the schema already supports

| Piece | State |
| --- | --- |
| `NotificationChannel` | `email`, `push` |
| `NotificationFrequency` | `realtime`, `daily_digest`, `weekly_digest`, `disabled` |
| `NotificationPreference` | one row per (user, channel); no database default for frequency |
| `NotificationEvent` | `sent_at IS NULL` means unsent; indexed on (`user_id`, `sent_at`) |
| Migration `0020` | replaced production's fossil `notification_event` with the shape the code expects |

The frequency enum exists, but **it assumes nothing** — there is no database default and
the API requires every caller to pass a value. The one production row is set to
`realtime`, which is not a chosen default so much as the value a test happened to write.
Picking the default is a live decision, made in §3.

### 1.6 The signal we should actually be watching

`Bill.status_key` is the classification the product already shows as a bill's badge. It
is populated on all 10,517 bills and maintained by Postgres triggers on `bill` and
`bill_action` (`alethical/alembic/versions/0014_status_key_from_action_history.py`), so
it updates itself whenever an action lands. Seven values in a strict priority cascade:

`vetoed` › `signed_into_law` › `passed_both_chambers` › `passed_senate` ›
`passed_house` › `in_committee` › `proposed`

**This is the trigger to use.** It is the same fact the badge shows, so an email can
never disagree with the page, and it is maintained in the database rather than by
whichever Python path happened to run.

One consequence matters for the design: because the triggers run inside Postgres, the
ingestion pipeline never sees the change in Python. §5.1 works with that rather than
against it.

---

## 2. What we would send — and what we would not

### 2.1 The record is mostly not news

Measured across all 31,129 action records in production:

| | Records | Share |
| --- | ---: | ---: |
| All action records | 31,129 | 100% |
| Genuine milestone actions (passage, veto, governor, chapter) | 1,164 | **3.7%** |
| Author added / stricken | 6,473 | **21%** |

Twenty-one percent of the official record is somebody's name being added to or removed
from a bill. A busy bill is busier than it looks, too: the worst single bill-day in the
corpus holds **17** records, and 617 bill-days hold 3 or more.

**So per-record email is not a close call. It is wrong by a factor of twenty-five.**

### 2.2 Send on a status change, nothing else

| Event | Send? | Why |
| --- | --- | --- |
| Bill moves to a new `status_key` | **Yes** | The badge on the page changed. This is the whole product promise. |
| Signed into law / vetoed | **Yes** (a `status_key` change) | The outcome. The one email nobody would call spam. |
| Floor vote | **Yes**, folded into the passage status change | Passage *is* the status change; a separate email would double-send. |
| First referral to committee | **Yes**, once (`proposed` → `in_committee`) | Confirms the bill is live. Fires once per bill by construction. |
| Re-referral to another committee | No | No status change. Common and procedurally opaque. |
| Author added or stricken | No | 21% of the record, and not something the tracker asked about. |
| Second reading, motions, procedural rows | No | No status change. |
| "See also HF 2446" cross-references | No | A pointer to another bill, not a step this one took. The site already excludes these (`changesSince`, `apps/frontend/src/lib/billDetail.ts`). |
| Committee hearing scheduled | **Not in v1** | We do not ingest hearing schedules. Filed as [#1055](https://github.com/alethical-org/alethical/issues/1055). Do not put it in the design until the data exists. |

This is not a taste call. A `status_key` transition happens **1.04 times per bill over
the bill's entire life** (median 1, 90th percentile 1, maximum 3, across 10,502 bills
that ever moved). Everything else is volume without information.

### 2.3 What the email actually says — and the constraint that shapes it

The site's plain dated sentences ("Passed the House", "Signed by the Governor") come
from `buildActionTimeline` → `changesSince` in
`apps/frontend/src/lib/billDetail.ts`. That is roughly a thousand lines of tuned
phrasing rules, and **it is TypeScript that runs in the reader's browser.** The digest
job is Python. It cannot call it.

Three ways out, and the choice is not close:

| Option | Verdict |
| --- | --- |
| Port the collapse and phrasing rules to Python | **No.** Two copies of the hardest logic in the product, guaranteed to drift, and the copy that drifts is the one in someone's inbox where it cannot be corrected. |
| Move the phrasing to the backend so both share it | **No, not for v1.** A large refactor that moves well-tested logic away from its tests, to serve a feature that does not exist yet. |
| **Email carries only facts the backend already has, and links to the page for the wording** | **Yes.** |

Everything the recommended email needs is a plain database column:

- the bill's code (`bill_key`) and its plain-language summary (`display_summary`,
  already the preferred field per `.claude/rules/grounded-answers.md` rule 9)
- the status it moved from and the status it moved to, as the same badge labels the page
  shows (`status_key`)
- the date of the action that caused it (`bill_action.action_at`)
- a link to the bill page, and the official-record link (`Bill.official_url`)

This is also the honest option, not merely the convenient one. An email cannot be
edited after it is sent. A short email that states a status and points at the page
cannot carry a stale restatement of a bill's history; a long one eventually will.

### 2.4 What must never be in an email

`.claude/rules/grounded-answers.md` binds outbound content, and more tightly than it
binds a page, because a page can be fixed and an inbox cannot.

- **No prediction.** Not "likely to pass", not "close to passing", not "expected to be
  heard next week". The record says what happened, never what will.
- **No ranking or emphasis.** No "the most important bill you track", no "big news", no
  reordering by inferred significance. The order is the date the record gives.
- **No count of anything not fully enumerated** (rule 11). "3 of the 8 bills you track
  moved" is fine — we hold all 8 and counted them. "12 bills like this one" is not.
- **No generated prose beyond the stored summary.** No per-email LLM call. Nothing
  written for the occasion.
- **Every claim traceable.** Each bill in the email links to its page and to the
  official record (`Bill.official_url`). A status claim resolves to `status_key`, which
  derives from the official action history.
- **Grounded neutrality** (rule 3). "Passed the House" — never "advanced", "gained
  momentum", "cleared a hurdle".
- **The subject line is a fact.** "HF 4138 was signed into law", not "Big news about a
  bill you follow".
- **No tracking pixels, no open tracking, no click tracking.** The signed-out home page
  names "infinite scrolling, autoplay video, and push notifications" among the things
  this product does not do to people. A surveillance pixel belongs on that list.

---

## 3. Cadence — recommend daily digest, default on

**Recommendation: a daily digest, on by default, with weekly as the alternative.**
`realtime` stays in the enum and stays out of the interface in v1.

**First, the argument that does *not* hold, because it is the one everybody reaches
for.** "A digest sends less mail than immediate" is false at our volumes. Measured over
the busiest month in the corpus:

| Subscriber tracks | Immediate | Daily digest |
| ---: | ---: | ---: |
| 5 bills | 1.39 emails | 1.35 emails |
| 20 bills | 5.55 emails | 4.88 emails |

A digest has almost nothing to collapse, because a tracked bill moves 1.04 times in its
whole life and only 18 bill-days in the entire biennium carried two status changes at
once. **For a typical subscriber the two cadences send the same mail.** So this
recommendation cannot rest on spam, and does not.

**The argument that does hold is blast radius.**

1. **A digest caps what a bug can do; immediate has no cap.** The worst a broken trigger
   can cost one person on a daily digest is one wrong email that day. On `realtime`, a
   bad ingestion run that rewrites statuses sends one email per bill per person — and
   the first we would hear of it is the complaints. The two cadences are equivalent when
   everything works and wildly unequal when it does not, so the failure case decides it.
2. **A digest is inspectable before it goes out.** One queued batch per day can be
   counted, dry-run, and eyeballed. A stream of individual sends cannot be reviewed
   before it has already left.
3. **It costs no timeliness that matters.** The median gap between one bill's own status
   changes is **35 days**, and the Legislature posts its record in batches rather than
   live. Waiting until the next morning loses nothing a reader would notice.
4. `daily_digest` already exists in the enum, so this needs no migration.

**Default on, not off.** The button says "Track". Somebody who created an account and
pressed it has asked to be told. Default-off would keep the current situation (§1.3)
where a person opts out by never finding a screen. The obligations that come with
default-on are a working one-click unsubscribe (§5.4) and saying so plainly at the
moment of tracking, not in a settings page nobody opens.

**Keep `realtime` out of v1's interface.** It is the one setting where a trigger bug is
unbounded, and nothing in the measured data suggests a reader wants it. Leaving the enum
value in place costs nothing and keeps the option open.

---

## 4. Cost

### 4.1 How many emails this actually is

Measured from production, 2026-08-05:

| Measurement | Value |
| --- | --- |
| Bills in the corpus | 10,517 |
| Status changes across the biennium | 10,909 |
| Status changes per bill, whole life | 1.04 (median 1, p90 1, max 3) |
| Busiest month (Feb 2025) | 2,921 changes |
| Second busiest (Mar 2025) | 2,292 |
| Quiet months | 46 to 224 |
| Days with any movement (17 months) | 98 |
| Bills moving per active day | mean 111, p90 268, **busiest 641** |

**Stated assumption:** the model below puts a typical subscriber at **5 tracked bills**.
Production holds 4 tracked-bill rows across 3 accounts, all of them test accounts, so
there is no real evidence yet — this is my estimate, and §4.4 shows what changes if it
is wrong.

From those figures: a tracked bill has a **27.8%** chance of moving during the peak
month and about a **6%** chance in an average month. One email per subscriber per day on
which something moved.

| Subscribers | Average month | Peak month (February) | Busiest single day |
| ---: | ---: | ---: | ---: |
| 100 | 22 | 139 | 27 |
| 1,000 | 216 | 1,389 | 270 |
| 10,000 | 2,161 | 13,887 | 2,698 |

Per subscriber that is about **2.6 emails a year** — most of them in February and March.
This is a very small amount of email.

### 4.2 What the providers charge

All figures below are quoted from the vendors' public pricing pages, read **2026-08-05**.
No account was created and nothing was sent.

| | [Resend](https://resend.com/pricing) | [Postmark](https://postmarkapp.com/pricing) | [Amazon SES](https://aws.amazon.com/ses/pricing/) |
| --- | --- | --- | --- |
| Free tier | 3,000/month, **100/day cap** | 100/month | none (new-account credits only) |
| Entry paid plan | **$20**/mo — 50,000, no daily cap | **$15**/mo — 10,000 | no monthly fee |
| Overage | $0.90 / 1,000 | $1.80 / 1,000 | $0.10 / 1,000 |

Resend's free-tier daily cap is confirmed separately by its own documentation and
by [its free-tier announcement](https://resend.com/blog/new-free-tier).

### 4.3 What we would actually pay

| Subscribers | Resend | Postmark | Amazon SES |
| ---: | --- | --- | --- |
| 100 | **$0** (free tier covers it) | $15/mo | ~$0.01/mo |
| 1,000 | **$20**/mo | $15/mo | ~$0.02/mo |
| 10,000 | **$20**/mo | $15/mo, $22 in the peak month | ~$0.22/mo, $1.39 in the peak month |

At 100 subscribers Resend's free tier holds: 139 in the peak month against a 3,000 cap,
and 27 on the busiest day against the 100/day cap.

At 1,000 subscribers the monthly volume still fits the free tier, but **the busiest day
sends 270 and the free cap is 100**. That single day is what forces the paid plan, and
it is exactly the day you least want mail to be dropped. This is the kind of limit that
looks fine in a spreadsheet and fails on the day the session ends.

At 10,000 subscribers Resend Pro is still $20 — 13,887 emails against 50,000 included.

**Recommendation: Resend, starting free.** The whole spend across the entire plausible
range is **$0 to $20 a month**. Amazon SES is genuinely cheaper — about $19/month less
at 10,000 subscribers — and that saving does not pay for what it costs to build: its
own suppression list, bounce and complaint handling wired through a separate
notification service, and a production-access request to leave its sandbox. Postmark is
the odd one out here, charging $15 before the first useful email and 15% more than
Resend at every volume that matters.

Revisit SES above roughly **100,000 emails a month**, which on this model is around
70,000 subscribers. Production currently has 3 accounts tracking a bill, so that is not
a decision this year.

**One prerequisite, and it is free.** `alethical.com` currently authorises only Google
Workspace to send mail (`v=spf1 include:_spf.google.com ~all`). Adding a provider means
adding its SPF include and its DKIM record before the first send, or the mail fails
authentication. `docs/operations/api-cdn-setup.md` § "Email authentication (SPF / DMARC
/ DKIM)" already flags this and warns that DMARC must not be tightened past `p=none`
until a new sender is added to SPF. Doing it in the wrong order breaks delivery for a
sender that then looks broken for reasons nobody can see.

### 4.4 If the 5-bill assumption is wrong

The 5-bill figure is the one number here that is a guess rather than a measurement, so
it is worth knowing where it breaks.

At **20** tracked bills per subscriber, a subscriber gets about 4.9 emails in the peak
month (not 20/5 × 1.39 — a digest sends once a day however many bills moved, and the
collapsing starts to matter at this many bills). At 10,000 subscribers that is
**~48,800 in the peak month, against Resend Pro's 50,000 allowance.** It fits with
almost nothing to spare.

That is the honest edge of the recommendation, and it is worth naming rather than
rounding away. It is also not a cliff: overage is $0.90 per 1,000, so 60,000 in a
freak month costs $29 rather than a failure, and the next tier up is $35/month for
100,000. **What changes the provider choice is volume above roughly 100,000 emails a
month** — about 70,000 subscribers at 5 bills each, or 20,000 at 20 bills each. We are
a long way from either.

---

## 5. How it runs

### 5.1 A reconciliation job, not a hook in the pipeline

The obvious design is to detect the change where it happens, inside ingestion. That does
not work here: `status_key` is recomputed by Postgres triggers after actions are
replaced (§1.6), so the Python that writes the bill never observes the transition.
Chasing it would mean re-reading the row after every flush and reasoning about which of
several trigger firings was the real one.

**Instead, compare state and reconcile.** Give `tracked_bill` a nullable
`last_notified_status_key`, set to the bill's current status at the moment somebody
tracks it. The job then queues an event wherever `bill.status_key !=
tracked_bill.last_notified_status_key`.

This is better on four counts, not just simpler:

- **Idempotent by construction.** Running it twice queues nothing the second time.
- **Immune to how ingestion happens to write.** It observes the result, not the path.
- **Tracking a bill never fires an email about something that happened before you
  tracked it** — the seeded value is the current status.
- **It self-heals.** A status change missed while the job was broken is still picked up
  on the next run, because the comparison is against stored state rather than an event
  that had to be caught in flight.

The migration is one nullable column: additive, reversible, and inside the standing
auto-merge grant in `.claude/rules/workflow.md` rule 10 once it has been proven with an
upgrade → downgrade → upgrade round-trip.

### 5.2 Where it runs

GitHub Actions on a schedule, following `.github/workflows/vote-backfill.yml` exactly —
that workflow already runs daily against the production database, builds its connection
from the same Supabase secrets, and uses a `concurrency` group so two runs cannot
overlap. Copying a working pattern beats inventing one.

Railway runs the API and has no scheduler configured; adding one would mean a second
always-on service for a job that runs for seconds a day.

**On the standing rule about recurring jobs:** the run itself is free (GitHub Actions
minutes are included, and the database read is trivial). The **email spend is not**, so
this is priced and proposed here and **must not be armed** until Eugene signs off. The
workflow ships with `workflow_dispatch` only — no `schedule:` block — and the cron line
is added in a separate one-line change after the go-ahead.

### 5.3 If it fails, or runs twice

| Situation | What happens |
| --- | --- |
| Job fails midway | Only rows already stamped `sent_at` are done. The next run picks up the rest. No duplicate. |
| Two runs overlap | The `concurrency` group prevents it. If one somehow started, `sent_at` is stamped in the same transaction as the send, so the second run sees no pending rows. |
| Provider returns an error | Leave `sent_at` NULL and let the next run retry. Stamp only on a confirmed accept. |
| Provider accepts but the send is lost | We do not retry. A silently lost email is better than a duplicate one, and the page still carries the signal. |
| Job stops running entirely | Nobody is emailed and nothing is corrupted. The tracked-bills page keeps working. **This is the important property: the email path is an addition to the in-app signal, never a replacement for it.** |

### 5.4 Unsubscribing

- Every email carries a one-click unsubscribe link with a signed token, working
  **without signing in**. Someone who has forgotten they have an account must still be
  able to make it stop.
- `List-Unsubscribe` and `List-Unsubscribe-Post` headers, so Gmail and Apple Mail show
  their own native unsubscribe button.
- Unsubscribing sets `is_enabled = false` on the preference row and is checked before
  every send, so a queued event for an unsubscribed user is dropped rather than sent.
- The same choice is available in the account preferences screen
  ([#1052](https://github.com/alethical-org/alethical/issues/1052)), and the two read and
  write the same row.

---

## 6. The safety design

A real email to a real person is an irreversible external side effect. Under
`.claude/rules/workflow.md` rule 10 that means the capability gets built in full, and
the live trigger stays behind config until it has been proven — **honoured by
engineering, not by asking permission.**

### 6.1 Four gates, each independently sufficient

| Gate | Behaviour |
| --- | --- |
| `ALETHICAL_EMAIL_ENABLED` | Defaults to **false**. Absent means off. Nothing sends unless it is explicitly set. |
| `ALETHICAL_EMAIL_TRANSPORT` | `console` (default, prints), `dry_run` (renders everything, stamps nothing, sends nothing), `resend` (live). The live transport is the only one that can reach the network, and it is never the default. |
| `ALETHICAL_EMAIL_ALLOWLIST` | When set, the sender **refuses** any recipient not on the list and logs the refusal. The scoped live test sets this to one address we own. |
| `--dry-run` on the job | Default **on**. Sending requires `--send` explicitly, so a hand-run of the job cannot send by accident. |

Two properties make this hold rather than merely look tidy:

- **The test suite can never send.** The live transport requires an API key from the
  environment; the test configuration does not provide one, and a unit test asserts that
  the default resolution with an empty environment is the console transport. A test that
  reaches for the network fails rather than sends.
- **The kill switch needs no deploy.** Setting `ALETHICAL_EMAIL_ENABLED=false` stops
  everything at the next run.

### 6.2 How the dry run works

`--dry-run` executes the entire path except the network call: selects pending events,
groups them per user, renders each email in full, writes every one to the log with its
intended recipient, and **stamps nothing**. Run against production data it answers the
questions that matter before anyone is emailed — how many people would be mailed, what
each message actually says, and whether any of it reads wrong.

### 6.3 The verification ladder

Each rung has to pass before the next. This is the part that must not be shortened.

1. **Unit tests** — grouping, rendering, the `sent_at` stamp, and the gates. Includes a
   test asserting an empty environment resolves to the console transport.
2. **Dry run against production data, sending nothing.** Read every rendered email.
3. **One live send to one address we control**, with `ALETHICAL_EMAIL_ALLOWLIST` set to
   that single address. Confirm the provider's delivery receipt, that the message
   authenticates (SPF and DKIM pass), that it renders in a real client, and that the
   unsubscribe link works end to end.
4. **Unsubscribe verified before the allowlist comes off** — click it, confirm the
   preference row flipped, confirm the next dry run excludes that user.
5. **Remove the allowlist.** Real recipients only after 1 to 4 pass.

Steps 3 through 5 are Eugene's call, not a session's. Step 3 is the first moment this
system touches the outside world.

### 6.4 Content review before the first real send

The rules in §2.4 are checkable, so they get checked mechanically: a test asserts no
rendered email body matches the prediction and ranking vocabulary ("likely", "expected
to", "close to", "momentum", "most important"), and that every bill mentioned carries
both a page link and an official-record link. A rule that is only written down is a rule
that ships broken once.

---

## 7. Sequenced work

Each is a filed issue. The order matters — 1 and 2 are prerequisites for anything
observable, and 3 is where the first money is spent.

| # | Issue | Why it is here |
| --- | --- | --- |
| 1 | [#1048](https://github.com/alethical-org/alethical/issues/1048) — record an event when a tracked bill's status actually changes | Closes gaps §1.1 and §1.2. Until this lands the queue is permanently empty and everything downstream is untestable. |
| 2 | [#1049](https://github.com/alethical-org/alethical/issues/1049) — make tracking a bill actually opt you in | Closes gap §1.3. Without it, four of five real users are silently excluded. |
| 3 | [#1050](https://github.com/alethical-org/alethical/issues/1050) — the digest job and the email transport, behind config | The build. Ships fully gated; no live send without Eugene's sign-off. |
| 4 | [#1051](https://github.com/alethical-org/alethical/issues/1051) — one-click unsubscribe | Must exist before the first real recipient, so it is not "after the send works". |
| 5 | [#1052](https://github.com/alethical-org/alethical/issues/1052) — notification preferences in the account screen | Replaces the fixtures of §1.4 with the real API. |
| 6 | [#1053](https://github.com/alethical-org/alethical/issues/1053) — restore the "know the moment it moves" copy | Copy may only claim this once send is live (`.claude/rules/grounded-answers.md` rule 6). |

Filed alongside, not on the critical path:

- [#1054](https://github.com/alethical-org/alethical/issues/1054) — drop the dead
  `current_status_code` column.
- [#1055](https://github.com/alethical-org/alethical/issues/1055) — ingest committee
  hearing schedules, which would make a "hearing scheduled" notification possible.

---

## 8. What this deliberately does not decide

- **Whether to spend the money.** §4 prices it; the decision is Eugene's.
- **Push notifications.** The channel enum has `push`; nothing here builds it. Email
  first, per `docs/product-onboarding/product-scope.md` § "Not built yet — accounts and
  notifications".
- **Notifications for followed legislators
  ([#151](https://github.com/alethical-org/alethical/issues/151)), issues
  ([#152](https://github.com/alethical-org/alethical/issues/152)), or candidates
  ([#148](https://github.com/alethical-org/alethical/issues/148)).** All three assume a
  working delivery path. This builds that path; they extend it.
- **What the email looks like.** The design request covers content and layout. This doc
  fixes what may and may not be in it, not how it is arranged.
