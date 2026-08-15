#!/usr/bin/env python3
"""Compare documented hosted-service settings with their live read APIs.

The intended values live only in ``docs/operations/repo-and-service-settings.md``.
This script parses that Markdown directly. It never keeps a JSON or Python copy of
the expected values.

Every governed row must say how it is checked:

* ``Live`` means this script must read and compare it.
* ``Live with `NAME``` means the row is checked when that narrowly scoped
  credential exists and is reported as unchecked when it does not.
* ``Tracked file`` means ordinary repository tests own the value.
* ``Unchecked: ...`` names the exact missing safe access.

Drift and failed live reads make the command fail. A documented access gap stays
visible and is never counted as a match, but it does not make unrelated checks fail.
No request writes a setting, decrypts a provider variable, or prints a credential.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

ROOT = Path(
    os.environ.get("HOSTED_SETTINGS_ROOT", Path(__file__).resolve().parents[1])
).resolve()
DOC = ROOT / "docs/operations/repo-and-service-settings.md"
RAILWAY_CONFIG = ROOT / "railway.json"

GITHUB_API = "https://api.github.com"
VERCEL_API = "https://api.vercel.com"
RAILWAY_API = "https://backboard.railway.com/graphql/v2"

GOVERNED_SECTIONS = {
    "GitHub repository",
    "Branch protection on main",
    "GitHub Actions secrets",
    "Vercel project",
    "Vercel environment variables",
    "Railway project",
    "Railway environment variables",
    "Supabase sign-in",
}


class State(str, Enum):
    MATCH = "match"
    DRIFT = "drift"
    UNVERIFIED = "unverified"
    UNCHECKED = "unchecked"


@dataclass(frozen=True)
class Result:
    state: State
    provider: str
    setting: str
    detail: str = ""


@dataclass(frozen=True)
class DocRow:
    section: str
    setting: str
    intended: str
    automation: str

    @property
    def key(self) -> tuple[str, str]:
        return self.section, self.setting


@dataclass(frozen=True)
class HttpResponse:
    status: int
    data: object | None
    error: str = ""


Fetcher = Callable[[str, str, Mapping[str, str], object | None], HttpResponse]


def _markdown_cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _is_separator(cells: list[str]) -> bool:
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def _plain(text: str) -> str:
    text = re.sub(r"\[([^]]+)]\([^)]+\)", r"\1", text)
    text = text.replace("**", "").replace("`", "")
    return re.sub(r"\s+", " ", text).strip()


def _codes(text: str) -> list[str]:
    return re.findall(r"`([^`]+)`", text)


def parse_doc(text: str) -> dict[tuple[str, str], DocRow]:
    """Read governed Markdown tables without copying their intended values."""
    section = ""
    headers: list[str] | None = None
    rows: dict[tuple[str, str], DocRow] = {}

    for line in text.splitlines():
        heading = re.match(r"^#{2,3}\s+(.+?)\s*$", line)
        if heading:
            section = _plain(heading.group(1))
            headers = None
            continue

        if section not in GOVERNED_SECTIONS or not line.lstrip().startswith("|"):
            continue

        cells = _markdown_cells(line)
        if _is_separator(cells):
            continue
        if headers is None:
            headers = [_plain(cell) for cell in cells]
            continue
        if len(cells) != len(headers):
            raise ValueError(
                f"{section}: table row has {len(cells)} cells; expected {len(headers)}"
            )

        values = dict(zip(headers, cells, strict=True))
        setting = values.get("Setting") or values.get("Secret")
        intended = values.get("Intended") or values.get("Value")
        automation = values.get("Automated check")
        if not setting or intended is None or automation is None:
            raise ValueError(
                f"{section}: table needs Setting/Secret, Intended/Value, and "
                "Automated check columns"
            )

        row = DocRow(
            section=section,
            setting=_plain(setting),
            intended=intended.strip(),
            automation=automation.strip(),
        )
        if row.key in rows:
            raise ValueError(f"duplicate documented setting: {row.key}")
        rows[row.key] = row

    return rows


def default_fetch(
    method: str,
    url: str,
    headers: Mapping[str, str],
    body: object | None,
) -> HttpResponse:
    request_headers = {
        "Accept": "application/json",
        "User-Agent": "alethical-hosted-settings-check/1",
        **headers,
    }
    encoded = None
    if body is not None:
        encoded = json.dumps(body).encode()
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        url, data=encoded, headers=request_headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return HttpResponse(
                status=response.status,
                data=json.loads(raw) if raw else None,
            )
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            data = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            data = None
        return HttpResponse(status=exc.code, data=data, error=f"HTTP {exc.code}")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return HttpResponse(status=0, data=None, error=type(exc).__name__)


def _bool_word(value: object) -> str:
    return "on" if value is True else "off" if value is False else str(value)


def _intended_bool(row: DocRow) -> bool:
    lowered = _plain(row.intended).lower()
    if lowered.startswith(("on", "yes")):
        return True
    if lowered.startswith(("off", "no", "blocked", "none")):
        return False
    raise ValueError(f"{row.key}: cannot read an on/off intended value")


class Checker:
    def __init__(
        self,
        rows: dict[tuple[str, str], DocRow],
        env: Mapping[str, str] | None = None,
        fetch: Fetcher = default_fetch,
    ) -> None:
        self.rows = rows
        self.env = dict(env if env is not None else os.environ)
        self.fetch = fetch
        self.results: list[Result] = []
        self.handled: set[tuple[str, str]] = set()
        self._cache: dict[str, HttpResponse] = {}

    def row(self, section: str, setting: str) -> DocRow:
        key = (section, setting)
        row = self.rows.get(key)
        if row is None:
            self.results.append(
                Result(
                    State.DRIFT,
                    section,
                    setting,
                    f"no row in {DOC.relative_to(ROOT)}; was it renamed?",
                )
            )
            self.handled.add(key)
            return DocRow(section, setting, "", "Live")
        self.handled.add(key)
        return row

    def record(
        self,
        row: DocRow,
        matches: bool,
        actual: str,
        expected: str | None = None,
    ) -> None:
        self.results.append(
            Result(
                State.MATCH if matches else State.DRIFT,
                row.section,
                row.setting,
                ""
                if matches
                else f"expected {expected or _plain(row.intended)!r}; live is {actual!r}",
            )
        )

    def unavailable(self, row: DocRow, detail: str) -> None:
        self.handled.add(row.key)
        self.results.append(Result(State.UNVERIFIED, row.section, row.setting, detail))

    def unavailable_rows(self, rows: list[DocRow], detail: str) -> None:
        for row in rows:
            if row.key not in self.handled:
                self.unavailable(row, detail)

    def cached_fetch(
        self,
        key: str,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: object | None = None,
    ) -> HttpResponse:
        if key not in self._cache:
            self._cache[key] = self.fetch(method, url, headers, body)
        return self._cache[key]

    def _json_object(
        self, response: HttpResponse, row: DocRow
    ) -> dict[str, object] | None:
        if response.status != 200 or not isinstance(response.data, dict):
            self.unavailable(row, response.error or f"HTTP {response.status}")
            return None
        return response.data

    def check_github(self) -> None:
        repo_name = self.env.get("GITHUB_REPOSITORY", "alethical-org/alethical")
        read_token = self.env.get("GITHUB_READ_TOKEN", "")
        admin_token = self.env.get("REPO_SETTINGS_TOKEN", "")
        token = admin_token or read_token
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        repo_row = self.row("GitHub repository", "Visibility")
        response = self.cached_fetch(
            "github-repo",
            "GET",
            f"{GITHUB_API}/repos/{repo_name}",
            {**headers, "Accept": "application/vnd.github+json"},
        )
        repo = self._json_object(response, repo_row)
        if repo is None:
            checkable = [
                row
                for row in self.rows.values()
                if row.section in {"GitHub repository", "Branch protection on main"}
                and _plain(row.automation).startswith("Live")
                and ("Live with" not in _plain(row.automation) or admin_token)
            ]
            self.unavailable_rows(
                checkable, response.error or "GitHub repository unreadable"
            )
            return

        self.record(
            repo_row,
            str(repo.get("visibility", "")).lower()
            == _plain(repo_row.intended).lower(),
            str(repo.get("visibility")),
        )

        for label, field in {
            "Allow squash merge": "allow_squash_merge",
            "Allow merge commits": "allow_merge_commit",
            "Allow rebase merge": "allow_rebase_merge",
            "Automatically delete head branches": "delete_branch_on_merge",
        }.items():
            row = self.row("GitHub repository", label)
            actual = repo.get(field)
            if not isinstance(actual, bool):
                self.unavailable(row, f"GitHub did not return {field}")
            else:
                self.record(row, actual is _intended_bool(row), _bool_word(actual))

        if not admin_token:
            return

        admin_headers = {
            "Authorization": f"Bearer {admin_token}",
            "Accept": "application/vnd.github+json",
        }
        for label, field in {
            "Secret scanning": "secret_scanning",
            "Secret scanning push protection": "secret_scanning_push_protection",
            "Secret scanning validity checks": "secret_scanning_validity_checks",
        }.items():
            row = self.row("GitHub repository", label)
            security = repo.get("security_and_analysis")
            value = security.get(field) if isinstance(security, dict) else None
            status = value.get("status") if isinstance(value, dict) else None
            if status not in {"enabled", "disabled"}:
                self.unavailable(row, f"GitHub withheld security_and_analysis.{field}")
            else:
                actual = status == "enabled"
                self.record(row, actual is _intended_bool(row), _bool_word(actual))

        for label, path in {
            "Dependabot alerts": "/vulnerability-alerts",
            "Dependabot automatic security fixes": "/automated-security-fixes",
        }.items():
            row = self.row("GitHub repository", label)
            toggle = self.cached_fetch(
                f"github-{path}",
                "GET",
                f"{GITHUB_API}/repos/{repo_name}{path}",
                admin_headers,
            )
            if toggle.status not in {204, 404}:
                self.unavailable(row, toggle.error or f"HTTP {toggle.status}")
            else:
                actual = toggle.status == 204
                self.record(row, actual is _intended_bool(row), _bool_word(actual))

        private_row = self.row("GitHub repository", "Private vulnerability reporting")
        private = self.cached_fetch(
            "github-private-reporting",
            "GET",
            f"{GITHUB_API}/repos/{repo_name}/private-vulnerability-reporting",
            admin_headers,
        )
        private_data = self._json_object(private, private_row)
        if private_data is not None:
            actual = private_data.get("enabled")
            if isinstance(actual, bool):
                self.record(
                    private_row,
                    actual is _intended_bool(private_row),
                    _bool_word(actual),
                )
            else:
                self.unavailable(private_row, "GitHub did not return enabled")

        org_row = self.row(
            "GitHub repository", "Organization two-step login requirement"
        )
        owner = repo_name.split("/", 1)[0]
        org_response = self.cached_fetch(
            "github-org",
            "GET",
            f"{GITHUB_API}/orgs/{owner}",
            admin_headers,
        )
        org = self._json_object(org_response, org_row)
        if org is not None:
            actual = org.get("two_factor_requirement_enabled")
            if isinstance(actual, bool):
                self.record(
                    org_row, actual is _intended_bool(org_row), _bool_word(actual)
                )
            else:
                self.unavailable(
                    org_row, "GitHub withheld two_factor_requirement_enabled"
                )

        self._check_github_protection(repo_name, admin_headers)
        self._check_github_secrets(repo_name, admin_headers)

    def _check_github_protection(
        self, repo_name: str, headers: Mapping[str, str]
    ) -> None:
        parent = self.row("GitHub repository", "Branch protection on main")
        response = self.cached_fetch(
            "github-protection",
            "GET",
            f"{GITHUB_API}/repos/{repo_name}/branches/main/protection",
            headers,
        )
        if response.status == 404:
            self.record(parent, not _intended_bool(parent), "off")
            self.unavailable_rows(
                [
                    row
                    for row in self.rows.values()
                    if row.section == "Branch protection on main"
                ],
                "branch protection is off",
            )
            return
        protection = self._json_object(response, parent)
        if protection is None:
            self.unavailable_rows(
                [
                    row
                    for row in self.rows.values()
                    if row.section == "Branch protection on main"
                ],
                response.error or "GitHub branch protection unreadable",
            )
            return
        self.record(parent, _intended_bool(parent), "on")

        reviews = protection.get("required_pull_request_reviews")
        checks = protection.get("required_status_checks")

        values: dict[str, object] = {
            "Require a pull request": reviews is not None,
            "Required approving reviews": reviews.get("required_approving_review_count")
            if isinstance(reviews, dict)
            else None,
            "Required Code Owner review": reviews.get("require_code_owner_reviews")
            if isinstance(reviews, dict)
            else None,
            "Dismiss old approvals after a new push": reviews.get(
                "dismiss_stale_reviews"
            )
            if isinstance(reviews, dict)
            else None,
            "Required status checks": checks.get("contexts")
            if isinstance(checks, dict)
            else None,
            "Strict (branch must be up to date)": checks.get("strict")
            if isinstance(checks, dict)
            else None,
            "Resolve review conversations": (
                protection.get("required_conversation_resolution") or {}
            ).get("enabled")
            if isinstance(protection.get("required_conversation_resolution"), dict)
            else None,
            "Enforce for admins": (protection.get("enforce_admins") or {}).get(
                "enabled"
            )
            if isinstance(protection.get("enforce_admins"), dict)
            else None,
        }
        for label, actual in values.items():
            row = self.row("Branch protection on main", label)
            if label == "Required approving reviews":
                expected_codes = _codes(row.intended)
                expected = int(
                    expected_codes[0] if expected_codes else _plain(row.intended)
                )
                self.record(row, actual == expected, str(actual), str(expected))
            elif label == "Required status checks":
                expected = sorted(code.strip() for code in _codes(row.intended))
                got = (
                    sorted(str(item) for item in actual)
                    if isinstance(actual, list)
                    else []
                )
                self.record(row, got == expected, ", ".join(got), ", ".join(expected))
            elif isinstance(actual, bool):
                self.record(row, actual is _intended_bool(row), _bool_word(actual))
            else:
                self.unavailable(row, "GitHub omitted this branch-protection field")

        force_row = self.row(
            "Branch protection on main", "Force pushes / branch deletion"
        )
        force = protection.get("allow_force_pushes")
        deletion = protection.get("allow_deletions")
        if isinstance(force, dict) and isinstance(deletion, dict):
            blocked = force.get("enabled") is False and deletion.get("enabled") is False
            self.record(
                force_row,
                blocked is (not _intended_bool(force_row)),
                "blocked" if blocked else "allowed",
            )
        else:
            self.unavailable(
                force_row, "GitHub omitted force-push or branch-deletion fields"
            )

    def _check_github_secrets(self, repo_name: str, headers: Mapping[str, str]) -> None:
        rows = [
            row for row in self.rows.values() if row.section == "GitHub Actions secrets"
        ]
        response = self.cached_fetch(
            "github-actions-secrets",
            "GET",
            f"{GITHUB_API}/repos/{repo_name}/actions/secrets?per_page=100",
            headers,
        )
        representative = (
            rows[0] if rows else self.row("GitHub Actions secrets", "Secret inventory")
        )
        data = self._json_object(response, representative)
        if data is None:
            self.unavailable_rows(
                rows, response.error or "GitHub secret-name list unreadable"
            )
            return
        secrets = data.get("secrets")
        if not isinstance(secrets, list):
            self.unavailable(
                representative, "GitHub did not return the secret-name list"
            )
            return
        expected = {_plain(row.setting) for row in rows}
        actual = {
            str(item.get("name"))
            for item in secrets
            if isinstance(item, dict) and item.get("name")
        }
        extra = sorted(actual - expected)
        for row in rows:
            name = _plain(row.setting)
            self.handled.add(row.key)
            self.results.append(
                Result(
                    State.MATCH if name in actual else State.DRIFT,
                    row.section,
                    name,
                    "" if name in actual else "missing from GitHub Actions",
                )
            )
        if extra:
            self.results.append(
                Result(
                    State.DRIFT,
                    "GitHub Actions secrets",
                    "Undocumented names",
                    ", ".join(extra),
                )
            )

    def _vercel_headers(self) -> tuple[dict[str, str] | None, str]:
        missing = [
            name
            for name in ("VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID")
            if not self.env.get(name)
        ]
        if missing:
            return None, f"missing {', '.join(missing)}"
        return {"Authorization": f"Bearer {self.env['VERCEL_TOKEN']}"}, ""

    def check_vercel(self) -> None:
        headers, missing = self._vercel_headers()
        live_rows = [
            row
            for row in self.rows.values()
            if row.section.startswith("Vercel")
            and _plain(row.automation).startswith("Live")
        ]
        if headers is None:
            for row in live_rows:
                self.handled.add(row.key)
                self.unavailable(row, missing)
            return

        team = urllib.parse.quote(self.env["VERCEL_ORG_ID"], safe="")
        project_id = urllib.parse.quote(self.env["VERCEL_PROJECT_ID"], safe="")
        project_row = self.row("Vercel project", "Project")
        response = self.cached_fetch(
            "vercel-project",
            "GET",
            f"{VERCEL_API}/v9/projects/{project_id}?teamId={team}",
            headers,
        )
        project = self._json_object(response, project_row)
        if project is None:
            self.unavailable_rows(
                live_rows, response.error or "Vercel project settings unreadable"
            )
            return

        project_expected = _codes(project_row.intended)[0]
        self.record(
            project_row,
            project.get("name") == project_expected,
            str(project.get("name")),
            project_expected,
        )

        root_row = self.row("Vercel project", "Root Directory")
        root_expected = _codes(root_row.intended)[0]
        root_actual = project.get("rootDirectory") or "."
        self.record(
            root_row, root_actual == root_expected, str(root_actual), root_expected
        )

        git_row = self.row("Vercel project", "Git repository")
        git_codes = _codes(git_row.intended)
        link = project.get("link") if isinstance(project.get("link"), dict) else {}
        provider_options = (
            project.get("gitProviderOptions")
            if isinstance(project.get("gitProviderOptions"), dict)
            else {}
        )
        actual_repo = f"{link.get('org')}/{link.get('repo')}"
        actual_branch = link.get("productionBranch")
        auto = provider_options.get("createDeployments") == "enabled"
        expected_auto = "automatic releases on" in _plain(git_row.intended).lower()
        git_ok = (
            len(git_codes) >= 2
            and actual_repo == git_codes[0]
            and actual_branch == git_codes[1]
            and auto is expected_auto
        )
        self.record(
            git_row,
            git_ok,
            f"{actual_repo}, branch {actual_branch}, automatic {_bool_word(auto)}",
        )

        protection_row = self.row("Vercel project", "Deployment Protection")
        protection_expected = _codes(protection_row.intended)[0]
        protection = project.get("ssoProtection")
        protection_actual = (
            protection.get("deploymentType") if isinstance(protection, dict) else None
        )
        self.record(
            protection_row,
            protection_actual == protection_expected,
            str(protection_actual),
            protection_expected,
        )

        bypass_row = self.row("Vercel project", "Protection Bypass for Automation")
        bypasses = project.get("protectionBypass")
        bypass_ok = isinstance(bypasses, dict) and any(
            isinstance(value, dict)
            and value.get("scope") == "automation-bypass"
            and value.get("isEnvVar") is True
            for value in bypasses.values()
        )
        self.record(
            bypass_row, bypass_ok is _intended_bool(bypass_row), _bool_word(bypass_ok)
        )

        self._check_vercel_domains(project_id, team, headers)
        self._check_vercel_env(project_id, team, headers)

    def _check_vercel_domains(
        self, project_id: str, team: str, headers: Mapping[str, str]
    ) -> None:
        domain_row = self.row("Vercel project", "Production domain")
        redirect_row = self.row("Vercel project", "Apex redirect")
        response = self.cached_fetch(
            "vercel-domains",
            "GET",
            f"{VERCEL_API}/v9/projects/{project_id}/domains?teamId={team}",
            headers,
        )
        data = self._json_object(response, domain_row)
        if data is None:
            self.unavailable(
                redirect_row, response.error or "Vercel domains unreadable"
            )
            return
        domains = data.get("domains")
        if not isinstance(domains, list):
            self.unavailable(domain_row, "Vercel did not return domains")
            self.unavailable(redirect_row, "Vercel did not return domains")
            return
        by_name = {
            str(item.get("name")): item
            for item in domains
            if isinstance(item, dict) and item.get("name")
        }
        production = _codes(domain_row.intended)[0]
        self.record(
            domain_row, production in by_name, ", ".join(sorted(by_name)), production
        )

        redirect_codes = _codes(redirect_row.intended)
        source = by_name.get(redirect_codes[0]) if redirect_codes else None
        expected_status = int(redirect_codes[2]) if len(redirect_codes) >= 3 else 308
        redirect_ok = (
            isinstance(source, dict)
            and len(redirect_codes) >= 2
            and source.get("redirect") == redirect_codes[1]
            and source.get("redirectStatusCode") == expected_status
        )
        self.record(
            redirect_row,
            redirect_ok,
            f"{source.get('redirect') if isinstance(source, dict) else None}, {source.get('redirectStatusCode') if isinstance(source, dict) else None}",
        )

    def _check_vercel_env(
        self, project_id: str, team: str, headers: Mapping[str, str]
    ) -> None:
        rows = [
            row
            for row in self.rows.values()
            if row.section == "Vercel environment variables"
        ]
        representative = (
            rows[0]
            if rows
            else self.row("Vercel environment variables", "Variable inventory")
        )
        response = self.cached_fetch(
            "vercel-env",
            "GET",
            f"{VERCEL_API}/v10/projects/{project_id}/env?teamId={team}",
            headers,
        )
        data = self._json_object(response, representative)
        if data is None:
            self.unavailable_rows(
                rows, response.error or "Vercel variable names unreadable"
            )
            return
        envs = data.get("envs")
        if not isinstance(envs, list):
            self.unavailable(
                representative, "Vercel did not return environment-variable names"
            )
            self.unavailable_rows(
                rows, "Vercel did not return environment-variable names"
            )
            return

        actual: dict[str, set[str]] = {}
        for item in envs:
            if not isinstance(item, dict) or not item.get("key"):
                continue
            actual.setdefault(str(item["key"]), set()).update(
                str(target).lower() for target in (item.get("target") or [])
            )
        expected_names = {_plain(row.setting) for row in rows}
        for row in rows:
            name = _plain(row.setting)
            expected_targets = {
                _plain(part).lower() for part in row.intended.split(",")
            }
            actual_targets = actual.get(name, set())
            self.handled.add(row.key)
            self.record(
                row,
                actual_targets == expected_targets,
                ", ".join(sorted(actual_targets)) or "missing",
                ", ".join(sorted(expected_targets)),
            )
        extra = sorted(set(actual) - expected_names)
        if extra:
            self.results.append(
                Result(
                    State.DRIFT,
                    "Vercel environment variables",
                    "Undocumented names",
                    ", ".join(extra),
                )
            )

    def check_railway(self) -> None:
        rows = [
            row
            for row in self.rows.values()
            if row.section.startswith("Railway")
            and _plain(row.automation).startswith("Live")
        ]
        token = self.env.get("RAILWAY_TOKEN", "")
        if not token:
            for row in rows:
                self.handled.add(row.key)
                self.unavailable(row, "missing RAILWAY_TOKEN")
            return
        headers = {"project-access-token": token}
        token_query = """
        query ProjectToken {
          projectToken { project { id name } environment { id name } }
        }
        """
        token_row = self.row("Railway project", "Project")
        response = self.cached_fetch(
            "railway-token",
            "POST",
            RAILWAY_API,
            headers,
            {"query": token_query, "variables": {}},
        )
        data = self._graphql_data(response, token_row)
        if data is None:
            self.unavailable_rows(rows, response.error or "Railway project unreadable")
            return
        project_token = data.get("projectToken")
        if not isinstance(project_token, dict):
            self.unavailable(token_row, "Railway did not resolve the project token")
            self.unavailable_rows(rows, "Railway project token could not be resolved")
            return
        project = project_token.get("project")
        environment = project_token.get("environment")
        if not isinstance(project, dict) or not isinstance(environment, dict):
            self.unavailable(token_row, "Railway token lacks a project or environment")
            self.unavailable_rows(rows, "Railway token lacks a project or environment")
            return

        expected_project = _codes(token_row.intended)[0]
        self.record(
            token_row,
            project.get("name") == expected_project,
            str(project.get("name")),
            expected_project,
        )
        env_row = self.row("Railway project", "Environment")
        expected_env = _codes(env_row.intended)[0]
        self.record(
            env_row,
            environment.get("name") == expected_env,
            str(environment.get("name")),
            expected_env,
        )

        config_query = """
        query HostedSettings($projectId: String!, $environmentId: String!) {
          project(id: $projectId) { services { edges { node { id name } } } }
          environment(id: $environmentId) { config(decryptVariables: false) }
        }
        """
        config_response = self.cached_fetch(
            "railway-config",
            "POST",
            RAILWAY_API,
            headers,
            {
                "query": config_query,
                "variables": {
                    "projectId": project.get("id"),
                    "environmentId": environment.get("id"),
                },
            },
        )
        config_row = self.row("Railway project", "Service")
        config_data = self._graphql_data(config_response, config_row)
        if config_data is None:
            self.unavailable_rows(
                rows, config_response.error or "Railway settings unreadable"
            )
            return
        self._check_railway_config(
            config_data,
            str(project.get("id")),
            str(environment.get("id")),
            headers,
        )

    def _graphql_data(
        self, response: HttpResponse, row: DocRow
    ) -> dict[str, object] | None:
        payload = self._json_object(response, row)
        if payload is None:
            return None
        if payload.get("errors"):
            self.unavailable(row, "provider returned a GraphQL error")
            return None
        data = payload.get("data")
        if not isinstance(data, dict):
            self.unavailable(row, "provider returned no GraphQL data")
            return None
        return data

    def _check_railway_config(
        self,
        data: dict[str, object],
        project_id: str,
        environment_id: str,
        headers: Mapping[str, str],
    ) -> None:
        service_row = self.row("Railway project", "Service")
        expected_service = _codes(service_row.intended)[0]
        project = data.get("project")
        services_connection = (
            project.get("services") if isinstance(project, dict) else None
        )
        edges = (
            services_connection.get("edges")
            if isinstance(services_connection, dict)
            else None
        )
        service = next(
            (
                edge.get("node")
                for edge in edges or []
                if isinstance(edge, dict)
                and isinstance(edge.get("node"), dict)
                and edge["node"].get("name") == expected_service
            ),
            None,
        )
        if not isinstance(service, dict):
            self.record(service_row, False, "missing", expected_service)
            self.unavailable_rows(
                [
                    row
                    for row in self.rows.values()
                    if row.section.startswith("Railway")
                ],
                "the documented Railway service is missing",
            )
            return
        self.record(service_row, True, expected_service, expected_service)

        environment = data.get("environment")
        config = environment.get("config") if isinstance(environment, dict) else None
        service_configs = config.get("services") if isinstance(config, dict) else None
        live = (
            service_configs.get(service.get("id"))
            if isinstance(service_configs, dict)
            else None
        )
        if not isinstance(live, dict):
            self.unavailable_rows(
                [
                    row
                    for row in self.rows.values()
                    if row.section.startswith("Railway")
                ],
                "Railway returned no production service config",
            )
            return

        git_row = self.row("Railway project", "Git repository")
        git_codes = _codes(git_row.intended)
        source = live.get("source") if isinstance(live.get("source"), dict) else {}
        repo = source.get("repo")
        branch = source.get("branch")
        automatic = bool(repo and branch)
        expected_auto = "automatic releases on" in _plain(git_row.intended).lower()
        git_ok = (
            len(git_codes) >= 2
            and repo == git_codes[0]
            and branch == git_codes[1]
            and automatic is expected_auto
        )
        self.record(
            git_row,
            git_ok,
            f"{repo}, branch {branch}, automatic {_bool_word(automatic)}",
        )

        ci_row = self.row("Railway project", "Wait for CI")
        wait_for_ci = source.get("checkSuites")
        if isinstance(wait_for_ci, bool):
            self.record(
                ci_row, wait_for_ci is _intended_bool(ci_row), _bool_word(wait_for_ci)
            )
        else:
            self.unavailable(ci_row, "Railway omitted source.checkSuites")

        try:
            repo_config = json.loads(RAILWAY_CONFIG.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            for label in ("Before-deploy command", "Healthcheck path"):
                self.unavailable(
                    self.row("Railway project", label),
                    f"railway.json is unreadable: {type(exc).__name__}",
                )
            repo_config = None
        deploy = live.get("deploy") if isinstance(live.get("deploy"), dict) else {}
        if repo_config is not None:
            for label, live_field, repo_field in (
                ("Before-deploy command", "preDeployCommand", "preDeployCommand"),
                ("Healthcheck path", "healthcheckPath", "healthcheckPath"),
            ):
                row = self.row("Railway project", label)
                expected = repo_config.get("deploy", {}).get(repo_field)
                actual = deploy.get(live_field)
                self.record(row, actual == expected, str(actual), str(expected))

        self._check_railway_domain(
            project_id, environment_id, str(service.get("id")), headers
        )
        self._check_railway_variables(live)

    def _check_railway_domain(
        self,
        project_id: str,
        environment_id: str,
        service_id: str,
        headers: Mapping[str, str],
    ) -> None:
        row = self.row("Railway project", "Production domain")
        query = """
        query Domains($projectId: String!, $environmentId: String!, $serviceId: String!) {
          domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
            serviceDomains { domain }
            customDomains { domain }
          }
        }
        """
        response = self.cached_fetch(
            "railway-domains",
            "POST",
            RAILWAY_API,
            headers,
            {
                "query": query,
                "variables": {
                    "projectId": project_id,
                    "environmentId": environment_id,
                    "serviceId": service_id,
                },
            },
        )
        data = self._graphql_data(response, row)
        if data is None:
            return
        domains = data.get("domains")
        names = {
            str(item.get("domain"))
            for group in ("serviceDomains", "customDomains")
            for item in (domains.get(group) if isinstance(domains, dict) else []) or []
            if isinstance(item, dict) and item.get("domain")
        }
        expected = _codes(row.intended)[0]
        self.record(row, expected in names, ", ".join(sorted(names)), expected)

    def _check_railway_variables(self, live: dict[str, object]) -> None:
        rows = [
            row
            for row in self.rows.values()
            if row.section == "Railway environment variables"
        ]
        variables = live.get("variables")
        if not isinstance(variables, dict):
            self.unavailable_rows(rows, "Railway did not return variable names")
            return
        actual = set(variables)
        expected = {_plain(row.setting) for row in rows}
        for row in rows:
            name = _plain(row.setting)
            self.handled.add(row.key)
            self.results.append(
                Result(
                    State.MATCH if name in actual else State.DRIFT,
                    row.section,
                    name,
                    "" if name in actual else "missing from the production service",
                )
            )
        extras = sorted(actual - expected)
        if extras:
            self.results.append(
                Result(
                    State.DRIFT,
                    "Railway environment variables",
                    "Undocumented names",
                    ", ".join(extras),
                )
            )

    def classify_non_live_rows(self) -> None:
        for row in self.rows.values():
            if row.key in self.handled:
                continue
            automation = _plain(row.automation)
            if automation.startswith("Tracked file"):
                self.handled.add(row.key)
                continue
            if automation.startswith("Unchecked:"):
                self.handled.add(row.key)
                self.results.append(
                    Result(
                        State.UNCHECKED,
                        row.section,
                        row.setting,
                        automation.removeprefix("Unchecked:").strip(),
                    )
                )
                continue
            credential = re.match(r"Live with ([A-Z0-9_]+)", automation)
            if credential and not self.env.get(credential.group(1)):
                self.handled.add(row.key)
                self.results.append(
                    Result(
                        State.UNCHECKED,
                        row.section,
                        row.setting,
                        automation,
                    )
                )

        for row in self.rows.values():
            if row.key not in self.handled:
                self.results.append(
                    Result(
                        State.DRIFT,
                        row.section,
                        row.setting,
                        "marked for a live check but no checker owns the row",
                    )
                )

    def run(self) -> list[Result]:
        self.check_github()
        self.check_vercel()
        self.check_railway()
        self.classify_non_live_rows()
        return self.results


def print_results(results: list[Result]) -> int:
    order = {state: index for index, state in enumerate(State)}
    for result in sorted(
        results, key=lambda item: (order[item.state], item.provider, item.setting)
    ):
        detail = f": {result.detail}" if result.detail else ""
        print(
            f"  {result.state.value.upper():10} {result.provider}: {result.setting}{detail}"
        )

    counts = {
        state: sum(result.state is state for result in results) for state in State
    }
    print(
        "\n"
        f"{counts[State.MATCH]} matched, "
        f"{counts[State.DRIFT]} drifted, "
        f"{counts[State.UNVERIFIED]} unverifiable, "
        f"{counts[State.UNCHECKED]} explicitly unchecked"
    )
    if counts[State.UNCHECKED]:
        print(
            "::warning::Some documented settings are explicitly unchecked. "
            "They are listed above and are not counted as passing."
        )
    if counts[State.DRIFT] or counts[State.UNVERIFIED]:
        print(
            f"::error::Live hosted settings could not be proved against "
            f"{DOC.relative_to(ROOT)}."
        )
        return 1
    return 0


def main() -> int:
    try:
        rows = parse_doc(DOC.read_text())
    except (OSError, ValueError) as exc:
        print(f"::error::Could not read {DOC.relative_to(ROOT)}: {exc}")
        return 1
    return print_results(Checker(rows).run())


if __name__ == "__main__":
    sys.exit(main())
