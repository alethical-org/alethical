# Political mail analysis

Implementation owner: [Political mail text and evidence results](https://github.com/alethical-org/alethical/issues/2924), building on [private upload](political-mail-upload.md).

## Approved scope

Read both private photos, preserve the printed payer separately from any matched official identity, count matching mailers separately from submissions or people, and show source-supported records and connections. The 15 supplied mailer pairs allow extraction work to proceed. Recipient details and originals stay private. Existing upload wording and behavior remain unchanged.

## Live backend and remaining acceptance

The backend runtime repair is live at `39779f404f58ea15fe585bb96716c1a3f191fa1b` with migration `0091_mail_analysis`, and analysis is enabled. It includes a private analysis table, local Tesseract extraction, bounded rotated/cropped reads, a durable background queue and owned results/retry routes. Initial activation exposed a missing production OCR dependency: Railway uses Railpack, not the local Dockerfile. The dependency is now present in the live runtime, verified through the enabled worker’s bounded startup check; initial empty reads were recovered after that proof. The active Railpack configuration includes Tesseract English, and the enabled worker checks the executable and language data before claiming work. A missing reader leaves the queue unclaimed and uploads available. No request waits for OCR. No external OCR provider receives photos.

Machine-read words are not checked transcriptions. A detected disclosure retains its quote, photo side, bounding box and cutoff warning; absent words are never reconstructed from the registry. Exact official-name hits are candidates, not confirmed identity. A missing number is not zero. Automatic corroboration requires independent registration, domain or address evidence from an official source; unresolved cases remain uncertain.

## Acceptance progress

- Local OCR evaluated all 30 originals; detected disclosures on 9 sides in the initial pass. Final visual review found further readable disclosures, so production coverage must be compared with that private review; cropped or soft words remain unknown
- 37 analysis tests pass, including useful text and records retained after failed retries; 22 upload tests passed with the prior analysis head
- Official-source corroboration and existing public receipt/payment records are implemented, with uncertain registration matches kept separate
- Reviewed creative groups and exact-original inheritance are implemented; near-image hints cannot establish a group
- Independent backend review passed the queue, access and matching checks; the final public-record retention correction passed its separate targeted review
- Responsive results Design and frontend are separate work owned by the parent
- Backend and runtime repair passed CI and deployed; hash-checked initial groups and runtime recovery are complete. Initial live coverage is recorded below. The bounded angled-disclosure correction, its targeted live recovery and final frontend acceptance remain open

Parent owns final acceptance and Design coordination. Separate upload-speed work owns the storage implementation; this build does not alter it.

## Creative counts

A creative/version group counts saved submissions, excluding explicitly tagged
synthetic records. Network retries reuse the submission identifier; separate
submissions remain separate counts. This is not a count of people, households,
physical pieces or delivered mail. Both sides and substantive content must agree;
a changed payer or substantive version stays separate. A missing group has an
unknown count, not zero. The private administrator assignment route retains its
comparison evidence and change history. The initial 15 pairs were visually reviewed
as distinct and assigned separate groups after all saved original hashes matched. Five known synthetic submissions are explicitly excluded. The application preserved the original upload rows; private before/after evidence and a guarded grouping rollback remain available.

The assignment route is `PUT /api/v1/admin/mail-upload/submissions/{id}/analysis/creative`.
Its optional `matching_submission_id` points to an existing compared group; otherwise
it assigns the submission's own stable group. `excluded_from_counts` explicitly marks
synthetic data. `evidence` records the two-side/payer/version comparison. This does
not establish an official payer match. Identical front/back originals can inherit an existing reviewed creative decision.
Near-image comparison is a private administrator hint only; new or ambiguous
recaptures remain unassigned. Reviewed-reference changes recheck derived matches,
including exclusions and contradictory groups. Reliable recapture classification
remains unfinished.

## Public record response

Each payer keeps its exact machine-read quote separate from `official_organization`,
`candidates` and `related_records`. A checked organization is not a checked funding
account. Each candidate/related registration may carry `records`: published snapshot,
year, fetched date and independent `received`, `paid`, `independent_spending` blocks.
Each block retains its existing public-reader state, official source URL, record
numbers, payment dates, exact decimal amounts, total rows and `has_more`; only the
latest 5 rows are embedded. An unavailable block never becomes zero. These rows
show that registration's activity, not who funded an individual mailer. Only existing
public campaign-money services are used; protected Finance research is not exposed.
At most 3 registrations are read per analysis, each database statement bounded to
10 seconds. Further alternatives say `not_loaded`.

Read-only production inspection found useful 2026 records for Restore Sanity (21
receipt rows, 71 outgoing rows, 71 independent-spending rows), Our America Minnesota
Political Fund (26 receipt rows, no reported outgoing block, 26 independent-spending
rows), and Heintzeman (Keri) for Senate (59 receipt rows, 8 outgoing rows, no reported
independent-spending block). Overlapping blocks must never be added together.
These findings do not confirm which candidate registration paid for a mailer.

## Processing bounds and recovery

The 30-original local evaluation took 173.6 seconds summed across photo reads
(3.2–8.9 seconds per photo). The production worker processes one saved submission
at a time per API process, outside upload requests; initial 15-pair processing is
host-dependent. The initial production batch took 607.5 seconds (10.1 minutes), with early
pairs taking 29–46 seconds including storage and record reads.
No artificial wait is added. Oldest saved submissions are claimed first. A
later OCR failure retains earlier usable text and crop evidence with a partial
reason. Transient record failures make the result retryable without rereading
successful photo sides. A failed record refresh retains available evidence only for the same printed payer, registration, scope, source and year, with `refresh_failed: true`; its original snapshot and fetched date remain unchanged. Historical scratch reads are not seeded into production:
they lack the final reader-version and provenance checks. Exact originals remain
unchanged. `tesseract-english-v3` adds one bounded sparse-column fallback for unresolved or
low-confidence disclosure crops. Vertical context preserves angled lines; aligned
continuations keep joint payer names together and omit neighboring postage columns.
It adds at most one subprocess per anchor, bounded to 10 seconds within the same
90-second image deadline and 3-anchor limit. Crop source bounds, deskew angle,
segmentation mode and newly measured confidence remain attached to the quote.
A partial hint alone never becomes a payer without a newly read paid-for-by line.
A separately read street-address, PO-box or website line ends the extracted name;
the full quote still retains that evidence. Number-bearing and joint payer names
remain intact.

## Release and initial review

The additive backend may merge and deploy after backend acceptance, independently
of the results interface. Deploy its migration and image with analysis disabled. Prepare a private JSON review manifest outside
Git containing each saved submission ID, exact `front_sha256` and `back_sha256`,
`excluded_from_counts`, and the two-side/version comparison `evidence`. The 5 retained
synthetic receipts identify excluded records; no reaction-based heuristic is used.
The 15 visually distinct real pairs each receive their own reviewed creative group.

Run `uv run python scripts/mail_analysis.py --target production --manifest /private/path/review.json`
for hash-checked dry run, then the same command with `--apply`. It validates every
saved/verified pair before writing only analysis grouping metadata in one transaction.
It never writes image rows, bytes, reaction or comments. Repeating a decision is
idempotent; correction history remains private. Keep the private manifest as evidence.
After backend checks, live migration verification and the hash-checked manifest pass,
analysis may activate while the results interface finishes. Enable
`ALETHICAL_MAIL_ANALYSIS_ENABLED=true`; saved rows are queued automatically,
so no separate OCR backfill command is needed. Use existing administrator result
routes for the old sessions, whose private uploader tokens are not recoverable.
Verify the initial 20 saved analysis rows, their 5 exclusions and 15 real results and source/partial
states against the private originals. Disable the flag to stop new claims; retain
results and originals. No deletion or destructive migration is part of release.

## Initial live evidence

Migration 0091, private hash-checked grouping and enabled local OCR were verified
on the live service. All 15 initial real pairs produced text on both sides; none
is certified character-complete. Initial payer excerpts appeared for 9 of 15,
including several malformed readings that remain uncertain. Each of the 15
visually distinct creative groups counted 1 saved submission; 5 known synthetic
submissions were explicitly excluded. Original image and submission rows were
unchanged by grouping and recovery.

Bounded local checks of the changed reader recovered 3 readable angled disclosures,
including a joint payer, while other malformed and clipped disclosures remained
unresolved. After the corrected reader deploys, only the 3 proven improved sides
are eligible for guarded recovery: private original-hash and prior-result checks,
backup, dry run, then preserve the successful opposite side, grouping and prior
public evidence. Do not treat processing completion as a complete transcription or
manually fill missing words. Production recovery and final coverage remain to be
verified; private reports retain exact quotations and remaining limits.
