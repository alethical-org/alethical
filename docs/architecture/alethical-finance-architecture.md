# Alethical Finance — architecture and access decisions

<!-- describes: alethical/api/routers/finance_identities.py, alethical/api/services/identity_confirmations.py, alethical/api/services/finance_identity_directory.py, alethical/api/services/finance_station_checks.py -->

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
| Checks and confirmations: committee matches, station-file facts and connections, identity confirmations | `legislator_campaign_committee`, `identity_confirmation`; station files: `tv_ad_fact` and `tv_ad_connection` on alethical.com's public copies, `finance_tv_fact` and `finance_tv_connection` on originals, checked in Finance |
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
`folders/{key}`, `agencies/{key}` and `stations/{key}`, and records checks on an original
version at `files/{key}/versions/{content hash}/` (`target-preview`, `facts`,
`connections`) and withdraws them at `facts/{id}/withdraw` and `connections/{id}/withdraw`
([tv-ad-records-guide.md](../product-onboarding/tv-ad-records-guide.md), In Alethical
Finance). Identity confirmations (§4) answer under `/identities/`
(`alethical/api/routers/finance_identities.py`). The access check reads the list through its own short
database session, so the money search still reads its whole answer from 1 instant of the
database.

## 2. Built separately

- **Finance's screens.** Finance has its own look and shows more than alethical.com
  (original station files, unconfirmed printed names, evidence panels), so a page that
  exists on both sites is drawn, built and tested twice. Nothing else is.
- **Finance's front end is its own React web app** (`apps/finance`), not a themed mode of
  the alethical.com app. A shared mode would tie every release of 1 site to the other and
  hold Finance to the public app's phone-first framework (React Native for web).
- **The code that decides wording and figures is shared.** The workspace package
  `@alethical/shared` (`packages/shared`) is the single import point for alethical.com's
  display and wording modules, so a wording or display rule changes in 1 place. Finance
  imports them only from it, 1 subpath per module (`@alethical/shared/moneyFormat`). The
  files stay where they are, under `apps/frontend/src/lib`, `apps/frontend/src/hooks` and
  `apps/frontend/src/data`, and the package re-exports them; alethical.com keeps importing
  them directly and switches to the package file by file as each file moves into it.
- **The package offers a module only when Finance's own build can use it.** Nothing it
  imports, directly or through its own imports, may reach React Native, Expo, React
  Navigation or alethical.com's navigation, providers, screens or components; read Expo's
  build-time `process.env` or `__DEV__`; or have a platform-specific twin such as
  `supabase.web.ts`. `packages/shared/test/importGraph.test.mjs` fails otherwise, and the
  package type-checks under Finance's compiler settings. The API client
  (`apps/frontend/src/data/api.ts`) imports React Native, so the package offers only its
  response types (`@alethical/shared/data/types`).
- **1 guide per data feature**, with a short section for each site's differences, rather
  than a second guide per site ([workflow.md](../../.claude/rules/workflow.md) rule 6).

Finance's legislative reads (`alethical/api/services/finance_records.py`) list the sitting
Legislature's committees and each committee's members and roles. Member districts come
from service in that committee's session and chamber; ambiguous districts stay unknown.
`roster_copied_at` dates the latest complete successful roster copy for that session,
not a later page request or a partial collection. Bill authors use the bill page's own
formatter and keep the chamber whose file named each author. Bills use their plain-language
title, or their number when none is held, and carry their status. Each legislator carries
`link_state` and reviewed accounts, including the office each account registered for.
Money remains per account and year; it is never added across members.

### Money reads and exact printed names

`alethical/api/services/finance_money_reads.py` supplies read-only routes under Finance's
existing access boundary. All reads preserve missing amounts and source dates under
[grounded-answers.md rule 12](../../.claude/rules/grounded-answers.md). Source files no longer
held produce an unavailable state, never a zero. A requested release that changed returns
409 so a caller reloads rather than joining pages from different copies.

- `/candidates/{id}/campaign-finance` and `/campaign-finance/years` reuse the account/year
  readers after checking a reviewed candidacy-to-person link, a confirmed account covering
  the election year, and the Board's held office and district against that candidacy.
  Only that account set can appear in its historical years, each still subject to the
  existing reviewed or filed year coverage. Missing seat or identity evidence means
  unconfirmed; names alone never create a link.
- `/committees/{number}/report-figures?year=Y` lists the held catalogue's filed report names
  and effective amendments. A catalogue entry without an amendment marker is not proof
  of filing. The latest held cumulative figures attach only to a unique regular report
  whose period end matches; older or ambiguous reports keep null figures. Total receipts
  require the official calendar's period start; an ending balance is dated as of the
  report's end. Filing dates never come from period ends. Retained figures keep their
  own copy date.
- `/committees/{number}/payment-groups` pages exact named groups for one filing year and
  direction, with whole-filter group and payment counts. Contribution categories stay
  separate; outgoing transfers retain the receiving committee's filed number. Unnamed
  records stay individual. A sum is withheld if any amount is missing; every shown sum
  has a complete date span or the held filing-year span, never a substituted transaction
  year. Each group includes its first 50 rows; `/group-payments` reads the remaining rows
  by its opaque key and release pin. Matching filer links use the existing own-money
  availability check. Statement evidence stays attached to the contribution rows.
- `/employers?q=...` searches exact printed employer spellings with at least 3 characters,
  with donor-name and record counts, plus current organization-confirmed record coverage.
  `/employers/donors?name=...` pages donors under one exact employer spelling; unnamed
  records stay individual. `/employers/donor-payments` pages each group's source rows.
  Loans remain loans, missing amounts remain null, and nothing is summed as employer money.
- The existing payments-under-name readers return a whole-filter `total_payments` for
  contributor, vendor, independent vendor and employer roles, including past-last pages.
  Their source files and meanings stay separate; the count does not turn a printed name
  into an identity or its rows into a money total.

Identity record pages also carry source address/copy date and display-only filer name,
number, link availability and printed transaction types. These fields never change a
fingerprint. Conflicting names or types on repeated fingerprints remain distinguishable;
no unresolved filer number becomes a link.

## 3. Access

- **1 access level.** Every account on Finance's access list has the same access. Finance
  has no administrator role, label, tag or state.
- **Access by list only.** Alethical adds and removes each email. Nobody can sign up, and
  there are no guest or self-service accounts.
- **The list lives in the database, never in the repository**, which is public: a client's
  email would name the client.
- **Each entry records whether the account belongs to Alethical's own team.** Finance never
  shows or uses this; it decides only what alethical.com may print (§5).
- **Sign-in is Google, or a code emailed to the address.** Finance has no passwords.
  Alethical sends its own 8-digit codes, only to listed addresses, and answers every
  address alike, so sign-in never shows whether an address is a client; the Supabase
  account is created or found only after a code is proved
  ([sign-in-guide.md § Alethical Finance sign-in](../product-onboarding/sign-in-guide.md#alethical-finance-sign-in)).
  An account that signs in but is not on the list sees the no-access state. Google returns
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

### Identity confirmations

A confirmed person or organization (`identity_entity`) ties records together only through
confirmations (`identity_confirmation`) that name their evidence: a saved source row or an
official page, words quoted from it and the reviewer's basis. The evidence must print the
exact name or number confirmed, and the quotation (at least 3 characters) must stand inside
1 printed value; equal names or numbers are never enough on their own. The routes sit under
`/api/v1/finance/identities` (`alethical/api/services/identity_confirmations.py`).

- **A printed name is confirmed record by record.** A donor, employer, payee or
  independent-expenditure payee name covers only the records a person selects. Each record
  is kept (`identity_confirmed_record`) as a fingerprint: the sha256 of its record kind, its
  file and the printed fields below, which are stored beside it. The expenditure files print
  no employer, so their records have 5 fields.

  | Record kind | File | Printed fields fingerprinted |
  |---|---|---|
  | Donor name, employer name | Contributions | contributor, employer, recipient registration number, receipt date, amount, ZIP code |
  | Payee name | Expenditures | payee, paying committee's registration number, date, amount, ZIP code |
  | Independent-expenditure payee name | Independent expenditures | payee, spender's registration number, date, amount, ZIP code |

  Every read matches the fingerprints against the Board's current file, never by copy or row
  number, so each refresh re-matches them. Identical repeated rows print the same facts and
  share 1 claim. A fingerprint that matches no current row stays and shows as no longer in
  the Board's file. A record added later is never covered until someone confirms it. The
  database lets each fingerprint belong to only 1 active confirmation. `GET /records` lists
  the current records printing a name in stable pages of whole fingerprints, each with
  the confirmation and identity standing for it. Pages include the full matching row
  and fingerprint counts; identical repeated rows stay together. The listing accepts
  `page`, `page_size` (100 by default, at most 500), `year` and a `snapshot_id` pin;
  a changed source copy refuses a pinned page and asks the reader to reload. Selections
  across pages send their fingerprints. The "All records" and "{year} records" choices
  send `record_selection` with the displayed `snapshot_id` and optional `year`; the
  server selects every matching unconfirmed fingerprint, including names over 5,000
  records, and refuses a changed source copy. Only the resulting fingerprints are
  stored; a record added later is never covered. Explicit selections have a 16 MiB
  request limit, with a refusal naming Alethical's limit and the quick-selection route.
  An identity's `printed_names` gives "Confirmed for {k} of {n} records" for each name.
- **The confirmation queue groups exact spellings, never inferred identities.**
  `GET /queue` accepts `record_type` (`all`, `donor`, `payee`), `status`
  (`unconfirmed`, `confirmed`, `all`), `q`, `page` and `page_size` (50 by default,
  at most 100). Contributions, expenditures and independent expenditures stay
  separate, even when they print the same name. Each row gives current record and
  confirmation counts, actual years and dates, missing-amount count, source copy,
  source URL and copy date. Any missing amount withholds the figure, following
  `campaign_finance_reader.Bucket.rows_missing_an_amount` and
  [grounded-answers.md](../../.claude/rules/grounded-answers.md) rule 12; complete
  figures sort highest first and withheld figures follow them. `period_basis` is
  `dates` when every record has a date, otherwise `years` when every record has its
  held filing year, otherwise null and the amount is withheld. Filing year and
  payment-date year can disagree, so a missing filing year is never derived from
  a date. `amount_state` distinguishes `reported`, `incomplete_amount` and
  `incomplete_period`; `undated_records` counts records lacking both year and date.
  A partly confirmed
  name remains in the unconfirmed queue. `GET /identities` finds saved active
  identities by `q` and optional `kind`, with the same paging bounds; it returns
  only id, kind and name, without a suggested match or any account details.
- **An identifier is confirmed whole, for all time.** A committee's or lobbyist's
  registration number, a principal's id, or the id of a held legislator or public person
  is itself an identifier; at most 1 active confirmation holds each, and `GET /lookup`
  answers for identifiers only. A held legislator or public person, named by its id exactly
  as held, needs an https page on Minnesota's own sites (`mn.gov` and its offices,
  `senate.mn`, `state.mn.us`) whose address is printable ASCII with no backslash.
- **Decisions are append-only.** A confirmation is never edited; its 1-time withdrawal
  records a date and reason and takes its claim off every record at once. A merge moves
  nothing: the merged identity keeps its id and its confirmations, and every lookup follows
  the redirect to the identity standing today. A split gives every active confirmation
  standing for the identity, including those of identities merged into it, to exactly 1
  part, each part at least 1; each is withdrawn and replaced on its part with the same
  evidence, check date and records and a pointer to the one it replaces. Withdrawn
  confirmations stay behind as history. A replacement counts as team-made only when the
  original and the split both were (§5).
- **Every account sees everything.** Every change is kept in `identity_event`, and every
  identity, confirmation and event records whether a team account made it, which Finance
  never shows; no answer names who made a change. Every Finance account reads every
  confirmation, so the names, relations, bases and reasons typed into them must never hold
  anything confidential; the API's field descriptions say so.

## 5. What alethical.com prints from work done in Finance

- A check or confirmation made in Finance appears on alethical.com only when an account of
  Alethical's own team made it. alethical.com stands behind every confirmation it prints.
- Any Finance account can withdraw any confirmation, and merge or split any identity, and
  every Finance account sees the result. alethical.com changes only on decisions a team
  account made: when it reads identities, it follows only merges and splits a team account
  made, so another account's merge never redirects a team-made confirmation there, and it
  keeps printing a team-made confirmation until a team account withdraws it. Every
  withdrawal, merge and split records in `identity_event` whether a team account made it.
- A Finance check on a station file also passes alethical.com's own rules for everything
  it serves before alethical.com prints it: the exact version has an approved,
  privacy-checked public copy, and the check's quotation appears exactly in that copy's
  safe text. The same 2 conditions hold wherever the check would reach a reader: facts,
  correction history, search, connections and page images. A Finance check rests on the
  original's own text, which carries personal details the public copy blanks, so passing
  in Finance never qualifies it alone.
- alethical.com prints no Finance station-file check: its station-file readers read only
  checks on its own public copies (`tv_ad_fact`, `tv_ad_connection`), and a Finance check
  never changes them.
- Every Finance account can withdraw any station-file fact, date or connection,
  including a public-copy check or folder connection. The withdrawal needs a reason
  and is recorded once. A public-copy check is withdrawn **only inside Finance**:
  an immutable `finance_tv_copy_withdrawal` row records the decision, while the
  public check and every public-site answer remain unchanged. Finance's file views,
  correction history, lists, connections and counts honor the withdrawal.
- Inside Finance every account sees every check. No check names the account that made it
  or says whether a team account did; a Finance check keeps no account identity, only
  that flag (`made_by_alethical_team`), which no Finance answer serves.

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
