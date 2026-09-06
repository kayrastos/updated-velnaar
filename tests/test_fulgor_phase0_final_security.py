from __future__ import annotations

import base64
import hashlib
import json
import sys
import unittest
from pathlib import Path
from types import MappingProxyType

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from kayra_ai.fulgor import (  # noqa: E402
    DetachedSignatureEnvelope,
    FulgorErrorCode,
    FulgorValidationError,
    ProtectedHeader,
    TypedPayloadValidatorRegistration,
    canonicalize,
    contract_digest,
    parse_protected_header,
    signature_input,
    validate_content_digest,
    validate_serialized_content_digest,
    verify_detached,
)
import kayra_ai.fulgor.validators as validators  # noqa: E402


def public_bytes(private: Ed25519PrivateKey) -> bytes:
    return private.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )


def header_for(payload: object, public: bytes) -> dict[str, object]:
    return {
        "schema_version": "2.3.8",
        "payload_type": "RuntimeObservationV2_3_8",
        "purpose": "OBSERVATION",
        "scope_digest": "1" * 64,
        "authority_id": "2" * 64,
        "key_id": hashlib.sha256(public).hexdigest(),
        "policy_epoch": 7,
        "serial": 1,
        "issued_at": 20,
        "not_before": 10,
        "not_after": 30,
        "subject_digest": "3" * 64,
        "nonce": "4" * 64,
        "content_digest": contract_digest(38, payload),
        "root_generation": 5,
    }


class FinalBoundedSecurityRepairTests(unittest.TestCase):
    def setUp(self) -> None:
        self.private = Ed25519PrivateKey.generate()
        self.public = public_bytes(self.private)
        self.payload = {"count": 0, "observation_id": "5" * 64}
        self.header_value = header_for(self.payload, self.public)
        self.header = parse_protected_header(self.header_value)
        signature = base64.b64encode(
            self.private.sign(signature_input(self.header, self.payload))
        ).decode("ascii")
        self.envelope = DetachedSignatureEnvelope(self.header, signature)
        self.envelope_raw = canonicalize(self.envelope.to_dict())
        self.payload_raw = canonicalize(self.payload)

    def test_b1_only_canonical_raw_documents_reach_authoritative_paths(self) -> None:
        noncanonical_payload = b'{ "count":0,"observation_id":"' + b"5" * 64 + b'" }'
        noncanonical_header = b'{ "schema_version":"2.3.8" }'
        for raw in (noncanonical_payload, noncanonical_header):
            with self.subTest(raw=raw[:12]), self.assertRaises(FulgorValidationError) as caught:
                validate_serialized_content_digest(
                    canonicalize(self.header_value) if raw is noncanonical_payload else raw,
                    raw if raw is noncanonical_payload else self.payload_raw,
                )
            self.assertEqual(FulgorErrorCode.NON_CANONICAL_JSON, caught.exception.code)

        wrong_order_header = json.dumps(
            self.header_value, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        with self.assertRaises(FulgorValidationError) as caught:
            validate_serialized_content_digest(wrong_order_header, self.payload_raw)
        self.assertEqual(FulgorErrorCode.NON_CANONICAL_JSON, caught.exception.code)

        parsed_noncanonical = json.loads(noncanonical_payload)
        result = verify_detached(self.envelope.to_dict(), parsed_noncanonical, self.public)
        self.assertFalse(result.cryptographically_valid)
        self.assertEqual(FulgorErrorCode.INVALID_ENVELOPE, result.error_code)

        duplicate_then_rebuilt = json.loads(
            b'{"count":0,"count":0,"observation_id":"' + b"5" * 64 + b'"}'
        )
        result = verify_detached(self.envelope.to_dict(), duplicate_then_rebuilt, self.public)
        self.assertEqual(FulgorErrorCode.INVALID_ENVELOPE, result.error_code)

        manually_crafted_header = dict(self.header_value)
        manually_crafted_payload = dict(self.payload)
        result = verify_detached(manually_crafted_header, manually_crafted_payload, self.public)
        self.assertEqual(FulgorErrorCode.INVALID_ENVELOPE, result.error_code)

        self.assertEqual(
            self.header.content_digest,
            validate_serialized_content_digest(
                canonicalize(self.header_value), self.payload_raw
            ),
        )
        canonical_result = verify_detached(self.envelope_raw, self.payload_raw, self.public)
        self.assertFalse(canonical_result.cryptographically_valid)
        self.assertEqual(FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, canonical_result.error_code)

    def test_b2_registry_rebinding_and_caller_registrations_are_inert(self) -> None:
        registration = TypedPayloadValidatorRegistration(
            "RuntimeObservationV2_3_8",
            38,
            "urn:fulgor:RuntimeObservationV2_3_8",
            lambda value: None,
        )
        original = validators.REGISTERED_PAYLOAD_VALIDATORS
        try:
            validators.REGISTERED_PAYLOAD_VALIDATORS = MappingProxyType(
                {"RuntimeObservationV2_3_8": registration}
            )
            result = verify_detached(self.envelope_raw, self.payload_raw, self.public)
        finally:
            validators.REGISTERED_PAYLOAD_VALIDATORS = original
        self.assertFalse(result.cryptographically_valid)
        self.assertFalse(result.signature_valid)
        self.assertEqual(FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, result.error_code)
        with self.assertRaises(FulgorValidationError) as caught:
            validators.validate_registered_payload("RuntimeObservationV2_3_8", self.payload)
        self.assertEqual(FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, caught.exception.code)

    def test_b3_forged_headers_fail_every_security_sensitive_consumer(self) -> None:
        forged = object.__new__(ProtectedHeader)
        for field, value in self.header.to_dict().items():
            object.__setattr__(forged, field, value)
        object.__setattr__(forged, "serial", 0)

        for consumer in (
            lambda: validate_content_digest(forged, self.payload),
            lambda: signature_input(forged, self.payload),
            lambda: DetachedSignatureEnvelope(forged, self.envelope.signature),
        ):
            with self.subTest(consumer=consumer), self.assertRaises(FulgorValidationError) as caught:
                consumer()
            self.assertEqual(FulgorErrorCode.INVALID_HEADER, caught.exception.code)


if __name__ == "__main__":
    unittest.main()
