# Pool D Manual Regression Checklist

Use this checklist for the signed-in user path: Supabase auth, bearer-token API calls, `/me`, tracked bill behavior, saved places, and V1 email notification delivery.

## Local Prerequisites

- Start Docker Desktop.
- Run `just migrate` or `.\.venv\Scripts\python.exe scripts\dev.py migrate`.
- Start the backend and frontend with Supabase env vars configured.
- Confirm the frontend is pointed at the backend with `EXPO_PUBLIC_API_URL`.
- For email-delivery testing, configure a sandbox SMTP provider such as Mailtrap, Resend test mode, or another non-production inbox:
  - `SMTP_HOST`
  - `SMTP_FROM`
  - `SMTP_PORT` if not `587`
  - `SMTP_USERNAME` and `SMTP_PASSWORD` if required
  - `SMTP_USE_TLS` if the provider needs a non-default value

## Web Google Sign-In

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
- Visit Account.
- Confirm `GET /api/v1/me/notification-preferences` succeeds with the bearer token.
- Confirm `GET /api/v1/me/notification-events` succeeds with the bearer token.
- Confirm `GET /api/v1/me/saved-places` succeeds with the bearer token.
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

## Account Saved Places

- Sign in.
- Go to Account.
- Confirm saved places load from `/api/v1/me/saved-places`.
- Confirm any saved place address shown in the UI matches the API payload.
- Confirm district text is shown when the API returns `house_district` or `senate_district`.
- Confirm an empty saved-place list renders cleanly for a user with no saved places.

## Notification Preferences

- Sign in.
- Go to Account.
- Confirm notification preferences load from `/api/v1/me/notification-preferences`.
- Toggle Bill updates off.
- Refresh the page.
- Confirm Bill updates remains off.
- Toggle Bill updates on.
- Refresh the page.
- Confirm Bill updates remains on.
- Toggle Weekly digest.
- Confirm the email preference frequency changes in the API response.
- Toggle Hearing alerts.
- Confirm the push preference changes in the API response, but do not treat push delivery as a V1 launch requirement.

## V1 Email Notification Events

- Sign in.
- Ensure Bill updates are on.
- Track at least one bill that has a `latest_action_at` value in the database.
- Run notification event generation without sending:
  - Local: `.\.venv\Scripts\python.exe scripts\run_notifications.py --target local --lookback-hours 8760`
  - Use a large `--lookback-hours` value if seeded fixture action dates are old.
- Go to Account.
- Confirm recent notification activity appears.
- Confirm `GET /api/v1/me/notification-events` returns at least one event.
- Confirm the event has:
  - `channel` = `email`
  - `event_type` = `tracked_bill_update`
  - `status` = `pending`
  - a bill-specific `subject`
  - a body containing latest status/action information and an official source when available.

## V1 Email Delivery

- Configure sandbox SMTP env vars before running the worker.
- Run: `.\.venv\Scripts\python.exe scripts\run_notifications.py --target local --send-only`
- Confirm the sandbox inbox receives the email.
- Refresh Account.
- Confirm the notification activity changes to `sent`.
- Confirm `GET /api/v1/me/notification-events` shows `status` = `sent` and a non-empty `sent_at`.
- If SMTP env vars are missing or invalid, confirm the event becomes `failed` and `failure_reason` explains the delivery problem.

## Notification De-Duplication

- With an existing tracked bill notification event present, run generation again:
  - `.\.venv\Scripts\python.exe scripts\run_notifications.py --target local --lookback-hours 8760`
- Confirm no duplicate notification event is created for the same user, bill, event type, and bill status/action snapshot.
- Update or ingest a bill so its status/action snapshot changes.
- Run generation again.
- Confirm a new event is created for the changed snapshot.

## Notification Preference Suppression

- Sign in.
- Turn Bill updates off.
- Run notification generation.
- Confirm no new email event is created for that user.
- Turn Bill updates back on.
- Run notification generation.
- Confirm events can be created again for new bill update snapshots.

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
- Change notification preferences on web.
- Refresh Account on mobile.
- Confirm notification preferences reflect the same API-backed state.

## Expected Open Questions

- Confirm Supabase production redirect URLs include local web, production web, and native deep links.
- Confirm production Render backend has `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
- Confirm frontend deploy has `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_API_URL`.
- Confirm CORS allows the deployed frontend origin.
- Confirm production SMTP provider, verified sender, SPF/DKIM/DMARC, and bounce handling.
- Confirm `scripts/run_notifications.py --target production --lookback-hours 48 --send` is scheduled after legislative data refreshes.
- Confirm push notification delivery is not treated as a V1 blocker.
