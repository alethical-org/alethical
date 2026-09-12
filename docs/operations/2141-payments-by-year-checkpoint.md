# Payments by year and filer: release checkpoint

Work: [issue 2141](https://github.com/alethical-org/alethical/issues/2141).

The accepted change groups exact-name payments by filing year and then the filer registration number. Every row remains. Subtotals belong only to one filer and year with at least 2 payments. Whole-page states and fixed copy remain unchanged.

1. Build grouping, raw employer/purpose rows and the three responsive bands.
2. Add held filer kinds for payee roles and page by filing year before date, so only the oldest visible year may continue.
3. Test real source rows, all roles, caps, missing fields, duplicate rows and loading/error states.
4. Update the reader explanation. Preserve concurrent money-tab and historical-total changes when aligning with main.
5. Run focused and required checks; open a pull request and obtain the root task's independent review.
6. Clear current-head checks, enter the protected merge queue, follow deployment and inspect the live routes, then clean the branch and worktree.

No production data changes or paid runs are part of this change. The architecture decision file remains with its separate owner and is not edited here.

## Checked build, 12 Sep 2026

- Grouping, exact filed fields, role-specific kind mapping, per-filer/year arithmetic and release-consistent paging are implemented.
- The complete backend suite passed: 2,455 tests. The frontend suite passed 2,470 tests before the final cancellation regression; the focused paging suite now has 7 passing tests. Formatting, types and the cross-committee total check passed.
- Real-browser checks used Nystrom's 29 payments and Facebook's ordinary/independent payments at widths 390, 900 and 1,440. A keyboard committee link opened its committee and returned. Loading more ordinary payments increased the visible list from 250 to 500, retained rows and kept the partial-year warning. Phone content stayed within the viewport.
- The local preview reads public production payments through a read-only local proxy. The additional registered kind field awaits deployment; its source and absence behavior passed the backend checks.
- Remaining: align latest main, upload, open the pull request, resolve independent review, pass current-head and merge-queue checks, confirm deployment and live fields, report on the issue, then clean this worktree.

## Independent review complete

The review corrected the distinct-filer count for years containing unnumbered filers: these years print only their payment count. New group labels now live with the fixed copy in the payments library, including the existing non-Contribution schedule marker. All 47 focused tests and TypeScript checks passed after these changes; the complete frontend suite passed 2,472 tests. Backend code is unchanged from its 2,455-test pass.

The lead task completed the authorized upload and release. The earlier helper-context upload refusal is resolved.

## Live result

[Pull request 2158](https://github.com/alethical-org/alethical/pull/2158) is live at
[commit 536f92a8](https://github.com/alethical-org/alethical/commit/536f92a83e0ff53aa49a90790664fc7e4bea9866).
All required combined merge checks and both production deployments passed. After
integrating main, local checks passed 2,478 frontend and 2,455 backend tests.

All 29 Nystrom source rows match the saved real-row fixture, field for field.
Independent live browser checks covered Nystrom's year and filer groups, employer
text, single-payment headers without a subtotal, multiple-payment subtotals and
keyboard committee links. Facebook vendor pagination preserved 500 payment lines
and merged the oldest year's existing groups. All 854 Facebook independent rows
loaded; completed pagination removed every cap warning and the loading button.
Held party units print their kind. Filers without a served kind print registration
alone. Phone, tablet and desktop layouts fit. Full-record links retain the accepted
destination without a selected-year query.

The original whole-page help paragraph remains unchanged as required by the build
brief. A separately proposed wording correction is awaiting Eugene's answer and is
tracked by the final campaign money delivery checkpoint. Branch and preview cleanup
remain with the lead task.
