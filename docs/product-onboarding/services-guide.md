<!-- describes: apps/frontend/src/screens/redesign/ServicesScreen.tsx, apps/frontend/src/lib/services.ts, apps/frontend/src/lib/servicesMetadata.ts, apps/frontend/src/lib/servicesPageSnapshot.ts, apps/frontend/src/lib/servicesPrint.ts, apps/frontend/src/components/ServicesPrint*, apps/frontend/src/lib/staticPageMetadata.ts, apps/frontend/src/navigation/ia.ts, apps/frontend/src/navigation/topNavRoutes.ts, apps/frontend/src/navigation/webRoutes.ts, api/page.ts, api/sitemap.ts -->

# How campaign services works

`/services` is public customer marketing for political organizations and individual
campaigns. It requires no account. The same address carries readable service text
before the interactive app loads, page-title and description information for search,
and a sitemap entry. It contains no private client records or purchasing controls.
The first response retains the approved dark content and dedicated dark header,
so starting the interactive app does not replace a white services presentation.

## Ways in

- Choose About, then Campaign services in the shared website navigation. Services sits after
  About us and before Contact us.
- Choose Explore our services in the signed-out homepage's Campaign services card.
- Open `/services` directly.

`/services` has 1 dedicated dark header. Its supplied gradient wordmark links to `/`.
Services, Partners and Early work scroll to those sections; Contact Us opens the
campaign contact panel. On phones, the wordmark and Contact Us occupy the first row
and the section links occupy a second row. The white shared navigation stays on
other addresses. The production presentation omits the private-preview label.
Section links keep working after returning home and opening `/services` again,
including when the browser changes between desktop and phone widths. Each link
scrolls the current visit rather than a hidden earlier visit kept in browser navigation.
Audience keyboard focus also stays within the current visit. Services-specific
footer layout settings load with this presentation rather than with every address.

The standard dark Footer follows Delivery and pricing. It keeps the shared brand
message, social accounts, Contact Us (`/about/contact`), Privacy Policy (`/privacy`)
and Terms of Use (`/terms`). Its content aligns with the presentation's 1240px column.
At 768–1099px the footer's brand message and links stack; at 1100px they share a row.
The header contact panel and footer general-contact destination remain distinct.

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

## Printing

Use the browser's Print command at `/services`, including Save as PDF. The screen stays dark; paper uses the approved white Alethical branding. Both audience choices and their examples appear together without clicking. The 4 portrait sheets contain opener and audiences; services and developing tools; partners and early work; delivery/pricing and the closing brand message. Letter and A4 are supported at normal scale. The browser print dialog controls paper, scale and any additional printer margins.

The print presentation uses the same saved service content as the screen. Its sole wording exception is “Websites and tools”, approved because “Give your campaign a useful digital foundation.” already names the campaign. There is no separately maintained PDF or Download as PDF button. The coalition name, coalition logo/address and email remain linked in a saved PDF; email retains `ask@alethical.com` in cc.

Sticky headers, section links, audience controls, the contact panel and the footer's social/general links are omitted. Printing with the contact panel open does not close it or change the selected audience. Returning from print restores the screen. Only the active `/services` visit supplies print content; visiting a different address removes the services print view. The first response also prints when JavaScript cannot run. Content remains visible if changed text grows; browser checks catch extra pages and collisions rather than hiding overflow.

Sheets use a physical Letter-height minimum, so print layout does not follow Safari's window height. A4 has extra white space below this baseline. Print heading colors explicitly replace the dark first-response colors. Fractional letter widths prevent Linux's rounded font measurements from adding lines and extra sheets. Required frontend CI runs print checks, including the real first-response generator in a static-server fixture, and retains Letter/A4 PDFs. Local and live acceptance exercise the server’s own first response.

Approved print reference: `Alethical Services.pdf`, downloaded 7 October 2026 at 10:49:59 Eastern; matching source `Alethical UX (57).zip`. Accepted colors, type, spacing and sheet content are recorded in [campaign-services-presentation.md (approved browser printing)](../plans/campaign-services-presentation.md#approved-browser-printing-7-october-2026).

## Scope and follow-up

This presentation does not implement candidate profiles, questionnaire generation,
purchasing, partner contracts or campaign data sharing. It publishes no package
prices, investor figures, funding guarantees or claims that money proves motive.
Engagement details, partner arrangements and testimonial permissions remain in
[the internal campaign services plan](../plans/campaign-services-presentation.md).

Accepted header/footer update: `Alethical UX (48).zip`, downloaded September 30,
2026 at 18:24 Eastern; SHA256
`5a2cf8fe48966b54e502a4b7f198219b693e97e59f1842c3cd5bd7ab56f434ee`.
Its main content matches the previously accepted `Alethical UX (44).zip`.
The bundle's old private-access notes and prototype contact/social addresses do
not override public access or the site's existing working destinations.
The explicit public build instruction supersedes its older private-access notes.
