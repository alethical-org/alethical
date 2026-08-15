#!/usr/bin/env python3
"""Check the whole development toolchain without changing it or spending money."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from typing import NamedTuple


ROOT = Path(__file__).resolve().parents[1]
CAPABILITY_GUIDE = Path("docs/operations/technology-health.md")
CAPABILITY_REVIEW_PATTERN = re.compile(
    r"<!-- last-major-tool-review: (\d{4}-\d{2}-\d{2}) -->"
)
KNOWN_JAVASCRIPT_EXCEPTIONS = {
    "GHSA-5p2g-fcmc-qvqq",
    "GHSA-w3rx-r6r6-pgpr",
}
SEVERE_LEVELS = {"high", "critical"}


class VersionSource(NamedTuple):
    path: str
    pattern: str


class VersionGroup(NamedTuple):
    name: str
    sources: tuple[VersionSource, ...]
    kept_parts: int | None = None


class SupportWindow(NamedTuple):
    name: str
    version: str
    support_ends: date
    official_url: str


class RegistryPin(NamedTuple):
    name: str
    source: VersionSource
    registry: str
    package: str
    policy: str = "semver"


PNPM_VERSION = VersionGroup(
    "pnpm",
    (
        VersionSource("package.json", r'"packageManager"\s*:\s*"pnpm@([^"\s]+)"'),
        VersionSource(
            "apps/frontend/package.json",
            r'"packageManager"\s*:\s*"pnpm@([^"\s]+)"',
        ),
        VersionSource("docker-compose.yml", r"corepack prepare pnpm@([0-9.]+)"),
        VersionSource(
            ".github/workflows/ci.yml",
            r"name: Set up pnpm.*?\n\s+with:\n\s+version:\s*[\"']?([0-9.]+)",
        ),
    ),
)
NODE_VERSION = VersionGroup(
    "Node.js",
    (
        VersionSource("docker-compose.yml", r"image:\s*node:([0-9]+)"),
        VersionSource(".github/workflows/ci.yml", r"node-version:\s*[\"']?([0-9]+)"),
        VersionSource(
            ".github/workflows/railway-deploy.yml",
            r"node-version:\s*[\"']?([0-9]+)",
        ),
        VersionSource(
            ".github/workflows/vercel-deploy.yml",
            r"node-version:\s*[\"']?([0-9]+)",
        ),
        VersionSource(
            ".github/workflows/traffic-token-expiry.yml",
            r"node-version:\s*[\"']?([0-9]+)",
        ),
    ),
    1,
)
PYTHON_VERSION = VersionGroup(
    "Python",
    (
        VersionSource(".python-version", r"([0-9]+\.[0-9]+)"),
        VersionSource("Dockerfile.backend", r"uv:python([0-9]+\.[0-9]+)"),
        VersionSource(
            ".github/workflows/ci.yml", r"python-version:\s*[\"']([0-9]+\.[0-9]+)"
        ),
        VersionSource(
            ".github/workflows/home-hero-card-facts.yml",
            r"python-version:\s*[\"']([0-9]+\.[0-9]+)",
        ),
    ),
    2,
)
POSTGRES_VERSION = VersionGroup(
    "PostgreSQL",
    (
        VersionSource("docker-compose.yml", r"pgvector/pgvector:pg([0-9]+)"),
        VersionSource(".github/workflows/ci.yml", r"pgvector/pgvector:pg([0-9]+)"),
        VersionSource(".github/workflows/migrate.yml", r"pgvector/pgvector:pg([0-9]+)"),
    ),
    1,
)
RUFF_VERSION = VersionGroup(
    "Ruff",
    (
        VersionSource("justfile", r"uvx ruff@([0-9.]+)"),
        VersionSource(".github/workflows/ci.yml", r"uvx ruff@([0-9.]+)"),
    ),
)
TY_VERSION = VersionGroup(
    "Ty",
    (
        VersionSource("justfile", r"uvx ty@([0-9.]+)"),
        VersionSource(".github/workflows/ci.yml", r"uvx ty@([0-9.]+)"),
    ),
)
VERSION_GROUPS = (
    PNPM_VERSION,
    NODE_VERSION,
    PYTHON_VERSION,
    POSTGRES_VERSION,
    RUFF_VERSION,
    TY_VERSION,
)

SUPPORT_WINDOWS = (
    SupportWindow(
        "Node.js",
        "22",
        date(2027, 4, 30),
        "https://nodejs.org/en/about/previous-releases",
    ),
    SupportWindow(
        "Python",
        "3.12",
        date(2028, 10, 31),
        "https://devguide.python.org/versions/",
    ),
    SupportWindow(
        "PostgreSQL",
        "17",
        date(2029, 11, 8),
        "https://www.postgresql.org/support/versioning/",
    ),
)

REGISTRY_PINS = (
    RegistryPin(
        "pnpm",
        VersionSource("package.json", r'"packageManager"\s*:\s*"pnpm@([^"\s]+)"'),
        "npm",
        "pnpm",
    ),
    RegistryPin(
        "Ruff",
        VersionSource("justfile", r"uvx ruff@([0-9.]+)"),
        "pypi",
        "ruff",
    ),
    RegistryPin(
        "Ty",
        VersionSource("justfile", r"uvx ty@([0-9.]+)"),
        "pypi",
        "ty",
        "quarterly",
    ),
    RegistryPin(
        "pip-audit",
        VersionSource(
            ".github/workflows/technology-health.yml",
            r"PIP_AUDIT_VERSION:\s*[\"']?([0-9.]+)",
        ),
        "pypi",
        "pip-audit",
    ),
    RegistryPin(
        "Railway command-line tool",
        VersionSource(
            ".github/workflows/railway-deploy.yml",
            r"@railway/cli@([0-9.]+)",
        ),
        "npm",
        "@railway/cli",
    ),
    RegistryPin(
        "Vercel command-line tool",
        VersionSource(".github/workflows/vercel-deploy.yml", r"vercel@([0-9.]+)"),
        "npm",
        "vercel",
    ),
)


def _normalise(version: str, kept_parts: int | None) -> str:
    if kept_parts is None:
        return version
    return ".".join(version.split(".")[:kept_parts])


def _source_versions(root: Path, source: VersionSource) -> list[str]:
    path = root / source.path
    if not path.exists():
        return []
    return re.findall(source.pattern, path.read_text(encoding="utf-8"), re.DOTALL)


def check_version_group(
    root: Path, group: VersionGroup, *, require_all: bool = False
) -> list[str]:
    found: dict[str, set[str]] = {}
    problems: list[str] = []
    for source in group.sources:
        versions = {
            _normalise(version, group.kept_parts)
            for version in _source_versions(root, source)
        }
        if not versions:
            if require_all:
                problems.append(f"{group.name} has no saved version in {source.path}")
            continue
        found[source.path] = versions

    all_versions = sorted(
        {version for versions in found.values() for version in versions}
    )
    if len(all_versions) > 1:
        details = ", ".join(
            f"{path}={','.join(sorted(versions))}" for path, versions in found.items()
        )
        problems.append(
            f"{group.name} has {len(all_versions)} different saved versions "
            f"({'; '.join(all_versions)}): {details}"
        )
    return problems


def find_unpinned_commands(root: Path) -> list[str]:
    problems = []
    workflows = root / ".github" / "workflows"
    if not workflows.exists():
        return problems
    for path in sorted(workflows.glob("*.yml")):
        for line_number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), 1
        ):
            if line.lstrip().startswith("#"):
                continue
            for command, token in re.findall(
                r"\b(npx|uvx)(?:\s+--yes)?\s+([^\s]+)", line
            ):
                if token.startswith("@"):
                    pinned = token.count("@") >= 2 and bool(re.search(r"@[0-9]", token))
                else:
                    pinned = bool(re.search(r"@[0-9]", token))
                if not pinned:
                    shown = token.rstrip("\\")
                    problems.append(
                        f"{path.relative_to(root)}:{line_number}: {shown} has no saved version"
                    )
            match = re.search(r"\buses:\s+(\S+)", line)
            if (
                match
                and not match.group(1).startswith("./")
                and "@" not in match.group(1)
            ):
                problems.append(
                    f"{path.relative_to(root)}:{line_number}: {match.group(1)} has no saved version"
                )
    return problems


def check_dependabot_coverage(root: Path) -> list[str]:
    path = root / ".github" / "dependabot.yml"
    if not path.exists():
        return ["GitHub's automatic update setup is missing"]
    text = path.read_text(encoding="utf-8")
    found = set(re.findall(r"package-ecosystem:\s*([a-z-]+)", text))
    required = {"docker", "docker-compose", "github-actions", "npm", "uv"}
    return [
        f"GitHub's automatic update setup does not cover {ecosystem}"
        for ecosystem in sorted(required - found)
    ]


def capability_review_date(root: Path) -> date | None:
    path = root / CAPABILITY_GUIDE
    if not path.exists():
        return None
    match = CAPABILITY_REVIEW_PATTERN.search(path.read_text(encoding="utf-8"))
    return date.fromisoformat(match.group(1)) if match else None


def capability_review_due(reviewed_on: date, today: date) -> bool:
    return (today - reviewed_on).days >= 100


def check_support_window(support: SupportWindow, today: date) -> str | None:
    days = (support.support_ends - today).days
    if days > 180:
        return None
    if days < 0:
        return (
            f"{support.name} {support.version} lost support {-days} days ago "
            f"({support.official_url})"
        )
    return (
        f"{support.name} {support.version} loses support in {days} days "
        f"({support.official_url})"
    )


def find_local_problems(root: Path, *, today: date | None = None) -> list[str]:
    today = today or date.today()
    problems = []
    for group in VERSION_GROUPS:
        problems.extend(check_version_group(root, group, require_all=True))
    problems.extend(find_unpinned_commands(root))
    problems.extend(check_dependabot_coverage(root))
    for pin in REGISTRY_PINS:
        if not _source_versions(root, pin.source):
            problems.append(
                f"{pin.name} has no readable saved version in {pin.source.path}"
            )
    reviewed_on = capability_review_date(root)
    if reviewed_on is None:
        problems.append(
            f"{CAPABILITY_GUIDE} has no saved date for the last major-tool review"
        )
    elif capability_review_due(reviewed_on, today):
        problems.append(
            f"The major-tool review is {((today - reviewed_on).days)} days old; "
            "review new capabilities and removals now"
        )
    for support in SUPPORT_WINDOWS:
        problem = check_support_window(support, today)
        if problem:
            problems.append(problem)
    return problems


def javascript_audit_problems(payload: dict) -> list[str]:
    problems = []
    for key, advisory in payload.get("advisories", {}).items():
        if advisory.get("severity") not in SEVERE_LEVELS:
            continue
        advisory_id = advisory.get("github_advisory_id") or key
        if advisory_id not in KNOWN_JAVASCRIPT_EXCEPTIONS:
            problems.append(f"{advisory_id} ({advisory.get('severity', 'unknown')})")
    return sorted(problems)


def python_audit_problems(payload: dict) -> list[str]:
    problems = []
    for dependency in payload.get("dependencies", []):
        for vulnerability in dependency.get("vulns", []):
            problems.append(
                f"{dependency.get('name')} {dependency.get('version')}: "
                f"{vulnerability.get('id', 'unknown vulnerability')}"
            )
    return sorted(problems)


def _run(command: list[str], root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command, cwd=root, capture_output=True, text=True, check=False
    )


def run_security_audits(root: Path) -> list[str]:
    problems = []
    with tempfile.TemporaryDirectory(
        prefix="alethical-technology-health-"
    ) as directory:
        requirements = Path(directory) / "requirements.txt"
        exported = _run(
            [
                "uv",
                "export",
                "--frozen",
                "--no-dev",
                "--no-hashes",
                "--format",
                "requirements-txt",
                "--output-file",
                str(requirements),
            ],
            root,
        )
        if exported.returncode:
            problems.append(
                "Python's locked package list could not be prepared for review"
            )
        else:
            pin = _source_versions(
                root,
                next(pin.source for pin in REGISTRY_PINS if pin.name == "pip-audit"),
            )[0]
            audited = _run(
                [
                    "uvx",
                    f"pip-audit@{pin}",
                    "--requirement",
                    str(requirements),
                    "--progress-spinner",
                    "off",
                    "--strict",
                    "--format",
                    "json",
                ],
                root,
            )
            try:
                payload = json.loads(audited.stdout)
            except json.JSONDecodeError:
                problems.append(
                    "The Python security review returned no readable result"
                )
            else:
                problems.extend(python_audit_problems(payload))

    audited = _run(["pnpm", "audit", "--json"], root)
    try:
        payload = json.loads(audited.stdout)
    except json.JSONDecodeError:
        problems.append("The JavaScript security review returned no readable result")
    else:
        problems.extend(javascript_audit_problems(payload))
    return problems


def _numeric_version(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", version)[:3])


def classify_update(current: str, latest: str, policy: str) -> str | None:
    if current == latest:
        return None
    if policy == "quarterly":
        return "major"
    current_parts = _numeric_version(current)
    latest_parts = _numeric_version(latest)
    if not current_parts or not latest_parts:
        return "major"
    if current_parts[0] != latest_parts[0]:
        return "major"
    if current_parts[0] == 0 and len(current_parts) > 1 and len(latest_parts) > 1:
        if current_parts[1] != latest_parts[1]:
            return "major"
    return "routine"


def _latest_registry_version(pin: RegistryPin) -> str:
    if pin.registry == "npm":
        package = urllib.parse.quote(pin.package, safe="@")
        url = f"https://registry.npmjs.org/{package}/latest"
    else:
        url = f"https://pypi.org/pypi/{pin.package}/json"
    with urllib.request.urlopen(url, timeout=20) as response:
        payload = json.load(response)
    return payload["version"] if pin.registry == "npm" else payload["info"]["version"]


def check_registry_versions(root: Path) -> tuple[list[str], list[str]]:
    routine = []
    major = []
    for pin in REGISTRY_PINS:
        versions = _source_versions(root, pin.source)
        if not versions:
            routine.append(
                f"{pin.name} has no readable saved version in {pin.source.path}"
            )
            continue
        current = versions[0]
        try:
            latest = _latest_registry_version(pin)
        except (OSError, TimeoutError, ValueError, KeyError) as error:
            routine.append(
                f"{pin.name}'s public release list could not be read: {error}"
            )
            continue
        kind = classify_update(current, latest, pin.policy)
        message = f"{pin.name}: {current} saved, {latest} available"
        if kind == "routine":
            routine.append(message)
        elif kind == "major":
            major.append(message)
    return routine, major


def render_report(
    *,
    local: list[str],
    security: list[str],
    routine: list[str],
    major: list[str],
    today: date,
) -> str:
    reviewed_on = capability_review_date(ROOT)
    lines = [
        "# Alethical technology health",
        "",
        f"Checked {today.isoformat()}. This check is read-only and uses no paid service or AI.",
        "",
    ]
    actionable = local + security + routine
    if actionable:
        lines.extend(["## Needs work", ""])
        lines.extend(f"- {problem}" for problem in actionable)
    else:
        lines.extend(["## Needs work", "", "- Nothing found."])
    lines.extend(["", "## Major changes for the next 3-month review", ""])
    lines.extend(f"- {item}" for item in major)
    if not major:
        lines.append("- No newer major tool family was found.")
    lines.extend(
        [
            "",
            "## Support dates",
            "",
            *(
                f"- {support.name} {support.version}: supported through "
                f"{support.support_ends.isoformat()} ([official source]({support.official_url}))"
                for support in SUPPORT_WINDOWS
            ),
            "",
            "## Review record",
            "",
            f"- Last major-tool review: {reviewed_on.isoformat() if reviewed_on else 'missing'}",
            f"- Next review due after: "
            f"{(reviewed_on + timedelta(days=100)).isoformat() if reviewed_on else 'now'}",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--online", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    today = date.today()
    local = find_local_problems(ROOT, today=today)
    security: list[str] = []
    routine: list[str] = []
    major: list[str] = []
    if args.online:
        security = run_security_audits(ROOT)
        routine, major = check_registry_versions(ROOT)

    report = render_report(
        local=local,
        security=security,
        routine=routine,
        major=major,
        today=today,
    )
    print(report)
    if args.report:
        args.report.write_text(report, encoding="utf-8")
    return 1 if local or security or routine else 0


if __name__ == "__main__":
    sys.exit(main())
