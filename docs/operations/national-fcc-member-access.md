# Finance access to national FCC originals

Finance serves verified member originals and text through its signed-in API. The server
receives temporary access to read objects under `fcc-national/v1/originals/` and
`fcc-national/v1/text/` in a single private R2 bucket. The one allowed S3 action is
`GetObject`. [Cloudflare's local signing contract](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/)
defines the action and prefix limits. The permanent signing secret stays with the existing
private archive workflow credentials. The API streams an authorized object's bytes. Never
return the grant or a presigned URL made with the grant to a client: the URL contains a
session token from which R2's delegated secret can be derived.

1. Stage the verified database snapshot before enabling member access. The first
   manual renewal can select a staged snapshot. Scheduled renewals require an active snapshot.
2. Run `gh workflow run national-fcc-read-grant.yml --ref main` after the migration,
   then inspect the completed run under **Renew Finance FCC file access**. The job reads
   1 byte from a member original and 1 from its text, confirms denied access to the
   private research index, listing and object metadata, and only then saves the
   3-day grant. Renewal and withdrawal share a database lock so withdrawal cannot finish
   between the access checks and saving the grant. An equivalent operator command from the project with its existing
   private settings is `python -m scripts.national_fcc_db_renew --target production --apply --allow-staged`.
   Omit `--apply` for a probe that makes no changes.
3. The [renewal workflow](../../.github/workflows/national-fcc-read-grant.yml) runs daily
   at 08:47 UTC on the default branch. With no active snapshot it skips storage reads and grant renewal. A failed probe fails the run, retains the prior
   grant, and can be retried by dispatching the same workflow. A successful run records
   the expiry in its log. For a failure, verify the existing workflow's GitHub secrets,
   the migration and the staged or active object availability before rerunning.
4. To inspect expiry, read only `expires_at` from `national_fcc_read_grant` for
   `purpose='finance-media'`. The backend keeps the client for at most 5 minutes and
   never past expiry. The table is protected by row-level security; browser roles,
   the PostgREST service role, and PUBLIC have no direct table privileges. Do not export
   the token in a support log or include it in a query result.
5. To withdraw member access, deactivate the snapshot using the archive operations
   guide. To retire renewal, disable its workflow and delete only the
   `purpose='finance-media'` grant after deactivation. Cached grants expire after the
   cache interval in this server; a copied token can remain usable until its signed expiry.
   If the signer itself is compromised, rotate it following the project's storage response
   procedure. Revoking that parent also affects the other archive operations that use it.
