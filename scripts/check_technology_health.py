#!/usr/bin/env python3
"""Check the whole development toolchain without changing it or spending money."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import tomllib
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
# The reviewed build-only path has no patched upstream release. Any new path,
# version, available fix, or overdue review closes this narrow exception.
IMAGE_SIZE_REVIEW_EXPIRES = date(2026, 10, 18)
IMAGE_SIZE_BUILD_PATH = "apps__frontend>expo>@expo/metro>metro>image-size"


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
        VersionSource("lint-staged.config.mjs", r"ruff@([0-9.]+)"),
        VersionSource("scripts/local_checks.py", r"ruff@([0-9.]+)"),
        VersionSource("pyproject.toml", r"ruff==([0-9.]+)"),
    ),
)
TY_VERSION = VersionGroup(
    "Ty",
    (
        VersionSource("justfile", r"uvx ty@([0-9.]+)"),
        VersionSource(".github/workflows/ci.yml", r"uvx ty@([0-9.]+)"),
        VersionSource("scripts/local_checks.py", r"ty@([0-9.]+)"),
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
        "uv",
        VersionSource(
            ".github/workflows/technology-health.yml",
            r"uses:\s*astral-sh/setup-uv@[^\s]+\s*\n\s*with:\s*\n\s*version:\s*[\"']?([0-9.]+)",
        ),
        "github-release",
        "astral-sh/uv",
    ),
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


def saved_uv_versions(root: Path) -> list[tuple[str, int, str | None]]:
    """Return every setup-uv use with its line number and explicit uv version."""
    versions = []
    workflows = root / ".github" / "workflows"
    if not workflows.exists():
        return versions
    for path in sorted((*workflows.glob("*.yml"), *workflows.glob("*.yaml"))):
        lines = path.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            if "uses: astral-sh/setup-uv@" not in line:
                continue
            indent = len(line) - len(line.lstrip())
            version = None
            for candidate in lines[index + 1 :]:
                candidate_indent = len(candidate) - len(candidate.lstrip())
                if candidate.lstrip().startswith("- ") and candidate_indent <= indent:
                    break
                match = re.match(r"\s*version:\s*[\"']?([0-9.]+)", candidate)
                if match:
                    version = match.group(1)
                    break
            versions.append((str(path.relative_to(root)), index + 1, version))
    return versions


def check_uv_versions(root: Path) -> list[str]:
    found = saved_uv_versions(root)
    problems = [
        f"{path}:{line}: uv has no saved version"
        for path, line, version in found
        if version is None
    ]
    versions = sorted({version for _, _, version in found if version is not None})
    if len(versions) > 1:
        details = ", ".join(
            f"{path}:{line}={version}"
            for path, line, version in found
            if version is not None
        )
        problems.append(
            f"uv has {len(versions)} different saved versions "
            f"({'; '.join(versions)}): {details}"
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
    problems.extend(check_uv_versions(root))
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


def javascript_audit_problems(payload: dict, *, today: date | None = None) -> list[str]:
    today = today or date.today()
    if not isinstance(payload, dict) or "error" in payload:
        raise ValueError("JavaScript audit did not return a report")
    advisories = payload.get("advisories")
    metadata = payload.get("metadata")
    if (
        not isinstance(advisories, dict)
        or not isinstance(metadata, dict)
        or type(metadata.get("totalDependencies")) is not int
        or metadata["totalDependencies"] <= 0
    ):
        raise ValueError("JavaScript audit did not report package coverage")
    problems = []
    for key, advisory in advisories.items():
        if not isinstance(advisory, dict) or advisory.get("severity") not in {
            "info",
            "low",
            "moderate",
            "high",
            "critical",
        }:
            raise ValueError("JavaScript audit returned an invalid advisory")
        advisory_id = advisory.get("github_advisory_id") or key
        findings = advisory.get("findings")
        if (
            advisory_id in KNOWN_JAVASCRIPT_EXCEPTIONS
            and today < IMAGE_SIZE_REVIEW_EXPIRES
            and advisory.get("module_name") == "image-size"
            and advisory.get("patched_versions") == "<0.0.0"
            and isinstance(findings, list)
            and findings
            and all(
                isinstance(finding, dict)
                and finding.get("version") == "1.2.1"
                and finding.get("paths") == [IMAGE_SIZE_BUILD_PATH]
                for finding in findings
            )
        ):
            continue
        problems.append(f"{advisory_id} ({advisory['severity']})")
    return sorted(problems)


def python_audit_problems(payload: dict) -> list[str]:
    if (
        not isinstance(payload, dict)
        or "error" in payload
        or not isinstance(payload.get("dependencies"), list)
        or not payload["dependencies"]
    ):
        raise ValueError("Python audit did not report package coverage")
    problems = []
    for dependency in payload["dependencies"]:
        if (
            not isinstance(dependency, dict)
            or not isinstance(dependency.get("name"), str)
            or not dependency["name"]
            or not isinstance(dependency.get("version"), str)
            or not dependency["version"]
            or not isinstance(dependency.get("vulns"), list)
            or "skip_reason" in dependency
        ):
            raise ValueError("Python audit skipped or could not read a package")
        for vulnerability in dependency["vulns"]:
            if (
                not isinstance(vulnerability, dict)
                or not isinstance(vulnerability.get("id"), str)
                or not vulnerability["id"]
            ):
                raise ValueError("Python audit returned an invalid advisory")
            problems.append(
                f"{dependency['name']} {dependency['version']}: {vulnerability['id']}"
            )
    return sorted(problems)


def _run(command: list[str], root: Path) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command, cwd=root, capture_output=True, text=True, check=False, timeout=180
        )
    except (OSError, subprocess.TimeoutExpired):
        # A missing scanner or timeout is a failed check, never a clean report.
        return subprocess.CompletedProcess(command, 2, "", "Scanner did not complete")


def security_audit_problems(
    audited: subprocess.CompletedProcess[str],
    language: str,
    *,
    expected_python: set[tuple[str, str]] | None = None,
) -> list[str]:
    try:
        payload = json.loads(audited.stdout)
        if language == "Python":
            problems = python_audit_problems(payload)
            has_findings = any(item["vulns"] for item in payload["dependencies"])
            reported = {
                (re.sub(r"[-_.]+", "-", item["name"]).lower(), item["version"])
                for item in payload["dependencies"]
            }
            if expected_python is not None and reported != expected_python:
                problems.append(
                    "The Python security review did not cover every locked package version"
                )
        else:
            problems = javascript_audit_problems(payload)
            has_findings = bool(payload["advisories"])
    except (ValueError, TypeError):
        return [f"The {language} security review returned no complete readable result"]
    # Both scanners use 1 for findings. A nonzero result with no findings, or
    # any other exit code, means the scan failed even if stdout contains JSON.
    if audited.returncode not in (0, 1) or (
        audited.returncode == 1 and not has_findings
    ):
        problems.append(f"The {language} security review did not complete successfully")
    return problems


def locked_python_packages(root: Path) -> list[tuple[str, str]]:
    """Read every registry pair, including packages for other operating systems."""
    project = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))
    project_name = project["project"]["name"]
    lock = tomllib.loads((root / "uv.lock").read_text(encoding="utf-8"))
    entries = lock.get("package")
    if not isinstance(entries, list) or not entries:
        raise ValueError("Python's lock has no package inventory")
    packages = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Python's lock contains an unreadable package")
        name, version, source = (
            entry.get(key) for key in ("name", "version", "source")
        )
        if name == project_name and source == {"virtual": "."}:
            continue
        if (
            not isinstance(name, str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name)
            or not isinstance(version, str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.!+_-]*", version)
            or source != {"registry": "https://pypi.org/simple"}
        ):
            raise ValueError(
                "Python's lock contains an unsupported package source or identity"
            )
        packages.add((re.sub(r"[-_.]+", "-", name).lower(), version))
    if not packages:
        raise ValueError("Python's lock contains no registry packages")
    return sorted(packages)


def run_security_audits(root: Path) -> list[str]:
    problems = []
    with tempfile.TemporaryDirectory(
        prefix="alethical-technology-health-"
    ) as directory:
        current = _run(["uv", "lock", "--check", "--offline"], root)
        if current.returncode:
            problems.append(
                "Python's locked package list is stale or could not be checked"
            )
        else:
            try:
                packages = locked_python_packages(root)
                pin = _source_versions(
                    root,
                    next(
                        pin.source for pin in REGISTRY_PINS if pin.name == "pip-audit"
                    ),
                )[0]
            except (OSError, ValueError, KeyError, IndexError):
                problems.append(
                    "Python's locked package inventory or scanner version is unreadable or unsupported"
                )
            else:
                # pip-audit rejects duplicate names even with --no-deps. Split
                # alternate locked versions so every pair is checked exactly once.
                batches: list[list[tuple[str, str]]] = []
                versions_per_name: dict[str, int] = {}
                for name, version in packages:
                    index = versions_per_name.get(name, 0)
                    if index == len(batches):
                        batches.append([])
                    batches[index].append((name, version))
                    versions_per_name[name] = index + 1
                for index, batch in enumerate(batches):
                    requirements = Path(directory) / f"requirements-{index}.txt"
                    requirements.write_text(
                        "".join(f"{name}=={version}\n" for name, version in batch),
                        encoding="utf-8",
                    )
                    audited = _run(
                        [
                            "uvx",
                            f"pip-audit@{pin}",
                            "--requirement",
                            str(requirements),
                            "--progress-spinner",
                            "off",
                            "--strict",
                            "--no-deps",
                            "--disable-pip",
                            "--format",
                            "json",
                        ],
                        root,
                    )
                    problems.extend(
                        security_audit_problems(
                            audited, "Python", expected_python=set(batch)
                        )
                    )
                print(
                    f"Python lock inventory: {len(packages)} package versions across all platforms."
                )

    audited = _run(["pnpm", "audit", "--json"], root)
    problems.extend(security_audit_problems(audited, "JavaScript"))
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
    elif pin.registry == "github-release":
        url = f"https://api.github.com/repos/{pin.package}/releases/latest"
    else:
        url = f"https://pypi.org/pypi/{pin.package}/json"
    with urllib.request.urlopen(url, timeout=20) as response:
        payload = json.load(response)
    if pin.registry == "npm":
        return payload["version"]
    if pin.registry == "github-release":
        return payload["tag_name"].removeprefix("v")
    return payload["info"]["version"]


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
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--online", action="store_true")
    mode.add_argument("--security-only", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    today = date.today()
    local = [] if args.security_only else find_local_problems(ROOT, today=today)
    security: list[str] = []
    routine: list[str] = []
    major: list[str] = []
    if args.online or args.security_only:
        security = run_security_audits(ROOT)
    if args.online:
        routine, major = check_registry_versions(ROOT)

    if args.security_only:
        report = "\n".join(
            ["# Dependency security", ""]
            + (
                [f"- {problem}" for problem in security]
                if security
                else ["- No unreviewed vulnerabilities found."]
            )
            + [""]
        )
    else:
        report = render_report(
            local=local,
            security=security,
            routine=routine,
            major=major,
            today=today,
        )
    if args.online or args.security_only:
        report += (
            "\nRecorded exception policy: only image-size 1.2.1 in Expo's Metro "
            "build tool may retain "
            + ", ".join(sorted(KNOWN_JAVASCRIPT_EXCEPTIONS))
            + f" until {IMAGE_SIZE_REVIEW_EXPIRES.isoformat()}, while no patched "
            "release is reported. A changed version or dependency path also "
            "ends the exception.\n"
        )
    print(report)
    if args.report:
        args.report.write_text(report, encoding="utf-8")
    return 1 if local or security or routine else 0


if __name__ == "__main__":
    sys.exit(main())
