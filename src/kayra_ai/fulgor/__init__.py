"""Frozen Fulgor V2.3.8 Phase 0 trust primitives."""

from .canonical import MAX_PAYLOAD_BYTES, MAX_SAFE_INTEGER, canonicalize, parse_json_strict
from .digests import contract_digest
from .domains import (
    CONTRACT_DOMAINS,
    OPERATION_DOMAINS,
    PHASE0_REGISTERED_DOMAIN_TAGS,
    PHASE0_FORMULA_DOMAIN_USES,
    PHASE0_USED_DOMAIN_TAGS,
    REGISTERED_DOMAIN_TAGS,
    assert_phase0_domain_usage,
    assert_registry_integrity,
    validate_domain_registry,
)
from .ed25519 import decode_public_key_base64, decode_signature_base64, verify_strict
from .envelope import (
    DetachedSignatureEnvelope,
    DetachedVerificationResult,
    TrustStatus,
    VerificationExpectations,
    sign_detached,
    signature_input,
    signature_input_serialized,
    verify_detached,
)
from .errors import FulgorErrorCode, FulgorValidationError
from .header import (
    ProtectedHeader,
    parse_protected_header,
    parse_protected_header_bytes,
    validate_content_digest,
    validate_protected_header,
    validate_serialized_content_digest,
)
from .paths import logical_path_sha256, validate_logical_path, validate_no_casefold_collisions
from .profiles import CANONICAL_PROFILE, ED25519_PROFILE, LOGICAL_PATH_PROFILE
from .validators import REGISTERED_PAYLOAD_VALIDATORS, TypedPayloadValidatorRegistration

__all__ = [
    "CANONICAL_PROFILE",
    "CONTRACT_DOMAINS",
    "DetachedSignatureEnvelope",
    "DetachedVerificationResult",
    "ED25519_PROFILE",
    "FulgorErrorCode",
    "FulgorValidationError",
    "LOGICAL_PATH_PROFILE",
    "MAX_PAYLOAD_BYTES",
    "MAX_SAFE_INTEGER",
    "OPERATION_DOMAINS",
    "PHASE0_REGISTERED_DOMAIN_TAGS",
    "PHASE0_FORMULA_DOMAIN_USES",
    "PHASE0_USED_DOMAIN_TAGS",
    "ProtectedHeader",
    "REGISTERED_PAYLOAD_VALIDATORS",
    "REGISTERED_DOMAIN_TAGS",
    "TrustStatus",
    "TypedPayloadValidatorRegistration",
    "VerificationExpectations",
    "assert_registry_integrity",
    "assert_phase0_domain_usage",
    "canonicalize",
    "contract_digest",
    "decode_public_key_base64",
    "decode_signature_base64",
    "logical_path_sha256",
    "parse_json_strict",
    "parse_protected_header",
    "parse_protected_header_bytes",
    "sign_detached",
    "signature_input",
    "signature_input_serialized",
    "validate_content_digest",
    "validate_protected_header",
    "validate_serialized_content_digest",
    "validate_logical_path",
    "validate_no_casefold_collisions",
    "verify_detached",
    "verify_strict",
    "validate_domain_registry",
]
