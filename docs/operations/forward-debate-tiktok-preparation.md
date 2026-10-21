# Forward Debate TikTok publication and removal record

**Removed October 21, 2026 through the TikTok app; public-profile removal confirmed.**
The user reported completing deletion. A refreshed [Alethical public profile](https://www.tiktok.com/@alethicaltruth)
shows only the older money-report video `7676584304536718606`; the Forward Debate photo
`7699145941923810573` is absent. TikTok Studio also shows only the older row, despite a stale
Posts 2 header. This confirms public removal, not permanent purge or recovery behavior.

The photo was published through Adeli after its Step 4 review with 1 image, under publish ID
`p_pub_url~v2.7699145908722223118`. Its [former post address](https://www.tiktok.com/@alethicaltruth/photo/7699145941923810573)
is retained for identification. Before removal, native checks showed the title in image alt text,
a partial caption and the Promotional content disclosure. No inbox draft was sent.

## Media and readiness

The original [Forward Debate thumbnail](video/forward-debate-2026-10-15/text/ForwardDebate-thumbnail.jpg)
produced a square Adeli preview that clipped the left title/name and people at the sides. That preview
is not proof of TikTok's output crop. The [1080 × 1920 padded derivative](social-media/forward-debate-tiktok-original-padded.png)
keeps the original image's full composition without cropping or regenerating its photo, text or faces.
The final Adeli preview shows the full title, names and faces without cropping. Full native visual and caption review is not complete. Short 01 remains held.

The derivative is outside the frozen video recovery package. Its SHA-256 is
`00d306af6e6847a6c126d3932ec09da31321ba51ca84ba4b23e5ce578a71590a`.
The original remains unchanged. Padding uses near-black `0A0A0A`; resampling changes pixel resolution,
so this is a non-generative adaptation, not a pixel-lossless copy. From this directory, the recipe is:

```sh
sips -s format png video/forward-debate-2026-10-15/text/ForwardDebate-thumbnail.jpg --out social-media/forward-debate-tiktok-original-padded.png
sips --padToHeightWidth 2276 1280 --padColor 0A0A0A social-media/forward-debate-tiktok-original-padded.png
sips --resampleHeightWidth 1920 1080 social-media/forward-debate-tiktok-original-padded.png
```

The final review showed **Everyone**, comments on, automatic music off and own-business
**Promotional content** on. Paid partnership and AI-media were off; the image is an ordinary resize
and pad of the original artwork. The title has 64 characters and the description has 889.

The user accepted the action-time confirmation:
“I confirm this publishes a real TikTok post visible to everyone and I agree to TikTok’s Music Usage
Confirmation.” The public photo was then submitted. Adeli reports `PUBLISH_COMPLETE`, and native
profile and direct-address checks confirm the public photo. Full caption, visual and link review
remain incomplete; provider completion does not establish a usable viewing experience.

## Viewing issue and approved format choice

Before removal, the direct photo address automatically navigated to an unrelated next video within
seconds without a click. This reproduced the reported viewing problem; its cause is not established.
Playback was not accepted.

Alethical's approved TikTok rule is actual videos only: no photo posts and no timed-still MP4
workaround. This supersedes the case-only allowance for other substantive photo posts; it is an
editorial choice, not a claim that TikTok cannot support photos. This promotion waits for a
meaningful approved debate short. The desktop removal route was blocked: TikTok Studio’s Content
view showed the exact photo with disabled Everyone and **Actions > Delete** controls and the notice,
“Videos with commercial content can only be edited on the TikTok app.” The ordinary post view
advanced away before stable removal was possible. No desktop deletion was clicked.

[Adeli’s posts API](https://www.tryadeli.com/docs/api/posts) documents deletion for X and Bluesky,
not TikTok. The user completed deletion in the TikTok app; the refreshed native public profile and
Studio rows confirmed removal on October 21, 2026. The prior app-only blocker is resolved for this
photo. No replacement was published. The [shared removal workflow](https://github.com/euglopi/tool-settings/blob/main/shared/guides/social-publishing.md#remove-the-exact-post-through-a-supported-route)
owns the reusable mobile-app route, exact-post guard and saved-removal checks.

A 12-second silent still-video experiment exists only in scratch; it is not published, adopted as
current media or copied into this record’s media collection. Short 01’s separate posting hold remains.

## Text and destination checks

The final title and 889-character description match the [exact preparation source](forward-debate-tiktok-preparation.json), including the YouTube search instruction.
[Adeli's TikTok guide](https://www.tryadeli.com/docs/api/posts/publish-tiktok), read October 21, 2026,
documents photo-title and description limits of 90 and 4,000 characters and requires exactly 1 media
type, photo or video. The source below fits those limits; fitting text does not establish media readiness.

Web searches using exact candidate names with TikTok and campaign handles found no verified social
accounts. TikTok-domain web access was blocked. Native Trent Dilks and exact campaign-handle
queries returned unrelated matches. The Aaron-name profiles `@aaronbrutger` and `@aaronbrutger1`
had no bio or content and did not establish identity; official campaign sites supplied no TikTok
cross-links. The verified campaign-website fallback applies after this reasonable search.
Alethical's native handle is `@alethicaltruth`, with 1 existing money-report video and no visible
website link. The draft adds a YouTube search instruction for readers who cannot open caption URLs.
Official campaign websites are verified. The draft shows those addresses as text, not verified live
clickable links. The YouTube search instruction provides an alternative route. Native link behavior and the full saved output remain unverified; they are not claimed
from the draft. Image, identity-search and final-setting preparation checks are complete.

## Draft title

Respectful debate. Shared ground. Watch the full Forward Debate.

## Draft description

```text
We can disagree and still work together.

At Alethical’s Forward Debate, Trent Dilks (https://trentformn13.com) and Aaron Brutger (https://brutgerformnsenate.com) answered hard questions about Minnesota’s future. Afterward, attendees praised both candidates, with some calling it the best debate they had seen.

People also spoke positively about the candidates joining the Forward Independence Coalition and their willingness to work across party lines: https://forwardcoalition.com/candidates

That’s the spirit we want to build on. Alethical will soon share plans for more debates across Minnesota and tools, data and support for candidates of any party, including independents.

Thank you to both candidates and everyone who kept the conversation going.

Watch the full debate: https://www.alethical.com/blog/events/forward-debate-2026
Or search YouTube for “Alethical Forward Debate”.
```

[Social publishing](social-publishing.md) owns Alethical's rules and approved account fallbacks.
