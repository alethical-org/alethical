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
existing comments. No final recording, captions, transcript, chapters or video
thumbnail have been received. Their absence creates no reader-facing section.
Claude conversation **Forward Debate video enhancement**
(`local_6648d2c8-2631-495e-94bc-3b1876c2b9b0`) owns media preparation.

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
chapters-only and combined inputs; one H1; original publication date; comments;
PDFs and historical content; bounded deep links; no autoplay; disclosure and preserved
uncertainty; metadata/sitemap omission until supported. Browser checks cover 320,
390 and 1280px, keyboard focus, copy, Back, blocked-player fallback and overflow.
Final recording playback and captions remain open until real assets arrive.

Primary references: [Google video guidance](https://developers.google.com/search/docs/appearance/video),
[VideoObject guidance](https://developers.google.com/search/docs/appearance/structured-data/video),
[YouTube iframe API](https://developers.google.com/youtube/iframe_api_reference),
[YouTube chapter rules](https://support.google.com/youtube/answer/9884579).

## Current acceptance checkpoint

Public layout passed independent Chromium inspection at 320, 390 and 1280px:
heading, omission of unavailable content, history keyboard opening, loaded flyer,
PDF links, no overflow or page errors. The historical Luma source link was restored
from review. Focused section, metadata, endpoint and player tests pass. Release
checks, full-app comments and live acceptance remain in progress. The final video
cannot be accepted from this local renderer alone.
