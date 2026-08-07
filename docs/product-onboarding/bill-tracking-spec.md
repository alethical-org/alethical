# Bill tracking interaction spec

<!-- describes: apps/frontend/src/components/billDetail/BillTrackButton.tsx, apps/frontend/src/components/billDetail/TrackedListUnavailableNotice.tsx, apps/frontend/src/components/search/BillResultCard.tsx, apps/frontend/src/data/api.ts, apps/frontend/src/hooks/useAppQueries.ts, apps/frontend/src/hooks/useBillTracking.ts, apps/frontend/src/lib/billCardControlLayers.ts, apps/frontend/src/lib/signIn.ts, apps/frontend/src/lib/trackIntent.ts, apps/frontend/src/lib/trackReturn.ts, apps/frontend/src/navigation/types.ts, apps/frontend/src/providers/SignInModalProvider.tsx, apps/frontend/src/providers/TrackedBillWriteProvider.tsx, apps/frontend/src/providers/trackedBillWriteContext.ts, apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileWebScreen.tsx -->

Status: shipped behavior. The sign-in dialog's visual design remains in
`docs/mockups/sign-in/`; this document owns the Track interaction that opens it.

## One behavior on every surface

`BillTrackButton` is the one Track control on the bill page, Search cards, Home bill
activity, `bill_text` and `topic_bills` answer pages, legislator-profile bill cards,
and the tracked-bills list. Every surface uses the same states and behavior.

- Untracked is the black `#11150f` button with white `+ Track`; tracked is the mint
  `✓ Tracked` form. It is one toggle with a 44px minimum target.
- A signed-in press writes the requested final state. Pressing `+ Track` saves; pressing
  `✓ Tracked` removes.
- A signed-out press opens the shared sign-in dialog over the current page. It never opens
  the bill, navigates to a sign-in page, or changes the current URL.
- The Track dialog uses the bell and this exact copy: “Track bills across sessions and
  pick up where you left off. Your tracked list is saved to your account.”
- Closing the dialog changes nothing. The page, scroll position, and `+ Track` state stay
  as they were, with no error notice.

## Returning from Google

Google replaces the page during sign-in, so the Track request is saved before leaving.
The saved request includes the bill id, the exact local path with query and fragment, and
the current vertical scroll position. The same return URL is sent through the OAuth state.
Component memory is not relied on.

After a successful return, the app restores that exact page and scroll position and sends
an idempotent request to save the bill. Successful cache refreshes make every copy of its
button read `✓ Tracked`; the reader never has to press Track a second time. Old incoming
`?track=1` links remain accepted for compatibility, but new Track requests do not create
them or redirect to a bill page.

## Honest failures

A failed save or removal never changes the button to a state the server did not accept.
The button becomes the existing outlined retry form, and retry repeats the saved final
state instead of blindly toggling. Search also shows its page-level notice; the other
surfaces keep the quiet per-button failure form, as specified in the Search screen spec.

## Controls inside a full-card link

Cards use a full-size real bill link so the empty card area is clickable and normal link
features still work. The layers are fixed and shared:

1. The full-card bill link is layer 1.
2. Card content is layer 2 and passes pointer hits through by default.
3. Track, author, companion-bill, and vote controls are layer 3 and accept pointer hits.

This applies to Search, Home, both answer-card types, legislator profiles, and the tracked
list. A Track press must leave the URL unchanged. Author and vote links may navigate only
to their own stated target, never to the surrounding bill link.
