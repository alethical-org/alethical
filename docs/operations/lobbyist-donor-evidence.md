<!-- describes: alethical/pipeline/lobbyist_donor_proof.py, alethical/pipeline/lobbyist_report_evidence.py, alethical/pipeline/lobbyist_report_coverage.py, alethical/pipeline/lobbyist_evidence_run.py, alethical/pipeline/lobbyist_report_collection.py, alethical/pipeline/lobbyist_evidence_publication.py, alethical/api/services/lobbyist_donation_evidence.py, scripts/check_lobbyist_donor_evidence.py -->

# Recovering supported lobbyist contribution amounts

The lobbyist directory can use donor-specific report evidence when a receiving
committee's whole-year comparison cannot support an amount. This does not replace
the contribution download, change its rows, or publish a committee total.

## Evidence contract

A positive donor check compares the complete known transaction sets in the held
contribution rows and effective official reports. Date, signed amount, cash versus
in-kind, and repeated-row counts must agree. Equal totals alone are insufficient.
A report parser must reconcile every contribution schedule and its committee summary,
verify committee identity and report dates, and account for every printed page.
A refused parse supplies no partial positive proof.

An explicit lobbyist registration in an official report may establish the identity of
a held Individual or Lobbyist contribution whose number is missing. Name, receipt
date, amount and contribution kind must also agree uniquely. A name alone, nickname,
address, employer or apparent duplicate is not identity evidence. Conflicting numbers
and unresolved same-name payments remain unavailable. PDFs never create payment rows.

Select effective amendments and account for regular and special-election reporting
series. Do not add overlapping cumulative reports. Report coverage must be established
from printed periods, not assumed from a year-end label. A report extending into the
next calendar year can support the selected year's transactions after the entire report
passes its checks; its next-year payments are not moved into the earlier amount.
For a late-start reporting period, retain and check the cover dates of every known
effective report in each reporting series. Earlier periods must be contained in the
selected cumulative report for that series, and selected periods must reach year-end
without unexplained gaps or overlap. This establishes coverage of the known reports,
not a claim that no activity existed before the first filed period.

Any contradictory donor evidence overrides an older committee-wide pass. Discovery of
a new effective report invalidates a superseded pass even when its PDF cannot be read.
Known missing payments, unresolved identities, missing amounts and unexplained period
gaps withhold the donor's entire annual amount. A failed refresh retains previously
known donor/recipient relationships as unresolved rather than forgetting a missing-ID
recipient and publishing a smaller amount. No matching records never means $0.
The profile and directory use the same successful source-row associations.

## Collection, review and publication

Run from an isolated checkout with the normal database and raw-file-store environment.
The default is read-only. Only the explicit publication option writes the new proof
store and its active pointer.

```sh
python scripts/check_lobbyist_donor_evidence.py \
  --target production --sources /absolute/path/to/evidence \
  --years 2024 2025 --collect --output /absolute/path/to/candidate.json
```

Collection uses at most 2 concurrent public reads. A collection run refreshes the
catalogues by default. `--reuse-retained` explicitly requests the saved collection
instead; it must not be described as a fresh source check. Catalogue bodies, selected
versions, collection timestamps and content-addressed report bytes remain available
for positive, refused and withdrawn outcomes. Earlier effective reports needed to
establish a late start are collected by the same command.

Review the resulting artifact independently, including newly supported and newly
withheld names. Record its printed audit SHA256. Publication recomputes the evidence
from source rows and retained official bytes and requires the same reviewed hash:

```sh
python scripts/check_lobbyist_donor_evidence.py \
  --target production --sources /absolute/path/to/evidence \
  --years 2024 2025 --output /absolute/path/to/recomputed.json \
  --publish --reviewed-hash <accepted-audit-sha256>
```

Store and read back the report bytes before activation. Keep the full compressed audit
object, including catalogue bodies, in the existing campaign-finance raw-file store.
Refused PDFs use separate content-addressed objects under
`campaign-finance/lobbyist-evidence/documents/`; a mismatched report never creates
false committee identity metadata in the shared report-document table.
The database contains a compact runtime proof and the audit object's hash and key.
The standard object_key, compressed_hash and mirrored_at columns let the existing
Cloudflare R2 backup job discover and record the audit copy automatically. Refused
PDFs are also covered by that job's complete bucket walk.
Recheck source release, filing snapshot, held row count and exact row fingerprints
and previously known donor relationships before moving the single active-evidence pointer. An interrupted object upload cannot
activate partial proof. An ordinary publication cannot silently replace a newer
collection with an older or narrower one. An explicit reviewed rollback may use
`--allow-rollback`; retain the previous evidence ID and audit object before activation.

Proof binds the contribution and filing snapshots and parser version. Replacing either
source or changing the proof version makes old positive associations ineligible automatically.
When only the filing snapshot changes, retain known relationships as unresolved until
new evidence resolves them. Never interpret an expired identity association as no giving.
A partially pruned contribution snapshot cannot support directory amounts or proof-backed
profile rows. Original campaign rows and earlier proof runs remain intact.

## Scope and limits

This is a sum of supported held campaign contribution records, not complete personal
giving, client lobbying spending or influence. It does not promise a number for every
name. Missing source payments need a source refresh; ambiguous identities need additional
official evidence. A disclaimer cannot turn either into a supported number.

The full historical-source replacement remains separately held under
[issue 2142](https://github.com/alethical-org/alethical/issues/2142) and
[issue 2150](https://github.com/alethical-org/alethical/issues/2150). This procedure
never runs or changes that replacement or rewrites its published committee comparisons.
The donor-specific repair is tracked in
[issue 2325](https://github.com/alethical-org/alethical/issues/2325).
