from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from alethical.api.services.contact import log_contact_delivery_readiness


@dataclass
class _FakeResendResponse:
    status_code: int = 200
    headers: dict[str, str] | None = None
    body: dict | None = None

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", "https://api.resend.com/emails/batch")
            raise httpx.HTTPStatusError(
                "provider rejected the message",
                request=request,
                response=httpx.Response(
                    self.status_code,
                    request=request,
                    json=self.body or {},
                ),
            )

    def json(self) -> dict:
        return self.body or {"data": [{"id": "to-alethical"}, {"id": "to-sender"}]}


def _message() -> dict[str, str]:
    return {
        "request_id": "b432b691-308f-45c4-b447-2e947c0dcde5",
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "phone": "612-555-0199",
        "subject": "A correction",
        "message": "The source link on HF 1 should point to the latest version.",
    }


def test_contact_queues_both_copies_in_one_idempotent_batch(
    client, monkeypatch
) -> None:
    calls: list[dict] = []

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _FakeResendResponse()

    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.setenv("ALETHICAL_EMAIL_ALLOWLIST", "ask@alethical.com,ada@example.com")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_not_real")
    monkeypatch.setattr(httpx, "post", fake_post)

    response = client.post("/api/v1/contact", json=_message())

    assert response.status_code == 202
    assert response.json() == {"status": "accepted"}
    assert len(calls) == 1
    assert calls[0]["url"] == "https://api.resend.com/emails/batch"
    assert calls[0]["headers"]["Idempotency-Key"] == (
        "contact-b432b691-308f-45c4-b447-2e947c0dcde5"
    )
    messages = calls[0]["json"]
    assert [message["to"] for message in messages] == [
        ["ask@alethical.com"],
        ["ada@example.com"],
    ]
    assert messages[0]["reply_to"] == "ada@example.com"
    assert messages[1]["reply_to"] == "ask@alethical.com"
    assert all(
        message["from"] == "Alethical <ask@alethical.com>" for message in messages
    )


def test_contact_rejects_invalid_required_fields_before_delivery(
    client, monkeypatch
) -> None:
    delivery_called = False

    def fail_if_called(*_args, **_kwargs):
        nonlocal delivery_called
        delivery_called = True
        raise AssertionError("invalid contact data reached the email provider")

    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_not_real")
    monkeypatch.setattr(httpx, "post", fail_if_called)
    body = _message()
    body.update({"email": "not-an-email", "subject": "  ", "message": ""})

    response = client.post("/api/v1/contact", json=body)

    assert response.status_code == 422
    assert delivery_called is False


def test_contact_never_claims_success_when_live_email_is_off(
    client, monkeypatch, caplog
) -> None:
    monkeypatch.delenv("ALETHICAL_EMAIL_ENABLED", raising=False)
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "console")

    response = client.post("/api/v1/contact", json=_message())

    assert response.status_code == 503
    assert response.json()["type"].endswith("contact-delivery-unavailable")
    assert "enabled=False" in caplog.text
    assert "transport_resend=False" in caplog.text
    assert "key_present=False" in caplog.text
    assert not any(
        _message()[field] in caplog.text
        for field in ("name", "email", "phone", "subject", "message")
    )


def test_contact_readiness_log_reports_presence_without_secret_values(
    monkeypatch, caplog
) -> None:
    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.setenv("ALETHICAL_EMAIL_ALLOWLIST", "ask@alethical.com")
    monkeypatch.setenv("RESEND_API_KEY", "re_private_key_value")

    with caplog.at_level(logging.INFO, logger="alethical.api.services.contact"):
        log_contact_delivery_readiness()

    assert "enabled=True" in caplog.text
    assert "transport_resend=True" in caplog.text
    assert "key_present=True" in caplog.text
    assert "allowlist_configured=True" in caplog.text
    assert "key_starts_re_=True" in caplog.text
    assert "key_wrapped_quotes=False" in caplog.text
    assert "key_contains_whitespace=False" in caplog.text
    assert "key_ascii_printable=True" in caplog.text
    assert "key_length=20" in caplog.text
    assert "re_private_key_value" not in caplog.text
    assert "ask@alethical.com" not in caplog.text


def test_contact_logs_provider_status_without_private_data(
    client, monkeypatch, caplog
) -> None:
    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.delenv("ALETHICAL_EMAIL_ALLOWLIST", raising=False)
    monkeypatch.setenv("RESEND_API_KEY", "re_test_not_real")
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *_args, **_kwargs: _FakeResendResponse(status_code=401),
    )

    response = client.post("/api/v1/contact", json=_message())

    assert response.status_code == 503
    assert "error_type=HTTPStatusError" in caplog.text
    assert "provider_status=401" in caplog.text
    assert not any(
        _message()[field] in caplog.text
        for field in ("name", "email", "phone", "subject", "message")
    )


def test_contact_logs_safe_provider_error_name_and_key_shape(
    client, monkeypatch, caplog
) -> None:
    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.delenv("ALETHICAL_EMAIL_ALLOWLIST", raising=False)
    monkeypatch.setenv("RESEND_API_KEY", '"re_private_key_value"')
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *_args, **_kwargs: _FakeResendResponse(
            status_code=401,
            body={
                "name": "missing_api_key",
                "message": "Do not log re_private_key_value or ada@example.com",
            },
        ),
    )

    response = client.post("/api/v1/contact", json=_message())

    assert response.status_code == 503
    assert "provider_error_name=missing_api_key" in caplog.text
    assert "key_starts_re_=False" in caplog.text
    assert "key_wrapped_quotes=True" in caplog.text
    assert "key_contains_whitespace=False" in caplog.text
    assert "key_ascii_printable=True" in caplog.text
    assert "key_length=22" in caplog.text
    assert "re_private_key_value" not in caplog.text
    assert "ada@example.com" not in caplog.text
    assert "Do not log" not in caplog.text


def test_contact_logs_success_without_private_data(client, monkeypatch, caplog) -> None:
    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.delenv("ALETHICAL_EMAIL_ALLOWLIST", raising=False)
    monkeypatch.setenv("RESEND_API_KEY", "re_test_not_real")
    monkeypatch.setattr(httpx, "post", lambda *_args, **_kwargs: _FakeResendResponse())

    with caplog.at_level(logging.INFO, logger="alethical.api.services.contact"):
        response = client.post("/api/v1/contact", json=_message())

    assert response.status_code == 202
    assert "accepted both messages" in caplog.text
    assert not any(
        _message()[field] in caplog.text
        for field in ("name", "email", "phone", "subject", "message")
    )


def test_contact_logs_an_incomplete_provider_reply(client, monkeypatch, caplog) -> None:
    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.delenv("ALETHICAL_EMAIL_ALLOWLIST", raising=False)
    monkeypatch.setenv("RESEND_API_KEY", "re_test_not_real")
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *_args, **_kwargs: _FakeResendResponse(
            body={"data": [{"id": "only-one-copy"}]}
        ),
    )

    response = client.post("/api/v1/contact", json=_message())

    assert response.status_code == 503
    assert "provider_response_valid=False" in caplog.text
    assert "provider_status=200" in caplog.text
    assert "provider_item_count=1" in caplog.text


def test_contact_does_not_log_an_unknown_provider_error_name(
    client, monkeypatch, caplog
) -> None:
    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.delenv("ALETHICAL_EMAIL_ALLOWLIST", raising=False)
    monkeypatch.setenv("RESEND_API_KEY", "re_test_not_real")
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *_args, **_kwargs: _FakeResendResponse(
            status_code=400,
            body={"name": "private_contact_subject"},
        ),
    )

    response = client.post("/api/v1/contact", json=_message())

    assert response.status_code == 503
    assert "provider_error_name=unrecognized" in caplog.text
    assert "private_contact_subject" not in caplog.text


def test_contact_matches_a_documented_provider_error_name_without_case(
    client, monkeypatch, caplog
) -> None:
    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.delenv("ALETHICAL_EMAIL_ALLOWLIST", raising=False)
    monkeypatch.setenv("RESEND_API_KEY", "re_test_not_real")
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *_args, **_kwargs: _FakeResendResponse(
            status_code=403,
            body={"name": "INVALID_API_KEY"},
        ),
    )

    response = client.post("/api/v1/contact", json=_message())

    assert response.status_code == 503
    assert "provider_error_name=invalid_api_key" in caplog.text


def test_contact_logs_a_connection_failure_without_suggesting_a_key_problem(
    client, monkeypatch, caplog
) -> None:
    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.delenv("ALETHICAL_EMAIL_ALLOWLIST", raising=False)
    monkeypatch.setenv("RESEND_API_KEY", "re_test_not_real")

    def fail_to_connect(*_args, **_kwargs):
        raise httpx.ConnectError(
            "provider is unreachable",
            request=httpx.Request("POST", "https://api.resend.com/emails/batch"),
        )

    monkeypatch.setattr(httpx, "post", fail_to_connect)

    response = client.post("/api/v1/contact", json=_message())

    assert response.status_code == 503
    assert "error_type=ConnectError" in caplog.text
    assert "provider_status=None" in caplog.text
    assert "provider_error_name=unavailable" in caplog.text
    assert "key_starts_re_" not in caplog.text


def test_contact_refuses_a_recipient_outside_the_safety_allowlist(
    client, monkeypatch
) -> None:
    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.setenv("ALETHICAL_EMAIL_ALLOWLIST", "ask@alethical.com")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_not_real")

    response = client.post("/api/v1/contact", json=_message())

    assert response.status_code == 503
    assert response.json()["type"].endswith("contact-delivery-unavailable")


def test_contact_warns_once_at_each_free_plan_daily_threshold(
    client, monkeypatch
) -> None:
    used_values = iter([80, 81, 90, 95, 96])
    warning_calls: list[dict] = []

    def fake_post(url, **kwargs):
        if url.endswith("/emails/batch"):
            used = next(used_values)
            return _FakeResendResponse(
                headers={
                    "x-resend-daily-quota": str(used),
                    "x-resend-monthly-quota": "100",
                }
            )
        warning_calls.append({"url": url, **kwargs})
        return _FakeResendResponse(body={"id": "quota-warning"})

    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.setenv("ALETHICAL_EMAIL_ALLOWLIST", "ask@alethical.com,ada@example.com")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_not_real")
    monkeypatch.setattr(httpx, "post", fake_post)

    for _ in range(5):
        response = client.post("/api/v1/contact", json=_message())
        assert response.status_code == 202

    assert [call["json"]["subject"] for call in warning_calls] == [
        "Resend free plan is 80% full for today",
        "Resend free plan is 90% full for today",
        "Resend free plan is 95% full for today",
    ]
    assert [call["headers"]["Idempotency-Key"] for call in warning_calls] == [
        "quota-warning-daily-80-80",
        "quota-warning-daily-90-90",
        "quota-warning-daily-95-95",
    ]
    assert all(call["url"] == "https://api.resend.com/emails" for call in warning_calls)
    assert all(
        not any(value in str(call["json"]) for value in _message().values())
        for call in warning_calls
    )


def test_contact_warns_for_monthly_capacity_and_resets_after_usage_drops(
    client, monkeypatch
) -> None:
    used_values = iter([2400, 2700, 2850, 10, 2400])
    warning_subjects: list[str] = []

    def fake_post(url, **kwargs):
        if url.endswith("/emails/batch"):
            used = next(used_values)
            return _FakeResendResponse(
                headers={
                    "x-resend-daily-quota": "10",
                    "x-resend-monthly-quota": str(used),
                }
            )
        warning_subjects.append(kwargs["json"]["subject"])
        return _FakeResendResponse(body={"id": "quota-warning"})

    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.setenv("ALETHICAL_EMAIL_ALLOWLIST", "ask@alethical.com,ada@example.com")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_not_real")
    monkeypatch.setattr(httpx, "post", fake_post)

    for _ in range(5):
        response = client.post("/api/v1/contact", json=_message())
        assert response.status_code == 202

    assert warning_subjects == [
        "Resend free plan is 80% full for this month",
        "Resend free plan is 90% full for this month",
        "Resend free plan is 95% full for this month",
        "Resend free plan is 80% full for this month",
    ]


def test_paid_plan_headers_stop_free_plan_warnings(client, monkeypatch) -> None:
    calls: list[str] = []

    def fake_post(url, **_kwargs):
        calls.append(url)
        return _FakeResendResponse(headers={"x-resend-monthly-quota": "45000"})

    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.setenv("ALETHICAL_EMAIL_ALLOWLIST", "ask@alethical.com,ada@example.com")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_not_real")
    monkeypatch.setattr(httpx, "post", fake_post)

    response = client.post("/api/v1/contact", json=_message())

    assert response.status_code == 202
    assert calls == ["https://api.resend.com/emails/batch"]


def test_warning_failure_never_hides_an_accepted_contact_message(
    client, monkeypatch
) -> None:
    def fake_post(url, **_kwargs):
        if url.endswith("/emails/batch"):
            return _FakeResendResponse(
                headers={
                    "x-resend-daily-quota": "80",
                    "x-resend-monthly-quota": "100",
                }
            )
        return _FakeResendResponse(status_code=500)

    monkeypatch.setenv("ALETHICAL_EMAIL_ENABLED", "true")
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "resend")
    monkeypatch.setenv("ALETHICAL_EMAIL_ALLOWLIST", "ask@alethical.com,ada@example.com")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_not_real")
    monkeypatch.setattr(httpx, "post", fake_post)

    response = client.post("/api/v1/contact", json=_message())

    assert response.status_code == 202
