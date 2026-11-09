# Private political mail upload

Owner: the political-mail demo build, [issue 2918](https://github.com/alethical-org/alethical/issues/2918).

Jason's demo has no account sign-in. A revocable invitation permits isolated browser-tab sessions to save front/back photos, a required Yes/No reaction and an optional message. Public consumer login follows the demo. Part 2 waits for Angel's samples: extract the printed payer, match directly to existing records and count matching mailers; then connect supported people, organizations, activities and transactions. No TVEyes dependency. An upload or reaction never establishes party affiliation, voting intention, delivery date, mailbox reach or guilt.

## Before enabling

The API is off unless `ALETHICAL_MAIL_UPLOAD_ENABLED=true`. Deploy migration `0090_mail_upload` before the API. The migration is additive; rollback the API or set the flag false to stop access without losing records. Do not downgrade a database containing uploads: downgrade drops the feature's tables and cannot undo remote writes.

1. Create a dedicated **private** Supabase Storage bucket and a dedicated **private** Cloudflare R2 bucket. Suggested names: `political-mail-originals` and `alethical-political-mail-backup`. Supabase public access must be false, with no anonymous or authenticated object policies. R2 must have no public development URL or custom domain. Do not reuse `raw-source-files` or the existing source archive mirror: those have different retention requirements.
2. Configure `MAIL_UPLOAD_SUPABASE_BUCKET` and existing server-only `SUPABASE_STORAGE_S3_*` credentials. Configure `MAIL_UPLOAD_R2_BUCKET`, `MAIL_UPLOAD_R2_ENDPOINT`, `MAIL_UPLOAD_R2_ACCESS_KEY_ID`, `MAIL_UPLOAD_R2_SECRET_ACCESS_KEY` with object read/write access scoped to the new bucket. Never put these credentials in frontend settings or committed files. Additional R2 storage cost was approved; no unrelated plan change is authorized.
3. Verify both buckets are private using their control planes and an unauthenticated request to a synthetic object. The S3 credentials alone cannot prove the bucket has no other public route. Keep the flag false until those checks pass.
4. Use synthetic photos to exercise exchange, both uploads, submit, retry and authenticated administrator download. Read both stored objects back and compare hashes. Test a failed R2 write and retry; the UI must retain the accepted photo until its replacement is verified in both stores.
5. Approved uploader-facing wording: “Your photos and comments stay private to Alethical”. Before real recipient mail, settle retention. Originals can contain names, addresses, barcodes and photo metadata. This version preserves exact bytes privately and has no public/redacted derivative or customer export. No real-user uploads until that decision is recorded.

Supabase stores the database rows and primary originals. R2 stores a separately verified copy of each original. Supabase database backups do **not** include Storage object bytes. This feature does not create a second database backup in R2: restoring its database requires the existing database backup process. Both the database and image objects are needed for full recovery. No automatic purge is implemented before retention is settled; keep synthetic-only deployment until then. Revocation stops access but does not delete either copy.

## Invitation operations

Run from the repository using its installed environment. `--target` defaults to local; production must be explicit and uses the project's existing database configuration. The create command writes a new mode-0600 JSON file outside the repo, never a token to stdout. Do not paste it into an issue or log.

```sh
uv run python scripts/mail_upload.py --target local create --output /private/tmp/jason-mail-invitation.json
uv run python scripts/mail_upload.py --target local revoke INVITATION_UUID
```

Default invitation lifetime: 7 days, 20 sessions and 512 MiB of unique image bytes. CLI bounds: 1–30 days, 1–100 sessions. Sessions expire after 24 hours or invitation expiry, whichever comes first. Revocation invalidates every session on the next authenticated action. Invite possession is access; an unlisted URL alone is not an access control. Put the invitation token in the frontend URL fragment, never its query string. The frontend clears it after capturing it and keeps credentials only in page memory. A shared invitation can create multiple isolated sessions; those sessions are not verified distinct people.

## API contract

All responses use `{ "data": ... }`. Private routes return `Cache-Control: private, no-store`. Tokens and photos are never returned in public URLs. Transport errors use the existing problem response format. Unknown or unowned submissions return 404.

| Request | Input | Result |
| --- | --- | --- |
| `POST /api/v1/mail-upload/sessions` | JSON `invitation_token`, random UUID `client_id`, random 32-byte `client_secret` encoded as 64 lowercase hex digits | `token`, `expires_at`, `supported_content_types`, `max_image_bytes` |
| `PUT /api/v1/mail-upload/submissions/{uuid}` | Bearer session token; empty JSON | Existing or new draft |
| `PUT /api/v1/mail-upload/submissions/{uuid}/images/front` or `/back` | Bearer token; raw file bytes and Content-Type | Draft after verification of both copies |
| `POST /api/v1/mail-upload/submissions/{uuid}/submit` | Bearer token; JSON `likes_ad` boolean, optional `comment` up to 4000 characters | Saved submission |
| `GET /api/v1/mail-upload/submissions/{uuid}` | Bearer token | Current owned submission, for recovery after lost response |

The submission body contains `id`, `status` (`draft` or `saved`), `front` and `back` (null or `{sha256,content_type,bytes}`), `likes_ad` and `comment`. It contains no object key, image URL, recipient identity or inferred payer.

Use a fresh UUID per new submission and reuse it on retries. Retry session exchange with the **same invitation, client ID and client secret** to recover the same session token. Another secret cannot recover that tab's session. Retry image transfer with the same bytes. The pending row reserves quota and the same object key, so failure between primary and backup can be repaired without duplicating bytes or replacing an accepted side. Both stores are read back and hashed before selection. Save freezes the selected sides; an identical submit retry returns the saved record, while changed content returns 409. Front and back upload sequentially because concurrent image decoding on one API process returns a retryable 429.

Validation: maximum 15 MiB per original, 48 million decoded pixels, JPEG/PNG/WebP/HEIC/HEIF; MIME and decoded format must match. Missing browser MIME may use `application/octet-stream`. Reject invalid, truncated and animated non-HEIF images. HEIF's primary image is decoded, preserving all original bytes. No re-encoding, metadata removal or upload to an OCR service occurs.

## Limits and recovery

Database locks serialize quota reservations across API replicas. Global limits are 2 GiB of reserved unique image bytes and 2,000 storage attempts; each invitation allows 400 attempts, its byte allowance and its session count. Each session allows 25 submissions. Replacements and incomplete objects count toward storage. Successful identical image retries do not reserve bytes again. Global counters intentionally do not reset on application restart or invitation revocation. This conservative ceiling bounds abandoned/failed transfers as well as accepted images.

An additional per-process, per-IP limit defaults to 60 API calls/minute. It uses the project's trusted-proxy client address, not caller-controlled forwarding headers. This rate limit is a first-line throttle; the database counters are the cross-replica ceiling. Image reception is limited to 45 seconds and one in-flight decode/storage operation per process; storage network calls use bounded connection/read timeouts and retries.

On storage failure return 503 with no provider body, preserve the old selected side, and allow retry. On a missing response the client can GET the owned submission before deciding to retry. No artificial success: `saved` requires both selected photos to have verified primary and backup copies. A subsequent external bucket deletion is outside that upload-time guarantee and needs normal backup monitoring.

## Administrator inspection

Existing administrator authentication and current authorization apply unchanged:

- `GET /api/v1/admin/mail-upload/submissions` returns the latest 100 drafts/saved records and timestamps
- `GET /api/v1/admin/mail-upload/submissions/{uuid}/images/{front|back}` downloads the selected original, checks its hash and returns an attachment with no-store and nosniff

Anonymous invitation sessions cannot use these routes. All five tables have row-level security enabled, no browser grants, and no public policy. Server-side database access is required. Never infer unique contributors from anonymous sessions. Record total saved submissions, session count and eventual distinct creative count separately.

## Build checks

`uv run pytest alethical/tests/test_mail_upload.py` uses the repository's disposable PostgreSQL database, fake independent object stores, real API request handling and real image decoding. It covers byte identity, failed-copy recovery, retry conflicts, unauthorized access, revoked/expired invitations, quotas, raw-image bounds, HEIC, RLS, administrator access and save during replacement. Live S3 permissions and frontend device behavior require the deployment checks above.

## Demo screen

The approved Design source is `Mail upload.dc.html` in Alethical UX, with the November 9, 2026 handoff. The page stays outside navigation and search. It uses the shared header and footer, Front/Back photo controls, a required Yes/No reaction, and one optional message. Selected Yes/No uses Design’s optical balance: the center of the 18px check-and-label group sits 7px left of the control’s center, with an 8px gap and padding of 10px 26px 10px 12px. Unselected labels stay centered. This placement is specific to these controls, not a universal offset. The helper stays visible above the field: “e.g. how you feel about this mail or how our tool could be more helpful”. The compact confirmation says “Saved”, with “Upload another”. Large green checks appear only after the server verifies both private copies; replacement failures preserve the previous accepted image and block final submission until resolved.

The approved value description is “See who paid for this mail and what public records show about them”. This describes the complete demo after Part 2. The initial upload test has no payer or funding result; its live-test invitation must state that limit. Do not present collection as successful analysis. Part 2 remains dependent on Angel's samples.

The browser keeps images and comments in memory, so reload loses an unfinished form. Credentials also stay only in page memory; after a reload, reopen the original invitation link. Invalid photos, transfer failures, and uncertain final responses preserve the current form for retry. While a transfer is running, Submit and that side's replacement are disabled; the other side and feedback remain available. Final-submit retries retain the same identifier and answers, preventing duplicate saved submissions after a lost response. The first release uses the native image picker; camera/library options still need real iPhone and Android checks. There is no custom fallback menu until those checks demonstrate a need.
