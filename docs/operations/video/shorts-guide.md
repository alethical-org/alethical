# Short videos from a full recording

A reusable guide drawn from the Forward Debate short 01. The
[production record](forward-debate-2026-10-15/README.md) and
[decision inventory](forward-debate-2026-10-15/decision-inventory.md) separate user decisions, the exact
first-version template, later requested changes and unanswered suggestions. Template values help the
next editor start; they are not proof that every future clip needs the same sizes, timings or layout.
Nothing here approves posting.

The first-version MP4 is frozen with SHA-256
`0c6df832e41ae610cfcf46dde703344f8d4cd3f1f1bb54a05297f95f254f2698`.
The current version doubles Aaron's first name-tag appearance from 3 s to 6 s in clip 01 only.
It has SHA-256 `33cae6382600d17ab05b9d62108cfed5e7936134315f1d1ee6d2ea7e2f7f2581` and is
the recovery-test reference. Both versions are preserved; other tags keep their first-template timing. The request does not make 6 s a rule for other people or clips.

## 3 clocks

Every timestamp names its clock. Cards and retained passages have separate mappings.

| Clock | What it counts from | Forward Debate relation |
| --- | --- | --- |
| Recording | the start of the sound-fixed source file | 0 |
| Published | the start of the YouTube edition, with a 5 s title card after cutting 44.06 s of setup | published = recording − 39.06, only inside kept footage |
| Short | the start of the short, with its own intro | short = published − passage's published start + passage's short start, only inside that retained passage |

The [selection list](forward-debate-2026-10-15/selection/forward-debate-shorts-selects.md) uses
the published clock. The renderer converts its bounds to recording time. Added cards have no source
time. Map each passage separately if a future short has more than 1 retained passage.

## Reusable lessons

Source and framing
- For Forward Debate, use the sound-fixed recording, not the compressed, zoomed YouTube export. For
  another event, identify and preserve its best retained editing source before choosing a crop.
- Use a tall slice around the person on screen as the starting treatment for these shorts. Verify
  faces, movement and framing in the actual passage; the Forward Debate seat coordinates are not
  transferable to another recording.
- Show the speaker; cut to a listener when the real reaction adds meaning, then return. Preserve the
  reaction's actual timing and the exchange's order. Never move a reaction to create an agreement,
  disagreement or uninterrupted exchange that did not happen. Half-second frame sheets helped locate
  useful reactions in clip 01.

Speech and meaning
- Keep every word within the chosen passage, including qualifications and brief replies. Choosing an
  excerpt is allowed; removing words within it is not a way to sharpen an argument. Keep enough
  surrounding context for the excerpt to mean what it meant in the full recording.
- Use timed transcripts and sound-level traces to locate likely boundaries, not to prove wording or
  sentence meaning. Record the evidence used and any uncertainty. If a boundary cannot be established
  safely, retain context. Never claim listening occurred when it did not or assign the publisher a required
  listening task; record unavailable checks honestly.
- Let the final word finish at full volume. The picture may fade first; the speech must not fade
  early. Locate the end for each clip rather than copying clip 01's fade times.
- Use the retained full speech sources, not only the edited reading transcript. Keep uncertain words
  and speakers marked. A caption omission needs an explicit clip-specific decision; clip 01's omitted
  lead-in does not permit omitting other speech. Its audio was retained.
- The selection archive holds 29 transcript selects and 12 conditional reserves, not posting approvals.
  Titles are paraphrase proposals; caption anchors are machine-text search aids. Carry every hold,
  qualification and alternate cut into the brief. Keep candidate claims attributed; establish evidence
  before adopting them as explanatory facts in a title, caption or post.

Readable text and sound
- Keep the event-name title simple; accompanying post text carries the event details removed from the
  picture. Avoid small or repeated lines that add no useful meaning.
- Introduce each person once in a short exchange, with a readable name and role. Give the actual role
  enough reading time. The quick Trent-to-Angel cut in clip 01 needs no empty gap between tags; that
  correction does not prescribe tag timing at every cut in every clip.
- Keep captions apart from name tags and from the destination app's controls. Phone size and real
  controls decide whether placement works. The redundant green speaker label was removed from
  clip 01's cutaways; another exchange still needs unambiguous speaker identity.
- Keep the logo's growth smooth. Whole-pixel steps and shrinking artifacts caused visible shaking;
  drawing the intro frames at 8x size and shrinking them solved this example.
- Reuse the exact saved closing sound. Its generation prompt is history, not a recipe for the same
  audio. Measure its relationship to speech and record the result; a gain setting alone proves no
  relative loudness.

## First-version template for Forward Debate

These describe the archived 3-second-tag version. The current recovery reference uses the Aaron-only
6-second change stated above. Keep every value scoped to its version; render new outputs separately.

| Element | First-version value |
| --- | --- |
| Picture | 1080x1920, 30 fps; crop 506x900 at y=430 from 2652x1492; x: Angel 497, Aaron 1132, Trent 1592; Lanczos scaling |
| Title | THE FORWARD DEBATE, 74 px bold, centered in a dark rounded box; no district/date line |
| Names | 58 px name, 44 px role on 1 line, green left bar, top y=1022 at this recording's table edge |
| Name timing | First appearance only: 3 s, or to the cut when the shot is at most 3.6 s; see the current Aaron-only change above |
| Captions | 66 px bold, white on a dark rounded box, at most 2 lines; x=70 to 900, top y=1306, lowest bottom y=1472 |
| Intro picture | 1.8 s, symbol on #0a0a0a, width 496 to 570 px with even growth, fades 0.35/0.2 s; 54 frames drawn at 8x |
| Closing picture | 4 s; Watch the full debate, with debate green, 110 px; YouTube icon 150x106 above @Alethical at 76 px; centered, 100 px gap; no URL, Alethical logo or guide/report line |
| Closing sound | Saved ElevenLabs Upbeat, celebratory #1 WAV, input attenuated by 6 dB; fade out from 3.4 s over 0.6 s |
| Export | H.264 videotoolbox, 8 Mbps, AAC 192 kbps, BT.709, faststart; under 30 MB was a phone-delivery target for this sample |

Intro audio policy is in [Unresolved](#unresolved-not-defaults). Exact source bounds, cuts, fades and
caption omission belong to the worked example. Sizes and coordinates above do not establish that app
controls on all destinations leave them clear.

File names use a 2-digit selection ID and hyphenated title:
`01-We-Disagree-We-Can-Still-Grab-a-Beer.mp4`. No event prefix, "short" or "sample". Keep each delivered
version and its hash; render revisions separately before assigning a new version as current.

## Platforms

For accompanying copy, name links and publication, use the separate
[social writing and posting guide](../social-publishing.md).

Use the upright template as the starting file. Before posting to LinkedIn, Facebook, Instagram, X,
TikTok, YouTube or Bluesky, follow the current official-source checks in
[social-video-upload-limits.md](https://github.com/euglopi/tool-settings/blob/main/shared/guides/social-video-upload-limits.md), record the date and account
limits, and inspect placement under that app's controls. Do not claim 1 export meets all 7 platforms'
requirements without that evidence. A technical check is not posting approval.

## Fill-in brief for the next short

Link the reusable lessons and the exact template version; do not silently carry every clip 01 value
forward as a new decision. Fill in:

1. Clip ID, proposed title and filename; actual destination accounts and publication status.
2. Source file/hash and retained bounds on all 3 clocks, with a mapping for each passage and card.
3. Every selection hold, qualification, "Before an edit" note and alternate cut; evidence resolving
   each. An unresolved hold remains a hold, even for a transcript select.
4. Shots, crop for each person, source timing and reason for each reaction; how chronology is kept.
5. Caption wording, uncertainty, line breaks and any explicitly authorized omission; keep the audio.
6. Names, roles and time to read them; which template values fit, which newer decisions apply, and
   phone/control checks needed for this clip.
7. Intro/closing treatment, sound asset and gain, last-word boundary and fades; unresolved choices
   referenced rather than assumed.

## Editing and review steps, in order

1. Confirm source and editing inputs match the inventory; preserve the source and current output.
2. Read the selection entry and full retained speech context. Record holds and the evidence used to
   choose likely boundaries; use conservative context where uncertainty remains.
3. Make frame sheets across the passage and choose real, correctly timed shots and reactions.
4. Adapt caption/name templates, render overlay PNGs and generate intro frames only when needed.
   Retain both editable inputs and exact images used by the render.
5. Render to a separate output path. Never overwrite a delivered file or recovery reference.
6. Inspect the intro, every cut/tag/caption transition and the closing card, including the frame
   before, at and after each cut. Match tags to actual output-frame cuts, not just planned decimal
   times; a person’s tag must not carry onto someone else. Measure text edges and inspect at phone
   size with realistic destination controls; do not infer readability from pixels alone.
7. Measure sound timing and level at the start, joins, last word and closing sound. Play with sound
   when available. Record listening not performed when unavailable; never report unheard speech as
   verified or make the publisher's listening a new delivery requirement.
8. Record checks, uncertainties, approval status, exact inputs and settings, and all clock mappings in
   the clip's production record. Record its hash in the inventory and verify its Drive backup.
9. Before posting, verify destination requirements and separate publication approval. Creating or
   restoring a short never grants permission to post it.

## Checklist (from problems actually found)

- [ ] Source, template version and all clock mappings identified; source/current files preserved.
- [ ] Selection holds addressed; context, qualifications, speaker identity and real reactions retained.
- [ ] Event-name title readable; removed event detail carried in post text.
- [ ] Name/role reading time suits the shot; no unwanted gap or wrong-person tag at a cut, including a single frame.
- [ ] Caption lines readable and clear of tags and actual app controls; speaker identity unambiguous.
- [ ] Every spoken caption retained except an explicitly recorded omission; original speech retained.
- [ ] Last word remains full volume to its end; sound evidence and unavailable listening noted.
- [ ] Logo movement smooth; intro audio choice not assumed.
- [ ] Closing picture follows that clip's decisions; exact sound and attenuation retained.
- [ ] Filename, output facts, version/hash, backup and destination checks recorded separately from approval.

## Unresolved (not defaults)

- Posting approval of clip 01. Neither the frozen reference nor a requested revision is approved for posting.
- Intro sound. The frozen reference is silent; keeping it silent was suggested but not decided.
- Aaron Brutger's role wording. The frozen reference says "Republican-endorsed write-in candidate";
  shortening it to "Republican-endorsed write-in" was suggested but not answered. The new tag-duration
  instruction changes reading time, not this wording.
- Thumbnails per short.

Full-export storage is settled separately in the [production record](forward-debate-2026-10-15/README.md):
no backup of the 29 GB export; rebuilding that full edition remains untested.
