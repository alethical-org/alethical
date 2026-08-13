<!-- describes: api/page.ts, apps/frontend/App.tsx, apps/frontend/src/components/auth/*.tsx, apps/frontend/src/data/api.ts, apps/frontend/src/lib/auth/*.ts, apps/frontend/src/lib/signIn.ts, apps/frontend/src/lib/trackIntent.ts, apps/frontend/src/providers/AuthProvider.tsx, apps/frontend/src/providers/AuthProvider.web.tsx, apps/frontend/src/providers/SignInModalProvider.tsx, apps/frontend/src/screens/auth/EmailLinkPage.tsx, alethical/api/routers/pending_actions.py, alethical/api/services/auth.py, alethical/api/services/pending_actions.py, alethical/db/models.py -->

# How sign-in works

Alethical offers Google and email plus password. Supabase Auth checks both methods and
stores passwords. Alethical never receives or stores a password.

## What a reader can do

- Continue with Google.
- Create an account with an email and a password.
- Confirm a new email address before the first password sign-in.
- Reset a forgotten password through an email link.
- Set or change a password while signed in.
- Sign out only from the browser or device they are using.

Passwords must have at least 15 characters. Spaces are allowed, so a few words work well.
Alethical does not require a capital letter, number, or symbol.

## Why Google and password open 1 account

Supabase joins sign-in methods when both methods prove the same confirmed email address.
Alethical then checks the Supabase user against its own account before showing the person
as signed in. A Google-first reader can use **Set or change password** in the account menu.
The password becomes another door into the same account, not a second account.

The release checks prove that both doors show the same tracked bills, alerts, saved places,
and account settings. An unconfirmed email is never allowed to claim an existing account.

## Confirmation and reset links

The web server copies the Supabase token out of the address and removes it from the address
bar before the app or outside content loads. The app does not spend the 1-use token until the
reader presses **Confirm email** or **Continue to reset password**.

The link page uses a separate, short-lived Supabase connection. It never replaces the account
already open in the browser. If Jordan's reset link opens while Marissa is signed in, Jordan's
password changes and Marissa stays signed in.

After a password reset, Alethical signs the reset account out on other devices first. It then
closes the temporary reset session in this browser. A failed first step can be retried without
changing the password twice.

## Saving a Track press through sign-in

Before leaving for Google or sending a confirmation email, Alethical saves a random 1-use
reference on its server. That saved row contains only a bill id, a checked Alethical return
path, and an expiration time. It does not belong to an account yet.

After sign-in, the server saves the bill and consumes the reference in 1 database operation.
Two tabs cannot perform it twice. The raw reference is never stored in the database, outside
website addresses are rejected, and expired or used references cannot be replayed.

## Public error wording

Alethical turns Supabase errors into a small fixed set of messages. It never places a provider's
raw error on the page. A wrong email, wrong password, missing password, or locked account all use
the same sentence: **Email or password is incorrect.** This stops the form from revealing whether
an email address has an account.

A deactivated account is signed out locally. Public bills, votes, and legislators remain readable.

## Live Supabase settings

Read these values from the Alethical Supabase project before each authentication release. The code
must not guess them from a drawing.

| Setting | Checked 13 August 2026 | Product result |
| --- | --- | --- |
| Email provider | On | Supabase is ready, but Alethical keeps the controls hidden until launch |
| Google provider | On | Continue with Google stays available |
| Confirm email | On | New email accounts must prove the address |
| Secure password change | Off | No fresh-proof code field is shipped |
| Require current password | Off | The signed-in password form needs only the new password |
| Leaked-password protection | On | Known stolen passwords are rejected with an inline message |
| CAPTCHA | Off | No human-check box is shown |
| Password-changed security email | Off | The success screen does not claim an email was sent |
| Minimum length in Supabase | 15 | The browser and sign-in service enforce the same passphrase rule |
| Required character groups | None | Passphrases and spaces work |
| Confirmation/reset link lifetime | 3,600 seconds | Expired links use the shared dead-link page |
| Email code length | 8 digits | Alethical does not hardcode a code length |

The resend wait is a release setting (`EXPO_PUBLIC_AUTH_RESEND_WAIT_SECONDS`) and must match
Supabase Auth. The current design sample is not a source of truth.

## Launch requirement

Supabase's built-in sender allows only 2 authentication emails per hour and is not a production
sender. Email sign-in is ready to launch only after the existing Resend account is connected to
Supabase custom SMTP and a confirmation, resend, and reset email each arrive.
Until then, `EXPO_PUBLIC_EMAIL_PASSWORD_SIGN_IN_ENABLED` stays `false`, which keeps the new email
controls hidden while Google sign-in continues to work.
