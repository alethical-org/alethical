<!-- describes: apps/frontend/src/screens/redesign/AboutUsScreen.tsx, apps/frontend/src/lib/aboutUs.ts, apps/frontend/src/navigation/webRoutes.ts -->

# About Us page

The public About Us page lives at `/about`. It explains what Alethical does, its name,
purpose, beliefs, team, planned work and correction-first contact in plain language.

## Page promise

- The hero reads **TRUTH, UNCONCEALED** with the subtitle "Minnesota’s public record, in
  everyday words and linked to the source" in one style: same font, size, weight and color,
  with no link, underline or colored run. The name-origin card follows directly.
- **What Alethical does** states the whole offering once, in 3 rows that share 1 reading
  pattern: a short heading and introduction, then green links each with its own short
  description. **Public platform** links Bills and votes, Legislators, Find my legislators,
  Find my candidates, Money in politics and Track bills. **Research, guides and debates**
  links the blog and The Forward Debate, with the homepage debate photograph under the
  debate description as decoration (empty alternative text, hidden if it fails to load).
  **Campaign services** links `/services`. Only the green title is a link.
- Track bills says "Sign in to follow bills and see what changes" to signed-out readers
  and "Follow bills and see what changes" to signed-in readers.
- The official public record is the source of every factual claim. Alethical makes that
  record easier to read without telling people what to think.
- **Why we’re doing this** spans the content width and ends with the vision of a Minnesota
  where anyone can check the public record. No separate vision section repeats it.
- **Our team** introduces Angel Zierden (Founder & CEO) and Eugene Lopin (Co-Founder &
  CPTO) after the 6 beliefs, with portraits and complete biographies. Founders appear only
  here.
- **On the roadmap** follows the team and lists only unbuilt work in 1 grey panel. Shipped
  capabilities belong in What Alethical does, never on the roadmap. It ends with an
  invitation to suggest features, as plain text; the Contact section right below holds the
  page's Contact us button.
- **Contact** carries the corrections promise, the ask@alethical.com email link (its only
  appearance in the page content) and a Contact us button that opens the form for a
  correction (`/about/contact?purpose=correction`). That button carries no arrow. The shared
  footer's contact link stays generic.
- Contact purposes start the form with editable subject and message words from the
  trusted list in `apps/frontend/src/lib/contactPurposes.ts`; any other purpose in an
  address is ignored, and nothing is sent until the reader sends it.

## Visual meaning

- Cyan appears only on the name-origin panel and the 6 belief cards. It marks identity.
- Green link titles lead to features available now. On hover with a mouse or trackpad,
  and while pressed, the words turn `#11832b` and gain an underline (the arrow does not);
  nothing moves or resizes, and touch keeps no hover.
- Grey holds the 5 planned areas.
- The 2 team biographies use the same grey surface as the roadmap, with approved
  portraits treated as one warm, balanced pair.
- Every section heading uses weight 800 and one responsive size: 29 pixels on
  computers, 26 pixels on tablets, and 22 pixels on phones.
- Otherwise green is reserved for the Contact us actions and the email link.
- The Contact us buttons follow the green-button hover treatment in
  [design-principles.md](../design/design-principles.md): a mouse or trackpad at
  tablet and computer widths darkens the fill to `#28bf71`, and a press shows `#24ad66`,
  without moving or resizing the buttons. Touch keeps its existing press feedback; keyboard navigation keeps
  the separate purple focus outline.
- The email link follows the same source's destination-link treatment: at tablet
  and computer widths with a mouse or trackpad, its words turn `#11832b` and gain
  an underline. The link does not move or resize, and touch does not retain hover.

## Small screens

The first response contains the same sections, in the same order, as the loaded screen:
name origin, What Alethical does with every link (Track with its signed-out description),
Why, beliefs, team biographies, the roadmap marked as planned with its feature contact link,
and Contact. Shared words in `aboutUs.ts` keep the 2 presentations aligned. No data request
is needed to serve it. The search description and the organization data state the same
offering as the page.

At 1100 pixels and wider each What Alethical does row puts its introduction on the left and
its links in 2 columns on the right. From 768 to 1099 pixels the introduction sits on top
with 2 link columns below. Below 768 pixels everything stacks. The 2 team biographies sit
side by side on computers, stack with the portrait beside the biography on tablets, and
stack with a smaller portrait above the biography on phones. The belief cards and roadmap
items become 1 column below the phone breakpoint. Every link keeps a target at least 44
pixels tall.

## Grounding boundary

The roadmap names planned work, including Grounded Ask beyond bills. Those items are plain
text, not links, because the features do not exist yet.
