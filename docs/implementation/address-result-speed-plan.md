# Faster address search results

Net: Reduce the wait after submitting an address on `/candidates` and
`/find-my-legislator`, including a visitor with no saved search results.

## Scope and authorization

Eugene requested direct Claude Code consultation, followed by Claude Code building
the agreed solution under Codex oversight through completion. This includes the
normal tested release and live acceptance. Preserve source validation, privacy,
candidate identity and evidence history, current design, and separate work on
typing suggestions and candidate return scrolling. No new paid services or Design
rounds are authorized by this plan.

Owning chat: Speed up address search results
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

- Cause: database round trips, not the government sources. On the temporary test
  database a repeated 42-candidate Duluth ballot made 343 statements (216 to save,
  127 to read back); its MyBallot street table and ballot reads took about 0.4
  seconds directly, while the public candidate API took 7.2 to 11.7 seconds. The
  per-statement production cost is inferred from those totals, not timed. A found
  legislator search made 15 statements. Every government source request also
  opened a new secure connection.
- Affected uses: both public finders and their homepage handoffs; candidate profile
  links depend on successful durable evidence saving before results return.
- Approved differences: candidate ballots are freshly read; public ZIP street
  tables have a bounded 5-minute reuse window. Candidate private searches remain
  temporary browser memory. Legislator address matching keeps its distinct source
  and geographic checks.
- Correction: save and read back each ballot in a few combined statements
  (`save_candidate_records`, `enrich_lookup_results`); share 1 credential-free
  connection pool per server worker for Census, Minnesota address points and
  MyBallot (`public_source_session`); read legislator districts, members and
  freshness dates in fewer statements. Candidate locks stay in candidate-ID order,
  the order the deployed 1-at-a-time writer uses, so old and new releases can save
  side by side during a deployment overlap. Lock-key collisions keep the same
  exposure the deployed writer already has: 3 IDs where 2 share a key can still
  give 2 writers opposite orders. That case predates this change and stays out of
  scope; a database deadlock abort rolls the whole save back and the search fails
  with nothing partial saved.
- Prevention: `test_candidate_batch_saving.py` holds a 40-candidate search to 20
  statements, compares batched saves with the deployed 1-at-a-time rules, checks
  ascending candidate-ID lock order through the database's lock table, runs a
  previous-release writer against a new one on different ballots sharing 2
  candidates (and shows the rejected key-order design deadlocks there), and checks
  every accepted read's history. `test_representative_lookup_reads_the_database_in_few_statements`
  holds a found legislator lookup to 9 statements. Transport tests exercise a real
  local server: connection reuse, no cookies or credentials, MyBallot redirects
  refused.
- Uncertainty: timings vary with external services; fresh browser memory is not a
  cold server or an empty browser asset cache.
- Completion: reviewed implementation is live, both searches and candidate links
  work, and comparable before/after observations support the speed claim.

## Progress

- Initial signed-out browser and public API observations complete.
- Consultation complete; Codex accepted the batched save, connection reuse and
  legislator reductions, then the candidate-ID lock order after a mixed-release
  review.
- Built: connection pool (e2109d14), batched candidate save and read-back
  (03710241), fewer legislator statements (8e803319). Test database counts after:
  13 statements for the 42-candidate Duluth ballot (was 343) and 9 for a found
  legislator search (was 15). Legislator responses match the previous code apart
  from randomly generated test record IDs.
- Next: Codex review, merge, deployment and live before/after timings. Live
  speed is not yet measured and is not claimed.
