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
- [x] Local type, format, test and production-build checks; browser review across layout bands and data states.
- [ ] Independent review, pull request and checks on current commit.
- [ ] Merge, deployment, independent live browser check, cleanup and final report.

## Work ownership

Branch codex/committee-record-redesign, own worktree /Users/eug/.codex/worktrees/b4de/Alethical. Parent owns committee screen, data mapping, routing, guides and release. Helper owns CampaignMoneyTab, CommitteeDonationCards, MoneyCards and their focused tests.

## Validation checkpoint

September 17: 3064 frontend tests passed, TypeScript and formatting passed, production bundle passed asset and first-load checks. Browser flows at 375, 900 and 1440px passed with public GET responses relayed into the local preview (API CORS rejects localhost). Independent review found profile Share losing Money state and small new action targets; both corrected with Share regression coverage and 44px/focus styling. Final checks will run on the committed revision.

No extra design round or product decision remains. Next: finish current-head checks and carry the release to live.

Current-main checkpoint: 3091 frontend tests pass. The rebased startup bundle exceeded its existing limit by 70 bytes; sharing the identical route-filter extraction loop reduced it to 339006 bytes against 339072. All 155 routing tests pass. No limit increase. Final preview confirms Share keeps money tab/year/open rows, ownership evidence survives reload, and Earlier years has a 44px target. The opt-in money browser checks now follow the approved All received payments label.

Final reader checkpoint: 3092 frontend tests pass; production startup is 338903 bytes within 339072. Independent public-record testing covered candidate, party, fund, closed and unconfirmed committees. Fixed Independent spending sharing/reload to preserve its own sort separately from donor sorting, with a fresh-mount regression test. Existing goods/services split wording remains governed by [issue 2182](https://github.com/alethical-org/alethical/issues/2182); repeated download destinations serving different record scopes remain unchanged.

Release: [pull request 2236](https://github.com/alethical-org/alethical/pull/2236). Final changes are in review; merge, production stamp, live reader test and release report remain.
