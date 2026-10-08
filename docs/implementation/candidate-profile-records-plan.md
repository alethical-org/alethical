# Candidate profile records and profile claim review

Tracking: [Retain candidate profile records and complete profile claim review](https://github.com/alethical-org/alethical/issues/2553).
Owner: Codex task **candidate profiles/records** (`01a11aa8-af7f-74c3-bec8-11fa9711cfb7`).

## Authorized outcome

Eugene authorized direct work with Design, review of the returned drawings, and
implementation through a tested live release. The task retains its working folder
for routine work. Drawing and implementation are authorized; new product choices,
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

Remaining evidence to establish: usable official recheck source; historical
election geography; race-specific final-result evidence; safe live activation
audit; returned design comparisons; real account-deletion browser coverage.
The owning task resolves these before claiming the affected behavior is complete.

## Progress evidence

<!-- timeless-check-ignore: dated implementation checkpoint, not product instructions -->
8 October 2026: source baseline `df5721897c5304c14f2eb73a37812082a609b1e3`;
branch `codex/candidate-profile-records`. Design received all 15 reference files
and the recovered 853-line target response as a Markdown attachment. Design saved
the response and began the 7 claim/admin/email surfaces. Drawings are review
pending. No feature implementation or live release is complete.

The task's private evidence directory is
`~/.local/state/alethical-agent-jobs/`; temporary drawings and prompts remain
there, rather than becoming permanent product documentation.
