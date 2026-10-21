# Short 01 recovery test, October 20, 2026

Outcome: **tested-and-matched for recovery of the current short**. This is not publication approval or a claim that every editorial detail is correct.

## What ran

The private repository was freshly cloned from GitHub at `b6f5521f65cb8e69165f19827f0bc025d90aa7b8`. The sound-fixed recording, 2 original audio tracks and current short reference were downloaded from the team Drive folder into a separate media directory. Every restored input matched the inventory’s SHA-256 and size. The prior short stayed on Drive and was not restored locally.

The frozen clone’s `short-01/render.py` ran once, to a new temporary output, using only the freshly restored source and saved repository assets. It completed in 4.27 seconds. This is the sole recovery render; no recipe value changed after it. Exact command, times and tested commit: [recovery-render-run.json](recovery-render-run.json). Input results: [fresh-restore-verification.txt](fresh-restore-verification.txt).

The comparison command used the frozen clone’s `compare_rebuild.py`, rebuilt file, restored current reference and a new JSON output. Results: [recovery-comparison.json](recovery-comparison.json).

## Measured result

| Check | Result |
| --- | --- |
| Current reference SHA-256 | `33cae6382600d17ab05b9d62108cfed5e7936134315f1d1ee6d2ea7e2f7f2581` |
| Rebuilt file SHA-256 | `e930285828598d690267902a7b7a954c0f06599a60b9c9b0a1b944d39d24b44d` |
| File size, both | 27,017,223 bytes |
| Duration, both | 29.800 seconds |
| Video | 894 frames; 1080x1920; 30 fps |
| Decoded picture | All 894 frames identical across all compared YUV planes |
| PSNR | Infinite for all 894 frames; no finite minimum or mean; JSON null represents infinity |
| Stream facts and packet timing | Exact match |
| Decoded audio | 1,430,528 stereo sample frames at 48,000 Hz; exact match |
| Audio offset | 0 samples |
| Audio peak and RMS difference | 0 in both channels |

Whole-file hashes differ; the MP4 files are not claimed byte-identical. Decoded picture, decoded audio, stream facts and packet timing match exactly. A separate [byte comparison](recovery-byte-difference.json) found exactly 1 differing byte, at zero-based offset 27485 inside the first video packet’s H.264 supplemental-information unit (SEI, NAL type 6). Its picture unit and all other file bytes match. Container header blocks match; this is not a metadata-header difference.

## Visual review and an existing defect

All 80 frame views in [recovery-visual-plan.json](recovery-visual-plan.json) were inspected on the 9 saved [review sheets](visual-review/). They cover the intro, all shot/name/caption transitions, picture fade, closing card and interior samples. Aaron’s tag remains visible through frame 233 (7.767 s), disappearing at frame 234 (7.800 s). Captions remain separate from tags and the closing card carries the saved wording and icon.

The current reference contains 2 single-frame name-tag errors, faithfully reproduced by recovery:

- Frame 373 (12.433 s, zero-based): Angel is on screen while Trent’s tag remains. Frame 374 has Angel’s tag. See [sheet 05](visual-review/sheet-05.jpg).
- Frame 424 (14.133 s): Aaron is on screen while Angel’s tag remains. Frame 425 has no tag, as intended for Aaron’s return. See [sheet 06](visual-review/sheet-06.jpg).

The cuts reach their new pictures before the name overlays switch. A future authorized revision should align name overlays with actual output-frame cuts, then inspect the frame before, at and after each cut. No renderer or current video was changed during this recovery test. The first frame of Trent’s shot also precedes his tag by 1 frame; the 2 wrong-person tags are the substantive identity problem.

## Limits and owner

Codex chat `debate video/shorts` owns recovery delivery and the recorded findings. A future clip revision must carry the tag finding; it is not a new visual choice or approval to post. No listening was performed, no live destination-app controls were inspected, and the uncertain speaker of “We have before, yes” remains unresolved. This test proves reproduction of the current saved treatment, not the speech’s accuracy or every platform’s suitability.

The full-length edition was not rebuilt and stays untested. The original phone container is not restored; preservation of its picture stream and 2 audio streams does not establish preservation of all metadata or spatial-audio presentation. The source files and current reference remain untouched. The temporary rebuilt video was removed after evidence and independent review were complete. The current reference and restored source files were retained.

## Independent final review

A separate read-only review found no recovery blocker. It independently hashed the 4 restored media
files, confirmed all 115 recipe/asset/font files match the frozen clone, read the comparison code and
all 894 zero-error frame records, inspected all 9 sheets, confirmed the 2 preserved tag defects, and
verified the 1-byte SEI difference. It confirmed the prior short was absent from the restore folder
and accepted the stated limits. No second render ran.

## Final Drive location check

The final Drive listing no longer exposed the duplicate `references/` backup files, but the 2
team-facing short files remained with the exact saved hashes. The reason for that location change
was not established. The inventory now points directly to the current `-v2.mp4` file and the prior
unsuffixed file, avoiding dependence on duplicate backups. No Drive file was changed or removed.
The local recovery reference path and every render input/value stayed unchanged.

The final-location restore is checked separately from the 1 video render: source/audio inputs are
reused after hash verification, while the current reference is freshly downloaded using the final
inventory and unchanged restore script. See [final-location-restore.txt](final-location-restore.txt)
and [final-drive-list.json](final-drive-list.json). This location correction does not claim a second
video render; the rendered inputs remain identical to the frozen tested recipe.
