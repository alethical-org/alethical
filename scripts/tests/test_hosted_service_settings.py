from __future__ import annotations

import contextlib
import importlib.util
import io
import sys
import unittest
from pathlib import Path

SETTINGS_PATH = Path(__file__).resolve().parents[1] / "check_hosted_service_settings.py"
SPEC = importlib.util.spec_from_file_location(
    "check_hosted_service_settings", SETTINGS_PATH
)
assert SPEC is not None and SPEC.loader is not None
settings = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = settings
SPEC.loader.exec_module(settings)


class FakeFetch:
    def __init__(self, responses: dict[str, settings.HttpResponse]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, str, dict[str, str], object | None]] = []

    def __call__(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: object | None,
    ) -> settings.HttpResponse:
        self.calls.append((method, url, dict(headers), body))
        for marker, response in self.responses.items():
            if marker in url:
                return response
        raise AssertionError(f"unexpected request: {method} {url}")


class HostedSettingsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.rows = settings.parse_doc(settings.DOC.read_text())

    def test_markdown_is_the_only_intended_value_source(self) -> None:
        self.assertGreater(len(self.rows), 70)
        self.assertEqual(
            self.rows[("GitHub Actions secrets", "REPO_SETTINGS_TOKEN")].intended
            if ("GitHub Actions secrets", "REPO_SETTINGS_TOKEN") in self.rows
            else "absent by design",
            "absent by design",
        )
        self.assertEqual(
            self.rows[("Vercel environment variables", "EXPO_PUBLIC_API_URL")].intended,
            "Preview, Production",
        )
        self.assertTrue(all(row.automation for row in self.rows.values()))

    def test_markdown_cleanup_preserves_setting_underscores(self) -> None:
        self.assertEqual(
            settings._plain("Live with `REPO_SETTINGS_TOKEN`; #1557"),
            "Live with REPO_SETTINGS_TOKEN; #1557",
        )
        self.assertEqual(
            settings._plain("`SUPABASE_PROJECT_URL`"), "SUPABASE_PROJECT_URL"
        )

    def test_missing_required_provider_credentials_fail(self) -> None:
        fetch = FakeFetch(
            {
                "/repos/alethical-org/alethical": settings.HttpResponse(
                    200,
                    {
                        "visibility": "public",
                        "allow_squash_merge": True,
                        "allow_merge_commit": False,
                        "allow_rebase_merge": False,
                        "delete_branch_on_merge": True,
                    },
                )
            }
        )
        results = settings.Checker(
            self.rows,
            env={"GITHUB_REPOSITORY": "alethical-org/alethical"},
            fetch=fetch,
        ).run()
        self.assertTrue(any(result.state is settings.State.MATCH for result in results))
        self.assertTrue(
            any(
                result.state is settings.State.UNVERIFIED
                and result.provider.startswith("Vercel")
                for result in results
            )
        )
        self.assertTrue(
            any(
                result.state is settings.State.UNVERIFIED
                and result.provider.startswith("Railway")
                for result in results
            )
        )
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(settings.print_results(results), 1)

    def test_unreadable_github_rows_are_not_reported_as_drift_or_match(self) -> None:
        fetch = FakeFetch(
            {
                "/repos/alethical-org/alethical": settings.HttpResponse(
                    0, None, "network unavailable"
                )
            }
        )
        checker = settings.Checker(
            self.rows,
            env={"GITHUB_REPOSITORY": "alethical-org/alethical"},
            fetch=fetch,
        )
        checker.check_github()
        base_results = [
            result
            for result in checker.results
            if result.provider == "GitHub repository"
            and result.setting
            in {
                "Visibility",
                "Allow squash merge",
                "Allow merge commits",
                "Allow rebase merge",
                "Automatically delete head branches",
            }
        ]
        self.assertEqual(len(base_results), 5)
        self.assertTrue(
            all(result.state is settings.State.UNVERIFIED for result in base_results)
        )

    def test_vercel_reads_names_and_targets_without_values(self) -> None:
        expected_env = [
            {
                "key": row.setting,
                "target": [
                    settings._plain(part).lower() for part in row.intended.split(",")
                ],
            }
            for row in self.rows.values()
            if row.section == "Vercel environment variables"
        ]
        fetch = FakeFetch(
            {
                "/v9/projects/project-id?": settings.HttpResponse(
                    200,
                    {
                        "name": "alethical-web",
                        "rootDirectory": None,
                        "link": {
                            "org": "alethical-org",
                            "repo": "alethical",
                            "productionBranch": "main",
                        },
                        "gitProviderOptions": {"createDeployments": "enabled"},
                        "ssoProtection": {
                            "deploymentType": "all_except_custom_domains"
                        },
                        "protectionBypass": {
                            "id": {
                                "scope": "automation-bypass",
                                "isEnvVar": True,
                            }
                        },
                    },
                ),
                "/domains?": settings.HttpResponse(
                    200,
                    {
                        "domains": [
                            {"name": "www.alethical.com"},
                            {
                                "name": "alethical.com",
                                "redirect": "www.alethical.com",
                                "redirectStatusCode": 308,
                            },
                        ]
                    },
                ),
                "/env?": settings.HttpResponse(200, {"envs": expected_env}),
            }
        )
        checker = settings.Checker(
            self.rows,
            env={
                "VERCEL_TOKEN": "test-token",
                "VERCEL_ORG_ID": "team-id",
                "VERCEL_PROJECT_ID": "project-id",
            },
            fetch=fetch,
        )
        checker.check_vercel()
        self.assertTrue(checker.results)
        self.assertTrue(
            all(result.state is settings.State.MATCH for result in checker.results)
        )
        self.assertTrue(all("decrypt" not in url for _, url, _, _ in fetch.calls))
        self.assertTrue(all(body is None for _, _, _, body in fetch.calls))

    def test_railway_asks_for_masked_variable_names_only(self) -> None:
        variable_names = {
            row.setting: {"isSealed": True}
            for row in self.rows.values()
            if row.section == "Railway environment variables"
        }
        fetch = FakeFetch(
            {
                "graphql/v2": settings.HttpResponse(
                    200,
                    {
                        "data": {
                            "projectToken": {
                                "project": {"id": "project-id", "name": "alethical"},
                                "environment": {
                                    "id": "environment-id",
                                    "name": "production",
                                },
                            }
                        }
                    },
                )
            }
        )
        checker = settings.Checker(
            self.rows,
            env={"RAILWAY_TOKEN": "test-token"},
            fetch=fetch,
        )

        responses = iter(
            [
                fetch.responses["graphql/v2"],
                settings.HttpResponse(
                    200,
                    {
                        "data": {
                            "project": {
                                "services": {
                                    "edges": [
                                        {
                                            "node": {
                                                "id": "service-id",
                                                "name": "alethical-api",
                                            }
                                        }
                                    ]
                                }
                            },
                            "environment": {
                                "config": {
                                    "services": {
                                        "service-id": {
                                            "source": {
                                                "repo": "alethical-org/alethical",
                                                "branch": "main",
                                                "checkSuites": False,
                                            },
                                            "deploy": {
                                                "preDeployCommand": "uv run python -m alembic -c alembic.ini upgrade head",
                                                "healthcheckPath": "/readyz",
                                            },
                                            "variables": variable_names,
                                        }
                                    }
                                }
                            },
                        }
                    },
                ),
                settings.HttpResponse(
                    200,
                    {
                        "data": {
                            "domains": {
                                "serviceDomains": [
                                    {
                                        "domain": "alethical-api-production.up.railway.app"
                                    }
                                ],
                                "customDomains": [],
                            }
                        }
                    },
                ),
            ]
        )

        def railway_fetch(method, url, headers, body):
            fetch.calls.append((method, url, dict(headers), body))
            return next(responses)

        checker.fetch = railway_fetch
        checker.check_railway()
        self.assertTrue(checker.results)
        self.assertTrue(
            all(result.state is settings.State.MATCH for result in checker.results)
        )
        config_body = str(fetch.calls[1][3])
        self.assertIn("decryptVariables: false", config_body)
        self.assertNotIn("test-token", config_body)

    def test_explicit_access_gaps_are_visible_but_not_matches(self) -> None:
        gap = settings.Result(
            settings.State.UNCHECKED,
            "Supabase sign-in",
            "Email provider",
            "Supabase OAuth auth:read grant; #1558",
        )
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exit_code = settings.print_results([gap])
        self.assertEqual(exit_code, 0)
        self.assertIn("0 matched", output.getvalue())
        self.assertIn("not counted as passing", output.getvalue())


if __name__ == "__main__":
    unittest.main()
