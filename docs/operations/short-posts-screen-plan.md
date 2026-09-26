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

## September 26 follow-up: private build approved, publication held

### Article research direction, approved 26 September 2026

Eugene requested investigation of the original lobbyist-giving topic, preserving
the graphic's subject rather than substituting the private duplicate-entry example.
The earlier instruction not to investigate further is superseded for this research.
Recompute supportable figures for the original 2015–2026 scope: registered lobbyist
giving and donor count, the amount and share received by the 4 caucus committees,
and Ward Einess's and Joel Carlson's amounts, contribution counts, unique recipient
candidate committees and party breakdowns. Preserve the distinction between the
original extraction date and any newer source copy. Explain gaps or required scope
changes instead of silently shortening coverage or changing the topic.

Eugene authorized the separate task on 26 September 2026. The created task is
`01a0de4e-e38d-7020-9514-65fc0884d328`, with the current host title
“Investigate lobbyist giving for the…”, in `/Users/eug/.codex/worktrees/7082/Alethical`.
Its setup-only turn finished, but the parent's task listing omitted it; the parent
incorrectly described it as still setting up. A direct task read established that
it was idle awaiting the parent's start message. The parent sent that start message
with `gpt-6-astra` and `xhigh`, explicitly lifting the setup hold while preserving
all publication and visual-change holds. A real Claude Code test call completed
successfully with `--model claude-fable-5-1 --effort high`, and response metadata named
`claude-fable-5-1`. This confirms the requested consultation controls work.

The separate Codex task owns this investigation and consults Claude Code directly;
the current task stays available for the organizations-giving-to-both-parties graphic. Claude
independently checks the source selection, identity matching, amended reports,
duplicate handling, calculations and wording. Resolve disagreements with cited
records and reproducible calculations, not model agreement alone. Return each
original claim, its supported replacement or unresolved gap, sources, covered period
and calculation method, followed by a private article draft on the original topic.
Both agents must explicitly accept the same final claims and limitations. The
duplicate-entry draft remains trial material, not the replacement article.
Research approval does not publish an article or lift the held visual changes.

### Approved private-preview changes

1. **Use the symbol alone inside website posts and recreated graphics.** Replace
   the full symbol-and-“ALETHICAL” image with the approved symbol asset, retaining
   the approved visual direction and giving the symbol suitable placement and clear
   space. Check the result on phone, tablet and desktop, including the existing
   private preview at `http://127.0.0.1:8766/`. Standalone PDF reports keep the full
   symbol and wordmark; the shared website header is outside this change.
   Eugene authorized implementation on 26 September 2026. The private preview now
   uses the approved twin-peak vector from the website header, without the wordmark.
2. **Remove repeated text beneath charts when the chart already says it clearly.**
   In the private comparison chart, retain the 2 labels and values beside their bars
   and the shared period above them. Remove their repeated transcript below the chart.
   Retain any useful explanation or qualification not already conveyed, along with
   evidence and limitations. Apply the same check to the other Short post chart types;
   keep their information available as text and avoid duplicate screen-reader output.
   This follows Eugene's 26 September 2026 clarification in
   [ui-copy-guide.md](../design/ui-copy-guide.md#avoid-redundant-nearby-text).
   Implemented in the shared Short post chart component and private preview.

3. **Keep private-draft and preview wording only in the yellow top banner.**
   Remove the “PRIVATE DRAFT” prefix beside the records-through date and any
   private-draft/preview wording elsewhere in the article, charts, controls and
   their accessible labels. Keep the supported records-through date. The disabled
   sharing control uses its normal “Share” label. The yellow top banner contains
   only the bold text “PRIVATE DRAFT”, with no other sentences or explanations,
   following Eugene's further clarification on 26 September 2026. Sharing remains
   disabled and privacy/indexing safeguards remain intact. Implemented at
   `http://127.0.0.1:8766/`.

The branding rule is in
[design-principles.md §2](../design/design-principles.md#2-the-green-visual-system).
4. **Simplify drafting across every post type.** The saved copy rule covers Short
   posts, Research, Guides and blog articles. Remove implied subtitles and setup
   sentences; put reproduction details in the method; state conclusions and limits
   once where needed; distinguish dates without repeating the complete set. Keep
   evidence, reproducibility, required disclosures and qualifications.

Eugene selected “2 records do not always mean 2 donations” as the intended first
Short post on 26 September 2026, subject to his final review. This supersedes the
earlier trial-only status for this article; it does not replace either separate
original-graphic investigation. The shorter article is rendered at the same private
address, with no publication date or public registry entry. Publication remains
held until his final review and instruction. Original private inputs are retained
in the private artifact directory's `revisions/before-copy-simplification-2026-09-26`.

The website template and saved rules are prepared locally with the private draft;
this review checkpoint does not publish the article.

## Release evidence

[Pull request 2397](https://github.com/alethical-org/alethical/pull/2397) shipped as [commit d93c57df](https://github.com/alethical-org/alethical/commit/d93c57df86acb849b7ffbb2cf42a899bcd41059c). The public website serves that release. The frontend suite passed 3,636 tests and the backend suite passed 3,374 tests; the merge queue passed its checks against the combined change. Type checking and the production build pass.

The first hosted build exceeded the first-download limit by 555 bytes. Moving server-only search descriptions out of the browser startup code fixed it without changing the limit or visible wording. The hosted production build measures 295,806 bytes against the 296,022-byte limit. Browser/server title parity has a focused test.

Live acceptance covered:

- `/read`, `/read/short-posts` and 3 populated topic addresses return 200 with the expected initial text. The empty archive is excluded from indexing; populated topics carry their canonical addresses.
- Unknown topics and an out-of-range archive page return 404. The private trial's proposed public address also returns 404.
- `/sitemaps/pages.xml` includes populated topic pages, excludes the empty archive and contains no private trial.
- Desktop and phone browser checks covered topic links, article opening, Back, the empty archive's Back to Read link, keyboard navigation, guide-group expansion, and Share opening/closing with focus return. No horizontal overflow appeared at 1366px or 375px. Earlier component acceptance also covered 320px and 900px layouts.

No real Short post is in the public registry. The private draft uses the actual article and chart components, with sharing disabled. Its wording and evidence remain under review; publication still needs an article-specific instruction. The private trial, social posters and retained source files stay outside git. The worktree and private preview remain available for that review.

### Organizations giving to both parties: private investigation (26 Sep 2026)

Eugene requested a separate task for the second graphic with Claude consultation.
Task `Verify post: organizations funding both…`
(`01a0de5c-f93f-7d62-a33c-50f4361a5c4a`) is active in
`/Users/eug/.codex/worktrees/de2e/Alethical`, started at `gpt-6-astra`
`xhigh`; its peer review is assigned `claude-fable-5-1` `high`.
The task preserves the original subject, investigates all numeric and implied
claims, establishes the missing dates/scope, and delivers a private article draft,
evidence ledger, reproducible calculations and checked chart inputs. This task
(social posts seo) owns acceptance review of its returned artifacts. Publication,
production writes, new Design requests and shared visual changes remain on hold.
The source is `/Users/eug/Downloads/785060511_122125256925275386_1656974990463420094_n.jpg`.

Eugene approved `verify post` and `vp` as equivalent shortcuts for post verification
and drafting. Their shared definition is saved in the personal instructions, with
peer review and private drafting included and separate publication approval preserved.

### Private copy-update acceptance, 26 September 2026

The existing preview at `http://127.0.0.1:8766/` now renders the simplified article
using the updated shared components. Browser inspection covered 320px, 900px and
1280px widths with no horizontal page overflow, the expanded Full method, the
symbol, accessible chart labels and disabled Share. The yellow banner has exactly
1 visible “PRIVATE DRAFT”; no other draft explanations appear. The preview remains
loopback-only and `noindex,nofollow`, with no publication date or registry entry.
Independent read-only review found the explicit overlap population total needed to
survive transcript removal; it is retained in the shared chart's legend.
Source copies, original private draft and calculation inputs remain retained.
Final article review and publication are the next checkpoint.

The first-post review also removed the chart's source-list jump and repeated inline
source links. All 3 official source links remain together under “Where these numbers
come from”. The chart retains its filing period and necessary limits. Direct
external chart citations remain supported for charts that need them.

On 26 September 2026 Eugene clarified that standalone 1-sentence information
outside editorial article prose has no final period, regardless of screen wrapping.
Applied to the private source-scope limit, essential method summary and informational
campaign-finance disclosure. Editorial paragraphs and multi-sentence supporting
text retain punctuation. The shared overlap caption follows the same rule.
The comments owner additionally flagged “No short posts yet” and “No articles about
this topic yet” for the next authorized archive/topic integration; this private
article pass does not release archive changes.

On 26 September 2026 Eugene approved removing the implied zero and the horizontal
line above it. The shared comparison chart and existing private preview now omit
both. Both bars still start at zero and share a scale; the $1,000 bar remains twice
the $500 bar. The draft stays private for Eugene's final review.

The comparison chart now omits “USD” from its shared period line because each
amount carries the currency. Shared units remain where values lack their own
unit; table column headings supply their table's unit. The drafting rule now
requires reviewing headings, labels, values, legends and captions as one group
to remove duplicated units, dates and context without losing meaning.

### First private post: visible conclusion (26 September 2026)

Eugene approved a bold “Conclusion:” and the existing supported answer beside the
Alethical symbol, with the symbol on the left. The evidence limits continue in regular text in the same paragraph after the
bold answer. The answer retains its period to separate the sentences. Center the
30px symbol vertically against the first 2 lines (24px line height, 9px top gap). This changes presentation, not findings.
Finish the first short post with Eugene before resuming other task reviews.
Publication still waits for his final review and instruction.

### First-post generic contribution note removed (26 September 2026)

Eugene removed the generic motive/influence/wrongdoing disclaimer from the first
private post. The specific evidence limits stay. The empty disclosure box is omitted
from the preview; the separately approved AI note remains held until human review.
Eugene subsequently requested these principles as rules for future drafts. The
publication validator now permits omission of the generic contribution note,
while retaining the AI disclosure, evidence and approval checks. Do not restore
the removed copy to satisfy the older policy. Publication remains held.

The conclusion also omits “This comparison does not independently confirm money
changing hands.” The bold answer already says “filings support” and “reported,”
which states the evidence boundary. Keep the concrete distinction that 2 download
entries do not establish 2 separate donations.

### First-post chart label width (26 September 2026)

Eugene approved wider left-hand chart labels so they wrap into fewer lines, moving
both bar origins right together. Use 30% of the comparison width, at least 180px,
on the existing side-by-side layout. Preserve the common zero and scale. On phones,
keep the existing full-width label above each bar instead of squeezing columns.

### Drafting principles consolidated (26 September 2026)

The copy guide now owns answer emphasis, continuous supporting copy, meaningful
uncertainty versus obvious caveats, minimal private-review wording and a whole-draft
review before presentation. The design principles own label width, preserved scales,
responsive chart layout, symbol alignment and empty-box removal. Existing rules for
nonredundant units, sources, dates, punctuation, zero marks and website branding
remain in their existing sections. These are local changes pending the first-post
release; they do not approve publication or resume other task reviews.

### Shared closing note approved and visible (26 September 2026)

Eugene approved the revised closing note across new or revised posts of every type,
with the AI sentence only where AI helped. The first private post now shows the
new note after sources with a working contact link. This supersedes earlier notes
in this plan about withholding the AI text: the replacement no longer claims that
Alethical completed review. The website link uses `/about/contact`; the isolated
preview points to the public contact address. Do not submit a test message.
The shared article helper supplies the same text and link to rendering and search
snapshots. Existing published articles are not retroactively edited. First-post
publication and other task reviews remain held.

### First-post release preparation, publication held

The approved presentation and closing note are integrated into the preparation
branch. The complete first article remains outside the public registry and
website program, with no real publication date or final human approval assigned.
[First Short post preparation](first-short-post-preparation.md) records the
authorized scope, evidence checks, test plan and remaining release steps.
The initial HTML now includes the displayed conclusion, and correction-contact
links use the approved registered-article prefill described in
[contact-us-guide.md](../product-onboarding/contact-us-guide.md).
