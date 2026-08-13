# Sign-in build notes

The current sign-in behavior is described in
[`sign-in-guide.md`](../../product-onboarding/sign-in-guide.md).

The shared pieces live in:

- `apps/frontend/src/components/auth/SignInDialog.tsx`: sign in, create, confirmation-email,
  forgot-password, and sent-email views.
- `apps/frontend/src/components/auth/AccountControl.tsx`: signed-in account menu, phone sheet,
  sign-out, and set-or-change-password flow.
- `apps/frontend/src/screens/auth/EmailLinkPage.tsx`: confirmation and reset links using a separate
  short-lived sign-in connection.
- `apps/frontend/src/providers/SignInModalProvider.tsx`: the one app-wide dialog and saved Track
  action handoff.
- `alethical/api/services/pending_actions.py`: the 1-use server record that saves a signed-out
  Track press after sign-in.

The old `sign-in.dc.html` and `shipped/` screenshots are visual history from the Google-only build.
They are not the current handoff.
