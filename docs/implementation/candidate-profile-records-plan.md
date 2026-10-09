# Candidate profile records and profile claim review

Tracking: [Retain candidate profile records and complete profile claim review](https://github.com/alethical-org/alethical/issues/2553).
Owner: Codex task **candidate profiles/records** (`01a11aa8-af7f-74c3-bec8-11fa9711cfb7`).

## Authorized outcome

The approved outcome includes direct work with Design, review of the returned
drawings, and implementation through a tested live release. The task retains its
working folder for routine work. Drawing and implementation are authorized; new product choices,
invented records, real test emails and unrelated changes are not.

The public record connects verified people, their election records and their
service without treating an election win as proof of service. Candidates have
public records before requesting campaign access. Official research survives a
lost election or deletion of a campaign account. Private claim evidence and
campaign statement history retain the account-deletion protections in
[How Find My Candidates works](../product-onboarding/find-my-candidates-guide.md).

Articles and debates remain a later intake phase. This release does not add
promise scoring, paid candidate services, an all-office directory or a redesign
of `/find-my-legislator`. The separate candidate-address work is not part of this
change.

## Approved behavior to implement

- `/people/<id>` holds a verified person's elections, supported service and
  supported official research. `/candidates/<id>` remains one candidacy, office
  and election. `/legislators/<slug>` retains detailed legislative records.
- Person connections require explicit evidence. Preserve a joint ticket's
  supplied name; show only verified member connections. Do not split a name to
  invent people or infer continuity from name equality.
- Election selection preserves an explicit choice, otherwise uses the nearest
  supported upcoming election or most recent supported past election. Historical
  lookup requires the selected election's source geography.
- Race results and ballot records carry independent sources and dates. Only
  certified final results for that race and stage authorize Elected or Not
  elected. Test results, vote leads, uncontested races and elapsed dates do not.
- Actual service needs its own evidence. Keep expected start dates distinct from
  confirmed service. Retain losing candidates in historical records.
- Research at launch uses supported official records. Campaign finance appears
  only through confirmed Minnesota Campaign Finance Board committee connections,
  preserving each committee and reporting period.
- Profile claim is the feature; campaign access is the permission it grants.
  Claim this profile and Manage this profile retain their names. Explanations
  appear below the relevant action. Voters cannot approve requests.
- There is 1 admin role with equal permissions and 1 shared review list. Admin
  accounts cannot claim candidate profiles or manage statements as owners.
  The admin action on a candidate profile is Review profile claim requests.
- Requests contain a role, public supporting link and private explanation.
  There is no upload, campaign code check or More information needed workflow.
  Existing pending requests open their status without overwriting their evidence.
- New requests and approvals close after election day in Minnesota. Approved
  non-admin owners retain statement management. Other eligible terminal states
  can request another review while requests are open, subject to normal limits.
- Private event history records submission, resubmission, withdrawal, giving up,
  approval, rejection and revocation. Historical gaps remain explicit. New
  events retain their own evidence; older records are not given invented events.
- Admin review has Pending and All, 25 requests per page, oldest-created first,
  candidate filters and exact request links. Pending counts include ended-election
  pending requests. Counts belong inside the open account menu.
- Approval requires independent identity and campaign-authority verification,
  eligible requester, current source evidence and no competing approved owner.
  A stale screen cannot overwrite a newer decision. Recheck official record must
  fetch and match real source evidence, not update a timestamp locally.
- Giving up and revocation remove published campaign statements when present.
  Giving up remains the stored withdrawn status. Public candidate records remain.
- New and resubmitted requests email eligible active admins. Decisions email the
  requesting account and other eligible active admins, excluding the deciding
  admin. Separate messages omit private evidence, review notes and recipient lists.
- Save request/decision, private event and intended email delivery atomically.
  Deliver after saving, recheck recipient eligibility and current confirmed email,
  and deduplicate retries. Email failure does not undo the decision.

## Build sequence and completion checks

1. **Accept drawings.** Pin the returned claim/admin/email package and the
   public-record drawings with checksums. Inspect every in-scope section, role,
   state and action. Create a complete comparison record, and have an independent
   reviewer check coverage before implementation.
2. **Resolve source contracts.** Establish repeatable official candidate rechecks,
   election availability, result identity and certification evidence, and
   historical geography. Read source responses directly. Never activate an
   unsupported election, guessed identity or illustrative data.
3. **Build shared records and permissions.** Add the smallest additive schema and
   source contracts, preserving private/public boundaries. Reconcile migration
   numbering with current main and the separate source-refresh change.
4. **Build the approved screens and delivery.** Implement the accepted visual
   direction, exact wording, event history, admin list/menu and email templates.
   Complete every action through its success and recovery outcome.
5. **Verify.** Run focused server and frontend tests, real PostgreSQL migration
   upgrade/downgrade/upgrade, all role journeys and responsive comparisons. Test
   races, unknown saves, account changes, deletion, stale source evidence and
   delivery retries without sending real test email.
6. **Release and accept.** Independently review the complete working surfaces,
   update governing guides and privacy wording, pass current-main checks, merge,
   deploy and compare the live behavior. Record results before closing the issue.

## Impact and prevention record

The current claim system already locks each candidate during ownership decisions,
checks request versions and enforces 1 approved owner. Extend these safeguards;
do not replace them with a more complicated admin assignment process.

The current request row overwrites evidence during resubmission and has no claim
event history. Append-only events in the same transaction preserve evidence and
allow notifications to refer to one saved event. A unique event/recipient delivery
identity prevents duplicate notifications; bounded provider retries must preserve
the exact attempted payload when a send outcome is unknown.

Admin eligibility comes from allowlisted account identity and confirmed active
authentication records, not a guessed email or a new role. The existing menu hint
can roll back its database session on failure; it must not be reused inside a
claim-write transaction. Shared authoritative checks must fail closed without
silently rolling back unrelated work.

Affected uses include public profiles, claim/status/manage screens, admin review,
account-menu counts, email destinations, account deletion, source refresh and
person/legislator links. Preserve their different public/private access rules.
Clear private responses on an account or permission change. Event and delivery
retention must follow requester deletion; deleted admin actors must not leave
unnecessary copied private identifiers.

Public candidate records currently lack a repeatable source locator for a direct
official recheck. A queue refresh is not evidence refresh. Preserve the previous
check date on source failure, an election mismatch or an unmatched identity.
Retained public reference geography must be independent of visitor requests and
must not store visitor addresses or account associations.

Existing admin-owned requests require a scoped read-only audit before activating
the restriction. Do not erase their history or silently transfer ownership.

Official rechecks now use 3 independently retained public reference locations,
covering 112 current candidate IDs. A fresh response must match the exact record.
An identity, election or missing-candidate mismatch blocks requests/approvals;
transient failure preserves any earlier block and successful source date. Existing
approved non-admin statement management remains available.

The supported historical election has reviewed Minneapolis school-board results
and separate roster evidence. Its address geography cannot be established from
the currently served source; historical address lookup therefore states that it
cannot confirm the races and provides the official results link. It never falls
back to current-election geography. This is a real supported limitation, not an
unassigned future implementation.

Remaining acceptance: safe live activation audit, final integration and live
release. Local role/account boundaries and screen comparisons pass.

Browser review found that selecting a destination from the phone account sheet
closed that sheet but left the surrounding site menu over the destination. The
shared drawer now closes on account navigation while preserving Close/Escape
behavior. Rendered regression checks cover tracked items, email preferences and
admin destinations; the actual phone profile-review path also passes.

## Progress evidence

<!-- timeless-check-ignore: dated implementation checkpoint, not product instructions -->
8 October 2026: branch `codex/candidate-profile-records` includes current main
through `14a4706705cc0b37e8ed153eb4cb5959115d6a62`. Public drawing package
Alethical UX (62).zip remains the accepted public record direction. Profile claim
package Alethical UX (66).zip has SHA256
`db3b54331734afec17467c456318cb0ddd725cd45c082c1c17313f2926d6f52f`.
Independent review covered 218 requirements. Direct Design updates reconcile
source-block wording, closed-election sign-in, unpublished previews, unsaved
navigation, responsive dialogs and readable long evidence. Those are settled
corrections within the accepted visual direction. The private acceptance matrix
keeps observed browser behavior separate from controlled responses and source
inspection; actual phone hardware and external email-client rendering are not
claimed.

The complete backend suite passes 5,019 tests. The complete frontend suite passes
4,359 tests in 341 files. Lint, type checks and the production-style website build
pass. Initial compressed JavaScript is 297,163 bytes against the unchanged
297,506-byte release limit. Full draft-history protection loads with the statement
editor rather than adding its complete implementation to every visitor's first
page. Independent code review covers request-version checks, deleted-reviewer
cleanup, retained-result feedback and the lazy history boundary.

Local browser acceptance covers public/person reciprocal links, separate result
and service sources, request errors, submission, withdrawal, resubmission, statement
preview/edit/removal and giving up a published statement. Admin checks cover source
refresh success/failure, approval validation, revocation, ended-election rejection,
stale decisions and report review. Profile/menu return destinations survive the
navigation. Phone, tablet and desktop comparisons cover the accepted form/status,
editor, dialog and unified admin-list/detail geometry. All 8 email templates fit
phone and desktop previews; no real email was sent. A further 15 rendered
Chromium interaction checks pass with controlled fictional responses, covering
failures, retries, steady saving buttons, hover, focus, touch, menu movement,
enlarged text and browser history. Firefox and WebKit are not claimed as tested.

Browser acceptance exposed 3 shared causes and now has focused prevention checks:

- Retained editor routes bypassed the removal warning. Candidate-specific route
  identities and a guarded history adapter protect profile/header/footer departure
  and Back/Forward without adding duplicate entries or losing Forward history.
  Keep editing and Escape restore draft, address and statement-field focus;
  Discard performs the original departure once. Account and permission changes
  still clear private content. Real navigation tests failed before the correction
  and pass after it, alongside the rendered browser path.
- The unbreakable final-word link group clipped very long evidence URLs, and flex
  sizing compressed stacked phone metadata when text grew. The existing link group
  can now wrap an oversized token while keeping the final character with its arrow;
  phone metadata uses its natural height. Rendered bounds at 200% text verify that
  the URL remains visible and applicant/submission blocks remain separate.
- Stale validation messages disappeared only on submission and moved busy actions.
  Previously invalid fields now update their own errors as they are corrected.
  Rejecting after an approval-only checkbox error preserves that error's measured
  space during the request while removing its obsolete message. Browser checks
  measure ready/busy bounds and cover recovery from uncertain outcomes.

Unpublished previews omit a date rather than inventing today's date or borrowing
a statement-removal date. Two focused regressions cover never-published and
removed statements. In-app draft protection is distinct from the browser-owned
warning for document departures; no private saved-draft feature is implied.

## Live release acceptance

<!-- timeless-check-ignore: dated release evidence, not a promise of current data coverage -->
8 October 2026: [pull request 2561](https://github.com/alethical-org/alethical/pull/2561)
passed the merge queue and released as
[commit 532c97d1](https://github.com/alethical-org/alethical/commit/532c97d1ad3c397128b04ad8a1053c7983575034).
Both the public website and API report that exact commit. The API readiness check
passes, and the production database is at `0069_candidate_person_records`.

The guarded public-record import added 2 elections, 6 historical candidacies,
4 races, 6 race memberships, 11 people, 11 candidacy connections, 4 service
records, 8 research records and 26 retained source versions. It changed no
pre-existing records. The private receipt retains exact before/after rows and a
guarded recovery path. Database readback matched the saved after-image. The
8 isolated PostgreSQL recovery checks and pinned source hashes remain part of
the retained evidence. The import wrote no claims, statements, accounts or
notifications.

Live checks passed for 36 public API paths, the explicit unsupported historical
address response, and signed-out denial of the private request and admin routes.
The checks cover all 6 historical candidates, 4 historical person overviews and
7 reciprocal legislator/person/candidacy connections. Ballot, election-result
and service evidence retain their own sources and dates. Actual service keeps
the source's year precision rather than inventing a January 1 start date.

Chrome acceptance on the live website covers candidate-to-person navigation,
service and election records, research source disclosures, the admin account
menu, Pending/All review filters and the empty review list. Phone layout and
phone account-menu navigation work. Direct visits to claim and manage addresses
block admin accounts from ownership and campaign editing. No live claim,
decision, campaign edit or test email was submitted; those write paths retain
the isolated database and browser acceptance described above.

The fresh activation audit found both private claim-history/delivery tables
protected by row security with no public policies, the deleted-reviewer cleanup
trigger installed, 3 eligible admin email recipients and an empty delivery queue.
After these checks, the profile-claim email flag was enabled and its settings
release completed successfully. The final read-only audit at 18:35 UTC found
the flag enabled, the API ready and the queue still empty. Activation follows
[deployment.md § Profile claim email activation](../operations/deployment.md#profile-claim-email-activation);
provider delivery to real recipients is deliberately not claimed as tested.

The task retains its managed working folder for routine work at Eugene's request.
Temporary drawings, private audit receipts and browser evidence remain under
`~/.local/state/alethical-agent-jobs/` rather than in public product documentation.

## Profile claim and candidate features round (Alethical UX 90)

<!-- timeless-check-ignore: dated implementation checkpoint, not product instructions -->
9 October 2026: authorized build of the 38-item review in `Alethical UX (90).zip`
(SHA-256 `188f899d2b8fb9aa396897ef36642c992fd5ef68644c0287a18dfdbd47d711a3`), on branch
`codex/profile-claim-features-90`. Items 1–5 (status block, badges, certified badge,
source area, black claim buttons) shipped earlier in
[pull request 2577](https://github.com/alethical-org/alethical/pull/2577) and
[pull request 2582](https://github.com/alethical-org/alethical/pull/2582); this round
re-verifies them and builds the remaining delta. The behaviour now lives in
[How Find My Candidates works](../product-onboarding/find-my-candidates-guide.md).
A private comparison record lists one entry per requirement; an independent review
accepted it before implementation.

Scope delivered in this round:

1. `/candidates/features`: public page, every feature labelled on the roadmap, claim
   context by public candidate id only, first response served without indexing, and the
   claim page link in the same release.
2. Claim page: introduction, sign-in return, human-review form wording, per-length
   explanation errors, in-memory answers bound to account and candidate, receipt with
   the server's latest submission date and exact-prefix role, and every status state.
3. Manage page: new layout and wording, live count, publication date under the editor,
   Save changes only after an edit, write checks on every path, read-before-retry, and
   equal-width dialogs.
4. Public statement card, failure retry and report dialog with the updated-statement
   panel; first publication and latest edit derived from revision history (no schema
   change).
5. Admin request review labels, decision section, block order and placement, and
   per-submission history; profile claim email wording.
6. Grey Go back on person overview and the admin request; legislator panel edge
   alignment on the candidate profile.

Held: an applicant-facing rejection reason (not approved intent; the private review note
stays private), and the statement card's bottom paddings, where 2 drawings disagree and
Design rules on the final value.

Verification: focused backend and frontend suites, the full frontend suite, and 2
rendered Chromium specs with fictional intercepted data at 1280, 900 and 390 pixels
(`apps/frontend/e2e/candidate-features-and-claim-round.spec.ts`,
`apps/frontend/e2e/profile-claim-interactions.spec.ts`). No real claim, decision,
statement, report or email was created to test. Remaining: independent product
acceptance, current-head checks, merge, deployment and live comparison.
