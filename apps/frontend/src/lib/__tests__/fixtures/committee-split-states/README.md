# One real response per campaign-money split state

Eight whole responses from `GET /api/v1/committees/{registration_number}/finance`,
recorded from **production** on 19 August 2026, one per value `split.state` can take.
They exist so the wording each state gets is written against what the server really
sends, including which fields come back `null`, rather than against a shape somebody
sketched. Recorded for the frontend session building that wording after
[#1682](https://github.com/alethical-org/alethical/issues/1682) and
[#1648](https://github.com/alethical-org/alethical/issues/1648).

The same `split` object is served by
`GET /api/v1/legislators/{legislator_id}/campaign-finance`, once per confirmed
committee under `committees[]`, from the same function
(`split_for_committee` in `alethical/api/services/legislator_finance.py`). So these
fixtures describe both surfaces.

| file                                                             | `split.state`                          | committee-years in this state |
| ---------------------------------------------------------------- | -------------------------------------- | ----------------------------- |
| `committee-20003-2024-shown.json`                                | `shown`                                | 3,062                         |
| `committee-18135-2026-no_reported_total.json`                    | `no_reported_total`                    | 7,442                         |
| `committee-30204-2024-no_named_payments.json`                    | `no_named_payments`                    | 468                           |
| `committee-20006-2024-sources_disagree.json`                     | `sources_disagree`                     | 62                            |
| `committee-19388-2026-periods_differ.json`                       | `periods_differ`                       | 16                            |
| `committee-19244-2025-named_payments_not_in_our_copy.json`       | `named_payments_not_in_our_copy`       | 14 (see below)                |
| `committee-18472-2026-named_payments_not_in_our_copy.json`       | `named_payments_not_in_our_copy`       | the same 14, other shape      |
| `committee-19086-2026-reported_total_predates_a_correction.json` | `reported_total_predates_a_correction` | 1                             |

Counts measured over all 11,065 committee-years of the release these were read from.

**`figures_do_not_line_up` has no fixture because no committee-year is in it.** It is
the honest fallback for two figures that will not subtract with no correction on
record, and it exists so the other two states never have to cover a case they cannot
support. `test_named_payments_exceeding_the_filers_own_total_withhold_the_split` in
`alethical/tests/test_legislator_finance.py` constructs one.

**Two files for one state, and this is the trap.** `named_payments_not_in_our_copy`
arrives in two shapes. Kristin Robbins's committee carries
`reported_total: "553925.8600"`; Paul Novotny's carries `reported_total: null`, because
the Board's totals route publishes no contribution figure for that committee-year at
all. Same state string, one figure present and one absent, and **8 of the 14 are the
Novotny shape**. Anything that assumes the total is there because the state says the
filing names donors prints an empty number under a real committee's name.

## Which `split` fields are `null`, per state

| state                                  | `null`                                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `shown`                                | nothing                                                                                                                            |
| `sources_disagree`                     | `unnamed_total`                                                                                                                    |
| `periods_differ`                       | `unnamed_total`                                                                                                                    |
| `reported_total_predates_a_correction` | `unnamed_total`                                                                                                                    |
| `no_named_payments`                    | `unnamed_total`, `named_total`, `named_payments`, `named_cash_total`, `named_in_kind_total`, `first_payment_on`, `last_payment_on` |
| `named_payments_not_in_our_copy`       | the same 7, and `reported_total` / `reported_through` on the Novotny shape                                                         |
| `no_reported_total`                    | all 9                                                                                                                              |

`unnamed_total` is `null` in every state but `shown`, which is the point: it is the
only figure this system works out by subtraction, and every other state is a reason
that subtraction would state something false.

`reported_total` and `reported_through` are always dropped **together**, never one
without the other, so a page can never print a coverage date beside a figure it does
not have.

## Keeping them honest

They are a snapshot of one release, so a figure in them can go stale. What must not
drift is the **shape** — the state names, which fields are present, and which are
`null`. Re-record with the same request if a state's shape changes, and say in the
commit what moved.
