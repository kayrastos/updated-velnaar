from __future__ import annotations

from typing import Any

from .canonical import canonicalize, length_prefix, sha256_hex
from .domains import contract_domain_bytes
from .errors import FulgorErrorCode, FulgorValidationError


_DIGEST_PROJECTIONS = {
    10: frozenset({"evidence_identity"}),
    18: frozenset({"state_digest", "state_mac", "previous_key_authorization"}),
    24: frozenset({"record_digest"}),
    53: frozenset({"action_digest"}),
    55: frozenset({"action_result_digest"}),
}


def _project(contract_number: int, value: Any) -> Any:
    omitted = _DIGEST_PROJECTIONS.get(contract_number)
    if omitted is None:
        return value
    if type(value) is not dict:
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_JSON_VALUE,
            f"Contract {contract_number} digest projection requires an object",
        )
    missing = omitted - value.keys()
    if missing:
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_JSON_VALUE,
            f"Contract {contract_number} projection fields missing: {sorted(missing)}",
        )
    return {key: nested for key, nested in value.items() if key not in omitted}


def contract_digest(contract_number: int, value: Any) -> str:
    canonical = canonicalize(_project(contract_number, value))
    return sha256_hex(contract_domain_bytes(contract_number) + length_prefix(canonical))
