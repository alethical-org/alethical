# Candidate location shortcut and Find button build plan

Net: `/candidates` gains **Use my location**, which suggests a home address for the
reader to confirm before the normal exact official match runs. Both address pages get
the newer Find button size and centring, and the **Change address** Find button keeps
its magnifier beside the word.

Approved source: the reviewed Design bundle `Alethical UX (74).zip`
(9 October 2026), sections "Use my location, 9 Oct 2026" of
`build-facts-candidates.md` and L1 to L5 of `Candidates search.dc.html`, plus the
same-day addendum "/candidates Change address: magnifier beside Find". Governing
behaviour is recorded in
[find-my-candidates-guide.md](../product-onboarding/find-my-candidates-guide.md) and
[find-my-legislator-guide.md](../product-onboarding/find-my-legislator-guide.md).

## Scope

- `/candidates` entry: one centred 840px column, address row with Find (150px) and
  Use my location (200px) on computer and tablet, stacked on phone; help line below
  the divider above the source line; outline below the source line.
- Location states L1 Locating, L2 confirmation card, L3 blocked, L4 too imprecise,
  L5 unavailable.
- Find sizing, 3px optical nudge and **Finding…** busy copy on `/candidates` entry and
  **Change address**; the same width and nudge on `/find-my-legislator`.
- **Change address** Find: magnifier and word stay 1 centred group with a 9px gap in
  ready and busy states; the hidden busy layer only reserves width.

Out of scope: location in **Change address** or on the homepage, any interactive map
on `/candidates`, profiles, claims, account management and other search redesigns.
The legislator finder keeps its coordinate-to-district lookup and map.

## Source and accuracy decisions

- Reverse address: Minnesota's open address points service
  (`loc_addresses_open/FeatureServer/0/query`) answers a point-and-distance query.
  Requests go server to server in a form body, never in a page address.
- The browser reading's accuracy radius decides what can be suggested. Above 100m
  is too imprecise. Otherwise the service collects distinct base addresses within
  the radius plus 30m for address-point placement. The nearest is suggested only
  when every other distinct address is at least the reading's radius (minimum 8m)
  farther away; otherwise the location cannot separate neighbouring buildings and
  the reader types the address. No address nearby is also too imprecise.
- A reading outside Minnesota's bounding box returns the existing
  **This search covers Minnesota addresses** line, shown as information.
- Confirmation is always required, and the confirmed text then uses the same exact
  official street-range match as a typed address.
- Units join in the canonical position, before the first comma
  (`350 S 5th St Apt 3, Minneapolis, MN 55415`). A bare value such as `3` becomes
  `#3`, which states only the number. The official parser also accepts a unit after a
  comma or after the city, and refuses an address carrying 2 different units.

## Steps and checks

1. Backend unit parsing fix and reverse-address endpoint, with pytest coverage of
   comma, comma-free, autofill-shaped, duplicate, conflicting and unsupported units,
   ambiguity, imprecision, outside Minnesota and upstream failure.
2. Shared button restructure (visible group and reserved busy group), sizing and
   copy, with focused component tests.
3. Location flow and confirmation card on `/candidates`, with tests for permission
   only after the click, typing and Find winning in both completion orders, stale
   replies after edits, Enter and composition, privacy reset and retry.
4. Legislator Find sizing.
5. Guides updated in the same change.
6. Browser checks at 1280, 900 and 390, narrow and enlarged text, with controlled
   location fixtures; independent review; pull request, current-head checks, merge,
   deployment and live check.

## Progress

- [ ] 1 Backend
- [ ] 2 Button
- [ ] 3 Location flow
- [ ] 4 Legislator Find
- [ ] 5 Guides
- [ ] 6 Browser, review, release
