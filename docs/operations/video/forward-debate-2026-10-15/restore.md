# Restore the Forward Debate files

Restoring puts saved files back on a Mac. It renders nothing and does not publish anything.

## Repository

```sh
git clone https://github.com/alethical-org/alethical.git
cd alethical/docs/operations/video/forward-debate-2026-10-15
```

Recipes, templates, exact overlay images, intro frames, transcripts, captions, the selected sound,
logo images and licensed fonts are in this repository. The inventory includes both guides.
The repository is public; access to the team Drive folder is required to restore large media;
credentials and sign-in tokens are never stored here.

## Media

Drive folder: **Alethical Team > Media > Forward Debate 2026-10-15**, the authorized team Drive account.
Install rclone (`brew install rclone`), run `rclone config`, choose Google Drive and name the remote
`alethical-drive`, then sign in to the approved account. Use an existing authorized remote when present.
A future rclone release may require your own Google client ID; follow rclone's current Drive setup
instructions rather than saving credentials in this repository.

```sh
export ALETHICAL_MEDIA="$HOME/Movies/Alethical/forward-debate-2026"
python3 -I restore_media.py --media "$ALETHICAL_MEDIA"
python3 -I verify_inventory.py --media "$ALETHICAL_MEDIA"
```

The restore script uses each exact Drive path in [INVENTORY.json](INVENTORY.json), preserves matching
local files, refuses to overwrite a differing file, and verifies each downloaded file's SHA-256.
The source and original audio tracks restore to the media root; the current short reference restores under
`references/`, using the team Drive file `01-We-Disagree-We-Can-Still-Grab-a-Beer-v2.mp4`.
The earlier version stays as `01-We-Disagree-We-Can-Still-Grab-a-Beer.mp4` in the same Drive folder and is not downloaded by default,
with old Mac copies excluded from the default restore. After verification, copy `references/short-01-33cae638.mp4` to
`shorts/01-We-Disagree-We-Can-Still-Grab-a-Beer.mp4` if a convenient current-viewing copy is needed.
The sound and thumbnail already restore through Git at `short-01/assets/` and `text/`; neither
requires an extra media-folder copy. The Drive thumbnail is a duplicate, not a missing dependency.

## Not saved

| Item | Recovery limit |
| --- | --- |
| Original phone container, `ForwardDebate.MOV` | Not recoverable from these backups; picture stream and 2 original audio tracks survive separately, without a claim that all container metadata or spatial presentation survived |
| Delivered 29.3 GB YouTube edition | Rebuild recipe retained but untested; the public YouTube copy has YouTube's encoding |
| 16 kHz transcription scratch audio | Derivable from source with ffmpeg if needed; recovery uses saved transcripts and never needs a new transcription |

Do not regenerate the selected ElevenLabs sound. Its prompt and settings are history; the saved WAV
is the exact input. Preserve unresolved editorial decisions when restoring.
