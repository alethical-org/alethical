# Legislator profile claims and the candidate survey

**Status: proposed, not approved.** Nothing here is built. Once approved, this file becomes
the build specification and the drawing brief's source of truth.

Net: A sitting Minnesota legislator, or staff in their office, can claim their Alethical
profile in 3 steps: sign in, type a code we email to the address the Legislature publishes for
them, and wait for an Alethical admin to approve. Approval lets them add their own words
beside the record (a candidate survey, an introduction, vote explanations) and send private
correction requests. It never lets them change or hide any record.

## 1. What this builds on

Approved intent this spec carries forward, unchanged:

- **The live legislator profile already promises it.** Its **ON THE ROADMAP** card says:
  "Are you {name}? Claiming links you to this existing record, so you can manage your
  biography, write up the bills you’ve worked on, and add your own context. Verified against
  official legislative records." Its second card says a claimed legislator "will have the
  option to explain any vote they cast — right here, in their own words, alongside the
  record" (`apps/frontend/src/screens/redesign/LegislatorProfileWebScreen.tsx`,
  [legislator-profile-guide.md, Share and planned features](legislator-profile-guide.md)).
- **The About Us page promises it too:** "Legislators and candidates can claim their profiles
  and speak in their own words. Legislators can explain their votes, and candidates can
  explain their positions, clearly labeled and kept separate from the official record."
  (`apps/frontend/src/screens/redesign/AboutUsScreen.tsx`).
- **The candidate profile claim is live and is the pattern to reuse.** Accounts, the role
  choice, the shared admin review list, the 7 private history events, the 8 email messages,
  give-up and revoke, the statement editor and its unsaved-edit protections, the report link
  and the "verified authority, not accuracy" line are all built
  ([find-my-candidates-guide.md, Claiming and managing a profile](find-my-candidates-guide.md#claiming-and-managing-a-profile);
  [issue 2553](https://github.com/alethical-org/alethical/issues/2553)). This spec adds only
  what a legislator claim needs that a candidate claim does not.
- **The candidate features page already commits to fair, comparable answers.** "Answer the
  same questions offered to other candidates in your race" and "Campaign voices and official
  facts stay distinct" (`apps/frontend/src/lib/candidateFeatures.ts`). The candidate survey in
  §7 is the first piece of that promise.

What this spec changes or adds:

1. **An official-email code.** Candidate claims deliberately have no code check, because a
   campaign has no official mailbox. A sitting legislator does, so a code sent to the
   published address becomes the main proof, with admin approval still required. This is
   what the roadmap card's "Verified against official legislative records" means in practice.
2. **The candidate survey**, offered first to claimed legislator profiles (§7).
3. **One review list for both kinds of claim** (§4).

## 2. Who can claim

- **Current members only.** On 14 Oct 2026 Alethical's records hold 133 current House members
  and 67 current senators.
- **The legislator, or staff in the legislator's office.** The request asks which one. The
  public label says which one (§8), so a staff-managed profile never reads as the member
  speaking personally.
- **1 approved owner per profile.** A second person asks for a review of the existing access;
  the admin decides (§5). Team access is later work.
- **Not eligible:** admin accounts (the existing rule, so a reviewer never approves their own
  access); former members, whose official mailbox no longer exists; members-elect before they
  take office, who claim their candidate profile instead.

## 3. The claim, from the claimant's side

The path is 3 steps, and the second has at most 2 buttons. Wording in quotes is proposed
fixed text. `{Title Name}` means "Representative {full name}" or "Senator {full name}".

### Step 1: start and sign in

On `/legislators/<id>`, the roadmap card's inactive preview becomes a working button,
**Claim this legislator profile**, with the explanation underneath: "Alethical reviews
requests from legislators and their office staff. Approved access lets you add your own
words to this profile, not change official records." The button opens
`/legislators/<id>/claim`. Signed out, that page shows the legislator card and **Sign in to
continue**, and sign-in returns to the same page (the existing candidate behaviour).

### Step 2: confirm the official address

Signed in, the page shows the legislator card (name, chamber, district) and 2 parts:

1. **Who is making this request?** **I am {Title Name}** or **I work in {Title Name}’s office**.
2. **Confirm your official email.** "We’ll send a 6-digit code to {address}, the address the
   Minnesota {House|Senate} publishes for {Title Name}". **Send code**, then a code box and
   **Send request**.

The address is never typed by the claimant. Alethical sends only to the address it copied
from the Legislature's own member page, and the page names that address in full, since it is
already public. This is the whole security property: nobody can point the code at an inbox
they control.

Three variations, each replacing part 2 and nothing else:

- **The account already uses that address.** If the signed-in account's confirmed email is
  the official address, part 2 reads "Your account uses {address}, the official address for
  {Title Name}" and shows only **Send request**. The sign-in code already proved the inbox.
- **No published address.** Part 2 reads "The Minnesota Senate doesn’t publish an email
  address for {Title Name}. Alethical will call the Capitol office at {phone} to confirm this
  request." and shows only **Send request**. On 14 Oct 2026 this is 50 of 67 senators, whose
  Senate pages show a mail form instead of an address (Senator Alice Mann's page, checked the
  same day), and 1 House member with no address in our copy (Leigh Finke).
- **Already claimed.** The page says another account manages this profile and offers
  **Request a review**, which uses the same steps (the existing candidate behaviour).

Code rules:

- 6 digits, valid for 15 minutes, tied to this account and this profile.
- 5 wrong entries end that code. **Send a new code** appears after 60 seconds; at most 3
  codes per account per profile per hour.
- A code, not a link: workplace email security often opens links automatically to scan them,
  which can use up a one-time link before the person sees it.
- Wrong code: "That code doesn’t match. Check the latest email or send a new code." Expired:
  "That code has expired. Send a new code to try again."
- Help under the code box: "Didn’t get it? Check your junk or quarantine folder. You can also
  send the request without a code, and Alethical will call your Capitol office instead." That
  link switches part 2 to the no-published-address version, so a mail filter never dead-ends
  the request.
- Codes are stored only as a one-way fingerprint (a hash) and never written to logs, addresses
  or browser storage.

The code email, from **Alethical <ask@alethical.com>**:

- Subject: "Your Alethical profile code"
- Body: "{Account display name} asked to manage {Title Name}’s profile on Alethical. Use this
  code to confirm: {code}. It expires in 15 minutes. If you didn’t expect this, you can ignore
  this email. Nothing changes without the code."

### Step 3: wait for review

**Send request** shows the existing receipt, **Profile claim request received**, adapted:
Alethical reviews each request and may call the legislator's Capitol office; the person can
leave and return; **Withdraw request**. There is no written explanation, link or upload to
fill in: the code does the work those fields do for candidates. No review time is promised.

## 4. The admin side

**One review list for both kinds of claim**, at `/admin/profile-claims`, with a filter for
**Legislator** and **Candidate** requests. `/admin/candidate-claims` forwards there. The account
menu's existing **Profile claim requests** count covers both.

A legislator request page shows:

- The legislator card and a link to the official member page the address came from, with the
  date Alethical copied it.
- **Role** (legislator or office staff), the account's display name and confirmed email.
- **Official email**: the address, then **Code confirmed {date and time}**, or **No published
  address: call the Capitol office at {phone}**, or **Code not confirmed: call the Capitol
  office at {phone}**.
- **Request history**, as today.

To approve, the admin:

1. Checks the code line. When it says to call, calls the number from the Legislature's own
   page (never a number the applicant supplies), confirms the member authorized the request,
   and ticks **I called the Capitol office at {phone} and the office confirmed this request**.
2. Calls anyway when anything looks wrong, for example an account name that matches neither
   the member nor a plausible staffer.
3. Writes the existing private note (20 to 2000 characters), recording what was checked.

Approval is blocked, with the reason shown above **Approve request**, when: no code is
confirmed and the call box is not ticked; another account already has approved access;
the applicant account is an admin, deactivated or unconfirmed; the legislator is no longer a
current member; or the official address changed after the code was sent.

On approval, 2 emails go out. The applicant gets the existing approval message. **The
official address, when one is published, gets a notice**, even when no code was used: "{Account display name} can now
manage {Title Name}’s profile on Alethical as {the legislator | staff in their office}. If
this is unexpected, reply to this email and we’ll remove access." This is the safety net that
costs the claimant nothing: if a staffer claims without the member knowing, the member's own
inbox finds out.

## 5. When access ends

- **Give up** and **Revoke** work as on candidate profiles, and both remove everything the
  owner published.
- **Leaving office** ends editing automatically when Alethical's roster shows the person is no
  longer a current member. What they published stays, with its dates, as a record of what
  they said while serving, and cannot be edited. A former member can ask Alethical to remove
  it.
- **A new term** changes nothing while the person stays a current member.
- **Staff turnover**: the new staffer requests a review; the admin revokes the old access and
  approves the new one. Ownership never transfers automatically.
- **A member who resigns while a request is pending**: the request closes and the applicant
  sees why.
- **Account deletion** removes the private claim records and the published content, as the
  candidate rules already require ([user-data-retention-policy.md §2.10](user-data-retention-policy.md)).

## 6. What a claimed profile unlocks

### At launch

| Feature | What the owner does | What voters see | Limit |
| --- | --- | --- | --- |
| Candidate survey | Answers the same questions every candidate gets (§7) | Public answers, dated | §7 |
| Introduction | Writes a short introduction | A labelled box near the top, below the official facts | 1,000 characters, plain text |
| Vote explanations | Picks any roll call they voted in and explains it | The explanation under that vote, labelled | 1,000 characters each, plain text |
| Correction requests | Reports a factual error in a record, including the campaign committee linked to them, with a source | Nothing; private to admins | Fixed only from an official source |

Why these 4: the survey is the required feature; the introduction and vote explanations are
already promised on the live profile and About Us page; correction requests turn the people
who know their record best into a check on our accuracy, including a wrong or missing link to
their campaign committee. A correction request never changes a record by itself. An admin checks it against the official
source and fixes the record only when the source supports it.

### Next, in this order

1. **Bill notes**: "Why I wrote this bill" on bills they chief-authored, fulfilling the
   roadmap card's "write up the bills you’ve worked on".
2. **Public events**: town halls and listening sessions, with date, place and changes.
3. **Office links**: the office newsletter and official social accounts, as plain links out.
4. **A private reach summary**: how many people opened the profile each week, as a count only.
   No names, emails or reading history, and no number under 10.

### Never

Editing, hiding or reordering any record (votes, bills, money, summaries, photo, party,
district); donation or fundraising buttons; seeing who follows them; paid placement or
priority; replying to individual readers through Alethical.

## 7. The candidate survey

### Purpose

1. Give voters each person's own answers to the **same questions** every candidate gets.
2. Teach Alethical what candidates find hard and what they need, privately.

### Who gets it, and fairness

- At launch, the owner of a claimed legislator profile.
- It is built once and shared. **Before candidate profile claims next open, claimed
  candidate profiles get the identical survey**, so every candidate in a race faces the same
  questions in the same order with the same limits.
- Public answers do not appear before the 2026 general election ends on 3 Nov 2026, so no
  2026 race shows answers from sitting members while their challengers could not answer.
- No party, district or any other trait changes what anyone is asked or how answers appear.
- Question wording changes only between election cycles. Every answer stays attached to the
  exact wording it answered.

### Questions

**Shown on your profile** (public):

| # | Question | Answer |
| --- | --- | --- |
| 1 | Why did you first run for office? | Up to 600 characters |
| 2 | What’s the hardest part of running for office? | Up to 600 characters |
| 3 | What are the 3 issues you most want to work on? | 3 short boxes, up to 80 characters each |
| 4 | What do you most want to get done in the next 2 years? | Up to 600 characters |
| 5 | Tell us about a time you worked with someone you disagreed with. | Up to 600 characters |
| 6 | What’s one thing about the Legislature you wish more Minnesotans understood? | Up to 600 characters |

**Only Alethical sees these** (private):

| # | Question | Answer |
| --- | --- | --- |
| 7 | What resources do you need most? | Choose up to 3: Money for the campaign; Volunteers; Campaign staff; Voter contact lists and data; Help with digital ads and social media; Press coverage; Policy research; Help with campaign finance reports and rules; Training or a mentor; Time; Something else (up to 200 characters) |
| 8 | What takes up most of your campaign time? | Choose up to 3: Raising money; Knocking on doors; Phone calls; Events and forums; Social media; Finance reports and paperwork; Something else (up to 200 characters) |
| 9 | What would make running for office easier? | Up to 600 characters |
| 10 | Which tools or services do you use for your campaign today? | Up to 400 characters |
| 11 | If Alethical built one thing to help candidates, what should it be? | Up to 600 characters |
| 12 | May Alethical contact you about your answers? | Yes or No, No unless chosen |

### Answering

- One page, `/legislators/<id>/manage/survey`, opened from **Manage this profile**. The 2
  sections carry their headings, so nobody wonders who sees what.
- Every question can be skipped. **Save answers** saves everything at once; public answers
  appear on the profile when saved. Unsaved-edit protection, **Try again** and the
  changed-elsewhere warning reuse the candidate statement editor's rules.
- Answers can be edited or deleted at any time. Plain text only, no links.
- A one-line note above the questions: "Some questions ask about campaigning. Answer them
  yourself or through your campaign, not on legislative staff time." House Rule 9.05 says a
  House employee "must not participate in campaign activity during working hours" and "House
  equipment must not be used for campaign activities"
  ([House Rule 9.05](https://www.house.mn.gov/cco/rules/permrule/905.htm)). The Senate's
  rule was not read, and the same precaution applies there. The official address therefore receives only the one code and the approval
  notice, and every later email goes to the account's own address.

### What voters see

- A section on the profile, **Candidate survey**, under the introduction. Each answered public
  question shows the question word for word, the answer, and **Answered {date}** or **Edited
  {date}**.
- The section heading's line names the author: "Answers from {Title Name}" for a legislator
  owner, "Answers from {Title Name}’s office" for a staff owner.
- Unanswered questions are not listed. No answers means no section, and no "declined to
  answer" wording.

### Private answers

- Seen only by Alethical admins. Never published individually, never sold, never shared with
  any campaign, party or client of Alethical's campaign services (`/services`).
- Reported only as group totals of 10 or more people, with no split that could single anyone
  out (no district, no small party groups).
- Contact happens only after a **Yes** to question 12.
- Taking the survey, or anything anyone answers, never changes how Alethical shows a person's
  record.

## 8. How owner content appears to voters

- Everything an owner writes sits in its own labelled box, dated, and never inside a record
  section. Record facts always come first.
- Under the profile header, 1 line: "Managed by {Title Name}" or "Managed by {Title Name}’s
  office".
- Beside every owner-written box, the existing line adapted: "Alethical verified this
  account’s authority to represent {Title Name}, not the accuracy of what it writes", with
  **Report this**.
- Owner content stays out of Grounded Ask answers and the search material Ask uses, exactly
  as campaign statements do ([grounded-answers.md](../../.claude/rules/grounded-answers.md)
  rules 1 and 4).
- Removal after a report only for: personal information about someone else, threats or
  harassment, unlawful content, advertising or spam, or text unrelated to the question. An
  admin never edits an owner's words; removal is all or nothing, with a private note.

## 9. Privacy

| What | Who sees it | Kept until |
| --- | --- | --- |
| The request, role, history, call notes | The applicant and admins | The applicant's account is deleted |
| The code | Nobody; stored as a hash | 24 hours after sending |
| Private survey answers, correction requests | Admins | The owner deletes them or the account is deleted |
| Public answers, introduction, vote explanations | Everyone | The owner removes them, gives up, is revoked, or the account is deleted |

The privacy policy page and
[user-data-retention-policy.md](user-data-retention-policy.md) gain these rows in the same
change that ships the feature.

## 10. Build outline

- Reuse the candidate claim services, history events, review list, email delivery records and
  editor. Add a profile kind so 1 list and 1 set of rules serve both.
- New pieces: the code record (account, profile, address used, code hash, sent, expires,
  wrong-entry count, confirmed); owner content for the introduction and vote explanations; the
  survey questions (fixed wording, version, public or private, answer type, limit) and answers
  (question version, owner, text or choices, dates, public state).
- Fix the official-address data first: store the Senate's `mailto:` addresses without the
  `mailto:` prefix, store mail-form links as "no published address" rather than as an email,
  and recheck Leigh Finke's House page.
- The roadmap card and the About Us line become true only when this ships.

## 11. Launch

1. Approve this spec.
2. Design draws the claim page states, the admin request page additions, the manage page with
   the survey, the public profile sections and the email text.
3. Build and release.
4. Invite members: 1 email to each published official address, saying what claiming offers
   and how. This is an outbound message to about 150 real people and needs its own go before
   it is sent.
