# Address help lines and Find my legislators foot notes

<!-- describes: apps/frontend/src/components/candidates/CandidateAddressForm.tsx, apps/frontend/src/components/home/HomeCandidateFinder.tsx, apps/frontend/src/screens/FindMyLegislatorScreen.tsx, apps/frontend/src/components/MapPinPicker.tsx -->

Net: each address help line prints once per page and never between the label and the
field, and the notes at the foot of `/find-my-legislator` read as 1 group at 1 size.

## Scope (approved build, 9 Oct 2026)

1. `/candidates` **Change address** on the results page: no help line; label 10px above
   the field; the field's description names only the message slot.
2. Signed-out homepage candidate lookup: no help line; the address note reads **Your
   address is sent to Minnesota government services for this lookup**, 12px under the
   message slot; the field's description names the note, plus the message while one shows.
3. `/find-my-legislator` address form: no help line between label and field; label 8px
   above the field.
4. `/find-my-legislator` foot notes: a thin line above (1px `rgba(17,21,15,0.08)`, 20px
   padding) with the space above unchanged; order help line, OpenStreetMap credit,
   District lines credit, Census notice; every line 14px/1.5 `#4f5651`, 6px apart; links
   14px semibold `#0f7a45`, words turn `#11150f` and underline on hover while the 19px
   arrow keeps its green stroke 6px after the last word. The field's description still
   names the help line, and names the error line only while one shows.

Not in scope: the `/candidates` entry form (another build moves its help line below
the hairline), Use my location, and Find button sizing.

## Impact and prevention

- Cause: help lines were repeated beside the field on every visit; the foot notes used
  a smaller size than the shared 19px arrow.
- Affected uses: the 3 address forms above. The `/candidates` entry form keeps its line;
  the signed-in homepage's legislator finder has its own wording and is unchanged.
- Prevention: rendered tests check that each help line prints once, that every
  description id exists and carries text, and the foot-note order
  (`CandidateAddressHelp.test.tsx`, `HomeCandidateFinder.test.tsx`,
  `MapPinPicker.test.tsx`, `findMyLegislator.test.ts`).
- Untested: real phone and tablet hardware; screen-reader speech (checked through the
  computed description ids only).
