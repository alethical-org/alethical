#!/usr/bin/env python3
"""Run the comments API with disposable PostgreSQL and 3 fictional accounts.

Run: uv run python scripts/comments_local_qa.py
API: http://127.0.0.1:18261
Allowed browser: http://127.0.0.1:19261 (localhost also allowed)
Local-only bearer tokens: qa-reader-one, qa-reader-two, qa-admin

Docker must have the existing pgvector/pgvector:pg17 test image available.
Ctrl-C removes the temporary database. No existing database, account, developer
dotenv file, production credential or outbound email service is used.
"""

from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.local_checks import disposable_postgres, test_environment  # noqa: E402

API_PORT = 18261
WEB_PORT = 19261
ADMIN_SUBJECT = "00000000-0000-4000-8000-000000000003"
ACCOUNTS = {
    "qa-reader-one": (
        "00000000-0000-4000-8000-000000000001",
        "reader-one@example.invalid",
    ),
    "qa-reader-two": (
        "00000000-0000-4000-8000-000000000002",
        "reader-two@example.invalid",
    ),
    "qa-admin": (ADMIN_SUBJECT, "ask@alethical.com"),
}


def local_environment(directory: Path) -> dict[str, str]:
    """Allowlist operating-system essentials; never inherit developer secrets."""
    return {
        **test_environment(directory),
        "ALETHICAL_DATABASE_TARGET": "local",
        "ALETHICAL_COMMENT_EMAIL_ENABLED": "false",
        "ALETHICAL_EMAIL_ENABLED": "false",
        "ALETHICAL_EMAIL_TRANSPORT": "dry_run",
        "ALETHICAL_UNCONCEALED_SEND_ENABLED": "false",
        "ALETHICAL_LOG_DIR": str(directory / "logs"),
        "ALETHICAL_CORS_ORIGINS": f"http://127.0.0.1:{WEB_PORT},http://localhost:{WEB_PORT}",
        "ALETHICAL_ADMIN_ACCOUNT_IDS": ADMIN_SUBJECT,
    }


def run_local_api(database_url: str) -> None:
    # Imported only after the process has a clean environment and its own empty
    # .env sentinel, so session.py cannot search the real checkout for secrets.
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, text
    import uvicorn

    from alethical.api.auth import get_auth_service
    from alethical.api.main import create_app
    from alethical.api.services.auth import AuthenticatedPrincipal
    from alethical.tests.local_database_guard import assert_local_database

    assert_local_database(database_url, "local")
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "alethical" / "alembic"))
    config.set_main_option("prepend_sys_path", str(ROOT))
    command.upgrade(config, "head")
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE SCHEMA auth"))
            connection.execute(
                text("""
                CREATE TABLE auth.users (
                    id uuid PRIMARY KEY, email text,
                    email_confirmed_at timestamptz, deleted_at timestamptz,
                    is_anonymous boolean DEFAULT false, banned_until timestamptz,
                    encrypted_password text DEFAULT 'local-only-placeholder'
                )
            """)
            )
            connection.execute(
                text("CREATE TABLE auth.identities (user_id uuid, provider text)")
            )
            for subject, email in ACCOUNTS.values():
                connection.execute(
                    text(
                        "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (:id, :email, now())"
                    ),
                    {"id": subject, "email": email},
                )
                connection.execute(
                    text(
                        "INSERT INTO auth.identities (user_id, provider) VALUES (:id, 'email')"
                    ),
                    {"id": subject},
                )
    finally:
        engine.dispose()

    class LocalAuth:
        def authenticate(self, token):
            account = ACCOUNTS.get(token)
            if account is None:
                raise ValueError("Invalid local test token")
            subject, email = account
            return AuthenticatedPrincipal("supabase", subject, email, True)

        def resolve_confirmed_email(self, token, principal):
            return self.authenticate(token)

    app = create_app()
    app.dependency_overrides[get_auth_service] = lambda: LocalAuth()
    print(
        f"Local comments API: http://127.0.0.1:{API_PORT}; disposable data; email disabled",
        flush=True,
    )
    uvicorn.run(app, host="127.0.0.1", port=API_PORT, access_log=False)


def main() -> None:
    if "alethical.db.session" in sys.modules:
        raise RuntimeError("Start this helper in a fresh Python process")
    original_directory = Path.cwd()
    with tempfile.TemporaryDirectory(prefix="alethical-comments-qa-") as temporary:
        directory = Path(temporary)
        (directory / ".env").touch(exist_ok=False)
        # The existing readiness check resolves its Alembic script path from
        # cwd. Expose only application code here, retaining the empty .env
        # sentinel instead of returning to a checkout that may hold secrets.
        (directory / "alethical").symlink_to(
            ROOT / "alethical", target_is_directory=True
        )
        clean_environment = local_environment(directory)
        for key in set(os.environ) - clean_environment.keys():
            del os.environ[key]
        os.environ.update(clean_environment)
        os.chdir(directory)
        try:
            with disposable_postgres(ROOT) as database_url:
                os.environ["DATABASE_URL"] = database_url
                run_local_api(database_url)
        finally:
            os.chdir(original_directory)


if __name__ == "__main__":
    main()
