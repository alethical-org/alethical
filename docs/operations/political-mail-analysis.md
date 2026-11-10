# Political mail analysis

Implementation owner: [Political mail text and evidence results](https://github.com/alethical-org/alethical/issues/2924), building on [private upload](political-mail-upload.md).

## Approved scope

Read both private photos, preserve the printed payer separately from any matched official identity, count matching mailers separately from submissions or people, and show source-supported records and connections. The 15 supplied mailer pairs allow extraction work to proceed. Recipient details and originals stay private. Existing upload wording and behavior remain unchanged.

## Build in progress

The `codex/mail-analysis` branch contains an additive private analysis table, local Tesseract extraction, bounded rotated/cropped reads, a durable background queue and owned results/retry routes. These changes are not deployed or enabled. Set `ALETHICAL_MAIL_ANALYSIS_ENABLED=true` only after migration and release checks. No request waits for OCR. No external OCR provider receives photos.

Machine-read words are not checked transcriptions. A detected disclosure retains its quote, photo side, bounding box and cutoff warning; absent words are never reconstructed from the registry. Exact official-name hits are candidates, not confirmed identity. A missing number is not zero. Automatic corroboration requires independent registration, domain or address evidence from an official source; unresolved cases remain uncertain.

## Remaining acceptance

- Evaluate all 30 supplied originals and retain private per-side findings; especially cropped disclosure on pair 3 back
- Add source-corroborated matches and useful existing-record connections; verify matches against official evidence
- Establish explicit matching-creative evidence and counts; do not count name matches or people
- Complete independent correctness/security review and queue recovery tests
- Have Design review results layout and copy, then build and review responsive results states
- Run current-main checks, merge, deploy, enable and verify actual private results

Parent owns final acceptance and Design coordination. Separate upload-speed work owns the storage implementation; this build does not alter it.
