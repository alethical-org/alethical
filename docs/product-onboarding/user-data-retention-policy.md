<!-- describes: alethical/db/models.py, alethical/api/auth.py, alethical/api/routers/me.py, alethical/api/routers/contact.py, alethical/api/services/auth.py, alethical/api/services/contact.py, alethical/api/services/representative_lookup.py, alethical/logging.py, apps/frontend/src/screens/LegalScreens.tsx -->

# What we keep about readers, and for how long

**Net.** The bills are public. The people reading them are not. This says exactly what
Alethical stores about a reader, why each piece exists, how long we keep it, and what
happens when someone asks us to delete their account. It also says the thing that is not
true yet: there is no way for a reader to delete an account, so we do it by hand. The
published Privacy Policy was brought in line with this document on 14 August 2026 (§7).

**Why this doc exists.** Google sign-in went live on 5 August 2026. Before that, an
account was a thing we had designed but almost nobody had. Now real people have real
accounts with real data attached, and "we never wrote it down" stops being a small
omission. [`docs/philosophy.md`](../philosophy.md) principle 4 (_say only what we can
do_) applies to what we say about ourselves, not only to what we say about bills.

**What this is.** A decision record. It settles what the policy _is_, so the work it
implies can be scoped honestly. It is not a build spec and it ships no code.

**Where it sits.** In `product-onboarding/` rather than `operations/`, because
[`docs/folder-structure.md`](../folder-structure.md) says to pick the folder by the
question the doc answers. This answers _what does the product keep about the people who
read it, and what do we promise them_ — a product commitment, read by whoever builds
account deletion and whoever next edits the public Privacy Policy. It is not a runbook
for operating the service.

**Everything below was checked against the code and against production**, not written
from memory. The production numbers are a read-only census taken on 5 August 2026: row
counts only, no email address, no message text, no name.

---

## 1. What we actually have

Five accounts exist in production. One of them is a leftover test account
(`@example.com`, created through the local development sign-in path); four are real
people. The oldest account was created on 29 March 2026. The oldest typed question is
129 days old. Nothing we hold is old enough for any retention rule below to have expired
yet, which makes this the cheapest possible moment to adopt one.

**The work this document implies** is filed and on the board, so nothing here sits as a
recommendation with no owner:
[#1040](https://github.com/alethical-org/alethical/issues/1040) (build deletion) ·
[#1041](https://github.com/alethical-org/alethical/issues/1041) (fix the public Privacy
Policy, now done) · [#1042](https://github.com/alethical-org/alethical/issues/1042) (drop the nine
dead columns) · [#1043](https://github.com/alethical-org/alethical/issues/1043) (the
unwired "active" switch) ·
[#1045](https://github.com/alethical-org/alethical/issues/1045) (give the identity-link
timestamps honest names) · [#1046](https://github.com/alethical-org/alethical/issues/1046) (make production
logs readable, now built) · [#1047](https://github.com/alethical-org/alethical/issues/1047) (backup retention
and the leftover test account).

| What it is, in plain words                                                           | Where it lives            | Rows in production                               |
| ------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------ |
| An account — a name, and an email address once the sign-in service has confirmed one | `user_account`            | 5                                                |
| The link between that account and Google                                             | `auth_identity`           | 5 (4 Google, 1 test)                             |
| A saved home address                                                                 | `saved_place`             | **0**                                            |
| Bills someone chose to follow                                                        | `tracked_bill`            | 4                                                |
| Whether someone wants email alerts                                                   | `notification_preference` | 1                                                |
| A queued "this bill moved" alert                                                     | `notification_event`      | **0**                                            |
| A conversation about one bill                                                        | `chat_session`            | 37                                               |
| The messages in those conversations                                                  | `chat_message`            | 82, of which **41 are questions a reader typed** |

The two zeroes matter as much as the numbers. No reader has ever saved an address,
because nothing in the app can save one (§2.3). No alert has ever been queued, because
the job that queues them is not wired into anything yet (§2.5).

---

## 2. Every category, one at a time

### 2.1 The account itself

**What it holds.** A display name, a switch marked "active", the moment the account was
first created, the most recent time it gained a new sign-in method, the last time the
reader opened their tracked-bills page, and — only once the sign-in service has
confirmed it — an email address.

**Why "only once confirmed".** `user_account.primary_email` is the address one sign-in
method uses to find and join an account another sign-in method already made, so it is a
key, not a contact detail. Since [#1039](https://github.com/alethical-org/alethical/issues/1039)
nothing writes an unconfirmed address there, in either direction: an unconfirmed sign-in
cannot use it to reach an existing account, and cannot reserve it so that the person who
does own the address later joins _theirs_. Alethical reads confirmation from Supabase's
trusted user record, not from the sign-in token or a profile field the signed-in person can
edit ([#1466](https://github.com/alethical-org/alethical/issues/1466)). An account created
from an unconfirmed sign-in has no main email; the address that sign-in claimed sits on the
Google-link row (`auth_identity.email`) instead, where it is not a key and opens nothing.

**Where the name comes from.** Nobody types it. When someone signs in for the first
time we take the part of their email address before the `@` and use that as their
display name (`alethical/api/auth.py`). So a reader who has never given us a name still
has one on file, and it is a slice of their email address. That is worth knowing before
we ever show a display name to anyone but its owner.

**The "active" switch now works** ([#1043](https://github.com/alethical-org/alethical/issues/1043),
6 August 2026). It used to be the worst kind of dead code: `user_account.is_active`
existed, defaulted to on, and no code anywhere checked it, so it looked like a switch
that disables an account and was not one. Someone would have reached for it the first
time we had to lock somebody out and watched nothing happen.

Turning it off now shuts the account out of everything that is _theirs_ — their followed
bills, their conversations, their saved places — with a clear "this account has been
deactivated" rather than a vague "please sign in", so nobody signs in again wondering why
it did not work. The shut-out happens _before_ anything is written, so a locked account
cannot leave rows behind on its way out, and signing in a second way with the same email
address cannot be used to walk back in.

**It does not shut them out of the public record.** Bill pages and the rest of the
public archive still load for someone whose account is locked, exactly as they load for
someone who never signed in. Locking an account is about the account; the legislative
record is public, and making it unreadable to a person we locked out would be the
opposite of the point of this product.
Turning it off is still a database edit — there is no screen for it, and #1043
deliberately did not add one. The decision was to make the switch behave as labelled,
not to build a lockout console; who may flip it and where that gets recorded are
questions for [#1040](https://github.com/alethical-org/alethical/issues/1040), which
builds account deletion.

All 6 accounts in production are active, and none has ever been set inactive (checked
6 August 2026). That is 6, not the 5 in §1: the census there is dated 5 August 2026 and
is left as the snapshot it says it is, but one account has been added since, so read §1
as history rather than as today's numbers.

**The 2 identity-link timestamps now say what they record.**
`user_account.last_identity_linked_at` records when the account most recently gained a
sign-in identity, and `auth_identity.linked_at` records when that identity was attached.
Both are set in the same provisioning step and stay unchanged on ordinary sign-ins and
requests. Alethical does not record login events. [Issue
#991](https://github.com/alethical-org/alethical/issues/991) owns that work only if a
real screen, report, or security feature later needs it.

The rename kept every existing value exactly. That creates 1 known limit: values written
before [#990](https://github.com/alethical-org/alethical/pull/990) merged on 5 August 2026
may be the time of the last authenticated request under the old behaviour, not the true
time the identity was linked. The original link time cannot be reconstructed. No product
feature reads either field today, so old rows remain an explicitly limited historical
record rather than being cleared or presented as exact.

**Retention: as long as the account exists.** This row _is_ the account — everything else
a reader has hangs off it — so it lasts exactly as long as the account does. Note that an
account with no email address on it can still be signed into perfectly well: a repeat
sign-in is matched on the Google-link row, which never looks at the email.

### 2.2 The link to Google

**What it holds.** Which sign-in service was used, the permanent id that service gave
us for this person, their email address as that service reported it, when the identity
was linked, and when the address was confirmed. The pre-5 August 2026 limit on old link
dates is recorded in §2.1.

**Why it is a separate table from the account.** So we can change how people sign in
without rewriting the product. Today it is Google through Supabase; if that ever
changes, the swap happens in this one table and `tracked_bill`, `chat_session` and
everything else keep pointing at the same account. That separation is not decoration —
it is what makes the deletion rules in §6 tractable, because "unlink this person from
Google" and "delete what this person did" are two different operations on two different
tables.

**Retention: as long as the account exists.** Delete the row and the person can still
sign in with Google; they just get a brand-new empty account and their old one is
orphaned forever. So this row lives and dies with the account, never separately.

### 2.3 A saved home address — designed, never built

**What the table can hold.** A label ("Home"), the address as typed, a city, a state, a
postal code, a latitude and longitude, and which House and Senate district the address
falls in.

**What is actually reachable.** The API can create and edit a saved place with a label,
address, city and state (`alethical/api/routers/me.py`). It has never once been able to
store the postal code, the coordinates, or the districts — those five columns have no
write path at all. And the app has no button that calls the create endpoint; the Account
screen only reads the list. So the whole feature is a read path over an empty table.
**Zero saved places exist in production, and zero ever have.**

**Retention: not applicable, because we hold none.** If the feature ships, an address is
the most sensitive thing we would ever store, and the rule should be written before the
first row is written, not after. The proposal is in §5.

**The five unreachable columns should be dropped, not given a retention rule** ([#1042](https://github.com/alethical-org/alethical/issues/1042)). The
best retention policy for a home address we cannot save is to not have a column for it.

### 2.4 Bills someone chose to follow

**What it holds.** Which account, which bill, whether they want alerts, and a free-text
note.

**The note is the sharp edge.** Everything else here is a choice from a public list. The
note is a box a person can type anything into, attached to a named bill, and it is the
one thing in this category that is not simply "a public record, selected." Nothing in
the app currently offers a note field, and no note exists in production, but the API
accepts one.

**Retention: as long as the account exists.** Deleting someone's followed bills while
their account lives would break the feature they signed in for. Notes inherit the
treatment of typed text in §5.

### 2.5 Whether someone wants alerts

**What it holds.** A channel (email or push), a frequency (immediately, daily, weekly,
or off), and an on/off switch. One row exists in production.

**Retention: as long as the account exists.** It is a setting. Losing it means silently
changing what someone asked for.

### 2.6 Queued alerts

**What it holds.** A record that a bill someone follows changed status, with the old and
new status and whether it was sent.

**Nothing generates these.** The function that writes them
(`alethical/api/services/notifications.py`) is not called from anywhere outside its own
tests, and the job that would email them does not exist
([#36](https://github.com/alethical-org/alethical/issues/36)). Zero rows in production.

**Retention when they start being written: 90 days after sending.** An alert is a
delivery receipt. Once it is sent, the only thing it is good for is answering "did you
email me about this?" — and three months is longer than anyone asks. Unsent rows stay
until sent or until the account is deleted.

### 2.7 Conversations about a bill

**What it holds.** A conversation is a `chat_session` with a title, the bill it is
about, and a running list of `chat_message` rows. Each message has a role (reader or
assistant) and its full text. The assistant's messages also carry the passages they
cited.

**The title is generated, not typed.** All 37 titles in production read
`"HF 1234 analysis"` — the bill's identifier plus one word. The screen that built them
that way was the pre-redesign bill page, deleted as unreachable in
[#1067](https://github.com/alethical-org/alethical/issues/1067); no shipped surface
starts a bill conversation today, so no new titles are being written. `ChatSessionScreen`
still takes a title from its route params, but nothing reachable navigates to it. A
title is safe to show; a message is not.

**Three columns here are dead.** `chat_session.retrieval_profile` is empty on all 37
rows and read by nothing. `chat_message.model_name`, `input_tokens` and `output_tokens`
are set on none of the 82 rows and read by nothing. See §8 and [#1042](https://github.com/alethical-org/alethical/issues/1042).

**41 messages in production are text a reader typed.** This is the most sensitive thing
we hold, and §5 is about it.

### 2.8 A Contact us message

**What it holds.** The name and phone number a person chooses to provide, their email
address, subject, and full message.

**Where it goes.** Resend receives the fields to deliver 1 copy to Alethical's Google
Workspace inbox and 1 copy to the sender. The Alethical app does not write the form into
its database or logs. Resend and Google Workspace keep their delivery and mailbox copies
under their own service terms; deleting an Alethical account does not delete those emails.

**Retention.** The Alethical inbox copy stays only as long as it is needed to answer and
keep the support record. The sender controls their copy. Resend's
[privacy policy](https://resend.com/legal/privacy-policy) says it keeps personal data only
as long as needed for its service and legal duties; its current plan terms, not this code,
control the provider copy.

---

## 3. Given, generated, or just written down

The issue behind this doc asked for this distinction, and it turns out to be the most
useful cut through the whole list — because it predicts how a reader will feel about
each item without them having to be asked.

**Given deliberately.** Bills someone chose to follow. Their alert settings. A note on a
bill. A saved address, if the feature ever ships. The reader performed an act meant to
be remembered, and would be annoyed if we forgot.

**Volunteered without being asked for.** Every question typed into a bill conversation.
Nobody set out to tell us something about themselves; they set out to understand a bill.
What they reveal on the way there is a side effect of the question, and they will not
remember having disclosed it. The reader's expectation and the record diverge here more
than anywhere else, which is exactly why §5 treats it separately.

**Handed over by Google, not by the reader.** Their email address and the permanent id
Google uses for them. The reader consented to the sign-in, not to a specific field
list.

**Neither given nor volunteered — we just wrote it down.** The display name we
manufactured from their email address. The timestamps. The queued alerts. Nobody chose
any of it, nobody knows it exists, and nobody would miss it. This is the category where
"do we need this at all?" is the right first question, and where §8's answer is usually
no.

---

## 4. What leaves our systems

Three kinds of reader data travel to third parties. Only one of the three is named in
the published Privacy Policy.

| Who gets it                                 | What they get                                                           | When                                                                                                 | Named in our Privacy Policy? |
| ------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| Google (through Supabase)                   | Name, email address, profile picture, a sign-in id                      | Every sign-in                                                                                        | Yes                          |
| Supabase                                    | The same, plus it hosts the whole database                              | Always                                                                                               | Yes                          |
| **OpenAI**                                  | **A reader-written question, word for word; or public suggestion text** | Every reader-written Ask and chat message when configured; the first uncached public suggestion only | **Yes**                      |
| **Anthropic**                               | **A reader-written question, word for word; or public suggestion text** | Every reader-written Ask and chat message when configured; the first uncached public suggestion only | **Yes**                      |
| **US Census Bureau**                        | **The full street address, with surrounding spaces removed**            | Every Find My Legislator address search                                                              | **Yes**                      |
| **Minnesota Geospatial Information Office** | **The house number and street-name prefix, without city or ZIP**        | While suggestions are open; also after Census retries find no match                                  | **Yes**                      |
| Vercel                                      | Hosts the web app, so its request logs see every page address (§7)      | Every page load                                                                                      | Yes                          |
| Cloudflare                                  | Sits in front of the API                                                | Every API call                                                                                       | Yes                          |
| Railway                                     | Runs the API and captures its log stream (§7)                           | Every API call                                                                                       | Yes                          |
| Resend                                      | Contact name, email, phone, subject, and message                        | Every Contact us send                                                                                | Yes                          |
| Google Workspace                            | Alethical's delivered copy of the same contact message                  | Every Contact us send                                                                                | Yes, through the Resend line |

**The good half.** No account identifier ever reaches a model. The prompt we send is
built from the bill's identifier, the reader's question, and passages of bill text
(`synthesize_grounded_answer`, `alethical/api/routers/me.py`). There is no user id, no
email address, no name, and no address in it. The address that goes to the Census
Bureau carries no account identifier either. If Census finds nothing, the Minnesota
address-point request carries only the house number and street-name prefix, not the city
or ZIP. That request can begin after 2 street-name characters while suggestions are open.
After either address source returns a point, the House, Senate, and congressional
districts are found from official map files stored inside Alethical. The point is not
sent to the Minnesota Legislative Coordinating Commission.
The lookup endpoint does not require sign-in and never reads the caller's account.

**The bad half.** A reader's typed question leaves our systems on every single Ask and
every chat message. The Privacy Policy names every recipient in the table above, including
the hosting layers, as of 14 August 2026
([#1041](https://github.com/alethical-org/alethical/issues/1041)). Naming them does not
make the question stop travelling; it makes the reader able to see that it does.

---

## 5. The hard one: typed questions

**The judgment call.** _Treat text a reader typed as a strictly more sensitive class
than choices a reader made, give it a life of its own that does not depend on the
account, and never let a copy of it outlive the original._

**Why they are not the same thing.** A followed bill is a selection from a public list.
Its worst-case disclosure is "this person is interested in HF 1234" — close to ordinary
civic interest, and precisely the thing the product exists to help with. A typed
question is unbounded free text that the reader controls completely, and people
routinely put things in it that no list could contain. _"Does the new cannabis law
affect my probation?"_ is a sentence about the person, not about the bill. We did not
ask for it, we cannot predict it, and the reader will not remember telling us. Averaging
the two categories into one rule protects the harmless one and under-protects the
dangerous one.

**So, three rules for typed text:**

1. **A conversation expires 24 months after its last message**, whether or not the
   account is still active. The thread is the unit, not the message — deleting half a
   conversation leaves an unreadable remainder. 24 months is not an arbitrary round
   number: the Minnesota Legislature runs on a two-year biennium, our corpus is
   organised by biennium, and a question about a bill is only meaningful while that
   biennium's record is the live one. A reader following a bill through a full session
   keeps their thread; a reader coming back after the bills have all died gets a clean
   slate. **What would change it:** if we ever ship a way to search or export your own
   conversation history, the value of an old thread goes up and 24 months should be
   revisited. Nothing in production is close to this yet — the oldest message is 129
   days old.

2. **A reader can delete a conversation without deleting their account.** Someone who
   realises they typed something they would rather we did not have should not have to
   choose between that sentence and their followed bills. Today they cannot do either
   (§7); when we build deletion, this is the smaller, easier, and more urgent half.

3. **A typed message may never be copied into anything that outlives it.** No log line,
   no diagnostic receipt, no analytics event, no evaluation fixture, no error report. If
   we cannot delete every copy when the 24 months run out, the retention rule is
   decorative. This is the constraint the issue asked us to place on per-answer receipts:
   **a receipt may record which passages were retrieved, which model answered, and how
   long it took — and may not record the question, the answer, or anything that
   identifies who asked.** A receipt that carries the question is a second, undeletable
   copy of the most sensitive thing we hold, sitting in the system least likely to be
   swept.

**Public suggestions are not typed questions.** Alethical writes each bill's
`question_prompts` and shows them as buttons. An exact, unedited match may therefore reuse
a public saved answer ([#1119](https://github.com/alethical-org/alethical/issues/1119)).
The saved row contains the answer, public citations, and fingerprints of public system
inputs. Its answer-pipeline fingerprint changes with the prompt, cleaning, chunking,
retrieval, coverage, answer assembly, guards, and citation rules that shape the answer
([#1140](https://github.com/alethical-org/alethical/issues/1140)). It has no
question-text field and never hashes request text. Editing even one word sends the request
through the ordinary reader-written path and saves no cache row.

**What we are deliberately not doing.** We are not shortening this to a few weeks. A
reader following a bill needs to come back to their own thread months later, and a
policy that quietly destroys the thing someone signed in for is a bad policy dressed as
a cautious one. The protection comes from rules 2 and 3, not from making the number
small.

---

## 6. What deletion should mean

None of this exists yet (§7). This is the specification for when it is built.

**"Delete my account" should mean:**

| Category                        | What happens | Why                                                                  |
| ------------------------------- | ------------ | -------------------------------------------------------------------- |
| The account row                 | Deleted      | It is the thing being deleted                                        |
| The Google link                 | Deleted      | Leaving it orphans the person's future sign-in                       |
| Saved addresses                 | Deleted      | No reason survives the account                                       |
| Followed bills                  | Deleted      | A private choice tied to a named person                              |
| Notes on bills                  | Deleted      | Typed text (§5)                                                      |
| Alert settings                  | Deleted      | Meaningless without an account                                       |
| Sent alerts                     | Deleted      | A delivery receipt for an address we no longer hold                  |
| Conversations and every message | Deleted      | Typed text (§5) — this is the one that most needs to actually happen |

**What we would keep, and it is a short list.** Counts with nobody attached: how many
accounts exist, how many bills are followed, how many questions were asked in a month.
These are already computable without names and are what tells us whether the product
works. Nothing in that list can be turned back into a person.

**What we would not keep, and this needs saying explicitly.** No "deleted user" shadow
row. No email address retained to stop the same person signing up again. No archived
copy of a conversation "for quality." Every one of those is a normal-sounding
engineering decision that turns a deletion into a move.

**Two honest limits, stated rather than glossed:**

- **Backups.** Supabase takes automatic database backups. A deleted row stays inside
  them until they roll off. This is unavoidable for any hosted database and is not a
  reason to soften the promise, but the promise should be worded as "we delete it, and
  it ages out of our backups on the backup schedule" rather than implying instant
  erasure everywhere. **The exact backup retention on our Supabase plan is not recorded
  anywhere in this repo ([#1047](https://github.com/alethical-org/alethical/issues/1047)) and should be confirmed and written into
  [`docs/operations/repo-and-service-settings.md`](../operations/repo-and-service-settings.md)** —
  it is a setting that controls the product and does not live in the code, which is
  exactly what that doc is for.
- **Third parties.** OpenAI and Anthropic received the reader's questions and we cannot
  reach into their systems to delete them. What we can do is say so, and rely on their
  own retention terms. This is another reason §5 rule 3 matters: the fewer copies we
  make, the smaller the gap between what we promise and what we control.

---

## 7. What is not true today

Written in the present tense, because pretending otherwise is the exact failure
[`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) rule 6
exists to prevent, and that rule binds our own documents as much as our product copy.

**There is no way to delete an account.** No endpoint, no button, no script, no runbook.
The API can delete a followed bill and a saved place; that is all
(`alethical/api/routers/me.py`). Deleting a conversation is not possible. Deleting an
account is not possible. If someone emails `ask@alethical.com` today and asks us to
delete their data, honouring it means someone hand-writing SQL against production with
nothing to check their work against. **Everything in §6 above is a proposal, not a
description.** Building it is [#1040](https://github.com/alethical-org/alethical/issues/1040).

**The published Privacy Policy now matches this document** (`apps/frontend/src/screens/LegalScreens.tsx`,
effective and updated 14 August 2026, [#1041](https://github.com/alethical-org/alethical/issues/1041)).
_Information We Collect_ lists every category in §2 that a reader can actually reach: the
manufactured display name, followed bills and their notes, the alert switch, messages typed
into a bill conversation, and Ask questions. Under _How We Share Information_ it names
Supabase, Google, OpenAI, Anthropic, the US Census Bureau, the Minnesota Geospatial
Information Office, Resend, and now Vercel, Cloudflare, and Railway (§4). It no longer names
the Minnesota Legislative Coordinating Commission because the commission no longer receives a
reader's location during a lookup; the map itself still credits the commission as its source.
_Data Retention_ carries the per-category periods from §9 rather than one blanket sentence,
and _Your Rights_ says plainly that deletion and export are done by hand because no button
exists.

**Two deliberate omissions from the page, both for the same reason: it may only describe
what a reader can reach.** A saved home address is not mentioned, because nothing in the app
can save one (§2.3) — the page would be describing a feature that does not exist. No
analytics tool is mentioned, because none is installed; the tool and its disclosure ship
together or not at all.

**The page does not claim an automatic sweeper, because there is none.** §9's periods are
stated on the page as limits we keep to. Nothing enforces the 24-month conversation limit or
the 90-day sent-alert limit in code, and nothing has reached either yet — the oldest message
was 129 days old on 5 August 2026, and no alert has ever been sent (§2.6). Enforcing them
falls out of [#1040](https://github.com/alethical-org/alethical/issues/1040), which builds
the deletion path they would run on.

**Server-side logs are readable in Railway.** The API keeps its rotating local file and,
when Railway's own environment marker is present, also writes to the log stream Railway
captures (`alethical/logging.py`). It records request paths and operational failures so a
production problem can be diagnosed before the container is replaced. The exact time
Railway keeps those lines is controlled by the current Railway plan and is not recorded
in this repository.

The formatter removes email addresses and web-address query values from every rendered
line. Contact delivery records only a random request number, setting-presence and
key-shape facts, an error type, a provider status and documented error name, an incomplete
reply's item count, and whether both copies were accepted. Key-shape facts are the key's
length and true-or-false checks for its public prefix, quote marks, whitespace, and normal
printable characters. It never records the form fields, provider error sentence, key, or
any part of the key. This closes [#1046](https://github.com/alethical-org/alethical/issues/1046)
without changing the redaction rule:

> **Log redaction rule.** Server logs may record a request's method, path, status,
> duration, and the account's internal id. They may never record an email address, a
> display name, an address as typed, latitude or longitude, a message's text, or an Ask
> question. Any new logging, error-reporting, or monitoring integration is checked
> against this list before it is switched on.

The account's internal id is deliberately allowed: it is a random identifier that means
nothing outside our own database, it is what makes a bug report actionable, and it
disappears when the account is deleted. The formatter is a final safety net, not
permission for new code to log a request body, address, location, or question.

**Reader questions travel in the page address, by design.** `/ask?q=<the question>` puts typed text
into a shareable URL. An old `/chat/new?prompt=<the question>` address now redirects Home, but its
question can remain in browser history and in the host's redirect request log. The cost is that a
question in either address can reach browser history, the referrer sent to a later link, and the web
host's request logs. The API itself is clean: every API path that carries a question is a POST with
the text in the body, so nothing in front of the API ever sees it in an API URL.
**The tension is real and the shareable link wins**, but the consequence should be named
in the Privacy Policy rather than discovered.

**No analytics of any kind are installed.** No Google Analytics, no PostHog, no Vercel
Analytics, nothing. There is no analytics retention question to answer because there is
no analytics. Worth recording, because the next person to add a product-metrics tool
needs to know they are the first, and that §5 rule 3 applies to them.

---

## 8. Things nothing reads — drop them, do not write rules for them

The best retention policy for data we never use is not collecting it. Each of these was
confirmed by searching the whole repository for a reader and by counting the rows in
production.

**Recommended for removal**, as [#1042](https://github.com/alethical-org/alethical/issues/1042). Filed rather than done here, because dropping a column
here has a real procedure to follow first — four production checks and one trap where a
`NOT NULL` column breaks the running code before the migration lands. Nothing is dropped
in the change that adds this document.

| Column                           | Written by              | Read by               | Production      |
| -------------------------------- | ----------------------- | --------------------- | --------------- |
| `saved_place.postal_code`        | nothing                 | nothing               | 0 rows          |
| `saved_place.latitude`           | nothing                 | nothing               | 0 rows          |
| `saved_place.longitude`          | nothing                 | nothing               | 0 rows          |
| `saved_place.house_district_id`  | sample-data script only | one validation script | 0 rows          |
| `saved_place.senate_district_id` | sample-data script only | one validation script | 0 rows          |
| `chat_session.retrieval_profile` | nothing                 | nothing               | empty on all 37 |
| `chat_message.model_name`        | nothing                 | nothing               | unset on all 82 |
| `chat_message.input_tokens`      | nothing                 | nothing               | unset on all 82 |
| `chat_message.output_tokens`     | nothing                 | nothing               | unset on all 82 |

**`user_account.is_active` was on this list and has been fixed rather than dropped**
([#1043](https://github.com/alethical-org/alethical/issues/1043), 6 August 2026). It is
now read on every authenticated request, so it locks the account it claimed to lock. See
§2.1.

**Deliberately kept even though nothing reads them.**
`user_account.last_identity_linked_at`, `auth_identity.linked_at`, and
`auth_identity.email_verified_at`. Unlike a latitude we could recompute from a live
lookup, a timestamp cannot be reconstructed after the fact — once you did not write it
down, it is gone. Their honest future readers are an account's sign-in-method history,
an abuse investigation, and proof that an address was confirmed. They keep the
account's retention period. They do not answer when someone last signed in; [issue
#991](https://github.com/alethical-org/alethical/issues/991) owns a separate login-event
write path if a real product need appears.

---

## 9. Retention, all in one place

| What                                                 | How long                                                                               | Why that long                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Account, name, and a confirmed email if there is one | Life of the account                                                                    | It is the account                                                                                         |
| Google link                                          | Life of the account                                                                    | Removing it orphans the person                                                                            |
| Followed bills, alert settings                       | Life of the account                                                                    | The feature they signed in for                                                                            |
| Saved address (if ever built)                        | Life of the account, deletable on its own                                              | Most sensitive thing we would hold; the reader should be able to remove it without losing everything else |
| Notes on bills                                       | Typed text — §5 rules apply                                                            | A free-text box is a free-text box                                                                        |
| Sent alerts                                          | 90 days after sending                                                                  | A delivery receipt nobody asks about after three months                                                   |
| Unsent alerts                                        | Until sent, or account deletion                                                        | They are pending work                                                                                     |
| Conversations and messages                           | **24 months from the last message**, then deleted whether or not the account is active | Matches the two-year biennium the record is organised by                                                  |
| Contact us message                                   | No Alethical database copy; inbox and provider copies follow §2.8                      | The message exists only to answer the person and keep the support record                                  |
| Server logs                                          | Whatever the host keeps; no reader data in them at all (§7 rule)                       | Redaction beats retention — the cheapest data to keep safe is data you never wrote                        |
| Anonymous counts                                     | Indefinitely                                                                           | Nothing in them points at a person                                                                        |

---

## 10. What this constrains

- **Per-answer receipts.** May carry which passages were retrieved, which model
  answered, and timings. May not carry the question, the answer, or anything
  identifying. §5 rule 3.
- **Any new logging or error reporting.** Checked against the redaction rule in §7
  before it is switched on.
- **Any new column on a user table.** Comes with an answer to "what reads this?" at the
  moment it is added. §8 is what happens when that question goes unasked for a year.
- **The public Privacy Policy.** It is the version of this document that readers actually
  see, and since 14 August 2026 the two agree (§7). Any change to what we collect, who
  receives it, or how long we keep it updates both in the same change, or they drift apart
  again.

---

## Related

- [`docs/philosophy.md`](../philosophy.md) — principle 4, _say only what we can do_
- [`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) — rule 6
  (copy matches shipped capability) and rule 5 (shareable URLs), both of which this doc
  answers to
- [`docs/architecture/db-schema-system-design.md`](../architecture/db-schema-system-design.md)
  — the table groups these columns sit in
- [`docs/operations/repo-and-service-settings.md`](../operations/repo-and-service-settings.md)
  — where the Supabase backup retention setting should be recorded
- [Issue #803](https://github.com/alethical-org/alethical/issues/803) — the issue this
  document answers
