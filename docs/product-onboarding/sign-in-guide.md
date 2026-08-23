<!-- describes: api/page.ts, apps/frontend/App.tsx, apps/frontend/src/components/auth/*.tsx, apps/frontend/src/data/api.ts, apps/frontend/src/lib/auth/*.ts, apps/frontend/src/lib/signIn.ts, apps/frontend/src/lib/trackIntent.ts, apps/frontend/src/providers/AuthProvider.tsx, apps/frontend/src/providers/AuthProvider.web.tsx, apps/frontend/src/providers/SignInModalProvider.tsx, apps/frontend/src/screens/auth/EmailLinkPage.tsx, alethical/api/routers/pending_actions.py, alethical/api/services/auth.py, alethical/api/services/pending_actions.py, alethical/db/models.py -->

# How sign-in works

Alethical offers Google and email plus password. Google is optional. A person who does not
use Google can create, enter, and recover an account with email and password alone.

The browser sends passwords straight to Supabase Auth over an encrypted connection.
Alethical's own server and database never receive or store them.

## The 6 shared screens

- **Sign-in choices** opens every time with Google, Sign in with email, Create account, and Forgot
  password visible together.
- **Sign in with email** has email, password, Forgot password, Sign in, and Create account.
- **Create account** asks for an email, then opens the shared code screen.
- **Recover account** asks for an email and says that a missing account will be created.
- **Enter your code** has Code, Continue, Send a new code, Use another email, Google when safe,
  and help. It never says an email was sent or delivered.
- **Choose a password** has Password, Confirm password, an 8-character reminder, and Save
  password. Create, Recover, and signed-in password changes reuse this form.

Busy work, field errors, and short success notices stay inside these screens. They do not add
another screen.

## The 12 account journeys

1. **New email, Create account:** Create account → code → password → Alethical. The email is
   proved before the chosen password can be used.
2. **Existing password account, Create account:** Create account → code → password → Alethical.
   The proved owner replaces the password on the same account.
3. **Google-only account, Create account:** Create account → code → password → Alethical. The
   password becomes another way into the same account, and Google still works.
4. **Unfinished email account, Create account:** Create account → code → password → Alethical.
   Confirmation clears any password stored before email proof, then saves the person's choice.
5. **Password account, Sign in:** Sign in with email opens the email form. A correct email and
   password open the account. Every rejected pair says **Email or password is incorrect**, without
   revealing which part was wrong.
6. **Google or linked account, Continue with Google:** Google proves the person and opens the
   same Alethical account. Alethical never receives the Google password.
7. **Password account, Recover account:** Recover account → code → new password → Alethical.
   The password changes and other renewable sessions end.
8. **Google-only account, Recover account:** Recover account → code → password → Alethical.
   Password sign-in is added to the same account, and Google still works.
9. **Unknown email, Recover account:** Recover account → code → password → Alethical. A new
   account is created, as the Recover screen states before the request.
10. **Signed-in account, Add or change password:** the account menu opens the shared password
    form. Add links password sign-in to that account; Change replaces its password.
11. **The same account is open when a Create or Recover code is checked:** Create stops without
    changing the password. Recover finishes the password change. If the account opens after the
    password form appears, Save honors the password already typed. The same account stays visible.
12. **A different account opens in another tab during Create or Recover:** the proved account
    stays separate. The result offers **Keep current account** and **Switch account**. Nothing
    switches until the person presses Switch.

Journeys 11 and 12 cover another tab changing the open account while a code flow is underway.
Signed-in people use journey 10 rather than starting Create or Recover from the account menu.

## Account-panel layout and Back

The phone sheet and desktop window share a 66px fixed header. Its left side shows Alethical's mark,
a Track bell, or Back. The 44px left control is followed by at least 14px before the first heading,
icon, or label. That gap is owned by `accountPanelHeaderContentGap`. The first opening button starts
18px below the heading group. The header does not grow when the body scrolls or a phone keyboard
opens. Phone content ends with 26px plus the device's bottom safe area.

Back keeps the email and clears codes and passwords. Create and Recover remember whether they opened
from the 4 choices, the email form, or a direct link. Code and Choose password carry that same origin.
Choose password also cancels the proved-account state. A direct Create or Recover link has no header
Back, so its body route to sign-in stays. Android's hardware Back follows the same route before it
closes the panel.

Focus starts on each screen's heading. When that heading scrolls away, a hidden-from-screen-readers
copy appears in the fixed header. Screen changes fade out and back in with an 8px upward movement over
180ms. Reduced-motion settings make the change instant.

## One email-code flow for Create and Recover

Create and Recover both ask Supabase to send a short-lived, 1-use email code. The request may
create a missing account. A new or unfinished address uses Supabase's confirmation-email path;
a confirmed password or Google address uses its magic-link path. Both live templates show the
same code and subject, so every address gets the same visible task.

The confirmation email also keeps the safe confirmation link. This is permanent: an old Create
account page left open in a browser can request a new email and still finish through its link. The
magic-link email has only the code because confirmed accounts do not need that old Create route.

The code screen opens after Supabase accepts the request. It says **Enter the newest code**. It
does not say **sent**, **delivered**, **on the way**, or **check your email**. Alethical cannot see
an inbox.

- **Send a new code** repeats the same account-code request and clears the old typed code.
- A wrong, expired, old, or reused code stays on the code screen.
- A rate limit keeps every exit visible and shows the configured wait before another request can
  be tried.
- **Use another email**, Google when safe, Close, and ask@alethical.com remain available.
- When another account is open, Google is hidden until the person explicitly starts switching.
- A code is email proof, not a saved recovery code. Alethical ships no backup codes.

An accepted request means Supabase tried the correct email path. It does not prove that the
receiving company placed the message in the inbox. Resend can report accepted, delayed, failed,
suppressed, bounced, or accepted by the receiving mail server. Even the last result cannot prove
inbox placement, because the receiving company may filter or discard it.

Support can usually separate 3 cases while service records remain available:

- Supabase never received the request.
- Supabase tried the email and Resend rejected or delayed it.
- The receiving mail server accepted it, but inbox placement is unknowable.

Changing email companies cannot guarantee receipt. Resend remains the sender unless repeated
new-account tests and its event records prove a delivery problem.

## Password rules

- Accept any password with 8 or more characters.
- Require no capital, lowercase, number, symbol, or other character group.
- Allow spaces, paste, password managers, and longer passwords.
- Never check, block, or describe a password because it appears in a leaked-password list.
- Never force routine password changes.
- Keep repeated sign-in attempts limited.
- Keep ordinary sign-in free of a length check so an existing password is submitted as typed.
- Check an incomplete email after the person leaves the field or presses Sign in, not while typing.
- Keep a rejected password, select it, and focus its field so the next keystroke replaces it.

Supabase can still refuse a password beyond its storage limit. The form then says **This password
is too long. Use a shorter one.** Choosing the current password is accepted because that password
already works.

Supabase stores a salted bcrypt result, not the plain password. The random salt makes the same
password produce a different stored result for each account. Bcrypt deliberately slows guesses
against a stolen database.

## Why Google and password open 1 account

Supabase automatically joins methods that prove the same confirmed email. Alethical checks the
Supabase account before opening saved bills or settings. It never joins accounts by matching an
unproved typed email.

The account menu gets **Add a password**, **Change password**, or the neutral **Password** label
from Alethical's `/me` result. Supabase's public provider list can omit a password added to a
Google-first account, so the menu does not trust that list.

After a code is proved, every same-or-different decision compares the Alethical account ID returned
by `/me`, not the email text or sign-in provider ID. The ordinary saved account is read again before
the password save and before the final handoff. A second tab therefore cannot make the flow switch
the wrong account.

## Sessions after a password save

Supabase saves a changed password and revokes the account's other renewable sessions together.
Those sessions cannot get another access pass. An access pass already issued to another device
can still work until it expires, so Alethical never says every device is already signed out.

The email-code work uses a separate temporary sign-in:

- No ordinary account open: the proved temporary sign-in becomes the ordinary sign-in.
- Same account open: a password save replaces only the saved sign-in that existed immediately
  before that save. A newer same-account sign-in is preserved.
- Different account open: the ordinary account stays untouched until **Switch account**.
- **Keep current account** clears only the temporary sign-in. Close also clears the exact older
  same-account sign-in when the password reply may have revoked it. Newer and different sign-ins
  stay open.

Keep and Switch share 1 lock, so fast presses cannot run both. Close stays available during slow
work. Close stops later account steps and prevents a late reply from replacing a newer open
session. A 1-use Track save already accepted by the server may still finish.

## Lost password-save replies

A timeout or broken connection can hide whether Supabase saved the password. Alethical never
submits that password again, because the first save may already have worked.

The password fields and Save button disappear. The screen says: **We couldn’t confirm whether the
password was saved. Try it when you sign in. If it doesn’t work, recover your account.** It never
claims success, session cleanup, or security-email delivery.

A clear Supabase rejection stays on the password form and can be corrected. An uncertain reply
cannot be retried from that form.

## Old confirmation and reset links

Already-issued confirmation and password-reset links keep working during their short lifetime.
The web server removes their private value from the address bar before the app loads. The app does
not spend a 1-use link until the person presses its visible Continue button.

The password-reset email keeps its safe link so an old Recover account page left open in a browser
can still finish. New Recover account pages request the shared code instead.

A valid old confirmation link requires a ready password before sign-in finishes. A valid old reset
link opens the password form. An expired confirmation link offers **Go to Create account**; an
expired reset link offers **Go to Recover account**. Neither page requests another old-style link.

The link page also uses a separate temporary sign-in and preserves a different account already
open in the browser.

## Protection against an unproved planted password

Older sign-up behavior could store a password before its email was proved. A database guard clears
that stored password in the same write that first confirms the email
([0041_confirmation_password_guard.py](../../alethical/alembic/versions/0041_confirmation_password_guard.py)).
The proved owner then chooses the password. A person who leaves before choosing one has no usable
password, rather than inheriting an earlier unproved choice.

## Saving a Track press through sign-in

Before Google or an account-code request leaves the current step, the browser keeps a random
1-use reference. The server stores only its 1-way fingerprint, the action, the bill ID, a checked
Alethical return path, and an expiration time. It stores no account ID before sign-in.

After the Google return or proved email code, the server saves the bill and consumes the reference
in 1 database operation. Another tab or retry cannot save it twice. Outside return addresses,
expired references, and used references are rejected.

## Public errors and deactivated accounts

Alethical maps Supabase replies to fixed public messages. It never prints a provider's raw error.
A wrong email, wrong password, missing password, or locked account all say **Email or password is
incorrect**.

A deactivated account is signed out locally. Public bills, votes, and legislators remain readable.
Its message starts **You’ve been signed out** and makes ask@alethical.com a real email link. Header
Back returns to the 4 sign-in choices.

Closing or cancelling Google's window returns to the same opening with **Google didn’t finish. Try
again, or use email.** While email and password are held back, the unavailable email route is omitted
from that message. The pending Track request stays saved. A provider or network failure says
**Google isn’t responding. Try again in a moment.** A failure before Google starts or after Google
finishes uses the shared request-failure message instead of blaming Google.

## Account menu

The account menu shows the person's name and email, Tracked Bills, Add or Change password, and Sign
out. Tracked Bills shows a count only after the list has loaded. No number covers both zero tracked
bills and a list that has not arrived, so the menu never shows a false zero.

Sign out ends only the ordinary session on this browser or device.

## Live settings and email sender

[repo-and-service-settings.md § Supabase sign-in](../operations/repo-and-service-settings.md#supabase-sign-in)
is the only list of intended live values. It records the code-and-link confirmation email
([`email-confirmation.html`](../../supabase/templates/email-confirmation.html)), the code-only
magic-link email ([`account-code.html`](../../supabase/templates/account-code.html)), both subjects,
the 8-character minimum, no required character groups, leaked-password checking off, the code
lifetime and length, rate limits, allowed return addresses, Google, email, and the Resend sender.
The hosted check verifies every exposed value. The per-address sign-up and sign-in limit stays
explicitly unchecked because Supabase's read-only settings response does not expose it.

The visible resend wait comes from `EXPO_PUBLIC_AUTH_RESEND_WAIT_SECONDS` and must match Supabase.
The email and password controls remain hidden in a new environment until its sender and every
account-code path pass a live throwaway-account test.
