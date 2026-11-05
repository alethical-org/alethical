# Finance name spelling results

Build requirements for Finance name searches and payment spelling groups.
Release progress and acceptance evidence live in
[the Finance spelling-results issue](https://github.com/alethical-org/alethical/issues/2888).

## Approved behavior

Name searches find direct matches and strongly likely spellings. Official people,
organizations, committees, lobbyists and principals remain separate results with
their own identifiers and destinations. Explicit sorts govern all returned matches;
direct matches lead only where no sort control exists. Numeric identifiers,
districts and bill numbers retain their existing matching rules. Vote searches
only its held members. Connections searches only held labels and creates no edges.

Payment and agency pages load strong full-name spelling variants automatically.
Exact spelling comes first, followed by variants A–Z. Each group prints its exact
source spelling and own count. No person total or inferred identity is created.
Employer pages combine selected employer spellings under each donor, showing the
exact filed employer on every payment. Each donor appears once in that list.
Each source payment row appears once by dataset, snapshot and row number; separate
filed rows remain separate even when their fields match. Agency files appear once
per file/version under their first applicable spelling and retain other spellings
as “Also printed as”. Source evidence, checking status and copy dates remain.

One qualification appears above variant groups: “Similar spellings may refer to
the same person” (donor), “Similar spellings may refer to the same person or
organization” (payee), “Similar spellings may refer to the same employer”, or
“Similar spellings may refer to the same agency”. Donor/employer count note:
“Record counts may include more than one entry for the same donation. Our records
may not include all giving.” Committee name-filter subtotals retain their scoped
meaning, labelled “Matching itemized contributions”, “Matching itemized
contributions made” or “Matching itemized expenditures”.

Secondary Similar names omits main displayed spellings, ranks closest first with
A–Z ties, shows 1 then Show more, and has no intro or confirmation labels.
Expansion survives resize, resets on scope change and focuses the first new link.
Loading or failed spelling groups keep their comparison links until displayed.
On narrower screens it follows results; desktop has an independent 300px payment
rail and the existing 320px agency rail.
Browsing confirmation cards and entry links are removed. Separate identity tools,
evidence-backed profiles and registered links remain. No extra spelling filter,
manual exclusion control or Share action is in this approved pass.
Identity confirmations, joins, splits, withdrawals and TV-file checks remain shared
records for accounts with access. They do not override automatic spelling matches.

Agency payment links open the appropriate campaign or outside-spending file scope
and say “under this name”; their destinations include strong spelling variants.

Exact results stay visible while variant results load or fail. Old responses cannot
replace newer scopes, and previous data never crosses account boundaries. A zero
exact group remains when variants have records. Errors are not empty results.

## Sources and build checks

Fresh source: root drawings and CLAUDE.md eug-139 in Alethical B2B (50).zip,
downloaded 5 November 2026 from the active Donor payments by spelling design.
The archive's `exports/Alethical Finance` subfolder is historical, not the source.
Approved requirements supersede older exact-only Finance browsing requirements;
the shared public site's readers and identity-management matching stay unchanged.

Required checks: Danchik/Dantchik/Dantchick and honorific variants; unrelated
Arthur names excluded; conflicting given names, suffixes and organization numbers
kept apart; no arbitrary top-3 rule; stable source keys and no duplicated payments;
filter, sort, pagination and return context; slow/failed/out-of-order loads;
account changes; agency file/version overlap; Vote held values and missing data;
keyboard, touch and rendered layouts across the approved bands.

## Work and ownership

- Parent: integration, backend spelling groups, agency rendering, requirements,
  review, release and live acceptance
- copy_comparisons helper: secondary name components and tests
- discovery helper: Finance-only matching and discovery integrations/tests
- payment_groups helper: payment and employer group rendering/tests

Implementation and local review completed. Local checks include all 801 Finance
interface tests, the production bundle and link guard, 133 retained access,
identity, TV-check and payment tests, plus focused spelling/discovery regressions.
Chrome review covered payment, employer and agency groups at desktop, 768px and
320px with synthetic records, including more-results controls and original spellings.

Review corrections preserve comparison links until groups are displayed, pin
exclusions to the displayed source copy, refresh main results after a changed copy,
clear rows on access denial and keep eligible spellings past candidate filtering.
Release checks and live acceptance are recorded in
[the Finance spelling-results issue](https://github.com/alethical-org/alethical/issues/2888).
