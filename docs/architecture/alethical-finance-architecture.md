# Alethical Finance — architecture and access decisions

**Net:** Alethical Finance is a sign-in-only research product for law firms and their
political committees. It runs on the same records, database, server and product rules as
alethical.com; only its screens are separate. Every account Alethical lets in has the same
access, nothing in Finance links back to alethical.com, and every research tool lives in
Finance.

Alethical Finance is not alethicalfinance.com, an unrelated earlier site.

## 1. Built once, used by both sites

| Layer | Where it lives |
|---|---|
| Collection of every source (Campaign Finance Board, lobbying, Legislature, Secretary of State, FCC station files) | `alethical/pipeline/`, the scheduled jobs in [jobs-and-scripts.md](../operations/jobs-and-scripts.md) |
| 1 database | `alethical/db/models.py`; [db-schema-system-design.md](db-schema-system-design.md) |
| Checks and confirmations: committee matches, station-file facts and connections, identity links | `legislator_campaign_committee`, `tv_ad_fact`, `tv_ad_connection` |
| Calculations: totals, reconciliations, record counts | `alethical/api/services/` |
| Product rules: cite or refuse, no money chains, missing never zero | [`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) |
| Cited answers about bills (Ask) | `alethical/api/routers/ask.py` |
| Tracking and update emails | `tracked_bill`, [tracked-bill-notifications-spec.md](../product-onboarding/tracked-bill-notifications-spec.md) |
| Sign-in | Supabase Auth ([backend-stack.md](backend-stack.md) §4) |
| Server endpoints | 1 set. Finance-only data is served only to accounts on Finance's access list; there is no Finance copy of a public endpoint. |

## 2. Built separately

- **Finance's screens.** Finance has its own look and shows more than alethical.com
  (original station files, unconfirmed printed names, evidence panels), so a page that
  exists on both sites is drawn, built and tested twice. Nothing else is.
- **Finance's front end is its own React web app**, not a themed mode of the alethical.com
  app. A shared mode would tie every release of 1 site to the other and hold Finance to the
  public app's phone-first framework (React Native for web).
- **The code that decides wording and figures is shared.** The display modules under
  `apps/frontend/src/lib`, `apps/frontend/src/hooks` and the API client move into a
  package both front ends import, so a wording or display rule changes in 1 place. 10 of
  those 415 files import React Native; the rest move unchanged.
- **1 guide per data feature**, with a short section for each site's differences, rather
  than a second guide per site ([workflow.md](../../.claude/rules/workflow.md) rule 6).

## 3. Access

- **1 access level.** Every account on Finance's access list has the same access. Finance
  has no administrator role, label, tag or state.
- **Access by list only.** Alethical adds and removes each email. Nobody can sign up, and
  there are no guest or self-service accounts.
- **The list lives in the database, never in the repository**, which is public: a client's
  email would name the client.
- **Each entry records whether the account belongs to Alethical's own team.** Finance never
  shows or uses this; it decides only what alethical.com may print (§5).
- **Sign-in is Google, or a 6-digit code emailed to the address.** Finance has no passwords.
  An account that signs in but is not on the list sees the no-access state.
- **The server checks the list on every Finance request.** A request carrying an
  Authorization header is never marked cacheable (`default_public_cache` in
  `alethical/api/main.py`), so 1 account's response never reaches another.

## 4. Every tool has 1 home: Finance

- Checking station files (facts and connections) and confirming identities happen in
  Finance, open to every account.
- alethical.com's administrator station-file pages and review screen
  ([tv-ad-records-guide.md](../product-onboarding/tv-ad-records-guide.md)) retire once
  Finance's media buys ship. alethical.com's administrator area keeps running that site:
  users, metrics, operations.
- Anyone who uses those alethical.com pages receives a Finance access entry before they
  retire.
- The public-copy steps (a copy with personal details blanked, publication approval) belong
  to alethical.com's public site; Finance has no public pages and does not use them.

## 5. What alethical.com prints from work done in Finance

- A check or confirmation made in Finance appears on alethical.com only when an account of
  Alethical's own team made it. alethical.com stands behind every confirmation it prints.
- Inside Finance every account sees every check. No check names the account that made it.

## 6. Media buys

- Finance names the station-file collection **Media buys**, the umbrella for TV, radio,
  cable, streaming, print and online ad purchases. The records held are **TV station files**
  from KSTP-TV, KARE and KMSP-TV ([fcc-political-files.md](../implementation/fcc-political-files.md)),
  and a page says so wherever a count or a scope line could otherwise read as purchases or
  as wider coverage.
- Every Finance account sees original station files and their machine-read text, marked Not
  checked. Original files carry campaign staff and agency contact details as the stations
  filed them.
- Station-file amounts (ordered, billed, credited, paid) stay on the file. They never enter
  money totals, recipient sums or profile money figures, and a Money connections line to a
  station file carries no amount, because an order or invoice does not prove payment.

## 7. Finance never links to alethical.com

Every record and tool opens inside Finance. Contact actions use email addresses.

## 8. Minnesota's commercial-use rule

[Minnesota Statutes 10A.35](https://www.revisor.mn.gov/statutes/cite/10A.35) prohibits
commercial use of the Campaign Finance Board's data. The Board's advisory opinions read
"use" as using names and addresses to contact the people in the data:
[AO418](https://cfb.mn.gov/pdf/advisory_opinions/AO418.pdf) permits a for-profit to filter,
improve or implement Board data for a fee, and
[AO244](https://cfb.mn.gov/pdf/advisory_opinions/AO244.pdf) permitted a paid information
site that carried a notice of the prohibition. Lobbyist and principal reports are exempt.
No Finance feature uses Board names or addresses to contact the people in them.

## 9. Landing-page counts

Every count on Finance's public landing page is read live from the current release and is
hidden, never shown as 0, when it cannot be read. Counts are of records, never money; each
names its period and source ([grounded-answers.md](../../.claude/rules/grounded-answers.md)
rule 12).
