# Political mail analysis

Implementation owner: [Political mail text and evidence results](https://github.com/alethical-org/alethical/issues/2924), building on [private upload](political-mail-upload.md).

## Approved scope

Read both private photos, preserve the printed payer separately from any matched official identity, count matching mailers separately from submissions or people, and show source-supported records and connections. The 15 supplied mailer pairs allow extraction work to proceed. Recipient details and originals stay private. Existing upload wording and behavior remain unchanged.

## Build in progress

The `codex/mail-analysis` branch contains an additive private analysis table, local Tesseract extraction, bounded rotated/cropped reads, a durable background queue and owned results/retry routes. These changes are not deployed or enabled. Set `ALETHICAL_MAIL_ANALYSIS_ENABLED=true` only after migration and release checks. No request waits for OCR. No external OCR provider receives photos.

Machine-read words are not checked transcriptions. A detected disclosure retains its quote, photo side, bounding box and cutoff warning; absent words are never reconstructed from the registry. Exact official-name hits are candidates, not confirmed identity. A missing number is not zero. Automatic corroboration requires independent registration, domain or address evidence from an official source; unresolved cases remain uncertain.

## Remaining acceptance

- Improved local OCR evaluated all 30 originals, finding disclosure candidates on 9 sides; fine print and cropped words remain incomplete, especially pair 3 back
- 27 focused extraction, ownership, retry and upload tests pass; successful-side text is retained on retry
- Add source-corroborated matches and useful existing-record connections; verify matches against official evidence
- Establish explicit matching-creative evidence and counts; do not count name matches or people
- Complete independent correctness/security review and queue recovery tests
- Have Design review results layout and copy, then build and review responsive results states
- Run current-main checks, merge, deploy, enable and verify actual private results

Parent owns final acceptance and Design coordination. Separate upload-speed work owns the storage implementation; this build does not alter it.

## Creative counts

A creative/version group counts saved submissions, excluding explicitly tagged
synthetic records. Network retries reuse the submission identifier; separate
submissions remain separate counts. This is not a count of people, households,
physical pieces or delivered mail. Both sides and substantive content must agree;
a changed payer or substantive version stays separate. A missing group has an
unknown count, not zero. The private administrator assignment route retains its
comparison evidence and change history. The initial 15 pairs were visually reviewed
as distinct; their actual assignments and live counts remain release work.

The assignment route is `PUT /api/v1/admin/mail-upload/submissions/{id}/analysis/creative`.
Its optional `matching_submission_id` points to an existing compared group; otherwise
it assigns the submission's own stable group. `excluded_from_counts` explicitly marks
synthetic data. `evidence` records the two-side/payer/version comparison. This does
not establish an official payer match. Automatic creative comparison remains unfinished.
