"""Synthetic PDF pages exercise the native text reader without real private fields."""

from io import BytesIO
import hashlib
import json
import shutil

import pytest
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject


def paper_pdf(**changes):
    # Values are top-down PDF coordinates in the inspected Form2 layout.
    items = {
        "title": (46, 62, "FEC FORM 2"),
        "subtitle": (46, 83, "STATEMENT OF CANDIDACY"),
        "name_label": (49, 118, "1. (a) Name of Candidate (in full)"),
        "id_label": (376, 141, "2. Candidate's FEC Identification Number"),
        "designation_label": (168, 221, "DESIGNATION OF PRINCIPAL CAMPAIGN COMMITTEE"),
        "committee_label": (61, 276, "(a) Name of Committee (in full)"),
        "image": (48, 41, "Image# 202611120000000001"),
        "candidate_name": (73, 130, "Example, Alex, , ,"),
        "source_candidate_id": (388, 153, "H6MN01111"),
        "office": (204, 199, "House"),
        "state": (331, 199, "MN"),
        "district": (386, 199, "01"),
        "election_year": (426, 240, "2026"),
        "principal_account_name": (76, 294, "Synthetic Campaign"),
        "private_address": (73, 154, "Private address"),
        "signature_date_label": (376, 598, "Date"),
        "signed_date": (381, 614, "11/11/2024"),
    }
    for key, value in changes.items():
        if value is None:
            items.pop(key)
        elif isinstance(value, tuple):
            items[key] = value
        else:
            items[key] = (*items[key][:2], value)
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject(
                {
                    NameObject("/F1"): DictionaryObject(
                        {
                            NameObject("/Type"): NameObject("/Font"),
                            NameObject("/Subtype"): NameObject("/Type1"),
                            NameObject("/BaseFont"): NameObject("/Helvetica"),
                        }
                    )
                }
            )
        }
    )
    commands = []
    for key, (x, y, text) in items.items():
        font_size = 7 if key in {"name_label", "committee_label"} else 8
        text = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        commands.append(
            f"BT /F1 {font_size} Tf 1 0 0 1 {x} {792 - y} Tm ({text}) Tj ET"
        )
    stream = DecodedStreamObject()
    stream.set_data("\n".join(commands).encode())
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def source(body):
    return {
        "authority": "fec",
        "sha256": hashlib.sha256(body).hexdigest(),
        "url": "https://docquery.fec.gov/pdf/001/202611120000000001/202611120000000001.pdf",
    }


@pytest.mark.skipif(
    not shutil.which("pdftotext"), reason="Native Poppler reader unavailable"
)
def test_native_pdf_identity_preserves_printed_fields_and_no_committee_id():
    from alethical.pipeline.election_fec_paper_identity import (
        extract_fec_paper_identity,
    )

    body = paper_pdf()
    loc = {"kind": "candidate_designation", "page": 1}
    checked = extract_fec_paper_identity(body, source(body), loc)
    assert checked.facts == {
        "authority": "fec",
        "source_candidate_id": "H6MN01111",
        "candidate_name": "Example, Alex, , ,",
        "office": "H",
        "office_label": "House",
        "state": "MN",
        "district": "01",
        "election_year": 2026,
        "principal_account_name": "Synthetic Campaign",
    }
    assert "account_id" not in checked.facts
    assert "Private address" not in checked.quote
    assert "bbox" in checked.quote
    assert "fec-selected-pdf-fields-v1" in checked.quote
    checked.facts["candidate_name"] = "Changed"
    assert (
        extract_fec_paper_identity(body, source(body), loc).facts["candidate_name"]
        == "Example, Alex, , ,"
    )
    single = extract_fec_paper_identity(
        body, source(body), {"kind": "field", "page": 1, "field": "election_year"}
    )
    assert single.facts == {
        "authority": "fec",
        "source_candidate_id": "H6MN01111",
        "election_year": 2026,
    }
    assert {x["field"] for x in json.loads(single.quote)["fields"]} == {
        "source_candidate_id",
        "election_year",
    }


@pytest.mark.skipif(
    not shutil.which("pdftotext"), reason="Native Poppler reader unavailable"
)
def test_form2_signed_date_uses_printed_signature_field_not_source_image_date():
    from alethical.pipeline.election_fec_paper_identity import (
        extract_fec_paper_identity,
    )

    body = paper_pdf()
    result = extract_fec_paper_identity(
        body, source(body), {"kind": "field", "page": 1, "field": "signed_date"}
    )
    assert result.facts == {
        "authority": "fec",
        "source_candidate_id": "H6MN01111",
        "signed_date": "2024-11-11",
    }
    assert "11/11/2024" in result.quote
    assert "account_id" not in result.facts
    previous = extract_fec_paper_identity(
        body, source(body), {"kind": "candidate_designation", "page": 1}
    )
    assert "signed_date" not in previous.facts
    assert "11/11/2024" not in previous.quote


@pytest.mark.skipif(
    not shutil.which("pdftotext"), reason="Native Poppler reader unavailable"
)
@pytest.mark.parametrize(
    "changes",
    [
        {"signed_date": None},
        {"signed_date": "02/30/2024"},
        {"signed_date": "11/11/2024 11/12/2024"},
        {"signed_date": (381, 630, "11/11/2024")},
        {"signature_date_label": "Received"},
        {"signature_date_label": None},
    ],
)
def test_form2_signed_date_refuses_missing_ambiguous_or_shifted_date(changes):
    from alethical.pipeline.election_fec_paper_identity import (
        extract_fec_paper_identity,
        FecPaperIdentityError,
    )

    body = paper_pdf(**changes)
    with pytest.raises(FecPaperIdentityError):
        extract_fec_paper_identity(
            body, source(body), {"kind": "field", "page": 1, "field": "signed_date"}
        )


@pytest.mark.skipif(
    not shutil.which("pdftotext"), reason="Native Poppler reader unavailable"
)
@pytest.mark.parametrize(
    "changes",
    [
        {"source_candidate_id": "bad-id"},
        {"source_candidate_id": "H6MN01111 H6MN02222"},
        {"source_candidate_id": None},
        {"election_year": "cycle 2026"},
        {"election_year": None},
        {"office": "Unknown"},
        {"state": "Minnesota"},
        {"district": "1"},
        {"candidate_name": None},
        {"principal_account_name": None},
        {"candidate_name": (73, 155, "Example, Alex")},
        {"title": "Different form"},
        {"image": "Image# 202611120000000002"},
    ],
)
def test_native_pdf_rejects_missing_ambiguous_or_shifted_fields(changes):
    from alethical.pipeline.election_fec_paper_identity import (
        extract_fec_paper_identity,
        FecPaperIdentityError,
    )

    body = paper_pdf(**changes)
    with pytest.raises(FecPaperIdentityError):
        extract_fec_paper_identity(
            body, source(body), {"kind": "candidate_designation", "page": 1}
        )


@pytest.mark.parametrize(
    "change",
    [
        "hash",
        "host",
        "authority",
        "path",
        "query",
        "port",
        "page",
        "selector",
        "not_pdf",
    ],
)
def test_paper_identity_rejects_unbound_source_or_selector(change):
    from alethical.pipeline.election_fec_paper_identity import (
        extract_fec_paper_identity,
        FecPaperIdentityError,
    )

    body = paper_pdf()
    src = source(body)
    loc = {"kind": "candidate_designation", "page": 1}
    if change == "hash":
        src["sha256"] = "0" * 64
    elif change == "host":
        src["url"] = src["url"].replace("docquery.fec.gov", "example.org")
    elif change == "authority":
        src["authority"] = "other"
    elif change == "path":
        src["url"] = src["url"].replace("/pdf/001/", "/pdf/002/")
    elif change == "query":
        src["url"] += "?override=1"
    elif change == "port":
        src["url"] = src["url"].replace("fec.gov", "fec.gov:8443")
    elif change == "page":
        loc["page"] = True
    elif change == "selector":
        loc["account_id"] = "C00123456"
    elif change == "not_pdf":
        body = b"not a PDF"
        src["sha256"] = hashlib.sha256(body).hexdigest()
    with pytest.raises(FecPaperIdentityError):
        extract_fec_paper_identity(body, src, loc)


@pytest.mark.skipif(
    not shutil.which("pdftotext"), reason="Native Poppler reader unavailable"
)
def test_native_pdf_rejects_name_cut_by_supported_field_edge():
    from alethical.pipeline.election_fec_paper_identity import (
        extract_fec_paper_identity,
        FecPaperIdentityError,
    )

    body = paper_pdf(candidate_name="Example, Alex " + "Q" * 120)
    with pytest.raises(FecPaperIdentityError):
        extract_fec_paper_identity(
            body, source(body), {"kind": "candidate_designation", "page": 1}
        )


def test_native_reader_stream_caps_kill_and_reap_child_before_full_output(
    tmp_path, monkeypatch
):
    import sys
    import subprocess
    import alethical.pipeline.election_fec_paper_identity as module

    processes = []
    real_popen = subprocess.Popen

    def record_process(*args, **kwargs):
        process = real_popen(*args, **kwargs)
        processes.append(process)
        return process

    monkeypatch.setattr(module.subprocess, "Popen", record_process)
    for channel in (1, 2):
        done = tmp_path / f"finished-{channel}"
        script = 'import os,sys; os.write(int(sys.argv[1]),b"x"*(4*1024*1024)); open(sys.argv[2],"w").write("completed")'
        with pytest.raises(
            module.FecPaperIdentityError, match="output limit|stderr limit"
        ):
            module._run_native_reader(
                b"",
                command=[sys.executable, "-c", script, str(channel), str(done)],
                max_stdout=65536,
                max_stderr=8192,
            )
        assert not done.exists()
        assert processes[-1].poll() is not None
        assert processes[-1].stdout.closed and processes[-1].stderr.closed


def test_native_reader_timeout_cleans_process_group_and_parent_limits(
    tmp_path, monkeypatch
):
    import resource
    import subprocess
    import sys
    import alethical.pipeline.election_fec_paper_identity as module

    real_popen = subprocess.Popen
    processes = []

    def record_process(*args, **kwargs):
        process = real_popen(*args, **kwargs)
        processes.append(process)
        return process

    monkeypatch.setattr(module.subprocess, "Popen", record_process)
    limits = resource.getrlimit(resource.RLIMIT_CPU)
    child_pid_file = tmp_path / "child.pid"
    script = 'import os,sys,time; pid=os.fork(); open(sys.argv[1],"w").write(str(pid or os.getpid())); time.sleep(20)'
    with pytest.raises(module.FecPaperIdentityError, match="time limit"):
        module._run_native_reader(
            b"",
            command=[sys.executable, "-c", script, str(child_pid_file)],
            timeout=0.5,
        )
    assert processes[-1].poll() is not None
    assert resource.getrlimit(resource.RLIMIT_CPU) == limits
    child_pid = int(child_pid_file.read_text())
    # Killed grandchildren may briefly be zombies until the OS reaps them.
    result = subprocess.run(
        ["ps", "-o", "stat=", "-p", str(child_pid)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert not result.stdout.strip() or result.stdout.strip().startswith("Z")


def test_native_reader_missing_executable_and_resource_failure_are_closed():
    import sys
    import alethical.pipeline.election_fec_paper_identity as module

    with pytest.raises(module.FecPaperIdentityError, match="failed|unavailable"):
        module._run_native_reader(b"", command=["/missing-fec-pdftotext"])
    # CPU use is bounded in the isolated child, never the calling test process.
    with pytest.raises(module.FecPaperIdentityError, match="failed"):
        module._run_native_reader(
            b"",
            command=[sys.executable, "-c", "while True: pass"],
            cpu_seconds=1,
            timeout=5,
        )


@pytest.mark.skipif(
    __import__("sys").platform != "linux",
    reason="Linux hard address-space resource limit",
)
def test_native_reader_linux_memory_limit_terminates_allocation():
    import sys
    import alethical.pipeline.election_fec_paper_identity as module

    with pytest.raises(module.FecPaperIdentityError, match="failed"):
        module._run_native_reader(
            b"",
            command=[sys.executable, "-c", "x=bytearray(128*1024*1024)"],
            memory_bytes=64 * 1024 * 1024,
        )
