# Tracked page on a phone — verification shots for #1007

Frozen record. Two screenshots taken while verifying
[#1007](https://github.com/alethical-org/alethical/issues/1007), kept because the claim
they prove is not something a test can show: that a person on a phone can see and press
the Track control, and that pressing it removes the bill from the list.

Taken at a 375×812 phone viewport against a local API pointed at the seeded sample
database, with a signed-in session. Sign-in itself is not built yet
([#1006](https://github.com/alethical-org/alethical/issues/1006)), so the session was
planted directly in the browser's stored-session slot rather than obtained by signing in.

| File | What it shows |
| --- | --- |
| `tracked-page-375px.png` | All three saved bills, each with the Track control ("✓ Tracked", 44pt tall) in its own header row. Newest-saved first. HF 9901 leads and has no AI summary yet, so it renders with its number, title and status and **no summary line** — before this fix it was dropped from the response entirely. "Tracking 3 bills" matches the three rows. |
| `tracked-page-375px-after-untrack.png` | The same page after a real press on HF 9901's Track control: the bill is gone, the count reads "Tracking 2 bills", and the page did not navigate to the bill (the press is swallowed rather than following the card's link). The row was deleted from the database, confirmed separately. |

These are a dated record of one verification run, not a description of current behaviour,
so they carry no `describes:` comment and are not kept in step with the code. The behaviour
they check is pinned by
`test_tracked_bills_are_newest_first_and_keep_a_bill_with_no_summary`
(`alethical/tests/test_api_contract.py`).
