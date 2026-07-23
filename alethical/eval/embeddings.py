"""Pluggable embedding providers for the retrieval eval (#400 head-to-head).

The incumbent is OpenAI ``text-embedding-3-small`` (already embedded across the
production corpus, so its corpus vectors are read from the DB, not recomputed).
Voyage support is added here for the eval only — a legal-domain (``voyage-law-2``)
and a SOTA general model (``voyage-3-large``) measured against the incumbent on
the labeled query set before any switch is even considered.

Switching the production embedding model is a large, gated change (pgvector
dimension change + full re-embed + query-path change), so this module exists to
*measure*, not to wire Voyage into the live query path.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

import requests

from alethical.pipeline.rag_ingest import _openai_embeddings

VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings"
VOYAGE_TIMEOUT_SECONDS = 120
# Voyage accepts up to 128 inputs per request, but the free tier's per-minute
# token cap is the real limit — a 128-chunk batch (~27K tokens) can exceed it and
# 429. 32 chunks (~7K tokens) stays under a typical free-tier TPM; raise on a paid
# tier for throughput.
VOYAGE_BATCH_SIZE = 32
VOYAGE_MAX_RETRIES = 6


@dataclass(frozen=True)
class EmbeddingResult:
    """Vectors for a batch of texts, tagged with the model that produced them."""

    model: str
    vectors: list[list[float]]


def embed_openai(
    texts: list[str], *, model: str = "text-embedding-3-small"
) -> list[list[float]]:
    """Real OpenAI embeddings via the shared ingest call site (needs OPENAI_API_KEY)."""
    if not texts:
        return []
    return _openai_embeddings(texts, model=model, batch_size=256)


def embed_voyage(
    texts: list[str],
    *,
    model: str,
    input_type: str,
    output_dimension: int | None = None,
    pace_seconds: float = 0.0,
) -> list[list[float]]:
    """Embed texts with a Voyage model. ``input_type`` is 'query' or 'document'.

    Voyage recommends asymmetric embedding — corpus passages as 'document',
    user questions as 'query' — which typically lifts retrieval quality, so the
    eval uses it for a fair comparison. Retries on 429/5xx with backoff; raises
    on other non-2xx. Reads VOYAGE_API_KEY from the environment.
    """
    if not texts:
        return []
    api_key = os.environ.get("VOYAGE_API_KEY")
    if not api_key:
        raise RuntimeError(
            f"VOYAGE_API_KEY is required to embed with a Voyage model (model={model})."
        )
    if input_type not in ("query", "document"):
        raise ValueError("input_type must be 'query' or 'document'")

    out: list[list[float]] = []
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    for start in range(0, len(texts), VOYAGE_BATCH_SIZE):
        if start > 0 and pace_seconds:
            time.sleep(pace_seconds)
        batch = texts[start : start + VOYAGE_BATCH_SIZE]
        body: dict = {"input": batch, "model": model, "input_type": input_type}
        if output_dimension is not None:
            body["output_dimension"] = output_dimension
        payload = _voyage_post_with_retry(headers, body, model=model)
        data = sorted(payload.get("data", []), key=lambda d: d.get("index", 0))
        if len(data) != len(batch):
            raise RuntimeError(
                f"Voyage returned {len(data)} vectors for a batch of {len(batch)}"
            )
        out.extend(item["embedding"] for item in data)
    return out


def _voyage_post_with_retry(headers: dict, body: dict, *, model: str) -> dict:
    """POST with rate-limit-aware retry. Voyage's free tier is aggressively rate
    limited, so we honor the ``Retry-After`` header when present and otherwise
    back off exponentially with a generous cap — the eval is throughput-bound on
    the limit, not on compute."""
    last_error: Exception | None = None
    for attempt in range(VOYAGE_MAX_RETRIES):
        response = requests.post(
            VOYAGE_EMBEDDINGS_URL,
            headers=headers,
            json=body,
            timeout=VOYAGE_TIMEOUT_SECONDS,
        )
        if response.status_code == 200:
            return response.json()
        if response.status_code == 429 or response.status_code >= 500:
            retry_after = response.headers.get("Retry-After")
            wait = (
                int(retry_after)
                if retry_after and retry_after.isdigit()
                else min(60, 5 * (2**attempt))
            )
            last_error = RuntimeError(
                f"Voyage {response.status_code} (model={model}); retry in {wait}s"
            )
            time.sleep(wait)
            continue
        response.raise_for_status()
    raise RuntimeError(f"Voyage embeddings failed after retries: {last_error}")
