# Short posts screen delivery plan

[Issue 2396](https://github.com/alethical-org/alethical/issues/2396) owns the approved screen build. Eugene said “yes and when do we test the first post?” on 26 September 2026 after review of Alethical UX (13).zip. This authorizes screen implementation through live release, with a private first-post trial. Each real article still requires separate publication instruction. Comments and nondeveloper submission remain out of scope.

## Work and checks

1. Build /read Short posts group, archive and topic screens with separate title/topic links, 6 per page, stable dates, empty states and browser history. Root owns these files. Implemented; acceptance checks complete.
2. Build article and deterministic charts with evidence, limits, correction history and current Share. article_template helper owns components/shortPosts and scoped editorial display fields. Implemented; acceptance checks complete.
3. Wire navigation, initial HTML, metadata and sitemap. short_post_routes helper owns these files. Implemented; acceptance checks complete.
4. Prepare private evidence and draft from the lobbyist poster. first_post_evidence helper has completed a narrower 2-entries/1-payment trial; broad poster totals remain unresolved. Keep original files and private material out of git/public output.
5. Independent code and browser review completed. Corrections preserve visible source amendments, date-only Research metadata, nonproportional overlap diagrams, common comparison-bar scales, read-preview rows and topic context. Browser checks covered 320/375px phone, 900px tablet and 1280px desktop. A private local draft exercises the real article/chart components, with sharing disabled and no publication approval.
6. Repository checks, independent reviews, merge queue, deployment and live route checks are complete. No real article was published in this release.

The source of product decisions is [published-writing-decisions.md §7](../architecture/published-writing-decisions.md#7-short-posts-from-checked-social-material). Private review and trial evidence are retained outside the repository under the current task’s private artifact directory. The 25 September foundation remains intact.

## Release evidence

[Pull request 2397](https://github.com/alethical-org/alethical/pull/2397) shipped as [commit d93c57df](https://github.com/alethical-org/alethical/commit/d93c57df86acb849b7ffbb2cf42a899bcd41059c). The public website serves that release. The frontend suite passed 3,636 tests and the backend suite passed 3,374 tests; the merge queue passed its checks against the combined change. Type checking and the production build pass.

The first hosted build exceeded the first-download limit by 555 bytes. Moving server-only search descriptions out of the browser startup code fixed it without changing the limit or visible wording. The hosted production build measures 295,806 bytes against the 296,022-byte limit. Browser/server title parity has a focused test.

Live acceptance covered:

- `/read`, `/read/short-posts` and 3 populated topic addresses return 200 with the expected initial text. The empty archive is excluded from indexing; populated topics carry their canonical addresses.
- Unknown topics and an out-of-range archive page return 404. The private trial's proposed public address also returns 404.
- `/sitemaps/pages.xml` includes populated topic pages, excludes the empty archive and contains no private trial.
- Desktop and phone browser checks covered topic links, article opening, Back, the empty archive's Back to Read link, keyboard navigation, guide-group expansion, and Share opening/closing with focus return. No horizontal overflow appeared at 1366px or 375px. Earlier component acceptance also covered 320px and 900px layouts.

No real Short post is in the public registry. The private draft uses the actual article and chart components, with sharing disabled. Its wording and evidence remain under review; publication still needs an article-specific instruction. The private trial, social posters and retained source files stay outside git. The worktree and private preview remain available for that review.
