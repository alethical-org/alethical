"""Readable copy removes noise while retaining private source evidence."""

from copy import deepcopy

from alethical.api.services.mail_reading_copy import NOTICE, reading_copy


def test_artifact_runs_are_omitted_without_changing_source():
    side = {
        "status": "read",
        "text": "Vote November 3\n| \\ _\n~~~\nNot authorized by a candidate",
        "disclosures": [{"quote": "Paid for by Example Fund |"}],
        "complete": False,
    }
    original = deepcopy(side)
    result = reading_copy(side)
    assert result["display_text"] == "Vote November 3\nNot authorized by a candidate"
    assert result["reading_notice"] == NOTICE
    assert result["reading_incomplete"] is True
    assert side == original
    assert result["text"] == side["text"]
    assert result["disclosures"] == side["disclosures"]
    assert result["complete"] is False


def test_names_numbers_urls_and_qualifiers_stay_exact():
    text = "José O’Neill & Sons\n$50.25\n50%\nVote November 3\nwww.example.org\nNot authorized"
    result = reading_copy({"status": "read", "text": text})
    assert result["display_text"] == text
    assert result["reading_notice"] is None


def test_partial_read_does_not_invent_glare_or_crop_diagnosis():
    result = reading_copy({"status": "partial", "text": "Some useful words"})
    assert result["display_text"] == "Some useful words"
    assert result["reading_notice"] == NOTICE


def test_scanner_only_side_does_not_display_an_isolated_number_or_letters():
    text = "Y\n/ @\n\\\\\nYAN\nWw\nsed\nAS\nAAA\nAK \\Y\ni\neV\n7"
    result = reading_copy({"status": "read", "text": text})
    assert result["display_text"] == ""
    assert result["reading_notice"] == NOTICE


def test_repeated_visual_checkmarks_are_not_words():
    text = "Y Protect Local Parks\nY Lower Taxes\n¥ Support Public Schools\nY Chen for Mayor"
    result = reading_copy({"status": "read", "text": text})
    # Legacy data cannot prove whether a capital Y is a name initial. New OCR
    # evidence below distinguishes it; explicit symbols need no dictionary.
    assert "¥ Support" not in result["display_text"]
    assert "Protect Local Parks" in result["display_text"]
    assert "Y Chen for Mayor" in result["display_text"]


def test_solitary_y_and_currency_remain_intact():
    text = "Y Chen for Mayor\nA donation of ¥50\nYork County Schools"
    result = reading_copy({"status": "read", "text": text})
    assert result["display_text"] == text


def test_uncertain_negation_omits_span_instead_of_reversing_it():
    raw = "Not authorized by a candidate.\nVote November 3"
    lines = [
        {
            "text": "Not authorized by a candidate.",
            "confidence": 80,
            "words": [
                {"text": "Not", "confidence": 20},
                {"text": "authorized", "confidence": 99},
            ],
        },
        {
            "text": "Vote November 3",
            "confidence": 90,
            "words": [
                {"text": "Vote", "confidence": 90},
                {"text": "November", "confidence": 90},
                {"text": "3", "confidence": 90},
            ],
        },
    ]
    result = reading_copy({"status": "read", "text": raw, "reading_lines": lines})
    assert result["display_text"] == "Vote November 3"
    assert result["text"] == raw
    assert result["reading_notice"] == NOTICE


def test_uncertain_controls_omit_whole_span_and_do_not_join_words():
    result = reading_copy(
        {
            "status": "read",
            "text": "Vote \ufffd today\nPaid\x00 for.\n\nValid other words",
        }
    )
    assert result["display_text"] == "Valid other words"
    assert result["reading_notice"] == NOTICE


def test_normal_line_endings_are_preserved():
    result = reading_copy({"status": "read", "text": "Vote now\r\nSupport schools"})
    assert result["display_text"] == "Vote now\nSupport schools"
    assert result["reading_notice"] is None


def test_display_disclosure_repairs_sentence_punctuation_without_rewriting_evidence():
    from alethical.api.services.mail_reading_copy import reading_disclosure

    raw = "Paid for by Example Fund, https://example.org, It is independent of the candidate,"
    source = {"quote": raw, "payer_text": "Example Fund"}
    result = reading_disclosure(source)
    assert (
        result["display_quote"]
        == "Paid for by Example Fund, https://example.org. It is independent of the candidate."
    )
    assert result["quote"] == raw
    assert result["payer_text"] == "Example Fund"
    assert result["display_quote_normalization"] == "sentence_boundary_punctuation_v1"
    assert "display_quote" not in source


def test_ambiguous_commas_names_amounts_and_url_lists_remain_unchanged():
    from alethical.api.services.mail_reading_copy import reading_disclosure

    for raw in [
        "Paid for by Smith, Jones and Partners. Amount $1,234.56.",
        "Paid for by Example Fund, https://example.org, and its partners",
        "Paid for by Example Fund, https://example.org, Other organization",
        "Example Fund,",
    ]:
        result = reading_disclosure({"quote": raw})
        assert result["display_quote"] == raw
        assert "display_quote_normalization" not in result


def test_high_confidence_standalone_slogan_does_not_require_a_sentence():
    lines = [
        {"text": word, "confidence": 96, "words": [{"text": word, "confidence": 96}]}
        for word in ["Cut", "Waste", "Fraud"]
    ]
    result = reading_copy(
        {"text": "Cut\nWaste\nFraud", "status": "read", "reading_lines": lines}
    )
    assert result["display_text"] == "Cut\nWaste\nFraud"
    assert result["reading_notice"] is None


def test_low_confidence_aligned_checkmarks_are_removed_without_deleting_claims():
    lines = []
    for row, (mark, phrase) in enumerate(
        [
            ("JY", "Protect Local Parks"),
            ("Vv", "Lower Taxes"),
            ("v¥", "Support Public Schools"),
        ]
    ):
        top = row * 70
        words = [{"text": mark, "confidence": 20, "box": [10, top, 50, top + 40]}]
        words += [
            {
                "text": word,
                "confidence": 95,
                "box": [60 + n * 70, top + 10, 125 + n * 70, top + 40],
            }
            for n, word in enumerate(phrase.split())
        ]
        lines.append({"text": mark + " " + phrase, "confidence": 78, "words": words})
    result = reading_copy(
        {"text": "\n".join(line["text"] for line in lines), "reading_lines": lines}
    )
    assert (
        result["display_text"]
        == "Protect Local Parks\nLower Taxes\nSupport Public Schools"
    )


def test_wrapped_negation_never_turns_into_affirmative_claim():
    lines = []
    for text, confidence in [("John Smith will", 96), ("not", 20), ("raise taxes", 96)]:
        lines.append(
            {
                "text": text,
                "confidence": confidence,
                "words": [
                    {"text": word, "confidence": confidence} for word in text.split()
                ],
            }
        )
    result = reading_copy(
        {"text": "John Smith will\nnot\nraise taxes", "reading_lines": lines}
    )
    assert result["display_text"] == ""
    assert result["reading_notice"] == NOTICE


def test_confident_short_qualifiers_are_not_scanner_noise():
    for raw in [
        "No\nnew taxes",
        "If\nwe win\ntaxes fall",
        "Not\na tax increase",
        "To\nJohn Smith",
    ]:
        lines = [
            {
                "text": text,
                "confidence": 96,
                "words": [{"text": word, "confidence": 96} for word in text.split()],
            }
            for text in raw.splitlines()
        ]
        assert (
            reading_copy({"text": raw, "reading_lines": lines})["display_text"] == raw
        )


def test_noise_outside_text_column_does_not_remove_readable_slogan():
    lines = [
        {
            "text": "ee",
            "confidence": 20,
            "box": [0, 0, 20, 20],
            "words": [{"text": "ee", "confidence": 20}],
        },
        {
            "text": "Vote for schools",
            "confidence": 96,
            "box": [400, 100, 800, 140],
            "words": [
                {"text": "Vote", "confidence": 96},
                {"text": "for", "confidence": 96},
                {"text": "schools", "confidence": 96},
            ],
        },
    ]
    assert (
        reading_copy({"text": "ee\nVote for schools", "reading_lines": lines})[
            "display_text"
        ]
        == "Vote for schools"
    )


def test_wrapped_qualifier_confidence_boundary_never_changes_claim():
    for confidence in [20, 55, 70, 96]:
        raw = "John Smith will\nnot\nraise taxes"
        lines = [
            {
                "text": text,
                "confidence": level,
                "words": [{"text": word, "confidence": level} for word in text.split()],
            }
            for text, level in [
                ("John Smith will", 96),
                ("not", confidence),
                ("raise taxes", 96),
            ]
        ]
        result = reading_copy({"text": raw, "reading_lines": lines})
        assert result["display_text"] == ("" if confidence < 60 else raw)
    for confidence in [70, 96]:
        raw = "No\nnew taxes"
        lines = [
            {
                "text": text,
                "confidence": level,
                "words": [{"text": word, "confidence": level} for word in text.split()],
            }
            for text, level in [("No", confidence), ("new taxes", 96)]
        ]
        assert (
            reading_copy({"text": raw, "reading_lines": lines})["display_text"] == raw
        )
