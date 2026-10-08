<!-- describes: .github/dependabot.yml .github/workflows/ci.yml .github/workflows/technology-health.yml .github/workflows/*deploy.yml Dockerfile.backend docker-compose.yml package.json apps/frontend/package.json pnpm-workspace.yaml pyproject.toml .python-version justfile scripts/check_technology_health.py apps/frontend/scripts/check-build-tool-security.mjs apps/frontend/scripts/check-node-forge-security.mjs apps/frontend/scripts/check-braces-security.mjs apps/frontend/scripts/check-source-map-security.mjs apps/frontend/scripts/test-source-map-security.mjs apps/frontend/scripts/test-compression-security.mjs patches/metro@0.84.4.patch patches/node-forge@1.4.0.patch patches/braces@3.0.3.patch pnpm-lock.yaml uv.lock alethical/tests/test_multidict_security.py -->
<!-- last-major-tool-review: 2026-08-15 -->

# Keeping every tool supported and useful

**Purpose.** Alethical checks its whole building and release system, not only app
packages. The goal is supported, secure, compatible, and useful software. Moving to
the newest major release is never automatic.

## What happens automatically

- GitHub's update helper checks GitHub Actions, Python, JavaScript, Dockerfiles, and
  Docker Compose every month (`.github/dependabot.yml`). Small updates are grouped;
  major releases arrive separately so one risky change cannot block safer changes.
- Known security problems trigger GitHub's update helper immediately rather than
  waiting for the monthly date.
- The required `changes` check (`.github/workflows/ci.yml`) checks every locked
  Python and website JavaScript package, including development tools, before a pull request
  or merge-queue commit can pass. Every severity blocks release unless the exact
  finding meets the recorded exception or installed repair below. Missing packages, unreadable reports,
  scanner errors, and timeouts fail the check rather than reporting a clean result.
- Native phone publishing is paused. Its packages, lockfile, workflow and update
  entry are removed. The required security check rejects a restored `eas-cli`
  dependency, including an alias, in any tracked package manifest. Expo and React
  Native remain required by the browser build. [ios-release.md](ios-release.md)
  records the restart conditions and recovery point.
- The security check also audits exact registry package pins in tracked research
  replay requirements under `docs/research/evidence/`. It does not install those
  packages. Public Git dependencies must name a full commit and are explicitly
  reported for source review outside the registry audit. Historical JSON evidence
  is not an installation input.
- GitHub CodeQL default setup scans Python, JavaScript/TypeScript and GitHub Actions
  on changes and weekly. Its alerts are reviewed alongside dependency warnings.
  Secret scanning and push protection remain enabled; TruffleHog checks new commits.
- The same security check runs every Monday at 13:41 UTC through
  `.github/workflows/technology-health.yml`, so new warnings are found between releases.
- The monthly technology check (`.github/workflows/technology-health.yml`) also finds
  inconsistent saved versions, commands with no saved version, approaching support
  deadlines, and overdue major tool reviews. Routine tool updates do not block the
  separate security-only check.
- These checks read public package lists on GitHub's free standard computer. They
  use no AI, paid API, or larger paid computer. Python checks read every locked
  package version, including versions for other operating systems, without installing
  the app's packages or running their build scripts. Each returned package list must
  match the lock inventory. A stale lock or unsupported source fails the check.
- Every GitHub job that installs `uv` saves 0.12.5, the release that passed the first
  live technology check. The monthly check rejects a missing or different saved
  version, and reports newer `uv` releases under the same monthly policy as other tools.

## What checks each development Mac

Run `just doctor` after setup changes or when a newly pulled branch will not start.
It checks Docker, uv, just, Node.js, pnpm, and the project's Python version without
changing the Mac. Only browser development is supported while native releases are paused.

## Monday repair review

The Codex schedule **Alethical Monday security repairs** was approved on
7 October 2026. It returns to the owning chat every Monday at 09:00 America/New_York
and checks Dependabot, malware alerts, code-scanning findings, secret-scanning
metadata, security workflow failures, package audits and runtime support deadlines.
It carries safe fixes through tests, independent review, the merge queue and live
acceptance, while respecting active work and keeping native publishing paused.
It reports completed repairs, failed protection or a real need for user input;
unchanged, non-actionable state stays quiet.

This local Codex schedule requires the Mac to be on and the app running. GitHub's
security updates, release checks and Monday machine scan do not depend on that Mac.
The scheduled agent uses the user's Codex allowance; the GitHub scans use standard
public-repository runners. The schedule does not authorize new paid services,
destructive access or data changes, real messages to readers, or native releases.
Keep the schedule prompt current through Codex's supported automation controls.

## What needs human judgment every 3 months

Review official release notes for Node.js, Python, PostgreSQL, Expo, React Native,
pnpm, uv, Docker, GitHub Actions, Vercel, Railway, Supabase, and the coding-agent
tools used on this repository. For each one:

1. Check its support end date and known security problems.
2. Check new features that could make builds, tests, worktrees, or releases faster.
3. Check related components the company now recommends or has replaced.
4. Remove a tool only when nothing still needs it.
5. Adopt a major change only after its real Alethical checks pass.
6. Record the decision and update the hidden review date at the top of this file.

The monthly job reports newer major versions as candidates. It fails only when this
3-month judgment is overdue, not whenever a vendor publishes something new.

## Current support baseline

| Part | Alethical line | Supported through | Official source |
| --- | --- | --- | --- |
| Node.js | 22 | 2027-04-30 | [Node.js releases](https://nodejs.org/en/about/previous-releases) |
| Python | 3.12 | 2028-10-31 | [Python versions](https://devguide.python.org/versions/) |
| PostgreSQL | 17 | 2029-11-08 | [PostgreSQL policy](https://www.postgresql.org/support/versioning/) |

The monthly check starts failing 180 days before one of these dates. That leaves time
to test and release a replacement before support ends.

## Recorded security exceptions

The website build tools use node-forge 1.4.0 with the exact nested signature
validation repair from [upstream pull request 1152](https://github.com/digitalbazaar/forge/pull/1152)
at `ceba34402e329f0365134f23fe19898756527d65`. The
[signature validation advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
has no published fixed package. The official package name and version stay intact;
the raw audit warning stays in the security log. This is a local code repair, not
an exception for vulnerable code.

The always-required security invocation installs the frozen JavaScript lockfile
without running package scripts, then runs `check-node-forge-security.mjs` itself.
Acceptance requires the exact advisory, package, version, reported dependency
path, patch file fingerprint, lockfile patch fingerprint, and installed RSA code
fingerprint. Both Expo consumers must resolve the repaired package. Signature checks
use ordinary verification options and valid padding, accept valid SHA-256 signatures
with and without NULL parameters, and reject extra nested elements in either form.
The malformed test signatures are made with a known test private key to isolate the
parser defect; they do not claim to recreate a forgery without that key.
Installation failure, missing or changed repair evidence, changed findings, and
unrelated advisories block release. A published fixed version requires a reviewed
upgrade rather than silently carrying this local classification forward.

The website's Expo file scanners use braces 3.0.3. Its
[deep-pattern advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
has no fixed release. A local repair stops patterns nested beyond 100 levels
before their shape can exhaust Node.js. The required security check reads the
exact saved patch, lockfile, and installed code, then tests the repaired braces
package reached from both Expo file scanners. Their current matching path does
not call braces, so the check also tests that real file matching still works.
The raw audit warning stays visible. A changed dependency path, version,
advisory, or repair stops release until reviewed. A fixed upstream version
should replace the local repair after compatibility checks pass.

The jsdom CSS parser and PostCSS use source-map-js 1.2.2, the published fix for
its [section-offset advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
The package was published on 30 September at 14:08:09 UTC and cleared the saved
7-day waiting period on 7 October at 14:08:09 UTC. The temporary 1.2.1 backport,
patch binding, and exact audit classification have been removed. Security scans
now reject any remaining affected source-map-js version without an exception.

The build-tool checks retain bounded child processes for invalid and excessive
offsets, combined offsets in nested maps, large valid maps, linear nested-source
reading, and ordinary CSS generation through both actual CSS consumers. These
behavior checks remain after replacing the local repair with the official release.

React Native's development tools use shell-quote 1.11.0, the published fix for
[command injection after a comment](https://github.com/ljharb/shell-quote/security/advisories/GHSA-pqg4-j6r4-53mv).
The release was published on 29 September 2026 at 02:34:24 UTC and clears the 7-day
waiting period. The build-tool checks load the actual development-tools dependency,
require rejection of all 4 line-break characters after a comment, and preserve
ordinary quoted arguments, literal punctuation and comments. Tests compare strings
and exceptions without executing generated shell commands. The security scan keeps
its normal failure behavior; no warning is waived.

Expo's compression package uses 1.8.2, the published fix for its
[early-disconnect memory leak](https://github.com/expressjs/compression/security/advisories/GHSA-vc2v-76pw-4v95).
That release clears the 7-day waiting period. Compatibility tests exercise the
actual Expo dependency on a private loopback server: an early client disconnect
must close its native gzip stream, and complete compressed responses must retain
their original text.

Python's HTTP helpers use multidict 6.9.1, the published fix for its
[items-view memory leak](https://github.com/advisories/GHSA-54p9-h82j-f925).
That release was published on 21 September and clears the saved package waiting
period. Focused tests use the installed native extension to require correct
union and subtraction results without retaining extra references to input
objects. This is a package upgrade, not an audit exception.

The image-size exception ended on 25 September 2026 when the security feed
reported a fixed release. Metro now uses image-size 2.0.3, published on
14 September, beyond the required 7-day wait. A small Metro patch reads each
image file into a buffer because version 2 no longer accepts filenames. The
build-tool checks exercise both Metro image-reading paths against a real PNG.

The retired exception covered version 1.2.1 only while no fix existed, through
Expo's build tooling only. It never covered the finished website. The automatic
check still rejects that old version when a patched release is reported.
The original evidence remains in
[`docs/verification/1493-build-tool-security/README.md`](../verification/1493-build-tool-security/README.md).
The fixes address [the JXL/HEIF parser advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)
and [the ICNS parser advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr).

Run `python scripts/check_technology_health.py --security-only` for the same release
check locally. Run `python scripts/check_technology_health.py --online` for the
full monthly review. Both commands require the project's saved uv and pnpm versions.

## Review completed on 2026-08-15

- Expo 57 is worth adopting because it fixes Expo 56's memory problem and improves
  development speed; [issue #1553](https://github.com/alethical-org/alethical/issues/1553)
  owns the tested upgrade.
- Railway's command-line tool is now fixed at `5.41.2`; the old unversioned command
  could silently change the production deployment tool on any run.
- Ruff 0.16 remains deferred because it changes the active rules and reports hundreds
  of findings against code Ruff 0.15 accepts; that is a lint migration, not an update.
- Ty 0.0.72 passes the current database-code check and replaces 0.0.63 in local and
  automatic checks together.
- pnpm 11 and Vercel 59 are major candidates; test them after the Expo 57 work settles
  the frontend package family and before changing either production path.
