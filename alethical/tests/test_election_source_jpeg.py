"""Exact JPEG sources use an isolated, fixed native-pixel reading plane."""

from copy import deepcopy
from io import BytesIO
import hashlib

import pytest

from PIL import Image

from alethical.pipeline import election_source_readings as readings
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.tests.test_election_source_files import Store, source
from alethical.pipeline import election_source_files as files


def jpeg(mode="RGB", size=(90, 60), **options):
    output = BytesIO()
    Image.new(mode, size, 128 if mode == "L" else (20, 40, 60)).save(
        output, "JPEG", **options
    )
    return output.getvalue()


def test_jpeg_has_exact_native_pixel_plane_and_repeatable_png():
    body = jpeg()
    first, image = readings.render_page(body, 1)
    second, repeated = readings.render_page(body, 1)
    assert first == second
    assert image == repeated
    assert (first["width"], first["height"]) == (90, 60)
    assert first["render_profile"] != readings.RENDER_PROFILE
    with Image.open(BytesIO(image)) as rendered:
        assert rendered.mode == "RGB" and rendered.size == (90, 60)
        assert not rendered.info


def receipt(body=None):
    body = body or jpeg()
    bounds = [0, 0, 90, 60]
    field = readings.field_proposal(
        "certificate.name",
        page=1,
        bounds=[2, 2, 80, 15],
        label="Name of candidate or committee",
        literal="Synthetic Name",
        record_type="certification",
    )
    return readings.prepare_receipt(
        body,
        fields=[field],
        document_kind="certification",
        reading_scope={
            "cover": {"page": 1, "bounds": bounds},
            "regions": [{"page": 1, "bounds": bounds, "role": "cover"}],
        },
    )


@pytest.mark.parametrize("mode", ["RGB", "L"])
def test_exact_original_file_proof_and_no_ordinary_decode(mode, monkeypatch):
    body = jpeg(mode)
    value = receipt(body)
    store = Store()
    metadata = source(store, body, media_type="image/jpeg")
    h = metadata["content_hash"]
    with files.verified_source_files(
        store, [metadata], required_types={h: "jpeg"}
    ) as originals:
        assert (
            readings.render_page(originals[h], 1)[0]["image_sha256"]
            == value["pages"][0]["image_sha256"]
        )
        attempts = []

        def refuse(*args, **kwargs):
            attempts.append(True)
            raise AssertionError("Ordinary read must never render")

        monkeypatch.setattr(readings, "render_page", refuse)
        readings.verify_receipt_sources(value, originals)
        assert attempts == []
    with pytest.raises(files.SourceFileError, match="owning context"):
        originals[h].open()


@pytest.mark.parametrize("media", [None, "image/jpeg", "image/jpeg; charset=binary"])
def test_file_type_does_not_invent_absent_db_mime(media):
    store = Store()
    row = source(store, jpeg(), media_type=media)
    with files.verified_source_files(
        store, [row], required_types={row["content_hash"]: "jpeg"}
    ):
        pass


@pytest.mark.parametrize(
    "body,media",
    [(b"%PDF-1.7", "image/jpeg"), (jpeg(), "application/pdf"), (jpeg(), "text/html")],
)
def test_wrong_magic_or_retained_mime_is_refused(body, media):
    store = Store()
    row = source(store, body, media_type=media)
    with pytest.raises(files.SourceFileError):
        with files.verified_source_files(
            store, [row], required_types={row["content_hash"]: "jpeg"}
        ):
            pass


@pytest.mark.parametrize(
    "change", ["legacy", "page2", "mixed", "wide", "pixels", "bounds", "extra"]
)
def test_jpeg_receipt_plane_is_closed(change):
    value = receipt()
    if change == "legacy":
        value["schema"] = readings.SCHEMA
        value.pop("reading_scope")
    elif change == "page2":
        value["pages"][0]["page"] = 2
    elif change == "mixed":
        value["pages"].append(
            value["pages"][0] | {"page": 2, "render_profile": readings.RENDER_PROFILE}
        )
    elif change == "wide":
        value["pages"][0]["width"] = 8193
    elif change == "pixels":
        value["pages"][0].update(width=5000, height=5000)
    elif change == "bounds":
        value["fields"][0]["bounds"][2] = 91
    else:
        value["pages"][0]["orientation"] = 1
    with pytest.raises(ComparisonImportError):
        readings.validate_receipt(value)


@pytest.mark.parametrize("orientation", [0, 2, 3, 4, 5, 6, 7, 8, 9])
def test_orientation_is_held_not_silently_transformed(orientation):
    exif = Image.Exif()
    exif[274] = orientation
    with pytest.raises(ComparisonImportError, match="bounded original JPEG"):
        readings.render_page(jpeg(exif=exif), 1)


def test_identity_orientation_and_dpi_have_no_coordinate_transform():
    exif = Image.Exif()
    exif[274] = 1
    original, _ = readings.render_page(jpeg(), 1)
    actual, _ = readings.render_page(jpeg(exif=exif, dpi=(300, 300)), 1)
    assert actual == original


@pytest.mark.parametrize(
    "case", ["icc", "cmyk", "truncated", "edge", "pixels", "malformed_exif"]
)
def test_unsupported_or_malformed_image_is_boundedly_refused(case):
    if case == "icc":
        body = jpeg(icc_profile=b"unsupported profile")
    elif case == "cmyk":
        stream = BytesIO()
        Image.new("CMYK", (90, 60)).save(stream, "JPEG")
        body = stream.getvalue()
    elif case == "truncated":
        body = jpeg()[:-20]
    elif case == "malformed_exif":
        body = jpeg(exif=b"Exif\x00\x00garbage")
    elif case == "edge":
        body = jpeg(size=(8193, 1))
    else:
        body = jpeg(size=(4001, 4000))
    with pytest.raises(ComparisonImportError):
        readings.render_page(body, 1)


def test_oversized_original_and_bad_page_never_start_decoder(monkeypatch):
    monkeypatch.setattr(
        readings,
        "_run_native_reader",
        lambda *a, **k: pytest.fail("must refuse before decoder"),
    )
    for page in [0, 2, True]:
        with pytest.raises(ComparisonImportError):
            readings.render_page(jpeg(), page)
    with pytest.raises(ComparisonImportError):
        readings.render_page(b"\xff\xd8\xff" + b"x" * readings.MAX_ORIGINAL_BYTES, 1)


def test_declared_profile_never_changes_original_type_or_checked_png():
    body = jpeg()
    value = receipt(body)
    h = hashlib.sha256(body).hexdigest()
    forged = deepcopy(value)
    forged["pages"][0]["render_profile"] = readings.RENDER_PROFILE
    with pytest.raises(ComparisonImportError, match="render profile"):
        readings.verify_receipt_sources(forged, {h: body})
    forged = deepcopy(value)
    forged["pages"][0]["image_sha256"] = "0" * 64
    with pytest.raises(ComparisonImportError, match="render differs"):
        readings.verify_receipt_sources(forged, {h: body}, render=True)


@pytest.mark.parametrize(
    "result",
    [
        b"not PNG",
        b"\x89PNG\r\n\x1a\n",
        readings.FecPaperIdentityError("bounded decoder failure"),
    ],
)
def test_decoder_output_or_failure_cannot_forge_a_plane(result, monkeypatch):
    def run(*args, **kwargs):
        assert kwargs["command"][1].endswith("election_source_image_reader.py")
        assert kwargs["max_stdout"] == 16 * 1024 * 1024
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(readings, "_run_native_reader", run)
    with pytest.raises(ComparisonImportError, match="bounded original JPEG"):
        readings.render_page(jpeg(), 1)


def test_cli_preparation_keeps_original_type_and_closed_section(tmp_path):
    from scripts.review_election_source_reading import prepare_local_file

    body = jpeg()
    proposal = receipt(body)
    observations = {
        k: proposal[k]
        for k in [
            "fields",
            "document_kind",
            "dependencies",
            "source_context",
            "reading_scope",
        ]
    }
    path = tmp_path / "original.body"
    path.write_bytes(body)
    assert prepare_local_file(path, observations, source_type="jpeg") == proposal
    with pytest.raises(files.SourceFileError, match="not PDF"):
        prepare_local_file(path, observations)
    with pytest.raises(ComparisonImportError, match="source type"):
        prepare_local_file(path, observations, source_type="html")


def test_image_cli_keeps_no_approval_and_original_hash(tmp_path, capsys):
    import json
    from scripts.review_election_source_reading import main

    body = jpeg()
    value = receipt(body)
    observations = {
        k: value[k]
        for k in [
            "fields",
            "document_kind",
            "dependencies",
            "source_context",
            "reading_scope",
        ]
    }
    original, inputs, output = (
        tmp_path / name
        for name in ["original.jpg", "observations.json", "receipt.json"]
    )
    original.write_bytes(body)
    inputs.write_text(json.dumps(observations))
    assert (
        main(
            [
                "prepare",
                "--image",
                str(original),
                "--observations",
                str(inputs),
                "--output",
                str(output),
            ]
        )
        == 0
    )
    result = json.loads(capsys.readouterr().out)
    assert result["executed"] is False and result["source_validation"] == "not_approved"
    assert json.loads(output.read_text()) == value


def test_image_context_cannot_use_legacy_html_csv_association():
    value = receipt()
    value["source_context"] = {"kind": "legacy"}
    with pytest.raises(ComparisonImportError, match="typed acquisition"):
        readings.validate_receipt(value)


@pytest.mark.parametrize(
    "error",
    [
        files.SourceFileLimitError("busy"),
        RuntimeError("internal failure"),
        MemoryError("capacity"),
    ],
)
def test_jpeg_capacity_and_unrelated_failures_keep_their_exact_type(error, monkeypatch):
    def refuse(*args, **kwargs):
        raise error

    monkeypatch.setattr(readings, "_run_native_reader", refuse)
    with pytest.raises(type(error)) as caught:
        readings.render_page(jpeg(), 1)
    assert caught.value is error


@pytest.mark.parametrize(
    "media_type", ["image/jpeg", "IMAGE/JPEG", "image/jpeg; charset=binary"]
)
def test_comparison_source_route_preserves_jpeg_attachment(monkeypatch, media_type):
    from alethical.api.routers import election_comparison as route

    body = jpeg()
    h = hashlib.sha256(body).hexdigest()

    def checked(db, *, election_key, snapshot_id, source_hash):
        assert election_key == "mn-2026-11-03-general"
        assert snapshot_id == "a" * 64 and source_hash == h
        return body, {"media_type": media_type}

    monkeypatch.setattr(route.reads, "source_body", checked)
    response = route.source_download(
        election_key="mn-2026-11-03-general",
        source_hash=h,
        snapshot_id="a" * 64,
        db=object(),
    )
    assert response.body == body
    assert response.headers["content-disposition"].endswith(f'{h}.jpg"')
    assert response.headers["x-content-type-options"] == "nosniff"


def test_duplicate_exif_and_malformed_icc_cannot_hide_in_decoder_metadata():
    import struct

    body = jpeg()
    exif = Image.Exif()
    exif[274] = 1
    data = exif.tobytes()
    segment = b"\xff\xe1" + struct.pack(">H", len(data) + 2) + data
    duplicated = body[:2] + segment + segment + body[2:]
    profile = b"ICC_PROFILE\x00\x01\x02" + b"incomplete profile"
    icc = (
        body[:2]
        + b"\xff\xe2"
        + struct.pack(">H", len(profile) + 2)
        + profile
        + body[2:]
    )
    for malformed in (duplicated, icc):
        with pytest.raises(ComparisonImportError):
            readings.render_page(malformed, 1)


def raw_exif_jpeg(entries, *, byte_order="II", offset=8, declared=None, tail=None):
    """Primary TIFF directory entries remain a list, not a lossy tag mapping."""
    import struct

    order = "<" if byte_order == "II" else ">"
    directory = struct.pack(order + "H", len(entries) if declared is None else declared)
    for tag, kind, count, value in entries:
        inline = (
            struct.pack(order + "H", value) + b"\x00\x00"
            if kind == 3
            else struct.pack(order + "I", value)
        )
        directory += struct.pack(order + "HHI", tag, kind, count) + inline
    directory += struct.pack(order + "I", 0) if tail is None else tail
    data = (
        b"Exif\x00\x00"
        + byte_order.encode()
        + struct.pack(order + "HI", 42, offset)
        + directory
    )
    body = jpeg()
    return body[:2] + b"\xff\xe1" + struct.pack(">H", len(data) + 2) + data + body[2:]


@pytest.mark.parametrize(
    "entries",
    [
        [(274, 3, 1, 1), (274, 3, 1, 6)],
        [(274, 3, 1, 6), (274, 3, 1, 1)],
        [(274, 3, 1, 1), (274, 3, 1, 1)],
        [(274, 99, 1, 1)],
        [(274, 3, 0, 1)],
        [(274, 4, 1, 1)],
        [(274, 9, 1, 1)],
        [(274, 1, 1, 1)],
        [(274, 3, 2, 1)],
        [(274, 3, 1, 0)],
        [(274, 3, 1, 6)],
    ],
)
@pytest.mark.parametrize("byte_order", ["II", "MM"])
@pytest.mark.parametrize("operation", ["render", "prepare"])
def test_raw_primary_orientation_cannot_be_erased_by_pillow(
    entries, byte_order, operation
):
    body = raw_exif_jpeg(entries, byte_order=byte_order)
    with pytest.raises(ComparisonImportError, match="bounded original JPEG"):
        if operation == "render":
            readings.render_page(body, 1)
        else:
            receipt(body)


@pytest.mark.parametrize("byte_order", ["II", "MM"])
@pytest.mark.parametrize("entries", [[], [(274, 3, 1, 1)], [(256, 4, 1, 90)]])
def test_valid_primary_directory_preserves_the_exact_source_plane(entries, byte_order):
    expected, png = readings.render_page(jpeg(), 1)
    actual, actual_png = readings.render_page(
        raw_exif_jpeg(entries, byte_order=byte_order), 1
    )
    assert actual == expected and actual_png == png


@pytest.mark.parametrize(
    "settings",
    [
        {"offset": 0},
        {"offset": 2},
        {"offset": 7},
        {"offset": 10000},
        {"declared": 65535},
        {"declared": 2},
        {"tail": b""},
    ],
)
def test_primary_directory_offsets_counts_and_end_are_bounded(settings):
    with pytest.raises(ComparisonImportError):
        readings.render_page(raw_exif_jpeg([(274, 3, 1, 1)], **settings), 1)
