# Checks before the recovery render

These checks establish saved-input completeness and script behavior. They do not replace the fresh
Drive restore and full short rebuild, and do not establish editorial approval or listening.

## Original inputs and edit values

- All 15 short overlay PNGs, 54 intro frames and 3 full-edition card PNGs match the original render inputs by SHA-256.
- Exact sound, symbol, fonts and full-video wordmark are saved. The font license is retained alongside the fonts; sound provenance is recorded in the production record.
- Current short's 82 command arguments retain original edit values except Aaron's requested first-tag duration, 3 to 6 seconds. Changes to paths and no-overwrite behavior are separate.
- Full-video's 62 command arguments retain original edit values; only paths and overwrite protection changed.
- Full-video card generation settings were recovered from the original command records: 2652x1492, opaque title/end, transparent labels. The saved card-generation shell script parses; no cards were regenerated for this check.

## Text generation

The saved builder's output bytes match the retained files:

| Output | SHA-256 |
| --- | --- |
| SRT, 1659 cues with 123 uncertainty marks | d6e2e5b7f0e2072b6c92e24d6058fa114c13beda783bc6d3a8b95d9b628d65ce |
| Transcript Markdown | 0d9c63fb4c8755d8a43a573786704e41ee1f1e39ba3f122dcd1fc24a74a73d16 |
| Turns JSON | c51f75de2d7cd76300131b9843504d25947ffd7708cfba77e7f3664408fe553e |

## Script checks

- Python syntax, shell syntax and relative Markdown links pass.
- Existing-output guards refuse to overwrite a sentinel file in current/initial short renders, full-video render and label-motion scan.
- Stereo comparison detects synthetic offsets of -1200, 0 and +1200 samples and aligns them to zero residual difference.
- Identical silent and opposite-phase stereo samples return zero offset and zero difference.
- A shifted opposite-phase stereo signal still detects its 1200-sample offset.
- A silent correlation window with an out-of-window change reports alignment undetermined and retains the measured difference.
- Self-comparison of the prior short reported all 894 frames identical, exact stream/packet timing and zero decoded audio difference. This was a comparison check, not a video rebuild; the older reference is retained on Drive only.

## Recovery result

The subsequent fresh-clone and Drive-restore test is recorded in [recovery-test.md](recovery-test.md),
with exact timings, every-frame image comparison, stereo audio measurements and transition frames.
The full-video rebuild remains untested.
