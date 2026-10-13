# Contextual page returns: release checks

[Issue 2596](https://github.com/alethical-org/alethical/issues/2596) carries the
current delivery status and final live evidence. This task owns the full release;
the working folder is retained for follow-up.

## Approved outcome

Every page-return control uses `Back to <destination name>` and opens the page it
names. Existing safe contextual returns preserve query, filters, tabs, pagination
and reading position. Direct entries use explicit named safe fallbacks. Fixed
money and lobbying returns keep their approved destinations. Workflow, recovery,
Close and Previous controls retain their distinct actions. Candidate private
addresses, draft answers and account boundaries remain protected.

The canonical requirement is
[design-principles.md, Contextual page-return links](../design/design-principles.md#contextual-page-return-links).

## Work and completion checks

1. Update generic and custom controls, including initial HTML: every inventoried
   return placement names the actual destination with matching address and action.
2. Save only safe public earlier destinations and served names. Keep permitted
   account/admin/editor context in memory, scoped to current account and access,
   never serialized in browser history. Do not infer identity or retain
   authentication fields or candidate private input. Keep direct and
   storage-unavailable fallbacks usable.
3. Align current requirements and add required source/build checks: source
   detection supplements rendered interaction checks and does not prove navigation.
4. Run focused and complete frontend tests, type and format checks, the production
   build, rendered contextual/copy/direct-entry checks and candidate draft/scroll
   checks at desktop, tablet and phone widths.
5. Independently review affected uses and prevention, fix material findings, then
   complete upload checks, pull-request checks, merge and deployment.
6. Exercise live changed public paths without authentication, account writes or paid
   answer generation; inspect destination names, links, context and responsive use.
7. Deliver the complete Design update prompt with settled names, behavior,
   precedence and affected drawings. Design sending is reserved for the explicit
   route requested by the maintainer; this release supplies the prompt.

## Impact and prevention

Cause: the shared return printed generic wording while ordinary clicks used
historical context and copied links used a different fallback. Affected uses:
26 shared-control placements, fixed custom money/writing controls and their first
HTML responses. Shared correction: resolve one destination and readable name for
visible text, accessible text, address and ordinary activation. Preserve deliberate
fixed returns and existing article/outside-spending bookmarks. Prevent recurrence
with a required name in the shared control, source validation, rendered destination
agreement tests and review of contradictory handoffs. Static drawings and source
scans do not establish runtime behavior.

The first public review also exposed the boundary before the app starts: article
links in the initial collection response omitted their safe source, so an early
click became a direct visit with the Blog fallback. Initial collection links now
carry the same source page and item bookmark as the app. Endpoint regressions
follow those links through Research reports, Short posts, Guides, a guide set and
a paged topic. The lobbying snapshots also replaced their common return links:
2 directory labels and 2 record returns now keep `Back to Lobbying`, preserving
separate source and directory-browse links. Tests cover every affected snapshot.

Independent rendered review also exposed 3 confirmed consistency gaps: reordered
search parameters could create a new entry during Back and lose saved scroll;
phone/tablet legislator profiles did not save their inner scroll position; and
reading links advertised an item bookmark that their ordinary Back omitted.
Preserve history entry identity for route-equivalent addresses, apply the existing
scroll-restoration hook to the mobile profile, and place the reading bookmark on
its source entry before opening an article. The built regression exercises all
3 failures across the supported layout bands.

Local acceptance on 13 October 2026: 4,612 frontend tests passed across 355 suites;
type and format checks passed. Independent browser review passed 21 scenarios at
390, 900 and 1280 pixels, including actual new-tab activation, keyboard/touch,
long names and exact saved reading positions. Live production evidence remains
part of the release task's acceptance record. The first live browser pass covered
15 public paths at all 3 widths; the final release still requires first-response
and live-reader acceptance for its deployed commit. Public live review does not
substitute for protected-path tests.

The final local export measures 280,107 compressed startup bytes against the
unchanged 297,506-byte limit. A preceding hosted preview measured 297,535 bytes
and was refused by that same limit. Existing deferred sections now hold legacy
header, desktop navigation and mobile tab contents until needed. The outer
navigation frames, visibility conditions, labels, actions and styling remain unchanged. This
settings-less export establishes no production headroom; the hosted build must
pass its own enforced measurement.

TV ad records remain admin-only. No shipped admin parent exists in the reviewed
source, so this change invents no TV ad address or parent label. Protected account
and admin paths require source review and existing automated guards; public live
checks do not authenticate to reach them.
