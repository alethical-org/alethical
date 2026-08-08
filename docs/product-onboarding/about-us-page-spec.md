<!-- describes: apps/frontend/src/screens/redesign/AboutUsScreen.tsx, apps/frontend/src/navigation/webRoutes.ts -->

# About Us page

The public About Us page lives at `/about`. It explains Alethical’s name, purpose,
beliefs, current features, roadmap, and correction-first contact policy in plain
language.

## Page promise

- The official public record is the source of every factual claim.
- Alethical makes that record easier to read without telling people what to think.
- Readers can follow 4 real links to Bills, Legislators, Find My Legislator, and Track.
- Planned work stays in one grey roadmap panel and is not shown as available now.
- The Contact us button opens the public contact page at `/about/contact`.

## Visual meaning

- Cyan appears only on the name-origin panel and the 6 belief cards. It marks identity.
- White cards link to features available now.
- Grey holds the 6 planned areas.
- Purple appears once in the hero as the source and citation color.
- Green is reserved for the Contact us action and the email link.

## Small screens

The belief cards, feature links, roadmap items, and contact area become 1 column below
the phone breakpoint. Every link keeps a target at least 44 pixels tall.

## Grounding boundary

The roadmap names planned features, including broader Grounded Ask and campaign money
work. Those items are plain text, not links, because the features do not exist yet.
The phrase “linked to the source” is purple text, not a link, because there is no single
honest destination for that general promise.
