# `/money/races` compact-directory build and release plan

Status: implementation and browser review complete; final release checks pending. Updated 17 September 2026.
The current coding agent owns the authorized build through a checked live release.

## Authorization and scope

The earlier all-expanded revision shipped in [pull request 2235](https://github.com/alethical-org/alethical/pull/2235).
The user then reopened the browsing structure, ballot warning, register-date placement and
copy. The resulting prompt specified a compact directory followed by 1 complete selected
group. On 17 September 2026 the user supplied `Alethical UX (16).zip` and said **“build”**.
That authorizes implementation, tests, browser review, fixes, commit, pull request, merge,
deployment and a live check. The archive's review-only wording is design evidence rather
than an instruction overriding the user's build request.

Scope is `/money/races`, its search, route state, shared copy helpers, initial response,
focused tests and corresponding product records. No database replacement, paid data run,
new recurring task, navigation redesign or unrelated money-page changes are included.

## Fixed behavior

- The default view lists office/district/seat headings and committee counts. Opening a
  heading replaces the directory with every committee in that group, in the served A–Z
  order. No money is added across committees, and no amount sorts or ranks the rows.
- Search precedes office choices, stays available in a selected group and searches the
  full served set, including statewide offices. Every typed word must match the group
  label, ignoring case and extra spaces. Search never hides committees inside a group.
- Several matches without a selection do not open the first match. Arrow keys select;
  Enter or “View committees” opens the chosen or unique match. Escape closes suggestions.
- The address retains `office`, `year`, selected `group` and directory search `q` as
  applicable. `group` uses the server's existing generated anchor, such as `house-12a`
  or `governor`. Opening a group clears the search in its new address; Back restores
  the previous directory search, office and position. Legacy `#house-12a` links still
  resolve only while the race screen is active. Real links keep new-tab behavior. Focus
  moves to the group heading. The shared Share control preserves the current office,
  group, year and search text in the same query-based address.
- All data requests remain unfiltered by office so search can reach other offices.
  Directory filtering and displayed committee counts use that held response. Office
  counts remain global. Old rows and counts are hidden while another year loads.
- The initial response renders the directory or selected group, never all committees
  behind a directory. It seeds the same all-office/year query used by the screen.
  Filtered/shared addresses retain their existing noindex policy while receiving content.
- The ballot warning is plain text, not a button-shaped box. “Committee list copied
  {date}” sits beneath the count. This date comes from the register's own copy window.
- Each amount retains its own period. Missing figures have no leftover dates and never
  become $0. Only differing periods on usable official totals trigger the mixed warning.
- Keep the complete candidate donor explanation with Itemized contributions, once per
  focused view. The directory prints it in its limits section. “Payment files copied
  {date}” is the 1 release-wide payment-copy date and is omitted when absent.
- Layout bands switch at 768 and 1100 pixels. Directory rows use 2 columns only in the
  widest band, in normal row-major reading order. Full names wrap. All reader text is
  Libre Franklin with equal-width numeric digits. Controls retain visible focus and
  at least 44-pixel targets.
- Source closure is never invented: the current service derives closure from a held
  termination date. The UI may honor a supplied confirmed closed state without a date
  but cannot produce that status from absence.

## Copy decisions

- Keep “party organisations”: the shared campaign-money text uses that spelling.
- Use “By office, then district or court seat” for All offices and “By district or court
  seat” for a selected office. Omit the ordering line when only 1 group is shown.
- Consolidate an unavailable official total to “No usable official total in our records
  for {year}”. The word “usable” matters because a held total may fail the year or
  reporting-period guard. Drop the separate helper.
- Missing named contributions on this address say “No named contributions in our records
  for {year}”. This is a scoped exception to the older “Not reported” rule, not a change
  to the other money surfaces. A failed figure says “We couldn’t load this figure”.
- Use “Limits of the campaign records” and “Payment records before 2015 are not included”.
- Accept the accessible directory-link label “View committees for {group name}”.
- Keep Total contributions and Itemized contributions as the source labels, with the
  supplied plain-language explanations beneath them.
- Do not move the donor explanation entirely to the footer. The naming rule remains
  beside Itemized contributions as required by the approved prompt and UI copy guide.

## Progress and release gates

- [x] Read and reconcile the drawings, 4 copy proposals and 6 open questions.
- [x] Implement copy, route state and directory/focused initial response.
- [x] Run focused helper, snapshot, route and page-handler tests: 378 passed.
- [x] Run TypeScript checks after the initial integration: passed.
- [x] Finish screen/search integration and 25 focused interaction tests.
- [x] Complete independent source review, TypeScript, formatting and all 3,274 frontend tests.
- [x] Fix ambiguous-Enter focus loss, literal-null search matches and inactive-screen hash handling.
- [x] Complete permitted browser review of phone, tablet and desktop states.
- [x] Open the draft pull request and finish remote checks.
- [ ] After browser review passes, mark ready, merge, deploy and exercise the live flow.

Browser access recovered after the user restarted Codex and resumed the task. Review
at 390, 900 and 1440 pixels covered the compact directory, selected House district,
all 28 Governor committees, keyboard selection, ambiguous Enter, global search from
a House-filtered directory, Back restoring search and office, and Clear search.
The local preview used a saved public 2026 API response. Missing amounts and real $0
figures remained distinct, dates stayed attached to each amount, and the phone layout
had no horizontal overflow. The earlier unavailable-records state and retry were also
exercised. Final production verification remains required after deployment.

Current branch: `codex/money-races-directory-v2`. The saved changes include the current
sitewide Share control and the shared scroll-restoration protections. Resume browser
review, any resulting corrections, the merge and live verification within the existing
user authorization; another build approval is not required.
