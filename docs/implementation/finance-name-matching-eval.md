# Finance name-matching eval

<!-- describes: alethical/eval/finance_names.py, scripts/finance_name_eval.py, alethical/eval/fixtures/finance_name_pairs.json, alethical/eval/fixtures/finance_name_searches.json -->

Net: this measures whether a name in Alethical Finance lands on the right record.
It checks 2 things: whether 2 printed spellings of one filer are grouped together on
a name page, and whether typing a person's name puts their record among the 3
results Finance search shows. The answers come from the Campaign Finance Board's own
registration numbers and from person-checked links, never from a judgement about
names.

## What it measures, and why these 2 steps

Finance shows a client money under names. 2 matching steps decide what they see:

- **Spelling groups.** A name page lists payments under the spelling the client
  opened and under "strongly likely" variants (`groups_with` in
  `alethical/api/services/finance_similar_names.py`, which applies
  `strong_spelling` in `finance_name_matching.py`). A missed variant hides
  payments. A wrong group shows another filer's payments under the heading.
- **Search.** Finance search (`finance_suggestions.money`, behind the search box)
  must put the record a person typed for among the 3 results it shows per group.

Both steps are fixed rules, so 1 run per case gives the whole answer. The eval
calls the shipped functions; it holds no copy of either rule.

## Where the answer key comes from

**Spelling pairs** come from contribution rows that carry the donor's own Board
registration number (committees, party units, funds and lobbyists).

- 2 different spellings under 1 number are **the same filer**.
- 2 close spellings under 2 different committee, party-unit or fund numbers are
  **different filers**. Lobbyists never supply "different" pairs: one lobbyist can
  hold 2 numbers.
- A spelling printed under 2 numbers is **cannot tell**: the key cannot say which
  filer it names. So is every pair under a lobbyist number whose spellings carry 2
  different middle initials ("Nancy B" and "Nancy M"), which may be 2 people.
  These pairs are reported and never graded.
- Under a lobbyist's number, only spellings sharing the family name printed most
  often under it are kept. The same number turns up on other people's rows, which
  would otherwise label 2 people "the same".
- A spelling must appear on at least 2 rows under its number. A single row can be a
  mistyped number, which would fake either label.
- A number printed under more than 6 spellings is treated as a reused placeholder
  and skipped, as are filer types whose numbers the source reuses across unrelated
  people ("Individual", "Self", "Other", blank).
- Spellings identical once case, spacing and punctuation are set aside are skipped;
  they test nothing.

Individual donors carry no number, so the key labels only registered filers:
committees, party units, funds and registered lobbyists. Lobbyist pairs stand in
for personal names.

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

Offline and free. Prints the rates, misses by pattern and every failure.

```bash
ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run python scripts/finance_name_eval.py search --run-dir /tmp/finance-name-eval
```

Runs every search through Finance search against production. Every transaction is
`READ ONLY` (`read_only_engine`), so a run cannot write. `--limit` sets how many
results count; the default, 3, is what the search box shows.

`harvest-pairs` and `harvest-searches` rebuild the fixtures from production, also
read-only. Rebuilding keeps every exclusion and empties the known failures, which
`pairs --record-known` then records afresh. Read every person pair after a
rebuild; the family-name filter catches another person under a lobbyist's number,
not every source error.

**The regression floor.** `alethical/tests/test_finance_name_eval.py` grades the
committed pairs on every pull request. Any pair whose result changes fails the
test, in either direction: a newly failing pair names what broke, and a newly
passing pair has to be recorded with `--record-known` so the floor rises with it.
A matching-rule change therefore states its effect on the labelled pairs in the
same pull request. The searches need a database and have no floor.

## Results

<!-- timeless-check-ignore: dated measurements, before and after the matching change -->
Measured on 14 November 2026 against the published contribution file
(snapshot `58c13cce`) and the current registers, first with the earlier rules and
then with the current ones (a middle initial may stand for the other spelling's full
middle name; search accepts accent-free words, nicknames and 1 missing middle word).

**Spelling pairs** (263, 1 excluded):

| Condition | Earlier rules | Current rules |
| --- | --- | --- |
| Same filer, spelling differs | 25 of 80 | 33 of 80 (41%) |
| Same filer, words differ | 0 of 80 | 4 of 80 |
| Different filers | 0 of 40 | 0 of 40 |
| Cannot tell | 10 of 62 | 10 of 62 |

No pair of different filers is grouped. The 8 newly grouped pairs are all a middle
initial against its full middle name ("Linda M" and "Linda Marie"); the "cannot tell"
pairs grouped are the same 10 as before, all a missing middle initial under a lobbyist
number with conflicting initials. If those are 2 people, the page shows one's
payments under the other's name. None of the 40 organization spelling pairs groups.
The donor page reads every donor name as a personal name, but the organization rule
groups only 1 of the same 40, so the person reading is not the cause. Of the 47
spelling pairs still missed:

- **33 add words.** The markers "(New)" and "(Old)", a district printed in one
  spelling only ("Senate Dist 26"), a registration number appended
  ("- 70005"), "PAC", "Jr", or "&" against "and".
- **9 other.** 5 abbreviations the rule does not expand ("Assn", "Pol Fnd",
  "Fd"), 2 district names reordered with a marker, and 2 nicknames ("Jim" and
  "James", "Joe" and "Joseph").
- **4 shorten a word.** 2 district names reordered ("63rd Senate District DFL" and
  "Senate District 63 DFL"), "Sam" against "Samuel", and "Pol Action Comm".
- **1 number** read as conflicting because one spelling carries the registration
  number.

"(New)" and "(Old)" stay distinct on purpose: the bare name "9th Senate District DFL"
is printed under both the old unit's registration (20897) and the new one's (20977),
so dropping the markers would put 2 filers' payments under 1 heading. Spelling groups
never use nicknames.

Excluded after reading: "Humphrey, Hubert H, III" and "Humphrey, Hubert H, IV",
2 people printed under registration 2068. The number's other pairs are "cannot
tell" by the middle-initial rule.

**Searches** (180, among the 3 results shown):

| Typed | Earlier rules | Current rules |
| --- | --- | --- |
| Legislator's first and last name, committee expected | 53 of 60 | 59 of 60 |
| Lobbyist, first name then last name | 60 of 60 | 60 of 60 |
| Lobbyist, name as printed | 60 of 60 | 60 of 60 |

The 6 committees now found were missed for 4 nicknames ("Zack", "Patti", "Tom",
"Jim"), a middle initial the committee name omits ("Mark W. Koran") and an accent
("María Isa Pérez-Vega" against "Perez-Vega, Maria"). The remaining miss is
"Liish Kozlowski" against "Kozlowski, Alicia", which no nickname list covers. Time per
search, measured from a laptop to production with the network included, is unchanged
within noise: median 1.40 s and slowest 4.55 s before, 1.27 s and 4.72 s after.

## What it does not cover

- **Individual donors.** They carry no registration number, so the key cannot label
  them. Lobbyist names stand in for personal names; whether the rates carry over
  is not measured.
- **Different people with near-identical names.** Lobbyists supply no "different"
  pairs, so wrong groups of 2 people are measured only on organizations.
- **The full Search page** (`/finance/name-search`), which uses its own matching
  route.
- **Media buys search.** Spaces against hyphens in folder names are
  [issue 2908](https://github.com/alethical-org/alethical/issues/2908).
- **Identity confirmations.** People confirm identities record by record with
  quoted evidence; nothing there is automatic to score.
- **People and candidate pages** outside Finance search, and statewide candidates,
  who have no person-checked committee link yet.
