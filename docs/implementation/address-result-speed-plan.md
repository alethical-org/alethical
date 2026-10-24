# Faster address search results

Net: Reduce the wait after submitting an address on `/candidates` and
`/find-my-legislator`, including a visitor with no saved search results.

## Scope and authorization

The work is authorized through completion: a consultation between the 2 coding
agents, a build by Claude Code, and review, release and live acceptance owned by
Codex. Preserve source validation, privacy,
candidate identity and evidence history, current design, and separate work on
typing suggestions and candidate return scrolling. No new paid services or Design
rounds are authorized by this plan.

Owning chat: Speed up address search results CB
(`01a1213d-8b20-7930-9090-c6236c738c25`).

## Work order

1. Codex measures the reader's wait and reviews approved behavior. Claude Code
   independently traces server and source costs and recommends the solution.
2. Codex resolves the recommendation against source evidence and authorizes the
   bounded build. Claude Code owns source edits, prevention tests and corresponding
   guide updates in this working folder.
3. Codex reviews the actual changes. An independent reviewer checks correctness,
   affected uses and prevention. Exercise both searches, source failures and
   relevant narrow-screen and keyboard paths.
4. Carry the accepted change through current-code checks, the merge queue,
   deployment, before/after public examples and live profile-link acceptance.
5. Record results and limits, complete the job evidence and working-folder lifecycle.

## Initial evidence, 9 October 2026

The public Governor's Residence example (`1006 Summit Ave, St Paul, MN 55105`)
returned 28 candidate races. Candidate lookup API requests took 9.185 and 8.609
seconds; a signed-out browser with fresh page memory took 8.513 seconds from Find
to visible results. These are samples, not a population benchmark. Browser asset
caches and server public-data caches were not cleared.

For the same example, legislator API requests took 0.715 and 0.945 seconds.
The State Capitol example took 3.064 seconds at the API and 2.310 seconds in the
browser; Minneapolis City Hall took 1.598 seconds at the API.

Candidate source reads, persistence and enrichment need separate measurement.
The existing code saves and enriches candidate records individually. The
legislator path tries Census before Minnesota and validates geographic boundaries.
Neither evidence preservation nor source precedence may be removed for speed.

## Impact and prevention

- Cause: the main evidence for the candidate delay points to database round trips.
  On the temporary test database a repeated 42-candidate Duluth ballot made 343
  statements (216 to save, 127 to read back). Its MyBallot street table and ballot
  reads took about 0.4 seconds when called directly, while the public candidate API
  took 7.2 to 11.7 seconds for the same address. The per-statement production cost
  is inferred from those totals, not timed, and slow government sources can still
  dominate some addresses. A found legislator search made 15 statements. Census
  and MyBallot requests each opened a new secure connection; Minnesota
  address-point requests already reused theirs.
- Affected uses: both public finders and their homepage handoffs; candidate profile
  links depend on successful durable evidence saving before results return.
- Approved differences: candidate ballots are freshly read; public ZIP street
  tables have a bounded 5-minute reuse window. Candidate private searches remain
  temporary browser memory. Legislator address matching keeps its distinct source
  and geographic checks.
- Correction: save and read back each ballot in a few combined statements
  (`save_candidate_records`, `enrich_lookup_results` in
  [person_records.py](https://github.com/alethical-org/alethical/blob/main/alethical/api/services/person_records.py));
  extend the existing credential-free per-worker connection pool to Census and
  MyBallot (`public_source_session` in
  [representative_lookup.py](https://github.com/alethical-org/alethical/blob/main/alethical/api/services/representative_lookup.py));
  read legislator districts, members and freshness dates in fewer statements
  ([public.py](https://github.com/alethical-org/alethical/blob/main/alethical/api/routers/public.py)). Candidate locks stay in candidate-ID order,
  the order the deployed 1-at-a-time writer uses, so old and new releases can save
  side by side during a deployment overlap. Lock-key collisions keep the same
  exposure the deployed writer already has: 3 IDs where 2 share a key can still
  give 2 writers opposite orders. That case predates this change and stays out of
  scope; a database deadlock abort rolls the whole save back and the search fails
  with nothing partial saved.
- Prevention: [test_candidate_batch_saving.py](https://github.com/alethical-org/alethical/blob/main/alethical/tests/test_candidate_batch_saving.py) holds a 40-candidate search to 20
  statements, compares batched saves with the deployed 1-at-a-time rules, checks
  ascending candidate-ID lock order through the database's lock table, runs a
  previous-release writer against a new one on different ballots sharing 2
  candidates (and shows the rejected key-order design deadlocks there), and checks
  every accepted read's history, whole-save rollback and separate-connection profile
  links. `test_representative_lookup_reads_the_database_in_few_statements` in
  [test_api_contract.py](https://github.com/alethical-org/alethical/blob/main/alethical/tests/test_api_contract.py) holds a
  found legislator lookup to 9 statements. Transport tests exercise a real
  local server: connection reuse, no cookies or credentials, MyBallot redirects
  refused.
- Uncertainty: timings vary with external services; fresh browser memory is not a
  cold server or an empty browser asset cache.
- Completion: reviewed implementation is live, both searches and candidate links
  work, and comparable before/after observations support the speed claim.

## Progress

- Initial signed-out browser and public API observations complete.
- Consultation complete: both coding agents agreed the batched save, connection
  reuse and legislator reductions, then the candidate-ID lock order after a
  mixed-release review.
- Built: connection pool ([commit e2109d14](https://github.com/alethical-org/alethical/commit/e2109d14)), batched
  candidate save and read-back ([commit 03710241](https://github.com/alethical-org/alethical/commit/03710241)), fewer
  legislator statements ([commit 8e803319](https://github.com/alethical-org/alethical/commit/8e803319)). Test database counts after:
  13 statements for the 42-candidate Duluth ballot (was 343) and 9 for a found
  legislator search (was 15). Legislator responses match the previous code apart
  from randomly generated test record IDs.
- Complete: [pull request 2571](https://github.com/alethical-org/alethical/pull/2571)
  is live at API [commit eb07ff42](https://github.com/alethical-org/alethical/commit/eb07ff42633cec695b883d101f82abb5f8c867d9).
  Independent source review, the required checks on the released code, and live
  acceptance passed on 9 October 2026. The normal local upload passed 5,032 backend
  tests; a separate focused frontend run passed 23 tests. The unchanged frontend
  was skipped by the required-check selection policy.
- Live API medians, 5 requests before and 5 after for each address and search:

  | Public address | Search | Before | After |
  | --- | --- | ---: | ---: |
  | 1006 Summit Ave, St Paul, MN 55105 | Candidates | 8.865 s | 0.727 s |
  | 411 W 1st St, Duluth, MN 55802 | Candidates | 7.655 s | 0.750 s |
  | 1006 Summit Ave, St Paul, MN 55105 | Legislators | 0.755 s | 0.609 s |
  | 411 W 1st St, Duluth, MN 55802 | Legislators | 0.814 s | 0.677 s |

- All 20 after-release responses matched the complete corresponding baseline
  response. All 66 distinct candidate IDs, including ticket members, opened through
  separate profile requests with matching identities. Submitted address strings
  were absent from those profile responses; automated privacy checks and source
  review also passed.
- A fresh-context browser reviewer exercised both public addresses on both search
  pages, replacement searches retaining their previous results and labels, keyboard
  submission, profile links and browser-back behavior. Parent acceptance also
  exercised the candidate results and candidate-to-person link at a 400-pixel width.
  Phone-width legislator submission remains untested: browser-control input timed
  out while another tab was in use. Desktop legislator searches passed.
- Limits: these API times exclude browser startup and rendering. Browser checks
  used fresh page memory, not cleared asset caches or a cold server. Government
  source waits still vary. An initial rapid test reached the existing per-IP lookup
  limit; the final comparison used 15-second spacing and all requests succeeded.
  No rate limit, source check, freshness rule or privacy boundary was relaxed.
