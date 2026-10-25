# Debate hosting and event production on services

Pre-release implementation and acceptance record. Final delivery evidence and current release status: [issue 2731](https://github.com/alethical-org/alethical/issues/2731).

## Scope and accepted design

The public `/services` presentation adds debate hosting and event production. The latest Design conversation removes the service-specific Host a debate button; the existing generic Contact Us panel handles inquiries. The replay page retains its own separate hosting invitation.

Accepted bundle: `Alethical UX (5).zip`, downloaded October 25, 2026; SHA256 `9ed51e6fc641915e40ad1f03015a39817cb455b6c79a0447cb336cd8d1ebd4ba`.
Drawings: `exports/design_handoff_services_debate/Campaign Services.dc.html` and `Campaign Services print.dc.html`. Exact fixed copy and states are in the bundle's `PROMPT.md`; its instructions are reference, not independent authorization.

The live-build instruction on October 25 authorizes implementation, checks, merge, deployment and live review. Earlier design-only hold is lifted. No real email send, new contact purpose, new image, package/price promise, sharing control or unrelated redesign.

## Owners and work order

Current task owns content, screen, first response, print, integration and live delivery. An independent reviewer checks this comparison before implementation and reviews the rendered result before release. One writer for all product files.

1. Establish the latest design and comparison coverage.
2. Update shared copy, loaded service row, first response, print pagination and owning guide.
3. Run types, focused content/browser/print checks; inspect rendered output against the drawings.
4. Reconcile independent review; push, merge through checks, follow deployment and verify live.

## Design comparison

All sections retain Libre Franklin and equal-width digits. Screen is dark with approved supplied assets; print uses the supplied white-background wordmark. Phone below 768; tablet 768–1099; desktop from 1100. Exact copy/order comes from the actual drawings and the existing service content, except the accepted changes below. Public anonymous readers need no account.

| Element, in reading order | Expected result | Starting state and checks |
| --- | --- | --- |
| Dedicated header | Existing home wordmark, Services/Partners/Early work section links and generic Contact Us | Desktop/tablet row; phone two rows; home/navigation destinations, hover, keyboard focus, reduced motion |
| Opening | Headline unchanged; subtitle includes events, with no terminal period | Screen, first response and print use identical shared subtitle; readable at all bands |
| Audience introduction and choices | Existing organizations default, campaigns alternative, exact descriptions and examples | Arrow/Home/End, selected/hover/focus, correct panel, both choices on paper |
| Section 01 existing services | Political intelligence, Websites and campaign tools, Content and marketing with all descriptions/lists | Compare beside new row at all bands; print-only Websites and tools title kept |
| Section 01 new fourth service | Debate hosting and event production; Bring candidates and communities together; Watch The Forward Debate | Static row, no bullets/image/date/Host a debate button; same top rule, 32px top/34px bottom spacing; two equal columns from 768, stacked below; link left-aligned |
| Replay action | Same-tab destination https://www.alethical.com/blog/events/forward-debate-2026 | 16px/600 underlined light text, 44px minimum target; hover green at 768+ only; pressed light green at all widths; purple 2px focus/2px offset; destination loads replay; back recovers services |
| Section 02 | Existing IN DEVELOPMENT panel, intro and 4 tools | Exact text, desktop 4 columns, tablet 2, phone stacked; no crowding |
| Section 03 | Existing partner intro and 4 distinct partner groups | Exact lists, provider distinction preserved; 2 columns from 768, green top rules, 19px headings and ruled list rows as drawn |
| Section 04 | Existing early-work text, 6 names, coalition text and logo links | Exact names and destination, readable wrapping |
| Section 05 | Delivery and pricing includes events; pricing line unchanged | Exact two-sentence paragraph; heading remains one line; no added action |
| Footer | Existing shared dark footer and working destinations | Phone/tablet/desktop, full labels, hover/focus, no horizontal overflow |
| Generic contact panel | Existing dark modal, contact address, email draft to angel with ask copied | Open/close/Escape/outside, focus containment/return, short-screen scroll; inspect draft href without sending |
| First response | Same new service, description, replay and updated subtitle/pricing before app startup | JavaScript disabled and loaded parity; actual generated response not just component |
| Print sheet 1 | Existing opener and both audiences, updated subtitle | White wordmark, typography/readability, footer 1 / 5 |
| Print sheet 2 | Existing 3 services plus full-width new row | 24px gap; green 2px rule/17px padding; title/description left, replay label/full address right; no clipping/footer overlap |
| Print sheet 3 | Existing section 02 on its own sheet | All tool text retained at unchanged size; footer 3 / 5 |
| Print sheets 4–5 | Existing partners/early work and delivery/closing | Updated delivery; all text/assets/links and correct 4 / 5, 5 / 5 footers |
| Printing transitions | Exactly 5 portrait sheets in Letter/A4 | Open modal hidden on paper but restored after; audience choice retained; print leaves when navigating away; actual PDFs and no-JavaScript print checked |

## Shared impact and prevention

Shared service copy supplies loaded screen, first-response HTML and print. The new row must appear in all 3, and service metadata must include the same offer. The replay is an example, not a promise about every event's equipment, livestream, venue or outcomes. Existing partner event support stays distinct. Existing shared links and focus patterns handle the new action; no unrelated control changes.

The prior 4-sheet design overflowed; 5 sheets preserve readable text and service grouping. Browser print checks must assert 5 actual PDF pages, all words and no content/footer collisions. A focused check should catch missing replay content in either initial HTML or loaded screen, and the removed button must stay absent.

## Model and route

Keep implementation in this task because the content and screen/print acceptance share one decision. Official OpenAI documentation for GPT-6.1 Sol and reasoning effort was read October 25; the bounded implementation suits the current coding model. A separate read-only review uses GPT-6.1 Sol/high because complete visual/interaction coverage is the consequential judgment. Deeper effort or Astra has no task-specific demonstrated advantage for settled copy and one row; no head-to-head performance claim. Setup and browser/build waits run as ordinary processes, not additional reasoning workers.

## Acceptance evidence

Independent coverage review found and resolved these additions before implementation:

- Header Contact Us opens the dark panel; footer Contact us opens `/about/contact`. Verify distinct destinations.
- Opening includes FOR ORGANIZATIONS AND CAMPAIGNS, specialist-support paragraph and supplied hero marks. Desktop headings stick with a 5:7 split; tablet sections stack; phone headline and marks use the supplied responsive treatment.
- Existing audience strings/examples come verbatim from `services.ts` at base `3d14c1c4`; each is covered by existing audience and print browser checks. Footer destinations come from the shared Footer and are covered by the services footer browser checks. Inspect actual labels and links across bands.
- Panel copy: Tell Alethical about your organization or campaign and the support you’re looking for; CONTACT; angel@alethical.com; Open email draft. Close target 44px, draft 52px; initial heading focus, focus containment/return, backdrop scroll lock, hover and short-screen scroll require rendered evidence.
- Measure description contrast (#b3b3b3 on #0a0a0a; #4f5651 on white) and replay rest/hover/pressed states.

Design export itself has incomplete interaction checks, so it does not establish build acceptance. Native device and screen-reader checks require actual evidence and must not be claimed from phone-sized desktop views.

### Local acceptance

- 52 Chromium/WebKit browser checks pass across 320, 375, 768, 924, 1100 and 1280 widths; 2 actual PDF checks are Chromium-only because WebKit does not expose PDF output. Browser checks cover audiences, route revisits, section navigation, footer, generic contact-panel containment/recovery, replay target/hover/press/keyboard focus and responsive layout.
- Letter and A4 output have 5 pages each; an independent reviewer inspected all 10 rendered pages. The first-response print fixture matches the loaded Letter output. Metro serves a home fallback before app startup, so actual production initial HTML remains a release check, not a local claim.
- Replay description contrast is 9.44:1 on screen and 7.55:1 on paper; replay rest/hover/press are 16.76:1, 8.73:1 and 10.77:1. New content is static, no loading or submission state. No new motion.
- Independent whole-screen review exposed an older partner-section mismatch against the accepted drawing. This build restores the drawn grid, rules, heading size and plain ruled rows. A rendered regression covers 1 column below 768 and 2 from 768 at all 6 widths. No partner copy or service scope changed.
- The route-revisit checks now wait for the services heading before clicking home. This avoids clicking Metro’s initial home fallback before the services app starts, and tests the intended loaded route lifecycle without an artificial delay. Both browser engines pass.
- Overlapping whole-scroll captures cover the entire page at 375, 768 and 1280, supplementing section/control screenshots at all widths. Native-device and screen-reader operation remain untested; browser accessibility semantics, keyboard behavior, visible focus and targets are covered.
- Design-audit pinned rendered-output rubric applied; no new form, overlay, stateful result or shared-control behavior added. Existing contact behavior stays unchanged and is exercised in the browser.

Hold: retain this task and working folder for follow-up.

The first full frontend CI run passed 4,911 checks and exposed 1 obsolete metadata expectation. The corrected literal now asserts the accepted events wording and punctuation; the whole-string sweep found no other copy of the obsolete description. This is a test correction, with no product change.
