# Events section and The Forward Debate

Original publication scope approved on 7 October 2026: reuse the existing
blog elements, publish the event announcement with the supplied image first, add
Alethical and Forward Coalition logos, and link the coalition logo to its candidates.
Signup uses https://luma.com/3w69g6dw. This is website publication, not email sending.

## Approved content and scope

- Add Events on `/blog`, a collection at `/blog/events`, and the event at
  `/blog/events/forward-debate-2026`. Keep research and guide traits unchanged.
- Trent Dilks: DFL candidate. Aaron Brutger: Republican primary candidate. These are the approved publication labels.
- Minnesota Senate District 13, Thursday 15 October 2026, 6–8 PM Central.
- Riverside Terrace, 195 River Ave S, Sauk Rapids, MN 56379. Free admission.
- Alethical hosts; Angel Zierden moderates; no pre-approved questions.
- Preserve the original supplied flyer unchanged, including primary-candidate wording in both flyer and article.
  The generated image is rejected and will not be published.
- Reuse saved services logos and existing blog typography, rows, spacing and controls.
  Coalition logo links to https://forwardcoalition.com/candidates. Alethical icon
  identifies the host and links home. No new Design round or unrelated redesign.

## Delivery checks

1. Add content, event article/collection, navigation, blog preview and accessible links.
2. Serve matching readable content before JavaScript; add canonical/share metadata,
   Event structured data and sitemap entries. Reject nonexistent event addresses.
3. Test event date boundaries, routes, HTML/content agreement, signup and logo links.
4. Check phone and desktop in the browser, image-first order, keyboard focus and hover.
5. Independent review, required checks, pull request, merge queue, deployment and live check.

## Impact and prevention

Events have schedule/location information and signup links, not research evidence dates.
One event source feeds list, article and metadata to prevent contradictory details.
Keep past event URLs, visibly mark ended events and remove the signup invitation after
the scheduled end. Existing research/guide paths and metadata remain unchanged.
No audience-Q&A, recording, sponsorship or refreshments promised. The coalition site
is a partner link, not the source for candidate office/status.

## Progress

- Build branch created from current origin/main; no overlapping event PR found.
- Content source added. Original image and primary-candidate wording approved for publication; no image edit pending.
- Implemented article, collection, blog entry, routes and matching initial HTML/metadata.
- Original flyer losslessly converted from 1.6 MB PNG to 690 KB WebP; preserves 1080 × 1920 pixels and requested wording. Mobile view keeps the full image, offers a full-size zoom link and repeats details in readable HTML text.
- TypeScript and formatting pass. Full existing/new suite passed 4,151 tests; 5 additional route/accessibility cases pass. Production build passes first-download size guard after separating route identity from article copy.
- Independent review found no blockers. Desktop and 390-pixel phone checks cover navigation, original image, signup target and logo links.
- Google discovery uses the existing sitemap and ordinary links. Existing main-release search health and changed-page notice workflows cover the new URLs. Receipt is not proof of indexing.
- Added Reader comments and event correction-link support. The standard AI notice is omitted for all event promotions under a recorded standing exception. Event identities join the existing server registry so comment requests follow the same permissions and moderation rules.
- Original release complete in [pull request 2523](https://github.com/alethical-org/alethical/pull/2523): live frontend/backend, phone review, sitemap, Google priority-crawl request and 2 received IndexNow notices. Local suites passed 4,159 frontend and 4,478 backend tests.
- Current publication hold, 7 October 2026: the announcement is withdrawn for refinements and candidate approval. Preserve all copy, assets and layout. Republication requires both candidate approval of the revised version and separate publication authorization.
- A saved publication flag excludes the held event from direct routes, Blog listings, sitemaps, metadata, correction links and public comment eligibility. The flyer is retained outside the public asset directory. Empty Events navigation stays hidden.
- Restore the retained flyer to its original public path and enable publication only after that approval. The permanent article address and complete implementation remain reusable.
- This hold covers Alethical’s website, not the separately hosted Luma event.
- Hold release checks: direct article, collection and flyer return 404; Blog and sitemap omit the event; saved content and image remain available for revision.

## Search sources

- [Google image guidance](https://developers.google.com/search/docs/appearance/google-images): ordinary image elements, meaningful filenames/alternative text and nearby text.
- [Google recrawl guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl): requests and sitemaps aid discovery; crawling and indexing timing is Google’s decision.

- Hosted-build finding during the hold: the preview first download exceeded its fixed size limit by 2 bytes. Event-specific title resolution now runs in the on-demand event screen, using the existing resolved-title hook, instead of adding that work to every first page. The size limit stays unchanged.
