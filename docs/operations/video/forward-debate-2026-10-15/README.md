# The Forward Debate, October 15, 2026: production record

Minnesota Senate District 13 debate, Riverside Terrace, Sauk Rapids. Trent Dilks (DFL-endorsed candidate),
Aaron Brutger (Republican-endorsed write-in candidate), moderated by Angel Zierden, CEO and Founder of
Alethical. Jared Gapinski was invited and did not take part. Seating, confirmed against the flyer photos:
Angel Zierden left, Aaron Brutger middle, Trent Dilks right. The camera never moved.

Public edition: https://www.youtube.com/watch?v=y66-Wf9bNio (full video, 2:03:21.85). Page:
https://www.alethical.com/blog/events/forward-debate-2026.

This folder preserves the recipes and inputs for the full edition and shorts 01–02. The full-edition
rebuild remains untested; short recovery evidence is recorded separately. What lives where: [INVENTORY.json](INVENTORY.json). How to get the media back:
[restore.md](restore.md). How to rebuild: [rebuild.md](rebuild.md).

## Media backup destinations

- Drive: [Forward Debate 2026-10-15](https://drive.google.com/drive/u/1/folders/1tiaFKy0AEa_BtVeN57hzxvk2MemY-l3G).
- Local media root: `/Users/eug/Movies/Alethical/forward-debate-2026`, with suitable media subfolders.

Apply the [media storage rule](../shorts-guide.md#media-storage) to useful source, final and reusable
images/videos. Backup completion requires verified receipts for both locations; this destination
record alone is not proof that any new asset is copied. Existing removed/archive states remain
unchanged. [INVENTORY.json](INVENTORY.json) retains file locations and recovery evidence.

## Source files and what happened to the original

| File | Size | Status |
| --- | --- | --- |
| `ForwardDebate.MOV` (phone recording, HEVC 2652x1492 60 fps, stereo AAC + 4-channel APAC, created 2026-10-16 18:14:49 UTC) | 16.4 GB | deleted locally with `rm` on October 20, 2026, to save space |
| `ForwardDebate-sound-fixed.mov` | 15.9 GB | the single source for all editing; local and Drive; restored copy hash-matched in the recovery test |
| `ForwardDebate-original-audio-stereo.m4a` | 182 MB | the original's stereo track, extracted with `-c copy`; local and Drive |
| `ForwardDebate-original-audio-spatial-4ch.mov` | 357 MB | the original's 4-channel APAC track, extracted with `-c copy`; local and Drive |
| `ForwardDebate-YouTube-final.mp4` (the delivered edition, 29.3 GB) | 29.3 GB | deleted locally; the public copy is on YouTube; rebuild from this folder is untested |

What was proved before the original was deleted, and what was not:
- Proved: the picture stream of the sound-fixed copy is byte-identical to the original's.
  `ffmpeg -i <file> -map 0:0 -c copy -f md5 -` gave `e4ce17a48e2edf3bc036df0d0122af69` for both. The
  sound-fixed copy was made with `-c:v copy`, so this was expected and is now measured.
- Proved: both audio streams were copied out without re-encoding (`-map 0:1 -c copy`, `-map 0:2 -c copy`).
- Not established: the original container, its timestamps, metadata and orientation flags, and how the
  4-channel track is meant to be presented. The original's probe output from the first session is in
  [original-probe.txt](original-probe.txt).
- Not inspected: the macOS Trash (listing it returned "Operation not permitted"). The Drive folder was
  listed and holds no copy of the original; its earlier upload was stopped at 0% and the partial removed.
  No other location was checked, so this record says only that the original is not in the local folder
  or the Drive folder.

The sound fix, applied once to the whole recording (recording clock unchanged, picture copied):

```
ffmpeg -i ForwardDebate.MOV -map 0:0 -map 0:1 -c:v copy -tag:v hvc1 \
  -af "highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-45,dynaudnorm=f=250:g=15:p=0.7:m=12,loudnorm=I=-14:TP=-1.5:LRA=7" \
  -ar 48000 -c:a aac -b:a 192k -movflags +faststart ForwardDebate-sound-fixed.mov
```

Measured on the result: −14.5 LUFS integrated, 5.2 LU loudness range (the recording was −28.2 LUFS,
15.5 LU). The 4-channel track was left out of the sound-fixed file.

## Clocks

- Recording clock: the sound-fixed file (same as the original).
- Published clock: the YouTube edition. Kept footage is recording 44.06 s to 7420.88 s; a 5 s title card
  precedes it, a 20 s closing card follows. Inside kept footage, published = recording − 39.06.
- Short 01's clock: 0 to 1.8 s intro; 1.8 to 25.8 s debate, where short = published − 6960.65 + 1.8;
  25.8 to 29.8 s closing card.

## Full edition (YouTube)

Recipe in [full-video/](full-video/). The delivered edition's facts, every cut, the caption and
transcript method, speaker identification, and the uncertainty marks are in the handoff written for
the page build: [text/ForwardDebate-handoff.md](text/ForwardDebate-handoff.md). Its "nothing is uploaded"
paragraph and its `~/Downloads` paths are history from October 19; the video was uploaded by Codex on
October 20 and the files now live as the inventory says.

Settled on the full edition, in short:
- Picture: gentle 1.15x zoom (crop 2306x1297 at 147,195, scaled back to 2652x1492) centering the 3
  people with the windows kept; no color or brightness change. Approved treatment.
- Name labels above the heads, bigger size, 28 appearances (0:05 to 0:15, then 6 s at each chapter
  start); every frame of every appearance scanned for anything moving into a label box
  ([full-video/label-check-report.json](full-video/label-check-report.json)).
- Title card and closing card ([full-video/cards/](full-video/cards/)), half-second picture fades,
  20 ms sound fades at the joins.
- Captions: a separate SRT, not printed on the picture; 1,659 cues, 2 lines of 42 characters or fewer,
  built 2-of-3 from 3 machine transcriptions; 123 cues carry `[unclear]`; the reader note is
  "Uncertain words and speakers are marked."
- Chapters: 28 ([text/ForwardDebate-chapters.csv](text/ForwardDebate-chapters.csv)).
- Export: H.264 High, AAC 320 kbps, 2652x1492 60 fps, 35 Mbps target, BT.709.

## Short 01: "We disagree. We can still grab a beer."

Recipe in [short-01/](short-01/). Published v3: `shorts/01-We-Disagree-We-Can-Still-Grab-a-Beer-v3.mp4`,
29.800 s, 894 frames, 1080x1920 30 fps, stereo AAC 48 kHz, 27,017,469 bytes, SHA-256
`9dba7706b97af5812be57f83d20205d2845d0c193ec67236a83ffada902fd14d`.
The current recipe is `short-01/render.py`. Its name tags stay inside their own shots, repairing
3 cut-boundary frames. Speech, source bounds, crops, captions, design and timing are unchanged.
[Repair evidence and acceptance](verification/short01-v3-repair.md) cover this version.
The video and cover extracted at 3.5 seconds are retained locally and on Drive with matching hashes;
[backup receipt](verification/short01-v3-backup-receipt.json). The user approved the retained
YouTube closing and publication on all 7 platforms. Native previews and playback were completed
in the posting task. [Short 01 publication record](../../forward-debate-short01-record.md) owns
the live links, captions and remaining promotion work.

The frozen v2 reference is `references/short-01-33cae638.mp4`, SHA-256
`33cae6382600d17ab05b9d62108cfed5e7936134315f1d1ee6d2ea7e2f7f2581`, 27,017,223 bytes.
Its recipe is now `short-01/render-v2.py`; it preserves the original boundary defects and Aaron's
6-second first tag. Drive retains it as `01-We-Disagree-We-Can-Still-Grab-a-Beer-v2.mp4`.
The prior 27,018,433-byte version, SHA-256
`0c6df832e41ae610cfcf46dde703344f8d4cd3f1f1bb54a05297f95f254f2698`, remains on Drive as
`01-We-Disagree-We-Can-Still-Grab-a-Beer.mp4`, with recipe `short-01/render-initial.py`.
Both references stay preserved. The frozen v2 recovery test is historical evidence; v3 and its
cover are also included in the restore inventory. No fresh v3 download-and-render recovery test
is implied by the hash-matched backup.

Selection: ID 1 in [selection/forward-debate-shorts-selects.md](selection/forward-debate-shorts-selects.md),
whose proposed window was published 1:55:59.000 to 1:56:24.020 (a caption-window proposal). The edit
refined it to published 6960.65 to 6984.65 (1:56:00.65 to 1:56:24.65): start on "As evidence today"
rather than mid-sentence at "because truly", end after "first" finishes at 6984.25. Recording clock:
6999.71 to 7023.71. Boundaries come from word timing and a 10 ms loudness trace; no listening check was recorded.

Shots (published clock, crop x in the source): Aaron Brutger 6960.65 to 6968.2 (x 1132); Trent Dilks
listening 6968.2 to 6971.3 (x 1592); Angel Zierden smiling 6971.3 to 6973.0 (x 497); Aaron Brutger
6973.0 to 6984.65. Crop 506x900 at y=430, scaled to 1080x1920.

Captions ([short-01/caps.json](short-01/caps.json)): the reconciled words. The first phrase, "As evidence
today," is deliberately not captioned (its entry is parked at 6900.0, outside the clip) while its audio
stays. This caption-only omission is approved for this clip; it is not a general permission.

Name tags: Aaron Brutger / Republican-endorsed write-in candidate; Trent Dilks / DFL-endorsed candidate;
Angel Zierden / Moderator, Alethical. Aaron’s first tag runs for 6 s on the debate clock, short 1.8–7.8 s
(the picture fades in, so initial visibility ramps up). Trent and Angel retain their original timing
through their short shots. Nobody is named again on a later appearance.

Known attribution uncertainty: “We have before, yes” was described as most likely Aaron in the
editing session. Angel raised her microphone; the machine transcripts did not establish her reply.
No listening check resolved that speaker. The preserved clip is unchanged on that point; the
recovery test establishes reproduction, not correct attribution.

Closing sound: `short-01/assets/closing-sound-elevenlabs-upbeat-celebratory-1.wav`, ElevenLabs Sound
Effects, prompt recorded as history in [decision-inventory.md](decision-inventory.md); 4.0 s, prompt
influence 60%. The file is the sound.

Every correction, version and rejected approach: [decision-inventory.md](decision-inventory.md).

## Short 02: Flock cameras

[The private short 02 package](short-02/README.md) preserves the complete question and both answers,
including Aaron’s concession, with unresolved words marked. Its current draft v2 is 90.400 seconds,
with a website-first closing, a cover and 7 platform-copy drafts. Preparation does not approve
publication: no social upload or schedule, no publication before October 22, 2026.
[Exact backup receipts](short-02/backup-receipt.json) own local/Drive verification; native previews
and any further resolution of uncertain words remain separate.

## Verification record

All 15 short overlay images, 54 intro frames and 3 full-edition card images were compared with
the original inputs by SHA-256. A stale removed-logo template initially regenerated a broken-image
mark during the port; the original blank overlay was restored and the template made explicitly
empty. The frozen v2 recipe differs from the initial version in Aaron’s first tag duration only;
the current recipe additionally keeps tags inside their own shots;
output paths are explicit and existing outputs are refused. The saved text builder reproduces
the delivered SRT, transcript and turn list from saved transcripts; checks are retained in
[rebuild.md](rebuild.md).

Recovery test of the frozen v2 short: **tested-and-matched** from a fresh GitHub clone and Drive restore. All 894 decoded frames, decoded stereo audio and timing match exactly. See [the measured test record](verification/recovery-test.md) for evidence and the 2 existing single-frame wrong-person tags found at cuts. Those defects stay preserved in the reference; the separate [v3 repair](verification/short01-v3-repair.md) resolves them in the published v3.

## Package records

- [Selection archive](selection/README.md): candidate clips, context and holds.
- [Retained transcript](text/ForwardDebate-transcript.md): exact saved reading copy from the full edition.
- [Pre-render evidence](verification/pre-render-checks.md): saved inputs and script checks.
- [Recovery outcome](verification/recovery-status.md): tested recovery and remaining limits.
