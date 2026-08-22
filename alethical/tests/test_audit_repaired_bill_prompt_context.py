from __future__ import annotations

import hashlib
from collections import Counter

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_engine
from alethical.pipeline import anthropic_enrichment, rag_ingest
from scripts import audit_repaired_bill_prompt_context as prompt_audit


SAVED_CONTEXT_HTML = """
<html>
  <head><title>HF 1</title></head>
  <body>
    <div class="bill_section" id="laws.0.1.0">
      <h2 class="section_number">Section 1.</h2>
      <p>The agency must
        <span class="sr-only">new text begin </span>
        <ins style="text-decoration: underline">publish one new notice</ins>
        <span class="sr-only">new text end </span>
        and keep its existing records.</p>
    </div>
    <div class="rlang">
      <h2 class="title">APPENDIX</h2>
      <p>Repealed Minnesota Statutes: TEST-0</p>
      <div class="repealed_statutes">
        <h1 class="shn">9.99 EMPTY OLD STATUTE.</h1>
        <p>No active language found for: 9.99</p>
        <h1 class="shn">10.01 OLD STATUTE.</h1>
        <div class="subd" id="laws.0.0.1">
          <h2 class="subd_no">Subdivision 1.</h2>
          <p>First old statute body.</p>
        </div>
        <div class="subd" id="laws.0.0.2">
          <h2 class="subd_no">Subd. 2.</h2>
          <p>Second old statute body.</p>
        </div>
        <h1 class="shn">10.02 OLD WHOLE STATUTE.</h1>
        <p>Old statute body without a subdivision wrapper.</p>
      </div>
      <p>Repealed Minnesota Session Laws: TEST-0</p>
      <div class="repealed_laws">
        <p>Laws 2020, chapter 10, section 4</p>
        <div class="bill_section" id="laws.0.4.0">
          <h2 class="section_number">Sec. 4.</h2>
          <div class="subd" id="laws.0.4.1">
            <h2 class="subd_no">Subdivision 1.</h2>
            <p>Old session-law body.</p>
          </div>
        </div>
      </div>
      <p>Repealed Minnesota Rule: TEST-0</p>
      <div class="repealed_rules">
        <div class="part" id="rule.1000.0100">
          <h1 class="headnote">1000.0100 OLD RULE.</h1>
          <p>Old rule body.</p>
        </div>
      </div>
    </div>
  </body>
</html>
"""


def _one_page_cohort(page_hash: str):
    return {
        "audit-2026-HF1": (
            "https://www.revisor.mn.gov/bills/audit/HF/1/versions/0/",
            1,
            4,
            True,
            page_hash,
        )
    }


def _one_page_totals() -> dict[str, int]:
    return {
        "proposed_prompt_references": 1,
        "appendix_prompt_references": 4,
        "appendix_statute_prompt_references": 2,
        "appendix_session_law_prompt_references": 1,
        "appendix_rule_prompt_references": 1,
        "appendix_raw_official_slots": 6,
        "appendix_legal_source_blocks": 5,
        "statute_legal_source_bodies": 3,
        "statute_subdivision_source_bodies": 2,
        "statute_unsubdivided_legal_source_bodies": 1,
        "statute_empty_notice_slots": 1,
        "session_law_source_blocks": 1,
        "session_law_nested_subdivision_bodies": 1,
        "appendix_literal_subdivision_bodies": 3,
        "rule_part_source_blocks": 1,
    }


def test_gate_round_trips_saved_context_through_real_prompt_reader_without_calls(
    seed_database: None, monkeypatch, tmp_path
) -> None:
    cache_dir = tmp_path / "official-pages"
    cache_dir.mkdir()
    (cache_dir / "audit-2026-HF1.html").write_text(SAVED_CONTEXT_HTML, encoding="utf-8")
    page_hash = hashlib.sha256(SAVED_CONTEXT_HTML.encode("utf-8")).hexdigest()
    monkeypatch.setattr(prompt_audit, "COHORT", _one_page_cohort(page_hash))
    monkeypatch.setattr(prompt_audit, "EXPECTED_TOTALS", _one_page_totals())

    def forbidden_call(*_args, **_kwargs):
        raise AssertionError("the saved-context gate must not call an outside service")

    monkeypatch.setattr(prompt_audit.requests.Session, "get", forbidden_call)
    monkeypatch.setattr(anthropic_enrichment, "_call_anthropic", forbidden_call)
    monkeypatch.setattr(rag_ingest, "build_rag_rows_for_bill_keys", forbidden_call)

    calls: Counter[str] = Counter()
    for name in (
        "replace_bill_version_prompt_context",
        "bill_prompt_measurement",
        "bill_prompt",
        "canonical_source_text_fingerprint",
    ):
        real = getattr(prompt_audit, name)

        def counted(*args, _name=name, _real=real, **kwargs):
            calls[_name] += 1
            return _real(*args, **kwargs)

        monkeypatch.setattr(prompt_audit, name, counted)

    with Session(get_engine()) as db:
        before = int(db.scalar(select(func.count(schema.Bill.id))) or 0)
        report, errors = prompt_audit.audit(cache_dir=cache_dir, db=db)
        after = int(db.scalar(select(func.count(schema.Bill.id))) or 0)

    assert errors == []
    assert before == after
    assert calls == {
        "replace_bill_version_prompt_context": 1,
        "bill_prompt_measurement": 1,
        "bill_prompt": 1,
        "canonical_source_text_fingerprint": 1,
    }
    assert report["paid_model_calls"] == 0
    assert report["rag_rebuild_calls"] == 0
    assert report["saved_context_round_trips"] == 1
    row = report["rows"][0]
    assert row["official_page_sha256"] == page_hash
    assert row["prompt_input_complete"] is True
    assert len(row["source_text_fingerprint"]) == 64
    assert len(row["prepared_prompt_fingerprint"]) == 64
    assert row["rag_section_documents"] == 0
    assert row["proposed_prompt_references"] == 1
    assert row["appendix_prompt_references"] == 4
    assert row["appendix_raw_official_slots"] == 6
    assert row["appendix_legal_source_blocks"] == 5
    assert row["statute_legal_source_bodies"] == 3
    assert row["statute_subdivision_source_bodies"] == 2
    assert row["statute_unsubdivided_legal_source_bodies"] == 1
    assert row["statute_empty_notice_slots"] == 1
    assert row["session_law_source_blocks"] == 1
    assert row["session_law_nested_subdivision_bodies"] == 1
    assert row["appendix_literal_subdivision_bodies"] == 3
    assert row["rule_part_source_blocks"] == 1


def test_gate_rejects_changed_source_hash_before_storage(
    seed_database: None, monkeypatch, tmp_path
) -> None:
    cache_dir = tmp_path / "official-pages"
    cache_dir.mkdir()
    (cache_dir / "audit-2026-HF1.html").write_text(SAVED_CONTEXT_HTML, encoding="utf-8")
    monkeypatch.setattr(prompt_audit, "COHORT", _one_page_cohort("0" * 64))
    monkeypatch.setattr(prompt_audit, "EXPECTED_TOTALS", _one_page_totals())

    def forbidden_call(*_args, **_kwargs):
        raise AssertionError("a changed page must be rejected before storage")

    monkeypatch.setattr(prompt_audit.requests.Session, "get", forbidden_call)
    monkeypatch.setattr(
        prompt_audit, "replace_bill_version_prompt_context", forbidden_call
    )

    with Session(get_engine()) as db:
        before = int(db.scalar(select(func.count(schema.Bill.id))) or 0)
        report, errors = prompt_audit.audit(cache_dir=cache_dir, db=db)
        after = int(db.scalar(select(func.count(schema.Bill.id))) or 0)

    assert before == after
    assert report["bills_checked"] == 0
    assert any("source page SHA-256 changed" in error for error in errors)


def test_gate_rejects_a_parser_result_that_drops_one_raw_statute_subdivision(
    seed_database: None, monkeypatch, tmp_path
) -> None:
    cache_dir = tmp_path / "official-pages"
    cache_dir.mkdir()
    (cache_dir / "audit-2026-HF1.html").write_text(SAVED_CONTEXT_HTML, encoding="utf-8")
    page_hash = hashlib.sha256(SAVED_CONTEXT_HTML.encode("utf-8")).hexdigest()
    monkeypatch.setattr(prompt_audit, "COHORT", _one_page_cohort(page_hash))
    monkeypatch.setattr(prompt_audit, "EXPECTED_TOTALS", _one_page_totals())
    real_parse = prompt_audit.parse_bill_text_html

    def incomplete_parse(page: str, url: str):
        parsed = real_parse(page, url)
        statute = next(
            reference
            for reference in parsed["appendix_references"]
            if reference["reference_kind"] == "repealed_statute"
        )
        statute["raw_text"] = "Subdivision 1. First old statute body."
        statute["source_hash"] = hashlib.sha256(
            statute["raw_text"].encode("utf-8")
        ).hexdigest()
        return parsed

    def forbidden_call(*_args, **_kwargs):
        raise AssertionError("the raw-source gate must not call an outside service")

    monkeypatch.setattr(prompt_audit, "parse_bill_text_html", incomplete_parse)
    monkeypatch.setattr(prompt_audit.requests.Session, "get", forbidden_call)
    monkeypatch.setattr(anthropic_enrichment, "_call_anthropic", forbidden_call)
    monkeypatch.setattr(rag_ingest, "build_rag_rows_for_bill_keys", forbidden_call)

    with Session(get_engine()) as db:
        report, errors = prompt_audit.audit(cache_dir=cache_dir, db=db)

    assert report["paid_model_calls"] == 0
    assert report["rag_rebuild_calls"] == 0
    assert any(
        "A1 does not contain raw source block 2 under its correct legal reference"
        in error
        for error in errors
    )
