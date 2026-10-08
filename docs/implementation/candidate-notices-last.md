# Candidate result notices, 2 October 2026

Approved scope after review of source limits: notice placement and empty-race wording, without interfering with the separate candidate lookup work;
the separate candidate lookup task owns saved-address and disappearing-results fixes.

Accepted download: Alethical UX (53).zip, completed 2 October 2026 at 10:32 local
filesystem time, SHA-256 `33841c15aa5a06d41e6ac47378d13307f54ab863fe32d893b555bb688906ee80`.
Design: exports/design_review_candidates/Candidates search.dc.html and the final
2 October sections of build-facts-candidates.md and review-prompt-candidates.md.
Earlier contradictory notes are superseded by those sections. No new drawing needed.

The connected Minnesota MyBallot response does not establish completeness by office
or group. Alethical adds a general local-office warning to each successful lookup.
Named gaps carry no group or race identifier; do not infer one from their wording.
Empty candidate rows do not establish that nobody filed.

## Design comparison and acceptance

All checks cover the public visitor at desktop 1280px, tablet 900px and phone 390px.
The existing 19047 preview is owned by candidate lookup; do not edit its checkout or
restart it. Use isolated http://localhost:19057/candidates for this scoped build,
then check https://www.alethical.com/candidates after release. Coordinate the landed
commit with candidate lookup so it can safely incorporate the change at 19047.

| ID | Starting state and expected result | Evidence/status |
| --- | --- | --- |
| N1 | Successful general results: one About these results box after the actual last race group, in the races column; aligned to cards, 40px above box | Pass: rendered preview at all 3 widths, exactly 40px, aligned edges |
| N2 | Successful primary results: same placement after its actual last group; no assumed Other local group | Pass: primary ends at School board, 40px at all 3 widths |
| N3 | Box retains fill #f2f4f3, 1px rgba(17,21,15,0.08) border, radius 14px, padding 18px; heading 18px/800; Libre Franklin | Pass: computed styles match every listed value at all 3 widths |
| N4 | General warning appears once in box; named gaps and their official links stay there; disclaimer and sample-ballot link remain together | Pass: focused rendered tests cover generic + named warnings and links; browser covers named gaps |
| N5 | Nothing about coverage before races; no added jump button; box has a heading association | Pass: browser and rendered tests; single named region after groups |
| N6 | Checked date and stale warning stay with their group/race, including differing dates; collapse and jump controls remain functional | Pass: dates, collapse and jumps in browser; matching/differing stale flags in rendered tests |
| N7 | Empty ordinary and Judges race cards: No candidates listed / The source lists no candidates for this race | Pass: ordinary empty card in browser; ordinary and Judges rendered tests |
| N8 | Successful search with zero races still shows the box; first load, initial failure and no upcoming election hide it | Pass: empty and initial failure in browser; loading and no-election rendered tests |
| N9 | Retained results during updating and failed replacement keep their notices with the old result; updating/failure controls stay beside search controls; retries remain usable | Pass: independent slow/failure/retry browser checks and rendered tests |
| N10 | Box links retain hover and visible keyboard focus; wrap at phone widths without horizontal overflow; sample-ballot link has its approved destination | Pass: browser hover/focus/destination and no overflow at all 3 widths |

## Delivery sequence

1. Independent coverage review of the accepted drawing and comparison above: accepted with no missing requirement before implementation.
2. Scoped component changes, existing tests plus meaningful result-state coverage.
3. Browser comparison, independent acceptance, current-head checks and merge.
4. Live result check, evidence update, notify candidate lookup of landed commit.

No production data writes, real claims, messages to readers, or sign-in checks are
needed. No new source, data classification or group-level warning is authorized.

## Build evidence

The owner inspected the rendered drawing and built result. At 1280px, 900px and
390px the notice follows the final group with exactly 40px space, its left edge
matches the results, and there is no horizontal overflow. Browser-computed styling:
18px padding, 14px radius, 1px rgba(17,21,15,0.08) border, rgb(242,244,243)
background, Libre Franklin heading at 18px/800. Named-gap copy wraps without clipping.
Screenshots retained with task review evidence under /tmp/alethical-notices-4e26/.
Type checks pass. The scoped design detector reports no findings.
40 focused tests pass, including general/primary/empty successful results,
initial loading/failure/no-election, ordinary and Judges empty races, and existing
retained-result flows and matching/differing stale flags. Independent browser acceptance passes. Live release remains pending.


Independent acceptance found the Election popup behind the race links at 900px:
the controls and races are sibling stacking contexts, both initially z-index 0.
Moving the notice away exposes the overlap. The controls container now has
z-index 1, preserving the existing popup appearance while placing it above results.
This implements the drawn open menu; no new visual choice or drawing is needed.
Pointer and keyboard checks pass at all 3 widths; phone touch selection passes too.
Reproduce with `node apps/frontend/scripts/check-candidate-result-notices.mjs`
against the local candidate preview.


## Impact and prevention

- Cause/evidence: shared coverage preceded results on phones; a generic source limit cannot identify specific missing groups. Moving it exposed the election menu beneath the following results container.
- Actual affected uses: CandidateCoverage is used only by CandidateSearchContent. CandidateRaceCard supplies ordinary and nested Judges empty cards. CandidateSourceLine is reused by results and profiles; its source/date/stale behavior is unchanged. The election selector is local to this search.
- Approved differences: generic and named gaps stay at response level; dates and stale flags remain record-specific and share only when all source facts match. Successful zero-race results retain notices; initial loading/failure/no-election do not.
- Shared correction: move the existing notice once, change the common empty-race wording, and raise the search-controls container above the result column so the existing menu works at narrow widths.
- Prevention: replaced an obsolete heading-order assertion that passed on missing text; new checks require the notice to exist and follow the final candidate. Rendered result-state tests cover notice scope, empty ordinary/Judges races, stale source sharing, and retained results. The browser regression exercises real pointer/touch election choices at all layout bands, notice spacing and overflow. Existing profile tests cover the reused stale-source line.
- Remaining uncertainty: fictional preview records demonstrate rare states; live source data determines available groups. No missing office is inferred. Live release evidence will be attached to the pull request after deployment.
- Owner and completion: Locate candidate notice data owns this authorized notice build and live check. candidate lookup owns saved-address/results-reset work and the 19047 preview. Send the landed change to that owner for safe integration without overwriting its work.
