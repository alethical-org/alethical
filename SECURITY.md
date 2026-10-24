# Reporting a security problem

Report a suspected security problem through
[GitHub's private vulnerability report](https://github.com/alethical-org/alethical/security/advisories/new).
This shares the report with Alethical's maintainers without publishing it.

Include the affected address or component, steps to reproduce the problem safely,
and the possible impact. Use test accounts and invented data. Do not include
passwords, access keys, private reader data, or authentication callback addresses.
Do not publish an exploit or a sensitive report in a public issue.

## Supported releases

Security repairs target the current production website and its backend, including
desktop and phone browsers. Native iOS and Android releases are paused.

## Ongoing protection

Dependency warnings, code scanning, and secret scanning are reviewed under
[technology-health.md](docs/operations/technology-health.md). Security fixes pass
the repository's checks and merge queue before release.
