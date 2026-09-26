# Short posts screen delivery plan

[Issue 2396](https://github.com/alethical-org/alethical/issues/2396) owns the approved screen build. Eugene said “yes and when do we test the first post?” on 26 September 2026 after review of Alethical UX (13).zip. This authorizes screen implementation through live release, with a private first-post trial. Each real article still requires separate publication instruction. Comments and nondeveloper submission remain out of scope.

## Work and checks

1. Build /read Short posts group, archive and topic screens with separate title/topic links, 6 per page, stable dates, empty states and browser history. Root owns these files. Implemented; acceptance checks complete.
2. Build article and deterministic charts with evidence, limits, correction history and current Share. article_template helper owns components/shortPosts and scoped editorial display fields. Implemented; acceptance checks complete.
3. Wire navigation, initial HTML, metadata and sitemap. short_post_routes helper owns these files. Implemented; acceptance checks complete.
4. Prepare private evidence and draft from the lobbyist poster. first_post_evidence helper has completed a narrower 2-entries/1-payment trial; broad poster totals remain unresolved. Keep original files and private material out of git/public output.
5. Independent code and browser review completed. Corrections preserve visible source amendments, date-only Research metadata, nonproportional overlap diagrams, common comparison-bar scales, read-preview rows and topic context. Browser checks covered 320/375px phone, 900px tablet and 1280px desktop. A private local draft exercises the real article/chart components, with sharing disabled and no publication approval.
6. Run repository checks, open PR, handle findings, merge, deploy and exercise live routes. No real article published in this release.

The source of product decisions is [published-writing-decisions.md §7](../architecture/published-writing-decisions.md#7-short-posts-from-checked-social-material). Private review and trial evidence are retained outside the repository under the current task’s private artifact directory. The 25 September foundation remains intact.

## Release evidence

The frontend suite passed 3,635 checks and the backend suite passed 3,374 checks. Type checking and the local production build pass. The first hosted build exceeded the first-download limit by 555 bytes. Moving server-only search descriptions out of the browser startup code reduced the local first download from 295,973 to 295,001 bytes, against the unchanged 296,022-byte limit. All 448 focused routing, metadata and article checks pass, including exact browser/server title parity. The new hosted build and live routes remain the final release steps. [Pull request 2397](https://github.com/alethical-org/alethical/pull/2397) carries the screen release. No real Short post is in the public registry; the private trial, social posters and source files stay outside git.
