# Rebuild the Forward Debate videos

Rebuilding renders a video again from the restored files. Restore first ([restore.md](restore.md)).

## Tested setup

The results below were produced on this setup; nothing is promised for another.

- macOS 27.0.1 (build 26A434), Apple Silicon (arm64)
- ffmpeg 8.0.1 (Homebrew), encoder `h264_videotoolbox` for both exports; HEVC is the source codec. On Linux the same filters run with `libx264`; untested, and the picture bytes differ.
- Google Chrome 155.0.8059.85, headless, for the overlay PNGs (only when a template changes)
- Python 3.14.2; Pillow 13.0.0 through `uvx --with pillow` (intro frames only)
- mlx-whisper 0.4.3 (transcripts; already saved, never needed for a rebuild)
- rclone 1.75.2 (Drive)

Setup guidance: `brew install ffmpeg rclone uv`; Google Chrome from google.com/chrome.
These commands install current software, not necessarily the exact tested versions. Preserve the
version record with the test evidence. Exact stored overlay images and intro frames remove Chrome
and Pillow from an ordinary video rebuild; no transcription or sound generation is required.
Use `uv run --python 3.14.2 --with pillow==13.0.0 python -I intro_frames.py` inside `short-01/`
only when regenerating intro frames. A newer OS, encoder or tool version requires a new comparison.

## Short 01

```
cd docs/operations/video/forward-debate-2026-10-15/short-01
export ALETHICAL_MEDIA=~/Movies/Alethical/forward-debate-2026
python3 -I render.py --source "$ALETHICAL_MEDIA/ForwardDebate-sound-fixed.mov" --out /tmp/01-rebuild.mp4
```

Takes about 20 seconds. Compare with the saved reference (`$ALETHICAL_MEDIA/references/short-01-33cae638.mp4`,
SHA-256 in `reference-sha256.txt`) with `compare_rebuild.py`:

```
uvx --with numpy python -I ../compare_rebuild.py /tmp/01-rebuild.mp4 "$ALETHICAL_MEDIA/references/short-01-33cae638.mp4" --out /tmp/01-comparison.json
```

It reports container facts (duration, size, frame rate, frame count, sample rate), per-frame picture
difference (PSNR minimum and mean across nonidentical frames, with identical-frame count over all 894 frames), and stereo audio differences before and after alignment (sample
count, offset, peak and RMS), plus exact stream and packet timing comparisons. The hardware encoder is not bit-exact run to run, so bytes differ; the
numbers say how far. No threshold here certifies that the words, timing or framing are right; those
are checked by looking at the frames listed in the guide's step 6 and, for speech, by listening.

### Test record

**Tested-and-matched**, October 20, 2026, from fresh GitHub clone
`b6f5521f65cb8e69165f19827f0bc025d90aa7b8` and fresh Drive restores. The 1 permitted render
reproduced all 894 decoded picture frames and decoded stereo audio exactly, with matching duration,
stream facts and packet timing. Whole MP4 hashes differ. [Measured evidence and visual review](verification/recovery-test.md)
include 2 existing single-frame wrong-person tags at cuts; they were preserved, not repaired.
No listening or posting approval is implied. The full edition remains untested.

## Full edition

Untested from this saved copy. The delivered file was rendered from these same inputs on October 19,
2026, before they were moved here; the port to relative paths changed no edit value (the ffmpeg
command is built from `edit.json` and the card images exactly as before).

```
cd docs/operations/video/forward-debate-2026-10-15/full-video
export ALETHICAL_MEDIA=~/Movies/Alethical/forward-debate-2026
python3 -I render.py --out /tmp/ForwardDebate-YouTube-rebuild.mp4           # about 50 minutes, 29 GB
python3 -I render.py --out /tmp/sample.mp4 --sample 60                      # first 60 s only, for a check
```

Captions, transcript and turn list (no transcription needed; reproduces the delivered files byte for byte):

```
python3 -I build_section.py full_cfg.json     # writes out/
```

Name-label motion scan (28 appearances, every frame):
`uvx --with numpy python -I labelcheck.py --out /tmp/label-motion-report.json`
after setting `ALETHICAL_MEDIA`. This reports pixel change in the original regions; it does not
by itself prove that a label is readable or never covers a face. The saved original report is
retained as historical evidence; this recovery task does not rerun the full scan.


## Editable card sources

Exact generated PNGs are retained and used directly for recovery. For future full-video card edits,
`zsh full-video/make_cards.sh /tmp/forward-debate-new-cards` regenerates images into a new directory;
inspect them before replacing any recipe input. The original recorded commands used Chrome headless,
2652x1492, default opaque background for title/end and transparent background for labels. Final label
boxes use top 200, width 540, height 215, and left positions 413/1126/1700. The retained label template
already includes that adjustment. Card regeneration is not a full-video rebuild or publication.
