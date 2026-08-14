<!-- describes: api/page.ts, apps/frontend/App.tsx, apps/frontend/src/components/auth/*.tsx, apps/frontend/src/data/api.ts, apps/frontend/src/lib/auth/*.ts, apps/frontend/src/lib/signIn.ts, apps/frontend/src/lib/trackIntent.ts, apps/frontend/src/providers/AuthProvider.tsx, apps/frontend/src/providers/AuthProvider.web.tsx, apps/frontend/src/providers/SignInModalProvider.tsx, apps/frontend/src/screens/auth/EmailLinkPage.tsx, alethical/api/routers/pending_actions.py, alethical/api/services/auth.py, alethical/api/services/pending_actions.py, alethical/db/models.py -->

# How sign-in works

Alethical offers Google and email plus password. The website holds a typed password only
long enough to send it directly to Supabase Auth through an encrypted connection. Alethical's
server and database never receive or store it.

## What a reader can do

- Continue with Google.
- Create an account with an email and a password.
- Confirm a new email address before the first password sign-in.
- Reset a forgotten password through an email link.
- Set or change a password while signed in.
- Sign out only from the browser or device they are using.

## Password policy and why

Email and password sign-in has no required second sign-in step. This is called single-factor
sign-in because the password is the only proof required. Two-factor authentication, or 2FA,
would require a second proof after the password, such as a code from an authenticator app.

Alethical bases this password policy on the July 2025
[NIST Digital Identity Guidelines](https://pages.nist.gov/800-63-4/sp800-63b.html#passwordver).
NIST is the U.S. Department of Commerce agency that develops technical standards used by
government and industry. Its guidance is not a law for Alethical, but it is the modern security
benchmark we use. It requires at least 15 characters when a password is the only sign-in factor
and permits an 8-character minimum only when another factor is required.

The policy is:

- Require at least 15 characters.
- Allow spaces, paste, password-manager autofill, and long passphrases made from several words.
- Do not require a capital letter, number, or symbol. These are called composition rules.
- Reject passwords found in known data leaks.
- Limit repeated sign-in attempts so an attacker cannot make unlimited guesses quickly.
- Do not force routine password changes. Change a password when the reader asks or when there is
  evidence that it may have been exposed.

Composition rules often produce predictable changes such as `Password1!`, while adding length
makes the attacker guess more. NIST therefore says not to force character types. It pairs length
with a refused-password list, limited attempts, and safe password storage instead.

### What leaked-password blocking means

A blocklist is a list of passwords the service refuses. [Supabase Password Security](https://supabase.com/docs/guides/auth/password-security)
checks new and changed passwords against [Have I Been Pwned](https://haveibeenpwned.com/Passwords),
a service built from passwords exposed in known data leaks. This catches known stolen passwords,
including many common choices. It is not a complete list of every predictable password or words
connected to Alethical.

The plain password is not sent to Have I Been Pwned. Supabase makes a temporary SHA-1 fingerprint
only for this lookup. SHA-1 is not used to store the password. Supabase sends only the first 5
characters of the fingerprint, receives many possible matches, and checks the full fingerprint on
its own side. This privacy method is called k-anonymity.

Alethical does not add a second custom list today. A check in Alethical's server would make more of
our code handle the plain password. The 15-character minimum, Have I Been Pwned check, and attempt
limit cover the main risk without widening that sensitive path. Reconsider this if Supabase adds a
safe built-in check for common or Alethical-related words, or if real evidence shows a gap.

### How salted bcrypt protects stored passwords

Password hashing is one-way scrambling for storage. It is not a second sign-in step, and a reader
does not have to do anything extra. Supabase uses a password-hashing method called bcrypt:

1. Supabase makes a new random value for the password. This is the salt.
2. Bcrypt mixes the password and salt and deliberately repeats slow work to produce a stored
   result called a hash.
3. Supabase stores the salt and hash, not the plain password.
4. At sign-in, Supabase repeats the check with the submitted password and accepts it only if the
   result matches.

The salt does not need to be secret. Its job is to make the same password produce a different
stored result for each account, which defeats ready-made lookup tables. Bcrypt's deliberate delay
makes every stolen-database guess cost more time. Hashing still cannot make a short or reused
password safe, or protect a reader who is tricked into revealing it. The other protections remain
necessary.

If Alethical ever takes over password storage from Supabase, use Argon2id with a unique random salt
instead. Argon2id makes every guess use both time and memory, which makes large guessing machines
more expensive to run. OWASP is a nonprofit foundation that publishes free software-security
guidance. Its [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
starts Argon2id at 19 MiB of working memory, about 20 MB, with 2 passes through that memory and 1
processing lane, meaning 1 thread of work. Do not move password storage into Alethical only to
replace Supabase's bcrypt. Owning that sensitive system would add more risk than the algorithm
change removes.

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
| Email provider | On | Email and password controls are live |
| Google provider | On | Continue with Google stays available |
| Confirm email | On | New email accounts must prove the address |
| Secure password change | Off | No fresh-proof code field is shipped |
| Require current password | Off | The signed-in password form needs only the new password |
| Leaked-password protection | On | Known stolen passwords are rejected with an inline message |
| CAPTCHA | Off | No human-check box is shown |
| Password-changed security email | On | Adding or changing a password sends a separate warning; the success screen does not claim delivery |
| Minimum length in Supabase | 15 | The browser and sign-in service enforce the same passphrase rule |
| Required character groups | None | Passphrases and spaces work |
| Confirmation/reset link lifetime | 3,600 seconds | Expired links use the shared dead-link page |
| Email code length | 8 digits | Alethical does not hardcode a code length |
| Authentication email limit | 30 per hour | The project limits confirmation and reset email volume |
| Sign-up and sign-in limit | 30 per 5 minutes per IP address | One internet address cannot make unlimited attempts |

The resend wait is a release setting (`EXPO_PUBLIC_AUTH_RESEND_WAIT_SECONDS`) and must match
Supabase Auth. The current design sample is not a source of truth.

## Live email sender

Production uses the Alethical Resend account through Supabase custom SMTP. On 13 August 2026, a
throwaway production account proved that confirmation, confirmation resend, password reset,
password sign-in, and sign-out all work. The account was deleted after the check.

The confirmation and reset emails put every private link value after `#`, so Vercel does not receive
those values in its request logs. The password-change warning uses “recently changed” because
Supabase's built-in security-email template does not provide the time of the change.

`EXPO_PUBLIC_EMAIL_PASSWORD_SIGN_IN_ENABLED=true` makes the email controls visible in production.
Google sign-in remains available beside them. Keep the code and example-file default `false` so a
new environment cannot show email sign-in before its sender passes the same checks.
