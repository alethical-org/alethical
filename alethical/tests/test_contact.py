from __future__ import annotations

from dataclasses import dataclass

import httpx


@dataclass
class _FakeResendResponse:
    status_code: int = 200

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "provider rejected the message",
                request=httpx.Request("POST", "https://api.resend.com/emails/batch"),
                response=httpx.Response(self.status_code),
            )

    def json(self) -> dict:
        return {"data": [{"id": "to-alethical"}, {"id": "to-sender"}]}


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
    client, monkeypatch
) -> None:
    monkeypatch.delenv("ALETHICAL_EMAIL_ENABLED", raising=False)
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setenv("ALETHICAL_EMAIL_TRANSPORT", "console")

    response = client.post("/api/v1/contact", json=_message())

    assert response.status_code == 503
    assert response.json()["type"].endswith("contact-delivery-unavailable")


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
