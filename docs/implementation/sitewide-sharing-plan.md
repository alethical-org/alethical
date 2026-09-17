# Sitewide sharing corrections

The user authorized the shared panel build on September 17, 2026, then explicitly
said “Fix it now” for the omitted results controls and repeated share copy. The
follow-up includes the modal preview. Its heading and prepared text must not repeat
the same information. Authorization continues through the verified live release.

## Scope and decisions

- Reuse the existing shared desktop popover and phone/tablet sheet, with one
  shared body for preview, copy, destination buttons, and device sharing.
- Destination order: Email, WhatsApp, Facebook, LinkedIn, X, Bluesky.
- Show the record name once and only complementary context underneath. The visible
  heading names what is shared, such as **Share this committee** or **Share these
  payment records**. It labels the window and is never part of the outgoing message.
  Use the same words for accessible names. Never ship drawing sample facts.
- Preserve the approved desktop Copy/Copied and sheet Copy link/Link copied
  labels. Email puts the title in its subject and context/link in its body.
  Device sharing sends one complete message and one URL without a second title.
- Add Share to name-search results, named payments, committee payments, races,
  outside-spending subject results, and outside-spending browse results. Preserve
  displayed year, tab, search, filters, sort, page, and valid race anchors.
- Keep Share on the existing records and articles. Leave `/money`, `/money/lobbying`,
  pure record-chooser directories, and individual payment rows without new buttons.
  Footer links stay unchanged. Browser support controls device sharing.
- Numbers and URLs use Libre Franklin and equal-width digits.
- Copy success requires a successful clipboard operation. Failures remain
  visible and leave the selectable public URL available.

## Delivery sequence

1. Results helper adds heading controls and accepted-view copy/address helpers.
2. Main agent repairs record copy, dialog text, and destination payloads.
3. Test helper updates existing suites for all subjects, non-repeating copy,
   clipboard success/failure, and device sharing.
4. Main agent integrates and runs formatting, TypeScript, focused/full tests,
   and real-browser checks at all 3 widths, including short viewports.
5. Independent reviewer inspects the complete change. Main agent fixes findings,
   opens a pull request, waits for required checks and the merge queue, then
   exercises deployed Share controls without posting or sending anything.

## Current checkpoint

Working branch: `codex/sharing-results-copy`. Implementation is complete. All 3,240
frontend tests pass. The release build passes at 336,228 compressed bytes against
the unchanged 339,072 limit. Browser checks pass in Chromium and WebKit: 29 passed,
with 1 Chromium-only clipboard permission check skipped in WebKit. Independent
reader checks are in progress.
No new release is claimed yet. Do not post or send messages during checks;
intercept prepared destination addresses instead.

The earlier version of this plan incorrectly excluded results controls. That was
not a user decision: the earlier agreed placement scope explicitly included them.
The complete scope is now recorded above and covered by results-specific tests.

The preceding panel-only release and its verification are recorded in
[pull request 2242](https://github.com/alethical-org/alethical/pull/2242).
[How sharing works](../product-onboarding/sharing-guide.md) owns lasting behavior.
