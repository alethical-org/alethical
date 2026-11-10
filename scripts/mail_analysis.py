#!/usr/bin/env python3
"""Apply a private, hash-checked creative review without changing mail originals."""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from alethical.api.services import mail_analysis, mail_upload  # noqa: E402
from alethical.db import models as m  # noqa: E402
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target  # noqa: E402


class Review(BaseModel):
    model_config = ConfigDict(extra="forbid")
    submission_id: uuid.UUID
    front_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    back_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    excluded_from_counts: StrictBool
    evidence: str = Field(min_length=20, max_length=2000)
    matching_submission_id: uuid.UUID | None = None


def apply_reviews(db, reviews: list[Review], *, apply: bool) -> dict:
    if len({row.submission_id for row in reviews}) != len(reviews):
        raise ValueError("Duplicate review entries")
    for review in reviews:
        submission = db.get(m.MailUploadSubmission, review.submission_id)
        if submission is None or submission.saved_at is None:
            raise ValueError("Review needs a saved submission")
        images = mail_upload.selected_images(db, submission)
        for side in ("front", "back"):
            image = images.get(side)
            if (
                image is None
                or image.verified_at is None
                or image.sha256 != getattr(review, side + "_sha256")
            ):
                raise ValueError("Reviewed original does not match the saved image")
    if apply:
        for review in reviews:
            mail_analysis.assign_creative(
                db,
                review.submission_id,
                matching_submission_id=review.matching_submission_id,
                excluded=review.excluded_from_counts,
                evidence=review.evidence,
            )
        db.commit()
    return {
        "reviewed": len(reviews),
        "excluded": sum(row.excluded_from_counts for row in reviews),
        "applied": apply,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), default="local")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    path = args.manifest.expanduser().resolve()
    if path.is_relative_to(REPO_ROOT):
        parser.error("Keep the private review manifest outside the repository")
    reviews = [Review.model_validate(row) for row in json.loads(path.read_text())]
    if not reviews or len(reviews) > 100:
        parser.error("Review 1 to 100 saved submissions per manifest")
    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        with Session(engine) as db:
            print(json.dumps(apply_reviews(db, reviews, apply=args.apply)))
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
