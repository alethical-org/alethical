# Bill tracking interaction spec

<!-- describes: apps/frontend/src/components/billDetail/BillTrackButton.tsx, apps/frontend/src/components/billDetail/TrackedListUnavailableNotice.tsx, apps/frontend/src/components/search/BillResultCard.tsx, apps/frontend/src/data/api.ts, apps/frontend/src/hooks/useAppQueries.ts, apps/frontend/src/hooks/useBillTracking.ts, apps/frontend/src/lib/billCardControlLayers.ts, apps/frontend/src/lib/signIn.ts, apps/frontend/src/lib/trackIntent.ts, apps/frontend/src/lib/trackReturn.ts, apps/frontend/src/navigation/types.ts, apps/frontend/src/providers/SignInModalProvider.tsx, apps/frontend/src/providers/TrackedBillWriteProvider.tsx, apps/frontend/src/providers/trackedBillWriteContext.ts, apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileWebScreen.tsx, apps/frontend/src/screens/redesign/TrackedBillsScreen.tsx, apps/frontend/src/components/tracked/TrackedCommitteeCard.tsx, apps/frontend/src/lib/trackedPage.ts, apps/frontend/src/hooks/useCommitteeTracking.ts, apps/frontend/src/components/campaignMoney/TrackCommitteeButton.tsx, apps/frontend/src/lib/trackCommitteeButton.ts -->

Status: shipped behavior. The sign-in dialog's flows, states and copy are documented in
`docs/product-onboarding/sign-in-guide.md`; this document owns the Track interaction that
opens it.

## One behavior on every surface

`BillTrackButton` is the one Track control on the bill page, Search cards, Home bill
activity, `bill_text` and `topic_bills` answer pages, legislator-profile bill cards,
and the Tracked page. Every surface uses the same states and behavior.

- Untracked is the black `#11150f` button with white `+ Track`; tracked is the mint
  `✓ Tracked` form. It is one toggle with a 44px minimum target.
- A signed-in press writes the requested final state. Pressing `+ Track` saves; pressing
  `✓ Tracked` removes.
- A signed-out press opens the shared sign-in dialog over the current page. It never opens
  the bill, navigates to a sign-in page, or changes the current URL.
- The Track dialog uses the bell and says: “Save {bill} to your tracked bills and check where it
  stands whenever you come back.” It uses **this bill** when no bill number is available.
- Closing the dialog changes nothing. The page, scroll position, and `+ Track` state stay
  as they were, with no error notice.

## Returning from sign-in

Before Google replaces the page or Alethical requests an account code, the app asks the
server for a random, single-use pending-action reference. The server row contains only the
reference fingerprint, action type, bill id, a checked Alethical return path, and an expiration
time. It is not attached to an account before sign-in. The browser holds the random reference
and may also hold the current scroll position for the Google return; the server holds the
pending action used by both Google and account-code completion.

After a successful Google return or proved email code, the server saves the bill and consumes the
reference in one protected transaction. A retry or second tab cannot save it twice. The app
restores the safe return page and, for Google in the same browser, its scroll position.
Successful cache refreshes make every copy of the button read `✓ Tracked`; the reader never
has to press Track a second time. Old incoming `?track=1` links remain accepted for
compatibility, but new Track requests do not create them or redirect to a bill page.

The app waits for its saved-session check before deciding whether a Google return error is
still real. A valid signed-in session wins over an old or repeated return error, and the
saved Track request still finishes. With no valid session, the dialog shows the real error
and keeps the same Track request ready for **Try again**. One fast double press can start
only one Google sign-in attempt.

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

## The Tracked page: two lists

`/tracked` (`TrackedBillsScreen.tsx`) is where everything a signed-in reader saved
lives. The h1 reads **Tracked**, the line under it **What you are following**, and the
page holds 2 lists ([#1943](https://github.com/alethical-org/alethical/issues/1943)):

- **Bills**, grouped into what moved since the reader's last visit and, under a
  `NO CHANGE` divider, what did not. The count and its dated caption above the list
  speak for the bills alone. Each bill card is the shared `BillResultCard` with its
  Tracked-only kind label `BILL` before the code badge; the other 5 places that card
  draws (search results, the signed-out home feed twice, the Ask answer page twice)
  never show the label, because those lists hold one kind.
- **Committees**, under the heading `COMMITTEES YOU FOLLOW`, one card per followed
  committee (`TrackedCommitteeCard.tsx`): the kind label `COMMITTEE`, the registration
  number, the committee's name as the Board's register spells it, and a line naming its
  kind and, for a candidate committee, the seat it registered for ("Candidate
  committee · Senate District 55"). The card links to the committee's money page.

A committee never sits inside the bills' grouping, and never under `NO CHANGE`.
Following a committee is a bookmark: nothing notifies anybody, and nothing computes
whether a committee's filings moved, so filing it under "no change" would claim a
check nobody performs. If filings ever notify, committees join the grouping and the
third list dissolves.

A committee joins the list from its own money page, where a signed-in reader finds
**Track** beside Share (`components/campaignMoney/TrackCommitteeButton.tsx`, words and
state rule in `lib/trackCommitteeButton.ts`). It is the bill control's twin: the same
black `+ Track` and mint `✓ Tracked` forms read from `billTrackButtonAppearance.ts`, one
toggle with `aria-pressed`, and under the tracked form one line, "On your tracked list",
whose last 2 words link here. Signed out, the committee page draws no Track control:
following a committee while signed out is deliberately not built. The committee page
itself is described in `docs/product-onboarding/campaign-money-section-guide.md`.

Signed in with nothing saved, the page shows one sentence: **Nothing tracked yet.
Track a bill or a committee and it stays on this list.** It promises that a saved thing
stays on the list and never that anyone will be told anything. Signed out, the page
shows the sign-in card as before. Every fixed sentence on the page lives in
`apps/frontend/src/lib/trackedPage.ts` and is pinned by its test.

The account menu's Tracked Bills row and its count still speak for bills alone.
