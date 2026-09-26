# Reader comments on editorial pieces

<!-- describes: apps/frontend/src/components/comments/**, apps/frontend/src/data/comments.ts, apps/frontend/src/screens/redesign/CommentEmailsScreen.tsx, alethical/api/routers/comments.py, alethical/api/services/comments.py, alethical/api/services/comment_email.py -->

Eugene approved this feature on 26 September 2026, including implementation through
release in [issue 2399](https://github.com/alethical-org/alethical/issues/2399).
This guide records the approved product behavior. Release progress lives in
[editorial-comments-build-plan.md](../operations/editorial-comments-build-plan.md).

## Where readers can comment

Every individual published Guide, Research piece, Short post, article and blog post
has comments by default, including future editorial sections under `/read`.
The article, its sources and correction notices stay above the comments.
The `/read` page, section and topic lists, campaign-finance results, money pages,
bills, legislators and similar factual pages have no comments, comment counts or
comment requests. Reader text never enters Alethical answers, reports or exports.

Each published piece has a permanent `articleId`. Its address and title can change
without moving its discussion. The frontend publication registry generates the
server's eligibility file with `pnpm --dir apps/frontend comments:registry`.
A focused test compares the generated file with every published registry entry.
The server accepts only these identities and owns article links in email.

## Identity and sign-in

Anyone can read. A confirmed signed-in account is required to post or reply.
`Sign in to comment` and `Sign in to reply` use the existing sign-in flow and return
to the same article and intended writing box.

Each account chooses 1 public name in 1 field. It starts empty and never uses the
account email or its automatically generated display name. Any nonblank name is
accepted, including a single initial. There is no uniqueness or legal-name check.
The helper reads `This name appears on your comments and replies`.

`Change name` edits the name inline with `Save name` and `Cancel`. The helper reads
`Changing your public name updates your comments and replies`. Past contributions
use the new name everywhere. A name change sends no email and does not add an edited
date. A name never confers staff status or admin rights. Staff contributions have
the same appearance and publish immediately.

## Discussion layout and writing

The heading is `Reader comments`. Its only notice is
`Names are chosen by readers and are not verified`.

Desktop has the conversation and form beside a rules card. Below 1100 pixels the
rules appear above the form; below 768 pixels buttons stack and replies use a
smaller inset. All controls have targets at least 44 pixels high. The form, errors,
and busy buttons preserve their space. Keyboard focus is visible without adding
keyboard-only outlines to ordinary clicks. Text fields retain typing focus.

Comments and replies publish immediately. Text is plain, with line breaks and a
2,000 Unicode-character limit. Addresses wrap but do not become links. The field
keeps over-limit text and explains the limit rather than cutting the text.
The actions are `Post comment`, `Post reply`, `Save changes` and `Cancel`.

Top-level conversations appear oldest first, with replies oldest first in each
conversation. Replies have 1 indentation level. A reply to another reply stays in
the same conversation and identifies its exact target with `Replying to {public_name}`.
Opening another reply box preserves the earlier unsent draft; Cancel discards it.

Each request returns 10 root conversations and their replies. `Load more` keeps
existing content visible. A newly posted comment appears after the Load more control
if earlier conversations are not loaded, and appears only once as paging catches up.
An emailed link can load and focus its conversation without loading every earlier
page. First-load failure is distinct from `No comments yet`.

Owners can edit at any time. An edit keeps the original order. Items show dates
only: `Posted Sep 26, 2026` or `Posted Sep 26, 2026 · Edited Sep 27, 2026`.
The latest edit date remains visible even when it is the same as the posted date.

## Deleting and removing

Owners can delete their own comments and replies after confirmation. Approved admins
can remove any contribution after confirmation, including staff contributions.
Admins cannot rewrite someone else's text. There is no reason field or removal email.

Deleting or removing erases the contribution's name and text. If another contribution
depends on it, `Comment deleted` or `Comment removed` stays in its place while the
other replies remain. Otherwise the item disappears. An empty placeholder disappears
once nothing depends on it. Reply-target names are omitted when the target is gone.

Admin authority comes from the existing trusted server checks, including both a
configured Supabase account ID and its fresh confirmed approved email. The approved
addition is `ask@alethical.com`; deployment must activate its confirmed account ID.
Only `ask@alethical.com` receives admin comment alerts. Other approved admins keep
removal rights without receiving operational alerts.

On 26 September 2026 the existing confirmed, configured admins are
`alethicaldev@gmail.com`, `angel@alethical.com`, `angelzierden@gmail.com` and
`eug@alethical.com`. Approved email names without a confirmed account and configured
identifier do not yet have access. `ask@alethical.com` still needs that account before
its removal rights can be activated; this does not prevent sending alerts to it.

## Discussion rules

Introduction: Questions, corrections, personal experiences and disagreement are welcome. Link to a source for factual claims.

1. No threats, harassment or slurs
2. Do not share private information about anyone
3. Do not impersonate anyone, including in your public name
4. No spam or advertising
5. Do not present as fact a claim that clearly contradicts the source you link. Accusations of wrongdoing against identifiable people need a linked source that directly supports them.

There is no agreement checkbox. Related topics are allowed. Admins act directly on
published contributions; the feature has no reporting, approval queue, ranking,
reactions, pausing controls or separate moderation dashboard.

## Email choices

Signed-in readers have 2 independent choices beside the comment form:

- `Email me when someone replies to me`: account-wide, initially on, new direct replies only.
- `Email me about all new or edited comments and replies on this article`: initially off for each article; readers can select it without commenting.

Article updates include every new or edited contribution except the recipient's own.
Edits trigger reader mail only through article updates. Names, deletions and removals
send no alerts. When a new reply qualifies for both preferences, the reader gets
1 direct-reply message with both stop links. If direct-reply mail is off but article
updates are on, the reply arrives as an article update.

Email choices save independently from posting. A failed save restores the saved
choice and shows `Couldn’t save your email choices. Try again.` Both settings can be
turned back on beside the form. These settings do not affect newsletters or account
security messages.

Every alert is from `Alethical <ask@alethical.com>` with reply-to `ask@alethical.com`.
Reader messages go to the confirmed account email. Admin messages go only to
`ask@alethical.com`. Replying to an email goes to that mailbox, not the discussion.
Messages carry a direct contribution link, never the comment text. Subjects have no
`[Alethical]` prefix. Admin alerts have no stop links.

### Exact message copy

Direct reply subject: `{public_name} replied to your comment on Alethical`

```text
Article: {article_title}

View reply:
{direct_link_to_reply}

Stop reply emails:
{stop_reply_emails_link}
```

When the reader also follows the article, append:

```text
You also receive new or edited comments and replies on this article.

Stop updates for this article:
{stop_article_updates_link}
```

| Article update | Subject | Opening line | Link label |
| --- | --- | --- | --- |
| New comment | New comment on “{article_title}” on Alethical | {public_name} commented. | View comment: |
| New reply | New reply on “{article_title}” on Alethical | {public_name} replied to {recipient_public_name}. | View reply: |
| Edited comment | Comment edited on “{article_title}” on Alethical | {public_name} edited their comment. | View comment: |
| Edited reply | Reply edited on “{article_title}” on Alethical | {public_name} edited their reply. | View reply: |

Each article-update opening line is followed by a blank line, its link label, the
direct contribution link, and this footer:

```text
You chose to receive new or edited comments and replies on this article.

Stop updates for this article:
{stop_article_updates_link}
```

| Admin event | Subject | Entire body |
| --- | --- | --- |
| New comment | New comment on “{article_title}” | View comment: followed by the direct link on the next line |
| New reply | New reply on “{article_title}” | View reply: followed by the direct link on the next line |
| Edited comment | Comment edited on “{article_title}” | View comment: followed by the direct link on the next line |
| Edited reply | Reply edited on “{article_title}” | View reply: followed by the direct link on the next line |

## Stopping emails

Private links open `/comment-emails` without sign-in. An opaque token in the browser
fragment authorizes stopping only; it does not expose an email address or account ID.
Opening the link or inspecting its status changes nothing. Readers explicitly press
`Stop reply emails` or `Stop updates for this article`.

The wordmark-only screen shows `Comment emails`, a linked article title, and a button
for each currently enabled choice. The emailed choice comes first. The stopped heading
becomes `Reply emails stopped` or `Updates for this article stopped`, and the other
choice is described truthfully:

- `You still receive updates for this article, including replies to you`
- `You still receive emails when someone replies to you`
- `You don’t receive updates for this article`
- `You don’t receive reply emails`

The remaining enabled choice keeps its stop button. The article link remains, as does
`You can turn these emails back on beside the comments after signing in` after a stop.
Repeated stops are safe. An already-stopped link opens on its stopped heading.

## Recovery, privacy and delivery

Writes carry a stable request key, account identity, article and version. A duplicate
retry cannot publish twice, and an older response cannot overwrite a new account,
article, edit or email choice. Failed posts and edits retain drafts. An uncertain
post/edit shows `Check submission`; its check is bounded and safely reuses the
original request identity. A success clears a draft only if it still matches the
submitted text. Changing accounts clears private drafts and open controls.

If a reply target or a comment being edited is removed elsewhere, keep the draft
visible in its existing composer treatment and disable the impossible submission.
Show `The comment you were replying to is no longer available. Your draft is kept here.`
for a reply, or `This comment is no longer available. Your draft is kept here.` for
an edit; use `reply` in place of `comment` when the target is itself a reply.
Cancel discards that draft and returns focus to the comments heading when the
original action is gone. Ordinary version conflicts retain a working retry.
An invalid stop link uses the existing `This email link could not be opened` view,
including when it becomes invalid after opening. Only temporary failures offer retry.

Comment changes and pending email deliveries commit together. A bounded server
worker drains saved deliveries independently from requests and retries after failure
or restart. Provider idempotency keys remain stable across uncertain attempts.
Recipient eligibility and preferences are checked before delivery. No test sends
reach real users. Stop-link and account-specific responses are private and not cached,
indexed or included in site metrics. Tokens do not enter request URLs or logs.

Production comment delivery requires `ALETHICAL_COMMENT_EMAIL_ENABLED=true` plus
the existing `ALETHICAL_EMAIL_ENABLED=true`, `ALETHICAL_EMAIL_TRANSPORT=resend` and
`RESEND_API_KEY`. A configured `ALETHICAL_EMAIL_ALLOWLIST` also applies. Disabled
delivery leaves requests usable and retains pending messages for a later drain.
Uncertain sends retry the identical provider request for at most 23 hours, within
Resend's 24-hour duplicate-protection window. Terminal delivery records erase the
private message payload. Pending or failed delivery never blocks discussion writes.

For safe browser checks, run `uv run python scripts/comments_local_qa.py` and start
the web app on port 19261 with `EXPO_PUBLIC_API_URL=http://127.0.0.1:18261`,
`EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:8991` and
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa-public-placeholder`. The helper creates and
removes its own temporary PostgreSQL server, accepts only 3 fictional accounts and
disables email. Run `E2E_BASE_URL=http://127.0.0.1:19261 pnpm --dir apps/frontend exec
playwright test e2e/editorial-comments.spec.ts --project chromium`. The writing suite
skips every other address and blocks outside network requests.

## Interface punctuation

A standalone 1-sentence helper, notice, status, error or rule omits the final period,
including wrapped lines. Units with 2 or more sentences retain their periods.
Question marks, ellipses, addresses, reader text and email prose remain unchanged.
