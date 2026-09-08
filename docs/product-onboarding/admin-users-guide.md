<!-- describes: alethical/api/routers/admin.py, alethical/api/routers/me.py, alethical/api/services/admin_access.py, alethical/api/services/admin_accounts.py, alethical/api/services/account_classification.py, apps/frontend/src/screens/redesign/AdminUsersScreen.tsx, apps/frontend/src/hooks/useAdminAccess.ts, apps/frontend/src/lib/adminUsers.ts, apps/frontend/src/lib/adminAccess.ts, apps/frontend/src/data/adminUsers.ts -->

# How private account visibility works

The `/admin/users` page lets approved administrators see current reader accounts.
It shows each email address, signup time, confirmation time or pending status, and
the available sign-in methods. It cannot change an account or send an alert.

## Opening `/admin/users`

Sign in, open the account menu, and choose **Users** under **Admin**. This works in the
desktop menu and the phone account sheet. The Admin group follows the password row and
comes before Sign out. **Metrics** follows Users in that group and opens `/admin/metrics`,
whose title remains **Admin metrics**. Opening `/admin` also leads to `/admin/users`.
An administrator may open `/admin/users` directly or reload it.

These 8 email addresses are approved for administrator access:

- `angelzierden@gmail.com`
- `angel@alethical.com`
- `eug@alethical.com`
- `alethicaldev@gmail.com`
- `alexia@alethical.com`
- `joe@alethical.com`
- `afnetter@gmail.com`
- `joseph.fleishman@gmail.com`

Approval does not create an account or activate access. Each owner must sign up
and confirm their email, and their stable Supabase account identifier must be
added to the private server setting before administrator access works.

The server checks the signed account identifier, the current confirmed email,
and whether the account is still active. An email alias, editable profile field,
or a hidden menu entry cannot grant access.

The signed-in profile response (`GET /api/v1/me`) includes an optional `is_admin`
menu hint. The server derives it from the verified Supabase subject, the configured
administrator identifiers, and current database records for the exact confirmed
email and account eligibility. A boolean value lets the menu show or hide the
administrator entries immediately. If the field is absent or null, the browser
falls back to `GET /api/v1/admin/access`. A failed optional hint read returns null
without preventing ordinary sign-in.

The hint is held with the current signed-in profile, not in browser storage. It
does not authorize a private read: every account or metrics request separately
checks the sign-in token, fresh provider confirmation, and current account state.
Changing access can leave a menu entry visible until the profile is read again,
but the next private request uses the changed permission.

## Finding an account

The newest signups appear first, 25 per page. **Previous** and **Next** move through
the results. Search accepts a complete email or part of an email and ignores
capitalization. Press **Search** or Enter to apply it.

**Status** selects all, confirmed, or pending accounts. **Signup date** selects
any date or accounts created in the last 7 or 30 days. These filters apply together.
The 2 filter groups share a row where they fit, with 40 pixels between them and
32 pixels above and below the row. On narrower screens, Signup date wraps below
Status and the choices wrap within each group.
**Clear filters** returns to the complete included list. **Refresh** reads current
records again while keeping the selected filters. On desktop it is vertically
centered beside the introductory description; on phones it sits below the description
at the right edge. A 48-pixel gap separates this row from the summary cards.
The email field accepts up to 254 characters
and stays beside Search on desktop and phone. The Search button and email field
share the same height. Below the main account results, 1 source line combines
when the records were read, what the counts cover, and when today begins.
The update time ends in **CT**. The line wraps on smaller screens.

The summary shows confirmed current accounts, first confirmations today, and first
confirmations in the last 7 and 30 days. The pending total appears beside Status.
Summary figures always cover every included current account, regardless of search
or filters. Today starts at midnight in Minnesota. All displayed dates use
Minnesota time. The 7- and 30-day figures are rolling periods.

## Excluded accounts

Team and test accounts are removed before search, totals, sorting, and pagination.
Their email addresses appear in a separate **Excluded accounts** section below
the main list. This section stays visible even when the main list is empty, and
its contents do not change with search, status, signup-date filters, or pagination.
There is no control to include them in the totals or main results. Exclusion covers
the 8 approved administrator emails and these 5 other team emails:

- `elopinyoga@gmail.com`
- `elopinmisc@gmail.com`
- `eugenelopin@gmail.com`
- `adaonstoa@gmail.com`
- `rohan.mishra1997@gmail.com`

Configured team/test account identifiers are excluded too.

Same-mailbox aliases are excluded too: plus suffixes for known team addresses and
Gmail's dot and `googlemail.com` variants. Reserved fixture domains `example.com`,
`example.org`, `example.net`, and `test.invalid` are excluded. Other test accounts
must have their stable identifier added to the server's test exclusion setting;
words such as “test” inside an ordinary reader's email do not prove a test account.

If any identity belongs to the team, its entire linked Alethical account is
excluded from the main results and totals. These exclusion rules never grant
administrator access.

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

Signing out or switching accounts immediately removes visible private results,
including the excluded-account list, and cancels pending reads. Searches and account
results stay in the open page's memory; they are not saved in addresses, browser
storage, or shared caches.
Public HTML contains only the page title and description. Search engines are told
not to list `/admin/users`. Admin page visits are excluded from Vercel analytics,
and the direct page shell omits the Cloudflare measurement script.

## Server setup and removal

`ALETHICAL_ADMIN_ACCOUNT_IDS` is a server-only comma-separated list of approved,
confirmed Supabase account identifiers. Only existing accounts can be listed;
approving an email does not add an identifier automatically. An absent or malformed
list grants no access.
`ALETHICAL_TEST_ACCOUNT_IDS` adds test exclusions; the existing
`TRAFFIC_EXCLUDED_ACCOUNT_IDS` remains part of the exclusion list. None of these
settings belongs in a public `EXPO_PUBLIC_` variable.

Removing an identifier revokes administrator access on the next private request.
Removing the entire admin setting disables this feature without deleting data.
Restoring its saved value reverses that configuration change. Every private API
response, including access refusals and errors, carries `private, no-store`.
