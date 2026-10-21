# Short 01: decisions and corrections

The first-version recovery reference has SHA-256
`0c6df832e41ae610cfcf46dde703344f8d4cd3f1f1bb54a05297f95f254f2698`.
Exact values below describe that frozen reference unless marked as a newer request. They are a starting
template, not approval to reuse every value unchanged. *Lesson* means the reason carries forward;
*template* means these values must be assessed for the next clip; *clip* is specific to short 01.
Nothing here is posting approval. Unanswered choices live once in the
[guide's unresolved section](../shorts-guide.md#unresolved-not-defaults).

| # | What | First-version treatment or newer instruction | Why | Scope | How to check |
| --- | --- | --- | --- | --- | --- |
| 1 | Source | cut from the sound-fixed recording, not the YouTube export | export already compressed and zoomed; upright slices magnify softness | Forward Debate source; lesson: use best retained source | source identity/hash and renderer input |
| 2 | Shape | 1080x1920, 30 fps | upright tall slice chosen for the sample | template, not proof of compatibility with all 7 platforms | output facts and current official destination requirements |
| 3 | Crop | 506x900 at y=430, x 497 / 1132 / 1592 per seat, Lanczos scaling | "zoom in more on each person"; head to knees, faces fill the screen | clip values; framing lesson | frames through each shot, including movement |
| 4 | Bounds | published 6960.65 to 6984.65; recording 6999.71 to 7023.71 | start on "As evidence", end after estimated end of "first" at published 6984.25 | clip; machine-derived evidence, no listening performed | word timing, 10 ms loudness trace and retained context; mark limits |
| 5 | Cutaways | Trent at "I'll go grab a beer with him", Angel smiling at "assume he would do the same", back to Aaron | switch to others when laughing or at a meaningful expression | lesson; specific shots/times are clip values | frame sheets and unchanged source order/timing |
| 6 | Title strip | "THE FORWARD DEBATE" only, 74 px, centered | district/date line too small; post text carries those details | lesson: avoid small/repeated text; template values | header image at phone size and accompanying post |
| 7 | Name tags | name 58 px, role 44 px on 1 line, top y=1022 at table edge, green left bar | roles hard to see; tags bumped captions; user requested table-edge placement | first-version template; readable separation is the lesson | tag edges, actual role length and phone view |
| 8 | Tag timing | first appearance only, 3 s; to the cut when shot is at most 3.6 s | second Aaron tag redundant; Trent-to-Angel gap flashed empty | first-version clip timing; see newer request below | frames around cut and enough reading time |
| 9 | Roles | Angel: "Moderator, Alethical" | "Moderator, CEO and Founder of Alethical" too long for the 1.7 s shot | clip wording; lesson: fit reading time | exact tag wording and shot length |
| 10 | Captions | 66 px, left 70, right 180, top 1306, lowest bottom 1472, 2 lines | moved lower twice; keep apart from labels and app controls | first-version template, not universal safe coordinates | phone readability and real destination controls |
| 11 | Speaker name over cutaways | redundant green name removed | "evident visually" in this exchange | clip decision; lesson: avoid repetition without losing speaker identity | actual exchange and caption templates |
| 12 | First caption | "As evidence today," omitted visually; audio kept | explicit caption-only removal | clip only | caps.json entry at 6900.0, outside retained passage |
| 13 | Last word | picture fades from published 6984.15; sound holds to 6984.35 then fades 0.3 s | "don't lower the volume while he's saying the last word" | lesson; exact boundary/fades are clip values | sound measurements, listening status and remaining uncertainty |
| 14 | Intro picture | 1.8 s, symbol 496 to 570 px, even growth, fades 0.35/0.2 s, frames drawn at 8x | brief intro on black with logo zoom; then bigger/slower; then halfway start and half speed; then shake removed | first-version template; smooth growth is the lesson; audio choice in unresolved section | successive frame sizes and visible edge movement |
| 15 | Closing card | "Watch the full debate" 110 px, debate green; 100 px gap; YouTube icon 150x106 above "@Alethical" 76 px; centered, 4 s | URL removed because post carries link; logo enlarged then removed; guide line enlarged then removed; icon above handle chosen for order | clip/template, not wording for every event | end_text image at phone size and exact source words |
| 16 | Closing sound | exact ElevenLabs "Upbeat, celebratory #1" WAV, input gain −6 dB, fade from 3.4 s over 0.6 s | user selected this file; sound was lowered from its original level | chosen reusable asset; attenuation/fades are template values | file hash, render gain and measured relationship to speech |
| 17 | Export | H.264 videotoolbox 8 Mbps, AAC 192k, BT.709, faststart | sample under 30 MB for phone delivery | template; 30 MB is not a universal platform rule | output facts and current destination/account limits |
| 18 | File name | 2-digit clip ID, then hyphenated title; 01-We-Disagree-We-Can-Still-Grab-a-Beer.mp4 | user removed event/short/sample prefixes, then requested number first | explicit rule for future filenames | stable selection ID, title and separate version record |
| 19 | Newer Aaron tag request | extend Aaron's FIRST tag only from 3 s to 6 s in clip 01 | user requested twice as long and clarified another Claude chat owns this change | current clip-specific revision; saved and visually reviewed | inspect returned output and timing; do not change other tags or frozen reference |

## Speech and evidence limits

The first caption removal was explicit: "Don't remove the audio. Only remove the visual caption for
those words." The full phrase remains in the audio. It is not permission to omit other captions.

"We have before, yes" is retained. The first editor described Aaron as its **most likely** speaker:
Angel had raised her mic, but the machine transcripts did not capture a separate response from her.
No listening confirmed that attribution. Preserve this limitation in the clip record rather than
calling it established by machine agreement. The recovery task reproduces the frozen file; it does not
silently change its captions or speech.

Machine timing and a sound-level trace located the edit boundaries; no listening check was recorded for those
checks. They do not prove sentence meaning or every word. Keep context and uncertainty, with no
mandatory listening task assigned to Eugene. Future selections retain qualifications, brief replies,
real chronology and actual reactions; a reading transcript alone is not the complete speech source.
Selection titles remain proposed paraphrases, and candidate claims remain attributed unless evidence
supports adopting them in explanatory copy.

## History: rejected or superseded

- Labels at the bottom of the frame: collided with captions and app controls.
- "MN Senate District 13 · October 15, 2026" beneath the title: too small; removed from the picture,
  with useful event details left to post text.
- Role lines at 28 px and 38 px: too small; a 48 px attempt wrapped; the first-version template uses
  44 px on 1 line. That number does not prove every role fits.
- Green "AARON BRUTGER" above captions during cutaways: removed as redundant in this clip.
- Closing page address: replaced by YouTube handle; post carries the page link.
- Closing Alethical logo, first small then 2x: removed; intro carries the brand. The old logo-on-beat
  instruction no longer applies once that logo is absent.
- "Both candidates, every question, with the candidate guide and money report": first part implied;
  remaining guide/report line enlarged, then removed entirely.
- Intro: 1.3 s with eased zoom from 55% to 100% too fast; 1.8 s from 420 to 570 px still too fast;
  whole-pixel growth and shrinking artifacts shook; drawing at 8x resolved the visible problem.
- Synthesized sound families: simple bells/chimes, fuller piano/chord themes and punchy stings.
  User asked for fuller music, then impact; chose synthesized riser-into-boom option 1 temporarily;
  later asked for ElevenLabs versions. These are revisions, not a counted set of rejected assets.
- ElevenLabs: cinematic brass too space-like/punchy; acoustic guitar/birdsong too child-like;
  professional brand sound with nature ambience led to the selected "Upbeat, celebratory #1" WAV.
- Removing "As evidence today" from the audio was reversed; only its visual caption goes.
- Original tag timing remains frozen in the archived first version. The current recovery reference
  uses the newer 6 s Aaron-only request; it does not set timing for other tags or shorts.

ElevenLabs prompt associated with the selected sound (history only; a rerun makes different audio):
"Professional corporate brand sound logo, like a premium news or documentary network ident: a
confident, elegant 3-note motif on warm grand piano and cello with soft orchestral strings, rich and
polished, ending on a full, resolved major chord. Real outdoor nature ambience underneath: a gentle river
and light wind through autumn trees. Mature, trustworthy, warm. No vocals, no whoosh, no cartoon or toy
sounds, no synth." Duration 4 s, prompt influence 60%, downloaded as WAV. The exact retained WAV,
not this prompt, is the recovery input.

## Revision sequence

The session numbered versions through 17, then continued revising the closing card. This is the
sequence of treatments, not a measured count of renders:

Bottom labels and district line; closer crop, title only, bigger tags; bigger roles and guide line;
bigger title; tags to table edge; speaker name removed and captions lower; captions lower again;
last word full volume plus synthesized theme; synthesized riser/boom and bigger logo; selected
ElevenLabs sound; logo intro and tags once; slower intro; halfway-start intro; smooth intro;
first caption hidden; tags with no gap; "Moderator, Alethical"; YouTube handle on card; larger guide
line; logo removed and card centered; guide line removed; larger title and stacked icon.

That final listed treatment is the frozen first-version recovery reference. Aaron's longer first tag
is the current revision, SHA-256 `33cae6382600d17ab05b9d62108cfed5e7936134315f1d1ee6d2ea7e2f7f2581`.
Its recipe changes only Aaron’s first tag duration; audio is unchanged. This does not establish
posting approval. The first version is retained on Drive only; old Mac copies are removed. The recovery test uses the current version.

## Recovery review finding

The fresh rebuild matches the current saved short exactly in decoded picture and audio. Its current
recipe preserves 2 wrong-person tags for 1 frame each: Trent’s name over Angel at zero-based frame373
(12.433s), and Angel’s name over Aaron at frame424 (14.133s). See the [test evidence](verification/recovery-test.md).
This is an existing defect to carry into a future authorized revision, not a new approved treatment.
The recovery test did not alter the video or recipe. Align future overlays to actual output-frame
cuts and inspect before/at/after every cut; planned decimal times alone do not prove alignment.
