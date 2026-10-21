# Short 01: name-tag repair and prepared v3

Prepared October 21, 2026. This repair fixes the known cut-boundary defects without changing
speech, source timing, crops, caption wording, design or sound. No upload, Drive mutation or
publication occurred. The posting task owns destination preview checks, verified backup and
live-state records. The user has requested starting the short rollout; old preparation holds
are not a new prohibition, and unresolved checks are not silently passed.

## Exact candidate and preserved inputs

Local file: `$ALETHICAL_MEDIA/shorts/01-We-Disagree-We-Can-Still-Grab-a-Beer-v3.mp4`, where
`ALETHICAL_MEDIA=~/Movies/Alethical/forward-debate-2026`.

- 27,017,469 bytes; SHA-256 `9dba7706b97af5812be57f83d20205d2845d0c193ec67236a83ffada902fd14d`.
- 29.800 seconds, 894 frames, 1080x1920 at 30 fps, H.264 High, stereo AAC 48 kHz.
- Source SHA-256 `81589c34d8ae50c704f1622bfe030e9930c51f691b9a1534cd56af6708d4f680`.
- Frozen v2 reference SHA-256 `33cae6382600d17ab05b9d62108cfed5e7936134315f1d1ee6d2ea7e2f7f2581`.
- Source and reference hashes matched before rendering. All 87 saved overlay, intro, sound and
  caption inputs match their inventory hashes. [Input evidence](short01-v3-inputs.json).
- `short-01/render-v2.py` preserves the prior renderer exactly; `render.py` is the repair.
  The earlier `render-initial.py`, old outputs and source remain preserved.

The source passage stays recording 6999.71–7023.71, published 6960.65–6984.65.
The short keeps its 1.8-second intro, 24-second passage and 4-second closing card.
Shot order, crops and actual reaction timing remain Aaron, Trent, Angel, Aaron, as recorded
in [the production record](../README.md#short-01-we-disagree-we-can-still-grab-a-beer).

## Cause and correction

The renderer rounded each shot to 30 fps and joined the shots, then enabled name overlays using
planned decimal times. The next picture could arrive 1 frame before its tag boundary.
Name overlays now belong to each first-appearance shot before those shots are joined.
Aaron's first tag remains 6 seconds; Trent and Angel retain their full short-shot tags;
Aaron's returning shot has no repeated tag.

| Output frame, 0-based | Frozen v2 | Prepared v3 |
| --- | --- | --- |
| 280, 9.333 s | Trent, no tag | Trent with Trent tag |
| 373, 12.433 s | Angel with Trent tag | Angel with Angel tag |
| 424, 14.133 s | Aaron with Angel tag | Aaron without repeat tag |

## Evidence and acceptance

- Full package inventory check passed after the repair records were added; existing source and
  frozen-reference hashes still match. Backup fields were preserved, not re-certified.
- [Raw-filter comparison](short01-v3-lossless-comparison.json): exactly frames 280, 373 and 424
  differ before lossy encoding. All other picture hashes and PCM audio packet hashes match.
- [Export comparison](short01-v3-comparison.json): duration, stream facts and packet timing
  match exactly. All 1,430,528 stereo sample frames match with 0-sample offset and 0 peak/RMS
  difference. 815 of 894 decoded picture frames match exactly; compression propagates changes
  into 79 frames. That propagation is distinct from the 3 changed raw frames.
- [Name-tag check](../short-01/check_name_tags.py): white name glyphs are compared inside each
  saved name's bounding box, using output-frame cut bounds established from the pictures.
  It covers 366 frames, 60–425; the initial fade is excluded. The
  [v2 baseline](short01-v2-tag-regression.json) fails exactly 280, 373 and 424; the
  [v3 result](short01-v3-tag-regression.json) passes every checked frame.
- [Visual samples](short01-v3-visual/frames.json): 83 selected frames across 10 sheets,
  including every saved intro, tag, caption and closing transition plus the frames immediately
  before all 3 actual cuts. All 10 sheets were inspected at 360×640 per sample. Names, roles,
  captions and closing wording are readable and not clipped; name tags stay separate from captions.
  Aaron's longer role remains 1 line and visible for 6 seconds. No new visual defect found in
  these samples. Sheets are `short01-v3-visual/sheet-01.jpg` through `sheet-10.jpg`.

Reproduce the tag check with Python, numpy and Pillow installed:

```sh
python3 short-01/check_name_tags.py "$ALETHICAL_MEDIA/shorts/01-We-Disagree-We-Can-Still-Grab-a-Beer-v3.mp4" --out /tmp/short01-v3-tags-new.json
```

Reproduce the raw filter comparison with `short-01/check_raw_revision.py --source <sound-fixed.mov>
--out <new-report.json>`. It creates frame hashes without writing another video.

The tag check is not a check of speech accuracy. Real app controls, expanded descriptions and
phone playback were not inspected here. Listening was not performed; exact audio identity
shows this repair did not alter the retained sound, not that every spoken word is independently
verified. The existing uncertain speaker of “We have before, yes” remains unresolved; name
badges identify the person pictured, and do not settle that speaker attribution. The approved
caption-only omission of “As evidence today” remains; its audio stays. Silent intro, role
wording and the existing closing sound remain unchanged. No new thumbnail was made.

The candidate has no verified Drive backup yet. Its hash is retained here and in the input
record; it is not added as a recoverable media entry until backup and restore details are known.
The frozen v2 Drive reference remains the recovery target. Do not run `make_inventory.py` over
new local candidate media expecting it to silently treat an unbacked file as recoverable.

## Acceptance checkpoint

The primary agent sampled sheets 04, 05, 06 and 10, reviewed the renderer logic and repair
record, and accepted all 3 cut-tag corrections. The closing still points to YouTube.
Native preview, backup and publication remain unfinished. This is a local repair checkpoint;
no push past the existing security gate and no cloud mutation are included.

The latest direction prioritizes the Alethical website on every suitable surface. Review the
existing YouTube-first closing destination during the upcoming short preparation review against
that direction and each destination's working clickable route. Do not silently publish this
checkpoint as a YouTube-first final. No closing redesign or new render is part of this repair.

## Copy and identity handoff

Suggested summary: Aaron Brutger says that he and Trent Dilks can strongly disagree and still
share a beer. The exchange argues for disagreeing without hostility and putting Minnesota first.
This summary does not attribute the uncertain brief reply.

On-screen wording remains:

- Aaron Brutger / Republican-endorsed write-in candidate
- Trent Dilks / DFL-endorsed candidate
- Angel Zierden / Moderator, Alethical
- Closing: Watch the full debate / YouTube / @Alethical

Accompanying copy must use the working replay route for each destination, the names/accounts
verified there and the current [social rules](../../../social-publishing.md). On YouTube Shorts,
attach the existing full debate as the related video when available; do not duplicate the long
video. This record does not prove those account features are enabled.
