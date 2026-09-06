from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Protocol

from .errors import FulgorErrorCode, FulgorValidationError
from .header import PAYLOAD_CONTRACTS


class PayloadValidator(Protocol):
    def __call__(self, payload: Any) -> None: ...


@dataclass(frozen=True, slots=True)
class TypedPayloadValidatorRegistration:
    """Source-installed binding of a frozen payload identity to its validator."""

    payload_type: str
    contract_number: int
    validator_identity: str
    validator: PayloadValidator

    def __post_init__(self) -> None:
        expected_contract = PAYLOAD_CONTRACTS.get(self.payload_type)
        if expected_contract is None or self.contract_number != expected_contract:
            raise FulgorValidationError(
                FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE,
                "validator payload type and frozen contract identity do not match",
            )
        expected_identity = f"urn:fulgor:{self.payload_type}"
        if self.validator_identity != expected_identity:
            raise FulgorValidationError(
                FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE,
                "validator identity must equal the frozen payload contract identity",
            )
        if not callable(self.validator):
            raise FulgorValidationError(
                FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, "payload validator is not callable"
            )


# Compatibility-only empty view.  It is never read by the authoritative Phase 0
# verification path; rebinding this public module attribute cannot install trust.
REGISTERED_PAYLOAD_VALIDATORS = MappingProxyType(
    {
        # Source-installed registrations are added only with later frozen-contract
        # implementations. Phase 0 deliberately supports none of Contracts 7-57.
    }
)


def validate_registered_payload(payload_type: str, payload: Any) -> None:
    """Fail closed: Contracts 7--57 have no active Phase 0 validators.

    This function intentionally has no registry or callback lookup.  Future
    trusted composition must introduce a separately reviewed integration point.
    """

    raise FulgorValidationError(
        FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE,
        f"payload type {payload_type!r} has no Phase 0 validator",
    )
