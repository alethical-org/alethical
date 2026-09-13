# Exact-name candidate connections, 13 September 2026

This is a dated check of the held source rows for
[issue 2145](https://github.com/alethical-org/alethical/issues/2145), not a claim about
people's identities or a new page design.

The published contributions copy was `5b892996-14ce-4992-87ed-b825400beb26`, within release
`af236cca-a4f8-4efe-9a3a-025259ea380e`. Its 583,222 rows were copied on 1 September 2026.
The file is **All - Itemized Contributions Received Of Over $200 - Campaign Finance.csv**,
SHA-256 `b90b6c2091c532a0f792a5e4f5d6c7ffca3fb09b3c7a0f0979a3a491e903da04`, from the
[Board's campaign-finance downloads](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/).
No Board request, replacement, production write or source-check recalculation was run.

The [real-row fixture](../../alethical/tests/fixtures/campaign_finance_name_connections/17868-2025.json)
retains all 82 Individual-kind Contribution row occurrences for registration 17868,
year 2025, plus all 47 matching Individual-kind Contribution occurrences to other PCC
registrations in that same source year. Only printed name, source row number, year,
recipient registration and classification fields were selected. There are no contact fields.

An independent read-only, repeatable-read database transaction captured the rows and source
identity. Python sets independently counted distinct other PCC registrations per exact name.
The implementation's results matched the independent fixture, including all top-name ties.
The current source copy was pinned throughout each read. PostgreSQL uses a deterministic
text collation, so equality keeps different spellings separate. The service explicitly uses
C ordering to make alphabetical ties reproducible across database locales.

| Other candidate registrations | Exact printed names |
| ----------------------------- | ------------------: |
| 0                             |                  55 |
| 1                             |                  11 |
| 2                             |                   5 |
| 3                             |                   1 |
| 4+                            |                   2 |

The denominator is 74 names; the numerator is 19 names with another candidate registration.
The 5 highest counts are Kratsch, Charles (11), Lindau, Philip (6), Nystrom, Brian (3),
Cullen, Mark (2), and Haselow, RE (2). These are counts of registrations under exact strings,
not counts of people, and not a complete account of anyone's giving.

## Focused read cost

The first service call for 17868/2025 took 58.5 ms; repeated calls took 32.9–34.1 ms.
For 20003/2025, the first call took 53.2 ms and repeated calls took 38.6–38.7 ms.
Database execution in the saved query plans was 1.8 ms and 9.4 ms respectively.
Both used the existing recipient/year and source-copy/contributor indexes, with no disk
reads or temporary-file writes in those plans. These are 2 measured committee-years;
the first call is not evidence of an empty database cache or a system-wide worst case.

No index, storage, scheduled work or page change is required for this calculation.
The [API response record](../architecture/backend-api-system-design.md) defines the served
block, absent-year states, exact-spelling boundary and count ordering.

## Live response and existing-screen check

The released calculation in [pull request 2178](https://github.com/alethical-org/alethical/pull/2178)
passed an independent recheck on 13 September 2026, at 17:44:33 to 17:44:34 UTC.
All 5 ordinary public requests returned HTTP 200, without a cache-busting parameter:

| Public request | Result |
| --- | --- |
| [Committee 17868, 2025](https://api.alethical.com/api/v1/committees/17868/finance?year=2025) | 19 of 74 exact names; distribution 55, 11, 5, 1, 2 |
| [Dated committee 17868, 2025](https://api.alethical.com/api/v1/committees/17868/finance?year=2025&include_confirmation=false) | The same complete name-connections block |
| [Jim Abeler, 2025](https://api.alethical.com/api/v1/legislators/jim-abeler/campaign-finance?year=2025) | The same complete name-connections block on committee 17868 |
| [Committee 17868, 2027](https://api.alethical.com/api/v1/committees/17868/finance?year=2027) | Unavailable; null numerator and denominator; empty distribution and top-name lists |
| [Committee 20003, 2025](https://api.alethical.com/api/v1/committees/20003/finance?year=2025) | 17 of 30 exact names; distribution 13, 9, 4, 0, 4 |

The distribution order is 0, 1, 2, 3 and 4 or more other candidate registrations.
Each reported distribution sums to its denominator; its nonzero-connection buckets
sum to its numerator. Abeler's top 5 and exact-spelling method match the fixture
above. Every response identifies data release `af236cca-a4f8-4efe-9a3a-025259ea380e`,
copied at `2026-09-01T18:33:35.639027Z`. The responses carry no backend code-commit
field, so the data identity is not presented as a server deployment identity.

Chrome opened the existing [Jim Abeler money tab](https://www.alethical.com/legislators/jim-abeler?tab=money&year=2025)
on website release [e02171ea](https://github.com/alethical-org/alethical/commit/e02171eaf689c5d8746ef7f67b99044d1c0f314c).
At 1512 pixels, changing 2025 to 2024 and back updated both year selections,
report dates and the name/payment counts: 74/82, 35/36, then 74/82. The screen
did not overflow sideways. No shared-name visualization is claimed: this release
adds server data, and its display still awaits Design.

Direct navigation to the API host was blocked by Chrome with
`ERR_BLOCKED_BY_CLIENT`. The 5 JSON comparisons therefore used independent HTTP
requests; the browser portion checked the existing public screen only. Browser
permissions were unchanged, and no published data or source check was changed.
