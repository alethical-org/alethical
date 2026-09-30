# Campaign services presentation: approved direction and internal follow-up

Status: Implementation authorized on 2026-09-30 by “bd services page which services in the nav will go to, see the task building nav & account menu”. `/services` is public. The accepted September 30 download restores the supported candidate names and coalition link. The older private access plan and name-removal instruction are superseded.

## Delivery checkpoint

- Branch: `codex/public-services`, in the services task's isolated worktree.
- Tracking: [issue 2432](https://github.com/alethical-org/alethical/issues/2432).
- Accepted source: `Alethical UX (44).zip`, completed September 30 at 16:01; SHA256 `8824ca383409734d2112e7fcfef68cb1dd64ccc269ba35771cc3c9a74c23ce8e`.
- Exact interface, content and contact behavior are described by [services-guide.md](../product-onboarding/services-guide.md).
- [x] Implement the native web screen, assets, route, server-readable content, metadata and sitemap entry.
- [x] Check 320, 375, 768, 924, 1100 and 1280 layouts, keyboard audience controls, anchors, and contact focus/close/draft address. The browser suite covers 14 checks in each engine, including homepage and About-menu entry points.
- [x] Accept the independent reader review and Safari checks; the reader review passed at 1280, 390 and 320 widths.
- [x] Rebase after the combined navigation release, [pull request 2431](https://github.com/alethical-org/alethical/pull/2431), then add Services after About us and enable the homepage services card. Other navigation and homepage work remain intact.
- Current-head release checks and public browser evidence are recorded in [issue 2432](https://github.com/alethical-org/alethical/issues/2432) after deployment.
- The public build omits the private-preview banner. Shared navigation replaces the prototype's duplicate wordmark; the local section links and Contact Us remain. No sign-in restriction, purchasing, customer profiles or outbound email sending is implemented.


## Current design review

- The Codex presentation was removed at the user's request. The former preview at `http://127.0.0.1:49317/` is no longer served.
- Preserve Claude Design versions and the supplied September 29 design system and shared brand assets.
- The user prefers Claude version 3 except for version 4's Software and tools section.
- Accepted numbering in the September 30 design: leave the audience introduction unnumbered, then number Services, Software and tools, Partner services, Early work, and Delivery and pricing from 01 to 05.
- Leave visual taste decisions to Claude Design.
- The revised opener uses “Political intelligence. Practical campaign support.” Partner services are presented as available through Alethical; the user confirms Kris already provides services with Alethical. This does not establish that marketplace purchasing software is implemented.
- Keep company-facing wording and “Contact Us” labels. The September 30 build instruction authorizes this public presentation through live release.

## Purpose and audience

- Create 1 customer-facing presentation for political intelligence, campaign services, software, and a broad partner marketplace.
- Organizations are the main business focus. Individual candidates and campaign teams are customers from the start, including early learning and traction from Angel's existing free work.
- Keep investor content out completely, including financial forecasts, market-size estimates, investor testimonials, and fundraising arguments.
- Start with Minnesota relationships and examples. Do not imply unverified geographic coverage.
- Define content first, then design the presentation, then obtain the build go. Completing the presentation precedes committing to the heavier candidate-profile and marketplace implementation.
- Present the value of candidate profiles, campaign tools, and the marketplace now. The user explicitly says software is being developed around client needs and existing supported campaigns will beta test it. Describe development and beta status honestly instead of either omitting the value or implying every tool is already available.

## Marketing level

- Keep the presentation high level and focused on customer value, services, examples, and a contact path.
- Broaden the opening beyond reports and websites to software, marketing, and specialist campaign support. Specific voter-data services belong in the detailed partner offering.
- Alethical's core offering includes campaign-finance intelligence, factual research, websites, graphics, content, and practical campaign tools.
- Do not present Alethical as managing every campaign function.
- The campaign checklist can connect customer needs with Alethical services and suitable external providers. Present that value without claiming the interactive checklist or purchasing system already exists.
- Preserve the section title **Delivery and pricing**. Publish no package prices, ranges, or investor pricing estimates. Angel discusses pricing privately according to the specific client's needs while market pricing is established.
- Keep the mechanics of partner purchasing, contracts, subscriptions, revenue sharing, and placement fees out of the marketing. These remain private business decisions.
- Do not make operational details such as post-election handoff, support limits, approved contacts, campaign counts, cancellation, or revision policies part of the high-level sales narrative.

## Partner marketplace

- Kris Babler is a partner provider, not an alternative spelling or a separate unresolved identity. Do not name him as the partner provider in the marketing; the latest design separately lists him among supported candidates.
- The marketplace includes other providers and is not limited to his platform.
- User-described capabilities include voter-file handling, canvassing maps and walking routes, texting, outreach tracking, and access for multiple campaigns.
- Broader marketplace categories include campaign operations and consulting; election-law and compliance professionals; fundraising services; communications and media relations; branding, photography and video; digital marketing; field teams and volunteer coordination; data and polling; campaign software and databases; and printers, mailers, signs, apparel, and other production vendors.
- Political and candidate-support organizations may be customers, partners, or referral channels. Do not automatically portray every organization as a vendor or every named prospect as an existing partner.
- Distinguish currently deliverable services, developing products, and explored capabilities. Do not claim a provider is vetted, contracted, or ready without evidence.
- Do not imply that using a common provider permits sharing private information between campaigns.
- The assistant's scope covers the commercial presentation, factual research, and ordinary operations, not development of voter-targeting models, persuadability scoring, or tailored political persuasion.

## Examples and names

- Correct spelling: **Aaron Brutger**. Do not carry forward “Aaron Brudger.”
- Supplied context identifies websites for Aaron Brutger and Jay Reeves; a campaign-finance report for Trina Swanson; and graphics and content planning for coalition candidates.
- These are user-supplied descriptions of work, not an independent assessment of the actual artifacts, outcomes, or permissions.
- The accepted September 30 design names Aaron Brutger, Kris Babler, Jay Reeves, Trent Dilks, Denise Slipy, and Tara Killen together as supported Minnesota Forward Coalition candidates. It does not assign specific deliverables to individual candidates. The coalition text and supplied logo link to `https://forwardcoalition.com/candidates`.
- Denise Slipy, Kim, Aaron Brutger, Jay Reeves, and other supported candidates are potential sources of feedback and testimonials. Denise and Kim were named as possible candidate-profile testers.
- Obtain actual examples and exact approved quotes. Distinguish permission for private use from permission for eventual public use. Accurately describe free or discounted work.

## Public viewing

- On September 30, the user changed the plan: `/services` will be public, without the earlier sign-in restriction to 4 accounts.
- Public marketing access does not grant access to private customer data, examples, or downloads. Any work samples or testimonials must be approved for public use.
- Services appears in the shared About menu after About us and before Contact us. The homepage services card opens `/services`.
- The September 30 build instruction authorizes implementation and publication. No viewing permissions were activated under the superseded private plan.

## Internal follow-up retained for later

These tasks are deliberately kept outside the high-level marketing. They are not completed or authorized product implementations.

- [ ] Identify available delivery staff, responsibilities, capacity, and supported services.
- [ ] Gather actual websites, reports, graphics, and customer feedback.
- [ ] Secure exact testimonial and example permissions for private and public use separately.
- [ ] Confirm the first set of partner providers, available services, beta status, and responsibilities.
- [ ] Agree whether customers purchase directly from partners or through Alethical; define contracts, subscriptions, commissions, and paid placement privately.
- [ ] Define any provider review standard and paid-placement disclosures before describing providers as vetted or recommended.
- [ ] Develop prices privately with Angel from client needs, delivery time, outside costs, revisions, and support. No published prices yet.
- [ ] Define deliverables, geography, dates, turnaround, revisions, client inputs, approvals, support limits, and exclusions per engagement.
- [ ] Define ownership of websites, accounts, source files, finished materials, and client data.
- [ ] Define ongoing charges, cancellation, post-election support, handoff, export, and retention/deletion.
- [ ] Define supported campaign counts and contacts for organization contracts.
- [ ] Resolve eligibility, competing-client conflicts, confidentiality, and provider/client data boundaries.
- [ ] Establish applicable treatment of free or discounted business services with campaign treasurers or qualified advisers.
- [ ] Obtain appropriate advice for serving campaigns and independent-expenditure organizations; establish any needed staff and information separation.
- [ ] Confirm rights and permitted uses for externally supplied voter, donor, and campaign data.
- [ ] Scope customer-led software development and beta participation without promising unscoped features or dates.
- [ ] Define how candidate-supplied profile material differs from Alethical's sourced public records; separately decide any paid visibility or placement policy.
- [ ] Define contact recipient and response expectations for the presentation.
- [ ] Keep the 2027 organization-sales plan internal; use observed purchases and delivery evidence rather than investor projections.
- [ ] Agree accurate website attribution, such as “Website built by Alethical,” where appropriate; do not promise search-ranking gains.
- [ ] After content approval, prepare Design's complete brief and review the returned design before implementation.
- [ ] During the authorized build, test public viewing without sign-in, phone and desktop layouts, and the contact path; keep unrelated private customer content protected.

## Content accuracy

- Follow [grounded-answers.md](https://github.com/alethical-org/alethical/blob/main/.claude/rules/grounded-answers.md) and [Alethical Philosophy](https://github.com/alethical-org/alethical/blob/main/docs/philosophy.md).
- Describe documented contributions and spending. Do not imply money establishes motive, corruption, or causation.
- Explain matching and classification methods where research uses them. A matching name alone does not establish identity.
- Distinguish official totals from available itemized records; do not call every figure a minimum.
- State actual coverage, dates, and update schedules; do not promise unproven real-time or national services.
- Keep public reporting accurate regardless of paid relationships.
