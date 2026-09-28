<!-- describes: apps/frontend/src/screens/redesign/AboutUsScreen.tsx, apps/frontend/src/lib/aboutUs.ts, apps/frontend/src/navigation/webRoutes.ts -->

# About Us page

The public About Us page lives at `/about`. It explains Alethical’s name, purpose,
beliefs, team, current features, roadmap, and correction-first contact policy in
plain language.

## Page promise

- The official public record is the source of every factual claim.
- Alethical makes that record easier to read without telling people what to think.
- The Our team section introduces Angel Zierden and Eugene Lopin after the 6 beliefs,
  with their titles, portraits, and complete biographies.
- Readers can follow 4 real links to Bills, Legislators, Find My Legislator, and Track.
- Planned work stays in one grey roadmap panel and is not shown as available now.
- The Contact us button opens the public contact page at `/about/contact`.

## Visual meaning

- Cyan appears only on the name-origin panel and the 6 belief cards. It marks identity.
- White cards link to features available now.
- Grey holds the 6 planned areas.
- The 2 team biographies use the same grey surface as the roadmap, with approved
  portraits treated as one warm, balanced pair.
- Purple appears once in the hero as the source and citation color.
- Green is reserved for the Contact us action and the email link.
- The Contact us button follows the green-button hover treatment in
  [design-principles.md](../design/design-principles.md): a mouse or trackpad at
  tablet and computer widths darkens the fill without moving or resizing the
  button. Touch keeps its existing press feedback; keyboard navigation keeps
  the separate purple focus outline.
- The email link follows the same source's destination-link treatment: at tablet
  and computer widths with a mouse or trackpad, its words turn `#11832b` and gain
  an underline. The link does not move or resize, and touch does not retain hover.

## Small screens

The first response contains the same name origin, purpose, beliefs, team biographies,
public starting links and contact text as the loaded screen. Shared words in
`aboutUs.ts` keep the 2 presentations aligned. The private Track link and planned
features stay out of this initial text. No data request is needed to serve it.

The 2 team biographies sit side by side on computers, stack with the portrait beside
the biography on tablets, and stack with a smaller portrait above the biography on
phones. The belief cards, feature links, roadmap items, and contact area become 1
column below the phone breakpoint. Every link keeps a target at least 44 pixels tall.

## Grounding boundary

The roadmap names planned features, including broader Grounded Ask and campaign money
work. Those items are plain text, not links, because the features do not exist yet.
The phrase “linked to the source” is purple text, not a link, because there is no single
honest destination for that general promise.
