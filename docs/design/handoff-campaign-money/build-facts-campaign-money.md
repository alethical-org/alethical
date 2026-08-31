# Build facts — Legislator Profile campaign money (from Claude Code, Aug 11 2026)

Recorded because these are measurements from the real Campaign Finance Board data, not design
assumptions. Every one of them overrides whatever our mocks previously drew. Cite these, not our old
figures, in any future spec. Last updated Aug 18 2026 with data census #1661 (final section — the
census is the single source for entity and payment-kind facts).

## Matching a legislator to a committee

- **All 200 sitting members appear in the Board's registered-filer directory.** Presence there is the
  test and it is decisive. Therefore **"no committee is registered for this person" is not a state a
  legislator profile can ever reach** — not rare, not empty at launch, never. It stays valid only on a
  standalone money page for someone we hold no legislator record for (a challenger, a former member).
- **Confirmed matches today: 0.** 144 matched and 56 ambiguous are *proposals* — a question the machine
  asks — and nobody has answered any of them. So the unconfirmed state is what all 200 profiles show,
  draining one at a time. It is the tab's primary frame, not a gap state. (The old "111 of 200
  automatically matched" figure is dead; do not cite it.)
- **Every remaining ambiguous case is a member with two or more committees of their own.** The machine
  now reads the Board's registered-candidate list, which carries each member's district, so it settles
  the who-is-this-person cases itself.
- What the data genuinely cannot tell apart: **a member nobody has looked at yet from a member checked
  and found to have none** — which is why rejections are stored rather than discarded.
- A member whose every proposal a reviewer rejects is **our defect**, not a design state: their
  committee exists and we failed to surface it. It wants a person's attention, never a card.

## Reported totals

- **The Board runs a per-filer totals service, it is verified, and it already resolves which amended
  version is effective.** So the two-number card (official total + named payments) is the ORDINARY
  case. (This reverses the earlier "totals cannot be fetched, the no-total card ships first".)
- **Never compute the total by summing rows.** The unnamed money is exactly the money with no rows.

## The unnamed share is large and it is the normal case

| year | committee-years | named payments | official total | unnamed share |
|---|---|---|---|---|
| 2024 | 200 | $4,112,295.10 | $6,474,414.12 | **36.5%** |
| 2025 | 207 | $6,320,211.90 | $10,764,744.54 | **41.3%** |

Medians: **40.3%** (2024) and **36.1%** (2025) — so this is the ordinary committee, not a few large ones
dragging an average. **Roughly four dollars in ten on a typical profile have no name attached; draw the
bar there.** Extreme, and real: Sen. John Marty's committee reported $13,900.48 for 2025 against a
single named payment of $1,000 — **93% unnamed** — and the page must still read as a record rather than
a failure.

## A negative unnamed figure = failed reconciliation, not a zero

A candidate who runs in a special election files a whole second report series, and the totals service
returns only the regular one; our named payments cover both. Subtracting goes **negative on 10 of 407
measured committee-years** — about **1 in 40**, per member and per year. Those filer-years show **named
payments only**, labelled as named payments, with no total and no composition bar.

## The period: the end is served, the start is DERIVED — and nothing hardcodes 1 January

- **The START is served by nothing.** The report catalogue returns 17 fields per report and none of
  them is a start: `RegisteredEntityID · RegisteredEntityType · ReportType · FilingYear ·
  as_2DigitYear · ReportName · PrePrimaryReport · PreGeneralReport · YearEndReport ·
  SpecialElectionindicator · SpecialElectionDistrict · TerminationDate · TerminationYear · District ·
  NoticePeriod · CutOffDate · amendments`. `NoticePeriod` is a flag reading "1", not a date.
- **But it is DERIVABLE from served values, in both populations** — which is what the "never hardcode
  1 January" instruction was actually protecting against:
  - **Ordinary filer (no special-election report that year): 1 January**, by Minnesota Statutes 10A.20
    subd. 4. A derivation from law, not an assumption. Confirmed on Sen. John Marty's committee —
    2023, 2024 and 2025 year-ends cut off 31 December, the 2026 pre-primary cuts off 20 July.
  - **Special-election filer: the day after the last special-election report's cutoff.** The same
    catalogue carries `SpecialElectionindicator`, so the two populations separate at read time with no
    extra work. Ann Johnson Stewart's 2024: special series ends 25 Nov, the regular year-end therefore
    starts 26 Nov — both dates out of one response.
  - **Confirmed on one case each, not across the population.** Verify before the build relies on it.
- **So "Jan 1 – Jul 20, 2026" is the ORDINARY panel**, and the **end-only panel is the FALLBACK** for a
  filing where the derivation does not resolve — never an assumed January to fill the gap.
- **The END is `CutOffDate` on the report catalogue**, returned clean (`2026-07-20 00:00:00`) per
  report. Prefer it to the earlier route of matching a label stem inside the totals response
  ("Ending cash balance as of 12/31/2025"), which still works but parses a date out of a label. It is
  **not always 31 December**: one measured committee-year read 11/16/2025.

## A committee can be CLOSED, and the termination date is served

- **`TerminationDate` and `TerminationYear` are in that same 17-field catalogue response** — the one
  the period panel already reads. No extra request on a profile.
- **Confirmed case:** Paul Novotny, House District 30B. Committee **terminated 28 July 2026**, **no
  2026 contributions at all**, last payment **17 November 2025**. So the profile has money under 2025
  and nothing under 2026, and a reader switching years watches it vanish.
- **It is its own state.** "Filed $0" says the committee filed and reported nothing — it did not file.
  "Not reported" says a report is still coming — none is. "Not on the ballot" says the report is due
  1 Feb 2027 — there will not be one. "Not confirmed" is about our unfinished work. Three of the four
  are actively untrue for a closed committee.
- **Measured 18 Aug 2026: exactly 1 sitting member** — the committee terminated 28 Jul 2026 above. A
  committee that closed mid-election-year is the case a reader is most likely to read as concealment.
- **Open:** whether every catalogue row for a filer carries `TerminationDate`, or only the final
  report. The closed state needs the date in a year that has no report of its own.

## Amendments are ordinary — and the chip and the prior figure fail separately

- **367 of 1,005 catalogued reports carry at least one amendment; one has seven versions.** A little
  over a third — design it as something a reader meets regularly, not a rare correction notice.
- The effective version is the **highest amendment index** for a given filer, year, report type and
  series, and the totals service already applies it. The marker is unblocked for build.
- **Our correction to the earlier spec: the marker is NOT amber** — accepted by CC. Amber is reserved
  for bill/law-code identity and OMNIBUS, and at a third of all reports an alert colour is wrong. It is
  a neutral mono chip (border `palette.ink18`, ink `colors.text.secondary`) in the period panel, plus
  "Previously reported as {figure} on {date}" under the one figure that actually moved.
- **The chip's date is served** — the report catalogue's "Received by the Board" per version, rising
  with the amendment index in 21 of 21 version sets tested.
- **The prior figure is not guaranteed.** It lives in the superseded document; documents are served
  from 2023 onward (so 2025–26 are in range), but the route **fails softly** — a failed fetch returns
  HTTP 200 with a ~30KB HTML page instead of an error. So it goes missing per report, unpredictably,
  while the date beside it is fine. **A dated chip with no prior-figure line is a designed state**, and
  the chip is never suppressed because the line is missing.

## Two more things that are served, not computed

- **The failed-reconciliation flag is stored at ingestion, per filer-year — the page never subtracts.**
  A failed reconciliation already blocks publication upstream, and read-time arithmetic would render a
  negative number on a live page instead of refusing to publish it.
- **The register-of-filers check is served per member.** All 200 are in it today, which is exactly why
  "a committee exists" may not be hardcoded: it would be a sentence that is true when written and
  cannot notice when it stops being true.

## Token names (use these, not hexes)

- `#4f5651` = `palette.ink450`, exposed as **`colors.text.secondary`** (legacy `colors.mutedInk` points
  at the same value; prefer `text.secondary`).
- `rgba(17,21,15,0.18)` = **`palette.ink18`**, with **no semantic alias yet** — spec it by that name
  until a border alias exists. CC holds the missing alias as their gap.

## Routing and roles

- **The year is a query parameter**, matching Bill Detail: `?tab=money&year=2026`. Already built that
  way on both surfaces.
- **Chair and Vice Chair are live now** (Aisha Gomez's profile shows a CO-CHAIR badge beside Taxes), so
  committee roles are no longer blocked on the public data. Nothing on the Overview tab waits on it.

## Accessibility values these screens settled

- `aria-current="page"` belongs to the **tab only**; the active calendar year takes
  `aria-current="true"` — only one thing on a screen is a page, and the year is a filter.
- Loading skeletons: pulse stops under `prefers-reduced-motion`, and each loading card carries a
  visually hidden `role="status" aria-busy="true"` "Loading figures" announcement.
- Independent spending takes the same **"LARGEST N OF M PAYMENTS"** header as money in and out. A bare
  count above a truncated list makes the list claim to be complete.

## Bundle 12 — the split check, the failure that is not an error, and a late report

- **The reconciliation check runs on every release, per filer-year on screen: our named payments
  against the split the FILING ITSELF states.** Where they disagree, **the split is withheld and the
  total is NOT** — the total comes from the Board's service and is the filing's own number, and nothing
  is wrong with it. This is a **separate card from the special-election no-total card**, which drops a
  total we genuinely lack. Folding the two together would hide a sound figure behind a problem it does
  not have, and would tell a reader we have no total for a committee whose total we are certain of.
  Frequency: **3 of 202 legislator-years for 2025** (~1 in 67), beside the special-election case at
  **10 of 407**.
- **Why the check earns a drawn state:** a shortfall in our named payments lands silently in the
  *unnamed* figure and looks completely ordinary. Omar Fateh's 2025 filing itemizes **$2,300** and we
  hold **no rows at all**, so an unchecked card would have shown every dollar of it as money from
  donors too small to name — a false claim about named money, invisible without the check.
- **The totals service failing is NOT the error card.** We keep the figures we last accepted and date
  them as of when we accepted them: older and labelled beats blank, and both beat a number we cannot
  stand behind. The period panel already carries the checked date, so this needs **no new element —
  only the older value**. The error card stays for a genuine fault.
- **The special-election no-total card is TEMPORARY.** Both of a special-election filer's report series
  are fetchable, with adjacent periods in all 5 filers measured, so once the two are assembled those 10
  committee-years get a real total like everyone else. Keep the card — it stays correct for anything
  the route does not reach — but the layout must make removing it cheap.
- **A REPORT CAN BE LATE, and it is the only empty state that makes a claim about a named politician.**
  Measured across every 2026 pre-primary report for sitting legislators (due 27 July, 16 days late as
  of Aug 12): **97 filed, 2 not** (~1 in 50). Both of those 2 have **no other 2026 report** — the
  pre-primary is their only one — so the year is otherwise blank and every existing empty-state
  sentence is false for them: they ARE on the ballot, something IS due, and they have not raised
  nothing.
  - **The signal is positive, from the Board's own list of a filer's reports:** a report nobody has
    filed carries no version history, while every filed report carries one. Same request that already
    gives us the period and the report type. **Never inferred from a failed download** — a download
    failure means at least five different things, only one of which is lateness.
  - We also hold **the period the late report will cover and the date it was due**, from that same
    list, so the screen says what is missing and since when.
  - **Do not show a checked date beside nothing** (it implies we looked and the answer is zero) and
    **do not carry the previous year's figures into the empty year** (it puts last year's money under
    this year's label).
  - Limits: right on **2 of 2** in the current period, untested on older years. Enough to design a
    sentence around, not enough to call a rate.
- **Unchanged:** the 40% / 30% composition bars stand. Every shortfall found so far totals under
  $10,000 against a $10.76M population, so the measured unnamed share moves by less than a tenth of a
  percentage point.

## Bundle 14 — the empty answer that is not empty, and what spending is actually made of

### Nothing empty ever comes back empty (the load-bearing one)

Asking the Board's totals service for a year in which a committee filed **nothing** does not return an
empty answer. It returns **that committee's most recent figures from an earlier year**, with no marker:
same HTTP success, same 17 lines, same shape. Measured on 8 committees with 2025 reports and no 2026
report — all 8 answered a 2026 request with their 2025 figures byte for byte. Paul Novotny answers a
2026 request with $9,455.00 raised through 31 December 2025.

- **Only one line reveals it: "most recent report through" — the coverage end.**
- **THE RULE:** a figure may be shown for the selected year only if the coverage end the service returns
  falls **inside that year**. Where it does not, the year has no data and the empty state applies.
  Nothing renders a total without that check.
- **It governs all three empty states** — not on the ballot, committee closed, report late. Their
  trigger can never be "the service returned nothing", because it never does.
- Why it outranks an ordinary bug: the wrong output is not a blank or an error. It is **last year's
  money under this year's heading, on a candidate's page, in an election season, looking correct.**

### Service-down and wrong-year are DIFFERENT events with different answers

- **The service did not answer** — no response, timeout, malformed body → show the last figures we
  accepted, dated when we accepted them (the stale card, unchanged).
- **The service answered with an earlier year's figures** → this is a **success, not a failure**. The
  selected year has no data, so it takes that member's empty treatment.
- Getting these backwards turns a year we have no data for into a card that looks current — dated, with
  a period and a full payment list. **The tell is the coverage end, never the HTTP result.**

### Spending is categories, not an itemized subtotal — and they do not add up

The service gives spending as campaign expenditures, noncampaign disbursements, other expenditures,
then a total. **The categories do not sum to the total.** John Marty's committee, 2025: categories sum
to $2,172.15 against a reported total of $7,172.15. The missing $5,000 is money the campaign **gave to
other campaigns**, and the service has no line for it.

Measured across every sitting legislator's committee-year, 2025 and 2026:

| | |
|---|---|
| committee-years with any spending | 209 |
| of those, giving money to other committees | **94 (45%)** |
| share of their spending it accounts for | **median 40%**, top quarter 63%, max 99% |
| total given away, 2025–26 | **$593,671** of $3,045,235 spent |

- **The spending card needs its own line for it.** Without one the shortfall falls into the not-itemized
  figure, describing a named payment to a named committee as money too small to name — the Fateh error
  on the other side of the ledger.
- It also earns its place on the merits: a legislator sending 40% of their spending to other campaigns
  is a plain fact about what the money did, and one of the few things on the screen that needs no
  explanation.

### Lateness is the Board's own category, with a published consequence

The Board's 2026 calendar for legislative candidates states, verbatim: **July 27** — pre-primary report
due, period covered 1/1/2026 through 7/20/2026; **July 28** — **$50 per day late filing fee begins**.

- So the period end and the due date come from the same published page: **"16 days ago" is arithmetic on
  two of the Board's own dates**, not a rule of ours. Print both.
- A page saying a report is late is **repeating the Board, not characterising a politician.**
- Which calendar applies depends on being on this year's ballot, which the late state already asserts.
- **When a late report arrives, mark nothing.** The filing is then ordinary and its own dates carry the
  story; a permanent "was late" label would be built from our fetch history, not the record.

### The stale card runs on a condition, not a clock

Last-accepted figures stop being publishable **when a newer report exists that we could not fetch** —
which the report list tells us — never at a fixed number of weeks.

### Termination: on every row, and there IS a final report

- `TerminationDate` appears on **every** report a terminated committee ever filed, not only the final
  one (Novotny: all 16 back to 2019; across 12 terminated filers 16 of 16, 17 of 17, 8 of 8). Read it
  from any row — **no per-year query, and no year can be missing it.**
- `TerminationYear` is **never** set while `TerminationDate` is empty: 0 cases in 1,707 reports. The
  dated-state-with-no-date does not exist.
- **A terminating committee DOES file a final report with figures, at termination** rather than waiting
  for the period to end. Novotny's is listed with a period running to 31 December 2026 and is
  downloadable today — **and the totals service does not return it.**
- Therefore the closed state may **not** say nothing is on record: that is true of our data and false of
  the record. It says the committee closed, that a final report exists and is public, and that we cannot
  show its figures.

## Data census — issue #1661 is the single source (measured 18 Aug 2026)

- **Entity and payment-kind tables live in issue #1661, third comment**, with a dated query beside every
  count. This file points there and restates no census figure — cite #1661 in specs.
- Rules the census settled, now drawn across the mocks: exact-match search, never closest-spelling;
  person rows and pages for sitting members only this release (person page HELD); no cross-committee
  sums (#1663); committee addresses keyed on the registration number; the 18 congressional-district
  party units are committee content and /congressional* forwards to the committees lane; approved
  expenditures never named (absent at source, not dropped by us); no refund kind exists and nothing
  renders net of returns; in-kind rows carry the “donated goods or services” marker inside gift totals;
  the threshold sentence is generated per filer kind and ballot-question pages assert none (statute and
  handbook disagree); figures-disagree states show both figures and no direction; donor street addresses
  are nonpublic (Laws 2026, ch. 101) and unstored; lane counts bind to live register queries — 1,603
  registered filers on census day, never pasted.

## CC build facts — committee endpoints and sequencing (18 Aug 2026, pin d0c0e13a)

- Committee figures are served and verified against production: finance
  GET /api/v1/committees/{registration_number}/finance (alethical/api/routers/public.py:2791), payments
  (:3061), payments-under-name (:3136). Live money-tab components:
  apps/frontend/src/components/campaignMoney/CampaignMoneyTab.tsx.
- **Built since this file was written (19 Aug 2026), so do not design around their absence:** the live
  lane counts and the newest-filings feed, serving from `GET /api/v1/campaign-finance/summary` and
  `/campaign-finance/filings` ([PR #1672](https://github.com/alethical-org/alethical/pull/1672),
  verified on production: 1,603 registered filers as 778 / 299 / 526, and 0 of 200 confirmed links).
  The filings feed returns only filings whose period has ended, because with no filing date stored
  "newest" would otherwise mean the furthest-reaching period and lead with reports covering months of
  the future ([PR #1673](https://github.com/alethical-org/alethical/pull/1673); storing a real filed
  date is [#1670](https://github.com/alethical-org/alethical/issues/1670)).
- Still not built: the name-search service and its 3 indexes (#1486 — lands with the results+list pass),
  the committees-list endpoint, the payee-list endpoint (deferred with the Who got paid index), the
  /track/campaign-finance and /congressional* forwards, and the nav rename.
- Build order: committee-page states → committees list + search results + all-payments view (shared row)
  → Who got paid index (after first release; lane card held, landing ships three lanes) → technical
  version (last, on the v4 document).
- Arrows are drawn glyphs — the site font has no arrow glyph; specs never pin “→” as a typed character.

## Route facts — corrected 18 Aug 2026 (Eugene's ruling; my earlier "404" reason was wrong)

- **The campaign-money route names were OURS, not an inventory of a live app.** `/candidates`,
  `/past-candidates`, `/officials`, `/congressional`, `/congressional-federal`, `/committees`,
  `/partyunits`, `/lobbyists`, `/lobbyingentities`, `/lobbying-associations`, `/search` and `/vendors` are
  names the first draft of this design proposed. On alethical.com only the homepage and `/bills` are live of
  that set, and both predate this work.
- **Nothing is owed to the old site — by ruling, not by measurement (Eugene, 18 Aug 2026).** The old
  campaign-finance app has no real users, and it comes down once this section is live (issue #1667). So **no
  forward or redirect is owed** to any of its addresses, and nothing here is a migration.
- **That old app IS LIVE TODAY, at alethicalfinance.com** (`docs/research/base44-campaign-finance-findings.md`
  line 4). Its sitemap publishes all 12 of those addresses plus `/money-map`, `/legislators` and
  `/candidates-2026`, and `alethicalfinance.com/committees` loads a working committees list.
- **Warning for whoever checks that site next: neither result proves anything.** It answers every address
  with a page, including a made-up one, so a 200 there is not evidence a page exists — and a 404 on
  alethical.com is not evidence about an app hosted elsewhere. I cited exactly that 404 as verification.
- **The rule:** a name I introduce is not a fact about the product, and a check on the wrong host is not a
  check. Before any design claims a route, page, count or label is live, it is checked against the right
  host or a build statement.

## CC build facts — round-3 review of the drawings (18 Aug 2026)

- **The register carries a filer’s KIND and nothing about a ballot question’s SCOPE.** A ballot-question
  row shows only what the register holds — the kind, plus the closed chip where it applies. “Statewide
  ballot question” was ungrounded and is deleted; no scope word appears on any register-driven row.
- **The register kind is the label, verbatim: “Candidate committee.”** The committee header eyebrow read
  CAMPAIGN COMMITTEE, which no data source says; corrected to CANDIDATE COMMITTEE. Any kind shown anywhere
  is the register’s own string.
- **A page may not be promised before it exists, and search ships in the first release.** Search results
  link a got-paid name, so the paid-under-a-name page moves INTO the first release (drawn 18 Aug, screen D
  of Money lists web) even though the Who got paid browse index stays deferred. Data already served:
  payments-under-name, public.py:3136 at pin d0c0e13a.
- **Every list screen needs a loading state**, same skeleton as the money tab: pulse stops under
  prefers-reduced-motion, hidden “Loading figures” announcement.
- **Services CC names as theirs for this section** (recorded so no design re-specs them): a committees-list
  service with kind filter, closed flag, stable A–Z order, pagination and the lane’s live count (new,
  BLOCKS first release); the name-search service with exact-match semantics across legislators, filers and
  payee names on the 3 indexes filed as #1486 (new, BLOCKS first release); additions to the existing
  payments route for largest-first order, the 250 cap with true totals, the coverage-end year gate and a
  per-row donated-goods flag (small); the per-name payments route already exists. **Pagination mechanics
  are the build’s, deliberately not drawn.**

## Two facts a new money drawing needs, and the drawings do not carry (31 Aug 2026)

- **The $200 sentence in these drawings is the retired wording, and it is false.** Counted across the
  bundle: "donors who gave $200 or less in total for the year are **never named**" appears 7 times, in
  `Campaign money IA.dc.html` (3), both `LIVE Legislator profile` files, `Money committee web.dc.html`
  and `Money lists web.dc.html`; the corrected wording appears 0 times. $200 is the point at which a
  name becomes **required**, not a line below which nobody is named: a committee may itemize a smaller
  donor and at least one does, and 327,759 of 583,152 published rows are individually under $200.
  `.claude/rules/grounded-answers.md` rule 12 carries the correction and the evidence, the shipped
  string was fixed in [#1755](https://github.com/alethical-org/alethical/issues/1755), and
  `RECORD_DOES_NOT_COVER` in `apps/frontend/src/lib/moneyLanding.ts` now reads "**need not** be named".
  **The drawings were not updated**, so anything drawn or rebuilt from this bundle reintroduces a
  sentence our own rules record as false. A ballot-question filer's page prints no threshold sentence
  at all — the statute says $500 and the Board's own handbook for those filers says $200, and rule 12
  makes silence the honest third option.
- **Nothing in this bundle was drawn at phone width except the legislator profile.** Counted:
  `LIVE Legislator profile mobile.dc.html` plus 2 phone mentions in its web twin; the IA, the committee
  page, the lists, the report and the route map carry **0**. Those pages are live at phone widths on the
  build's own judgment, on the one `isMobile` split at 768px (`apps/frontend/src/hooks/useResponsive.ts`),
  with no treatment for the 768–1100 tablet band the hook also exposes. A phone drawing for the money
  section is undrawn work, not a build detail already settled here.
