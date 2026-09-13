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
