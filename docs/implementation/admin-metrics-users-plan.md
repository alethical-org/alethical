# Admin metrics and users

This plan tracks [issue 2072](https://github.com/alethical-org/alethical/issues/2072)
on `codex/admin-metrics-users`.

## Delivery sequence

1. **Complete: frontend and backend inventory.** The current main task mapped the
   existing administrator routes, menu permission check, Supabase account queries,
   exclusion rules, legislator totals, tests, guides, and release settings.
2. **Complete: current-legislator count.** The account-flow helper established that
   206 stored legislator people contain 200 current people and 6 former people.
   Minnesota has 201 seats, so the current list has 1 vacancy. A legislator with both
   former and current service must still count as current.
3. **Complete: main authorization and integration.** The current main task named
   `admin metrics users` owns the administrator permission timing and all source,
   test, guide, performance, and privacy changes in [issue 2072](https://github.com/alethical-org/alethical/issues/2072).
   This node uses the inventory and count results from nodes 1 and 2.
4. **In progress: verification.** After node 3, the current main task runs the focused
   backend and frontend checks, full required checks, production build, before-and-after
   size and speed measurements, and fresh-browser allowed and denied paths.
5. **Pending: release.** After node 4, the current main task opens and merges the pull
   request, watches deployment, and checks `/admin/users`, `/admin/metrics`, and the old
   `/admin/site-metrics` address live.

## File ownership

- The current main task owns backend source and checks under `alethical/api/routers/`,
  `alethical/api/services/`, and `alethical/tests/`.
- The current main task owns frontend source and checks under `apps/frontend/src/`,
  plus `api/page.ts` and `vercel.json`.
- The current main task owns the affected guides under `docs/architecture/`,
  `docs/operations/`, `docs/plans/`, and `docs/product-onboarding/`.
- The account-flow helper owns only `docs/implementation/admin-metrics-users-plan.md`
  and the read-only count result. It does not edit product code.
- Former-legislator profile labels stay with [issue 2061](https://github.com/alethical-org/alethical/issues/2061).

## Validation checkpoint

- The account inventory is 1 database read; team/test accounts remain separate
  from main results, filters, pagination, and totals.
- The server sends an optional administrator menu hint with `/me`. It does not
  authorize private data; the independent private-request checks remain active.
- The metrics API uses `?version=2` for the additional current-legislator count;
  version 1 omits the new field for already-open older browser bundles.
- The 2,385-test frontend suite passes. The added profile-hint parser checks pass.
- The production web build passes its unchanged download limit: 391,019 estimated
  hosted bytes against 391,500.
- Desktop and phone preview checks cover menu links, metrics Refresh alignment,
  search, pagination, excluded accounts, and clearing private results at sign-out.
- The full backend run passed 2,275 checks and exposed 1 expected-response
  update; all 18 account-isolation checks pass with that response updated. The
  independent signed-out browser pass covers desktop, tablet, and phone. Automatic
  approval review refused its invented-account sign-in; the main task completed
  the signed-in local flows. Current-main checks and live release remain pending.
