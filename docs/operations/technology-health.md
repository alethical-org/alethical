<!-- describes: .github/dependabot.yml .github/workflows/technology-health.yml .github/workflows/*deploy.yml Dockerfile.backend docker-compose.yml package.json apps/frontend/package.json pnpm-workspace.yaml pyproject.toml .python-version justfile scripts/check_technology_health.py -->
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
- The free monthly technology check (`.github/workflows/technology-health.yml`) finds
  inconsistent saved versions, commands with no saved version, new high-risk Python
  or JavaScript package warnings, approaching support deadlines, and overdue major
  tool reviews.
- The monthly technology check reads public package lists and runs on GitHub's free
  standard computer. It uses no AI, paid API, or larger paid computer.

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

JavaScript currently has 2 high-severity warnings in `image-size` with no fixed
release (`GHSA-w3rx-r6r6-pgpr`, `GHSA-5p2g-fcmc-qvqq`). Expo's build tool reads only
project image files; this package is absent from the finished website. The monthly
check ignores only these 2 exact warnings and fails on every new high or critical
warning. The full evidence lives in
[`docs/verification/1493-build-tool-security/README.md`](../verification/1493-build-tool-security/README.md).

## Review completed on 2026-08-15

- Expo 57 is worth adopting because it fixes Expo 56's memory problem and improves
  development speed; [issue #1553](https://github.com/alethical-org/alethical/issues/1553)
  owns the tested upgrade.
- Railway's command-line tool is now fixed at `5.41.2`; the old unversioned command
  could silently change the production deployment tool on any run.
- Ruff 0.16 remains deferred because it changes the active rules and reports hundreds
  of findings against code Ruff 0.15 accepts; that is a lint migration, not an update.
- Ty 0.0.72 passes the current database-code check and should replace 0.0.63 in the
  next current-main change that also keeps local and automatic checks identical.
- pnpm 11 and Vercel 59 are major candidates; test them after the Expo 57 work settles
  the frontend package family and before changing either production path.
