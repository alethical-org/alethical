---
name: requirement-coverage
description: Use before merging work that delivers an issue's or brief's acceptance criteria. An independent reviewer maps each accepted requirement to evidence suited to it and records verified, implemented but unverified, partial, missing or not applicable for the reviewed head commit.
---

# Requirement coverage record

`.claude/rules/workflow.md` rule 10 ("How to verify a merge, in order") calls this before
merge. The independent reviewer already working on the change writes the record;
otherwise the lead starts 1 helper for it. The lead resolves every finding.

## Inputs the lead passes

- The issue or brief, its relevant comments and linked requirements.
- The latest scoped approvals, including any given only in chat.
- The head commit under review and the verification evidence so far.

The reviewer may read callers and dependencies beyond the changed lines.

## The record

Use the repository's own requirement IDs where they exist. For each accepted
requirement, give 1 status with its evidence:

- **Verified**: evidence suited to the requirement. A test for logic; browser, keyboard,
  layout or live output for runtime behaviour.
- **Implemented but unverified**: the code exists, the suited evidence does not. A code
  line proves this status only.
- **Partial**, **missing** or **not applicable**, each with the reason.

Standing requirements (bad input and failure handling, accessibility, safety, privacy)
count even when the issue omits them; they are never extra scope. List work nobody
asked for separately as extra scope.

The record names the commit it covers. After any later commit, revisit the rows that
commit affects. Put the record in the pull request body or a comment on it.
