<!-- describes: alethical/api/routers/admin.py, alethical/api/services/admin_accounts.py, alethical/api/services/account_classification.py, apps/frontend/src/screens/redesign/AdminUsersScreen.tsx, apps/frontend/src/hooks/useAdminAccess.ts, apps/frontend/src/lib/adminUsers.ts -->

# How private account visibility works

The `/admin/users` page lets approved administrators see current reader accounts.
It shows each email address, signup time, confirmation time or pending status, and
the available sign-in methods. It cannot change an account or send an alert.

## Opening `/admin/users`

Sign in, open the account menu, and choose **Admin**. This works in the desktop
menu and the phone account sheet. The entry appears only after the server grants
access. Opening `/admin` also leads to `/admin/users`. An administrator may open
`/admin/users` directly or reload it.

Only these 4 confirmed accounts have administrator access:

- `angelzierden@gmail.com`
- `angel@alethical.com`
- `eug@alethical.com`
- `alethicaldev@gmail.com`

The server checks the signed account identifier, the current confirmed email,
and whether the account is still active. An email alias, editable profile field,
or a hidden menu entry cannot grant access.

## Finding an account

The newest signups appear first, 25 per page. **Previous** and **Next** move through
the results. Search accepts a complete email or part of an email and ignores
capitalization. Press **Search** or Enter to apply it.

**Status** selects all, confirmed, or pending accounts. **Signup date** selects
any date or accounts created in the last 7 or 30 days. These filters apply together.
**Clear filters** returns to the complete included list. **Refresh** reads current
records again. The source line states when those records were read.

The summary shows confirmed current accounts, first confirmations today, and first
confirmations in the last 7 and 30 days. The pending total appears beside Status.
Summary figures always cover every included current account, regardless of search
or filters. Today starts at midnight in Minnesota. All displayed dates use
Minnesota time. The 7- and 30-day figures are rolling periods.

## Accounts that never appear

Team and test accounts are removed before search, totals, sorting, and pagination.
There is no control to include them. Exclusion covers the 4 administrator emails,
the previously excluded team emails `afnetter@gmail.com` and
`joseph.fleishman@gmail.com`, and configured team/test account identifiers.

Same-mailbox aliases are excluded too: plus suffixes for known team addresses and
Gmail's dot and `googlemail.com` variants. Reserved fixture domains `example.com`,
`example.org`, `example.net`, and `test.invalid` are excluded. Other test accounts
must have their stable identifier added to the server's test exclusion setting;
words such as “test” inside an ordinary reader's email do not prove a test account.

If any identity belongs to the team, its entire linked Alethical account is
excluded. These exclusion rules never grant administrator access.

## What the dates and totals mean

Supabase's current sign-in records supply signup and email-confirmation dates.
Alethical's first database visit is not substituted for signup. Multiple sign-in
identities already linked to 1 Alethical account appear once, with the earliest
signup, earliest confirmation, and combined sign-in methods. Different independent
accounts are not merged merely because their email addresses look alike.

Deleted, anonymous, banned, and deactivated accounts are omitted. These are current
account figures, not a history of every account ever created. Deletion can reduce
the figures. This feature stores no new account history or individual activity.

## Loading, access, and errors

A signed-out visitor sees an invitation to sign in. A signed-in person without
permission sees restricted access. Loading shows progress text. A failed read
offers **Retry**, rather than inventing a zero. An empty list distinguishes no
included accounts from no matches. If a previously available results page becomes
empty after account changes, **First page** returns to current results.

Signing out or switching accounts immediately removes visible private results
and cancels pending reads. Searches and account results stay in the open page's
memory; they are not saved in addresses, browser storage, or shared caches.
Public HTML contains only the page title and description. Search engines are told
not to list `/admin/users`. Admin page visits are excluded from Vercel analytics,
and the direct page shell omits the Cloudflare measurement script.

## Server setup and removal

`ALETHICAL_ADMIN_ACCOUNT_IDS` is a server-only comma-separated list of the 4
approved Supabase identifiers. An absent or malformed list grants no access.
`ALETHICAL_TEST_ACCOUNT_IDS` adds test exclusions; the existing
`TRAFFIC_EXCLUDED_ACCOUNT_IDS` remains part of the exclusion list. None of these
settings belongs in a public `EXPO_PUBLIC_` variable.

Removing an identifier revokes administrator access on the next private request.
Removing the entire admin setting disables this feature without deleting data.
Restoring its saved value reverses that configuration change. Every private API
response, including access refusals and errors, carries `private, no-store`.
