# Read consistency build checkpoint

## Article readability refinements, 30 Sep 2026

Source: Eugene’s pasted “Articles — width limits for the title, research opening
line, short notes, conclusions and tables, 30 Sep 2026”, accepted under his
“if so, build these too when ready” instruction.
[Issue 2448](https://github.com/alethical-org/alethical/issues/2448) owns release.
The named updated drawings and `build-facts-reading-round-3.md` §7d were not
downloaded. The written proposal is the new target; `Alethical UX (43).zip`
remains the prior appearance target outside the explicit exceptions below.
Prior bundle SHA-256: `55908464d5659f1d2388a458aa182b7e08c617da58819464a5c67f11ec57aa50`.

Branch `codex/article-reading-limits`; isolated working copy
`/private/tmp/alethical-article-reading-limits`. The build helper owns code,
requirements and automated checks. The parent Codex task (blog,
`01a0f3d4-2631-7852-ad53-79682f7aa6e2`) owns browser acceptance, pull request,
merge, deployment and comparison at the live article addresses. Publication,
authentication, account changes and real comment test writes remain excluded.

Expected behavior and acceptance evidence:

| Surface | Approved target | Observed / evidence |
| --- | --- | --- |
| All article H1 titles | From 768px, maximum 1040px and balanced wrapping; every YYYY–YYYY range stays on 1 line at all widths; exact characters retained | All 9 published titles at 1600px measure1040px, use balanced lines and have no isolated final word/year. Exact title characters pass automated tests. Lobbyist giving 2015–2026 occupies1 line at320/375/768/900/1099/1600px. Native Chrome200% at375px produces187px CSS viewport: title client148px/scroll180px. Keyboard Tab reaches title with visible2px purple focus; ArrowRight scrolls0→32.75px and reveals the entire year range inside heading bounds. At100%, phone335px and desktop1040px titles have no added keyboard stop. |
| Long Research opening under H1 | Existing 22px text limited to 880px; Guide and Short post openings unchanged | Long report opening measures880px at1600px, with unchanged22px type. Guide opening remains1488px with unchanged19px type; Short post opening remains1488px. |
| HOW THIS WAS CALCULATED | Essential paragraph and Full method control limited to 880px; expanded body and enclosing box remain full width | Essential summary and Full method control measure880px inside1488px box. Keyboard Space expands body to1438px usable width (1488px box less existing padding); focus stays on control. |
| Closing AI note | AI-preparation paragraph limited to 880px; enclosing box unchanged | AI paragraph880px inside unchanged1488px box at1600px. |
| Existing conclusions | Whole symbol-plus-gap-plus-text wrapper limited to 880px; exact current symbol size and text preserved | Prose conclusion and organizations chart conclusion measure880px including symbol, gap and text. Chart conclusion divider narrows with this approved whole-wrapper limit; its enclosing chart remains1488px. Existing symbol size and exact wording retained. |
| Every article table | Full-width table; label column width 1%, no wrapping from 768px; numeric columns width 1%, minimum 160px and expand for widest content; 1 empty aria-hidden spacer cell per row including header; real row/column header associations; full-width row lines | All 5 published tables at1600px align each real column across rows. Numeric columns measure160px or expand to166.84/216.57/242.29px for headings. First figure lies24–109px from the longest label. Hidden empty spacers appear in every row and remain excluded from native accessibility tables; row lines span the article column. |
| Overflowing tables | Local horizontal scroll at every width when necessary, keyboard accessible with existing approved visible focus | All 3 formats at320/375/768/900/1099px stay within viewport. Wider tables scroll locally; keyboard ArrowRight moves the focused320/375px table40px and keeps the existing2px purple focus visible. At768px lobbyist table717.96px scrolls within688px column, and long-report table440.35px within404px frame. At200% phone zoom, tables remain locally scrollable and the overflowing title is keyboard reachable; page width stays187px. |
| Unchanged surfaces | Article frame, body paragraphs/subheads/lists/boxes, contents rail, comments, Related reading, footer, navigation and Share remain as built; every word/value/date/link, font, spacing, fill, border and radius preserved | Independent whole-scope source and appearance review found no changed words, values, dates, links, type, spacing or surrounding sections outside named exceptions. At1600px before/after, Guide/Short column1488px, Research column1206px, comments1600px and Related reading1488px are identical. Contents links land24px from top; Share opens and Escape closes/restores trigger. Phone Share works. |

These are narrow exceptions to the earlier all-text-full-width direction.
Numeric 160px is a floor, not a fixed cap. Tables may overflow locally on tablet
as well as phone. Native fallback may retain its current table implementation;
the shipped web target uses aligned HTML columns. Automated checks cover exact
title text, year-range boundaries, table contents and header semantics. Parent and independent browser acceptance are complete; live comparison remains a release step.

Automated implementation checks: TypeScript passed; 15 focused title/table tests
passed; the full frontend suite passed 3,886 tests across 311 files. All frontend
formatting and both document-reference/organization checks passed. Production web
export passed, with 296,590 compressed startup bytes against the unchanged
296,881 limit. A hosted release must pass its own size measurement. Integrated article/comment tests passed58 checks after rebasing on the current shared code. The final full frontend suite passed3,896 tests across312 files after adding a resize fallback for environments without ResizeObserver; the previously failing3 contact-navigation checks now pass. Independent review accepted the fallback and cleanup. The parent and independent reviewer accepted the final rendering; live comparison remains pending until release.

First-response acceptance: the article-only initial HTML now keeps the same
1040px/balanced H1 cap and unbroken year range before the app runs. Parent and
independent review used real article builders in script-free private fixtures.
At1600px all3 formats measure1040px with their existing initial40px title font;
both existing Research tables measure1422px with aligned172px numeric columns,
full row rules and empty hidden spacers. Existing initial table type, padding,
alignment, body widths and nonarticle snapshots stay unchanged. At320px the2
Research tables scroll267/271px inside226px local frames, keyboard ArrowRight
moves0→40px and leaves visible2px focus; page width stays320px. At native200%
phone zoom the year-bearing initial H1 scrolls0→28.5px to expose the whole
2015–2026 range, with keyboard focus visible and page width187px. The initial
server response uses a static keyboard stop for year-bearing titles because it
cannot measure overflow without a program; the running app retains its
conditional stop only when the title actually overflows. Final frontend suite:
3,903 tests across313 files; focused first-response tests303, type, formatting,
document checks and production build pass. Startup size remains296,590 bytes
against the unchanged296,881-byte limit. Current-head hosted checks, merge queue,
deployment and live comparison remain the next release steps.

Current-main integration: rebased on the shared navigation, Services and narrow-phone
footer releases through6c0855b5. Kept the existing Services navigation/footer selection
and the new article marker together. The305 snapshot/endpoint checks pass; the
production build passes296,814 /296,881 bytes. The parent’s1600px loaded article
recheck retains1040px title,1488px table rules, aligned numeric columns and24px
label-to-figure gap. Hosted and live acceptance will use this integrated head.

Hosted build 5d470929 failed its unchanged download limit at296,908 /296,881
bytes. Auto-merge was disabled before release. Removed actual article-only
startup work by moving the exact8 date/share functions from researchIndex into
articleDateLabels while retaining research.ts exports and all outputs. Parent
and independent source review accepted the unchanged function bodies, consumers
and one-way loading boundary. Focused450 and full3,929frontend checks pass; local
production export296,278 /296,881bytes. Parent browser recheck accepts Research,
Guide, prose Short post and chart Short post titles/tables and Guide Share dates.
The next hosted build must establish its own size; no limit was raised.

## Article width build, 30 Sep 2026

Eugene's `bd unless you need design udpate?` authorizes the article-width build
from `Alethical UX (43).zip` through live release. Branch: `codex/blog-full-width`.
All article formats fill available width; Research keeps its contents rail,
Guides and Short posts use full width, and comments lose their desktop/tablet
caps. Preserve published text, figures, dates, links and publication approvals.
Libre Franklin numeric text follows the saved Type rule. Shared Share uses the
existing tablet bottom sheet and bounded desktop popover. These settled build
corrections need a Design record update, not another drawing before release.

1. Implement article widths and update their owning requirements. Complete.
2. Run frontend checks and inspect phone, tablet and desktop in the browser.
   Build, type check and all 3,811 frontend tests passed; all 3 formats fit at
   phone/tablet/desktop widths. Fixed a clipped numeric table heading with a
   160px numeric column, then inspected every numeric cell.
3. Independently review the reader paths; repair material findings. Complete.
   Section/related links and keyboard Share open/close passed. Local comments
   show their readable failure state without a backend; live reads remain.
4. Commit, upload, open a pull request, wait for current-head and merge-queue
   checks, merge and inspect all article types at their live addresses.

This layout release does not authorize new articles, changed research claims,
new link selections, account changes or real comment/email test sends.

## Build resumed, 27 Sep 2026

After reviewing `Alethical UX (32).zip`, Eugene asked whether the design was
build-ready, confirmed interlinking was included, requested the build plan, then
sent `'` to approve that plan. This later instruction resumes the design build
through tests, browser acceptance and live release. The earlier design hold below
is superseded for that scope. Exact new article links still require his review
before those article changes are published.

Current work owners and order:

1. Background helper `reading_round3_build` implements the round 3 reading
   surfaces and settled corrections, updates affected product/design guidance,
   and runs focused tests. It owns frontend writes and branch integration while
   building. Preserve the existing unfinished return-link changes.
2. The parent prepares proposed links across all 9 articles in parallel, without
   changing published article fingerprints or claiming approval of those links.
3. After implementation, the parent and an independent reader review the working
   build at the existing `http://localhost:8782` preview. Repair failed checks.
4. The parent owns current-main checks, [pull request 2409](https://github.com/alethical-org/alethical/pull/2409), merge, deployment and
   live checks. Link selection approval remains separate; publish the checked
   layout independently if that editorial decision is still pending.

Reviewed input: `/private/tmp/alethical-ux32-review/exports/build_handoff_reading_round_3/`.
Use its complete build instructions with the review corrections: actual guide
group 5 guides/25 minutes; Published rather than Written; metadata above listing
titles but below article titles; no redundant chart zero/axis, repeated value
paragraphs or generic overlap disclaimer; symbol-left conclusions; safe link-carried
arrival context for new tabs; conditional AI sentence and article-specific correction
contact prefill. Keep every published finding, source link and scope intact.

## Earlier hold, retained as history

Eugene requested a complete updated Design prompt and said he will supply the build
specification before building. All unpublished work is now held. Pull request
[2409](https://github.com/alethical-org/alethical/pull/2409) is open with auto-merge
disabled; do not release it until the updated design has been returned and reviewed
under Eugene's build instruction. Earlier permission to finish the independent
layout release is superseded by this hold.

The committed heading clarification at `f1678504` makes the `/read` green headings
RESEARCH REPORTS, SHORT POSTS and GUIDES. Individual kinds remain Research and Guide.
New `/read/research` and `/read/guides` collections and the context-sensitive return
labels are part of the Design brief, not a finished or approved-to-release build.

The article return-link helper stopped with unfinished changes in
`apps/frontend/src/lib/articleReturn.ts`, `navigation/types.ts`,
`navigation/webRoutes.ts`, `screens/redesign/ReadScreen.tsx` and
`screens/redesign/ShortPostsScreen.tsx` (the latter 4 paths are under
`apps/frontend/src/`). Source context and narrow local destinations are partly
implemented, but not connected to the article. These changes are untested and
uncommitted; the visible short-post return link still points to All short posts.
Preserve this checkpoint and finish or revise it after reviewing the returned specification.

The first approved listing changes are committed on `codex/read-consistency` at
`b25a4a41`: `/read` and `/read/short-posts` share the approved metadata and row
treatments. The remaining article drawing is in `Alethical UX (29).zip`, section
1c of `build-facts-read-consistency.md`. The comments drawing is in
`Alethical UX (30).zip`, whose only new product change from the shipped comments
bundle is that the discussion rules card scrolls with the page.
The article and comments layout changes are committed at `af89a032`.

The article build changes publication metadata to uppercase Franklin with a
comma in the date and no scope colons, styles the kind word above the title
like the report label, and gives both method and source headings the same
monospace treatment. The article's existing facts, chart values, source links,
and disclosures remain intact. Related reading draws after comments when a
published piece has editor picks. The proposed picks for each of the 3
published Short posts are the other 2 published Short posts and the guide
`what-the-records-name`; they remain outside the article record until Eugene
reviews the exact links:

| Article slug                       | Proposed related slugs, in order                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `lobbyist-giving`                  | `organizations-both-parties`, `2-records-not-always-2-donations`, `what-the-records-name` |
| `organizations-both-parties`       | `lobbyist-giving`, `2-records-not-always-2-donations`, `what-the-records-name`            |
| `2-records-not-always-2-donations` | `lobbyist-giving`, `organizations-both-parties`, `what-the-records-name`                  |

The article presentation marks the final total row explicitly, removes only that row's
lower line, and uses the existing 26px paragraph gap below tables. The
published organizations piece also displays its final `Combined` row as a total.
The discussion rules card no longer sticks to the screen while scrolling.

Following an article link to a different guide, research article, or Short post now
opens the destination at its title. The shared reading screen clears the previous
article's scroll target when its article changes and ignores late scroll callbacks
from the article being left. Browser Back and Forward still use each visit's saved
position, while a link to a section in the same article still lands at that section.
The focused scroll tests cover a reused reading screen, late callbacks, Back,
and same-article section links. The rebuilt `http://localhost:8782` preview showed
the exact cross-guide click opening at scroll position 0; Back returned to the
source guide's position, and a section link placed its heading 24px from the top.

## Earlier release gate, retained as history

Changing related-reading picks changes the saved article fingerprint. The
publication check rejects this until the required post-publication review
record is settled. The current build leaves those picks empty and preserves
the existing publication checks. The earlier layout hold described in this
historical entry was superseded by the 27 September build approval at the top
of this checkpoint. Related links remain held until review. The current proposal
is `reading-links-review-2026-09-27.md`, which replaces the earlier 3-link proposals
above. After the link decision, apply the approved picks with their
article review record, rerun focused tests and web export, and release that
separate article update.

## Active acceptance review, 27 September

The parent sent Eugene the complete 7-inline-link and 18-related-link proposal
through an asynchronous question. No answer has arrived yet. Continue the UI
release independently; do not treat elapsed time as link approval.

The first read-only code review sent these corrections to the builder:

- Carry collection page and article target in grouped guide rows' actual links,
  not only their ordinary-click handlers, so new-tab returns preserve context.
- Select the first 3 guide groups/standalone guides together, ordered by newest
  member. Share real group counts, pagination and selection with routing,
  initial HTML and sitemap instead of assuming all guides always form 1 group.
- Use explicit AI-preparation records for all article formats and the same
  closing note in initial HTML and the interactive article. Do not drop arbitrary
  future disclosures by taking only an array's first entry.
- Mount related-reading support for reports and guides as well as Short posts;
  leave selections empty until the pending review resolves.
- Carry the approved phone-specific source, metadata and topic spacing into
  reports/guides; connect the visible topic label to its accessible name.

AI involvement is supported by manuscript-writing commits `825a2357`,
`66bc1d77`, `3de50d25`, `9a3d4838`, and `f505376a` for the 5 guides, and
reader-facing report-methodology preparation in `8a862399`. These are preparation
records, not an inference from article kind. The 3 Short posts already explicitly
record AI assistance.

Eugene additionally authorized the recommended treatment for `/read`'s hidden
heading: `Read`, matching the navigation label. The visible introduction supplies
the subject description. The implementation already uses this heading; retain it
and record it in the owning guidance. Article and collection return links in the
initial served HTML must use the approved return labels too, rather than the old
descriptive share-card title.

The independent browser review exercised collection cards and their separate
topic links, topic page 2 return links (including new tabs), guide-group folding,
phone and tablet charts, symbol-left conclusions, final totals, and correction
contact prefill. These paths passed on the first round 3 export. The review
found a stale section-jump bug: opening another guide after using the source
guide's `#next` link reused that section target in the destination, although its
address had no fragment. The builder owns the fix and regression test; repeat
that browser path after the final export before release. Returning through browser
Back must still restore the source guide's section.

The builder also owns the final first-group default on `/read`, `/read` scroll
restoration, matching hover states on guide-group links, and correction contact
links in the initial HTML. `/read/guides` keeps all groups open by default. The
parent must review the final commit and current-main integration, not rely on
the first export's passing paths for changes made afterwards.

## Final local acceptance, 27 September

Implementation is committed in [de86a5be](https://github.com/alethical-org/alethical/commit/de86a5be).
The independent browser retest passed the section-link regression: the next guide
opens at scroll position 0, Back restores the source section, and returning to
`/read` restores its exact saved position. The parent inspected the final desktop
and 375px `/read` layout, its hidden **Read** heading, and the repaired guide link.
The complete frontend suite passed 3,739 tests; the subsequently added safe-return
test passed with its focused file. TypeScript, formatting, and the full production
build passed. The local startup program measured 296,477 compressed bytes against
the unchanged 296,881-byte limit. Production must pass its own hosted measurement.

Remaining release steps: commit these parent-owned notes, integrate current main,
run the required upload checks, update and push the existing pull request, wait for
current-head and merge-queue checks, then inspect the deployed reading flows. The
exact new article-link proposal remains unapproved and is excluded from this release.

## Hosted size repair, 27 September

Current main was integrated and the upload checks passed 3,751 frontend tests and
3,443 backend tests. The hosted preview for `da436901` failed at 297,038 compressed
startup bytes, 157 above the unchanged 296,881-byte limit, although the local
export passed at 296,462. Auto-merge was disabled while repairing this failure.

[Commit 0b05832a](https://github.com/alethical-org/alethical/commit/0b05832a)
reuses the startup address reader's existing collection validation instead of
loading the separate article return-link validator before any screen opens.
The article components keep their own full validation. The repair passed 122
focused tests, TypeScript and the production build, measuring 296,265 locally.
The hosted build must pass its own measurement before merge resumes. The limit
has not changed. The hidden `/read` heading remains **Read** in both initial HTML
and the interactive screen, matching the saved wording in §2.13 of
`docs/architecture/published-writing-decisions.md`.
