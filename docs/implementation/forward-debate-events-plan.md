# Events section and The Forward Debate

User authorized creation and live publication on 7 October 2026: reuse the existing
blog elements, publish the event announcement with the supplied image first, add
Alethical and Forward Coalition logos, and link the coalition logo to its candidates.
Signup uses https://luma.com/3w69g6dw. This is website publication, not email sending.

## Approved content and scope

- Add Events on `/blog`, a collection at `/blog/events`, and the event at
  `/blog/events/forward-debate-2026`. Keep research and guide traits unchanged.
- Trent Dilks: DFL candidate. Aaron Brutger: Republican primary candidate, per the user’s final explicit wording.
- Minnesota Senate District 13, Thursday 15 October 2026, 6–8 PM Central.
- Riverside Terrace, 195 River Ave S, Sauk Rapids, MN 56379. Free admission.
- Alethical hosts; Angel Zierden moderates; no pre-approved questions.
- Preserve the original supplied flyer unchanged. User explicitly reversed the proposed
  label correction and directed primary-candidate wording in both flyer and article.
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
is a user-requested partner link, not the source for candidate office/status.

## Progress

- Build branch created from current origin/main; no overlapping event PR found.
- Content source added. Original image and primary-candidate wording confirmed by user; no image edit pending.
- Implemented article, collection, blog entry, routes and matching initial HTML/metadata.
- Original flyer losslessly converted from 1.6 MB PNG to 690 KB WebP; preserves 1080 × 1920 pixels and requested wording. Mobile view keeps the full image, offers a full-size zoom link and repeats details in readable HTML text.
- TypeScript and formatting pass. Full existing/new suite passed 4,151 tests; 5 additional route/accessibility cases pass. Production build passes first-download size guard after separating route identity from article copy.
- Independent review found no blockers. Desktop and 390-pixel phone checks cover navigation, original image, signup target and logo links.
- Google discovery uses the existing sitemap and ordinary links. Existing main-release search health and changed-page notice workflows cover the new URLs. Receipt is not proof of indexing.
- Added Reader comments and event correction-link support. Eugene subsequently directed omitting the standard AI notice for all event promotions; the notice is removed and the standing exception recorded. Event identities join the existing server registry so comment requests follow the same permissions and moderation rules.
- Remaining: commit, pull request checks, merge queue, frontend/backend deployment, live response/browser and search-notice checks.

## Search sources

- [Google image guidance](https://developers.google.com/search/docs/appearance/google-images): ordinary image elements, meaningful filenames/alternative text and nearby text.
- [Google recrawl guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl): requests and sitemaps aid discovery; crawling and indexing timing is Google’s decision.
