# Lobbyist donation proof implementation

User authorization: build the general missing-amount repair, independently review it,
coordinate other tasks, release safely, and report before/after supported amounts.

## Sequence and ownership

1. Pin baseline and source versions. Done: 1,665 current lobbyists; 2025 has 136 supported,
   105 unavailable and 1,424 without matching records; 2024 has 131 supported,
   100 unavailable and 1,434 without matching records. Local detailed baseline is
   `/tmp/lobbyist-donation-proof-run/before.json`.
2. Build a fail-closed report transaction reader and tests. Independent internal worker
   owns `lobbyist_report_evidence.py` and its test file.
3. Build source collection, donor multiset comparison, versioned publication and API
   integration in the main task. Keep original payment rows unchanged.
4. Collect bounded official evidence for affected recipient-years. Reuse exact saved
   documents when their effective version is established; retain new documents and
   catalogue responses. Test special/regular period assembly without changing old
   recipient-wide comparison verdicts.
5. Integrate completed Money + Lobbying UX disclaimers changes before adapting shared
   wording. That task owns its present source-date and record-count build.
6. Independently review the implementation and evidence, fix findings, run focused and
   required checks, exercise profile and directory in the browser.
7. Publish reviewed proof atomically after the code release, validate live results,
   compare pinned before/after coverage and record remaining causes.

## Publication requirements

Proof binds the exact contribution snapshot, current filing snapshot, effective report
versions, coverage periods, parser version and unchanged raw row identities. Complete
known donor transaction multisets must match by recipient, date, signed cash/in-kind
amounts and multiplicity. Explicit official lobbyist identity can associate a held row
with a missing registration number; name alone cannot. A contradictory donor proof
wins over a recipient-wide pass. Unknown or absent amounts remain distinct from zero.
Directory sums and profile rows consume the same active proof.

## Holds

The historical full replacement in issues
[2142](https://github.com/alethical-org/alethical/issues/2142) and
[2150](https://github.com/alethical-org/alethical/issues/2150) remains held.
Do not run or modify it, manufacture a missing response, or replace published totals.
The task (legislator campaign money) confirmed this hold and no active production work.

## Checkpoints

- Owned worktree: `/Users/eug/.codex/worktrees/lobbyist-donation-proof/Alethical`.
- Branch: `codex/lobbyist-donation-proof`.
- Campaign release: `af236cca-a4f8-4efe-9a3a-025259ea380e`.
- Lobbying release: `70f958f3-e559-4b1b-8cc0-1edd60422799`.
- Local evidence and run outputs: `/tmp/lobbyist-donation-proof-run/`.

## September 19 implementation checkpoint

- Parser, collector, known-period coverage, donor matching, additive storage, directory
  and profile integration are implemented. Source rows remain unchanged.
- Integrated the completed Money + Lobbying UX disclaimers change at
  `46d94aa0bf5d94c7abbb43325e2d139afdc88790`. Its follow-up changes only `/money/payments`.
- Independent reviews covered parsing, period coverage, storage and publication.
  Closing final refresh gaps: retain known donor relationships after failed evidence
  refresh or changed filing snapshot; reject concurrent publication that would forget them.
- Latest trial: 2024 supports 222 amounts versus 131 before; 2025 supports 220 versus
  136 before. Gross new amounts: 182; newly withheld: 7; net increase: 175. Provisional
  until the exact reviewed proof is published and live counts are measured.
- Ward Einess and Joel Carlson have supported 2024 amounts. Ward's 2025 report contains
  a payment missing from the held download. Joel's 2025 file contains a payment dated
  2026. Both 2025 amounts remain unavailable; do not manufacture or re-date rows.
- All 3,476 frontend tests pass. Full backend run had only 3 missing script-inventory
  failures, since repaired. Rerun the full backend after final refresh fixes.
- Code release, proof publication, final independent browser review and live before/after
  report remain. No production source or evidence pointer has been changed by this task.
