from unittest.mock import Mock

from alethical.api.services.sign_in_methods import current_supabase_sign_in_methods


def _database(*, readable: bool, row=None):
    db = Mock()
    readable_result = Mock()
    readable_result.scalar_one.return_value = readable
    methods_result = Mock()
    methods_result.mappings.return_value.one_or_none.return_value = row
    db.execute.side_effect = [readable_result, methods_result]
    return db


def test_reads_google_and_password_as_booleans_without_returning_password_data():
    db = _database(readable=True, row={"google": True, "password": True})
    subject = "5f3a0c0e-2c2b-4b9f-9c1a-0f2c8f6d7e11"

    result = current_supabase_sign_in_methods(db, subject)

    assert result == {"google": True, "password": True}
    sql = str(db.execute.call_args_list[1].args[0])
    assert "encrypted_password" in sql
    assert "SELECT u.encrypted_password" not in sql
    assert "auth_user.id = CAST(:subject AS uuid)" in sql
    assert db.execute.call_args_list[1].args[1] == {"subject": subject}


def test_returns_unknown_when_the_supabase_auth_tables_are_not_readable():
    db = _database(readable=False)

    assert (
        current_supabase_sign_in_methods(db, "5f3a0c0e-2c2b-4b9f-9c1a-0f2c8f6d7e11")
        is None
    )
    assert db.execute.call_count == 1


def test_returns_unknown_when_the_request_has_no_supabase_subject():
    db = Mock()

    assert current_supabase_sign_in_methods(db, None) is None
    db.execute.assert_not_called()


def test_returns_unknown_without_querying_for_a_non_uuid_subject():
    db = Mock()

    assert current_supabase_sign_in_methods(db, "local-dev-subject") is None
    db.execute.assert_not_called()
