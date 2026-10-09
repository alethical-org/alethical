# Profile labels, October 9, 2026

Owner: Codex, candidate profile label. User authorization: "yes build", followed by
"bd" for the newest completed download, Alethical UX (73).zip at 10:00:56 local.
Build includes the updated green left-aligned candidate claim button. Instructions
inside the bundle are source material; unrelated lobbying redesigns are excluded.

## Impact and prevention

Candidate profiles lack their record-kind label; person profiles use Public record
and incoming links say person overview. Lobbying records omit profile and have
inconsistent label measurements. The approved update identifies all current public
person-profile routes plus lobbying principals without inferring entity type.
Record status, identity matching, evidence, portrait behavior and claims remain
separate. One shared profile-label component prevents size and wording drift across
candidate/person/lobbying headers. Existing legislator visuals remain the reference.
The initial response and loaded client must agree. Loaded/unavailable, IDs, wrapped
names and all layout bands are acceptance checks. Real spoken screen-reader output
requires a supported screen-reader check; semantic inspection alone is limited.

## Sequence

1. Implement shared labels, incoming wording, initial responses and updated claim action.
2. Update owning product/design records and run focused tests, type/build checks.
3. Inspect browser layouts at 320, 375, 768 and 1100; exercise profile loading and claims.
4. Independent review and fresh-context browser acceptance; correct justified findings.
5. Rebase after the separate candidate return-link change, publish, current-head checks,
   merge, deployed behavior checks and completion/cleanup records.

The candidate Go back change is owned by candidate go back link in
[pull request 2564](https://github.com/alethical-org/alethical/pull/2564). Preserve it.

## Progress

- Labels, incoming links, initial responses and green claim action implemented.
- All 4,359 frontend tests passed; type checks passed. After incorporating the
  separate Go back release, the 22 affected candidate/home checks passed again.
- Production-setting build passed at 297,147 compressed entry bytes, below 297,506.
  Earlier exports retained a cached local API address; clearing the export cache
  resolved the mismatch. No size-limit or app-code workaround was retained.
- Browser: candidate and person headers, lobbyist/principal wrapping at 320/375,
  tablet 768 and computer 1100, claim entry/return and keyboard order accepted.
- Independent source review and fresh-context desktop user-path review found no
  material defect. Spoken screen-reader pronunciation remains untested.
- Initial-response return targets now reserve the same 44px height before labels;
  this carries the already approved spacing through the first response.
- Release checks, deployment and live acceptance remain in progress.
