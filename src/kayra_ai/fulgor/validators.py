from __future__ import annotations

from dataclasses import InitVar, dataclass
from types import MappingProxyType
from typing import Any, Callable

from . import canonical as _canonical
from . import digests as _digests
from . import ed25519 as _ed25519
from . import frozen_schema as _frozen_schema
from . import phase1_payloads as _phase1_payloads
from .errors import FulgorErrorCode, FulgorValidationError
from .header import PAYLOAD_CONTRACTS
from .phase1_payloads import validate_payload_10, validate_payload_8, validate_payload_9


_SOURCE_METADATA_SENTINEL = object()

@dataclass(frozen=True, slots=True)
class TypedPayloadValidatorRegistration:
    """Non-authoritative metadata for a source-defined payload validator."""

    payload_type: str
    contract_number: int
    validator_identity: str
    validator: InitVar[object | None] = None

    def __post_init__(self, validator: object | None) -> None:
        expected_contract = PAYLOAD_CONTRACTS.get(self.payload_type)
        if expected_contract is None or self.contract_number != expected_contract:
            raise FulgorValidationError(
                FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE,
                "validator payload type and frozen contract identity do not match",
            )
        if self.validator_identity != f"urn:fulgor:{self.payload_type}":
            raise FulgorValidationError(
                FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE,
                "validator metadata does not equal the frozen payload contract identity",
            )
        if validator is not _SOURCE_METADATA_SENTINEL and not callable(validator):
            raise FulgorValidationError(
                FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, "validator constructor argument is not callable"
            )


# These are audit/compatibility metadata only.  They contain no callable and
# are never consulted by the authoritative verification path.
_FROZEN_BINDINGS = (
    TypedPayloadValidatorRegistration("SafetyTrustPolicyPayloadV2_3_8", 8,
                                      "urn:fulgor:SafetyTrustPolicyPayloadV2_3_8", _SOURCE_METADATA_SENTINEL),
    TypedPayloadValidatorRegistration("EvidenceSignerCertificatePayloadV2_3_8", 9,
                                      "urn:fulgor:EvidenceSignerCertificatePayloadV2_3_8", _SOURCE_METADATA_SENTINEL),
    TypedPayloadValidatorRegistration("FinalEvidencePayloadV2_3_8", 10,
                                      "urn:fulgor:FinalEvidencePayloadV2_3_8", _SOURCE_METADATA_SENTINEL),
)
REGISTERED_PAYLOAD_VALIDATORS = MappingProxyType({})


def _source_defined_dispatcher() -> Callable[[str, Any], None]:
    """Create an import-time-frozen Phase 1 structural-validation boundary.

    The public parser and validator names remain convenience APIs, not a
    dependency of detached verification.  Before every verification the
    authoritative path checks that the complete Phase 1 validator module has
    not been rebound.  This makes an in-process parser/helper substitution a
    fail-closed validation error rather than an alternate validator route.
    """

    modules_to_guard = (
        _phase1_payloads,
        _frozen_schema,
        _digests,
        _canonical,
        _ed25519,
    )
    module_snapshots = tuple(
        (mod, tuple(mod.__dict__.items())) for mod in modules_to_guard
    )
    missing = object()
    parsers = {
        "SafetyTrustPolicyPayloadV2_3_8": _phase1_payloads.parse_safety_trust_policy,
        "EvidenceSignerCertificatePayloadV2_3_8": _phase1_payloads.parse_evidence_signer_certificate,
        "FinalEvidencePayloadV2_3_8": _phase1_payloads.parse_final_evidence,
    }
    validators = {
        "SafetyTrustPolicyPayloadV2_3_8": _phase1_payloads.validate_safety_trust_policy,
        "EvidenceSignerCertificatePayloadV2_3_8": _phase1_payloads.validate_evidence_signer_certificate,
        "FinalEvidencePayloadV2_3_8": _phase1_payloads.validate_final_evidence,
    }

    def modules_are_pristine() -> bool:
        for mod, snapshot in module_snapshots:
            current = mod.__dict__
            if len(current) != len(snapshot):
                return False
            for name, value in snapshot:
                if current.get(name, missing) is not value:
                    return False
        return True

    def validate_source_binding(
        incoming_payload_type: str,
        expected_payload_type: str,
        expected_contract_number: int,
        expected_validator_identity: str,
    ) -> None:
        if (
            incoming_payload_type != expected_payload_type
            or (expected_payload_type, expected_contract_number, expected_validator_identity)
            not in {
                ("SafetyTrustPolicyPayloadV2_3_8", 8, "urn:fulgor:SafetyTrustPolicyPayloadV2_3_8"),
                ("EvidenceSignerCertificatePayloadV2_3_8", 9, "urn:fulgor:EvidenceSignerCertificatePayloadV2_3_8"),
                ("FinalEvidencePayloadV2_3_8", 10, "urn:fulgor:FinalEvidencePayloadV2_3_8"),
            }
        ):
            raise FulgorValidationError(
                FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, "frozen validator identity mismatch"
            )

    def dispatch(payload_type: str, payload: Any) -> None:
        """Validate only the source-defined Contract 8/9/10 mapping.

        There is deliberately no registration API, caller callback, live
        lookup, or binding object on this path.  Contracts 11--57 therefore
        remain unavailable even when their header names exist in Contract 5.
        """
        if type(payload_type) is not str:
            raise FulgorValidationError(FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, "payload type must be text")
        if not modules_are_pristine():
            raise FulgorValidationError(
                FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE,
                "Phase 1 structural validator module was rebound",
            )
        if payload_type == "SafetyTrustPolicyPayloadV2_3_8":
            validate_source_binding(payload_type, "SafetyTrustPolicyPayloadV2_3_8", 8,
                                    "urn:fulgor:SafetyTrustPolicyPayloadV2_3_8")
            validators[payload_type](parsers[payload_type](payload))
            return
        if payload_type == "EvidenceSignerCertificatePayloadV2_3_8":
            validate_source_binding(payload_type, "EvidenceSignerCertificatePayloadV2_3_8", 9,
                                    "urn:fulgor:EvidenceSignerCertificatePayloadV2_3_8")
            validators[payload_type](parsers[payload_type](payload))
            return
        if payload_type == "FinalEvidencePayloadV2_3_8":
            validate_source_binding(payload_type, "FinalEvidencePayloadV2_3_8", 10,
                                    "urn:fulgor:FinalEvidencePayloadV2_3_8")
            validators[payload_type](parsers[payload_type](payload))
            return
        raise FulgorValidationError(
            FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE,
            f"payload type {payload_type!r} is not implemented in Phase 1",
        )

    return dispatch


validate_registered_payload = _source_defined_dispatcher()
del _source_defined_dispatcher
