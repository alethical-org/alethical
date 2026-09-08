from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.exc import SQLAlchemyError

from alethical.api.routers.me import me
from alethical.api.services.admin_access import administrator_menu_access

SUBJECT = "11111111-1111-4111-8111-111111111111"


@pytest.fixture(scope="module", autouse=True)
def seed_database():
    """These tests only use a stand-in database."""


@pytest.mark.parametrize("configured", ["", "invalid", SUBJECT + ",invalid"])
def test_unconfigured_or_invalid_grants_do_not_query(monkeypatch, configured):
    monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", configured)
    db = Mock()
    assert administrator_menu_access(db, SUBJECT) is False
    db.scalar.assert_not_called()


def test_read_failure_preserves_legacy_access_check(monkeypatch):
    monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", SUBJECT)
    db = Mock()
    db.scalar.side_effect = SQLAlchemyError("unavailable")
    assert administrator_menu_access(db, SUBJECT) is None
    db.rollback.assert_called_once()


@pytest.mark.parametrize(
    "provider,expected_subject", [("supabase", SUBJECT), ("local", None)]
)
def test_me_uses_verified_provider_subject_for_menu_hint(
    monkeypatch, provider, expected_subject
):
    hint = Mock(return_value=True)
    monkeypatch.setattr("alethical.api.routers.me.administrator_menu_access", hint)
    monkeypatch.setattr(
        "alethical.api.routers.me.current_supabase_sign_in_methods",
        Mock(return_value=None),
    )
    request = SimpleNamespace(
        state=SimpleNamespace(auth_provider=provider, auth_provider_subject=SUBJECT)
    )
    user = SimpleNamespace(
        id=SUBJECT, display_name="Reader", primary_email="reader@example.test"
    )
    db = Mock()
    result = me(request, db, user)
    assert result.data["is_admin"] is True
    hint.assert_called_once_with(db, expected_subject)
