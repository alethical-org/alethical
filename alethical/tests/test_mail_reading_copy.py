"""Reading copy removes only unmistakable artifacts, never repairs words."""

from copy import deepcopy

from alethical.api.services.mail_reading_copy import reading_copy


def test_artifact_lines_become_explicit_gaps_without_changing_source():
    side = {
        "status": "read",
        "text": "Vote November 3\n| \\ _\n~~~\nNot authorized by a candidate\nPaid for by Our America",
        "disclosures": [{"quote": "Paid for by Our America |"}],
        "complete": False,
    }
    original = deepcopy(side)
    result = reading_copy(side)
    assert result["display_text"] == (
        "Vote November 3\n[Unreadable]\nNot authorized by a candidate\nPaid for by Our America"
    )
    assert result["reading_notice"] == "Some text could not be read"
    assert side == original
    assert result["text"] == side["text"]
    assert result["disclosures"] == side["disclosures"]
    assert result["complete"] is False


def test_meaningful_symbols_names_numbers_and_uncertain_words_stay_exact():
    text = "José O’Neill & Sons\n$50.25\n50%\n+\n−\n<\n>\n=\n¢\nA/B\nR|ghts\nC0ntr1butions?\nNot authorized"
    result = reading_copy({"status": "read", "text": text})
    assert result["display_text"] == text
    assert result["reading_notice"] is None


def test_partial_read_does_not_invent_glare_or_crop_diagnosis():
    result = reading_copy(
        {
            "status": "partial",
            "text": "Some useful words",
            "partial_reasons": ["disclosure_cut_off"],
            "disclosures": [{"edge_warning": True}],
        }
    )
    assert result["display_text"] == "Some useful words"
    assert result["reading_notice"] == "Some text could not be read"


def test_failed_side_keeps_useful_prior_words_and_local_failure_notice():
    result = reading_copy({"status": "unreadable", "text": "Earlier useful words"})
    assert result["display_text"] == "Earlier useful words"
    assert result["reading_notice"] == "We couldn’t read this photo"


def test_empty_or_all_artifact_text_does_not_look_successfully_read():
    for text in ("", "|\n\\\\\n___"):
        result = reading_copy({"status": "read", "text": text})
        assert result["reading_notice"] == "We couldn’t read this photo"


def test_embedded_unrenderable_characters_are_marked_not_silently_removed():
    result = reading_copy({"status": "read", "text": "Vote \ufffd today\nPaid\x00 for"})
    assert result["display_text"] == "Vote [Unreadable] today\nPaid[Unreadable] for"
    assert result["reading_notice"] == "Some text could not be read"


def test_control_separators_are_gaps_but_normal_line_endings_stay_lines():
    for separator in ("\x0b", "\x0c", "\x1c", "\r"):
        result = reading_copy({"status": "read", "text": f"Vote{separator}today"})
        assert result["display_text"] == "Vote[Unreadable]today"
        assert result["reading_notice"] == "Some text could not be read"
    result = reading_copy({"status": "read", "text": "Vote\r\ntoday"})
    assert result["display_text"] == "Vote\ntoday"
    assert result["reading_notice"] is None
