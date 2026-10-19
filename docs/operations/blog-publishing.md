# Publishing an article, event, recording and transcript

Use this internal playbook to settle the whole reader experience before production
starts. It records a reusable workflow, not public article copy or permission to
publish another article. Select the applicable steps; a text article does not need
a video project. Existing product decisions remain authoritative.

## Start with the owning decisions

- [published-writing-decisions.md](../architecture/published-writing-decisions.md)
  owns article kinds, dates, disclosures, comments, event history and publication.
- [page-metadata-for-search-and-sharing-decisions.md](../architecture/page-metadata-for-search-and-sharing-decisions.md)
  owns initial HTML, preferred addresses, search descriptions and sharing previews.
- [design-principles.md](../design/design-principles.md) and
  [ui-copy-guide.md](../design/ui-copy-guide.md) own the approved presentation and words.
- [grounded-answers.md](../../.claude/rules/grounded-answers.md) owns evidence,
  unsupported claims and supplied research; publishing a supplied attachment does
  not certify its claims.
- [contact-us-guide.md](../product-onboarding/contact-us-guide.md) owns contact
  prefills, editable account email, draft retention and delivery boundaries.
- [workflow.md](../../.claude/rules/workflow.md),
  [reader-completion-checks.md](reader-completion-checks.md) and
  [public-search-upkeep.md](public-search-upkeep.md) own normal release, live proof
  and existing bounded search checks.

Read the latest applicable decision, including a later explicit user correction.
Do not treat an older implementation checkpoint or a producer's handoff status as
the current publication state. Record new approved product choices in their owning
decision source and link them here instead of making a competing policy.

## 1. Choose the case and the reader's main task

| Case | Reader outcome | Inputs and decisions that differ |
| --- | --- | --- |
| Event before it happens | Understand who, what, where and when; use the approved attendance action | Confirm identities and invitation status, local timezone, venue, registration, accessibility and end-time behavior. No promised recap or recording without supplied material |
| Event after it happens | Watch or read what happened; retain useful event history | Decide whether this is the same event intent at its existing address. Preserve its original announcement/flyer and historical dates. Remove ended attendance invitations. Add accepted media independently |
| Ordinary article without video | Read a supported explanation, report or guide | Use the approved article kind, sources, date and disclosure rules. Omit player, timed controls, VideoObject and video sitemap data |
| Ordinary article with video | Read an explanation with supporting video, or primarily watch 1 video | Decide which task is primary before choosing layout and search expectations. Use the ordinary approved article format; omit event, debate, coalition, venue and historical-announcement assumptions |

**Universal practice:** choose purpose, evidence and available assets before layout.
**Alethical default:** reuse its approved article design and shared sources.
**Forward Debate case:** 1 permanent event address serves the replay and expandable
original announcement. A different subject or reader need may warrant a different
article; do not create another address merely to label the same event “recording”.

## 2. Settle the brief before editing or uploading

Complete the brief at the end of this playbook. Establish:

1. The exact public address, existing preview address, article kind and intended
   reader action. Inventory incoming links before changing an established address.
2. What is approved: private preparation, website publication, public YouTube upload,
   media edits, branding, contact invitation and any external sending. Preserve each
   actual hold. Public upload intent does not require an invented private-first gate.
3. The source of each factual claim, name, role, title, event fact and quoted passage.
   Distinguish an invited person from a participant. Do not add an attendance
   disclaimer to event marketing unless requested.
4. The files that exist, which edition is final, what each check establishes, what
   remains uncertain, and who owns each unfinished step. Keep source originals intact.
5. The article title, search title, introduction, dates, thumbnail, supporting links,
   playlist and optional contact purpose together. These are 1 content plan, not
   separate late additions.
6. Existing approved components and layout bands, including loading, missing-media,
   error, keyboard, touch and reduced-motion behavior. Reuse settled treatments;
   unresolved visual direction follows the existing Design process.

Set file and service ownership before parallel work. Media preparation, article
integration and source review can proceed separately when inputs and boundaries
are clear. Keep 1 writer per file and 1 owner per upload/release. Preserve the
existing acceptance preview rather than replacing it with a second address.

## 3. Keep dates, identity and public claims honest

Record these separately, even when 2 happen on the same day:

| Fact | Meaning | Must agree with |
| --- | --- | --- |
| Event date/start/end | When the event happened, with the correct local timezone | Detailed announcement, Event data and retained history |
| First article publication | When that article was first published | Article record, displayed publication line and article metadata |
| Meaningful article update | A distinct content update when the governing decision calls for it | Displayed update and metadata; a style edit does not imply a new accuracy review |
| Video first publication | When the actual video was first published | YouTube facts and VideoObject uploadDate; not the event or file-export date |
| Media edition/export | Which edit all timed assets describe | Video, captions, transcript, chapters and timing manifest |

Do not reset publication dates merely to look fresh. The approved October 19, 2026
replay date for The Forward Debate is a case-specific editorial decision, while its
October 7 announcement and October 15 event remain recorded. It is not a general
rule that adding video republishes an article.

Use supported facts in introductions and summaries. Keep uncertain words and
speaker identity marked at their times. An uncertain passage must not become a
quote, a confident summary, a chapter premise or a search claim. File agreement,
speaker inference, automated timing and playback checks prove different things.
Never imply a listening or accuracy review that did not occur, or promise that all
machine errors were found. Keep the actual checking record internally; public
copy carries the useful uncertainty required by its approved disclosure.
Do not assign unresolved listening work to the reader as a publication dependency;
retain the approved uncertainty markers instead of guessing the speech.

## 4. Prepare 1 final media edition

Agree the edit before generating captions, transcript, chapters and thumbnails.
Every later trim, inserted title, speed change or removed section can shift all
timed files. Avoid repeated full transcodes without a demonstrated need. Choose
export quality from the source, readability and actual delivery needs, not from
the Forward Debate's resolution, frame rate or file size.

Keep a manifest like this with the media handoff:

| Asset | Practical format | Record and compare |
| --- | --- | --- |
| Final upload | Host-supported video, commonly H.264/AAC MP4 | Edition ID, filename, hash, bytes, measured duration, dimensions, frame rate, audio format, full decode result and edit notes |
| Captions | UTF-8 SRT with timings for YouTube | Same edition, cue bounds/order/overlap, speaker changes, readable line lengths/speeds, marked uncertainty and upload status |
| Readable transcript | Markdown plus structured JSON where the renderer needs it | Same retained words, speaker labels, paragraphs, original turn times and uncertainty; identify any edited reading edition and retain the full source internally |
| Chapters | CSV/JSON source, generated description text | Sorted bounded starts, literal useful headings, consistent titles and timestamp rounding |
| Thumbnail | Accepted JPG/PNG or other supported image | Source frame, rights, crop, dimensions, alt text, neutral portrayal and stable public URL |
| Description | Plain text | Accurate introduction, useful article/source links, disclosure where required, and chapter lines from the same input |
| Handoff | Markdown or equivalent retained record | Final file inventory, originals, time mapping, checks and limits; clearly identify obsolete outputs |

YouTube supports basic UTF-8 SRT, without styling markup. Do not rely on colour
alone to identify a speaker. Caption cue readability targets are quality checks,
not permission to remove spoken content or disguise uncertain words.
[YouTube caption formats](https://support.google.com/youtube/answer/2734698?hl=en).

Record a source-to-final time map, not just a duration difference. For a simple
opening trim and title insertion, final time is source time minus removed opening
time plus inserted title time; multiple edits need a piecewise map. Preserve
fractional source times. Derive whole-second displays consistently, and test that
rounding does not move a turn into the wrong chapter. Keep measured duration and
explain small frame/audio-packet differences instead of altering speech to fit a
planned duration. A gap between caption cues does not prove silence.
Preserve speech and context at cuts. Do not fade or trim a speech-bearing edge
on the strength of machine timing alone; keep uncertain context conservatively.

### An edited reading edition keeps substantive meaning

For a readable article transcript, omit standalone courtesies, turn-taking or
scheduling remarks and unrecoverable empty fragments only when they add no
substantive readable meaning. Preserve meaningful questions, answers,
qualifications, disagreement, assent and clarifications, regardless of brevity
or speaker uncertainty. Never filter all `[unclear]` or `[speaker uncertain]`
turns; retain those markers within substantive text.

When content is intentionally omitted, use **Edited transcript**, retain the full
source internally, and record the exact exclusions and reasons. Keep original
timestamps so retained text still points into the complete video. Captions and
video remain complete and unchanged. Compare source and reading edition, including
the passages around each omission; do not call the reading edition full or verbatim.
Its purpose is easier reading, not a promised search-ranking gain.

Use 1 chapter source for website Topics, transcript headings, YouTube description
and any Clip metadata. YouTube's authored chapters start at 00:00, have at least
3 ascending timestamps and sections of at least 10 seconds. Keep each time and
title together on a line; platform eligibility still applies.
[YouTube chapters](https://support.google.com/youtube/answer/9884579?hl=en).

For political recordings, preserve equal candidate portrayal: comparable name
treatment and image opportunity, factual status labels, readable faces, captions
and player controls. Use authorised logos and titles without implying an unproved
endorsement or co-host. Crops, name-label placement, fades, silence and title/end
cards depend on the actual footage and approval. A sampled still scan does not
prove every frame or every spoken word is correct.

## 5. Make the article useful before adding search details

Choose a short visible title that identifies the subject. A search title may add
names or location needed outside the article. Avoid “recording and transcript”
suffixes when the visible sections already make that clear. The introduction and
description must promise only supplied content. Use clear heading structure,
descriptive links and real sources instead of keyword repetition.

Use the correct visible breadcrumb/return path and matching machine-readable path
where the owning metadata decisions permit one. Link from the appropriate public
collection, related article or topic only when useful and approved. Keep canonical
addresses, new internal links and sharing metadata consistent; timestamp variants
point to the bare article canonical. Provide a stable descriptive social image
that actually represents the content. Do not turn thumbnail/title testing into an
unapproved campaign or claim that a particular image guarantees more traffic.

Supply useful article text and the complete accepted reading edition in initial HTML,
not only after an expand, account action or extra request. Browser startup must
retain the same content. Omit absent sections and unfinished-feature promises.
Accepted transcript, chapters and video can arrive independently; no video means
no broken seek links. Do not add video or transcript download offers. Existing
approved source/PDF downloads are a separate decision and remain available.

### Search eligibility is not a ranking promise

A video-result candidate needs a watch page whose main purpose is viewing 1 video.
A normal article with complementary video can remain useful and eligible as a text
result, without a promise of video indexing. Embedding the same YouTube video on
Alethical is allowed; Google may index both when eligible. Show the player without
requiring a click to create it. Use an accessible stable thumbnail. Search features
and indexing remain Google's choices.
[Google video guidance](https://developers.google.com/search/docs/appearance/video).

Only publish real VideoObject data once the accepted video is available and its
facts are known. Google requires name, thumbnailUrl and first-publication uploadDate;
provide truthful description, duration and embedUrl as applicable. Do not invent
contentUrl for a YouTube watch page. Keep optional Clip titles, starts and same-path
timestamp URLs tied to the shared chapter source; adding them does not guarantee
key moments.
[Google VideoObject guidance](https://developers.google.com/search/docs/appearance/structured-data/video).

The video sitemap's page address, title, description, thumbnail and player/file
address must describe that same available video. A YouTube embed uses its player
address, not a fabricated downloadable media address. Keep missing or unready
videos out without hiding useful article text. Include the child sitemap through
the existing sitemap index and bounded health checks; check XML and actual responses.
[Google video sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps).

These external requirements were read on October 19, 2026. Reopen the linked
official guidance when a later project relies on them; this playbook does not
freeze a platform's future behavior.

## 6. Upload once, then test the real public result

Use the intended channel and existing authorised access. Check long-video and
thumbnail capability before a large transfer. Prepare title, description, chapters,
thumbnail, language, captions, visibility and playlist before uploading. Respect
the requested public release; a private staging step is optional when needed by
an actual hold, not an extra approval gate.

Transfer time depends on file size and available bandwidth. Processing is a
separate platform step; report its observed state, not a precise invented ETA.
YouTube makes lower qualities available before higher qualities, and processing
depends on format, length, frame rate, quality and traffic. Do not wait for an
arbitrary maximum-HD label if the rendition needed by readers already passes.
[YouTube processing guidance](https://support.google.com/youtube/answer/71674?hl=en).

Upload the matching caption file with timing. Reopen saved details after upload
completion and confirm title, complete chapter lines, description, thumbnail,
captions, public visibility, embedding and playlist membership. A saved message
inside a still-running upload does not replace a fresh read of the final result.
Open the public watch page without relying on the creator's signed-in preview.
Require advancing playback, usable picture and sound, supplied captions, seeking
and the expected duration. Record what was actually sampled and any untested audio
or transcript accuracy; a readiness response is a signal to begin this review.

Choose a playlist name that explains its membership to a newcomer, a short useful
description and the actual intended videos. Prefer an existing matching playlist;
do not create duplicates or leave membership assumed. Forward Debate's approved
example is **Candidate Debates**, described as candidate debates hosted by Alethical
with questions about public policy and the communities candidates seek to represent.
Its name is an example, not the required playlist for unrelated videos.

## 7. Keep the player and navigation small, stable and accessible

Reuse the standard responsive YouTube iframe and native controls, without autoplay
or a heavyweight custom player. Retain fullscreen, inline phone playback, keyboard
controls, captions and an accessible frame title. Load only the official API work
needed for enhanced seeking. Keep browser security permissions narrow; do not add
unsafe-inline or extra tracking. YouTube documents a minimum 200 × 200 player
viewport and enough room for controls; check the actual narrow layout.
[YouTube player parameters](https://developers.google.com/youtube/player_parameters).

Progressive enhancement must preserve a usable link path before or without the API.
Use real bounded timestamp links, then enhance same-article seeking. Copy a clean
canonical article link plus the intended time, report copy success/failure, and
exercise the copied destination. Without video, link Topics to contained transcript
headings rather than pretending to seek. Preserve list semantics while removing
redundant ordinal markers: timestamp plus title already identifies a topic.

Test the full built application, including its initial-HTML-to-app transition:
starting playback before app startup must not replace the iframe or lose child
state. Check header focus transfer, deep reading position after comments load,
and cancellation of delayed restoration when the reader tabs or scrolls. A static
preview or modelled scroll value cannot prove real browser anchoring works.

Back/Forward between times must retain the same player and seek to the intended
time; returning to an entry without a time must not force a rewind to 0. Direct
heading links and real browser fragment history must land at the right heading
after startup and return, with room for its full focus outline. Test departure,
return, comments, sign-in dismissal/failure recovery and normal app visibility.
Do not submit forms or sign in merely to prove a reader path. Fake-player tests
prove continuity and controls, not actual audiovisual playback.

### Reuse boundary in the current code

[eventReplay.ts](../../apps/frontend/src/lib/eventReplay.ts) holds final-edition
validation, time formatting, bounded starts and video metadata. Shared
[eventArticle.ts](../../apps/frontend/src/lib/eventArticle.ts) keeps event initial
HTML and browser output aligned. These are useful patterns, not a new generic
article framework.
[eventReplayMarkup.ts](../../apps/frontend/src/lib/eventReplayMarkup.ts) is
debate-specific: it includes Forward branding, debate wording, materials and the
historical announcement. Do not use it unchanged for ordinary articles. Reuse
tested timing/player/transcript patterns within a later authorised article build,
without event or coalition assumptions. This playbook starts no abstraction work.

## 8. Catch repeated meaning and missing context before review

Apply these corrections by purpose, not by blind text replacement:

| Pattern caught in the Forward Debate work | Better outcome and applicability |
| --- | --- |
| Title repeats “recording/transcript” already obvious in sections | Keep the subject in the title; retain format wording only when needed to understand a link out of context |
| Intro card repeats event status, weekday and time | Alethical event introductions show calendar date only, such as **October 15, 2026**. Details, invitations and schedules retain useful time; cancellation, postponement and availability facts remain |
| Event date and article date presented as interchangeable | Name each date's real meaning; never apply the Forward Debate replay-date decision to other articles automatically |
| Completed replay card repeats attendance logistics | Omit the Forward Debate venue/city/free-admission line from its introductory cards. Upcoming attendance and detailed historical information remain useful |
| Topic ordinal sits beside a timestamp and title | Remove the redundant ordinal, keeping timestamp, title, navigation and accessible list semantics. This correction was approved on October 19; release proof belongs to its owning implementation record |
| Empty media sections, preparation notices or private banners leak publicly | Show available useful public content. Private review tooling stays private; actual uncertainty and required disclosures remain |
| Public transcript explains internal checking steps | Keep useful uncertainty beside the relevant text and preserve the real check history internally; do not claim a manual accuracy review |
| Reading transcript repeats standalone courtesies, turn scheduling or empty fragments | Omit only content with no substantive readable meaning; label intentional omissions **Edited transcript**, retain full source and original times, and preserve meaningful brief or uncertain turns |
| New event cards miss adjacent cards' interaction treatment | Reuse the nearest approved matching full treatment across rest, hover, press, focus and touch; show 1 usable focus indicator rather than duplicate title/card outlines |
| Playlist title/description/membership treated as an afterthought | Choose an understandable shared collection and reopen its actual saved membership |
| Contact invitation adds needless support text | Use the approved short heading and 1 action; add explanation only when it adds necessary meaning |
| Contextual contact link opens a blank subject/message | Carry its approved purpose/source through a trusted local key into editable fields. Fill editable signed-in email separately, never through the URL. Preserve written/cleared drafts, generic contact and no-auto-send behavior |
| Partner branding hidden inside closed history | Place the appropriate authorised brand where relevant and visible. Forward Coalition's near-title logo and candidates destination apply only to related posts |
| “Watch on YouTube” treated as universally required or universally redundant | Preserve the scoped approved fallback decision and test unavailable-player recovery; do not impose either choice on every article |

Alethical's `/blog` places Events before Research reports, Short posts and Guides,
including initial HTML. Introductory `/blog` and `/blog/events` cards follow the
date and interaction rules in
[published-writing-decisions.md §2.16](../architecture/published-writing-decisions.md#216-events-reuse-the-blog-design-and-retain-a-permanent-address).
Static containers stay static; approved full-card links must not intercept separate
inner actions or nest links/buttons. Inspect real siblings and shared primitives,
not only a copied colour or isolated card screenshot.

A hosting invitation belongs only where the article's purpose and approved scope
support it. Forward Debate's “Want a debate in your community?” is not an automatic
CTA for every video or article. Its contact path must carry the hosting purpose;
a generic footer link must not invent one. Test editable subject/message, account
email, unknown keys, deliberate clearing, navigation, failed-send retention and
account changes without sending a real message.

## 9. Acceptance matrix

Keep this matrix in the task's existing plan with result, evidence and remaining
limits. “Not applicable” names why; it does not silently waive a promised feature.

| Area | Evidence before release | Live acceptance |
| --- | --- | --- |
| Meaning and scope | Approved kind, address, titles, claims, sources, dates and actual holds; no unsupported quotes | Reader can reach the intended complete article, with the same meaning |
| Partial assets | No assets, transcript-only, chapters-only, video-only and combined states omit unavailable sections and broken actions | Only accepted supplied sections appear; no preparation prose or download offers |
| Media edition | Manifest, source map, measured duration, matching retained words/speakers/paragraphs/chapters, uncertainty and caption readability limits; any reading omissions have exact reasons and unchanged source/captions/video | Real public video advances; opening/middle/late seeks and supplied captions work on desktop and phone; record sampled limits |
| Initial HTML/search | Useful article and complete accepted reading edition, truthful **Edited transcript** heading when applicable, 1 H1, accurate metadata, bare canonical, correct image and breadcrumb/return; unsupported video data absent | Raw public response and mounted app agree; page/image/player URLs work; sitemap index and video child are healthy |
| Startup continuity | Gated real built-app startup retains iframe/context/state, header focus and real deep scroll; reader input cancels pending restoration | Early play survives app startup without restart; comments/footer loading does not steal reading position |
| Timed/topic navigation | Boundary/malformed times, clean copied links, same-frame seek, no-time history, direct fragments and ordinary client entry | Keyboard/mouse/touch topic and copied links, reload, Back/Forward, departure/return land correctly without reset or clipped focus |
| Design and collections | Shared approved states, actual siblings, all layout bands, 320px, wrapped/enlarged text, reduced motion, safe separate card actions | Full-card pointer/Enter paths, 1 visible keyboard outline, no overflow, correct order/date and contextual return |
| Contextual contact | Known purpose/source resolves locally; editable subject/message/account email; no personal URL fields; unknown/generic/cleared/draft/account boundaries | Open approved CTA, edit safely, navigate Back and return; no real send for acceptance |
| Recovery and comments | API/player block, copy failure, sign-in failure/dismissal, normal root after departure; loopback test guards block real writes/auth/metrics | Existing safe comments and recovery paths remain usable; distinguish untested signed-in submission |
| Release | Focused tests plus required current-head checks and independent source/browser review; normal protected merge and exact deployment identity | Parent and fresh reader review changed flows at the deployed address, resolve findings and record limits |

Use the existing focused replay/startup browser suites and metadata/sitemap tests
when changing those paths. Add a regression for an actual reproduced failure, then
test the real full app: a standalone renderer can miss startup, hidden-root styles,
history and scroll failures. Keep test traffic on loopback with explicit synthetic
comments and blocked writes/auth/metrics. Do not accept a fake player as playback
proof or let a browser test drift onto old public content before release.

## 10. Release, measure and retain

Follow the existing normal release checks for the actual change. Review the final
diff, reconcile owning decisions and source comments, run focused checks, then
required checks on the exact current head. Independent review starts acceptance;
a worker completion message is not proof. Fix material findings and repeat affected
checks. Use the protected merge route without bypassing failed checks. Match the
deployed identity, exercise actual changed reader paths and finish required issue
and delivery records before calling the outcome complete.

Keep the task's branch, working folder, original files and useful preview available
for follow-up. Completion does not authorise cleanup. Preserve private coordination,
credentials, session identities, account details and raw authentication addresses
outside committed repository notes.

Before release, note a modest measurement plan using only existing authorised
aggregate site analytics, Search Console and YouTube reporting. Record baseline,
date range, report freshness, sample/denominator and known attribution limits.
Separate a healthy discoverable address from actual indexing, impressions, clicks
and viewing. Compare after enough provider reporting time; do not promise ranking
or attribute a change to 1 edit without evidence. Use existing bounded free search
health machinery; no new paid recurring AI schedules, per-person watch tracking or
unrequested outreach are part of this workflow.

## Reusable brief

Copy this into the existing task plan and complete it before briefing a builder:

```text
Purpose and case: [before-event / after-event / ordinary text / ordinary video]
Reader's main task: [read / watch / attend / other approved action]
Public address and stable preview: [exact URLs; existing links to preserve]
Article kind and owning decisions: [links; latest explicit corrections]
Authorised finish and holds: [private, website, YouTube, media edits, external sends]
Facts and uncertainty: [primary sources, names/status, disputed passages, disclosure]
Dates: [event with timezone; first article; meaningful update; video first publication]
Available assets: [final edition ID, manifest, originals, obsolete files, missing inputs]
Timing: [source-to-final map, measured duration, display rounding, chapter source]
Reading edition: [complete source retained; exact omissions/reasons if edited; original times]
Presentation: [H1/search title/intro/image/brand, approved component and all states]
Discovery: [canonical, initial HTML, internal links, real schema/sitemaps if eligible]
YouTube: [channel, visibility, title/description/chapters, captions, thumbnail, playlist]
Actions: [supporting downloads allowed; no video/transcript downloads; scoped fallback]
Contact if appropriate: [trusted purpose/source key, editable defaults, generic fallback]
Ownership: [separate writers, media/upload/release owners, independent reviewer]
Checks: [applicable matrix rows, actual playback/phone/history, safe test boundaries]
Release: [required current-head checks, normal merge, exact live proof, record closure]
Measurement and retention: [existing reports only; limits; retained folder/branch]
```

## Forward Debate reference and limits

[forward-debate-replay-preview.md](forward-debate-replay-preview.md) records this
case's implementation and media evidence;
[published-writing-decisions.md §2.16](../architecture/published-writing-decisions.md#216-events-reuse-the-blog-design-and-retain-a-permanent-address)
owns its approved public behavior. The final producer handoff was
`ForwardDebate-handoff.md`, with matching final video, SRT, transcript Markdown,
turn JSON, chapter CSV, thumbnail JPG and description text. Later acceptance records
supersede the handoff's earlier “not uploaded” status.

The full source edition has 100 turns; the accepted edited website reading edition
retains 88. The clarification at 3954.78 seconds and meaningful unknown-speaker turn
at 6769.98 seconds remain. The source video, captions and original timestamps stay
unchanged. These counts describe this case, not a target omission rate.

The final edition's 7401.85-second measured duration, 28 chapters,
1.15× crop, 60fps export, roughly 29GB upload, 5-second title and 20-second end card
are case facts, not future defaults. Some producer counts and readability claims
were corrected by inspection, as retained in
[forward-debate-replay-preview.md: accepted text edition](forward-debate-replay-preview.md#accepted-text-edition-19-october-2026).
The disputed closing passage remains unclear. This workflow does not assert whole
recording listening, complete transcript accuracy or a new check of supplied PDFs.
