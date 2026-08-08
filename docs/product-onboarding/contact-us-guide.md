<!-- describes: apps/frontend/src/screens/redesign/ContactUsScreen.tsx, apps/frontend/src/lib/contactUs.ts, apps/frontend/src/data/api.ts, apps/frontend/src/navigation/webRoutes.ts, alethical/api/routers/contact.py, alethical/api/services/contact.py, alethical/db/models.py, alethical/alembic/versions/0027_email_quota_warning_state.py -->

# How Contact us works

**Net.** The Contact us page gives anyone a direct way to reach Alethical without signing
in. A successful send delivers the message to `ask@alethical.com` and sends the writer a
copy.

## Ways in

- Choose **About**, then **Contact Us** in the shared top menu.
- Open `/about/contact` directly.
- Choose **Go back** to return to the prior Alethical page, or Home when there is no prior page.

## The form

The fields stay in this order:

1. Your name, optional.
2. Email address, required so Alethical can reply and send the copy.
3. Phone, optional.
4. Subject, required.
5. Message, required.

The page does not guess or prefill any field. Missing required fields are explained beside
the field after a send attempt. What the person typed stays in place if delivery fails.

## What happens after Send message

The browser sends the 5 fields to the Alethical API. The API checks the fields again,
limits repeated requests from 1 address, and asks Resend to accept both emails together.
The page says the message is on its way only after Resend accepts both copies.

If live email is off, the provider refuses the request, or either copy is not accepted, the
form remains filled and points to `ask@alethical.com` as the direct fallback. A retry uses
the same request identity so a lost response does not create a second pair of messages.

## Data handling

The form sends the name, email address, phone, subject, and message to Resend for delivery.
One copy goes to Alethical's Google Workspace inbox and 1 goes to the writer. The Alethical
app does not write a contact submission into its database or logs.

The sender address, live-delivery switch, provider key, optional recipient allowlist, and
request limit are server-only settings. Safe local settings send no email.

## Free-plan capacity warnings

After Resend accepts a contact message, the API reads the free plan's daily and monthly
usage totals. It emails `ask@alethical.com` once when either total reaches 80%, 90%, and
95%. Each warning re-arms after the usage falls below that point, including at the next
daily or monthly reset.

The warning record stores only the time period, warning point, and email count. It never
stores contact names, addresses, subjects, or message text. Resend omits the free daily
total on a paid plan, so these free-plan warnings stop automatically after an upgrade.
