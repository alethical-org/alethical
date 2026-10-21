# Forward Debate TikTok preparation

**Preparation only, October 21, 2026. Not published or sent to TikTok's inbox.**
Adeli's **Alethical.com** TikTok account is staged at **Image > Step 3**.
No live post address or publish identifier exists for this preparation.

## Media and readiness

The original [Forward Debate thumbnail](video/forward-debate-2026-10-15/text/ForwardDebate-thumbnail.jpg)
produced a square Adeli preview that clipped the left title/name and people at the sides. That preview
is not proof of TikTok's output crop. The [1080 × 1920 padded derivative](social-media/forward-debate-tiktok-original-padded.png)
keeps the original image's full composition without cropping or regenerating its photo, text or faces.
Its loaded Adeli preview and final output remain pending verification. Short 01 remains held.

The derivative is outside the frozen video recovery package. Its SHA-256 is
`00d306af6e6847a6c126d3932ec09da31321ba51ca84ba4b23e5ce578a71590a`.
The original remains unchanged. Padding uses near-black `0A0A0A`; resampling changes pixel resolution,
so this is a non-generative adaptation, not a pixel-lossless copy. From this directory, the recipe is:

```sh
sips -s format png video/forward-debate-2026-10-15/text/ForwardDebate-thumbnail.jpg --out social-media/forward-debate-tiktok-original-padded.png
sips --padToHeightWidth 2276 1280 --padColor 0A0A0A social-media/forward-debate-tiktok-original-padded.png
sips --resampleHeightWidth 1920 1080 social-media/forward-debate-tiktok-original-padded.png
```

Visibility is unselected, comments are on by default, automatic music is off, and the own-business
disclosure is not selected. Continue is disabled. These are staged settings, not final choices.

## Text and destination checks

The editor's title and description match the [exact preparation source](forward-debate-tiktok-preparation.json).
[Adeli's TikTok guide](https://www.tryadeli.com/docs/api/posts/publish-tiktok), read October 21, 2026,
documents photo-title and description limits of 90 and 4,000 characters and requires exactly 1 media
type, photo or video. The source below fits those limits; fitting text does not establish media readiness.

Web searches using exact candidate names with TikTok and campaign handles found no verified social
accounts. TikTok-domain web access was blocked. Native Trent Dilks results did not establish a
matching identity; the Aaron-name profiles `@aaronbrutger` and `@aaronbrutger1` had no bio or content
and did not establish identity. Native campaign-handle searches remain in progress. A name match
alone is insufficient.
Official campaign websites are verified. The draft shows those addresses as text, not verified live
clickable links. Confirm final native search, link treatment, media, visibility and disclosure before
any publication decision.

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
```

[Social publishing](social-publishing.md) owns Alethical's rules and approved account fallbacks.
