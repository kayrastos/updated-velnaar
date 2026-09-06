from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

from .canonical import MAX_SAFE_INTEGER, parse_json_strict, validate_json_value
from .digests import contract_digest
from .errors import FulgorErrorCode, FulgorValidationError


PAYLOAD_CONTRACTS = {
    "SafetyTrustPolicyPayloadV2_3_8": 8,
    "EvidenceSignerCertificatePayloadV2_3_8": 9,
    "FinalEvidencePayloadV2_3_8": 10,
    "HumanDecisionV2_3_8": 31,
    "SafetyKernelDecisionV2_3_8": 32,
    "ModelArtifactAttestationPayloadV2_3_8": 33,
    "ExecutionBundleAttestationPayloadV2_3_8": 35,
    "RuntimeObservationV2_3_8": 38,
    "ProvenanceValidationRegistryV2_3_8": 50,
    "ActionScopedCapabilityV2_3_8": 54,
    "ActionResultV2_3_8": 55,
}
PAYLOAD_PURPOSES = {
    "SafetyTrustPolicyPayloadV2_3_8": "POLICY",
    "EvidenceSignerCertificatePayloadV2_3_8": "CERTIFICATE",
    "FinalEvidencePayloadV2_3_8": "EVIDENCE",
    "HumanDecisionV2_3_8": "DECISION",
    "SafetyKernelDecisionV2_3_8": "DECISION",
    "ModelArtifactAttestationPayloadV2_3_8": "ATTESTATION",
    "ExecutionBundleAttestationPayloadV2_3_8": "ATTESTATION",
    "RuntimeObservationV2_3_8": "OBSERVATION",
    "ProvenanceValidationRegistryV2_3_8": "ATTESTATION",
    "ActionScopedCapabilityV2_3_8": "ACTION",
    "ActionResultV2_3_8": "ACTION",
}
_HEADER_FIELDS = frozenset(
    {
        "schema_version",
        "payload_type",
        "purpose",
        "scope_digest",
        "authority_id",
        "key_id",
        "policy_epoch",
        "serial",
        "issued_at",
        "not_before",
        "not_after",
        "subject_digest",
        "nonce",
        "content_digest",
        "root_generation",
    }
)
_HEX64_RE = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class ProtectedHeader:
    schema_version: str
    payload_type: str
    purpose: str
    scope_digest: str
    authority_id: str
    key_id: str
    policy_epoch: int
    serial: int
    issued_at: int
    not_before: int
    not_after: int
    subject_digest: str
    nonce: str
    content_digest: str
    root_generation: int

    def __post_init__(self) -> None:
        _validate_header_fields(self.to_dict())

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _validate_header_fields(value: dict[str, Any]) -> None:
    """The single local Contract 5 invariant boundary.

    This deliberately operates on field values, rather than relying on a
    dataclass constructor having run.  Security-sensitive consumers call
    :func:`validate_protected_header` again at their point of use.
    """

    validate_json_value(value)
    if value["schema_version"] != "2.3.8":
        raise FulgorValidationError(FulgorErrorCode.INVALID_HEADER, "unknown schema_version")
    if value["payload_type"] not in PAYLOAD_CONTRACTS:
        raise FulgorValidationError(FulgorErrorCode.INVALID_HEADER, "unknown payload_type")
    expected_purpose = PAYLOAD_PURPOSES[value["payload_type"]]
    if value["purpose"] != expected_purpose:
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_HEADER,
            f"purpose {value['purpose']!r} is invalid for {value['payload_type']}",
        )
    for field in (
        "scope_digest",
        "authority_id",
        "key_id",
        "subject_digest",
        "nonce",
        "content_digest",
    ):
        _require_hex64(value[field], field)
    _require_safe_integer(value["policy_epoch"], "policy_epoch")
    _require_safe_integer(value["serial"], "serial", minimum=1)
    _require_safe_integer(value["issued_at"], "issued_at")
    _require_safe_integer(value["not_before"], "not_before")
    _require_safe_integer(value["not_after"], "not_after")
    _require_safe_integer(value["root_generation"], "root_generation")
    if not value["not_before"] <= value["issued_at"] <= value["not_after"]:
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_HEADER, "requires not_before <= issued_at <= not_after"
        )


def _require_safe_integer(value: Any, field: str, *, minimum: int = 0) -> int:
    if type(value) is not int or not minimum <= value <= MAX_SAFE_INTEGER:
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_HEADER,
            f"{field} must be an integer in [{minimum},{MAX_SAFE_INTEGER}]",
        )
    return value


def _require_hex64(value: Any, field: str) -> str:
    if type(value) is not str or _HEX64_RE.fullmatch(value) is None:
        raise FulgorValidationError(FulgorErrorCode.INVALID_HEADER, f"{field} must be 64 lowercase hex")
    return value


def parse_protected_header(value: Any) -> ProtectedHeader:
    """Build a locally validated Contract 5 object from a programmatic value.

    This helper is intentionally non-wire: a dict (including one from
    ``json.loads``) carries no proof about serialized-byte canonicality.  Use
    :func:`parse_protected_header_bytes` at a serialized-input boundary.
    """

    validate_json_value(value)
    if type(value) is not dict:
        raise FulgorValidationError(FulgorErrorCode.INVALID_HEADER, "protected header must be an object")
    fields = frozenset(value)
    if fields != _HEADER_FIELDS:
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_HEADER,
            f"closed header field mismatch; missing={sorted(_HEADER_FIELDS-fields)}, extra={sorted(fields-_HEADER_FIELDS)}",
        )
    return ProtectedHeader(**value)


def parse_protected_header_bytes(raw: bytes) -> ProtectedHeader:
    """Parse a canonical serialized Contract 5 document at a wire boundary."""

    return parse_protected_header(parse_json_strict(raw))


def validate_protected_header(header: ProtectedHeader) -> ProtectedHeader:
    """Revalidate all local Contract 5 invariants at a security point of use."""

    if type(header) is not ProtectedHeader:
        raise FulgorValidationError(FulgorErrorCode.INVALID_HEADER, "header must be ProtectedHeader")
    try:
        # Reconstructing through the mapping validator defeats __new__/__setattr__
        # instances and gives every consumer one normative validation path.
        return parse_protected_header(header.to_dict())
    except (AttributeError, TypeError) as exc:
        raise FulgorValidationError(FulgorErrorCode.INVALID_HEADER, "malformed ProtectedHeader") from exc


def payload_contract_number(payload_type: str) -> int:
    try:
        return PAYLOAD_CONTRACTS[payload_type]
    except KeyError as exc:
        raise FulgorValidationError(FulgorErrorCode.INVALID_HEADER, "unknown payload_type") from exc


def _validate_programmatic_content_digest(header: ProtectedHeader, payload: Any) -> str:
    """Internal programmatic calculation; it establishes no wire provenance."""

    validated_header = validate_protected_header(header)
    validate_json_value(payload)
    digest = contract_digest(payload_contract_number(validated_header.payload_type), payload)
    if digest != validated_header.content_digest:
        raise FulgorValidationError(
            FulgorErrorCode.PAYLOAD_DIGEST_MISMATCH, "header content_digest does not equal D(n,payload)"
        )
    return digest


def validate_content_digest(header_raw: bytes, payload_raw: bytes) -> str:
    """Authoritative bytes-first Contract 5 digest validation."""

    if type(header_raw) is not bytes or type(payload_raw) is not bytes:
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_HEADER,
            "authoritative content-digest validation requires canonical header and payload bytes",
        )
    return _validate_programmatic_content_digest(
        parse_protected_header_bytes(header_raw), parse_json_strict(payload_raw)
    )


def validate_serialized_content_digest(header_raw: bytes, payload_raw: bytes) -> str:
    """Compatibility alias for :func:`validate_content_digest`."""

    return validate_content_digest(header_raw, payload_raw)
