# Short 02: Flock cameras

Private preparation only. No publication, scheduling or social upload. Earliest permitted publication is October 22, 2026; readiness and publication review still apply. The current draft retains uncertainty and is not an accepted final edition. Short 01 stays unchanged.

## Reader and scope

Show Minnesota Senate District 13 candidates Trent Dilks and Aaron Brutger answering Angel Zierden's question about Flock cameras. The title proposal, **Both candidates oppose Flock cameras**, describes their stated positions, not a finding about the cameras. Preserve Aaron's acknowledgment that some good has come from them. Direct viewers to the existing [full debate and supporting materials](https://www.alethical.com/blog/events/forward-debate-2026), not a duplicate full upload.

Apply the [shorts guide](../../shorts-guide.md), [blog publishing guide](../../../blog-publishing.md), [social guide](../../../social-publishing.md) and [full source handoff](../text/ForwardDebate-handoff.md). Selection 2 in the [selection record](../selection/forward-debate-shorts-selects.md) carries unresolved opening/ending wording; this draft marks rather than guesses it. Source claims stay attributed to the speakers.

## Inputs, clocks and shots

The source is `ForwardDebate-sound-fixed.mov` in the [approved media locations](../README.md#media-backup-destinations), SHA-256 `81589c34d8ae50c704f1622bfe030e9930c51f691b9a1534cd56af6708d4f680`. Source retained continuously: **3100.640–3185.240**, or published **3061.580–3146.180**. The source is not overwritten. This extends selection 2's end by 0.72 seconds to retain the final word and room before the next question. No interior audio cuts, time shifting or speech reordering.

| Section | Short clock | Source clock | Treatment |
| --- | --- | --- | --- |
| Intro | 0–1.8 | None | Exact frozen short 01 silent logo intro, reused provisionally for this private draft |
| Angel's question | 1.8–5.8 | 3100.64–3104.64 | Angel crop x=497 |
| Trent's answer | 5.8–49.8 | 3104.64–3148.64 | Trent crop x=1592 |
| Aaron's answer | 49.8–86.4 | 3148.64–3185.24 | Aaron crop x=1132 |
| Closing | 86.4–90.4 | None | Reused closing style, website-first `alethical.com` destination |

All crops are 506×900 at y=430, scaled to 1080×1920. Source frame sheets at 2-second spacing show seats, microphones, faces and movement throughout the passage. Keep the speaker on screen; no reaction is relocated or invented. Angel finishes the question before the cut to Trent; Aaron raises his microphone at his cut. Output-frame boundary review is a separate acceptance check.

Names appear once: Angel Zierden / Moderator, Alethical (4 s), Trent Dilks / DFL-endorsed candidate (4 s), Aaron Brutger / Republican-endorsed write-in candidate (6 s). This draft gives each actual role reading time; these durations are clip-specific. Names attach to shots before joining, preserving the short 01 boundary repair.

## Captions and uncertainty

[caps.json](caps.json) uses the published clock; [captions.srt](captions.srt) uses the short clock. Timings use retained source word anchors, with complete phrases regrouped at source word boundaries. All spoken audio remains. Caption text combines the held full transcript with the retained word-time sources, adds conservative uncertainty marks for conflicts, and preserves substantive qualifications. No new machine transcription or paid run occurred.

The saved machine transcripts disagree or remain garbled in these spans. These marks do not claim a listening review. No supported listening/transcription tool was available in the preparing helper; source audio excerpts and the finished draft permit the managing task to review the actual sound. Do not turn a plausible correction into a verified quote.

| Source clock | Short clock | Draft text / unresolved wording |
| --- | --- | --- |
| 3106.90–3107.84 | 8.06–9.00 | `[unclear] no.`: opening rendered as Flock or profanity in different retained sources |
| 3120.86–3121.22 | 22.02–22.38 | Minnesota `[unclear]` have: does / doesn't conflict |
| 3145.14–3147.18 | 46.30–48.34 | Flock `[unclear]` I `[unclear]`: final clause garbled |
| 3150.34–3150.94 | 51.50–52.10 | `[unclear]`: possible brief lead-in not shared by retained sources |
| 3174.56–3175.56 | 75.72–76.72 | `[unclear]`: possible “you know” lead-in |
| 3178.02–3178.30 | 79.18–79.46 | `[unclear]` of privacy: invasion / evasion conflict |
| 3183.90–3184.52 | 85.06–85.68 | does not `[unclear]`: “upset that” is garbled; no substitution with an inferred phrase |

Aaron's **“some good has come from it”** remains at short 76.74–78.58. “And individual rights” is retained from the full transcript and turbo word source, although one word source omits it. “It will only be used” follows the retained majority wording. The full source transcript is not rewritten by this clip-specific draft.

## Picture and sound treatment

Reuse the approved short 01 title, caption and name styles, frozen intro images and exact closing WAV. The website-first closing changes destination wording only: `Watch the full debate` / `alethical.com`. The accompanying posts carry the exact replay URL or working bio/related-video route. This frame's route still requires preview review; a printed domain is not a clickable link.

The 1.8-second silent intro is retained as a private draft choice, not a new universal intro policy. Closing sound is the exact saved `../short-01/assets/closing-sound-elevenlabs-upbeat-celebratory-1.wav`, attenuated 6 dB, faded at 3.4–4 seconds. Debate picture fades over the last 0.5 seconds; speech fades only for the final 0.05 seconds, after the latest retained final-word anchor. Timing/level measurements cannot prove heard wording.

## Acceptance and handoff

Production owns source preservation, render, caption/overlay fit, every cut/tag transition, audio/timing checks, cover and verified local/Drive receipts. The managing task owns final listening opportunity, native controls/preview, platform account limits, names/links/hashtags, approval and later publication. None of those is claimed complete by preparation. Do not upload or schedule this draft socially. Keep the security push hold in force; local scoped commits only.

## Prepared draft v2

`02-Both-Candidates-Oppose-Flock-Cameras-draft-v2.mp4` is the current review file, 90.400 seconds, 2,712 frames, 1080×1920 at 30 fps, H.264 High / AAC stereo 48 kHz. [Checks](checks.json) cover 208 transition frames in 18 sheets, all inspected, including the actual shot cuts at frames 174 and 1494. Caption overlays stay within x=70–900 and y=1290–1476. The Minnesota uncertainty cue uses 64 px; others use 66 px. The 5 orphan fragments from v1 are regrouped into readable phrases at source word boundaries. V1 and its inputs remain private local review history, outside active media; v1 is not backed up or offered as current.

[Sound measurements](audio-checks.json) show exactly 4,060,800 stereo frames in source and output debate passages, zero-offset correlation 0.999719, with final-word RMS ratio 0.99746. The speech fade starts 0.67 seconds after the final retained word anchor. Closing sound RMS is 3.55 dB below the debate passage. This proves timing/level preservation through AAC encoding, not heard wording.

The cover is `02-cover-draft-v2.jpg`, extracted at short 3.0 seconds. It shows Angel asking the actual question with readable title, name and question; it does not assign a candidate's answer to her. [Platform drafts](platform-drafts.md) cover all 7 destinations, preserving the website-first or actual working route. The shorter hosting contact fits X (274 weighted characters) and Bluesky (298 characters). Native mentions and hashtag suggestions still need the real posting interface.

The exact current video, cover, recipe and 4 source-audio review excerpts are listed in [backup-receipt.json](backup-receipt.json). Backup status is established only by its matching size/hash receipts. No social upload, schedule or publication occurred. Native controls, any final listening result, acceptance of uncertainty and later publication remain with the managing task.
