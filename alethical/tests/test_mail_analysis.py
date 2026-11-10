"""Private extraction never turns OCR or matching names into facts."""

from alethical.api.services.mail_analysis import disclosures
from alethical.api.services import mail_analysis
from alethical.tests.test_mail_upload import session, draft, upload, storage as storage


def test_disclosure_preserves_source_and_flags_cropped_edge():
    line = {
        "text": "Paid for by Restore Sanity. Not authorized by a candidate",
        "confidence": 89,
        "box": [2, 90, 500, 110],
    }
    result = disclosures([line], 600, 200)
    assert result[0]["quote"] == line["text"]
    assert result[0]["payer_text"] == "Restore Sanity"
    assert result[0]["quality"] == "machine_read"
    assert result[0]["edge_warning"] is True


def test_missing_disclosure_is_never_reconstructed():
    assert (
        disclosures(
            [
                {
                    "text": "id for by Our America",
                    "confidence": 91,
                    "box": [0, 10, 250, 30],
                }
            ],
            600,
            200,
        )
        == []
    )


def test_multiple_disclosures_remain_separate():
    lines = [
        {"text": f"Paid for by {name}", "confidence": 90, "box": [20, 20, 300, 40]}
        for name in ("Our America", "Restore Sanity")
    ]
    assert [r["payer_text"] for r in disclosures(lines, 600, 200)] == [
        "Our America",
        "Restore Sanity",
    ]


@__import__("pytest").mark.usefixtures("storage")
def test_owned_results_queue_and_retry(client, monkeypatch):
    headers, _, _ = session(client)
    path = draft(client, headers)
    assert client.get(path + "/analysis", headers=headers).status_code == 409
    upload(client, path, headers, "front")
    upload(client, path, headers, "back")
    assert (
        client.post(
            path + "/submit", headers=headers, json={"likes_ad": False}
        ).status_code
        == 200
    )
    assert (
        client.get(path + "/analysis", headers=headers).json()["data"]["status"]
        == "pending"
    )
    other, _, _ = session(client)
    assert client.get(path + "/analysis", headers=other).status_code == 404
    assert client.post(path + "/analysis/retry", headers=other).status_code == 404
    monkeypatch.setattr(
        mail_analysis,
        "read_image",
        lambda _: {
            "status": "read",
            "text": "Paid for by Example",
            "disclosures": [],
            "complete": False,
        },
    )
    mail_analysis.drain_once()
    response = client.get(path + "/analysis", headers=headers)
    assert response.headers["cache-control"] == "private, no-store"
    result = response.json()["data"]
    assert result["status"] == "ready"
    assert len(result["sides"]) == 2
    assert result["payer_status"] == "not_found"
    assert result["matching_mailers"]["count"] is None
    assert result["confirmed_entity_id"] is None
    assert "object_key" not in response.text
    # Completed analyses are never silently run again.
    monkeypatch.setattr(
        mail_analysis, "read_image", lambda _: (_ for _ in ()).throw(AssertionError())
    )
    mail_analysis.drain_once()
    assert client.get(path + "/analysis", headers=headers).json()["data"] == result
