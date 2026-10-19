# Forward Debate public article and media integration

Net: Publish the event article at its permanent address and add accepted media
sections independently. No unfinished-content messages appear to readers.

Owner: Codex task **Plan debate video blog SEO**
(`01a15451-acb6-7a72-9607-bd86b878c5f9`). Tracking:
[Forward Debate public article and media integration](https://github.com/alethical-org/alethical/issues/2625).
Working folder `debate-replay-preview` is retained for follow-up and its existing
preview address remains `http://127.0.0.1:4186/blog/events/forward-debate-2026`.

## Intent and current delivery

[published-writing-decisions.md §2.16 (permanent event articles)](../architecture/published-writing-decisions.md#216-events-reuse-the-blog-design-and-retain-a-permanent-address)
owns the public behavior. Website release is authorized. The current release
contains the factual article, PDF materials, historical announcement/flyer and
existing comments. The Minnesota Forward Together logo appears once above the title,
linked to Forward Coalition's candidates and visible while the original announcement
is closed. The shared event renderer uses the same branding in announcement and
post-event output. The final media edition was supplied on 19 October. The article
now includes its 100 transcript turns, all 126 supplied paragraphs and 28 topic
headings. The accepted thumbnail supplies the social preview image. No recording
player or video search details appear until an actual YouTube upload is available.

The website build uses `gpt-6-astra` at `high`; the scope includes interdependent
server/browser output, search metadata, player permissions and independent acceptance.
This selection is task judgment, not a comparative benchmark. The accepted media
approach was reviewed in the named Claude conversation at Fable 5.1 High.

## Implementation and inputs

[eventReplayContent.ts](../../apps/frontend/src/lib/eventReplayContent.ts) supplies
only accepted public content. [eventArticle.ts](../../apps/frontend/src/lib/eventArticle.ts)
selects the shared renderer and metadata for both the server and React paths.
[eventReplay.ts](../../apps/frontend/src/lib/eventReplay.ts) validates supplied
sections, a shared final export identity, real duration, sorted/bounded speaker
turns, chapters and image URLs. Fractional durations and overlapping turns survive.
Checking speech is not a boolean publication gate. The transcript carries the exact
approved machine-text disclosure and preserves marked uncertainty.

Each supplied section renders independently. Without a video, transcript times are
plain text; chapter navigation can still link to transcript headings. With video,
ordinary timestamp links work before or without the player API. Copy and enhanced
seeking are optional. Video search details require actual publication facts;
missing facts omit VideoObject and the video sitemap without hiding the article.
One chapter list drives visible topics and Clip data. The article canonical excludes
query timestamps. No invented video content URL, upload time or ranking promise.

The global browser security policy permits only the privacy-enhanced YouTube frame
host and the official player API/script paths. This supports navigation from an
already-loaded article without weakening other directives. No extra watch tracking,
paid player, subscription or recurring AI run is introduced.

Run `node scripts/preview-event-replay.mjs` from `apps/frontend`. The local preview
uses the public presentation and retains loopback binding, foreign-origin rejection,
no-store and noindex headers. Its separate `/__replay-example` fixture is explicitly
illustrative and never enters production content. `REPLAY_CONTENT_JSON` can supply
a private input for acceptance. Restart after input changes. Keep source media intact.

## Sequenced delivery and completion checks

1. Build the public article and optional media integration, update owning decisions,
   test absence/partial/full inputs and preserve the existing preview address.
2. Independently review the change and working phone/desktop experience; fix material
   findings. Run required checks, publish through the normal reviewed release path
   and inspect the live article. Retain working folder and branch for follow-up.
3. On receipt of Claude's final media, inspect the actual export, captions, transcript,
   chapters, thumbnail and edit notes. Match the final timeline and export identity;
   retain uncertainty. Never require Eugene to listen or infer checked speech.
4. Add available accepted sections and actual YouTube publication facts, then repeat
   real playback, caption timing, keyboard/phone, timestamp/Back/copy, direct-entry
   and client-navigation checks. The current app replaces its initial HTML on startup; preserve the player
   outside that replaced area before adding real video, and test early playback.
   Inspect the server-to-React player transition with the actual recording; static fixture checks do not establish uninterrupted playback.
   Do not publish a player that restarts early playback during that transition.

## Impact and prevention

A changed media edit can shift every timed asset. Shared export identity, duration
bounds and a single chapter input prevent mismatched publication. Initial/browser
rendering shares the same source; independent media states are tested so missing
assets cannot restore preparation prose or broken links. Escaping protects imported
speaker and transcript text. Source copies remain untouched. Historical invitation
status is preserved, with no invented attendance or candidate positions.

Acceptance covers public output without assets, video-only, transcript-only,
chapters-only and combined inputs; one H1; event-held and updated dates; original publication metadata; comments;
PDFs and historical content; bounded deep links; no autoplay; disclosure and preserved
uncertainty; metadata/sitemap omission until supported. Browser checks cover 320,
390 and 1280px, keyboard focus, copy, Back, blocked-player fallback and overflow.
Final recording playback and captions remain open until real assets arrive.

Primary references: [Google video guidance](https://developers.google.com/search/docs/appearance/video),
[VideoObject guidance](https://developers.google.com/search/docs/appearance/structured-data/video),
[YouTube iframe API](https://developers.google.com/youtube/iframe_api_reference),
[YouTube chapter rules](https://support.google.com/youtube/answer/9884579).

## Current acceptance checkpoint

The article without media passed independent Chromium inspection at 320, 390 and 1280px:
heading, omission of unavailable content, history keyboard opening, loaded flyer,
PDF links, no overflow or page errors. The original article and subsequent title-logo
change passed live acceptance. Transcript release checks and live acceptance are
the current step. The final video cannot be accepted from this local renderer alone.

The visible date line uses “Debate held October 15, 2026 · Updated October 19, 2026”.
This distinguishes the event from the article revision without presenting the old
announcement date as a new video publication. Original article metadata stays intact.

### Accepted text edition, 19 October 2026

The source package is `ForwardDebate-handoff.md` and the 7 matching final media files
in the operator's Downloads folder. Source copies remain unchanged. The website
edition is `forward-debate-2026-final-2026-10-19`, with actual MP4 duration 7401.85s.
The MP4 is not included in the repository or served as a download.

The 100 Markdown turn blocks match the 100 JSON turns after whitespace normalization;
speaker labels and display times also match. Import preserves the Markdown paragraph
breaks. All 28 headings match the chapter CSV and YouTube description. Chapter start
seconds are floored to the supplied whole-second display values; all turn-to-heading
assignments remain identical. Original fractional source times remain in the source CSV.
The committed JSON is the accepted public text input, not a separate transcription.

The 8 `[speaker uncertain]` labels and all `[unclear]` words remain. Aaron Brutger's
disputed closing line around 1:55:11 remains `[unclear]` and is never used as a quotation
or summary. The exact machine-text disclosure appears above the transcript. No claim
of audience anonymity is added. File-to-file agreement does not establish spoken-word
accuracy, and no listening task is assigned to Eugene.

Actual SRT inspection found 1659 nonoverlapping cues inside the final video, with at
most 2 lines of 42 characters. Contrary to the handoff's count of 5, the actual file has
2 cues shorter than 1 second. 20 cues exceed 30 displayed characters per second, with
the fastest at 52. This is a readability finding, not an external compliance threshold.
The supplied captions remain unchanged. A gap between caption cues does not establish
silence or word timing, so stretching captions into those gaps would not establish
better synchronization. The 20 fast cues remain a documented readability limit.
Real YouTube playback remains open; the MP4 needs no new format or encoding from
these findings. The 3-window alignment and full-file
decode reported by the media producer are producer evidence, not new listening checks.

The managing account is available in Chrome's Dev Team (Alethical) profile. The final
MP4 upload has started on `@Alethical`, channel `UC6Gof3CAuynOHxpH_Bl6fQQ`, video
`y66-Wf9bNio`. Public visibility is saved; the video remains pending while the upload
and processing run. Allow embedding and English are selected. Caption editing remains
unavailable until processing permits it. Actual publication facts, uploaded-caption
behavior and early-playback continuity are required before adding video to the article.

### Direct topic links after application startup

The full mounted application reproduced a direct `#topic-2983` visit at scroll position
0 instead of the named passage. The static article renderer alone did not expose this:
the scroll-restoration hook replaced the browser's fragment position with its default 0.
EventScreen now opts into initial-fragment restoration. A saved history position,
including an explicit 0, takes priority; a new visit finds the named heading inside its
own scroller. Malformed, missing and unrelated fragments retain the default behavior.
The event slug resets restoration when navigation reuses the screen for another event.
Other screens keep their existing behavior. Focused regression tests preserve these
differences, and acceptance includes the actual mounted application rather than only
the static preview. The separate stable-player implementation is described below; final-media acceptance remains unfinished.

### Stable-player implementation, acceptance pending

Video events retain the same server article and iframe outside the application's
replaced root. The real application still supplies its navigation, comments, sign-in
and footer through portals. Other entry paths render the ordinary EventScreen.
Keyboard focus on the static header moves to its matching real control at startup,
unless the reader has already moved focus elsewhere.
The direct-entry container keeps its own scroll area. The application's hidden
layout still measures normally; the existing password notice remains visible and
non-interactive. The native sign-in failure dialog has a separate visible,
interactive exception; ordinary sign-in dialogs retain their document-level placement.
Snapshot styling surrounds only the temporary header, so article styles match
ordinary client entry without higher-specificity snapshot overrides.
Route blur retires the container, and a fatal app error uses the same idempotent
retirement before showing the existing recovery screen. React effect replays reuse
the same per-iframe controller; only actual retirement or removal destroys it.

Same-screen timestamp Back/Forward preserves the route and iframe in both ordinary
and installed guarded history. In-flight editor traversals retain their existing
protection. The player uses the shared history writer, saves the outgoing position
before pushing, and only seeks on Back when a valid timestamp still names this event.
An entry without a timestamp does not rewind playback to 0.

Saved direct-entry positions restore through a small program after the completed
server article, before application startup. Its exact content hash is allowed by
the production security header and tested against the actual API-emitted program.
The application preserves any movement made before it starts. A saved position
beyond the initial article's extent remains pending while comments/footer load;
it never overwrites the saved target with a clamped position. Intervening reader
input, including focus, keyboard, touch, wheel and pointer use, cancels that pending restoration. Browser scroll anchoring as the real header appears does not cancel it.
Native content-size and DOM changes retry only that unresolved position.
An active comment return keeps its explicit discussion destination instead of
restoring an older saved reading position.

Focused tests cover same-frame effect reuse, real retirement, error cleanup,
history variants, exact script permission, early reading, deep comment positions
and intervening input. A private full-application check with the clearly labelled
YouTube demonstration preserved the same iframe and browsing context through delayed
startup, timestamp Back/Forward, sign-in and route departure. Those checks do not
establish final-recording playback or captions; both remain required before the
final video becomes part of the public article.

Plain transcript topic links also use separate application history entries after
startup. Back/Forward adopts the destination entry in the same visible article;
legacy native fragment entries without application state gain an owner before
restoring their contained heading. Saved exact positions take precedence for
separate entries. A legacy cloned entry can only recover its shared saved position
when it has no fragment. Headings receive keyboard focus and 12px clearance.
EventScreen supplies its known address to the hook and player, so a client visit
does not capture the previous route before navigation writes the new address.
A replacement scroll box restores its entry even when the screen hook survived blur.
Other hook consumers do not enable event-fragment history behavior.
A repaired stateless native entry starts a new local depth count at 0; event controls
do not use depth-based return jumps. Its one `replaceState` may also be recorded as
an in-site navigation by the existing speed beacon. Neither behavior is proof that
an additional reader navigation occurred. Enhanced topic clicks use distinct normal
entries and avoid that legacy repair.

The built-app startup regression runs in required frontend CI with locally supplied
sample player/API responses. Its 6 cases passed on October 19 and cover: iframe/context and
sample child state, keyboard focus and timestamp history; real deep scroll restoration;
Tab and wheel cancellation of pending restoration; computed article-style parity;
and ordinary native fragment Back/Forward, including return after another route.
The tests use actual browser layout and anchoring, not modeled scroll coordinates.
Parent browser acceptance also exercised blocked sign-in download, visible recovery
and Close, and matching heading/link/summary styles in stable and ordinary app entry.
Real final-recording playback, uploaded captions and public video metadata remain open.
