# Committee money refinements

Eugene authorized this build on 17 September 2026 after the screenshot review. Full release is authorized: implement, test, browser review, push, merge, deploy, and live check. [Issue 2243](https://github.com/alethical-org/alethical/issues/2243).

## Agreed result

- Shared regular-weight, rectangular year buttons with black selection; every historical year in one group; natural narrow-screen wrapping
- Arrow-only visible focus with room around the arrow; full disclosure headings remain clickable and keyboard-operable
- Filing supporting copy uses available width and natural wrapping
- All money summary boxes use the profile gray; committee page background is white
- Remove generic political committee/fund ownership sentence and empty box; retain useful ownership and uncertainty explanations
- One receipts/expenditures link, selected year retained; remove repeated downloads footer while preserving the source-card link
- Standalone supporting units omit final periods; real paragraphs retain punctuation
- Coverage uses campaign-finance reports/figures/contributors wording and preserves the existing $200/$500 distinction
- Update first-served HTML, rules, guides and copy record with the same meaning

## Ownership and order

1. Parent: MoneyCards, committee screen, copy, integration, browser checks and release
2. shared_panel_build: year and donation disclosure controls plus focused tests; outside-spending arrow focus only
3. committee_build_review: rules, guides and copy record
4. committee_reader_test: first-served HTML and its tests, then reader review

The separate task Fix green link arrows sitewide owns green navigation arrows. Rebase after its merge and preserve LinkArrowLabel, GreenLinkArrow and linkArrowRow.

## Completion checks

- Focus, selection, all-year visibility, selected-year payment destination and no empty ownership box covered by targeted tests
- Type checking, formatting, frontend suite and production build
- Browser at phone/tablet/desktop widths: no overflow, white header, gray summary cards, one downloads link, one payments link, old year and disclosure URLs preserved
- Independent code/reader pass, current-head CI, merge, production deployment, live reader check

## Progress

Implementation complete. All 3198 frontend tests and type checks pass. Local browser checks at 375/900/1440 show matching year controls, full-width filing explanations, arrow focus and no page overflow. Independent code review findings on focus-selector precedence and first-response historical years are fixed. Independent reader checks and the production build pass. Both committee and profile generic download footers are removed, leaving the outside-spending source link. An unrelated paging test now waits for query completion rather than 20ms, with a delayed-response reproduction. Arrow-task merge/rebase, current-head checks and live release remain pending.
