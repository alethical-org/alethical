# September 2026 dependency security repair

## Authorization and finish

Eugene first requested an assessment of the September 8-15 GitHub alert email,
then authorized: "Perform all the necessary fixes. Don't stop to present approach
first. Only stop if the optimal model is not Astra Extra High So I can change it."
The task owns fixes, prevention, tests, independent review, merge, deployment,
live checks, and a fresh GitHub alert count. No production data replacement or
paid service is needed.

## Baseline

On September 18, GitHub reported 41 open alerts affecting 9 package names.
The npm scanner reported 36 package/advisory entries, including the 2 existing
`image-size` exceptions with no published fix. Counts differ because GitHub
separately records affected version ranges and manifests.

Minimum patched versions from the current advisories and package registries:

| Package | Selected patched version |
| --- | --- |
| pypdf | 6.16.1 |
| httpx2 | 2.12.0 |
| vitest and @vitest/mocker | 4.1.11 |
| @xmldom/xmldom | 0.8.15 and 0.9.12 |
| fast-uri | 3.1.6 |
| joi | 17.13.6 |
| js-yaml | 3.15.2 and 4.3.2 |
| decode-uri-component | 0.5.0 with a 1-line query-string import bridge |

All selected JavaScript fixes were published more than 7 days before this repair.
The package release waiting period remains enabled.

## Fixes and prevention

Direct requirements and both lockfiles carry the patched versions. Transitive
overrides keep parent upgrades narrow. React Navigation still uses the CommonJS
entry of query-string 7.1.3, so its decoder import now selects the fixed decoder's
default export. The upstream decoding algorithm is unchanged.

The required `changes` job scans dependencies on every pull request, merge-queue
commit, and main push. It covers every severity, development packages, and all
79 registry package versions in the Python lock, including packages for other
operating systems. Alternate versions of the same Python package are audited in
separate batches. The returned package inventory must match each requested batch.
Missing results, scanner errors, stale locks, unsupported Python sources, and
timeouts fail the check.

The existing maintenance workflow also scans security weekly; the broader version
review remains monthly. Changes under `patches/` select frontend checks and a
website deployment, including the existing check for a release that never starts.

The scanner still reports 2 previously reviewed image-size warnings. There is no
published upstream fix. The allowance is limited to the 2 exact advisory IDs,
image-size 1.2.1, and Expo's Metro build path. It ends on October 18, 2026, or
earlier if a fix becomes available or the package version/path changes. The
package reads checkout images at build time and is absent from the browser
program. This is an accepted, time-limited risk, not a fixed vulnerability.

## Sources

- [Current GitHub alerts](https://github.com/alethical-org/alethical/security/dependabot)
- [URL-decoder advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)
- [HTTPX2 decompression advisory](https://github.com/advisories/GHSA-8xx6-hgc6-gc2m)
- [PDF outline advisory](https://github.com/advisories/GHSA-23w6-3w8w-8484)
- [Vitest file-read advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)
- [Existing image-size exposure assessment](1493-build-tool-security/README.md)

## Verification before release

- Live security scan: all 79 Python registry versions covered, with no findings;
  JavaScript retains only the 2 limited image-size exceptions.
- 50 focused prevention tests and 29 local-check selection tests pass.
- All 3,342 frontend tests pass, along with TypeScript, Expo package compatibility,
  formatting, and the production website build.
- URL compatibility checks cover Unicode, spaces, plus signs, repeated/empty
  parameters, malformed escapes, and a long malformed input with a 5-second
  timeout. The old decoder exceeded 3 seconds on the regression input; the fixed
  decoder completed in about 1.3 milliseconds in the isolated check.
- The browser opens `/bills?q=Saint+Paul` and preserves the search on reload.
  Full record loading is checked on the hosted site because the production API
  deliberately does not allow this local preview's origin.
- Independent review found and resolved gaps in cross-platform Python coverage
  and patch-only check/deployment selection.

## Release acceptance

The normal upload checks run the complete backend and frontend suites against the
committed snapshot. GitHub then runs the required checks on the current commit
and merge-queue commit, including a fresh dependency scan. Release completion
requires the website's release stamp to include this change, the API to report
ready, ordinary public browsing/search to work, and a fresh GitHub alert readback.
The pull request records the final test, deployment, and alert-count evidence.
