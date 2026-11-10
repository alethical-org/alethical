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


def test_recovery_resamples_source_once_without_changing_the_main_canvas():
    import numpy as np

    pixels = np.tile(np.arange(4032, dtype=np.uint16) % 251, (96, 1)).astype("uint8")
    original = Image.fromarray(pixels).convert("RGB")
    recovered = mail_ocr.recovery_canvas(original)
    expected = original.resize((2400, 57), Image.Resampling.BICUBIC, reducing_gap=2.0)
    intermediate = original.copy()
    intermediate.thumbnail((4000, 4000))
    twice = mail_ocr.recovery_canvas(intermediate)
    assert original.size == (4032, 96)
    assert recovered.size == (2400, 57)
    assert recovered.tobytes() == expected.tobytes()
    assert recovered.tobytes() != twice.tobytes()


def test_large_camera_image_uses_separate_recovery_scale_and_records_provenance(
    tmp_path, monkeypatch
):
    path = tmp_path / "camera.jpg"
    Image.new("RGB", (4032, 3024), (10, 20, 30)).save(path)
    original_bytes = path.read_bytes()
    header = b"block_num\tpar_num\tline_num\tleft\ttop\twidth\theight\tconf\ttext\n"
    raw = header + b"1\t1\t1\t20\t20\t100\t30\t95\tVote for local schools\n"
    prepared_sizes = []
    deskew_sizes = []

    def run(command, **kwargs):
        with Image.open(command[4]) as prepared:
            prepared_sizes.append((prepared.mode, prepared.size))
            return SimpleNamespace(stdout=raw if prepared.mode == "L" else header)

    def deskew(image):
        deskew_sizes.append(image.size)
        return image, 0

    monkeypatch.setattr(mail_ocr.subprocess, "run", run)
    monkeypatch.setattr(mail_ocr, "deskew", deskew)
    result = mail_ocr.read_image(path)
    assert prepared_sizes[0] == ("RGB", (4000, 3000))
    assert deskew_sizes == [(2400, 1800)]
    assert ("L", (2400, 1800)) in prepared_sizes
    assert result["display_text"] == "Vote for local schools"
    assert result["recovery_canvas"] == {
        "source_size": [4032, 3024],
        "size": [2400, 1800],
        "resample": "bicubic",
    }
    assert path.read_bytes() == original_bytes


def test_recovery_never_enlarges_small_images():
    original = Image.new("RGB", (320, 240), "white")
    assert mail_ocr.recovery_canvas(original).size == original.size
