"""CLI entrypoint: run the pilot A/B benchmark end to end.

Usage (mock mode, no API key needed -- exercises the full harness):
    DATABASE_URL=postgresql+psycopg://alethical:alethical@localhost:54329/alethical \\
        python -m alethical.eval.persona_benchmark.run_pilot --mode mock

Usage (live, once OPENAI_API_KEY is set):
    OPENAI_API_KEY=sk-... DATABASE_URL=... \\
        python -m alethical.eval.persona_benchmark.run_pilot --mode live

Writes everything under alethical/eval/persona_benchmark/results/:
  run_records.json        -- every RunRecord (metadata field 5 of the task)
  results.json            -- machine-readable aggregate
  report.md               -- human-readable report, 5 dimensions kept apart
  recognition_blinded.json / recognition_answer_key.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.session import get_session_factory  # noqa: E402
from alethical.eval.persona_benchmark.data_model import (  # noqa: E402
    load_cases,
    load_conversations,
    save_run_records,
)
from alethical.eval.persona_benchmark.legislators import PILOT_LEGISLATORS  # noqa: E402
from alethical.eval.persona_benchmark.recognition import (  # noqa: E402
    RECOGNITION_CATEGORIES,
    build_recognition_round,
    write_recognition_artifact,
)
from alethical.eval.persona_benchmark.report import (  # noqa: E402
    aggregate_grounding,
    aggregate_human_likeness,
    aggregate_style_leakage,
    render_human_readable,
    write_machine_readable,
)
from alethical.eval.persona_benchmark.runner import (  # noqa: E402
    ModelConfig,
    run_case,
    run_conversation,
)
from alethical.eval.persona_benchmark.scoring import (  # noqa: E402
    detect_style_leakage,
    repetition_rate,
    score_case,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["mock", "live"], default="mock")
    parser.add_argument("--model", default="gpt-4o-mini")
    args = parser.parse_args()

    cfg = ModelConfig(model=args.model)
    cases_dir = HERE / "cases"
    results_dir = HERE / "results"
    results_dir.mkdir(exist_ok=True)

    Session = get_session_factory()
    db = Session()

    all_run_records = []
    all_scores = {"A": [], "B": []}
    all_leakage = []
    conversation_records = {"A": [], "B": []}

    cases_by_legislator: dict[str, dict] = {}
    records_by_condition_category: dict[tuple[str, str], dict] = {}

    try:
        for profile in PILOT_LEGISLATORS:
            slug = profile.full_name.lower().replace(" ", "-").replace(".", "")
            lid = str(profile.id)
            cases = load_cases(cases_dir / f"{slug}.json")
            cases_by_legislator[lid] = {c.category: c for c in cases}

            for condition in ("A", "B"):
                for case in cases:
                    record = run_case(
                        db, case, condition, profile.full_name, mode=args.mode, cfg=cfg
                    )
                    all_run_records.append(record)
                    all_scores[condition].append(score_case(case, record))
                    records_by_condition_category.setdefault(
                        (condition, case.category), {}
                    )[lid] = record

                    if condition == "B":
                        all_leakage.append(
                            detect_style_leakage(
                                case, record, record.style_exemplars_used
                            )
                        )

        conversations = load_conversations(cases_dir / "conversations.json")
        for conversation in conversations:
            profile = next(
                p for p in PILOT_LEGISLATORS if str(p.id) == conversation.legislator_id
            )
            for condition in ("A", "B"):
                turn_records = run_conversation(
                    db,
                    conversation,
                    condition,
                    profile.full_name,
                    mode=args.mode,
                    cfg=cfg,
                )
                conversation_records[condition].extend(turn_records)
                all_run_records.extend(turn_records)

        save_run_records(results_dir / "run_records.json", all_run_records)

        legislator_names = {str(p.id): p.full_name for p in PILOT_LEGISLATORS}
        recognition_rounds = []
        for condition in ("A", "B"):
            for category in RECOGNITION_CATEGORIES:
                key = (condition, category)
                if key not in records_by_condition_category:
                    continue
                records_for_round = records_by_condition_category[key]
                cases_for_round = {
                    lid: cases_by_legislator[lid][category]
                    for lid in records_for_round
                    if category in cases_by_legislator[lid]
                }
                if len(cases_for_round) < 2:
                    continue
                try:
                    items, prompt = build_recognition_round(
                        category,
                        condition,
                        cases_for_round,
                        records_for_round,
                        legislator_names,
                    )
                except ValueError as exc:
                    print(f"skipping recognition round {key}: {exc}")
                    continue
                recognition_rounds.append((category, condition, items, prompt))

        blinded_path, key_path = write_recognition_artifact(
            results_dir, recognition_rounds
        )
        print(f"recognition artifact: {blinded_path}")
        print(f"recognition answer key: {key_path}")

        human_likeness = {
            cond: aggregate_human_likeness(
                {
                    lid: [
                        s
                        for s in all_scores[cond]
                        if s.case_id.startswith(
                            profile.full_name.lower().replace(" ", "-").replace(".", "")
                        )
                    ]
                    for profile in PILOT_LEGISLATORS
                    for lid in [str(profile.id)]
                }
            )
            for cond in ("A", "B")
        }
        repetition = {
            cond: repetition_rate([r for r in all_run_records if r.condition == cond])
            for cond in ("A", "B")
        }

        payload = {
            "mode": args.mode,
            "model": args.model,
            "grounding": {
                cond: aggregate_grounding(all_scores[cond]) for cond in ("A", "B")
            },
            "human_likeness": human_likeness,
            "repetition": repetition,
            "style_leakage": aggregate_style_leakage(all_leakage),
            "conversations": {"n_conversations": len(conversations)},
        }
        write_machine_readable(results_dir / "results.json", payload)

        report_text = render_human_readable(payload, mode=args.mode)
        (results_dir / "report.md").write_text(report_text)
        print(report_text)

    finally:
        db.close()


if __name__ == "__main__":
    main()
