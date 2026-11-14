# Finance name-matching eval

<!-- describes: alethical/eval/finance_names.py, scripts/finance_name_eval.py, alethical/eval/fixtures/finance_name_pairs.json, alethical/eval/fixtures/finance_name_searches.json -->

Net: this measures whether a name in Alethical Finance lands on the right record.
It checks 2 things: whether 2 printed spellings of one filer are grouped together on
a name page, and whether typing a person's name finds their record in the first 5
search results. The answers come from the Campaign Finance Board's own registration
numbers and from person-checked links, never from a judgement about names.

## What it measures, and why these 2 steps

Finance shows a client money under names. 2 matching steps decide what they see:

- **Spelling groups.** A name page lists payments under the spelling the client
  opened and under "strongly likely" variants (`groups_with` in
  `alethical/api/services/finance_similar_names.py`, which applies
  `strong_spelling` in `finance_name_matching.py`). A missed variant hides
  payments. A wrong group shows another filer's payments under the heading.
- **Search.** Finance search (`finance_suggestions.money`) must put the record a
  person typed for among its first results.

Both steps are fixed rules, so 1 run per case gives the whole answer. The eval
calls the shipped functions; it holds no copy of either rule.

## Where the answer key comes from

**Spelling pairs** come from contribution rows that carry the donor's own Board
registration number (committees, party units, funds and lobbyists).

- 2 different spellings under 1 number are **the same filer**.
- 2 close spellings under 2 different numbers are **different filers**.
- A spelling must appear on at least 2 rows under its number. A single row can be a
  mistyped number, which would fake either label.
- A number printed under more than 6 spellings is treated as a reused placeholder
  and skipped, as are filer types whose numbers the source reuses across unrelated
  people ("Individual", "Self", "Other", blank).
- Spellings identical once case and punctuation are set aside are skipped; they
  test nothing.

Individual donors carry no number, so no pair labels a private individual. Lobbyist
pairs stand in for personal names.

Each pair also carries a **condition**, decided by character resemblance with case,
punctuation and word order set aside (85% or more is "spelling"; less is "wording").
A spelling group claims to catch spelling differences only, so a missed spelling
pair is a failure and a missed wording pair (a rename, an added district number) is
reported but not failed. Each failure also names a **pattern**, computed by code:
`extra_words`, `shortened_word`, `typo`, `numbers_differ`, `accents_case_or_order`
or `other`.

A pair removed after reading is kept in the fixture with its reason in `excluded`.

**Searches** come from 2 settled sources:

- Person-checked links from a legislator to a committee on the current register.
  The typed text is the legislator's first and last name; the committee must
  appear in the committee results.
- The lobbyist register. Each lobbyist is searched twice: first name then last
  name, and the name as printed ("Last, First M"). The lobbyist must appear in
  the lobbyist results.

## Running it

```bash
PYTHONPATH=. uv run python scripts/finance_name_eval.py pairs
```

Offline and free. Prints the 3 rates, misses by pattern and every failure.

```bash
ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run python scripts/finance_name_eval.py search --run-dir /tmp/finance-name-eval
```

Runs every search through Finance search against production. Every transaction is
`READ ONLY` (`read_only_engine`), so a run cannot write. The record must appear in
the first 5 results.

`harvest-pairs` and `harvest-searches` rebuild the fixtures from production, also
read-only. Rebuilding keeps every exclusion and empties the known failures, which
`pairs --record-known` then records afresh.

**The regression floor.** `alethical/tests/test_finance_name_eval.py` grades the
committed pairs on every pull request. Any pair whose result changes fails the
test, in either direction: a newly failing pair names what broke, and a newly
passing pair has to be recorded with `--record-known` so the floor rises with it.
A matching-rule change therefore states its effect on the labelled pairs in the
same pull request.

## Results

<!-- timeless-check-ignore: dated measurement of the first run -->
Measured on 14 November 2026 against the published contribution file
(snapshot `58c13cce`) and the current registers.

**Spelling pairs** (204 graded, 1 excluded):

| Condition | Grouped |
| --- | --- |
| Same filer, spelling differs | 24 of 79 (30%) |
| Same filer, words differ | 0 of 80 |
| Different filers grouped | 0 of 45 |

No pair of different filers was grouped. Of the 55 missed spelling pairs:

- **37 add words.** The markers "(New)" and "(Old)", a district printed in one
  spelling only ("Senate Dist 26"), a registration number appended
  ("- 70005"), "PAC", "Jr", or "&" against "and".
- **10 shorten a word.** Mostly a middle initial against the full middle name
  ("Linda M" and "Linda Marie"), and "Sam" against "Samuel".
- **7 other.** Nicknames ("Jim" and "James", "Joe" and "Joseph") and
  abbreviations the rule does not expand ("Assn", "Pol Fund").
- **1 number** read as conflicting because one spelling carries the registration
  number.

Every person pair the rule grouped is right, and 24 of 39 person spelling pairs
group. None of the 40 organization spelling pairs groups: their differences are
almost all added words. The donor page reads every donor name as a personal name,
but the organization rule groups only 1 of the same 40, so the person reading is
not the cause.

Excluded: Hubert H Humphrey III and IV printed under 1 registration number (2
people).

**Searches** (180, first 5 results):

| Typed | Found |
| --- | --- |
| Legislator's first and last name, committee expected | 53 of 60 |
| Lobbyist, first name then last name | 60 of 60 |
| Lobbyist, name as printed | 60 of 60 |

The 7 committee misses: 5 nicknames ("Zack" for Zachary, "Patti" for Patricia,
"Tom" for Thomas, "Jim" for James, "Liish" for Alicia), 1 middle initial typed with
a period that the committee name omits ("Mark W. Koran"), and 1 accented name
("María Isa Pérez-Vega" against the printed "Perez-Vega, Maria").

## What it does not cover

- **Individual donors.** They carry no registration number, so the key cannot label
  them. Lobbyist names stand in for personal names; whether the rates carry over
  is not measured.
- **Media buys search.** Spaces against hyphens in folder names are
  [issue 2908](https://github.com/alethical-org/alethical/issues/2908).
- **Identity confirmations.** People confirm identities record by record with
  quoted evidence; nothing there is automatic to score.
- **People and candidate pages** outside Finance search, and statewide candidates,
  who have no person-checked committee link yet.
