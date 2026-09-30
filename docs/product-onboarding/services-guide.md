<!-- describes: apps/frontend/src/screens/redesign/ServicesScreen.tsx, apps/frontend/src/lib/services.ts, apps/frontend/src/lib/servicesMetadata.ts, apps/frontend/src/lib/servicesPageSnapshot.ts, apps/frontend/src/lib/staticPageMetadata.ts, apps/frontend/src/navigation/ia.ts, apps/frontend/src/navigation/topNavRoutes.ts, apps/frontend/src/navigation/webRoutes.ts, api/page.ts, api/sitemap.ts -->

# How campaign services works

`/services` is public customer marketing for political organizations and individual
campaigns. It requires no account. The same address carries readable service text
before the interactive app loads, page-title and description information for search,
and a sitemap entry. It contains no private client records or purchasing controls.
The first response retains the approved dark content and light shared header,
so starting the interactive app does not replace a white services presentation.

## Ways in

- Choose About, then Services in the shared website navigation. Services sits after
  About us and before Contact us.
- Choose Explore our services in the signed-out homepage's Campaign services card.
- Open `/services` directly.

The shared website navigation remains available above the black presentation.
Local Services, Partners and Early work links scroll to those sections. Contact Us
opens the contact panel. The production presentation omits the design's private
preview label and duplicate website wordmark.

## The presentation

The opener says “Political intelligence. Practical campaign support.” It presents
campaign-finance research, websites, marketing and custom software development,
plus partner services. Its audience label is “FOR ORGANIZATIONS AND CAMPAIGNS”.

The audience introduction is unnumbered. For organizations is selected initially.
Choosing For individual campaigns changes the examples to A campaign website,
Research and content, and A clear setup checklist. The keyboard arrow keys switch
between choices; Home and End choose the first and last. The chosen button and
associated examples announce their relationship to readers using assistive tools.

The 5 numbered sections stay in this order:

1. Services: political intelligence, websites and campaign tools, content and marketing.
2. Software and tools: an IN DEVELOPMENT label, customer testing and prioritization,
   candidate profiles, campaign checklists, questionnaire drafting and the marketplace.
3. Partner services: planning and professional support, communications and creative,
   field/data/software, and campaign production. Services are described as available;
   the marketplace's purchasing software is not represented as implemented.
4. Early work: websites, campaign-finance reports, graphics and content planning.
   The accepted design names Aaron Brutger, Kris Babler, Jay Reeves, Trent Dilks,
   Denise Slipy and Tara Killen together as supported Minnesota Forward Coalition
   candidates. Both the coalition name and supplied logo open
   `https://forwardcoalition.com/candidates`. The copy does not claim coalition endorsement.
5. Delivery and pricing: help selecting services, followed by “Pricing is tailored
   to your needs”. The heading stays on 1 line. This section has no Contact Us button.

Exact customer words are shared in `services.ts`, so the loaded screen and first
response do not publish different offers. Exact visual measurements remain in the
implementation. The accepted black design uses Libre Franklin, approved Alethical
and coalition assets, responsive stacked sections, and the dashed software panel.
The 768 and 1100 responsive switch points follow the website's existing rules.

## Contact Us

Contact Us opens a dark panel over the presentation. It says:

> Tell Alethical about your organization or campaign and the support you’re looking for

The contact address is `angel@alethical.com`. Open email draft uses
`mailto:angel@alethical.com?cc=ask@alethical.com`, so the reader's email app prepares
a message to Angel with Ask copied. Opening the panel sends nothing; the reader
must choose to send the draft in their email app. This is separate from the
website's general Contact us form at `/about/contact`.

Close, Escape and the background outside the panel dismiss it. Opening moves
keyboard focus to Contact Us; Tab stays within the panel. Closing returns focus
to the button that opened it. Short screens can scroll the panel's contents.
Buttons and links retain the accepted pointer-hover and visible keyboard-focus
feedback. Reduced-motion settings avoid smooth section scrolling.

## Scope and follow-up

This presentation does not implement candidate profiles, questionnaire generation,
purchasing, partner contracts or campaign data sharing. It publishes no package
prices, investor figures, funding guarantees or claims that money proves motive.
Engagement details, partner arrangements and testimonial permissions remain in
[the internal campaign services plan](../plans/campaign-services-presentation.md).

Accepted design: `Alethical UX (44).zip`, completed September 30, 2026 at 16:01,
SHA256 `8824ca383409734d2112e7fcfef68cb1dd64ccc269ba35771cc3c9a74c23ce8e`.
The explicit public build instruction supersedes its older private-access notes.
