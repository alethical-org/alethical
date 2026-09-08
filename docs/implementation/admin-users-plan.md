# Private account visibility

## Approved result

The `/admin/users` page is available from the signed-in account menu to approved
administrator accounts. The 8 approved email addresses are listed in
[admin-users-guide.md](../product-onboarding/admin-users-guide.md). Team and test accounts are excluded from
results, search, totals, and pagination. There is no switch to include them.
Alerts, email delivery, and account-changing actions are outside this build.

## Delivery sequence

1. Bind administrator access to existing, confirmed approved Supabase identities in a
   private server setting; independently require a current confirmed approved
   email and an active Alethical account. Check denied access and forged identities.
2. Read minimum account fields from Supabase's existing `auth.users` records,
   combine identities already linked to one product account, and exclude team/test
   accounts before computing any result. Check confirmation dates, pending records,
   duplicate sign-in methods, filtering, and pagination against real Postgres.
3. Build the responsive `/admin/users` screen and account-menu entry alongside the
   server work. Check signed-out, denied, loading, empty, error, populated, search,
   pagination, account-switch, and sign-out states with controlled local fixtures.
4. Keep account data out of public HTML, shared caches, analytics, and persistent
   browser storage. Publish a plain-English guide and update affected descriptions.
5. Run the required checks, obtain a separate security review, open the pull request,
   clear current-head and merge-queue checks, deploy, and check the live release.

## Ownership

This task owns private account visibility. The separate task named `site metrics`
owns public anonymous totals and its own measurement changes. Shared account-count
definitions and exclusion behavior are coordinated before those public changes.

## Additional administrator activation

Tracked in [issue 2115](https://github.com/alethical-org/alethical/issues/2115).

`alexia@alethical.com`, `joe@alethical.com`, `afnetter@gmail.com`, and
`joseph.fleishman@gmail.com` are approved and excluded from reader results.
Activation requires each owner to create and confirm an account. Then verify the
exact current email and active account state, preserve the existing approved
identifiers, save the previous private setting, add only the newly confirmed
identifiers, deploy, and verify both access checks. Do not create accounts, send
invitations, or bypass the identifier requirement as part of this activation.

## Initial release evidence

- The isolated branch is `codex/admin-users`; dependencies are installed locally.
- All 4 initial administrator addresses resolved to unique confirmed Supabase accounts.
- `auth.users` and the product identity tables share the existing production
  database. No database schema change is needed for the private account list.
- Frontend implementation is assigned to the `admin_screen` background helper;
  the lead owns backend, privacy boundaries, integration, and release.
- The frontend and server are implemented. 96 focused backend checks pass,
  including identity attacks, whole-account exclusions, date boundaries, and
  private errors. An independent security read caught and fixed empty bearer
  tokens falling back to a provider client's stored session.
- A read-only production query returned 15 confirmed and 1 pending included
  account. All 4 approved identities passed the current database state predicate.
- Populated desktop and phone checks pass: sign-in return, Admin entry, search,
  status/date filters, paging, readable details, and sign-out/back privacy. Fixed
  the singular account-count wording reported by the independent browser tester.
- Full checks passed: 1,996 backend tests, 2,050 frontend tests, type checks,
  formatting, production build, and first-load size limit. A further isolated
  Postgres test executes the real account SQL and proves each admin revocation
  condition, linked-account grouping, and whole-account team exclusion.
- Railway holds exactly 4 approved admin identifiers with the previous setting
  saved privately for rollback. The existing traffic exclusion setting is unchanged.
  The settings write did not trigger a deployment.
- Current main is integrated. 2,072 frontend checks and 97 focused backend/SQL
  checks pass. The private parser and search request load with the admin screen.
  Shared route/menu permission code plus the late sign-in fix add 826 compressed
  bytes to main's measured 388,290-byte baseline, for 389,116; the justified size
  limit is now 390,000.
- Final fresh-browser testing exposed a sign-in regression in the deferred client
  change from main: a signed-out startup skipped the session observer even after
  a later sign-in request. The provider now observes the first bundle request
  without downloading it on public visits. The new failing regression passes
  after the fix; all 2,083 frontend checks, types, and the release build pass.
- Initial release: [pull request 2017](https://github.com/alethical-org/alethical/pull/2017).
