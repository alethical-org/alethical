# Sitewide sharing build

The user authorized implementation and the verified live release of the sharing
panel in `Alethical UX (15).zip` on September 17, 2026. The earlier advice-only
boundary ended with the user's explicit go. The drawings are visual references,
not authority to change record facts or widen Share-button placement.

## Scope and decisions

- Reuse the existing shared desktop popover and phone/tablet sheet, with one
  shared body for preview, copy, destination buttons, and device sharing.
- Destination order: Email, WhatsApp, Facebook, LinkedIn, X, Bluesky.
- Keep the existing page-supplied titles, descriptions, preview descriptions,
  and public URLs. Never ship drawing placeholders or sample record facts.
- Preserve the approved desktop Copy/Copied and sheet Copy link/Link copied
  labels. Wording proposals are not instructions to rewrite outgoing text.
- Do not add results sharing or new Share-button locations. Footer links stay
  unchanged. Browser support, rather than a device list, controls device sharing.
- Numbers and URLs use Libre Franklin and equal-width digits.
- Copy success requires a successful clipboard operation. Failures remain
  visible and leave the selectable public URL available.

## Delivery sequence

1. Main agent implements shared panel and responsive wrappers. Verify against
   the approved desktop, tablet, and phone drawings.
2. Destination helper owns share.ts and its focused tests. Verify official
   intent formats, useful prepared text, intact URLs, and Unicode boundaries.
3. Test helper owns rendered panel tests and affected source guards. Verify
   all subjects, destination order, clipboard success/failure, and device sharing.
4. Main agent integrates and runs formatting, TypeScript, focused/full tests,
   and real-browser checks at all 3 widths, including short viewports.
5. Independent reviewer inspects the complete change. Main agent fixes findings,
   opens a pull request, waits for required checks and the merge queue, then
   exercises deployed Share controls without posting or sending anything.

## Checkpoint

Implementation and independent code review are complete. The review's missing
dialog name is fixed in both wrappers. TypeScript, formatting and 3,106 frontend
tests pass. Browser checks pass at desktop, tablet, phone and short desktop sizes
in Chromium and WebKit: 11 passed, with Chromium-only clipboard permission testing
skipped in WebKit. A fresh-context reader check is in progress.

Remaining: reader findings, current-head release checks, pull request, merge queue,
deployment and live verification. The branch is `codex/sitewide-sharing`.
[How sharing works](../product-onboarding/sharing-guide.md) owns lasting behavior.
