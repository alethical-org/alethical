# Private Forward Debate replay preparation

Net: The replay is prepared privately while Claude produces the final branded
video and matching text. The public announcement stays unchanged.

Owner: Codex task **Plan debate video blog SEO**
(`01a15451-acb6-7a72-9607-bd86b878c5f9`). Work is tracked in
[Prepare private Forward Debate replay pending final media](https://github.com/alethical-org/alethical/issues/2625).
Working folder and branch are retained for follow-up; the private preview is a hold
on cleanup. Final media integration and publication are not completed by this change.

## Approved boundary and retained intent

The user first held building, then authorized “ok biuld everything else” after
agreeing to a private replay preview while Claude prepares the media. This permits
the supporting code and private preview, not publishing unfinished media. Public
video/transcript download offers are excluded. Existing candidate-guide and money-report
PDF links remain available. YouTube will host the full video; social links should
lead readers to the permanent Alethical address.

[published-writing-decisions.md §2.16 (event announcements)](../architecture/published-writing-decisions.md#216-events-reuse-the-blog-design-and-retain-a-permanent-address)
owns the currently public announcement. This private extension reuses its type,
colours, links, spacing and return navigation. It does not change the public registry,
app route, first-response renderer, comments, analytics, sitemap or security policy.

## What is built

- Shared HTML renderer with video first, chapter links, full transcript in initial
  HTML, existing PDF materials, and preserved announcement text/flyer.
- Standard YouTube iframe, privacy-enhanced embed host, no automatic playback, at
  least 200px height, a YouTube fallback, bounded timestamp links and keyboard focus.
- YouTube API enhancement seeks without replacing the frame. Ordinary links still
  select the time when scripts fail. Copy links retain the current private address
  during review. Browser Back restores the selected time.
- Text input validation: escaped strings, valid media identity, matching export
  IDs, bounded/sorted timestamps and chapter lengths. Fractional or overlapping
  speaker turns are retained. Checking flags describe editorial work, not proof
  that code reviewed speech.
- Video metadata and sitemap generators that reject incomplete publication data.
  The event date, article date and actual video publication time are separate.
  These generators are not wired into production or emitted by the private preview.
- Loopback-only preview with no-store, search exclusion, foreign Host/Origin rejection,
  restricted frame/script permissions, no sign-in controls and no analytics.

## Run and supply content

From `apps/frontend`, with the repository's pinned Node version:

```sh
node scripts/preview-event-replay.mjs
```

Open `http://127.0.0.1:4186/blog/events/forward-debate-2026`. Keep this address stable
for review. Without supplied content it honestly shows media pending. The separate
`http://127.0.0.1:4186/__replay-example` uses YouTube's official API example and
clearly labelled illustrative text; its 60-second sample timeline is not the
demonstration video's duration or the debate transcript. It cannot enter the app
registry or sitemap through this runner.

Set `REPLAY_CONTENT_JSON` to an absolute private JSON path to preview supplied
content. The input shape is defined by `EventReplay` in
[eventReplay.ts](../../apps/frontend/src/lib/eventReplay.ts); the test fixture shows
the shape, not publication-ready content. Keep unfinished real media inputs outside
Git and restart the preview after changing inputs. The runner deliberately refuses
invalid content rather than silently displaying an older recording.

The replay schema includes the YouTube ID, final duration, stable export identifier,
caption check/upload status, checked transcript turns, chapter titles/start seconds,
and thumbnail URL/description/dimensions. Every timed asset names the same export.
Text, media availability, embedding permissions and actual caption synchronization
must still be inspected against the delivered files; matching identifiers alone
cannot establish that a transcript is accurate.

## Remaining work owned by this task

1. Receive the final video, UTF-8 SRT, readable speaker-labelled transcript,
   chapter list, thumbnail, edit notes and any unresolved passages from Claude.
2. Normalize the supplied text into the replay input, retaining uncertainty and
   speaker meaning. Check final timing at the beginning, middle, end and every cut.
3. Obtain the actual YouTube address/publication time; test embeddability, captions,
   real duration, thumbnails, keyboard playback and chapter jumps on phone/desktop.
   Upload or publication needs its own applicable authorization.
4. Replace sample/pending content at the same private preview address and review the
   finished article. Update governing public requirements only with publication
   authorization. The public announcement remains unchanged in this change.
5. Once release is authorized, wire the shared renderer/controller into the app
   and first HTML response together, choose the final thumbnail, activate truthful
   metadata and video sitemap, and scope the real site's frame/script policy to
   YouTube. Avoid double-loading the iframe during app hydration. Preserve existing
   comments and privacy choices. Confirm the actual live result before completion.

## Impact, prevention and acceptance

The opportunity is to make a long recording readable and navigable at an existing
event URL. A changed intro or cut can shift every caption and chapter. Matching
export IDs, one chapter source for visible links and structured data, bounds checks
and final media inspection address that shared risk. The currently public event and
other articles are unaffected because no production entry point imports this code.

The supplied source recording and transcripts remain untouched. No attendance,
candidate statement or video publication date is inferred from the announcement.
No live security policy is loosened for a private preview. No new service,
subscription, recurring AI check or watch tracking is introduced.

Checks: focused input/HTML/metadata tests; unchanged event regression tests;
TypeScript; rendered browser checks at 320, 390 and 1280px; keyboard activation,
copy feedback, Back, blocked-player fallback, complete transcript text, minimum
player height, overflow and private headers. Independent review exercised real
YouTube example playback controls and identified corrections for neutral seek
feedback, equal timestamps and avoiding a future announcement self-link. Those
corrections are included and covered by tests. Real debate playback and caption
quality remain pending the final files. Search indexing is not guaranteed and is
not a completion gate.

Run the focused checks from `apps/frontend`:

```sh
pnpm exec vitest run src/lib/__tests__/eventReplay.test.ts src/lib/__tests__/eventMetadata.test.ts src/lib/__tests__/events.test.ts
pnpm exec tsc --noEmit
pnpm exec playwright test --config playwright.replay.config.ts
```

Tier selection: bounded existing-design build with a private release boundary and
deterministic browser/input checks; `gpt-6.1-sol` with `high` effort selected.
The strongest credible alternative, `gpt-6-astra`, offers no established task-specific
quality advantage for this scoped implementation. This is task judgment, not a
comparative performance measurement. Claude's earlier approach consultation used
`claude-opus-5-5` at `high`; 2 returned rounds accepted the approach after source review.

Primary references: [Google video guidance](https://developers.google.com/search/docs/appearance/video),
[VideoObject guidance](https://developers.google.com/search/docs/appearance/structured-data/video),
[YouTube iframe API](https://developers.google.com/youtube/iframe_api_reference),
[YouTube chapter rules](https://support.google.com/youtube/answer/9884579),
[W3C transcript guidance](https://www.w3.org/WAI/media/av/transcripts/).
