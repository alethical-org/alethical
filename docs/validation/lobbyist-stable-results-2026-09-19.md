# Lobbyist result update checks, 19 September 2026

Scope: `/money/lobbying/lobbyists`. Other routes were read only for follow-up recommendations.

## Browser checks

Chromium against the local web build, with real public API responses. A browser request
interception allowed the local origin to read those responses and introduced a 1-second
year-change delay and deliberate HTTP 503 failures. No public records were changed.

At widths 1440, 850 and 320:

- The bare route prepared the next page with the displayed donation year.
- A delayed year change retained the prior rows, count, campaign date and record links.
- Rapid year/order changes ended with the newest selection; late responses did not replace it.
- Failed updates retained rows and retry succeeded. The first row's content position changed
  by no more than 1 pixel between the pending and failed states after the requested control changed.
- Prepared Next results appeared after 59, 84 and 83 milliseconds respectively, measured
  from the start of the browser click to the new count becoming available. These are local
  interaction measurements, not a production latency guarantee.
- Both custom menus remained usable, including Year options overlapping the Sort field on phones.
- No page JavaScript errors occurred.

One uncached public API read took 0.808 seconds during this task. No server speedup is
claimed; the change removes repeat waits and the disappearing-result state in the browser.

## Automated checks

52 focused checks passed across the directory screens and source hooks, plus TypeScript
and formatting checks. New checks cover complete-response retention after errors, the
requested year versus the displayed year, prepared-page reuse from the bare route,
data-saving preferences, and superseding a pending pagination jump with a year change.
An independent code review found and resolved a default-year preparation mismatch,
abandoned pagination focus and failure-state spacing.
