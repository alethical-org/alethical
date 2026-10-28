# Alethical Finance — architecture and access decisions

**Net:** Alethical Finance is a sign-in-only research product for law firms and their
political committees. It runs on the same records, database, server and product rules as
alethical.com; only its screens are separate. Every account Alethical lets in has the same
access, nothing in Finance links back to alethical.com, and every research tool lives in
Finance.

Finance's address is alethicalfinance.com, connected at launch. Until then it runs at
finance.alethical.com, which serves only the public landing page and sign-in until the
signed-in screens are approved.

## 1. Built once, used by both sites

| Layer | Where it lives |
|---|---|
| Collection of every source (Campaign Finance Board, lobbying, Legislature, Secretary of State, FCC station files) | `alethical/pipeline/`, the scheduled jobs in [jobs-and-scripts.md](../operations/jobs-and-scripts.md) |
| 1 database | `alethical/db/models.py`; [db-schema-system-design.md](db-schema-system-design.md) |
| Checks and confirmations: committee matches, station-file facts and connections, identity links | `legislator_campaign_committee`, `tv_ad_fact`, `tv_ad_connection` |
| Calculations: totals, reconciliations, record counts | `alethical/api/services/` |
| Product rules: cite or refuse, no money chains, missing never zero | [`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) |
| Sign-in | Supabase Auth ([backend-stack.md](backend-stack.md) §4) |
| Server endpoints | 1 set. Finance-only data is served only to accounts on Finance's access list; there is no Finance copy of a public endpoint. |

Finance is for finding connections between money, people and policy. Ask (cited answers
about bills), tracking with update emails, and Alethical's research and guides are not part
of Finance.

Finance's own routes sit under `/api/v1/finance/`. Every route except the public landing
counts (§9) needs the access check, and its answers are
private and never cached. Behind the access check (`alethical/api/routers/finance.py`):
`GET /access`, and `GET /suggestions?q=&request_id=`, which answers 1 typed query with
alethical.com's own money search (`/campaign-finance/search`) and, from 3 characters, its
bill search (`/search`) in 1 request, and returns `request_id` unchanged, so the app drops a
reply that arrives after a newer one. Media buys (§6) answers under `/media-buys/`
(`alethical/api/routers/finance_media_buys.py`): `counts`, `sources`, `recent`, `browse`,
`connections`, `files/{key}` with its original page images at `files/{key}/pages/{page}`,
`folders/{key}`, `agencies/{key}` and `stations/{key}`
([tv-ad-records-guide.md](../product-onboarding/tv-ad-records-guide.md), In Alethical
Finance). The access check reads the list through its own short
database session, so the money search still reads its whole answer from 1 instant of the
database.

## 2. Built separately

- **Finance's screens.** Finance has its own look and shows more than alethical.com
  (original station files, unconfirmed printed names, evidence panels), so a page that
  exists on both sites is drawn, built and tested twice. Nothing else is.
- **Finance's front end is its own React web app** (`apps/finance`), not a themed mode of
  the alethical.com app. A shared mode would tie every release of 1 site to the other and
  hold Finance to the public app's phone-first framework (React Native for web).
- **The code that decides wording and figures is shared.** The display modules under
  `apps/frontend/src/lib`, `apps/frontend/src/hooks` and the API client move into a
  package both front ends import, so a wording or display rule changes in 1 place. 10 of
  those 415 files import React Native; the rest move unchanged.
- **1 guide per data feature**, with a short section for each site's differences, rather
  than a second guide per site ([workflow.md](../../.claude/rules/workflow.md) rule 6).

Finance's reads about legislators are records, never money
(`alethical/api/services/finance_records.py`). `GET /api/v1/finance/legislative-committees`
lists the sitting Legislature's committees; `/legislative-committees/{id}/members` lists a
committee's members with their roles; `/bills/{bill_id}/authors` lists a bill's authors with
the bill page's own formatter, each row marked with the chamber whose file named it, so a
companion bill's authors stay distinguishable. It names the bill as the bill page does:
by its plain-language title, or by its number when it has none, never by its legal title;
its status is served beside them. The read takes the same few database trips however many
authors a bill has. Each legislator carries `link_state` (confirmed, reviewed with none confirmed, or
unconfirmed) and the committees confirmed as theirs, each with the office it registered for
and whether that is a Legislature seat. Each account's figures for a year come from
`/legislators/{legislator_id}/campaign-finance`, 1 member at a time, which leaves out a race
for another office; no figure is combined across members, and reading 27 members' figures
in 1 request took 15 seconds. Donors by employer, exactly as printed, is alethical.com's own
`/campaign-finance/payments-under-name?role=employer`, which never adds across donors.

## 3. Access

- **1 access level.** Every account on Finance's access list has the same access. Finance
  has no administrator role, label, tag or state.
- **Access by list only.** Alethical adds and removes each email. Nobody can sign up, and
  there are no guest or self-service accounts.
- **The list lives in the database, never in the repository**, which is public: a client's
  email would name the client.
- **Each entry records whether the account belongs to Alethical's own team.** Finance never
  shows or uses this; it decides only what alethical.com may print (§5).
- **Sign-in is Google, or a code emailed to the address.** Finance has no passwords. The code
  length is the shared sign-in service's setting, 8 digits for both sites
  ([repo-and-service-settings.md](../operations/repo-and-service-settings.md), Supabase
  sign-in); Finance accepts whatever length arrives.
  An account that signs in but is not on the list sees the no-access state. Sign-in returns
  to the page's own address, so Supabase's list of allowed return addresses needs
  finance.alethical.com now and alethicalfinance.com at launch.
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

[Minnesota Statutes 10A.35](https://www.revisor.mn.gov/statutes/cite/10A.35): information
copied from reports and statements filed with the Campaign Finance Board, other than those
filed by lobbyists and lobbyist principals, "may not be sold or used by an individual or
association for a commercial purpose", and "purposes related to elections, political
activities, or law enforcement are not commercial purposes."

The Board's advisory opinions read "use" as using names and addresses to contact the people
in the data: [AO418](https://cfb.mn.gov/pdf/advisory_opinions/AO418.pdf) permits a
for-profit to filter, improve or implement Board data for a fee and recommends telling end
users about the prohibition, and [AO244](https://cfb.mn.gov/pdf/advisory_opinions/AO244.pdf)
permitted a free, advertising-supported information site that carried a notice of it. An advisory opinion binds the Board only for
the person who requested it ([10A.02](https://www.revisor.mn.gov/statutes/cite/10A.02)
subdivisions 12 and 12a), so these opinions show the Board's reading and do not protect
Alethical directly. Alethical does not request an opinion of its own.

No Finance feature uses Board names or addresses to contact the people in them.

## 9. Landing-page counts

Every count on Finance's public landing page is read live from the current release and is
hidden, never shown as 0, when it cannot be read. Counts are of records, never money; each
names its period and source ([grounded-answers.md](../../.claude/rules/grounded-answers.md)
rule 12).

`GET /api/v1/finance/landing/counts` (`alethical/api/services/finance_landing.py`) serves
the 4 counts without sign-in, the same answer for everyone, cached for the short public
window like any anonymous `/api/v1` read; it is the only `/api/v1/finance/` address that is
not private (`PUBLIC_EXCEPTIONS` in `alethical/api/problems.py`). Any site's browser may read
it (`Access-Control-Allow-Origin: *`, no credentials), so the landing page shows its counts
at every address it is served from, and no cached copy depends on whether that address was
in the API's `ALETHICAL_CORS_ORIGINS` when the copy was made. The counts: campaign
money records (the 3 Campaign Finance Board payment files of the published release, copy
date the oldest of the 3), lobbying spending reports with the number of organizations that
filed them, every bill held for the current Legislature (whether or not its plain-language
summary exists yet, with the copy date every held bill supports, as on alethical.com), and
TV station files held, with the oldest of each station's newest copy (no date while a
station has no file held). Each answers `reported` with its count, years, source and copy
date, or `unavailable` with a reason and no count: `nothing_published`, `empty` or
`unreadable` for any count, and `rows_replaced` for campaign money only (lobbying answers
`nothing_published` when its published rows no longer match, because `published_pair`
does not say which). 1 unreadable source never hides another.
