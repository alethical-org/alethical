# Prior-biennium bill readiness (#359)

**Net:** Minnesota published 20,538 regular-session bills in 2021-2024, and
Alethical can make them discoverable without buying AI summaries or search
vectors after 2 safety gates are complete.

Measured on August 12, 2026. This record does not import or change any bill.

## Official counts

| Session | House bills | Senate bills | Total bills |
| --- | ---: | ---: | ---: |
| 93rd Legislature, 2023-2024 | 5,488 | 5,535 | 11,023 |
| 92nd Legislature, 2021-2022 | 4,905 | 4,610 | 9,515 |
| **Both sessions** | **10,393** | **10,145** | **20,538** |

The [Minnesota Legislative Reference Library's 93rd Legislature
record](https://www.lrl.mn.gov/timecapsule/session?sess=93) reports 3,342 House
and 3,363 Senate introductions in 2023, plus 2,146 House and 2,172 Senate
introductions in 2024. The [Library's 92nd Legislature
record](https://www.lrl.mn.gov/timecapsule/session?sess=92) reports 2,653 House
and 2,572 Senate introductions in 2021, plus 2,252 House and 2,038 Senate
introductions in 2022. These official totals match the bill lists returned by the
Minnesota Revisor.

Production currently has 0 bills from these 2 regular sessions.

## The $0 AI route

[Issue #1323](https://github.com/alethical-org/alethical/issues/1323) must be live
first. Its Browse and Search change lets a bill appear under its official title
when no plain-language AI summary exists.

That makes the first historical release cost $0 for AI summaries and $0 for search
vectors. Direct bill pages can show the official record and bill text. Plain-language
summaries and Ask search can remain separate later work.

## The text safety gate

The narrow first part of [issue
#821](https://github.com/alethical-org/alethical/issues/821) must follow #1323 and
precede the historical load.

For each bill, Alethical must read the visible sections from the official page in
1 independent pass. It must then rebuild those sections from the parts it plans to
store. The section count, order, and words must match before the bill can be saved.
Repeated section labels must stay separate by their position on the page.

## Safe release order

1. Release #1323 and prove that a bill without an AI summary appears in Browse
   and Search under its official title.
2. Release the narrow #821 section-equality check.
3. Load the 2023-2024 session while it remains hidden from readers.
4. Verify the complete 11,023-bill count and representative official pages, then
   reveal that session.
5. Repeat the hidden load and verification for all 9,515 bills from 2021-2022.

## Acceptance

- [ ] #1323 is live and Browse and Search show a summary-free bill under its
      official title. — Net: Historical discovery does not require paid AI text.
- [ ] The narrow #821 check refuses any bill whose official visible sections do
      not exactly match the sections Alethical would store. — Net: A partial or
      reordered bill cannot look complete.
- [ ] The hidden 2023-2024 load contains exactly 11,023 verified bills before it
      becomes visible. — Net: Readers never see a half-filled session.
- [ ] The hidden 2021-2022 load contains exactly 9,515 verified bills before it
      becomes visible. — Net: Readers never see a half-filled session.
- [ ] Both sessions appear in Browse, Search, direct bill pages, and the session
      menu without AI summaries or search vectors. — Net: 20,538 official bills
      become discoverable with $0 in AI charges.
