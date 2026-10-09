# Candidate profile claim button

Net: The working candidate profile claim action uses the approved green button
and aligns with its explanation. Other account actions retain their own appearance.

## Scope and accepted design

Accepted bundle: Alethical UX (72).zip, downloaded 9 October 2026 at 09:55 Eastern.
SHA-256: 3752ff38ea36334390caf5a4cc66018bc75dd772195727a8ed9c27fb96bede13.
Drawings: Candidates profile.dc.html and Candidates profile records.dc.html.
Written behavior: review-prompt-claim-button.md and the Claim button section in
build-facts-candidates.md. Profile labels and the candidate return link are owned
by separate work. This change preserves their behavior and existing claim permissions.

## Comparison and impact record

The public profile currently chooses the outlined button for new claims. Its
account-action inner container has a 600px maximum width and starts at the left
edge. CandidateButton already sizes to content off phone and fills the phone
wrapper. Reuse its existing green treatment and preserve the current alignment;
browser acceptance must establish that the rendered alignment matches.

- New claim: green fill and border #2ed47e, text #06231a, hover #28bf71,
  press #23ad66; label Claim this profile. Its existing claim destination remains.
- Button measurements: 48px minimum height, 12px corner radius, 22px side padding, Libre Franklin
  16px/700. The explanation remains connected through aria-describedby.
- Approved owner: Manage this profile remains green and keeps its manage destination.
- Saved request: View profile claim status remains outlined and keeps its status destination.
- Pending, rejected, withdrawn and revoked requests keep this outlined status
  action. An approved request without management permission also shows status.
- Administrator: Review profile claim requests remains outlined and opens its existing review list.
- All public profile account actions: left edge matches the record and explanation
  on desktop and tablet; phone retains a full-width button. Keep the existing
  explanation words and 8px button-to-explanation gap.
- Election ended: no new claim button. Loading and failures retain their current
  messages and recovery. Do not introduce account information into public records.
- An unavailable official record keeps new claim requests blocked; changing the
  button appearance cannot grant access or alter eligibility.
- Keyboard focus remains visible; mouse hover and press use existing treatments;
  touch activates once. No new sign-in, claim submission or real email is needed
  for acceptance of this appearance change.
- Legislator claim preview remains inactive and pale. Account request/manage forms
  are outside the newly drawn public-profile control scope.

Affected uses: live CandidateProfileScreen and private CandidatePreviewScreens
both use CandidateClaimPanel. No other working public-profile claim control exists.
The shared button already supplies the approved colors and interaction treatment.
Prevent recurrence with a rendered browser check of real profile account states,
alignment, phone width, hover, press, keyboard focus and claim destination.

## Delivery steps

1. Independent review of the comparison against the accepted drawings before edits.
2. Apply the smallest shared account-action correction.
3. Run relevant account tests, type and formatting checks, and browser checks at
   1280, 900, 390 and 320px, including wrapped explanations and account states.
4. Independent acceptance review, commit, upload, current-head checks and merge queue.
5. Exercise the live candidate profile's claim control, record release evidence,
   and finish working-folder cleanup.

## Fixed account-action words and destinations

| Account state          | Button                        | Explanation                                                                                                                                                                        | Destination                                         |
| ---------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| New claim              | Claim this profile            | Request campaign access to add a statement to this candidate profile. An Alethical administrator must confirm that you are the candidate or an authorized campaign representative. | /candidates/{id}/claim                              |
| Approved owner         | Manage this profile           | Add, edit or remove your campaign statement on this candidate profile. Your approved profile claim does not let you edit official records.                                         | /candidates/{id}/manage                             |
| Pending                | View profile claim status     | Your profile claim request is waiting for an Alethical administrator’s review. Approval gives you campaign access to add a statement to this candidate profile.                    | /candidates/{id}/claim                              |
| Pending after election | View profile claim status     | This election has ended, so your profile claim request can no longer be approved. You can still view or withdraw your request.                                                     | /candidates/{id}/claim                              |
| Rejected               | View profile claim status     | Your profile claim request was not approved. View its status and available next steps.                                                                                             | /candidates/{id}/claim                              |
| Withdrawn              | View profile claim status     | Your profile claim was withdrawn. View its status and available next steps.                                                                                                        | /candidates/{id}/claim                              |
| Revoked                | View profile claim status     | An Alethical administrator revoked your profile claim. View its status and available next steps.                                                                                   | /candidates/{id}/claim                              |
| Administrator          | Review profile claim requests | Review requests to claim candidate profiles. Confirm each applicant’s identity and authority to represent the campaign before approving campaign access.                           | /admin/candidate-claims?candidate={id}&from=profile |

Approved records without management permission retain the existing outlined status
action and existing explanation; this appearance change does not change those permissions.

## Local acceptance

- Existing candidate account and public report suites: 38 tests pass.
- TypeScript check passes.
- Rendered Chromium regression passes at 1280, 900, 390 and 320px: public claim,
  owner/manage and pending/status states; colors, hover, press, keyboard focus,
  dimensions, alignment, wrapping, explanation association, destinations,
  loading omission and failure retry. It uses private illustrative records.
- The current source already left-aligns account buttons; the browser shows the
  same left edge for the claim control and its explanation. No spacing change is needed.
- No real account sign-in, profile claim, staff decision, statement write or email
  is performed for this appearance release. Physical devices remain untested.

Independent coverage review accepted the comparison after adding terminal account
states, restricted owners, blocked official records and precise button measurements.
The smallest change is the appearance choice in AccountAction; alignment needs no edit.

Status: implementation underway; browser acceptance pending.
