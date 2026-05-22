# Pool D Manual Regression Checklist

Use this checklist for the signed-in user path: Supabase auth, bearer-token API calls, `/me`, and tracked bill behavior.

## Web Google Sign-In

- Start the backend and frontend with Supabase env vars configured.
- Open the web app.
- Go to Account.
- Click Continue With Google.
- Complete Google sign-in.
- Confirm the app returns to the expected route.
- Confirm Account shows the signed-in user's name and email from `/me`.
- Refresh the browser.
- Confirm the user remains signed in.
- Sign out.
- Confirm signed-in-only surfaces return to the auth-required state.

## Authenticated API Requests

- Sign in on web.
- Open browser dev tools Network tab.
- Visit Account.
- Confirm `GET /api/v1/me` succeeds.
- Confirm the request includes `Authorization: Bearer <token>`.
- Visit Tracked Bills.
- Confirm `GET /api/v1/me/tracked-bills` succeeds with the bearer token.
- Force an expired or missing token if possible.
- Confirm protected routes return a clear unauthorized state in the UI.

## Track And Untrack From Search

- Sign in.
- Go to Home/Search.
- Click Track on a bill card.
- Confirm the card does not navigate to bill detail when only Track is clicked.
- Confirm the card changes to Tracked.
- Refresh the page.
- Confirm the tracked state remains correct.
- Click Tracked again.
- Confirm the bill becomes untracked.
- Rapidly click Track/Tracked several times.
- Confirm duplicate requests do not create confusing UI state.

## Track And Untrack From Bill Detail

- Sign in.
- Open a bill detail page.
- Click Track.
- Confirm the button changes to Tracked.
- Go back to Search.
- Confirm the same bill appears tracked there.
- Return to Bill Detail.
- Click Tracked to untrack.
- Confirm Search and Tracked Bills update after navigation/refetch.

## Tracked Bills Screen

- Sign in.
- Track at least two bills.
- Open Tracked Bills.
- Confirm both bills appear.
- Untrack one bill from the Tracked Bills screen.
- Confirm the removed bill disappears or updates cleanly.
- Open the remaining bill from Tracked Bills.
- Confirm navigation to detail works.
- Return to Tracked Bills.
- Confirm state is still correct.

## Legislator Profile Sponsored Bills

- Sign in.
- Open a legislator profile with sponsored bills.
- Track a sponsored bill from the legislator profile.
- Confirm it updates without navigating unexpectedly.
- Open Search and confirm the same bill appears tracked.
- Open Tracked Bills and confirm the bill appears there.

## Mobile Auth Smoke

- Run the app on iOS or Android.
- Tap Continue With Google.
- Confirm the external auth browser opens.
- Complete sign-in.
- Confirm the app receives the callback at `alethical://auth/callback`.
- Kill and reopen the app.
- Confirm the session persists.
- Sign out.
- Confirm reopening the app remains signed out.

## Cross-Device Session Sanity

- Sign in on web and track a bill.
- Sign in as the same user on mobile.
- Confirm the tracked bill appears on mobile.
- Track or untrack a bill on mobile.
- Refresh web.
- Confirm web reflects the latest tracked state.

## Expected Open Questions

- Confirm Supabase production redirect URLs include local web, production web, and native deep links.
- Confirm production Render backend has `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
- Confirm frontend deploy has `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_API_URL`.
- Confirm CORS allows the deployed frontend origin.
