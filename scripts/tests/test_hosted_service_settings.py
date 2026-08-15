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

    def test_unreadable_public_github_row_is_not_drift_or_match(self) -> None:
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
        self.assertEqual(len(base_results), 1)
        self.assertTrue(
            all(result.state is settings.State.UNVERIFIED for result in base_results)
        )

    def test_github_admin_rows_stay_unchecked_without_admin_token(self) -> None:
        fetch = FakeFetch(
            {
                "/repos/alethical-org/alethical": settings.HttpResponse(
                    200, {"visibility": "public"}
                )
            }
        )
        results = settings.Checker(
            self.rows,
            env={"GITHUB_REPOSITORY": "alethical-org/alethical"},
            fetch=fetch,
        ).run()
        merge_settings = {
            "Allow squash merge",
            "Allow merge commits",
            "Allow rebase merge",
            "Automatically delete head branches",
        }
        admin_results = [
            result
            for result in results
            if result.provider == "GitHub repository"
            and result.setting in merge_settings
        ]
        self.assertEqual(len(admin_results), 4)
        self.assertTrue(
            all(result.state is settings.State.UNCHECKED for result in admin_results)
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
            and settings._plain(row.intended).lower().startswith("present")
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
                                                "preDeployCommand": None,
                                                "healthcheckPath": "/healthz",
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
                            "serviceInstance": {"railwayConfigFile": None},
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
        config_file = next(
            result
            for result in checker.results
            if result.provider == "Railway project"
            and result.setting == "Configuration file"
        )
        self.assertIs(config_file.state, settings.State.MATCH)
        self.assertEqual(len(fetch.calls), 4)
        config_body = str(fetch.calls[1][3])
        self.assertIn("decryptVariables: false", config_body)
        self.assertNotIn("test-token", config_body)
        config_file_body = fetch.calls[2][3]
        self.assertIsInstance(config_file_body, dict)
        self.assertIn("railwayConfigFile", str(config_file_body))
        self.assertEqual(
            config_file_body["variables"],
            {"environmentId": "environment-id", "serviceId": "service-id"},
        )

    def test_railway_default_config_file_matches_root_railway_json(self) -> None:
        fetch = FakeFetch(
            {
                "graphql/v2": settings.HttpResponse(
                    200,
                    {"data": {"serviceInstance": {"railwayConfigFile": None}}},
                )
            }
        )
        checker = settings.Checker(self.rows, env={}, fetch=fetch)

        checker._check_railway_config_file(
            "environment-id", "service-id", {"project-access-token": "test-token"}
        )

        result = next(
            result
            for result in checker.results
            if result.setting == "Configuration file"
        )
        self.assertIs(result.state, settings.State.MATCH)
        body = fetch.calls[0][3]
        self.assertIsInstance(body, dict)
        self.assertIn("railwayConfigFile", str(body))
        self.assertEqual(
            body["variables"],
            {"environmentId": "environment-id", "serviceId": "service-id"},
        )

    def test_railway_config_file_uses_trusted_checker(self) -> None:
        row = self.rows[("Railway project", "Configuration file")]
        self.assertTrue(settings._plain(row.automation).startswith("Live"))

    def test_railway_custom_config_file_is_reported_as_drift(self) -> None:
        fetch = FakeFetch(
            {
                "graphql/v2": settings.HttpResponse(
                    200,
                    {
                        "data": {
                            "serviceInstance": {
                                "railwayConfigFile": "/backend/railway.toml"
                            }
                        }
                    },
                )
            }
        )
        checker = settings.Checker(self.rows, env={}, fetch=fetch)

        checker._check_railway_config_file(
            "environment-id", "service-id", {"project-access-token": "test-token"}
        )

        result = next(
            result
            for result in checker.results
            if result.setting == "Configuration file"
        )
        self.assertIs(result.state, settings.State.DRIFT)
        self.assertIn("backend/railway.toml", result.detail)

    def test_railway_code_settings_name_the_exact_unchecked_read(self) -> None:
        settings_from_code = {
            "Build command",
            "Before-deploy command",
            "Start command",
            "Healthcheck path",
            "Healthcheck timeout",
            "Restart policy",
        }
        rows = {
            row.setting: row
            for row in self.rows.values()
            if row.section == "Railway project" and row.setting in settings_from_code
        }
        self.assertEqual(set(rows), settings_from_code)
        self.assertTrue(
            all(
                "typed effective-deployment fields" in row.automation
                and "RAILWAY_TOKEN" in row.automation
                for row in rows.values()
            )
        )

        checker = settings.Checker(self.rows, env={}, fetch=FakeFetch({}))
        checker.classify_non_live_rows()
        results = {
            result.setting: result
            for result in checker.results
            if result.provider == "Railway project"
            and result.setting in settings_from_code
        }
        self.assertEqual(set(results), settings_from_code)
        self.assertTrue(
            all(result.state is settings.State.UNCHECKED for result in results.values())
        )

    def test_railway_absent_variable_is_checked_both_ways(self) -> None:
        present_names = {
            settings._plain(row.setting): {"isSealed": True}
            for row in self.rows.values()
            if row.section == "Railway environment variables"
            and settings._plain(row.intended).lower().startswith("present")
        }
        checker = settings.Checker(self.rows, env={}, fetch=FakeFetch({}))
        checker._check_railway_variables({"variables": present_names})
        internal = next(
            result
            for result in checker.results
            if result.setting == "INTERNAL_API_TOKEN"
        )
        self.assertIs(internal.state, settings.State.MATCH)

        checker = settings.Checker(self.rows, env={}, fetch=FakeFetch({}))
        checker._check_railway_variables(
            {"variables": {**present_names, "INTERNAL_API_TOKEN": {"isSealed": True}}}
        )
        internal = next(
            result
            for result in checker.results
            if result.setting == "INTERNAL_API_TOKEN"
        )
        self.assertIs(internal.state, settings.State.DRIFT)
        self.assertIn("documented as absent", internal.detail)

    def test_supabase_refreshes_read_only_oauth_and_compares_auth_config(self) -> None:
        fetch = FakeFetch(
            {
                "/v1/oauth/token": settings.HttpResponse(
                    200,
                    {
                        "access_token": "short-lived-access-token",
                        "refresh_token": "next-refresh-token",
                        "expires_in": 3600,
                        "token_type": "Bearer",
                    },
                ),
                "/config/auth": settings.HttpResponse(
                    200,
                    {
                        "site_url": "https://www.alethical.com",
                        "uri_allow_list": ",".join(
                            [
                                "https://www.alethical.com/**",
                                "http://localhost:8081/**",
                                "http://127.0.0.1:8081/**",
                                "http://localhost:19006/**",
                                "http://127.0.0.1:19006/**",
                                "alethical://auth/callback",
                            ]
                        ),
                        "external_email_enabled": True,
                        "external_google_enabled": True,
                        "mailer_autoconfirm": False,
                        "security_manual_linking_enabled": False,
                        "password_min_length": 15,
                        "password_required_characters": "",
                        "password_hibp_enabled": True,
                        "security_update_password_require_reauthentication": False,
                        "security_captcha_enabled": False,
                        "mailer_templates_confirmation_content": (
                            '<a href="https://www.alethical.com/confirm#'
                            'token_hash={{ .TokenHash }}&type=email">Confirm</a>'
                        ),
                        "mailer_templates_recovery_content": (
                            '<a href="https://www.alethical.com/reset#'
                            'token_hash={{ .TokenHash }}&type=recovery">Reset</a>'
                        ),
                        "mailer_notifications_password_changed_enabled": True,
                        "smtp_host": "smtp.resend.com",
                        "smtp_admin_email": "ask@alethical.com",
                        "smtp_pass": "private-smtp-password",
                        "rate_limit_email_sent": 30,
                        "rate_limit_otp": 30,
                    },
                ),
            }
        )
        checker = settings.Checker(
            self.rows,
            env={
                "SUPABASE_OAUTH_REQUIRED": "true",
                "SUPABASE_OAUTH_CLIENT_ID": "client-id",
                "SUPABASE_OAUTH_CLIENT_SECRET": "client-secret",
                "SUPABASE_OAUTH_REFRESH_TOKEN": "refresh-token",
                "SUPABASE_PROJECT_REF": "naakzorbkqqgbsreulqi",
            },
            fetch=fetch,
        )

        checker.check_supabase()

        supabase_results = [
            result
            for result in checker.results
            if result.provider == "Supabase sign-in"
        ]
        self.assertEqual(len(supabase_results), 17)
        self.assertTrue(
            all(result.state is settings.State.MATCH for result in supabase_results)
        )
        self.assertEqual([call[0] for call in fetch.calls], ["POST", "GET"])
        self.assertEqual(
            fetch.calls[0][3],
            {"grant_type": "refresh_token", "refresh_token": "refresh-token"},
        )
        self.assertIn("Basic ", fetch.calls[0][2]["Authorization"])
        self.assertEqual(fetch.calls[1][3], None)
        self.assertTrue(all(call[0] != "PATCH" for call in fetch.calls))

    def test_missing_or_expired_supabase_grant_fails_as_unreadable(self) -> None:
        checker = settings.Checker(
            self.rows,
            env={
                "SUPABASE_OAUTH_REQUIRED": "true",
                "SUPABASE_PROJECT_REF": "naakzorbkqqgbsreulqi",
            },
            fetch=FakeFetch({}),
        )
        checker.check_supabase()
        missing_results = [
            result
            for result in checker.results
            if result.provider == "Supabase sign-in"
        ]
        self.assertEqual(len(missing_results), 17)
        self.assertTrue(
            all(result.state is settings.State.UNVERIFIED for result in missing_results)
        )

        fetch = FakeFetch(
            {"/v1/oauth/token": settings.HttpResponse(401, None, "HTTP 401")}
        )
        checker = settings.Checker(
            self.rows,
            env={
                "SUPABASE_OAUTH_REQUIRED": "true",
                "SUPABASE_OAUTH_CLIENT_ID": "client-id",
                "SUPABASE_OAUTH_CLIENT_SECRET": "client-secret",
                "SUPABASE_OAUTH_REFRESH_TOKEN": "expired-refresh-token",
                "SUPABASE_PROJECT_REF": "naakzorbkqqgbsreulqi",
            },
            fetch=fetch,
        )
        checker.check_supabase()
        expired_results = [
            result
            for result in checker.results
            if result.provider == "Supabase sign-in"
        ]
        self.assertTrue(
            all(result.state is settings.State.UNVERIFIED for result in expired_results)
        )
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(settings.print_results(expired_results), 1)

    def test_supabase_template_drift_never_prints_template_contents(self) -> None:
        private_template = (
            '<a href="https://wrong.example/confirm?token_hash=PRIVATE-VALUE">'
            "Confirm</a>"
        )
        fetch = FakeFetch(
            {
                "/v1/oauth/token": settings.HttpResponse(
                    200,
                    {"access_token": "short-lived", "token_type": "Bearer"},
                ),
                "/config/auth": settings.HttpResponse(
                    200,
                    {
                        "mailer_templates_confirmation_content": private_template,
                    },
                ),
            }
        )
        checker = settings.Checker(
            self.rows,
            env={
                "SUPABASE_OAUTH_REQUIRED": "true",
                "SUPABASE_OAUTH_CLIENT_ID": "client-id",
                "SUPABASE_OAUTH_CLIENT_SECRET": "client-secret",
                "SUPABASE_OAUTH_REFRESH_TOKEN": "refresh-token",
                "SUPABASE_PROJECT_REF": "naakzorbkqqgbsreulqi",
            },
            fetch=fetch,
        )
        checker.check_supabase()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            settings.print_results(checker.results)
        self.assertNotIn(private_template, output.getvalue())
        self.assertNotIn("PRIVATE-VALUE", output.getvalue())

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
