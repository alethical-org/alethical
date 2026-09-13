# Campaign-finance calendar source evidence

Net: The Board's published calendars support 2015–2026 candidate schedules. A finished historical schedule keeps its known ballot state, with no upcoming deadline.

## Source checks

The source PDFs were retrieved on 13 September 2026. Each source answered with PDF bytes, not the Board's HTML error page. Exact copies are preserved in `alethical/tests/fixtures/campaign_finance_calendars/`; `campaign_finance_calendar_sources.py` records their SHA-256 hashes. The focused source test reads each PDF independently with pypdf and matches every transcribed report name, period start, period end, due-date row and printed condition. The PDF's printed year heading supplies the year when a date omits it. Dates are stored as literals, never calculated from election cycles.

The [Board's archive](https://cfb.mn.gov/filer-resources/disclosure-publications/calendars/calendars-archive) links 2023–2026. Earlier year-specific addresses still serve real PDFs. A missing archive link does not mean the calendar is unavailable. The `current_year_` aliases can serve a different year from search-engine excerpts, so the transcription uses the actual year-specific PDFs.

Visual checks include the 2015 general calendar, 2016 combined Senate/House/District Court calendar, 2018 constitutional/appellate calendar and 2024 not-filing calendar. The automated source comparison covers every report row in every preserved PDF.

## Year-specific scope

- 2015, 2017, 2019, 2021, 2023 and 2025 have general disclosure calendars, each with 2 annual receipts/expenditures reports. These are explicit source-backed years, not an odd-year rule. Lobbying and economic-interest entries in the older general calendars are excluded.
- 2016, 2020, 2022 and 2026 combine Senate, House and District Court filing candidates. The 2016 `house_district_court` and `senate` addresses serve byte-identical PDFs titled for all 3 offices.
- 2018 and 2024 have House/District Court calendars. The 2018 not-filing calendar names State Senate in its title; the 2024 not-filing scope excludes only House, District Court and appellate candidates filing for the listed seats. A Senate election report never receives a House-only schedule.
- 2016, 2020 and 2024 publish appellate filing calendars. 2018, 2022 and 2026 publish combined constitutional/appellate filing calendars. The 2018 `const_offices` and `appellate_court` addresses serve byte-identical PDFs.
- Constitutional and appellate filing calendars have early-year reports as well as election reports. Their printed conditions remain attached to each report. Their pre-election schedules cannot be inferred from a legislative schedule.
- Special elections retain their separate unknown state. A historical committee-year with no catalogued report remains unreadable; a committee registered later must not be placed on an earlier year's off-ballot schedule.
- The 2016 legislative PDF calls the pre-primary report “First Report”. The calendar's primary-election section identifies its 25 July deadline; matching the report title alone cannot identify it.

## Transcribed reports

Each date pair is the printed period end and due date. The preserved source also proves the period start and every condition.

| Calendar year | Official PDF | Period end → due date |
| --- | --- | --- |
| 2015 | [2015_general_disclosure_calendar.pdf](https://cfb.mn.gov/pdf/calendars/2015_general_disclosure_calendar.pdf) | 2014-12-31 → 2015-02-02; 2015-12-31 → 2016-02-01 |
| 2016 | [2016_appellate_court.pdf](https://cfb.mn.gov/pdf/calendars/2016_appellate_court.pdf) | 2015-12-31 → 2016-02-01; 2016-03-31 → 2016-04-14; 2016-05-31 → 2016-06-14; 2016-07-18 → 2016-07-25; 2016-09-20 → 2016-09-27; 2016-10-24 → 2016-10-31; 2016-12-31 → 2017-01-31 |
| 2016 | [2016_candidates_not_running.pdf](https://cfb.mn.gov/pdf/calendars/2016_candidates_not_running.pdf) | 2015-12-31 → 2016-02-01; 2016-12-31 → 2017-01-31 |
| 2016 | [2016_house_district_court.pdf](https://cfb.mn.gov/pdf/calendars/2016_house_district_court.pdf) | 2015-12-31 → 2016-02-01; 2016-07-18 → 2016-07-25; 2016-10-24 → 2016-10-31; 2016-12-31 → 2017-01-31 |
| 2017 | [2017_general_disclosure_calendar.pdf](https://cfb.mn.gov/pdf/calendars/2017_general_disclosure_calendar.pdf) | 2016-12-31 → 2017-01-31; 2017-12-31 → 2018-01-31 |
| 2018 | [2018_candidates_not_running.pdf](https://cfb.mn.gov/pdf/calendars/2018_candidates_not_running.pdf) | 2017-12-31 → 2018-01-31; 2018-12-31 → 2019-01-31 |
| 2018 | [2018_const_offices.pdf](https://cfb.mn.gov/pdf/calendars/2018_const_offices.pdf) | 2017-12-31 → 2018-01-31; 2018-03-31 → 2018-04-16; 2018-05-31 → 2018-06-14; 2018-07-23 → 2018-07-30; 2018-09-18 → 2018-09-25; 2018-10-22 → 2018-10-29; 2018-12-31 → 2019-01-31 |
| 2018 | [2018_house_district_court.pdf](https://cfb.mn.gov/pdf/calendars/2018_house_district_court.pdf) | 2017-12-31 → 2018-01-31; 2018-07-23 → 2018-07-30; 2018-10-22 → 2018-10-29; 2018-12-31 → 2019-01-31 |
| 2019 | [2019_general_disclosure_calendar.pdf](https://cfb.mn.gov/pdf/calendars/2019_general_disclosure_calendar.pdf) | 2018-12-31 → 2019-01-31; 2019-12-31 → 2020-01-31 |
| 2020 | [2020_appellate_court.pdf](https://cfb.mn.gov/pdf/calendars/2020_appellate_court.pdf) | 2019-12-31 → 2020-01-31; 2020-03-31 → 2020-04-14; 2020-05-31 → 2020-06-15; 2020-07-20 → 2020-07-27; 2020-09-15 → 2020-09-22; 2020-10-19 → 2020-10-26; 2020-12-31 → 2021-02-01 |
| 2020 | [2020_candidates_not_running.pdf](https://cfb.mn.gov/pdf/calendars/2020_candidates_not_running.pdf) | 2019-12-31 → 2020-01-31; 2020-12-31 → 2021-02-01 |
| 2020 | [2020_senate_house_district_court.pdf](https://cfb.mn.gov/pdf/calendars/2020_senate_house_district_court.pdf) | 2019-12-31 → 2020-01-31; 2020-07-20 → 2020-07-27; 2020-10-19 → 2020-10-26; 2020-12-31 → 2021-02-01 |
| 2021 | [2021_general_disclosure_calendar.pdf](https://cfb.mn.gov/pdf/calendars/2021_general_disclosure_calendar.pdf) | 2020-12-31 → 2021-02-01; 2021-12-31 → 2022-01-31 |
| 2022 | [2022_candidates_not_running.pdf](https://cfb.mn.gov/pdf/calendars/2022_candidates_not_running.pdf) | 2021-12-31 → 2022-01-31; 2022-12-31 → 2023-01-31 |
| 2022 | [2022_const_offices_appellate_court.pdf](https://cfb.mn.gov/pdf/calendars/2022_const_offices_appellate_court.pdf) | 2021-12-31 → 2022-01-31; 2022-03-31 → 2022-04-14; 2022-05-31 → 2022-06-14; 2022-07-18 → 2022-07-25; 2022-09-20 → 2022-09-27; 2022-10-24 → 2022-10-31; 2022-12-31 → 2023-01-31 |
| 2022 | [2022_senate_house_district_court.pdf](https://cfb.mn.gov/pdf/calendars/2022_senate_house_district_court.pdf) | 2021-12-31 → 2022-01-31; 2022-07-18 → 2022-07-25; 2022-10-24 → 2022-10-31; 2022-12-31 → 2023-01-31 |
| 2023 | [2023_general_disclosure_calendar.pdf](https://cfb.mn.gov/pdf/calendars/2023_general_disclosure_calendar.pdf) | 2022-12-31 → 2023-01-31; 2023-12-31 → 2024-01-31 |
| 2024 | [2024_appellate_court.pdf](https://cfb.mn.gov/pdf/calendars/2024_appellate_court.pdf) | 2023-12-31 → 2024-01-31; 2024-03-31 → 2024-04-15; 2024-05-31 → 2024-06-14; 2024-07-22 → 2024-07-29; 2024-09-17 → 2024-09-24; 2024-10-21 → 2024-10-28; 2024-12-31 → 2025-01-31 |
| 2024 | [2024_candidates_not_running.pdf](https://cfb.mn.gov/pdf/calendars/2024_candidates_not_running.pdf) | 2023-12-31 → 2024-01-31; 2024-12-31 → 2025-01-31 |
| 2024 | [2024_house_district_court.pdf](https://cfb.mn.gov/pdf/calendars/2024_house_district_court.pdf) | 2023-12-31 → 2024-01-31; 2024-07-22 → 2024-07-29; 2024-10-21 → 2024-10-28; 2024-12-31 → 2025-01-31 |
| 2025 | [2025_general_disclosure_calendar.pdf](https://cfb.mn.gov/pdf/calendars/2025_general_disclosure_calendar.pdf) | 2024-12-31 → 2025-01-31; 2025-12-31 → 2026-02-02 |
| 2026 | [2026_const_offices_appellate_court.pdf](https://cfb.mn.gov/pdf/calendars/2026_const_offices_appellate_court.pdf) | 2025-12-31 → 2026-02-02; 2026-03-31 → 2026-04-14; 2026-05-31 → 2026-06-15; 2026-07-20 → 2026-07-27; 2026-09-15 → 2026-09-22; 2026-10-19 → 2026-10-26; 2026-12-31 → 2027-02-01 |

## Release and rollback

Calendar determinations are computed when a reader asks for them. Deployment activates the transcription; no database load, published-finance replacement, historical totals fetch or payment refresh is required. Reverting the code restores the earlier calendar coverage without changing stored financial records. Historical `on_the_ballot` and `not_on_the_ballot` responses have null upcoming-report fields when every report on that selected calendar has come due. A missing year/class still returns `calendar_not_transcribed`.
