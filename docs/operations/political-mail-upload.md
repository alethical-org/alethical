# Private political mail upload

Owner: the political-mail demo build, [issue 2918](https://github.com/alethical-org/alethical/issues/2918), and private results, [issue 2924](https://github.com/alethical-org/alethical/issues/2924).

The political mail tool opens at [alethical.com/mail-upload](https://www.alethical.com/mail-upload) without an invitation or sign-in. Each browser tab starts an isolated session to save front/back photos, a required Yes/No reaction and an optional message. Public consumer login follows the demo. Part 2 is authorized for real mail: extract the printed payer, match directly to existing records and count matching mailers; then connect supported people, organizations, activities and transactions. No TVEyes dependency. An upload or reaction never establishes party affiliation, voting intention, delivery date, mailbox reach or guilt.

## Before enabling

The API is off unless `ALETHICAL_MAIL_UPLOAD_ENABLED=true`. Deploy migration `0090_mail_upload` before the API. The migration is additive; rollback the API or set the flag false to stop access without losing records. Do not downgrade a database containing uploads: downgrade drops the feature's tables and cannot undo remote writes.

1. Create a dedicated **private** Supabase Storage bucket and a dedicated **private** Cloudflare R2 bucket. Suggested names: `political-mail-originals` and `alethical-political-mail-backup`. Supabase public access must be false, with no anonymous or authenticated object policies. R2 must have no public development URL or custom domain. Do not reuse `raw-source-files` or the existing source archive mirror: those have different retention requirements.
2. Configure `MAIL_UPLOAD_SUPABASE_BUCKET` and existing server-only `SUPABASE_STORAGE_S3_*` credentials. Configure `MAIL_UPLOAD_R2_BUCKET`, `MAIL_UPLOAD_R2_ENDPOINT`, `MAIL_UPLOAD_R2_ACCESS_KEY_ID`, `MAIL_UPLOAD_R2_SECRET_ACCESS_KEY` with object read/write access scoped to the new bucket. Never put these credentials in frontend settings or committed files. Additional R2 storage cost was approved; no unrelated plan change is authorized.
3. Verify both buckets are private using their control planes and an unauthenticated request to a synthetic object. The S3 credentials alone cannot prove the bucket has no other public route. Keep the flag false until those checks pass.
4. Use synthetic photos to exercise exchange, both uploads, submit, retry and authenticated administrator download. Read both stored objects back and compare hashes. Test a failed R2 write and retry; the UI must retain the accepted photo until its replacement is verified in both stores.
5. Approved uploader-facing wording: “Your photos and comments stay private”. Real mail is authorized; the retention duration is not yet set. Originals can contain names, addresses, barcodes and photo metadata. This version preserves exact bytes privately and has no public/redacted derivative or customer export.

Supabase stores the database rows and primary originals. R2 stores a separately verified copy of each original. Supabase database backups do **not** include Storage object bytes. This feature does not create a second database backup in R2: restoring its database requires the existing database backup process. Both the database and image objects are needed for full recovery. No automatic purge is implemented and no retention duration is approved. Revocation stops access but does not delete either copy.

## Legacy invitation operations

Existing invitations still work for compatibility. The normal URL needs no setup. For legacy invitation management, run from the repository using its installed environment. `--target` defaults to local; production must be explicit and uses the project's existing database configuration. The create command writes a new mode-0600 JSON file outside the repo, never a token to stdout. Do not paste it into an issue or log.

```sh
uv run python scripts/mail_upload.py --target local create --output /private/tmp/jason-mail-invitation.json
uv run python scripts/mail_upload.py --target local revoke INVITATION_UUID
```

Default invitation lifetime: 7 days, 20 sessions and 512 MiB of reserved image-reference bytes. CLI bounds: 1–30 days, 1–100 sessions. Sessions expire after 24 hours or invitation expiry, whichever comes first. Revocation invalidates every session on the next authenticated action. Invite possession is access; an unlisted URL alone is not an access control. Put the invitation token in the frontend URL fragment, never its query string. The frontend clears it after capturing it and keeps credentials only in page memory. A shared invitation can create multiple isolated sessions; those sessions are not verified distinct people.

## API contract

All responses use `{ "data": ... }`. Private routes return `Cache-Control: private, no-store`. Tokens and photos are never returned in public URLs. Transport errors use the existing problem response format. Unknown or unowned submissions return 404.

| Request | Input | Result |
| --- | --- | --- |
| `POST /api/v1/mail-upload/sessions` | JSON random UUID `client_id` and random 32-byte `client_secret` encoded as 64 lowercase hex digits. Legacy callers may also supply `invitation_token`. | `token`, `expires_at`, `supported_content_types`, `max_image_bytes` |
| `PUT /api/v1/mail-upload/submissions/{uuid}` | Bearer session token; empty JSON | Existing or new draft |
| `PUT /api/v1/mail-upload/submissions/{uuid}/images/front` or `/back` | Bearer token; raw file bytes and Content-Type | Draft after verification of both copies |
| `POST /api/v1/mail-upload/submissions/{uuid}/submit` | Bearer token; JSON `likes_ad` boolean, optional `comment` up to 4000 characters | Saved submission |
| `GET /api/v1/mail-upload/submissions/{uuid}` | Bearer token | Current owned submission, for recovery after lost response |

The submission body contains `id`, `status` (`draft` or `saved`), `front` and `back` (null or `{sha256,content_type,bytes}`), `likes_ad` and `comment`. It contains no object key, image URL, recipient identity or inferred payer.

Use a fresh UUID per new submission and reuse it on retries. Retry session exchange with the **same client ID and client secret** (and the same invitation if one was used) to recover the same session token. Another secret cannot recover that tab's session. Retry image transfer with the same bytes. The pending row reserves quota and the same object key, so failure between primary and backup can be repaired without duplicating bytes or replacing an accepted side. The primary and backup copies upload and read back concurrently, using at most 2 storage workers per accepted image. Both read-back hashes must match before selection. A failed copy waits for the other worker to finish before releasing the temporary file and image gate; retry preserves the same object keys and quota reservation. Save freezes the selected sides; an identical submit retry returns the saved record, while changed content returns 409. Front and back upload sequentially because concurrent image decoding on one API process returns a retryable 429.

Validation: maximum 15 MiB per original, 51 million decoded pixels, JPEG/PNG/WebP/HEIC/HEIF; MIME and decoded format must match. The pixel ceiling accepts 50 MP camera output, including 8192 × 6144 (50,331,648 pixels). Missing browser MIME may use `application/octet-stream`. Reject invalid, truncated and animated non-HEIF images. HEIF's primary image is decoded, preserving all original bytes. No re-encoding, metadata removal or upload to an OCR service occurs.

## Limits and recovery

Database locks serialize quota reservations across API replicas. Global limits are 2 GiB of reserved image-reference bytes and 2,000 storage attempts; each invitation allows 400 attempts, its byte allowance and its session count. The plain URL uses a server-created quota record with a lifetime cap of 1,000 sessions, 512 MiB of reserved image-reference bytes and 400 storage attempts. No database migration or browser credential setup is needed. Each session expires after 24 hours and allows 25 submissions. Each new owned side reference reserves its full bytes, including when it reuses a physical file. Replacements and incomplete objects count toward storage. Successful identical image retries do not reserve bytes again. Global counters intentionally do not reset on application restart or invitation revocation. This conservative ceiling bounds abandoned/failed transfers as well as accepted images.

An additional per-process, per-IP limit defaults to 60 API calls/minute. It uses the project's trusted-proxy client address, not caller-controlled forwarding headers. This rate limit is a first-line throttle; the database counters are the cross-replica ceiling. Image reception is limited to 45 seconds and one in-flight decode/storage operation per process; storage network calls use bounded connection/read timeouts and retries.

On storage failure return 503 with no provider body and allow retry. A temporary outage preserves the old selected side. A proven read-back mismatch withdraws verification and selection from draft references to that key, under the submission lock; saved history and stored files remain unchanged. A verification generation prevents an earlier in-flight upload from restoring withdrawn confirmation. On a missing response the client can GET the owned submission before deciding to retry. No artificial success: `saved` requires both selected photos to have verified primary and backup copies. A subsequent external bucket deletion is outside that upload-time guarantee and needs normal backup monitoring.

## Administrator inspection

Existing administrator authentication and current authorization apply unchanged:

- `GET /api/v1/admin/mail-upload/submissions` returns the latest 100 drafts/saved records and timestamps
- `GET /api/v1/admin/mail-upload/submissions/{uuid}/images/{front|back}` downloads the selected original, checks its hash and returns an attachment with no-store and nosniff

Anonymous upload sessions cannot use these routes. All five tables have row-level security enabled, no browser grants, and no public policy. Server-side database access is required. Never infer unique contributors from anonymous sessions. Record total saved submissions, session count and eventual distinct creative count separately.

## Build checks

`uv run pytest alethical/tests/test_mail_upload.py` uses the repository's disposable PostgreSQL database, fake independent object stores, real API request handling and real image decoding. It covers byte identity, failed-copy recovery, retry conflicts, unauthorized access, revoked/expired invitations, quotas, raw-image bounds, HEIC, RLS, administrator access and save during replacement. Live S3 permissions and frontend device behavior require the deployment checks above.

## Demo screen

The approved Design source is `Mail upload.dc.html` in Alethical UX, with the November 9, 2026 handoff. The page stays outside navigation and search. It uses the shared header and footer, Front/Back photo controls, a required Yes/No reaction, and one optional message. Selected Yes/No uses Design’s optical balance: the center of the 18px check-and-label group sits 7px left of the control’s center, with an 8px gap and padding of 10px 26px 10px 12px. Unselected labels stay centered. This placement is specific to these controls, not a universal offset. “Optional” has its own line directly below the question at every width. The helper follows it and stays visible above the field: “e.g. thoughts about this mail or how our tool could be helpful”. The compact confirmation says “Saved”, with “Upload another”. Large green checks appear only after the server verifies both private copies; replacement failures preserve the previous accepted image and block final submission until resolved.

The approved value description is “See who paid for this and what public records show about them”. The upload page uses that description and shows private analysis after Saved. Real mail collection and analysis are authorized. Collection alone is not successful analysis. Fifteen supplied real mailer pairs support the analysis build; [analysis operations](political-mail-analysis.md) records the worker's actual release state.

The form appears while the browser opens an upload session. Its controls become available when the session is ready, with the layout held in place. The browser keeps images and comments in memory, so reload loses an unfinished form. Credentials also stay only in page memory; a reload opens a new session at the same URL. An unreadable or oversized photo offers “Choose another photo”; the rejected bytes cannot be retried. A transfer failure offers “Try again” with the same bytes. Both preserve any previously accepted photo and all feedback, and block final submission until the failed side is resolved. Uncertain final responses preserve the current form for retry. While a transfer is running, Submit and that side's replacement are disabled; the other side and feedback remain available. Final-submit retries retain the same identifier and answers, preventing duplicate saved submissions after a lost response. Some phone browsers offer only a file picker, so each photo button on a narrow or touch-first screen opens “Take photo” and “Choose photo”. The first requests the rear camera, and the second opens the native image picker. Desktop opens the native image picker directly. Check actual camera launch on iPhone and Android because the browser controls capture.

## Private results after Saved

The results use section 09 of the same Design file. Phone and tablet keep one column with 32px between Saved and results. At 1100px and wider, Saved is 360px, results are up to 720px, the gap is 56px, and their first card tops align. Results appear in this order: current reading/failure status, printed payer, public records or separate possible/related records, and collapsible Front/Back text under “Text from your mail”. Results arrival is announced without moving focus. A focused retry that disappears moves focus to its related result heading; a person who moved elsewhere keeps that focus.

After the server confirms save, the browser snapshots the submission ID, owned session token and the exact accepted File for each side. It polls the owned analysis GET every 2 seconds only while pending or processing, stopping at ready, partial or failed. Requests are aborted and late replies ignored on reset, session change or unmount. Retry uses the owned POST only while the server allows it, never inferring another attempt from local state. Successful text and prior public rows remain during retries. A transport retry refreshes GET instead of spending a processing attempt. See [analysis operations](political-mail-analysis.md) for the worker, 3-attempt limit and API.

“From the front” or “From the back” identifies the exact printed disclosure in curly quotation marks, beside View photo. Partial or unreadable text never becomes a complete-transcript claim. “No payer found” requires both sides to have been read and no disclosure; no general “No public records found” claim is made because the response does not prove a completed empty search. Name-only and similar-name registrations remain Possible matches; website evidence remains Related records; a name-and-address organization match does not identify a payer account.

Each registration keeps its source link, roles and separate Contributions, Payments and Independent spending groups. Each group shows up to 5 source rows with their full dates and sample coverage. Its year appears separately only when needed to understand that scope. Shared contributor, vendor, candidate and retrieval dates appear once where they apply to all displayed rows; meaningful differences remain beside their rows. Decimal strings remain exact in data and use the existing public money formatter for display. Missing amounts say “Not reported”; positive unpaid portions use the reported unpaid field. Groups with no held rows (`not_reported`) are omitted; unavailable groups show failure. Groups may overlap and are never added together. A failed refresh keeps prior rows and dates with “Couldn’t refresh these records”. Source links open a new tab with publisher and new-tab wording for assistive technology, no opener and no referrer.

Matching mailers is internal data and is not shown in results. Its count includes saved submissions assigned to the checked creative, excluding test records; it never counts people, physical pieces or delivery. Private result URLs carry no token, photo or personal data. No Share control or return-later history is offered.

View photo creates a temporary blob URL from the retained accepted File, without downloading an original from an API or changing its bytes. The dialog supports fit, zoom, pan, keyboard, touch, Escape and return focus. Inactive zoom controls remain in the Tab order with `aria-disabled`; they cannot act. Closing, reset and unmount revoke blob URLs. A missing or unreadable local file says “Couldn’t open this photo” with Close available. Reload cannot recover these page-memory files.

A known expired session blocks further analysis fetches and retries and offers Start again. Already displayed results and the owner's retained local photo remain until that reset. Start again and a real ownership change clear private state. Expiry does not make prior machine-read evidence newly public or erase the owner's local file.

Focused Vitest tests cover the owned API, private state, bounded retry, stale responses, file lifecycle, evidence wording and source rows. `e2e/mail-analysis-results.spec.ts` uses intercepted synthetic responses to exercise real-browser focus, retry recovery, photo controls, reset and 200% text. Run it only against a local preview with `E2E_BASE_URL`, alongside the rendered phone/tablet/desktop review; it does not call production.

## Exact-file reuse

Migration `0092_mail_file_reuse` permits separate private image references to share
an object key. Matching uses exact SHA-256, byte length, media type and dimensions;
a different photo of the same mailer remains a different file. Each fresh submission
keeps its own feedback and ownership. The storage key is never returned to the
uploader or accepted as proof of access.

The existing database quota lock serializes key reservation across replicas. Each
selected reference requires verified bytes in both Supabase and Cloudflare. A missing
copy is repaired from the incoming identical file; an unavailable or corrupt copy
fails without selecting the new reference or overwriting corrupt evidence. Proven
corruption also withdraws draft confirmations as described under Limits and recovery.
Saved history remains intact. Retrying
verification spends an attempt but reserves no duplicate bytes. Byte quotas
conservatively reserve each fresh owned reference even when the
physical file is reused. Admission and remaining allowance therefore do not reveal
whether another person uploaded the same bytes.
Existing duplicate objects and their conservative reservations remain unchanged.

Deploy the migration before the API. Roll back application code with migration 0092
retained once keys are shared; the previous API can still read the references but
allocates new objects. Database downgrade refuses while shared keys exist rather
than deleting references. No live file deletion or retroactive quota refund is part
of this release.
