# Committee empty-year refinements

The approved scope is tracked in [issue 2274](https://github.com/alethical-org/alethical/issues/2274).
Remove the entire unlinked-candidate message from the top and add nothing to
“What this record covers”. The coverage text stays unchanged. Verified profile links
and confirmation failure states remain.

## Work and checks

- [x] Use itemized/non-itemized contribution terminology across shared headings,
  accessible labels and current guides; add a regression check for retired labels
- [x] Use “No [year] report figures in our copy of the state’s files” and
  “Figures from another year are not substituted” for every missing report year
- [x] Remove the unlinked-candidate message without implying a confirmed person
- [x] Replace empty money cards, donor controls and contribution-detail sections
  with one compact explanation only after both payment directions finish loading
  successfully from the same release as the summary
- [x] Preserve partial coverage, actual zero totals, outside spending, loading,
  failure and closed-committee states; use “Report total unavailable” for missing totals
- [x] Replace the unverified alternate-year shortcut with “View filed reports”
- [x] Run focused behavior checks, types, formatting, full frontend checks and build
- [x] Inspect desktop, tablet and phone behavior; independent review and corrections
- [ ] Commit, push, open pull request, pass current checks, merge, inspect live result

No data ingestion, source-data changes, new designs or coverage-footer copy changes
are part of this work. The initial HTML has no complete payment lists, so it must
not claim their absence; the running view may compact only after its complete reads.

Local evidence: 3,347 frontend tests pass; types, production build and its size checks
pass. Browser checks cover 390, 900 and 1440 pixel widths, missing years, filed reports
and populated committee figures. Independent review covers partial receipts, including
loans that do not belong in contributor groups. Release evidence belongs in issue 2274.
