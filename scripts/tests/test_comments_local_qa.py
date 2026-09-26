"""The browser helper never borrows production credentials or databases."""

from pathlib import Path

from scripts.comments_local_qa import ACCOUNTS, ADMIN_SUBJECT, local_environment


def test_local_environment_drops_remote_credentials_and_disables_all_mail(monkeypatch):
    for key in (
        "DATABASE_URL",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "RESEND_API_KEY",
        "OPENAI_API_KEY",
        "SENTRY_DSN",
        "HTTPS_PROXY",
    ):
        monkeypatch.setenv(key, "private-production-value")
    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_COMMENT_EMAIL_ENABLED", "true")
    environment = local_environment(Path("/tmp/fictional-qa"))
    assert "private-production-value" not in environment.values()
    assert environment["ALETHICAL_DATABASE_TARGET"] == "local"
    assert environment["ALETHICAL_COMMENT_EMAIL_ENABLED"] == "false"
    assert environment["ALETHICAL_EMAIL_ENABLED"] == "false"
    assert environment["ALETHICAL_EMAIL_TRANSPORT"] == "dry_run"
    assert environment["ALETHICAL_ADMIN_ACCOUNT_IDS"] == ADMIN_SUBJECT


def test_local_test_accounts_have_distinct_fixed_subjects():
    assert set(ACCOUNTS) == {"qa-reader-one", "qa-reader-two", "qa-admin"}
    assert len({account[0] for account in ACCOUNTS.values()}) == 3
    assert ACCOUNTS["qa-admin"] == (ADMIN_SUBJECT, "ask@alethical.com")
