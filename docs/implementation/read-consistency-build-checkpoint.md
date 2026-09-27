# Read consistency build checkpoint

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
