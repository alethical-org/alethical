"""Fixed trusted extraction adapters shared by authenticated application readers."""

from threading import Lock

from alethical.pipeline import election_external_finance as storage

_LOCK = Lock()


def register_external_adapters():
    """Install only application-owned code; import and registration perform no I/O."""
    from alethical.pipeline.election_fec_sources import (
        extract_fec_source,
        extract_fec_bulk_source,
    )
    from alethical.pipeline.election_fec_catalogue import extract_catalogue
    from alethical.pipeline.election_fec_publisher import extract_publisher
    from alethical.pipeline.election_fec_paper_identity import (
        extract_fec_paper_identity,
    )
    from alethical.pipeline.election_fec_candidate_identity import (
        extract_candidate_master,
        extract_candidate_linkage,
    )

    fixed = (
        ("fec_raw:v1", extract_fec_source),
        ("fec_bulk_summary:v1", extract_fec_bulk_source),
        ("fec_catalogue:v1", extract_catalogue),
        ("fec_publisher:v1", extract_publisher),
        ("fec_form2_pdf:v1", extract_fec_paper_identity),
        ("fec_candidate_master:v1", extract_candidate_master),
        ("fec_candidate_linkage:v1", extract_candidate_linkage),
    )
    with _LOCK:
        # Check the complete set first, so a collision cannot partly install it.
        for name, adapter in fixed:
            existing = storage.ADAPTERS.get(name)
            storage.require(
                existing is None or existing is adapter,
                "Built-in adapter identifier is assigned to different code",
            )
        for name, adapter in fixed:
            if name not in storage.ADAPTERS:
                storage.register_adapter(name, adapter)
