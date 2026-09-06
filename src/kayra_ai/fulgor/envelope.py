from __future__ import annotations

import base64
import hashlib
from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .canonical import canonicalize, length_prefix, parse_json_strict, validate_json_value
from .domains import operation_domain_bytes
from .ed25519 import decode_public_key_base64, decode_signature_base64, verify_strict
from .errors import FulgorErrorCode, FulgorValidationError
from .header import (
    ProtectedHeader,
    _validate_programmatic_content_digest,
    parse_protected_header,
    parse_protected_header_bytes,
    validate_protected_header,
)
from .validators import validate_registered_payload


class TrustStatus(StrEnum):
    NOT_EVALUATED_PHASE_0 = "NOT_EVALUATED_PHASE_0"


@dataclass(frozen=True, slots=True)
class DetachedSignatureEnvelope:
    protected_header: ProtectedHeader
    signature: str

    def __post_init__(self) -> None:
        if type(self.protected_header) is not ProtectedHeader:
            raise FulgorValidationError(
                FulgorErrorCode.INVALID_ENVELOPE,
                "protected_header must be a validated ProtectedHeader",
            )
        validate_protected_header(self.protected_header)
        decode_signature_base64(self.signature)

    def to_dict(self) -> dict[str, Any]:
        return {"protected_header": self.protected_header.to_dict(), "signature": self.signature}


@dataclass(frozen=True, slots=True)
class VerificationExpectations:
    payload_type: str | None = None
    purpose: str | None = None
    scope_digest: str | None = None
    authority_id: str | None = None
    key_id: str | None = None
    policy_epoch: int | None = None
    subject_digest: str | None = None
    nonce: str | None = None
    root_generation: int | None = None


@dataclass(frozen=True, slots=True)
class DetachedVerificationResult:
    cryptographically_valid: bool
    trust_status: TrustStatus
    signature_valid: bool
    issuer_authorized: bool | None
    not_revoked: bool | None
    time_valid: bool | None
    anti_rollback_valid: bool | None
    payload_digest: str | None
    policy_snapshot: None
    error_code: FulgorErrorCode | None = None
    error_detail: str | None = None

    def __post_init__(self) -> None:
        if self.trust_status is not TrustStatus.NOT_EVALUATED_PHASE_0:
            raise FulgorValidationError(
                FulgorErrorCode.INVALID_ENVELOPE,
                "Phase 0 verification results cannot represent trust authorization",
            )
        if any(
            value is not None
            for value in (
                self.issuer_authorized,
                self.not_revoked,
                self.time_valid,
                self.anti_rollback_valid,
                self.policy_snapshot,
            )
        ):
            raise FulgorValidationError(
                FulgorErrorCode.INVALID_ENVELOPE,
                "later-phase authority fields must remain unevaluated in Phase 0",
            )
        if self.cryptographically_valid != self.signature_valid:
            raise FulgorValidationError(
                FulgorErrorCode.INVALID_ENVELOPE,
                "cryptographic and signature validity must agree in Phase 0",
            )
        if self.cryptographically_valid:
            if (
                type(self.payload_digest) is not str
                or len(self.payload_digest) != 64
                or any(character not in "0123456789abcdef" for character in self.payload_digest)
                or self.error_code is not None
                or self.error_detail is not None
            ):
                raise FulgorValidationError(
                    FulgorErrorCode.INVALID_ENVELOPE,
                    "successful Phase 0 result requires one valid payload digest and no error",
                )
        elif self.payload_digest is not None:
            raise FulgorValidationError(
                FulgorErrorCode.INVALID_ENVELOPE,
                "failed Phase 0 result cannot retain a payload digest",
            )

    @property
    def trust_authorized(self) -> bool:
        return False


def parse_detached_envelope(value: Any) -> DetachedSignatureEnvelope:
    """Build a locally validated envelope from a programmatic value.

    This is not a serialized-wire verifier.  It intentionally cannot confer
    canonical serialized-document provenance on a Python dict.
    """

    validate_json_value(value)
    if type(value) is not dict or set(value) != {"protected_header", "signature"}:
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_ENVELOPE, "envelope must contain only protected_header and signature"
        )
    signature = value["signature"]
    decode_signature_base64(signature)
    return DetachedSignatureEnvelope(parse_protected_header(value["protected_header"]), signature)


def parse_detached_envelope_bytes(raw: bytes) -> DetachedSignatureEnvelope:
    """Parse a canonical serialized Contract 6 document at a wire boundary."""

    value = parse_json_strict(raw)
    if type(value) is not dict:
        raise FulgorValidationError(FulgorErrorCode.INVALID_ENVELOPE, "envelope must be an object")
    return parse_detached_envelope(value)


def _validated_header(header: ProtectedHeader | dict[str, Any]) -> ProtectedHeader:
    if type(header) is ProtectedHeader:
        return validate_protected_header(header)
    if type(header) is dict:
        return parse_protected_header(header)
    raise FulgorValidationError(FulgorErrorCode.INVALID_HEADER, "header must be an object")


def _validated_envelope(
    envelope: DetachedSignatureEnvelope | dict[str, Any],
) -> DetachedSignatureEnvelope:
    if type(envelope) is DetachedSignatureEnvelope:
        return parse_detached_envelope(envelope.to_dict())
    if type(envelope) is dict:
        return parse_detached_envelope(envelope)
    raise FulgorValidationError(FulgorErrorCode.INVALID_ENVELOPE, "envelope must be an object")


def signature_input(header: ProtectedHeader | dict[str, Any], payload: Any) -> bytes:
    """Programmatic signature-input calculation; not a wire-verification API."""

    header_value = _validated_header(header).to_dict()
    validate_json_value(payload)
    return (
        operation_domain_bytes("signature")
        + length_prefix(canonicalize(header_value))
        + length_prefix(canonicalize(payload))
    )


def signature_input_serialized(header_raw: bytes, payload_raw: bytes) -> bytes:
    """Reconstruct SigInput only after both serialized documents are canonical."""

    return signature_input(parse_protected_header_bytes(header_raw), parse_json_strict(payload_raw))


def sign_detached(
    private_key: Ed25519PrivateKey,
    header: ProtectedHeader | dict[str, Any],
    payload: Any,
) -> DetachedSignatureEnvelope:
    parsed_header = _validated_header(header)
    validate_registered_payload(parsed_header.payload_type, payload)
    _validate_programmatic_content_digest(parsed_header, payload)
    signature = private_key.sign(signature_input(parsed_header, payload))
    return DetachedSignatureEnvelope(
        protected_header=parsed_header,
        signature=base64.b64encode(signature).decode("ascii"),
    )


def _check_expectations(header: ProtectedHeader, expected: VerificationExpectations) -> None:
    for field, expected_value in asdict(expected).items():
        if expected_value is not None and getattr(header, field) != expected_value:
            raise FulgorValidationError(
                FulgorErrorCode.HEADER_BINDING_MISMATCH, f"protected header {field} mismatch"
            )


def verify_detached(
    envelope_raw: bytes,
    payload_raw: bytes,
    public_key: bytes | str,
    *,
    expected: VerificationExpectations | None = None,
) -> DetachedVerificationResult:
    """Authoritative bytes-first Contract 6 verification; never grant trust authority."""

    try:
        if type(envelope_raw) is not bytes or type(payload_raw) is not bytes:
            raise FulgorValidationError(
                FulgorErrorCode.INVALID_ENVELOPE,
                "authoritative verification requires canonical envelope and payload bytes",
            )
        parsed = parse_detached_envelope_bytes(envelope_raw)
        payload = parse_json_strict(payload_raw)
        validate_registered_payload(parsed.protected_header.payload_type, payload)
        digest = _validate_programmatic_content_digest(parsed.protected_header, payload)
        decoded_public_key = (
            decode_public_key_base64(public_key) if type(public_key) is str else public_key
        )
        if type(decoded_public_key) is not bytes:
            raise FulgorValidationError(FulgorErrorCode.INVALID_PUBLIC_KEY, "public key must be bytes or base64 text")
        if hashlib.sha256(decoded_public_key).hexdigest() != parsed.protected_header.key_id:
            raise FulgorValidationError(
                FulgorErrorCode.HEADER_BINDING_MISMATCH, "key_id does not equal H(raw public key)"
            )
        if expected is not None:
            _check_expectations(parsed.protected_header, expected)
        signature = decode_signature_base64(parsed.signature)
        verify_strict(decoded_public_key, signature, signature_input(parsed.protected_header, payload))
        return DetachedVerificationResult(
            cryptographically_valid=True,
            trust_status=TrustStatus.NOT_EVALUATED_PHASE_0,
            signature_valid=True,
            issuer_authorized=None,
            not_revoked=None,
            time_valid=None,
            anti_rollback_valid=None,
            payload_digest=digest,
            policy_snapshot=None,
        )
    except FulgorValidationError as exc:
        return DetachedVerificationResult(
            cryptographically_valid=False,
            trust_status=TrustStatus.NOT_EVALUATED_PHASE_0,
            signature_valid=False,
            issuer_authorized=None,
            not_revoked=None,
            time_valid=None,
            anti_rollback_valid=None,
            payload_digest=None,
            policy_snapshot=None,
            error_code=exc.code,
            error_detail=exc.detail,
        )
