# Committee record redesign

User authorization: on September 17, 2026, after reviewing Alethical UX (11).zip, Eugene said “build”. This authorizes implementation through tests, browser review, pull request, merge, deployment and live checks. Earlier review-only status is superseded.

## Scope

Keep both committee and legislator money addresses. Share an independently expandable contribution panel (report comparison, geography, matching contributor names); default closed, preserving independent data states and qualifications. URL state identifies committee and year. Preserve profile ordering.

Committee navigation precedes money-year controls. Campaign money keeps chart, summaries, donor browser, full-payment links, contribution panel and outside-group spending. Filed reports and independent spending cover all years and exclude selected-year money cards and footers. Earlier years remain open after selection. Ownership evidence collapses below the visible date and person link.

Filed reports use a shared list, clear heading/scope/count/source, readable 15px dates and amendment labels, conditional notes, and the report catalogue response’s copy date. Add accessible initial and pagination retries, retaining loaded rows. No per-report links or invented dates.

Preserve cross-address years, existing tab keys and donor preferences. Profile link: Committee details and filings. Full payment links: All received payments / All expenditure payments. Supporting prose remains regular weight even when it contains numbers.

## Steps

- [x] Review approved bundle and coding corrections; isolate branch from origin/main.
- [x] Coordinate with legislator campaign money task; no overlapping edits.
- [x] Shared panel, profile links, semantic text weights (helper shared_panel_build).
- [x] Committee order, navigation, ownership disclosure and year controls.
- [x] Report list layout, states, copy-date mapping and retries.
- [x] Update product guides, focused tests and URL checks.
- [ ] Local type, format, test and production-build checks; browser review across layout bands and data states.
- [ ] Independent review, pull request and checks on current commit.
- [ ] Merge, deployment, independent live browser check, cleanup and final report.

## Work ownership

Branch codex/committee-record-redesign, own worktree /Users/eug/.codex/worktrees/b4de/Alethical. Parent owns committee screen, data mapping, routing, guides and release. Helper owns CampaignMoneyTab, CommitteeDonationCards, MoneyCards and their focused tests.

## Validation checkpoint

September 17: 3064 frontend tests passed, TypeScript and formatting passed, production bundle passed asset and first-load checks. Browser flows at 375, 900 and 1440px passed with public GET responses relayed into the local preview (API CORS rejects localhost). Independent review found profile Share losing Money state and small new action targets; both corrected with Share regression coverage and 44px/focus styling. Final checks will run on the committed revision.

No extra design round or product decision remains. Next: commit, update from current main, rerun affected checks, browser-check review fixes, submit PR and carry it to live.
