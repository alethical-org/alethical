"""Match checked FEC payment context to an explicit election or cycle scope.

This pure guard does not verify bytes, approve identities, choose amendments or
sum money. Callers must validate the context binding against retained source
bytes and derive the scope from the selected election and reviewed candidacy.
A raw_metadata object is never a substitute for that checked context.
"""

from collections.abc import Mapping
from dataclasses import dataclass
import re
from typing import Any, Literal


@dataclass(frozen=True)
class FecPaymentScope:
    """An explicit comparison scope, not inferred from payment/report dates."""

    kind: Literal["election", "cycle"]
    year: int
    candidate_id: str
    office: str
    state: str
    district: str | None
    election_type: str | None = None


@dataclass(frozen=True)
class PaymentScopeResult:
    admitted: bool
    reason: str


def _hold(reason: str) -> PaymentScopeResult:
    return PaymentScopeResult(False, reason)


def _district_valid(office: str, district: object) -> bool:
    if office == "S":
        # Senate has no congressional district. Preserve both source spellings;
        # a nonzero district is conflicting evidence, not harmless padding.
        return district is None or district == "00"
    return isinstance(district, str) and re.fullmatch(r"[0-9]{2}", district) is not None


def assess_fec_payment_scope(
    payment: Mapping[str, Any],
    checked_context: Mapping[str, Any] | None,
    scope: FecPaymentScope,
) -> PaymentScopeResult:
    """Return a named hold unless checked target and election context agree.

    Exact-race scope currently supports regular general and primary elections.
    S/R/C/E/O codes need more election-specific evidence for a race match; they
    can remain in an explicitly requested cycle comparison with their literal
    code. Here cycle means the named target election year across stages, not
    membership in an API reporting-cycle query. No report or payment date is
    used to rewrite an election year.
    """
    if (
        scope.kind not in {"election", "cycle"}
        or type(scope.year) is not int
        or not 1900 <= scope.year <= 2999
        or not isinstance(scope.candidate_id, str)
        or re.fullmatch(r"[HSP][0-9][A-Z]{2}[0-9]{5}", scope.candidate_id) is None
        or scope.office not in {"H", "S"}
        or not isinstance(scope.state, str)
        or re.fullmatch(r"[A-Z]{2}", scope.state) is None
        or scope.candidate_id[0] != scope.office
        or scope.candidate_id[2:4] != scope.state
        or not _district_valid(scope.office, scope.district)
    ):
        return _hold("invalid_target_scope")
    if scope.kind == "election" and scope.election_type not in {"general", "primary"}:
        return _hold("exact_election_context_unsupported")
    if scope.kind == "cycle" and scope.election_type is not None:
        return _hold("ambiguous_target_scope")
    if not isinstance(checked_context, Mapping):
        return _hold("checked_election_context_unavailable")
    for field in ("authority", "account_id", "source_report_id", "source_row_id"):
        value = checked_context.get(field)
        if not isinstance(value, str) or not value or payment.get(field) != value:
            return _hold("payment_context_identity_mismatch")
    if checked_context["authority"] != "fec":
        return _hold("unsupported_authority")
    candidate = checked_context.get("target_source_candidate_id")
    if payment.get("target_source_candidate_id") != candidate:
        return _hold("payment_context_identity_mismatch")
    if candidate is None:
        return _hold("source_candidate_unavailable")
    if candidate != scope.candidate_id:
        return _hold("target_candidate_mismatch")
    code = checked_context.get("election_code")
    if (
        not isinstance(code, str)
        or re.fullmatch(r"[GPRSCEO][12][0-9]{3}", code) is None
    ):
        return _hold("source_election_context_unavailable")
    if int(code[1:]) != scope.year:
        return _hold("election_year_mismatch")
    if scope.kind == "election":
        expected = "G" if scope.election_type == "general" else "P"
        if code[0] != expected:
            return _hold("election_type_mismatch")
    office = checked_context.get("target_office")
    if not isinstance(office, Mapping) or set(office) != {
        "office",
        "state",
        "district",
    }:
        return _hold("source_target_geography_unavailable")
    if office["office"] is None or office["state"] is None:
        return _hold("source_target_geography_unavailable")
    if office["office"] != scope.office or office["state"] != scope.state:
        return _hold("target_office_mismatch")
    if not _district_valid(scope.office, office["district"]):
        return _hold("source_target_district_unavailable_or_conflicting")
    if scope.office == "H" and office["district"] != scope.district:
        return _hold("target_district_mismatch")
    return PaymentScopeResult(
        True,
        "exact_election_match" if scope.kind == "election" else "explicit_cycle_match",
    )
