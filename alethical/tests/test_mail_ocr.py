"""Local reader retains word evidence and uses bounded image preparation."""

from types import SimpleNamespace

from PIL import Image

from alethical.api.services import mail_ocr


def test_word_evidence_is_retained_instead_of_lost_in_line_average():
    raw = "block_num\tpar_num\tline_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t1\t10\t20\t20\t10\t15\tNot\n1\t1\t1\t35\t20\t80\t10\t95\tauthorized\n"
    line = mail_ocr.parse_tsv(raw)[0]
    assert line["text"] == "Not authorized"
    assert line["confidence"] == 55
    assert line["words"] == [
        {"text": "Not", "confidence": 15, "box": [10, 20, 30, 30]},
        {"text": "authorized", "confidence": 95, "box": [35, 20, 115, 30]},
    ]


def test_reader_prepares_grayscale_and_keeps_raw_evidence(tmp_path, monkeypatch):
    path = tmp_path / "photo.png"
    Image.new("RGB", (100, 100), (100, 100, 0)).save(path)
    raw = b"block_num\tpar_num\tline_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t1\t20\t20\t50\t10\t90\tUseful text\n2\t1\t1\t10\t60\t15\t10\t5\t\\\\\n"
    calls = []

    def run(command, **kwargs):
        with Image.open(command[4]) as prepared:
            mode = prepared.mode
        assert kwargs["timeout"] <= 25
        calls.append(command)
        return SimpleNamespace(
            stdout=raw if mode == "L" else raw.splitlines(keepends=True)[0]
        )

    monkeypatch.setattr(mail_ocr.subprocess, "run", run)
    result = mail_ocr.read_image(path)
    assert result["display_text"] == "Useful text"
    assert "\\\\" in result["text"]
    assert result["reading_incomplete"] is True
    assert result["reading_lines"][0]["words"][0]["confidence"] == 90
    assert len(calls) == 5


def test_recovery_never_replaces_a_short_established_payer(tmp_path, monkeypatch):
    path = tmp_path / "photo.png"
    Image.new("RGB", (100, 100), "white").save(path)
    raw = b"block_num\tpar_num\tline_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t1\t20\t20\t50\t10\t95\tPaid for by Example\n"
    calls = []

    def run(command, **kwargs):
        with Image.open(command[4]) as prepared:
            assert prepared.mode == "RGB"
        calls.append(command)
        return SimpleNamespace(stdout=raw)

    monkeypatch.setattr(mail_ocr.subprocess, "run", run)
    monkeypatch.setattr(
        mail_ocr, "refine_disclosure", lambda image, quote, folder, deadline: quote
    )
    result = mail_ocr.read_image(path)
    assert result["disclosures"][0]["payer_text"] == "Example"
    assert len(calls) == 1
