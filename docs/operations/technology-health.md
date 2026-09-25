<!-- describes: .github/dependabot.yml .github/workflows/ci.yml .github/workflows/native-release-tools.yml .github/workflows/technology-health.yml .github/workflows/*deploy.yml Dockerfile.backend docker-compose.yml package.json apps/frontend/package.json pnpm-workspace.yaml pyproject.toml .python-version justfile scripts/check_technology_health.py apps/frontend/scripts/check-build-tool-security.mjs tools/native-release/** patches/metro@0.84.4.patch pnpm-lock.yaml -->
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
  finding meets the recorded exception below. Missing packages, unreadable reports,
  scanner errors, and timeouts fail the check rather than reporting a clean result.
- Phone publishing packages have a separate lockfile (`tools/native-release/pnpm-lock.yaml`).
  Changes to those tools run their command and security checks in
  `.github/workflows/native-release-tools.yml`; GitHub's update helper also watches
  that lockfile for security fixes.
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
changing the Mac. Use `just doctor ios` or `just doctor android` before phone work.

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
