# Supporting-source release checks

<!-- describes: alethical/pipeline/supporting_source_checks.py, scripts/check_supporting_sources.py, alethical/pipeline/published_source_archive.py, scripts/archive_published_sources.py -->

The sitewide refresh build approved on 7 October 2026 adds bounded public-source
checks for records that still need review before replacement. The checks do not
publish maps, elections, candidate identities, ZIP references, or article edits.
Existing public records and their actual copy dates remain unchanged.

## Commands and scheduling contract

Run from the repository root:

```sh
PYTHONPATH=. uv run python scripts/check_supporting_sources.py --source maps
PYTHONPATH=. uv run python scripts/check_supporting_sources.py --source candidates
PYTHONPATH=. uv run python scripts/check_supporting_sources.py --source zip
```

Each prints JSON with `checked_at`, `published: false`, and `results` containing
`source`, `status`, `detail`, and source-specific `evidence`. Exit 0 means the
check passed or the next review is not due; 1 means a source was unavailable;
2 means review is required. The shared scheduler must preserve those meanings,
retain the JSON, and group unchanged findings rather than opening daily duplicate
issues. A successful source check is not a new publication date.

- Maps: weekly. Read the official LCC download index, then the latest named House
  and Senate GeoJSON archives. Compare the bytes with the importer's approved
  hashes, require the complete unique 134 House and 67 Senate district codes,
  valid shapes and a recognized coordinate system. Changed files need a geometry
  comparison and reviewed import. Neither matching row counts nor a new timestamp
  proves a safe map replacement.
- Candidates: daily. Read the public MyBallot application and its main script,
  requiring the street and polling-place request contract used by Alethical.
  Warn 60 days before the approved election ends and continue warning after it.
  This uses no resident address, calls no address-based API, and claims neither
  statewide candidate completeness nor working results for an individual address.
  A new election ID/date still requires official evidence and review.
- ZIP reference: quarterly, or a cheap daily date check. HUD aims to publish by
  the end of the month following each quarter. Compare that review deadline with
  the held reference's actual quarter-end. A due review is not evidence that a
  workbook is available. HUD requires sign-in; a complete authenticated workbook
  still goes through the existing reviewed import and national coverage checks.

Public GETs reject redirects and unapproved hosts, use 3 attempts at most, cap
response size and time, and space consecutive source reads. No new paid service,
AI call, visitor-address storage, or recurring task is created by these commands.

## Published article sources

The existing archive command retries an unreachable source at most 3 times,
with increasing waits. A recovered read stays quiet. An exhausted read makes the
run fail and names the failure as unavailable, never gone. Kept source copies
are preserved. Every article file must expose readable links; an unreadable new
format cannot quietly disappear from archive coverage. The existing grouped
issue remains the review route; dated article content is not rewritten.

## Initial official-source evidence, 7 October 2026

The current LCC index advertises:

- House: `https://gis.lcc.mn.gov/data/geojson/L2023_0hse.zip`, SHA-256
  `cccc70e2fd1f26c49ecc0fc24f9dbf5fad5ee0134abc59b68b94a38bb61db50e`.
- Senate: `https://gis.lcc.mn.gov/data/geojson/L2023_0sen.zip`, SHA-256
  `669e525e09d7566472981b7180e295c5d4e6e54e749866aa1d63878798e508b9`.

Both differ from the reviewed importer's ZIP hashes and contain `.geojson` in
longitude/latitude rather than the older EPSG:26915 `.json` files. House geometry
matches the shipped map exactly by per-district geometric difference. Senate
geometry differs: summed polygon area is 25.556508219195027 square degrees,
versus 26.327870508507026 in the held map. This measure identifies a discrepancy;
it does not establish which boundary is authoritative or warrant replacing the map.
The largest individual district difference is 0.7404639601919994 square degrees.
Keep the held map until the source difference is resolved.

MyBallot's current public script exposes the supported request contract. The
approved election is 8334, 3 November 2026, 27 days away. The public application
contract exposes address-based requests, not a proven address-free election or
candidate catalogue. Future mappings and background candidate replacement remain
review work, not fabricated from a calendar date or a candidate-results file.

The held ZIP reference covers 30 June 2026. The next review is due 31 October
2026 for the quarter ending 30 September. The public HUD page states sign-in is
required for files; an unauthenticated empty response is not a release check.

## Remaining limits and prevention

These jobs discover drift; they do not bypass the proof needed to publish a
replacement. The shared scheduler owns durable job history, overdue detection,
quiet deduplication and retry after a worker crash. Tests cover missing and repeated
districts, unsupported source responses, election expiry, quarter/year rollover,
source recovery and exhausted reads. A full source check still cannot prove that
an HTML viewer archive contains the separately loaded underlying data.
